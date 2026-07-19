/*
 * Bay Area Air Quality Episode Finder
 * Exploration 06 — exploratory same-calendar-month historical median
 * baseline and satellite-column anomaly visualization (Sentinel-5P OFFL
 * tropospheric NO2)
 *
 * Purpose: DATA EXPLORATION ONLY — the first script of the approved
 * "exploratory historical baseline and satellite-column anomaly
 * visualization" phase. Every result here is a SENTINEL-5P TROPOSPHERIC
 * NO2 SATELLITE-COLUMN result (mol/m^2). This script does NOT implement:
 * Episode Finder classification; AQI or health categories; ground-level
 * NO2 estimation; source attribution; persistence or event scoring;
 * monitor validation; meteorological analysis; or machine learning.
 *
 * Baseline (exploratory, NOT a final climatology): for every target Bay
 * Area local calendar date, the "Exploratory same-calendar-month
 * historical median baseline" uses daily images from the SAME calendar
 * month in the previous N years (N = Historical years control, 1–5;
 * only years earlier than the target year — never the target year or
 * future dates). All valid masked observations are retained regardless
 * of PRODUCT_QUALITY; no minimum valid-area-fraction threshold is
 * applied; valid negative retrievals are preserved.
 *
 * Anomaly language: a POSITIVE anomaly means the satellite-observed
 * tropospheric NO2 column was above its exploratory same-calendar-month
 * historical median. It is not an AQI value, health category, surface
 * concentration, or episode declaration. The 90th / 10th percentile
 * labels are descriptive references only.
 *
 * Foundations reused from the completed explorations 04–05: official
 * BAAQMD boundary handling; America/Los_Angeles local calendar dates
 * (start inclusive, end exclusive); latest-seven-available-local-days
 * dynamic default; defensive PRODUCT_ID reconstruction; pixel-wise
 * arithmetic mean of same-date orbit products with Earth Engine masks
 * ignoring non-contributing products; binary valid masks (.gt(0)) and
 * unmask(0, false) diagnostic bands; area-weighted BAAQMD regional
 * means with valid-area fractions; EPSG:3310 / 7000 m as
 * exploration-stage settings; strictly sequential evaluation with the
 * loading animation, progress text, disabled Update button, and
 * stale-request token protection.
 *
 * How to run: paste this file into the Earth Engine Code Editor
 * (https://code.earthengine.google.com) and click Run. Structured
 * output is printed to the Console.
 *
 * Project docs: https://github.com/perez-eduardo/Bay-Area-Air-Quality-Episode-Finder
 */

/* ------------------------------------------------------- DEFAULT DATE RANGE */

// Single dataset and timezone constants for the whole script
// (CONFIG.collectionId and CONFIG.timeZone reference them — no duplicate
// literals anywhere else).
var DATASET_ID = 'COPERNICUS/S5P/OFFL/L3_NO2';
var DEFAULT_TIME_ZONE = 'America/Los_Angeles';

// Documented start of OFFL NO2 availability (late June 2018). Baseline
// month-windows that end on or before this date are unavailable and are
// skipped with a warning (requested vs actual years reported).
var COLLECTION_START = '2018-06-28';

/*
 * Default range: the LATEST seven Bay Area local calendar days currently
 * represented in the OFFL collection (identical to the tested script 05
 * implementation). OFFL data has publication latency, so this is not
 * necessarily the previous seven real-world days. ES5-only; DST-safe via
 * the explicit timezone argument to ee.Date.advance(). One-time
 * synchronous metadata read at script load.
 */
function defaultLatestSevenDayRange() {
  var latestMillis = ee.ImageCollection(DATASET_ID)
      .aggregate_max('system:time_start');

  var latestLocalDateString = ee.Date(latestMillis)
      .format('yyyy-MM-dd', DEFAULT_TIME_ZONE);

  var latestLocalMidnight = ee.Date.parse(
      'yyyy-MM-dd',
      latestLocalDateString,
      DEFAULT_TIME_ZONE
  );

  var endDate = latestLocalMidnight.advance(
      1,
      'day',
      DEFAULT_TIME_ZONE
  );

  var startDate = endDate.advance(
      -7,
      'day',
      DEFAULT_TIME_ZONE
  );

  return ee.Dictionary({
    start: startDate.format('yyyy-MM-dd', DEFAULT_TIME_ZONE),
    end: endDate.format('yyyy-MM-dd', DEFAULT_TIME_ZONE),
    latestAvailableLocalDate: latestLocalDateString
  }).getInfo();
}

// Computed once, dynamically, when the script loads.
var DEFAULT_DATE_RANGE = defaultLatestSevenDayRange();

/* ------------------------------------------------------------------ CONFIG */

var CONFIG = {
  // Target period, 'YYYY-MM-DD' (start inclusive, end exclusive). DEFAULT
  // is dynamic: the latest seven Bay Area local calendar days available
  // in the OFFL collection (publication latency means these may not be
  // the previous seven real-world days). Editable; limited to at most
  // CONFIG.maxTargetDays calendar days for this exploration.
  startDate: DEFAULT_DATE_RANGE.start,
  endDate: DEFAULT_DATE_RANGE.end,

  // Historical years control: default / bounds (validated as an integer
  // from min to max inclusive).
  historicalYearsDefault: 3,
  historicalYearsMin: 1,
  historicalYearsMax: 5,

  // Maximum target-interval length in calendar days for this exploration.
  maxTargetDays: 31,

  // Official BAAQMD jurisdiction boundary asset (see
  // docs/data-sources.md); labeled county fallback below.
  boundaryAssetId:
      'projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries',
  boundaryField: 'Air_Distri',
  boundaryValue: 'BAY AREA AQMD',

  // First dataset (owner-decided) — the single DATASET_ID constant above.
  collectionId: DATASET_ID,
  bandName: 'tropospheric_NO2_column_number_density',

  // Calendar-day grouping and date labels use the Bay Area local time
  // zone — the single DEFAULT_TIME_ZONE constant above.
  timeZone: DEFAULT_TIME_ZONE,

  // Regional-statistics configuration: explicit equal-area CRS
  // (EPSG:3310, California Albers, meters) at an explicit 7000 m scale —
  // no bestEffort, no reproject(). EXPLORATION settings, not final
  // scientific choices.
  statsCrs: 'EPSG:3310',
  statsScale: 7000,

  // Target-period evaluation chunk length (sequential chunks, as tested
  // in script 05). Implementation setting only.
  evaluationChunkDays: 7,

  // Valid-fraction caution level inherited from the script 05 coverage
  // SENSITIVITY study. A caution label only — NOT an adopted exclusion
  // rule; nothing is blocked or excluded because of it.
  lowFractionCaution: 0.20,

  // Fixed NO2 display stretch (mol/m^2) shared by the target-period and
  // historical-baseline map layers — the established scripts 03–05
  // display scale. Display-only; not a threshold, AQI, or category.
  vis: {
    min: 0,
    max: 0.0002,
    palette: ['fff7ec', 'fee8c8', 'fdbb84', 'fc8d59', 'ef6548', 'd7301f',
              '990000']
  },

  // Symmetric diverging display stretch for the SIGNED satellite-column
  // anomaly layer: blue below the historical monthly median, white near
  // zero, red above. Display-only — not a scientific threshold.
  anomalyVis: {
    min: -0.00005,
    max: 0.00005,
    palette: ['2166ac', '92c5de', 'f7f7f7', 'f4a582', 'b2182b']
  },

  // Visibly contrasting sequential palette for the historical valid-day
  // COUNT layer (data availability, not pollution, not NO2 magnitude).
  // The display stretch spans the OBSERVED count range once it has been
  // fetched (display-only); the theoretical maximum remains
  // historicalYears × 31. Absolute integer counts are unchanged and
  // Inspector-accessible.
  countPalette: ['ffffd9', 'c7e9b4', '7fcdbb', '41b6c4', '225ea8',
                 '253494'],

  layerOpacity: 0.65
};

/* ------------------------------------------------------------ STUDY REGION */

/*
 * Returns {fc: ee.FeatureCollection, isApproximation: boolean}.
 *
 * Primary source: the uploaded official air-district boundaries asset
 * (CONFIG.boundaryAssetId), filtered to
 * CONFIG.boundaryField == CONFIG.boundaryValue and dissolved into a single
 * feature so the map shows one clean outer boundary with no internal lines.
 *
 * Fallback, used ONLY if that asset is unavailable (missing or not readable
 * by the running account): TIGER/2018 counties. APPROXIMATION — the official
 * jurisdiction covers all of seven counties plus only the SOUTHERN portions
 * of Solano and Sonoma; this fallback includes those two counties in full
 * and therefore overstates the jurisdiction's northern extent. The map
 * layer name, the side panel, and a console warning all say so.
 */
function officialBoundaryAvailable() {
  try {
    // Synchronous one-time metadata read at init; throws if the asset is
    // missing or not readable by the current user.
    ee.data.getAsset(CONFIG.boundaryAssetId);
    return true;
  } catch (e) {
    return false;
  }
}

function getStudyRegion() {
  if (officialBoundaryAvailable()) {
    var district = ee.FeatureCollection(CONFIG.boundaryAssetId)
        .filter(ee.Filter.eq(CONFIG.boundaryField, CONFIG.boundaryValue));
    district.size().evaluate(function (n) {
      if (n === 0) {
        print('Warning: the boundary filter matched no features — check ' +
              'CONFIG.boundaryField / CONFIG.boundaryValue.');
      }
    });
    // union() dissolves whatever matched into a single feature, removing
    // any internal borders from the outline.
    return {fc: district.union(1), isApproximation: false};
  }
  print('Official boundary asset unavailable — falling back to the ' +
        'county approximation of the BAAQMD jurisdiction.');
  var counties = ee.FeatureCollection('TIGER/2018/Counties')
      .filter(ee.Filter.eq('STATEFP', '06')) // California
      .filter(ee.Filter.inList('NAME', [
        'Alameda', 'Contra Costa', 'Marin', 'Napa', 'San Francisco',
        'San Mateo', 'Santa Clara', 'Solano', 'Sonoma'
      ]));
  return {fc: counties, isApproximation: true};
}

