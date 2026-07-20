/*
 * Bay Area Air Quality Episode Finder — Railway backend.
 * Scientific analysis module: dataset constants, Earth Engine graph
 * builders, date availability, the daily canonical-lattice regional
 * observation, the adopted three-year baseline, the signed
 * column-anomaly map, and the bounded in-memory caches.
 *
 * Methods implemented here are the DECIDED ones (docs/methodology.md):
 *   - production regional statistic: canonical native-lattice
 *     area-weighted regional mean with valid-area fraction;
 *   - baseline: previous three same-calendar years, pooled valid
 *     same-month daily regional means, median, signed anomaly,
 *     <=-percentile, full-window requirement;
 *   - primary map product: signed pixelwise column anomaly (target
 *     daily composite minus pixelwise historical same-month median).
 * NOTHING here classifies episodes, applies coverage cutoffs, clamps
 * negatives, interpolates, uses bestEffort, or reprojects.
 */

'use strict';

var eeClient = require('./earth-engine');
var ee = eeClient.ee;

/* ------------------------------------------------------------- CONSTANTS */

var CONSTANTS = {
  datasetId: 'COPERNICUS/S5P/OFFL/L3_NO2',
  bandName: 'tropospheric_NO2_column_number_density',
  datasetLabel: 'Sentinel-5P tropospheric NO₂ column',
  unit: 'mol/m²',
  timeZone: 'America/Los_Angeles',
  collectionStartLocalDate: '2018-06-28',

  boundaryAssetId:
      'projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries',
  boundaryField: 'Air_Distri',
  boundaryValue: 'BAY AREA AQMD',
  regionId: 'baaqmd',
  regionLabel: 'Bay Area Air Quality Management District',

  // Canonical native-lattice grid (decided 2026-07-20). Exact crs +
  // crsTransform everywhere; no scale argument; no reproject(); no
  // reduceResolution(); no bestEffort; no interpolation.
  canonicalCrs: 'EPSG:4326',
  canonicalTransform: [0.01, 0, -180, 0, 0.01, -90],
  maxPixels: 1e10,

  // Accepted 08a v2 pixel-grid compatibility tolerances.
  scaleShearTolerance: 1e-9,
  pixelOffsetTolerance: 1e-6,

  baselinePriorYears: 3,
  methodIds: {
    regionalStatistic: 'canonical_native_lattice',
    baseline: 'previous_three_same_calendar_years_pooled_monthly_median',
    mapLayer: 'signed_column_anomaly'
  },
  baselineMethodText:
      'Median of all valid daily BAAQMD regional means from the same ' +
      'calendar month in the previous three years; every requested ' +
      'prior year must contribute at least one valid same-month ' +
      'value; signed anomaly = target − median; percentile = share ' +
      'of historical values <= target. Exploratory rolling ' +
      'comparison, not a homogeneous long-term trend.',

  // Provisional five-stop diverging palette for the first slice
  // (display convention only — not a threshold).
  paletteStops: ['2166ac', '67a9cf', 'f7f7f7', 'ef8a62', 'b2182b'],
  visualizationDescription:
      'Per-date symmetric robust display stretch (max(|p2|, |p98|) ' +
      'of the anomaly within BAAQMD); not a threshold, and colour ' +
      'intensity is not directly comparable across dates.',
  attribution: 'Contains modified Copernicus Sentinel data',

  missingToken: '(missing)',

  freshnessNote:
      'OFFL products publish with latency; multi-day delays are ' +
      'normal. The newest represented local date is conservatively ' +
      'excluded because its ingestion may still be partial, so the ' +
      'latest selectable date is the day before it.',
  scientificDisclaimer:
      'Sentinel-5P measures a tropospheric vertical NO₂ column, not ' +
      'the air at ground level. Nothing in this response is a ' +
      'surface concentration, an AQI value, health advice, or an ' +
      'episode classification. The 0.01° display grid is oversampled ' +
      'relative to the TROPOMI sensor footprint; neighbouring cells ' +
      'are not independent 1 km observations.',

  /*
   * Timeout budget (documented contract; the frontend's outer
   * timeouts in app/frontend/public/app.js are deliberately LONGER
   * than every bound here):
   *   /api/context   <= contextTimeoutMs           (60 s)
   *   /api/boundary  <= boundaryTimeoutMs          (90 s)
   *   /api/analysis  <= contextTimeoutMs (upper-bound lookup when the
   *                     context cache is cold) + analysisDeadlineMs
   *                     = 540 s worst case.
   * analysisDeadlineMs is ONE overall deadline for the whole analysis
   * pipeline: every sub-operation below keeps its own smaller cap but
   * is clamped to the time remaining under the deadline, so the
   * independent sequential sub-timeouts (60+60+240+120+60 s) can never
   * total more than the deadline. The analysis evaluation covers ~90
   * historical daily reductions in one request; cold-cache requests
   * may legitimately take minutes — caching (below) and, later,
   * precomputation are the documented mitigations.
   */
  contextTimeoutMs: 60000,
  boundaryTimeoutMs: 90000,
  analysisDeadlineMs: 480000,
  signatureTimeoutMs: 60000,
  analysisTimeoutMs: 240000,
  visualizationTimeoutMs: 120000,
  mapTimeoutMs: 60000,

  contextTtlMs: 5 * 60 * 1000,
  analysisTtlMs: 60 * 60 * 1000,
  analysisMaxEntries: 20
};