/* -------------------------------------------------------------------- DATA */

// startLocal / endLocal are ee.Date LOCAL-midnight instants (end
// exclusive). filterBounds means footprint intersection only — not valid
// contribution (established by exploration 04).
function loadRawCollection(regionGeom, startLocal, endLocal) {
  return ee.ImageCollection(CONFIG.collectionId)
      .select(CONFIG.bandName)
      .filterDate(startLocal, endLocal)
      .filterBounds(regionGeom);
}

// Total BAAQMD area (m^2), computed once per refresh at the explicit
// CONFIG.statsCrs / CONFIG.statsScale — no bestEffort, no reproject().
function computeTotalAreaM2(regionGeom) {
  return ee.Number(ee.Image.pixelArea().rename('area').reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: regionGeom,
    crs: CONFIG.statsCrs,
    scale: CONFIG.statsScale,
    maxPixels: 1e10
  }).get('area'));
}

// Binary valid-pixel indicator with zero fill everywhere (.gt(0) makes a
// presence indicator from a possibly fractional mask; unmask(0, false)
// makes masked and outside-footprint locations numeric zero). Identical
// to the tested scripts 04–05 construction.
function binaryValidMask(image) {
  return image.mask()
      .gt(0)
      .rename('valid_mask')
      .unmask(0, false);
}

/*
 * One combined regional ee.Reducer.sum() over two diagnostic bands
 * (identical to the tested scripts 04–05 construction):
 *   valid_area_m2 — pixelArea × binary valid-mask (numeric zero where
 *                   invalid, so an image with no valid BAAQMD pixel
 *                   returns numeric zero, never null);
 *   weighted_no2  — NO2 × pixelArea × binary valid-mask; valid NEGATIVE
 *                   NO2 retrievals preserved — never clamped or masked
 *                   for being negative.
 */
function contributionSums(image, regionGeom) {
  var pixelArea = ee.Image.pixelArea();
  var validMask = binaryValidMask(image);
  var no2Filled = image
      .unmask(0, false);
  var validArea = pixelArea
      .multiply(validMask)
      .rename('valid_area_m2');
  var weightedNo2 = no2Filled
      .multiply(pixelArea)
      .multiply(validMask)
      .rename('weighted_no2');
  return validArea.addBands(weightedNo2).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: regionGeom,
    crs: CONFIG.statsCrs,
    scale: CONFIG.statsScale,
    maxPixels: 1e10
  });
}

// Area-weighted regional mean: sum(NO2 × valid area) / sum(valid area);
// null when the valid area is zero. Exploration-stage method.
function areaWeightedMean(sums) {
  var validArea = ee.Number(sums.get('valid_area_m2'));
  return ee.Algorithms.If(
      validArea.gt(0),
      ee.Number(sums.get('weighted_no2')).divide(validArea),
      null);
}

/*
 * FULL defensive product reconstruction WITH per-product contribution —
 * used only for the SHORT target interval, so quality flags represent
 * actual BAAQMD contribution rather than footprint intersection
 * (identical to the tested scripts 04–05 construction).
 */
function buildProductImages(raw, regionGeom, totalAreaM2) {
  var ids = ee.List(raw.aggregate_array('PRODUCT_ID')).distinct();
  var images = ids.map(function (pid) {
    var memberAssets = raw.filter(ee.Filter.eq('PRODUCT_ID', pid));
    var first = memberAssets.first();
    var t0 = memberAssets.aggregate_min('system:time_start');
    var image = ee.Image(memberAssets.mosaic().copyProperties(first));
    var sums = contributionSums(image, regionGeom);
    var validArea = ee.Number(sums.get('valid_area_m2'));
    // has_valid_baaqmd_data intentionally numeric 1/0 (ee.Number.gt).
    return image.set({
      'PRODUCT_ID': pid,
      'system:time_start': t0,
      'local_date': ee.Date(t0).format('yyyy-MM-dd', CONFIG.timeZone),
      'has_valid_baaqmd_data': validArea.gt(0)
    });
  });
  return ee.ImageCollection.fromImages(images);
}

/*
 * LIGHT defensive product reconstruction — pixel operations and metadata
 * only, NO per-product regional reductions. Used for historical baseline
 * windows (per requirement: historical per-product quality comparison is
 * out of scope) and for the lightweight map paths. copyProperties keeps
 * PROCESSOR_VERSION etc. when present (absent stays absent).
 */
function buildLightProducts(raw) {
  var ids = ee.List(raw.aggregate_array('PRODUCT_ID')).distinct();
  return ee.ImageCollection.fromImages(ids.map(function (pid) {
    var memberAssets = raw.filter(ee.Filter.eq('PRODUCT_ID', pid));
    var first = memberAssets.first();
    var t0 = memberAssets.aggregate_min('system:time_start');
    return ee.Image(memberAssets.mosaic().copyProperties(first)).set({
      'PRODUCT_ID': pid,
      'system:time_start': t0,
      'local_date': ee.Date(t0).format('yyyy-MM-dd', CONFIG.timeZone)
    });
  }));
}

// Daily images per local date from a product collection: the accepted
// working rule — pixel-wise arithmetic mean of ALL same-date orbit
// products, relying on Earth Engine masks (non-contributing products do
// not affect the result; established by exploration 04). mosaic() is
// never used across distinct products.
function buildDailyFromProducts(products) {
  var dates = ee.List(products.aggregate_array('local_date'))
      .distinct().sort();
  return ee.ImageCollection.fromImages(dates.map(function (d) {
    d = ee.String(d);
    return products.filter(ee.Filter.eq('local_date', d)).mean()
        .set({
          'local_date': d,
          'system:time_start': ee.Date(d, CONFIG.timeZone).millis()
        });
  }));
}

// Lightweight daily collection for the map paths (no reductions).
function buildLightDailyCollection(startStr, endStr, regionGeom) {
  var raw = loadRawCollection(regionGeom,
      ee.Date(startStr, CONFIG.timeZone), ee.Date(endStr, CONFIG.timeZone));
  return buildDailyFromProducts(buildLightProducts(raw));
}

// Per-date signed anomaly images: each target daily image minus the
// matched pixel-wise monthly historical median (closure-safe helper —
// arguments are bound per call).
function subtractBaseline(subset, medianImg) {
  return subset.map(function (img) {
    return img.subtract(medianImg);
  });
}

/*
 * DISPLAY-ONLY stretch statistics, fetched once per request AFTER the
 * scientific terminal state: symmetric robust limits for the anomaly
 * detail view (max of |2nd| and |98th| percentile of this request's
 * anomaly image over BAAQMD) and the observed min/max of the historical
 * valid-day count for a contrasting availability display. One small
 * combined reduceRegion; the callback is token-guarded so stale results
 * are discarded. These numbers are never used for any statistic,
 * threshold, or exclusion — the underlying images are unchanged.
 */
function computeDisplayStretches(anomalyImg, countImg, token) {
  var reducer = ee.Reducer.percentile([2, 98])
      .combine(ee.Reducer.minMax(), '', true);
  anomalyImg.rename('anomaly').addBands(countImg.rename('count'))
      .reduceRegion({
        reducer: reducer,
        geometry: regionGeom,
        crs: CONFIG.statsCrs,
        scale: CONFIG.statsScale,
        maxPixels: 1e10
      }).evaluate(function (result, error) {
    if (token !== refreshToken) return; // stale — discard silently
    if (state === null || !state.hasData) return;
    if (error || !result) {
      print('Note: display-stretch computation failed (' + error +
            ') — the fixed display scales remain in use.');
      return;
    }
    var p2 = result.anomaly_p2;
    var p98 = result.anomaly_p98;
    if (typeof p2 === 'number' && typeof p98 === 'number') {
      var limit = Math.max(Math.abs(p2), Math.abs(p98));
      if (limit > 0) {
        state.anomalyDetailVis = {
          min: -limit,
          max: limit,
          palette: CONFIG.anomalyVis.palette
        };
      }
    }
    var cMin = result.count_min;
    var cMax = result.count_max;
    if (typeof cMin === 'number' && typeof cMax === 'number') {
      state.countRange = {min: cMin, max: cMax};
      state.countDetailVis = {
        min: cMin,
        max: cMax > cMin ? cMax : cMin + 1,
        palette: CONFIG.countPalette
      };
    }
    if (currentDisplay === 'anomalyDetail' || currentDisplay === 'count') {
      renderDisplay(); // refresh the visible layer/legend from cache
    }
  });
}

/*
 * TARGET chunk evaluation [chunkStart, chunkEnd): full product
 * reconstruction with contribution (short interval only), daily images
 * by the accepted rule, one regional reduction per day. Features:
 *   'target_daily'   — date, area-weighted mean (nullable), valid-area
 *                      fraction;
 *   'target_product' — per product: id, orbit, PRODUCT_QUALITY,
 *                      PROCESSOR_VERSION, has_valid (actual BAAQMD
 *                      contribution flag).
 */
function buildTargetChunkEvaluation(chunkStart, chunkEnd, regionGeom,
                                    totalAreaM2) {
  var raw = loadRawCollection(regionGeom,
      ee.Date(chunkStart, CONFIG.timeZone),
      ee.Date(chunkEnd, CONFIG.timeZone));
  var products = buildProductImages(raw, regionGeom, totalAreaM2);
  var daily = buildDailyFromProducts(products);

  var dailyFeatures = ee.FeatureCollection(daily.map(function (img) {
    var sums = contributionSums(img, regionGeom);
    return ee.Feature(null, {
      series: 'target_daily',
      date_string: img.get('local_date'),
      millis: img.get('system:time_start'),
      mean: areaWeightedMean(sums),
      fraction: ee.Number(sums.get('valid_area_m2')).divide(totalAreaM2)
    });
  }));

  var productFeatures = ee.FeatureCollection(products.map(function (img) {
    return ee.Feature(null, {
      series: 'target_product',
      local_date: img.get('local_date'),
      product_id: img.get('PRODUCT_ID'),
      orbit: img.get('ORBIT'),
      product_quality: img.get('PRODUCT_QUALITY'),
      processor_version: img.get('PROCESSOR_VERSION'),
      has_valid: img.get('has_valid_baaqmd_data')
    });
  }));

  return dailyFeatures.merge(productFeatures);
}

/*
 * HISTORICAL baseline-window evaluation for one (target year-month key,
 * source year) pair: LIGHT products (no per-product reductions), daily
 * images by the accepted rule, ONE regional reduction per historical
 * day. Features:
 *   'hist_daily' — date, source year, matched target key, area-weighted
 *                  mean (nullable), valid-area fraction;
 *   'hist_meta'  — matched target key, source year, distinct
 *                  PROCESSOR_VERSION values among the window's source
 *                  products.
 */
function buildHistWindowEvaluation(windowStart, windowEnd, sourceYear,
                                   targetKey, regionGeom, totalAreaM2) {
  var raw = loadRawCollection(regionGeom,
      ee.Date(windowStart, CONFIG.timeZone),
      ee.Date(windowEnd, CONFIG.timeZone));
  var products = buildLightProducts(raw);
  var daily = buildDailyFromProducts(products);

  var dailyFeatures = ee.FeatureCollection(daily.map(function (img) {
    var sums = contributionSums(img, regionGeom);
    return ee.Feature(null, {
      series: 'hist_daily',
      date_string: img.get('local_date'),
      source_year: sourceYear,
      target_key: targetKey,
      mean: areaWeightedMean(sums),
      fraction: ee.Number(sums.get('valid_area_m2')).divide(totalAreaM2)
    });
  }));

  var metaFeature = ee.FeatureCollection([ee.Feature(null, {
    series: 'hist_meta',
    target_key: targetKey,
    source_year: sourceYear,
    processor_versions:
        ee.List(products.aggregate_array('PROCESSOR_VERSION')).distinct()
  })]);

  return dailyFeatures.merge(metaFeature);
}

/* ---------------------------------------------------------------------- UI */

var STYLE = {
  title: {fontSize: '16px', fontWeight: 'bold', margin: '4px 8px 0 8px'},
  subtitle: {fontSize: '12px', color: '#52514e', margin: '2px 8px 8px 8px'},
  body: {fontSize: '12px', color: '#0b0b0b', margin: '4px 8px'},
  note: {fontSize: '11px', color: '#52514e', margin: '4px 8px'},
  emph: {fontSize: '11px', color: '#0b0b0b', fontWeight: 'bold',
         margin: '4px 8px'},
  status: {fontSize: '12px', color: '#52514e', margin: '6px 8px'},
  warnLabel: {fontSize: '11px', color: '#d03b3b', margin: '2px 8px'},
  warn: '#d03b3b',
  targetColor: '#c2610f',   // target daily series (orange)
  histColor: '#2a78d6',     // historical median series (blue)
  anomalyColor: '#6a51a3',  // signed anomaly columns (purple)
  pctColor: '#4d7d64',      // percentile series (muted green)
  fractionColor: '#4d7d64', // valid-fraction bars
  refColor: '#8a8985',      // descriptive reference lines
  grid: '#e1e0d9'
};

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

// '0' for zero, exponential notation otherwise (e.g., '2.0e-5').
function fmtMol(v) {
  return v === 0 ? '0' : v.toExponential(1);
}

function daysBetween(startStr, endStr) {
  return Math.round((Date.parse(endStr) - Date.parse(startStr)) / 86400000);
}

function median(values) {
  var s = values.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 'YYYY-MM-DD' from a UTC millisecond timestamp (ES5; no padStart).
function utcDateString(ms) {
  var d = new Date(ms);
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : String(m)) + '-' +
      (day < 10 ? '0' + day : String(day));
}

// Every local calendar date string in [startStr, endStr), via UTC
// arithmetic on the date strings (browser-timezone- and DST-proof).
function dateStringsInRange(startStr, endStr) {
  var out = [];
  var dayMs = 86400000;
  var cursor = Date.parse(startStr);
  var endMs = Date.parse(endStr);
  while (cursor < endMs) {
    out.push(utcDateString(cursor));
    cursor += dayMs;
  }
  return out;
}

// Consecutive non-overlapping chunk ranges of at most chunkDays dates
// (tested script 05 helper).
function buildChunkRanges(startStr, endStr, chunkDays) {
  var chunks = [];
  var dayMs = 86400000;
  var cursor = Date.parse(startStr);
  var endMs = Date.parse(endStr);
  while (cursor < endMs) {
    var next = cursor + chunkDays * dayMs;
    if (next > endMs) next = endMs;
    chunks.push({start: utcDateString(cursor), end: utcDateString(next)});
    cursor = next;
  }
  return chunks;
}

function ymd(y, m, d) {
  return y + '-' + (m < 10 ? '0' + m : String(m)) + '-' +
      (d < 10 ? '0' + d : String(d));
}

/*
 * Baseline windows for the target dates: for each distinct target
 * year-month key ('YYYY-MM'), the SAME calendar month in each of the N
 * previous years (only years earlier than the target year). Windows that
 * end on or before COLLECTION_START are unavailable and skipped (warned
 * later with requested vs actual years). A target period crossing a
 * month boundary gets separate month-matched baselines per target month.
 */
function buildBaselineWindows(targetDates, histYears) {
  var keys = [];
  var seen = {};
  var i;
  for (i = 0; i < targetDates.length; i++) {
    var key = targetDates[i].substring(0, 7);
    if (!seen[key]) {
      seen[key] = true;
      keys.push(key);
    }
  }
  var windows = [];
  var perKey = {};
  for (i = 0; i < keys.length; i++) {
    var k = keys[i];
    var ty = Number(k.substring(0, 4));
    var tm = Number(k.substring(5, 7));
    var requestedYears = [];
    var windowYears = [];
    var unavailableYears = [];
    for (var n = 1; n <= histYears; n++) {
      var y = ty - n;
      requestedYears.push(y);
      var wStart = ymd(y, tm, 1);
      var wEnd = tm === 12 ? ymd(y + 1, 1, 1) : ymd(y, tm + 1, 1);
      if (wEnd <= COLLECTION_START) {
        unavailableYears.push(y);
        continue;
      }
      windows.push({key: k, year: y, start: wStart, end: wEnd});
      windowYears.push(y);
    }
    perKey[k] = {
      requestedYears: requestedYears,
      windowYears: windowYears,
      unavailableYears: unavailableYears
    };
  }
  return {keys: keys, windows: windows, perKey: perKey};
}

// Normalizes dot-separated numeric version strings for set comparison
// and display (e.g. '02.09.01' → '2.9.1'). Only zero-padding is
// canonicalized — genuine version differences are preserved.
function normalizeVersion(v) {
  if (v === null || v === undefined) return null;
  var parts = String(v).split('.');
  for (var i = 0; i < parts.length; i++) {
    if (/^\d+$/.test(parts[i])) {
      parts[i] = String(Number(parts[i]));
    }
  }
  return parts.join('.');
}

// Percentile rank: 100 × count(historical values <= target) / count of
// non-null historical values.
function percentileRank(histValues, targetValue) {
  if (histValues.length === 0 || targetValue === null) return null;
  var atOrBelow = 0;
  for (var i = 0; i < histValues.length; i++) {
    if (histValues[i] <= targetValue) atOrBelow++;
  }
  return 100 * atOrBelow / histValues.length;
}

// Google Charts DataTable date literal from a 'YYYY-MM-DD' string.
function toChartDate(dateStr) {
  var y = Number(dateStr.substring(0, 4));
  var m = Number(dateStr.substring(5, 7));
  var d = Number(dateStr.substring(8, 10));
  return 'Date(' + y + ',' + (m - 1) + ',' + d + ')';
}

/* ------------------------------------------------------------------ CHARTS */

// Chart 1 — target vs matched historical median (aligned by date; a
// missing value is a real gap, never interpolated).
function makeTargetVsHistChart(rows) {
  var tableRows = [];
  for (var i = 0; i < rows.length; i++) {
    tableRows.push({c: [
      {v: toChartDate(rows[i].date)},
      {v: rows[i].mean},
      {v: rows[i].histMedian}
    ]});
  }
  return ui.Chart({
    dataTable: {
      cols: [
        {id: 'day', label: 'Target local day', type: 'date'},
        {id: 'target', label: 'Target daily satellite NO2 column',
         type: 'number'},
        {id: 'hist',
         label: 'Regional historical median (of daily BAAQMD means)',
         type: 'number'}
      ],
      rows: tableRows
    },
    chartType: 'LineChart',
    options: {
      title: 'Daily satellite NO2 column — target vs same-month ' +
          'historical median',
      titleTextStyle: {fontSize: 12, bold: false},
      interpolateNulls: false,
      hAxis: {gridlines: {color: STYLE.grid}},
      vAxis: {
        title: 'mol/m²',
        format: 'scientific',
        gridlines: {color: STYLE.grid}
      },
      series: {
        0: {lineWidth: 1, pointSize: 4, color: STYLE.targetColor},
        1: {lineWidth: 1, pointSize: 3, color: STYLE.histColor}
      },
      legend: {position: 'top', textStyle: {fontSize: 11}},
      chartArea: {left: 64, right: 16, top: 48, bottom: 32}
    }
  });
}