/* ----------------------------------------------------------- PURE HELPERS */
/* Exported for the built-in node:test suite (helpers.test.js). */

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var DAY_MS = 86400000;

function isValidDateString(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  var ms = Date.parse(s + 'T00:00:00Z');
  if (isNaN(ms)) return false;
  // Round-trip guard: rejects 2026-02-31 style dates.
  return utcDateString(ms) === s;
}

function utcDateString(ms) {
  var d = new Date(ms);
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : String(m)) +
      '-' + (day < 10 ? '0' + day : String(day));
}

function previousDateString(s) {
  return utcDateString(Date.parse(s + 'T00:00:00Z') - DAY_MS);
}

function nextDateString(s) {
  return utcDateString(Date.parse(s + 'T00:00:00Z') + DAY_MS);
}

// Inclusive range check on ISO date strings (lexicographic-safe).
function isWithinRange(s, minInclusive, maxInclusive) {
  return s >= minInclusive && s <= maxInclusive;
}

// Every local calendar date string of one calendar month.
function monthDateStrings(year, month) {
  var out = [];
  var cursor = Date.UTC(year, month - 1, 1);
  while (new Date(cursor).getUTCMonth() === month - 1) {
    out.push(utcDateString(cursor));
    cursor += DAY_MS;
  }
  return out;
}

function median(values) {
  if (!values || values.length === 0) return null;
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] :
      (sorted[mid - 1] + sorted[mid]) / 2;
}

// 100 * count(values <= target) / count — the adopted <= convention.
function percentileLeq(values, target) {
  if (!values || values.length === 0 || target === null ||
      target === undefined) {
    return null;
  }
  var count = 0;
  for (var i = 0; i < values.length; i++) {
    if (values[i] <= target) count += 1;
  }
  return 100 * count / values.length;
}

// Symmetric display range around zero from robust percentiles; null
// when no valid range exists (degenerate or missing input).
function symmetricRange(p2, p98) {
  if (p2 === null || p2 === undefined || p98 === null ||
      p98 === undefined) {
    return null;
  }
  var r = Math.max(Math.abs(p2), Math.abs(p98));
  return r > 0 ? r : null;
}

/*
 * Bounded in-memory cache: max entries with insertion-order eviction
 * plus per-entry TTL. No persistence, no database (decided for this
 * slice). `now` is injectable for tests.
 */
function createBoundedCache(maxEntries, ttlMs, now) {
  var clock = now || function () { return Date.now(); };
  var map = new Map();
  return {
    get: function (key) {
      var entry = map.get(key);
      if (!entry) return undefined;
      if (clock() - entry.at > ttlMs) {
        map.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set: function (key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, {at: clock(), value: value});
      while (map.size > maxEntries) {
        map.delete(map.keys().next().value); // oldest insertion
      }
    },
    size: function () { return map.size; }
  };
}

/*
 * Overall-deadline budget for one analysis request. Returns a function
 * that clamps each sub-operation's own timeout to the time remaining
 * before the deadline (<= 0 means the deadline is exhausted and the
 * sub-operation must not start). `now` is injectable for tests.
 */
function createDeadlineBudget(totalMs, now) {
  var clock = now || function () { return Date.now(); };
  var deadlineAt = clock() + totalMs;
  return function (subOpMs) {
    var remaining = deadlineAt - clock();
    return remaining < subOpMs ? remaining : subOpMs;
  };
}

// The accepted 08a v2 pixel-grid compatibility rule, applied to a
// numeric projection info object {crs, transform} against the
// canonical grid. Returns {compatible, reason}.
function canonicalGridCheck(projInfo) {
  var crs = projInfo && (projInfo.crs || projInfo.wkt);
  var t = projInfo && projInfo.transform;
  if (!t || t.length !== 6) {
    return {compatible: false,
            reason: 'numeric affine transform unavailable'};
  }
  if (crs !== CONSTANTS.canonicalCrs) {
    return {compatible: false, reason: 'CRS differs (' + crs + ')'};
  }
  var c = CONSTANTS.canonicalTransform;
  var tolScale = CONSTANTS.scaleShearTolerance;
  var tolPix = CONSTANTS.pixelOffsetTolerance;
  if (Math.abs(t[0] - c[0]) > tolScale ||
      Math.abs(t[4] - c[4]) > tolScale) {
    return {compatible: false, reason: 'scale differs'};
  }
  if (Math.abs(t[1] - c[1]) > tolScale ||
      Math.abs(t[3] - c[3]) > tolScale) {
    return {compatible: false, reason: 'shear differs'};
  }
  var dx = (t[2] - c[2]) / c[0];
  var dy = (t[5] - c[5]) / c[4];
  if (Math.abs(dx - Math.round(dx)) > tolPix ||
      Math.abs(dy - Math.round(dy)) > tolPix) {
    return {compatible: false,
            reason: 'origin is not an integer pixel offset from the ' +
                'canonical grid'};
  }
  return {compatible: true,
          reason: 'integer-pixel shift of the canonical grid'};
}

/* ------------------------------------------------------ EE GRAPH BUILDERS */

var boundaryGraphCache = null;

// The official BAAQMD boundary as a server-side graph (dissolved to a
// single feature). NO county fallback exists in the production API: a
// boundary-read failure surfaces as an upstream error.
function boundaryCollection() {
  if (boundaryGraphCache === null) {
    boundaryGraphCache = ee.FeatureCollection(CONSTANTS.boundaryAssetId)
        .filter(ee.Filter.eq(CONSTANTS.boundaryField,
            CONSTANTS.boundaryValue))
        .union(1);
  }
  return boundaryGraphCache;
}

function boundaryGeometry() {
  return boundaryCollection().geometry();
}

// Raw selected-band assets whose system:time_start falls on one local
// calendar date (end exclusive). Used for the reported source-asset
// count and the per-date projection-signature audit. filterBounds is
// footprint intersection only — never contribution (exploration 04
// rule).
function loadRawForDate(dateStr, geom) {
  return ee.ImageCollection(CONSTANTS.datasetId)
      .select(CONSTANTS.bandName)
      .filterDate(ee.Date(dateStr, CONSTANTS.timeZone),
          ee.Date(nextDateString(dateStr), CONSTANTS.timeZone))
      .filterBounds(geom);
}

// Raw selected-band assets for the three-local-day window centred on
// one local calendar date (end exclusive). The window is one day wider
// on each side so that a product whose member assets straddle local
// midnight is still grouped WHOLE before its local date is decided:
// the product's local date comes from its EARLIEST member timestamp
// (accepted daily rule, scripts 04–06), never from per-asset date
// filtering. One orbit product spans far less than a day, so ±1 day
// always contains every member of every product assigned to the date.
function loadRawAroundDate(dateStr, geom) {
  return ee.ImageCollection(CONSTANTS.datasetId)
      .select(CONSTANTS.bandName)
      .filterDate(
          ee.Date(previousDateString(dateStr), CONSTANTS.timeZone),
          ee.Date(nextDateString(nextDateString(dateStr)),
              CONSTANTS.timeZone))
      .filterBounds(geom);
}

function propOrMissing(image, name) {
  image = ee.Image(image);
  return ee.Algorithms.If(
      image.propertyNames().contains(name),
      image.get(name),
      CONSTANTS.missingToken);
}

// DISPLAY-ONLY boundary clip: masks every pixel outside the official
// BAAQMD geometry so rendered map tiles stop at the jurisdiction.
// Applied exclusively to the image handed to the tile service — never
// to the images used for regional statistics, the baseline, or the
// visualization percentiles, which all stay un-clipped. No buffering,
// no simplification, no value change, no interpolation. Kept as a
// named helper so the display path is testable apart from the
// scientific path.
function clipForDisplay(image, geometry) {
  return image.clip(geometry);
}

// Fully masked placeholder so a zero-product date still yields a
// well-formed zero-valid-area reduction. No interpolation anywhere.
function placeholderImage() {
  return ee.Image.constant(0).double()
      .rename(CONSTANTS.bandName)
      .updateMask(ee.Image.constant(0));
}

// Binary valid-pixel mask. .gt(0) applies to image.mask() — never the
// measurement — so valid NEGATIVE retrievals count as valid pixels.
function binaryValidMask(image) {
  return image.mask().gt(0).rename('valid_mask').unmask(0, false);
}

// valid_area_m2 = pixelArea x mask; weighted_no2 = unmasked NO2 x
// pixelArea x mask (valid negatives preserved).
function contributionBands(image) {
  var pixelArea = ee.Image.pixelArea();
  var validMask = binaryValidMask(image);
  return pixelArea.multiply(validMask).rename('valid_area_m2')
      .addBands(image.unmask(0, false).multiply(pixelArea)
          .multiply(validMask).rename('weighted_no2'));
}

// One reduction over the canonical native lattice — the decided
// production configuration (exact crs + crsTransform, no scale).
function canonicalSums(image, geom) {
  return contributionBands(image).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: geom,
    crs: CONSTANTS.canonicalCrs,
    crsTransform: CONSTANTS.canonicalTransform,
    maxPixels: CONSTANTS.maxPixels
  });
}

function areaWeightedMean(sums) {
  var validArea = ee.Number(sums.get('valid_area_m2'));
  return ee.Algorithms.If(
      validArea.gt(0),
      ee.Number(sums.get('weighted_no2')).divide(validArea),
      null);
}