// Chart 2 — signed anomaly columns (zero baseline). Positive = above the
// historical monthly median; negative = below it. Never labeled
// unhealthy or polluted.
function makeAnomalyChart(rows) {
  var tableRows = [];
  for (var i = 0; i < rows.length; i++) {
    tableRows.push({c: [
      {v: toChartDate(rows[i].date)},
      {v: rows[i].anomaly}
    ]});
  }
  return ui.Chart({
    dataTable: {
      cols: [
        {id: 'day', label: 'Target local day', type: 'date'},
        {id: 'anom', label: 'Signed satellite-column anomaly',
         type: 'number'}
      ],
      rows: tableRows
    },
    chartType: 'ColumnChart',
    options: {
      title: 'Daily signed satellite-column anomaly',
      titleTextStyle: {fontSize: 12, bold: false},
      hAxis: {gridlines: {color: STYLE.grid}},
      vAxis: {
        title: 'mol/m²',
        format: 'scientific',
        baseline: 0,
        gridlines: {color: STYLE.grid}
      },
      legend: {position: 'none'},
      colors: [STYLE.anomalyColor],
      chartArea: {left: 64, right: 16, top: 32, bottom: 32}
    }
  });
}

// Chart 3 — percentile rank (0–100) with descriptive reference lines at
// 10 and 90 (references only — not thresholds, not classifications).
function makePercentileChart(rows) {
  var tableRows = [];
  for (var i = 0; i < rows.length; i++) {
    tableRows.push({c: [
      {v: toChartDate(rows[i].date)},
      {v: rows[i].percentile},
      {v: 10},
      {v: 90}
    ]});
  }
  return ui.Chart({
    dataTable: {
      cols: [
        {id: 'day', label: 'Target local day', type: 'date'},
        {id: 'pct', label: 'Percentile within historical distribution',
         type: 'number'},
        {id: 'p10', label: '10th (descriptive reference only)',
         type: 'number'},
        {id: 'p90', label: '90th (descriptive reference only)',
         type: 'number'}
      ],
      rows: tableRows
    },
    chartType: 'ComboChart',
    options: {
      title: 'Target-day percentile within the historical same-month ' +
          'distribution',
      titleTextStyle: {fontSize: 12, bold: false},
      seriesType: 'bars',
      hAxis: {gridlines: {color: STYLE.grid}},
      vAxis: {
        title: 'percentile',
        viewWindow: {min: 0, max: 100},
        gridlines: {color: STYLE.grid}
      },
      series: {
        0: {color: STYLE.pctColor},
        1: {type: 'line', lineWidth: 1, pointSize: 0, color: STYLE.refColor,
            lineDashStyle: [4, 4]},
        2: {type: 'line', lineWidth: 1, pointSize: 0, color: STYLE.refColor,
            lineDashStyle: [8, 4]}
      },
      legend: {position: 'top', textStyle: {fontSize: 10}},
      chartArea: {left: 64, right: 16, top: 48, bottom: 32}
    }
  });
}

// Chart 4 — target daily valid-area fraction (0–1). No coverage
// threshold is adopted; the 0.20 caution is inherited from the script 05
// sensitivity study as a caution label only.
function makeFractionChart(rows) {
  var tableRows = [];
  for (var i = 0; i < rows.length; i++) {
    tableRows.push({c: [
      {v: toChartDate(rows[i].date)},
      {v: rows[i].fraction}
    ]});
  }
  return ui.Chart({
    dataTable: {
      cols: [
        {id: 'day', label: 'Target local day', type: 'date'},
        {id: 'frac', label: 'Valid-area fraction', type: 'number'}
      ],
      rows: tableRows
    },
    chartType: 'ColumnChart',
    options: {
      title: 'Target daily BAAQMD valid-area fraction (no coverage ' +
          'threshold adopted)',
      titleTextStyle: {fontSize: 12, bold: false},
      hAxis: {gridlines: {color: STYLE.grid}},
      vAxis: {
        title: 'fraction of region area',
        viewWindow: {min: 0, max: 1},
        gridlines: {color: STYLE.grid}
      },
      legend: {position: 'none'},
      colors: [STYLE.fractionColor],
      chartArea: {left: 64, right: 16, top: 32, bottom: 32}
    }
  });
}

/* ----------------------------------------------------------- PANEL + STATE */

var studyRegion = getStudyRegion();
var regionGeom = studyRegion.fc.geometry();

var boundaryLayer = ui.Map.Layer(
    studyRegion.fc.style({color: 'black', fillColor: '00000000', width: 2}),
    {},
    studyRegion.isApproximation ?
        'Study region (county approximation of BAAQMD jurisdiction)' :
        'Study region (official BAAQMD jurisdiction)');

// Map display selection. All layers are display-only clipped copies
// built through the lightweight masked-image path — they are never used
// to generate the regional summary numbers.
var DISPLAY_LABELS = {
  'Target-period mean NO2': 'target',
  'Mapped historical monthly median (pixel-wise)': 'baseline',
  'Mean signed anomaly — fixed comparison scale': 'anomaly',
  'Mean signed anomaly — detail display stretch': 'anomalyDetail',
  'Minimum historical valid-day count': 'count'
};
var currentDisplay = 'target';

// Result cache for the latest completed refresh: {hasData, startStr,
// endStr, targetMean, baselineMean, anomalyMean, minCount, countVisMax,
// anomalyDetailVis, countDetailVis, countRange}. Baseline-dependent
// image fields are null when no baseline windows exist (the target map
// stays available); the detail-stretch fields fill in asynchronously
// (display-only). Selector changes re-render from this cache without
// recomputing any statistics.
var state = null;

// Guards against out-of-order async results when Update is clicked again
// before the previous computation finishes.
var refreshToken = 0;

var displaySelect = ui.Select({
  items: Object.keys(DISPLAY_LABELS),
  value: 'Target-period mean NO2',
  onChange: function (label) {
    currentDisplay = DISPLAY_LABELS[label];
    renderDisplay();
  },
  style: {stretch: 'horizontal'}
});

var startBox = ui.Textbox({
  value: CONFIG.startDate,
  placeholder: 'YYYY-MM-DD',
  style: {width: '100px'}
});
var endBox = ui.Textbox({
  value: CONFIG.endDate,
  placeholder: 'YYYY-MM-DD',
  style: {width: '100px'}
});
var histYearsBox = ui.Textbox({
  value: String(CONFIG.historicalYearsDefault),
  placeholder: '1-5',
  style: {width: '48px'}
});
var updateButton = ui.Button({label: 'Update', onClick: refresh});

var statusLabel = ui.Label('', STYLE.status);
var warningsPanel = ui.Panel();
var summaryPanel = ui.Panel();
var baselinePanel = ui.Panel();
var chartsPanel = ui.Panel();
var legendPanel = ui.Panel();

function setStatus(text, isWarning) {
  statusLabel.setValue(text);
  statusLabel.style().set('color', isWarning ? STYLE.warn : '#52514e');
}

/*
 * Loading-state animation (tested scripts 04–05 pattern). Exactly one
 * timer can exist at a time; the progress base text updates between
 * sequential tasks WITHOUT restarting or duplicating the timer; stale
 * callbacks return on the refresh-token check before touching anything.
 * Fixed colors — only the trailing dots change.
 */
var LOADING_DOTS = ['', '.', '..', '...'];
// Rendered on its own line below the animated text (whiteSpace: 'pre'
// makes the label honor the newline).
var LOADING_SUFFIX = '\nTarget chunks and baseline windows are evaluated ' +
    'sequentially.';
var loadingTimerId = null;
var loadingBaseText = 'Computing';
var loadingFrame = 0;

var LOADING_STYLE = {
  fontWeight: 'bold',
  color: '#7a4a00',           // dark amber-brown, fixed
  backgroundColor: '#fdf1da', // pale amber, fixed
  padding: '6px 8px',
  margin: '8px 8px',
  whiteSpace: 'pre'
};
var NORMAL_STATUS_STYLE = {
  fontWeight: 'normal',
  backgroundColor: 'white',
  padding: '0px',
  margin: '6px 8px',
  whiteSpace: 'normal'
};

function renderLoadingFrame() {
  statusLabel.setValue(loadingBaseText + LOADING_DOTS[loadingFrame] +
      LOADING_SUFFIX);
}

function startLoadingAnimation() {
  stopLoadingAnimation(); // only one loading timer may exist at a time
  loadingBaseText = 'Computing';
  loadingFrame = 0;
  statusLabel.style().set(LOADING_STYLE);
  renderLoadingFrame();
  loadingTimerId = ui.util.setInterval(function () {
    loadingFrame = (loadingFrame + 1) % LOADING_DOTS.length;
    renderLoadingFrame();
  }, 450);
}

function stopLoadingAnimation() {
  if (loadingTimerId !== null) {
    ui.util.clearTimeout(loadingTimerId);
    loadingTimerId = null;
  }
  statusLabel.style().set(NORMAL_STATUS_STYLE);
}

function setLoadingProgress(baseText) {
  loadingBaseText = baseText;
  if (loadingTimerId !== null) {
    renderLoadingFrame();
  }
}

function makeColorBar(palette) {
  return ui.Thumbnail({
    image: ee.Image.pixelLonLat().select('longitude'),
    params: {
      bbox: [0, 0, 1, 0.1],
      dimensions: '120x10',
      format: 'png',
      min: 0,
      max: 1,
      palette: palette
    },
    style: {stretch: 'horizontal', margin: '2px 8px', maxHeight: '18px'}
  });
}