// Defensive PRODUCT_ID reconstruction (scripts 04–06 rule): only
// same-PRODUCT_ID assets are mosaicked; the EARLIEST member timestamp
// determines the product's local date; only products whose local date
// equals the requested date are kept (the raw window is one local day
// wider on each side, so midnight-straddling members are never split
// across dates); canonical default projection assigned to every
// product mosaic. withAudit adds the per-product valid-area and
// quality metadata the target date needs for contributor/non-NOMINAL
// reporting — the audit reduction runs only on the date's own
// products, never on the neighbouring days' groups.
function buildDateProducts(dateStr, geom, withAudit) {
  var raw = loadRawAroundDate(dateStr, geom);
  var ids = ee.List(raw.aggregate_array('PRODUCT_ID')).distinct();
  var images = ids.map(function (pid) {
    var members = raw.filter(ee.Filter.eq('PRODUCT_ID', pid));
    var first = ee.Image(members.first());
    var t0 = members.aggregate_min('system:time_start');
    var image = ee.Image(members.mosaic()
        .setDefaultProjection({
          crs: CONSTANTS.canonicalCrs,
          crsTransform: CONSTANTS.canonicalTransform
        })
        .copyProperties(first));
    var props = {
      PRODUCT_ID: pid,
      'system:time_start': t0,
      local_date: ee.Date(t0).format('yyyy-MM-dd', CONSTANTS.timeZone),
      meta_orbit: ee.Algorithms.String(propOrMissing(first, 'ORBIT'))
    };
    if (withAudit) {
      // The exact PRODUCT_QUALITY convention of the tracked scripts:
      // the raw property, '(missing)' when absent; never invented.
      props.meta_quality = ee.Algorithms.String(
          propOrMissing(first, 'PRODUCT_QUALITY'));
    }
    return image.set(props);
  });
  var dateProducts = ee.ImageCollection.fromImages(images)
      .filter(ee.Filter.eq('local_date', dateStr));
  if (withAudit) {
    dateProducts = dateProducts.map(function (image) {
      image = ee.Image(image);
      return image.set('valid_area_m2', ee.Number(ee.Image.pixelArea()
          .multiply(binaryValidMask(image))
          .rename('valid_area_m2')
          .reduceRegion({
            reducer: ee.Reducer.sum(),
            geometry: geom,
            crs: CONSTANTS.canonicalCrs,
            crsTransform: CONSTANTS.canonicalTransform,
            maxPixels: CONSTANTS.maxPixels
          }).get('valid_area_m2')));
    });
  }
  return dateProducts;
}

// Same-local-date arithmetic-mean composite on the canonical lattice.
function dailyComposite(dateStr, geom) {
  var products = buildDateProducts(dateStr, geom, false);
  return ee.Image(ee.Algorithms.If(
      products.size().gt(0),
      products.mean().setDefaultProjection({
        crs: CONSTANTS.canonicalCrs,
        crsTransform: CONSTANTS.canonicalTransform
      }),
      placeholderImage()));
}

// Daily valid regional mean (or null) — the baseline's historical
// daily value, computed exactly like the target's regional statistic.
function dailyMeanGraph(dateStr, geom) {
  return areaWeightedMean(canonicalSums(dailyComposite(dateStr, geom),
      geom));
}

/* ------------------------------------------------------------ CACHES */

var contextCache = createBoundedCache(1, CONSTANTS.contextTtlMs);
var analysisCache = createBoundedCache(CONSTANTS.analysisMaxEntries,
    CONSTANTS.analysisTtlMs);
var boundaryGeoJsonCache = null;        // process lifetime
var totalAreaCache = null;              // process lifetime (m^2)
var signatureVerdicts = new Map();      // exact signature -> verdict

/* -------------------------------------------------------- CONTEXT (/api) */

function getContext() {
  var cached = contextCache.get('context');
  if (cached) return Promise.resolve(cached);

  var latestGraph = ee.Date(
      ee.ImageCollection(CONSTANTS.datasetId)
          .filterBounds(boundaryGeometry())
          .aggregate_max('system:time_start'))
      .format('yyyy-MM-dd', CONSTANTS.timeZone);

  return eeClient.evaluate(latestGraph, 'Context date lookup',
      CONSTANTS.contextTimeoutMs).then(function (latestRepresented) {
    var lastIncluded = previousDateString(latestRepresented);
    var context = {
      ok: true,
      dataset: {
        id: CONSTANTS.datasetId,
        band: CONSTANTS.bandName,
        label: CONSTANTS.datasetLabel,
        unit: CONSTANTS.unit,
        timezone: CONSTANTS.timeZone,
        collectionStartLocalDate: CONSTANTS.collectionStartLocalDate
      },
      availability: {
        latestRepresentedLocalDate: latestRepresented,
        lastIncludedLocalDate: lastIncluded,
        defaultLocalDate: lastIncluded,
        freshnessNote: CONSTANTS.freshnessNote
      },
      region: {
        id: CONSTANTS.regionId,
        label: CONSTANTS.regionLabel,
        boundaryAvailable: true
      },
      methods: CONSTANTS.methodIds,
      disclaimer: CONSTANTS.scientificDisclaimer
    };
    contextCache.set('context', context);
    return context;
  });
}

/* ------------------------------------------------------- BOUNDARY (/api) */

function getBoundary() {
  if (boundaryGeoJsonCache) return Promise.resolve(boundaryGeoJsonCache);
  return eeClient.evaluate(boundaryCollection(),
      'Boundary geometry lookup',
      CONSTANTS.boundaryTimeoutMs).then(function (fc) {
    if (!fc || !fc.features || fc.features.length === 0) {
      throw eeClient.makeError('upstream',
          'The boundary filter matched no features.');
    }
    var response = {
      ok: true,
      region: {
        id: CONSTANTS.regionId,
        label: CONSTANTS.regionLabel,
        sourceAsset: CONSTANTS.boundaryAssetId,
        filter: CONSTANTS.boundaryField + ' == "' +
            CONSTANTS.boundaryValue + '"'
      },
      geojson: {
        type: 'FeatureCollection',
        features: fc.features.map(function (f) {
          return {type: 'Feature', geometry: f.geometry, properties: {}};
        })
      },
      disclaimer: CONSTANTS.scientificDisclaimer
    };
    boundaryGeoJsonCache = response;
    return response;
  });
}

/* ------------------------------------------------- PROJECTION SIGNATURES */

// Distinct exact projection signatures of one date's assets, then a
// Node-side compatibility classification (verdicts cached for the
// process lifetime — the record has held one compatible lattice, but
// the check is still enforced per selected TARGET date, and a
// genuinely incompatible date is refused, never silently continued.
// Historical baseline days are not re-checked per day: they rely on
// the audited single-lattice record — a disclosed limitation).
// evalStep is the deadline-clamped evaluate wrapper from getAnalysis.
function checkDateProjections(dateStr, geom, evalStep) {
  var raw = loadRawForDate(dateStr, geom);
  var tagged = raw.map(function (image) {
    image = ee.Image(image);
    var proj = image.projection();
    var crsValue = ee.String(ee.Algorithms.If(
        ee.Algorithms.IsEqual(proj.crs(), null),
        proj.wkt(), proj.crs()));
    return image.set('projection_signature',
        crsValue.cat(' | ').cat(ee.String(proj.transform())));
  });
  var signaturesGraph = ee.List(
      tagged.aggregate_array('projection_signature')).distinct().sort();

  return evalStep(signaturesGraph,
      'Projection signature lookup',
      CONSTANTS.signatureTimeoutMs).then(function (signatures) {
    var unknown = signatures.filter(function (s) {
      return !signatureVerdicts.has(s);
    });
    var lookups = unknown.map(function (s) {
      var rep = ee.Image(tagged
          .filter(ee.Filter.eq('projection_signature', s)).first())
          .projection();
      return evalStep(rep,
          'Representative projection lookup',
          CONSTANTS.signatureTimeoutMs).then(function (info) {
        signatureVerdicts.set(s, canonicalGridCheck(info));
      });
    });
    return Promise.all(lookups).then(function () {
      var incompatible = signatures.filter(function (s) {
        return !signatureVerdicts.get(s).compatible;
      });
      return {
        signatures: signatures,
        compatible: incompatible.length === 0,
        incompatibleReasons: incompatible.map(function (s) {
          return signatureVerdicts.get(s).reason;
        })
      };
    });
  });
}

/* ----------------------------------------------------- ANALYSIS (/api) */

// evalStep is the deadline-clamped evaluate wrapper from getAnalysis.
// The cache stores only the resolved VALUE, never a promise, so a
// transient failure is never retained — the next request retries.
function getTotalAreaM2(geom, evalStep) {
  if (totalAreaCache !== null) return Promise.resolve(totalAreaCache);
  var graph = ee.Image.pixelArea().rename('area').reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: geom,
    crs: CONSTANTS.canonicalCrs,
    crsTransform: CONSTANTS.canonicalTransform,
    maxPixels: CONSTANTS.maxPixels
  });
  return evalStep(ee.Number(graph.get('area')),
      'Total region area',
      CONSTANTS.contextTimeoutMs).then(function (area) {
    totalAreaCache = area;
    return area;
  });
}

function requestedPriorYears(targetYear) {
  var out = [];
  for (var k = 1; k <= CONSTANTS.baselinePriorYears; k++) {
    out.push(targetYear - k);
  }
  return out; // descending: [y-1, y-2, y-3]
}