function labelRow(texts) {
  var widgets = [];
  for (var i = 0; i < texts.length; i++) {
    if (i > 0) widgets.push(ui.Label('', {stretch: 'horizontal'}));
    widgets.push(ui.Label(texts[i], STYLE.note));
  }
  return ui.Panel({widgets: widgets,
                   layout: ui.Panel.Layout.flow('horizontal')});
}

function buildPanel() {
  var panel = ui.Panel({style: {width: '420px', padding: '8px'}});

  panel.add(ui.Label('Bay Area Air Quality Episode Finder', STYLE.title));
  panel.add(ui.Label(
      'Exploration 06 — exploratory monthly baseline and satellite-' +
      'column anomaly (Satellite NO2 Column Anomaly Explorer)',
      STYLE.subtitle));

  panel.add(ui.Label(
      'What this shows: the target period is compared with the SAME ' +
      'calendar month in prior years using an exploratory ' +
      'same-calendar-month historical median baseline (not a final ' +
      'climatology). The default target period is the latest seven Bay ' +
      'Area local dates available in the OFFL collection — publication ' +
      'latency means these may not be the previous seven real-world ' +
      'dates. All results are Sentinel-5P tropospheric NO2 satellite-' +
      'column results (mol/m²).',
      STYLE.body));
  panel.add(ui.Label(
      'A positive anomaly means the satellite-observed tropospheric NO2 ' +
      'column was above its exploratory same-calendar-month historical ' +
      'median. It is not an AQI value, health category, surface ' +
      'concentration, or episode declaration.',
      STYLE.emph));
  panel.add(ui.Label(
      'The baseline retains all valid masked observations regardless of ' +
      'PRODUCT_QUALITY, applies no minimum valid-area-fraction ' +
      'threshold, preserves valid negative retrievals, and never uses ' +
      'the target year or future dates in its own baseline. The 90th ' +
      'and 10th historical percentiles are descriptive reference labels ' +
      'only.',
      STYLE.note));
  panel.add(ui.Label(
      'Quality limitation: target-period non-NOMINAL flags are based on ' +
      'actual BAAQMD contribution, but the lightweight historical ' +
      'baseline path does not audit contribution-level PRODUCT_QUALITY. ' +
      'Historical valid observations are retained — consider this ' +
      'limitation when interpreting the baseline.',
      STYLE.note));
  panel.add(ui.Label(
      'Two exploratory baseline summaries: the REGIONAL historical ' +
      'median is the median of historical daily BAAQMD means (used in ' +
      'the charts and anomaly numbers); the MAPPED historical median is ' +
      'the pixel-wise median of historical daily images (map layer). ' +
      'They are related but not mathematically identical.',
      STYLE.note));
  panel.add(ui.Label(
      'Map layers requiring a historical baseline: the mapped median, ' +
      'both anomaly views, and the valid-day count. The target-period ' +
      'mean works without a baseline.',
      STYLE.note));

  if (studyRegion.isApproximation) {
    panel.add(ui.Label(
        'Boundary note: the outline shown is a county-based approximation ' +
        'of the BAAQMD jurisdiction (Solano and Sonoma are included in ' +
        'full, which overstates the northern extent). It will be replaced ' +
        'by the official BAAQMD boundary asset.',
        STYLE.note));
  }

  // Sidebar-safe layout (vertical scrolling only): the map-layer
  // selector gets its own full-width row, and the controls wrap onto two
  // rows so no child forces the panel wider than the Code Editor's
  // narrow sidebar width.
  panel.add(ui.Label('Map layer', STYLE.note));
  panel.add(displaySelect);
  panel.add(ui.Panel({
    widgets: [
      ui.Label('Start', STYLE.note), startBox,
      ui.Label('End', STYLE.note), endBox
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  }));
  panel.add(ui.Panel({
    widgets: [
      ui.Label('Historical years', STYLE.note), histYearsBox, updateButton
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  }));
  panel.add(ui.Label(
      'Latest available local collection date: ' +
      DEFAULT_DATE_RANGE.latestAvailableLocalDate + '. End date is ' +
      'exclusive; the target interval is limited to ' +
      CONFIG.maxTargetDays + ' calendar days in this exploration; ' +
      'Historical years must be an integer from ' +
      CONFIG.historicalYearsMin + ' to ' + CONFIG.historicalYearsMax + '.',
      STYLE.note));

  panel.add(statusLabel);
  panel.add(warningsPanel);
  panel.add(summaryPanel);
  panel.add(baselinePanel);
  panel.add(chartsPanel);
  panel.add(legendPanel);

  panel.add(ui.Label(
      'Notes: dates are Bay Area local calendar dates (' + CONFIG.timeZone +
      ', end exclusive). Statistics use area-weighted BAAQMD means with ' +
      'valid-area fractions at ' + CONFIG.statsCrs + ' / ' +
      CONFIG.statsScale + ' m (exploration settings). The ' +
      CONFIG.lowFractionCaution + ' valid-fraction caution is inherited ' +
      'from the coverage sensitivity study — a caution, not an adopted ' +
      'exclusion rule; nothing is excluded because of it. Map layers are ' +
      'display-only copies built through a lightweight masked-image path ' +
      'and are never used for the regional summary numbers. Structured ' +
      'output is printed to the Console.',
      STYLE.note));
  panel.add(ui.Label({
    value: 'Project documentation (GitHub)',
    style: STYLE.note,
    targetUrl:
        'https://github.com/perez-eduardo/Bay-Area-Air-Quality-Episode-Finder'
  }));

  return panel;
}

/* -------------------------------------------------------- MAP + LEGEND */

function renderDisplay() {
  renderLegend();
  if (state === null || !state.hasData) {
    Map.layers().reset([boundaryLayer]);
    return;
  }
  // Per-layer availability: the target-period mean works without any
  // baseline; the mapped median, both anomaly views, and the count layer
  // require historical baseline windows. Unavailable layers show the
  // boundary only, with the reason in the legend.
  var layer = null;
  if (currentDisplay === 'target' && state.targetMean !== null) {
    layer = ui.Map.Layer(state.targetMean, CONFIG.vis,
        'Target-period mean satellite NO2 column, ' +
            state.startStr + ' to ' + state.endStr,
        true, CONFIG.layerOpacity);
  } else if (currentDisplay === 'baseline' && state.baselineMean !== null) {
    layer = ui.Map.Layer(state.baselineMean, CONFIG.vis,
        'Mapped historical monthly median (pixel-wise, exploratory ' +
            'baseline)',
        true, CONFIG.layerOpacity);
  } else if (currentDisplay === 'anomaly' && state.anomalyMean !== null) {
    layer = ui.Map.Layer(state.anomalyMean, CONFIG.anomalyVis,
        'Mean signed anomaly — fixed comparison display scale (±' +
            fmtMol(CONFIG.anomalyVis.max) + ' mol/m²)',
        true, CONFIG.layerOpacity);
  } else if (currentDisplay === 'anomalyDetail' &&
             state.anomalyMean !== null) {
    var detailVis = state.anomalyDetailVis !== null ?
        state.anomalyDetailVis : CONFIG.anomalyVis;
    layer = ui.Map.Layer(state.anomalyMean, detailVis,
        'Mean signed anomaly — detail DISPLAY stretch' +
            (state.anomalyDetailVis !== null ?
                ' (±' + fmtMol(state.anomalyDetailVis.max) + ' mol/m²)' :
                ' (stretch computing — fixed scale shown)'),
        true, CONFIG.layerOpacity);
  } else if (currentDisplay === 'count' && state.minCount !== null) {
    var countVis = state.countDetailVis !== null ?
        state.countDetailVis :
        {min: 0, max: state.countVisMax, palette: CONFIG.countPalette};
    layer = ui.Map.Layer(state.minCount, countVis,
        'Minimum historical valid-day count (data availability)',
        true, CONFIG.layerOpacity);
  }
  Map.layers().reset(layer === null ?
      [boundaryLayer] : [layer, boundaryLayer]);
}

function renderLegend() {
  legendPanel.clear();
  // No legend before a successful run (also keeps stale legends from
  // sitting under invalid controls after a validation failure).
  if (state === null || !state.hasData) return;
  // Baseline-dependent layer selected but unavailable: explain instead.
  if ((currentDisplay === 'baseline' || currentDisplay === 'anomaly' ||
       currentDisplay === 'anomalyDetail' || currentDisplay === 'count') &&
      (currentDisplay === 'baseline' ? state.baselineMean :
       currentDisplay === 'count' ? state.minCount :
       state.anomalyMean) === null) {
    legendPanel.add(ui.Label(
        'This map layer requires a historical baseline, and no baseline ' +
        'windows are available for this target period. The target-period ' +
        'mean layer remains available.',
        STYLE.note));
    return;
  }
  if (currentDisplay === 'anomalyDetail') {
    legendPanel.add(ui.Label(
        'Legend — mean signed anomaly, detail DISPLAY stretch',
        STYLE.emph));
    legendPanel.add(makeColorBar(CONFIG.anomalyVis.palette));
    if (state.anomalyDetailVis !== null) {
      legendPanel.add(labelRow([
        fmtMol(state.anomalyDetailVis.min),
        '0',
        fmtMol(state.anomalyDetailVis.max) + ' mol/m²'
      ]));
      legendPanel.add(ui.Label(
          'DISPLAY stretch only: symmetric limits from the 2nd/98th ' +
          'percentiles of this request\'s anomaly image over BAAQMD, ' +
          'recomputed for every request to reveal spatial variation. It ' +
          'is not a scientific threshold and must not be compared across ' +
          'periods — use the fixed comparison scale for that.',
          STYLE.note));
    } else {
      legendPanel.add(ui.Label(
          'Detail stretch is being computed — the fixed comparison scale ' +
          'is shown until it is ready.',
          STYLE.note));
    }
    legendPanel.add(ui.Label(
        'A positive anomaly means the satellite-observed tropospheric ' +
        'NO2 column was above its exploratory same-calendar-month ' +
        'historical median. It is not an AQI value, health category, ' +
        'surface concentration, or episode declaration.',
        STYLE.note));
    return;
  }
  if (currentDisplay === 'anomaly') {
    legendPanel.add(ui.Label(
        'Legend — mean signed satellite-column anomaly', STYLE.emph));
    legendPanel.add(makeColorBar(CONFIG.anomalyVis.palette));
    legendPanel.add(labelRow([
      fmtMol(CONFIG.anomalyVis.min),
      '0',
      fmtMol(CONFIG.anomalyVis.max) + ' mol/m²'
    ]));
    legendPanel.add(ui.Label(
        'Blue = below the exploratory same-calendar-month historical ' +
        'median; white = near zero; red = above it. FIXED comparison ' +
        'display scale — keep this view for comparisons across periods; ' +
        'small anomalies may look uniformly white here (use the detail ' +
        'display stretch to see spatial variation). Display-only, not a ' +
        'scientific threshold. A positive anomaly means the ' +
        'satellite-observed tropospheric NO2 column was above its ' +
        'exploratory same-calendar-month historical median. It is not an ' +
        'AQI value, health category, surface concentration, or episode ' +
        'declaration.',
        STYLE.note));
    return;
  }
  if (currentDisplay === 'count') {
    legendPanel.add(ui.Label(
        'Legend — minimum historical valid-day count', STYLE.emph));
    legendPanel.add(makeColorBar(CONFIG.countPalette));
    if (state.countRange !== null) {
      legendPanel.add(labelRow([
        state.countRange.min + ' days',
        state.countRange.max + ' days'
      ]));
      legendPanel.add(ui.Label(
          'Observed count range over BAAQMD: ' + state.countRange.min +
          ' to ' + state.countRange.max + ' valid historical days ' +
          '(theoretical maximum for the selected years: ' +
          state.countVisMax + '). The color stretch spans the observed ' +
          'range — display-only; the absolute integer counts are ' +
          'unchanged and Inspector-accessible.',
          STYLE.note));
    } else {
      legendPanel.add(labelRow(['0', state.countVisMax + ' days']));
      legendPanel.add(ui.Label(
          'Observed-range display stretch is being computed — showing ' +
          '0 to the theoretical maximum until it is ready.',
          STYLE.note));
    }
    legendPanel.add(ui.Label(
        'Pixel-wise minimum number of valid historical daily ' +
        'observations behind the baseline across the target dates. This ' +
        'layer is DATA AVAILABILITY — not pollution and not NO2 ' +
        'magnitude.',
        STYLE.note));
    return;
  }
  legendPanel.add(ui.Label(
      'Legend — satellite NO2 column (target / baseline layers)',
      STYLE.emph));
  legendPanel.add(makeColorBar(CONFIG.vis.palette));
  legendPanel.add(labelRow([
    fmtMol(CONFIG.vis.min),
    fmtMol((CONFIG.vis.min + CONFIG.vis.max) / 2),
    fmtMol(CONFIG.vis.max) + ' mol/m²'
  ]));
  legendPanel.add(ui.Label(
      'Mean tropospheric NO2 column density in mol/m² on the fixed ' +
      'display stretch shared by the target and baseline layers (the ' +
      'baseline layer is the pixel-wise MAPPED historical median — a ' +
      'different summary from the regional historical median used in the ' +
      'charts). Colors are a numerical display stretch only — not an ' +
      'AQI, not health categories, and not a pollution/no-pollution ' +
      'classification.',
      STYLE.note));
}

/* ----------------------------------------------------------------- REFRESH */

/*
 * Clears all prior scientific output — summaries, charts, warnings,
 * analysis map layers, and the legend — while keeping the BAAQMD
 * boundary and the basic app shell visible. Used at the start of every
 * request AND on validation failure, so stale results can never sit
 * under invalid controls.
 */
function clearResults() {
  warningsPanel.clear();
  summaryPanel.clear();
  baselinePanel.clear();
  chartsPanel.clear();
  state = null;
  renderDisplay(); // boundary only; renderLegend empties with no state
}

function refresh() {
  var startStr = startBox.getValue();
  var endStr = endBox.getValue();
  var histYearsRaw = String(histYearsBox.getValue()).replace(/\s/g, '');

  if (!isIsoDate(startStr) || !isIsoDate(endStr)) {
    clearResults();
    setStatus('⚠ Dates must be valid and formatted YYYY-MM-DD.', true);
    return;
  }
  if (startStr >= endStr) { // ISO date strings compare lexicographically
    clearResults();
    setStatus('⚠ Start date must be before end date.', true);
    return;
  }
  if (daysBetween(startStr, endStr) > CONFIG.maxTargetDays) {
    // No Earth Engine request is started; Update stays enabled.
    clearResults();
    setStatus('⚠ The target interval is limited to ' +
        CONFIG.maxTargetDays + ' calendar days for this exploration ' +
        '(requested: ' + daysBetween(startStr, endStr) + '). Enter a ' +
        'shorter range.', true);
    return;
  }
  if (!/^\d+$/.test(histYearsRaw)) {
    clearResults();
    setStatus('⚠ Historical years must be an integer from ' +
        CONFIG.historicalYearsMin + ' to ' + CONFIG.historicalYearsMax +
        '.', true);
    return;
  }
  var histYears = parseInt(histYearsRaw, 10);
  if (histYears < CONFIG.historicalYearsMin ||
      histYears > CONFIG.historicalYearsMax) {
    clearResults();
    setStatus('⚠ Historical years must be an integer from ' +
        CONFIG.historicalYearsMin + ' to ' + CONFIG.historicalYearsMax +
        '.', true);
    return;
  }

  clearResults(); // boundary only until results arrive
  startLoadingAnimation();
  updateButton.setDisabled(true); // date fields and map controls stay live
  var token = ++refreshToken;

  var targetDates = dateStringsInRange(startStr, endStr);
  var targetChunks = buildChunkRanges(startStr, endStr,
      CONFIG.evaluationChunkDays);
  var baseline = buildBaselineWindows(targetDates, histYears);
  var totalAreaM2 = computeTotalAreaM2(regionGeom);

  // Client-side task list: target chunks first, then one task per
  // (target year-month, prior source year) baseline window. Exactly one
  // .evaluate() is in flight at any moment.
  var tasks = [];
  var i;
  for (i = 0; i < targetChunks.length; i++) {
    tasks.push({
      kind: 'target',
      label: 'Computing target chunk ' + (i + 1) + ' of ' +
          targetChunks.length,
      start: targetChunks[i].start,
      end: targetChunks[i].end
    });
  }
  for (i = 0; i < baseline.windows.length; i++) {
    tasks.push({
      kind: 'hist',
      label: 'Computing baseline window ' + (i + 1) + ' of ' +
          baseline.windows.length,
      start: baseline.windows[i].start,
      end: baseline.windows[i].end,
      key: baseline.windows[i].key,
      year: baseline.windows[i].year
    });
  }
  var accumulated = [];

  function runTask(index) {
    if (token !== refreshToken) return; // superseded — do not launch
    var task = tasks[index];
    setLoadingProgress(task.label);
    var evaluation = task.kind === 'target' ?
        buildTargetChunkEvaluation(task.start, task.end, regionGeom,
            totalAreaM2) :
        buildHistWindowEvaluation(task.start, task.end, task.year,
            task.key, regionGeom, totalAreaM2);
    evaluation.evaluate(function (fc, error) {
      // Stale callbacks from superseded requests touch NOTHING: no
      // appending, no progress, no next task, no loading-state or button
      // changes, no rendering.
      if (token !== refreshToken) return;

      if (error) {
        // Terminal error state: no retry, no partial scientific results.
        stopLoadingAnimation();
        updateButton.setDisabled(false);
        print('⚠ Earth Engine error in task ' + (index + 1) + ' of ' +
              tasks.length + ' (' + task.label + '; ' + task.start +
              ' to ' + task.end + '): ' + error);
        setStatus('⚠ Computation failed in task ' + (index + 1) + ' of ' +
            tasks.length + ' (' + task.start + ' to ' + task.end + '): ' +
            error, true);
        return;
      }

      for (var f = 0; f < fc.features.length; f++) {
        accumulated.push(fc.features[f]);
      }
      if (index + 1 < tasks.length) {
        runTask(index + 1); // strictly sequential
        return;
      }
      // Every task succeeded — terminal success state.
      stopLoadingAnimation();
      updateButton.setDisabled(false);
      renderResults(accumulated);
    });
  }

  /*
   * Whole-request analysis over the accumulated features from ALL tasks.
   * Runs exactly once, only after every task succeeded.
   */
  function renderResults(features) {
    var warnings = [];
    function addWarning(text) {
      warnings.push(text);
      print('⚠ ' + text);
    }

    /* ---- Parse ---- */

    var targetDailyByDate = {};
    var targetProducts = [];
    var histDaily = [];
    var histMetaByKeyYear = {};
    var i, j, p;
    for (i = 0; i < features.length; i++) {
      p = features[i].properties;
      if (p.series === 'target_daily') {
        targetDailyByDate[p.date_string] = {
          mean: typeof p.mean === 'number' ? p.mean : null,
          fraction: typeof p.fraction === 'number' ? p.fraction : 0
        };
      } else if (p.series === 'target_product') {
        targetProducts.push({
          localDate: p.local_date,
          productId: p.product_id,
          orbit: p.orbit !== undefined ? p.orbit : null,
          quality: p.product_quality !== undefined ?
              p.product_quality : null,
          processorVersion: p.processor_version !== undefined ?
              p.processor_version : null,
          hasValid: p.has_valid === 1
        });
      } else if (p.series === 'hist_daily') {
        histDaily.push({
          date: p.date_string,
          sourceYear: p.source_year,
          key: p.target_key,
          mean: typeof p.mean === 'number' ? p.mean : null,
          fraction: typeof p.fraction === 'number' ? p.fraction : 0
        });
      } else if (p.series === 'hist_meta') {
        histMetaByKeyYear[p.target_key + '|' + p.source_year] =
            p.processor_versions || [];
      }
    }

    /* ---- Per-key historical distributions ---- */

    var histValuesByKey = {};   // non-null regional values
    var histYearCounts = {};    // key -> {year: validDayCount}
    var histVersionsByKey = {}; // key -> {version: true}
    for (i = 0; i < baseline.keys.length; i++) {
      histValuesByKey[baseline.keys[i]] = [];
      histYearCounts[baseline.keys[i]] = {};
      histVersionsByKey[baseline.keys[i]] = {};
    }
    for (i = 0; i < histDaily.length; i++) {
      var h = histDaily[i];
      if (h.mean !== null && histValuesByKey[h.key] !== undefined) {
        histValuesByKey[h.key].push(h.mean);
        histYearCounts[h.key][h.sourceYear] =
            (histYearCounts[h.key][h.sourceYear] || 0) + 1;
      }
    }
    for (var metaKey in histMetaByKeyYear) {
      if (histMetaByKeyYear.hasOwnProperty(metaKey)) {
        var keyPart = metaKey.split('|')[0];
        var versions = histMetaByKeyYear[metaKey];
        for (j = 0; j < versions.length; j++) {
          if (histVersionsByKey[keyPart]) {
            // Normalized (e.g. '02.09.01' → '2.9.1') for consistent
            // comparison and display; genuine differences remain.
            histVersionsByKey[keyPart][
                String(normalizeVersion(versions[j]))] = true;
          }
        }
      }
    }
    var histMedianByKey = {};
    for (i = 0; i < baseline.keys.length; i++) {
      var bk = baseline.keys[i];
      histMedianByKey[bk] = histValuesByKey[bk].length > 0 ?
          median(histValuesByKey[bk]) : null;
    }

    /* ---- Target per-date rows ---- */

    var perDateContributors = {};
    var perDateNonNominal = {};
    var targetVersionSet = {};
    for (i = 0; i < targetProducts.length; i++) {
      p = targetProducts[i];
      if (!p.hasValid) continue;
      if (!perDateContributors[p.localDate]) {
        perDateContributors[p.localDate] = {ids: [], orbits: []};
      }
      perDateContributors[p.localDate].ids.push(p.productId);
      perDateContributors[p.localDate].orbits.push(p.orbit);
      if (p.quality !== 'NOMINAL') {
        perDateNonNominal[p.localDate] = true;
      }
      // Normalized so equivalent formats (e.g. '02.09.01' vs '2.9.1')
      // compare and display consistently; genuine differences remain.
      targetVersionSet[String(normalizeVersion(p.processorVersion))] = true;
    }

    var rows = [];
    var validRows = [];
    var nonNominalDates = [];
    var lowFractionDates = [];
    var noValidDates = [];
    var above90 = [];
    var below10 = [];
    for (i = 0; i < targetDates.length; i++) {
      var dateStr = targetDates[i];
      var key = dateStr.substring(0, 7);
      var daily = targetDailyByDate[dateStr];
      var mean = daily ? daily.mean : null;
      var fraction = daily ? daily.fraction : 0;
      var histValues = histValuesByKey[key] || [];
      var histMedian = histMedianByKey[key] !== undefined ?
          histMedianByKey[key] : null;
      var anomaly = (mean !== null && histMedian !== null) ?
          mean - histMedian : null;
      var pct = (mean !== null && histValues.length > 0) ?
          percentileRank(histValues, mean) : null;
      var contributors = perDateContributors[dateStr] ||
          {ids: [], orbits: []};
      var row = {
        date: dateStr,
        key: key,
        mean: mean,
        fraction: fraction,
        validContributors: contributors.ids.length,
        contributorProductIds: contributors.ids,
        contributorOrbits: contributors.orbits,
        hasNonNominalContributor: perDateNonNominal[dateStr] === true,
        histSampleCount: histValues.length,
        histMedian: histMedian,
        anomaly: anomaly,
        percentile: pct
      };
      rows.push(row);
      if (mean !== null) validRows.push(row);
      else noValidDates.push(dateStr);
      if (row.hasNonNominalContributor) nonNominalDates.push(dateStr);
      if (mean !== null && fraction < CONFIG.lowFractionCaution) {
        lowFractionDates.push(dateStr);
      }
      if (pct !== null && pct > 90) above90.push(dateStr);
      if (pct !== null && pct < 10) below10.push(dateStr);
    }

    /* ---- Warnings ---- */

    for (i = 0; i < baseline.keys.length; i++) {
      var k = baseline.keys[i];
      var pk = baseline.perKey[k];
      if (pk.windowYears.length < pk.requestedYears.length) {
        addWarning('Baseline for ' + k + ': requested ' +
            pk.requestedYears.length + ' prior years (' +
            pk.requestedYears.join(', ') + ') but only ' +
            pk.windowYears.length + ' are available (' +
            (pk.windowYears.join(', ') || 'none') +
            ') — the OFFL collection begins in late June 2018.');
      }
      if (histValuesByKey[k].length === 0) {
        addWarning('Baseline for ' + k + ' has NO valid historical ' +
            'regional values — anomalies and percentiles for its target ' +
            'dates are null.');
      }
      var versionCount = 0;
      var versionList = [];
      for (var vk in histVersionsByKey[k]) {
        if (histVersionsByKey[k].hasOwnProperty(vk)) {
          versionCount++;
          versionList.push(vk);
        }
      }
      if (versionCount > 1) {
        addWarning('Baseline sample for ' + k + ' mixes processor ' +
            'versions (' + versionList.join(', ') + '). Historical ' +
            'consistency caution — reported only, nothing is excluded.');
      }
    }
    // Target vs baseline processor-version set comparison.
    var targetVersions = [];
    for (var tv in targetVersionSet) {
      if (targetVersionSet.hasOwnProperty(tv)) targetVersions.push(tv);
    }
    targetVersions.sort();
    var baselineVersions = [];
    var baselineVersionSeen = {};
    for (i = 0; i < baseline.keys.length; i++) {
      for (var bv in histVersionsByKey[baseline.keys[i]]) {
        if (histVersionsByKey[baseline.keys[i]].hasOwnProperty(bv) &&
            !baselineVersionSeen[bv]) {
          baselineVersionSeen[bv] = true;
          baselineVersions.push(bv);
        }
      }
    }
    baselineVersions.sort();
    // No target-vs-baseline version warning when the baseline version
    // set is empty (e.g., no baseline windows available) — an empty set
    // is a missing baseline, not a version difference.
    if (targetVersions.length > 0 && baselineVersions.length > 0 &&
        targetVersions.join(',') !== baselineVersions.join(',')) {
      addWarning('Target processor versions [' + targetVersions.join(', ') +
          '] differ from baseline processor versions [' +
          baselineVersions.join(', ') + ']. Version caution — reported ' +
          'only, nothing is excluded.');
    }
    for (i = 0; i < noValidDates.length; i++) {
      addWarning('Target day ' + noValidDates[i] +
          ' has no valid regional value.');
    }
    if (nonNominalDates.length > 0) {
      addWarning('Target days with a contributing non-NOMINAL product ' +
          '(flagged, retained, never excluded): ' +
          nonNominalDates.join(', '));
    }
    if (lowFractionDates.length > 0) {
      addWarning('Target days with valid fraction below ' +
          CONFIG.lowFractionCaution + ' (coverage caution inherited from ' +
          'the sensitivity study — not an adopted exclusion rule): ' +
          lowFractionDates.join(', '));
    }

    /* ---- Period summary ---- */

    var targetMeans = [];
    var matchedMedians = [];
    var anomalies = [];
    var percentiles = [];
    var fractions = [];
    for (i = 0; i < validRows.length; i++) {
      targetMeans.push(validRows[i].mean);
      if (validRows[i].histMedian !== null) {
        matchedMedians.push(validRows[i].histMedian);
      }
      if (validRows[i].anomaly !== null) {
        anomalies.push(validRows[i].anomaly);
      }
      if (validRows[i].percentile !== null) {
        percentiles.push(validRows[i].percentile);
      }
      fractions.push(validRows[i].fraction);
    }
    function avg(list) {
      if (list.length === 0) return null;
      var total = 0;
      for (var a = 0; a < list.length; a++) total += list[a];
      return total / list.length;
    }

    summaryPanel.add(ui.Label(
        'Target-period summary (satellite NO2 column, exploratory)',
        STYLE.emph));
    summaryPanel.add(ui.Label(
        'Target dates requested: ' + targetDates.length +
            '; with valid data: ' + validRows.length +
            '; without valid data: ' + noValidDates.length,
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Mean target regional NO2 (valid days): ' +
            (avg(targetMeans) === null ? 'n/a' :
                fmtMol(avg(targetMeans)) + ' mol/m²') +
            '; mean of matched REGIONAL historical medians: ' +
            (avg(matchedMedians) === null ? 'n/a' :
                fmtMol(avg(matchedMedians)) + ' mol/m²'),
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Signed daily anomaly — mean ' +
            (avg(anomalies) === null ? 'n/a' : fmtMol(avg(anomalies))) +
            ', median ' +
            (anomalies.length ? fmtMol(median(anomalies)) : 'n/a') +
            ', min ' +
            (anomalies.length ?
                fmtMol(Math.min.apply(null, anomalies)) : 'n/a') +
            ', max ' +
            (anomalies.length ?
                fmtMol(Math.max.apply(null, anomalies)) : 'n/a') +
            ' mol/m²',
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Mean historical percentile rank: ' +
            (avg(percentiles) === null ? 'n/a' :
                avg(percentiles).toFixed(1)),
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Days above the 90th historical percentile (descriptive ' +
            'reference only): ' +
            (above90.length ? above90.length + ' (' + above90.join(', ') +
                ')' : '0'),
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Days below the 10th historical percentile (descriptive ' +
            'reference only): ' +
            (below10.length ? below10.length + ' (' + below10.join(', ') +
                ')' : '0'),
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Target days with a contributing non-NOMINAL product: ' +
            (nonNominalDates.length ? nonNominalDates.length + ' (' +
                nonNominalDates.join(', ') + ')' : '0'),
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Target valid fraction — ' +
            (fractions.length ?
                'min ' + Math.min.apply(null, fractions).toFixed(3) +
                ', median ' + median(fractions).toFixed(3) +
                ', max ' + Math.max.apply(null, fractions).toFixed(3) :
                'n/a (no valid days)'),
        STYLE.body));

    /* ---- Historical baseline sample panel ---- */

    baselinePanel.add(ui.Label('Historical baseline sample', STYLE.emph));
    var baselineAudit = [];
    for (i = 0; i < baseline.keys.length; i++) {
      var key2 = baseline.keys[i];
      var pk2 = baseline.perKey[key2];
      var yearParts = [];
      var actualYears = [];
      for (j = 0; j < pk2.windowYears.length; j++) {
        var yr = pk2.windowYears[j];
        var yearDays = histYearCounts[key2][yr] || 0;
        yearParts.push(yr + ': ' + yearDays);
        if (yearDays > 0) actualYears.push(yr);
      }
      var versionList2 = [];
      for (var vk2 in histVersionsByKey[key2]) {
        if (histVersionsByKey[key2].hasOwnProperty(vk2)) {
          versionList2.push(vk2);
        }
      }
      versionList2.sort();
      baselineAudit.push({
        targetYearMonth: key2,
        requestedPriorYears: pk2.requestedYears.length,
        priorYearsUsed: actualYears,
        priorYearLabels: pk2.windowYears,
        unavailableYears: pk2.unavailableYears,
        validHistoricalDays: histValuesByKey[key2].length,
        validDaysByYear: histYearCounts[key2],
        processorVersions: versionList2
      });
      baselinePanel.add(ui.Label(
          key2 + ': requested ' + pk2.requestedYears.length +
              ' prior years; used [' +
              (pk2.windowYears.join(', ') || 'none') + ']; valid ' +
              'historical regional days ' + histValuesByKey[key2].length +
              ' (' + (yearParts.join(', ') || 'none') + '); processor ' +
              'versions [' + (versionList2.join(', ') || 'none') + ']',
          STYLE.body));
    }
    baselinePanel.add(ui.Label(
        'Target-period processor versions: [' +
            (targetVersions.join(', ') || 'none') + ']',
        STYLE.body));
    baselinePanel.add(ui.Label(
        'Exploratory same-calendar-month historical median baseline — ' +
        'not a final climatology. All valid observations retained ' +
        'regardless of PRODUCT_QUALITY; no coverage threshold; valid ' +
        'negatives preserved; target-year and future dates never used. ' +
        'Limitation: historical contribution-level PRODUCT_QUALITY was ' +
        'not audited in the lightweight baseline path (target flags are ' +
        'contribution-audited).',
        STYLE.note));

    /* ---- Warnings panel ---- */

    if (warnings.length > 0) {
      warningsPanel.add(ui.Label('Warnings (also in the Console; none ' +
          'trigger exclusions or blocking):', STYLE.emph));
      for (i = 0; i < warnings.length; i++) {
        warningsPanel.add(ui.Label('⚠ ' + warnings[i], STYLE.warnLabel));
      }
    }

    /* ---- Console output ---- */

    print('Target daily records:', rows);
    print('Historical baseline daily records:', histDaily);
    print('Monthly baseline sample summaries:', baselineAudit);
    print('Target dates with contributing non-NOMINAL products:',
          nonNominalDates);
    print('Target dates below ' + CONFIG.lowFractionCaution +
          ' valid fraction (caution only):', lowFractionDates);
    print('Processor-version sets — target:', targetVersions,
          'baseline:', baselineVersions);
    print('Dates above the 90th percentile (descriptive):', above90);
    print('Dates below the 10th percentile (descriptive):', below10);
    print('Limitation: target-period non-NOMINAL flags are based on ' +
          'actual BAAQMD contribution; historical contribution-level ' +
          'PRODUCT_QUALITY was not audited in the lightweight baseline ' +
          'path. Historical valid observations are retained — consider ' +
          'this limitation when interpreting the baseline.');

    /* ---- No-data terminal state ---- */

    if (validRows.length === 0 && histDaily.length === 0) {
      state = {hasData: false};
      renderDisplay();
      setStatus(
          '⚠ No usable data: neither the target period nor the baseline ' +
          'windows returned valid Sentinel-5P satellite-column values ' +
          'over the study region. Try another range.',
          true);
      return;
    }

    /* ---- Charts ---- */

    chartsPanel.add(makeTargetVsHistChart(rows));
    chartsPanel.add(makeAnomalyChart(rows));
    chartsPanel.add(makePercentileChart(rows));
    chartsPanel.add(makeFractionChart(rows));

    /* ---- Lightweight display maps (never used for statistics) ---- */

    var targetMeanImg = null;
    var baselineMeanImg = null;
    var anomalyMeanImg = null;
    var minCountImg = null;
    // The target-period mean is independent of any baseline: build it
    // first so a missing baseline only disables baseline-dependent
    // layers, never the target map.
    try {
      var targetLight = buildLightDailyCollection(startStr, endStr,
          regionGeom);
      targetMeanImg = targetLight.mean().clip(regionGeom);

      var medianImgByKey = {};
      var countImgByKey = {};
      var keysWithWindows = [];
      for (i = 0; i < baseline.keys.length; i++) {
        var mk = baseline.keys[i];
        var winList = [];
        for (j = 0; j < baseline.windows.length; j++) {
          if (baseline.windows[j].key === mk) winList.push(baseline.windows[j]);
        }
        if (winList.length === 0) continue;
        var merged = null;
        for (j = 0; j < winList.length; j++) {
          var c = buildLightDailyCollection(winList[j].start,
              winList[j].end, regionGeom);
          merged = merged === null ? c : merged.merge(c);
        }
        medianImgByKey[mk] = merged.median();
        countImgByKey[mk] = merged.count();
        keysWithWindows.push(mk);
      }
      if (keysWithWindows.length > 0) {
        // Baseline display: mean of the month-matched pixel-wise median
        // images assigned to each target date (duplicates per date keep
        // the weighting consistent with the target period).
        var baselineImages = [];
        var countImages = [];
        for (i = 0; i < targetDates.length; i++) {
          var dk = targetDates[i].substring(0, 7);
          if (medianImgByKey[dk]) baselineImages.push(medianImgByKey[dk]);
        }
        for (i = 0; i < keysWithWindows.length; i++) {
          countImages.push(countImgByKey[keysWithWindows[i]]);
        }
        // Per-key anomaly images: target daily minus matched monthly
        // pixel-wise historical median, merged across keys, averaged.
        var anomalyColl = null;
        for (i = 0; i < keysWithWindows.length; i++) {
          var ak = keysWithWindows[i];
          var subset = targetLight.filter(
              ee.Filter.stringStartsWith('local_date', ak));
          var part = subtractBaseline(subset, medianImgByKey[ak]);
          anomalyColl = anomalyColl === null ?
              part : anomalyColl.merge(part);
        }
        baselineMeanImg =
            ee.ImageCollection(baselineImages).mean().clip(regionGeom);
        anomalyMeanImg = anomalyColl.mean().clip(regionGeom);
        minCountImg =
            ee.ImageCollection(countImages).min().clip(regionGeom);
      } else {
        baselinePanel.add(ui.Label(
            'No historical baseline windows are available for this ' +
            'target period: the mapped median, anomaly, and valid-day ' +
            'count map layers are unavailable. The target-period mean ' +
            'map remains available.',
            STYLE.note));
      }
    } catch (mapError) {
      addWarning('Map construction failed (' + mapError + ') — the ' +
          'statistical results above remain valid; only the map layers ' +
          'are affected.');
    }

    state = {
      hasData: true,
      startStr: startStr,
      endStr: endStr,
      targetMean: targetMeanImg,
      baselineMean: baselineMeanImg,
      anomalyMean: anomalyMeanImg,
      minCount: minCountImg,
      countVisMax: histYears * 31,
      anomalyDetailVis: null,
      countDetailVis: null,
      countRange: null
    };
    renderDisplay();

    // DISPLAY-ONLY detail stretches (anomaly 2/98-percentile limits and
    // the observed count range), fetched once per request after the
    // scientific terminal state. Token-guarded; never used for any
    // statistic, threshold, or exclusion.
    if (anomalyMeanImg !== null && minCountImg !== null) {
      computeDisplayStretches(anomalyMeanImg, minCountImg, token);
    }

    setStatus(
        validRows.length + ' of ' + targetDates.length + ' target days ' +
        'valid; mean signed anomaly ' +
        (avg(anomalies) === null ? 'n/a' :
            fmtMol(avg(anomalies)) + ' mol/m²') + '; ' +
        warnings.length + ' warning(s). Exploratory satellite-column ' +
        'results — not AQI, health, surface concentration, or episode ' +
        'declarations.',
        warnings.length > 0);
  }

  runTask(0);
}

/* -------------------------------------------------------------------- INIT */

ui.root.insert(1, buildPanel());
Map.centerObject(studyRegion.fc, 8);
refresh();