// Maps the tracked scripts' PRODUCT_QUALITY convention onto the
// response status, keeping three concepts DISTINCT for contributing
// products:
//   explicit 'NOMINAL'                      -> known nominal;
//   explicit, present value != 'NOMINAL'    -> non-NOMINAL (flagged);
//   property absent or null ('(missing)')   -> UNKNOWN — reported as
//                                              unknown, never counted
//                                              as non-NOMINAL.
// All products are retained regardless: no exclusion rule exists.
function qualitySummary(contributorQualities) {
  var qualities = contributorQualities || [];
  function isUnknown(q) {
    return q === CONSTANTS.missingToken || q === null ||
        q === undefined;
  }
  var nonNominalCount = qualities.filter(function (q) {
    return !isUnknown(q) && q !== 'NOMINAL';
  }).length;
  var unknownCount = qualities.filter(isUnknown).length;
  var status;
  if (nonNominalCount > 0) {
    status = 'non_nominal';
  } else if (qualities.length === 0 || unknownCount > 0) {
    status = 'unknown';
  } else {
    status = 'nominal';
  }
  return {
    status: status,
    hasNonNominalContributors: nonNominalCount > 0,
    nonNominalProductCount: nonNominalCount,
    unknownProductQualityCount: unknownCount
  };
}

function datasetBlock() {
  return {
    id: CONSTANTS.datasetId,
    band: CONSTANTS.bandName,
    label: CONSTANTS.datasetLabel,
    unit: CONSTANTS.unit,
    timezone: CONSTANTS.timeZone
  };
}

/*
 * The full one-date analysis. Round trips (each async with its own
 * sub-operation timeout, clamped to the single overall
 * analysisDeadlineMs): projection signatures (fast) [+ rare
 * representative lookups], the main statistics dictionary (target
 * observation + ~three months of historical daily means — the heavy
 * request), the anomaly visualization percentiles, and the tile URL.
 * Successful responses are cached (bounded, TTL) keyed by date; a
 * response whose visualization or tile stage failed is NOT cached.
 */
function getAnalysis(dateStr) {
  var cached = analysisCache.get(dateStr);
  if (cached) return Promise.resolve(cached);

  var geom = boundaryGeometry();
  var targetYear = Number(dateStr.slice(0, 4));
  var targetMonth = Number(dateStr.slice(5, 7));
  var priorYears = requestedPriorYears(targetYear);

  // One deadline for the whole pipeline; each round trip keeps its own
  // smaller cap but never exceeds the time remaining.
  var budget = createDeadlineBudget(CONSTANTS.analysisDeadlineMs);
  function evalStep(graph, label, subOpMs) {
    var ms = budget(subOpMs);
    if (ms <= 0) {
      return Promise.reject(eeClient.makeError('timeout', label +
          ' was not attempted: the overall analysis deadline (' +
          CONSTANTS.analysisDeadlineMs + ' ms) is exhausted.'));
    }
    return eeClient.evaluate(graph, label, ms);
  }

  return checkDateProjections(dateStr, geom,
      evalStep).then(function (projection) {
    if (!projection.compatible) {
      // Refused, never silently continued: regional and map outputs
      // are null/unavailable and the reasons are reported.
      var refused = assembleResponse(dateStr, {
        observationStatus: 'projection_incompatible',
        projectionStatus: 'incompatible',
        projectionDetail: projection.incompatibleReasons.join('; '),
        counts: null,
        quality: qualitySummary([]),
        regionalMean: null,
        validAreaFraction: null,
        baseline: {
          status: 'target_unavailable',
          requestedPriorYears: priorYears,
          contributingPriorYears: null,
          historicalSampleCount: null,
          historicalMedianNo2: null,
          signedAnomalyNo2: null,
          percentile: null
        },
        map: {status: 'projection_incompatible'}
      });
      analysisCache.set(dateStr, refused);
      return refused;
    }

    // Main statistics request: target-date audit plus the per-day
    // historical regional means for the same calendar month of the
    // three requested prior years.
    var products = buildDateProducts(dateStr, geom, true);
    var composite = ee.Image(ee.Algorithms.If(
        products.size().gt(0),
        products.mean().setDefaultProjection({
          crs: CONSTANTS.canonicalCrs,
          crsTransform: CONSTANTS.canonicalTransform
        }),
        placeholderImage()));
    var sums = canonicalSums(composite, geom);
    var contributors = products
        .filter(ee.Filter.gt('valid_area_m2', 0));

    var historyDayLists = priorYears.map(function (y) {
      return monthDateStrings(y, targetMonth);
    });
    var mainGraph = ee.Dictionary({
      dayAssetCount: loadRawForDate(dateStr, geom).size(),
      productCount: products.size(),
      orbitCount: ee.List(products
          .aggregate_array('meta_orbit')).distinct().size(),
      contributorQualities:
          contributors.aggregate_array('meta_quality'),
      targetValidArea: sums.get('valid_area_m2'),
      targetMean: areaWeightedMean(sums),
      histMeans: ee.List(historyDayLists.map(function (days) {
        return ee.List(days.map(function (d) {
          return dailyMeanGraph(d, geom);
        }));
      }))
    });

    return Promise.all([
      evalStep(mainGraph, 'Daily analysis',
          CONSTANTS.analysisTimeoutMs),
      getTotalAreaM2(geom, evalStep)
    ]).then(function (results) {
      var info = results[0];
      var totalArea = results[1];

      // ---- observation (Node-side status mapping; nulls stay null).
      var counts = {
        sourceAssetCount: info.dayAssetCount,
        distinctProductCount: info.productCount,
        distinctOrbitCount: info.orbitCount
      };
      var quality = qualitySummary(info.contributorQualities);
      var observationStatus;
      var regionalMean = null;
      var validAreaFraction;
      if (info.productCount === 0) {
        observationStatus = 'no_products';
        validAreaFraction = 0;
      } else if (!(info.targetValidArea > 0)) {
        observationStatus = 'no_valid_retrieval';
        validAreaFraction = 0;
      } else {
        observationStatus = 'available';
        regionalMean = info.targetMean;
        validAreaFraction = info.targetValidArea / totalArea;
      }

      // ---- baseline (adopted policy, Node-side from the pooled
      // valid daily means).
      var perYearValid = info.histMeans.map(function (yearMeans) {
        return yearMeans.filter(function (v) {
          return v !== null && v !== undefined;
        });
      });
      var contributingYears = priorYears.filter(function (y, idx) {
        return perYearValid[idx].length > 0;
      });
      var pooled = [];
      perYearValid.forEach(function (arr) {
        pooled = pooled.concat(arr);
      });
      var windowComplete =
          contributingYears.length === CONSTANTS.baselinePriorYears;
      var baseline = {
        requestedPriorYears: priorYears,
        contributingPriorYears: contributingYears,
        historicalSampleCount: pooled.length,
        historicalMedianNo2: null,
        signedAnomalyNo2: null,
        percentile: null
      };
      if (!windowComplete) {
        baseline.status = 'partial_window';
      } else if (observationStatus !== 'available') {
        baseline.status = 'target_unavailable';
        baseline.historicalMedianNo2 = median(pooled);
      } else {
        baseline.status = 'available';
        baseline.historicalMedianNo2 = median(pooled);
        baseline.signedAnomalyNo2 =
            regionalMean - baseline.historicalMedianNo2;
        baseline.percentile = percentileLeq(pooled, regionalMean);
      }

      // ---- map branch.
      var mapStatus;
      if (observationStatus === 'no_products') {
        mapStatus = 'no_products';
      } else if (observationStatus === 'no_valid_retrieval') {
        mapStatus = 'no_valid_retrieval';
      } else if (!windowComplete) {
        mapStatus = 'baseline_unavailable';
      } else {
        mapStatus = 'available';
      }

      var base = {
        observationStatus: observationStatus,
        projectionStatus: 'compatible',
        projectionDetail: null,
        counts: counts,
        quality: quality,
        regionalMean: regionalMean,
        validAreaFraction: validAreaFraction,
        baseline: baseline,
        map: {
          status: mapStatus,
          baselineStatus: baseline.status,
          historicalDailyImageCount: pooled.length,
          hasNonNominalContributors: quality.hasNonNominalContributors
        }
      };

      if (mapStatus !== 'available') {
        var unavailable = assembleResponse(dateStr, base);
        analysisCache.set(dateStr, unavailable);
        return unavailable;
      }

      // ---- anomaly image + per-date robust symmetric stretch + tile
      // URL. The pixelwise historical median ignores masked (invalid)
      // days by construction; year representation was verified above.
      var allHistoryDays = [];
      historyDayLists.forEach(function (days) {
        allHistoryDays = allHistoryDays.concat(days);
      });
      var historicalMedianImage = ee.ImageCollection.fromImages(
          allHistoryDays.map(function (d) {
            return dailyComposite(d, geom);
          })).median().setDefaultProjection({
            crs: CONSTANTS.canonicalCrs,
            crsTransform: CONSTANTS.canonicalTransform
          });
      var anomalyImage = dailyComposite(dateStr, geom)
          .subtract(historicalMedianImage)
          .rename('anomaly')
          .setDefaultProjection({
            crs: CONSTANTS.canonicalCrs,
            crsTransform: CONSTANTS.canonicalTransform
          });
      var percentilesGraph = anomalyImage.reduceRegion({
        reducer: ee.Reducer.percentile([2, 98]),
        geometry: geom,
        crs: CONSTANTS.canonicalCrs,
        crsTransform: CONSTANTS.canonicalTransform,
        maxPixels: CONSTANTS.maxPixels
      });

      return evalStep(percentilesGraph,
          'Anomaly visualization percentiles',
          CONSTANTS.visualizationTimeoutMs).then(function (pct) {
        var range = symmetricRange(pct ? pct.anomaly_p2 : null,
            pct ? pct.anomaly_p98 : null);
        if (range === null) {
          base.map.status = 'visualization_unavailable';
          var noVis = assembleResponse(dateStr, base);
          analysisCache.set(dateStr, noVis);
          return noVis;
        }
        // The tile service receives the CLIPPED display image; the
        // statistics and the percentiles above used the un-clipped
        // anomalyImage. Clipping changes rendered extent only.
        var anomalyDisplayImage = clipForDisplay(anomalyImage, geom);
        var tileMs = budget(CONSTANTS.mapTimeoutMs);
        var tilePromise = tileMs > 0 ?
            eeClient.getMapUrl(anomalyDisplayImage, {
              min: -range,
              max: range,
              palette: CONSTANTS.paletteStops
            }, 'Anomaly tile URL', tileMs) :
            Promise.reject(eeClient.makeError('timeout',
                'Anomaly tile URL was not attempted: the overall ' +
                'analysis deadline (' + CONSTANTS.analysisDeadlineMs +
                ' ms) is exhausted.'));
        return tilePromise.then(function (tileUrl) {
          base.map.tileUrlTemplate = tileUrl;
          base.map.visualization = {
            min: -range,
            max: range,
            paletteStops: CONSTANTS.paletteStops,
            description: CONSTANTS.visualizationDescription
          };
          var full = assembleResponse(dateStr, base);
          analysisCache.set(dateStr, full);
          return full;
        }).catch(function (mapError) {
          // Observation and baseline stand; only the map failed.
          base.map.status = 'upstream_error';
          base.map.warning = 'The anomaly tile request failed: ' +
              (mapError && mapError.message || mapError);
          return assembleResponse(dateStr, base); // not cached
        });
      }, function (visError) {
        // Percentile-stage failure (timeout or upstream): observation
        // and baseline stand; only the map visualization failed. The
        // response is NOT cached, so a retry recomputes the map.
        base.map.status = 'upstream_error';
        base.map.warning = 'The anomaly visualization request ' +
            'failed: ' + (visError && visError.message || visError);
        return assembleResponse(dateStr, base);
      });
    });
  });
}

// Builds the documented /api/analysis response shape from the
// internal pieces. Numeric nulls remain JSON null — never zero.
function assembleResponse(dateStr, parts) {
  var counts = parts.counts || {
    sourceAssetCount: null,
    distinctProductCount: null,
    distinctOrbitCount: null
  };
  var mapBlock = {
    status: parts.map.status,
    layerType: CONSTANTS.methodIds.mapLayer,
    localDate: dateStr,
    unit: CONSTANTS.unit,
    baselineStatus: parts.baseline.status,
    requestedPriorYears: parts.baseline.requestedPriorYears,
    contributingPriorYears: parts.baseline.contributingPriorYears,
    historicalDailyImageCount:
        parts.map.historicalDailyImageCount !== undefined ?
            parts.map.historicalDailyImageCount :
            parts.baseline.historicalSampleCount,
    tileUrlTemplate: parts.map.tileUrlTemplate || null,
    visualization: parts.map.visualization || null,
    attribution: CONSTANTS.attribution,
    hasNonNominalContributors:
        parts.quality.hasNonNominalContributors,
    warning: parts.map.warning || null,
    disclaimer: CONSTANTS.scientificDisclaimer
  };
  return {
    ok: true,
    localDate: dateStr,
    dataset: datasetBlock(),
    observation: {
      status: parts.observationStatus,
      hasValidValue: parts.observationStatus === 'available',
      regionalMeanNo2: parts.regionalMean,
      validAreaFraction: parts.validAreaFraction,
      sourceAssetCount: counts.sourceAssetCount,
      distinctProductCount: counts.distinctProductCount,
      distinctOrbitCount: counts.distinctOrbitCount,
      hasNonNominalContributors:
          parts.quality.hasNonNominalContributors,
      nonNominalProductCount: parts.quality.nonNominalProductCount,
      unknownProductQualityCount:
          parts.quality.unknownProductQualityCount,
      productQualityStatus: parts.quality.status,
      projectionCompatibilityStatus: parts.projectionStatus,
      projectionCompatibilityDetail: parts.projectionDetail
    },
    baseline: {
      status: parts.baseline.status,
      requestedPriorYears: parts.baseline.requestedPriorYears,
      contributingPriorYears: parts.baseline.contributingPriorYears,
      historicalSampleCount: parts.baseline.historicalSampleCount,
      historicalMedianNo2: parts.baseline.historicalMedianNo2,
      signedAnomalyNo2: parts.baseline.signedAnomalyNo2,
      percentile: parts.baseline.percentile,
      method: CONSTANTS.baselineMethodText
    },
    map: mapBlock,
    disclaimer: CONSTANTS.scientificDisclaimer
  };
}

module.exports = {
  CONSTANTS: CONSTANTS,
  getContext: getContext,
  getBoundary: getBoundary,
  getAnalysis: getAnalysis,
  // Pure helpers, exported for helpers.test.js.
  _pure: {
    isValidDateString: isValidDateString,
    previousDateString: previousDateString,
    nextDateString: nextDateString,
    isWithinRange: isWithinRange,
    monthDateStrings: monthDateStrings,
    median: median,
    percentileLeq: percentileLeq,
    symmetricRange: symmetricRange,
    createBoundedCache: createBoundedCache,
    createDeadlineBudget: createDeadlineBudget,
    canonicalGridCheck: canonicalGridCheck,
    qualitySummary: qualitySummary,
    clipForDisplay: clipForDisplay
  }
};
