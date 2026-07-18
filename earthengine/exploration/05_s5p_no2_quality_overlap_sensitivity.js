/*
 * Bay Area Air Quality Episode Finder
 * Exploration 05 — product quality, dual-contributor overlap, and
 * coverage sensitivity for Sentinel-5P OFFL NO2 (under evaluation)
 *
 * Purpose: DATA EXPLORATION ONLY. Evaluates three questions that must be
 * answered before the final daily rule is selected:
 *   1) QUALITY — do non-NOMINAL (e.g. DEGRADED) products contribute valid
 *      BAAQMD data, and does excluding them change the daily series?
 *   2) OVERLAP — on days with two valid contributing products, do the two
 *      orbits mainly provide complementary coverage or overlapping
 *      observations?
 *   3) COVERAGE — how would candidate minimum-coverage requirements
 *      (sensitivity scenarios only — NOT approved thresholds) change the
 *      retained-day count, seasonal sampling, and daily statistics?
 *
 * Foundations are taken from the live-tested exploration 04: the official
 * BAAQMD boundary handling, local-calendar-date filtering
 * (America/Los_Angeles local midnights), defensive PRODUCT_ID
 * reconstruction, the binary-mask contribution calculation with
 * unmask(0, false), area-weighted regional statistics at EPSG:3310 /
 * 7000 m (exploration-stage settings), the loading animation, and the
 * stale-request guard. Long selected ranges are evaluated as SEQUENTIAL
 * chunks of CONFIG.evaluationChunkDays local calendar days combined
 * client-side (a 90-day range previously timed out as one evaluation) —
 * chunking changes how work is submitted, never what is computed. The 04
 * live test
 * (2023-01-01 to 2023-04-01) found 1,276 orbit-product assets = 1,276
 * products = 1,276 orbits (one asset per product), 101 products with
 * valid BAAQMD data, and confirmed that fully non-contributing products
 * are ignored through masks (all-products vs valid-only daily means were
 * identical). This script therefore builds its daily images from VALID
 * CONTRIBUTORS (products with valid unmasked BAAQMD pixels).
 *
 * Every method here is an EXPLORATION-STAGE candidate: nothing is
 * excluded automatically, no coverage threshold is adopted, area
 * weighting and the CRS/scale remain under evaluation, and valid negative
 * NO2 retrievals are preserved. This script contains NO baselines,
 * anomalies, episode detection, thresholds, scoring, or modeling. The NO2
 * band is a TROPOSPHERIC VERTICAL COLUMN density (mol/m^2): an indicator
 * of column patterns, not a ground-level concentration, not an AQI value,
 * not a health measure, and not an episode result.
 *
 * How to run: paste this file into the Earth Engine Code Editor
 * (https://code.earthengine.google.com) and click Run. Structured audit
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

/*
 * Default range: the LATEST seven Bay Area local calendar days currently
 * represented in the OFFL collection. OFFL data has publication latency,
 * so the literal previous seven real-world days can contain no data —
 * the default is therefore anchored to the collection's newest
 * system:time_start instead of the wall clock.
 *
 * Implementation notes: fully ES5-compatible — the Earth Engine Code
 * Editor sandbox officially guarantees ES5, so Intl.DateTimeFormat,
 * formatToParts, and String.padStart are not safe assumptions there.
 * Daylight-saving safety comes from the explicit timezone argument to
 * ee.Date.advance(). The end date is the day AFTER the latest available
 * local date (end-exclusive), so the interval contains exactly seven
 * local calendar days, including the latest available one.
 *
 * This is a one-time synchronous metadata read at script load (like the
 * boundary-asset availability check below); everything after load stays
 * asynchronous.
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
  // Analysis period, 'YYYY-MM-DD' (start inclusive, end exclusive). The
  // DEFAULT is dynamic: the LATEST seven Bay Area local calendar days
  // currently represented in the OFFL collection, computed above from
  // the collection's newest system:time_start when the script loads.
  // OFFL data has publication latency, so this is NOT necessarily the
  // previous seven real-world days; the latest available local
  // collection date is DEFAULT_DATE_RANGE.latestAvailableLocalDate, and
  // the displayed End date is exclusive. The entered dates are Bay Area
  // LOCAL calendar dates: the collection is filtered between local
  // midnights in CONFIG.timeZone, and all daily grouping uses that same
  // local calendar date. Any other range can be entered manually in the
  // panel's date boxes.
  startDate: DEFAULT_DATE_RANGE.start,
  endDate: DEFAULT_DATE_RANGE.end,

  // Official BAAQMD jurisdiction boundary: uploaded California air-district
  // boundaries table asset, filtered to the Bay Area district (see
  // docs/data-sources.md). If the asset is unavailable (e.g., the running
  // account has no read access), the script falls back to the labeled
  // county approximation in getStudyRegion below.
  boundaryAssetId:
      'projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries',
  boundaryField: 'Air_Distri',
  boundaryValue: 'BAY AREA AQMD',

  // First dataset (owner-decided; see docs/data-sources.md) — the single
  // DATASET_ID constant defined above.
  collectionId: DATASET_ID,
  bandName: 'tropospheric_NO2_column_number_density',

  // Calendar-day grouping and date labels use the Bay Area local time
  // zone — the single DEFAULT_TIME_ZONE constant defined above.
  timeZone: DEFAULT_TIME_ZONE,

  // Regional-statistics configuration: explicit equal-area CRS
  // (EPSG:3310, California Albers, meters) at an explicit 7000 m scale —
  // no bestEffort, no reproject(). EXPLORATION settings, not final
  // scientific choices.
  statsCrs: 'EPSG:3310',
  statsScale: 7000,

  // Implementation-consistency tolerance for the all-quality vs
  // nominal-only daily comparison, in mol/m^2. ONLY a numerical
  // implementation-level tolerance — not a scientific threshold.
  diffTolerance: 1e-12,

  // Long selected ranges are evaluated as SEQUENTIAL chunks of this many
  // local calendar days (the final chunk may be shorter) and combined
  // client-side after every chunk completes. Purely an implementation
  // setting to keep each Earth Engine evaluation small enough to avoid
  // computation timeouts (a 90-day range previously timed out as one
  // evaluation) — it has no scientific meaning, and the rolling
  // seven-day default remains a single chunk.
  evaluationChunkDays: 7,

  // Coverage-sensitivity candidates. SENSITIVITY SCENARIOS ONLY — none of
  // these is an approved minimum-coverage threshold.
  coverageCandidates: [
    {label: 'Any valid coverage', min: 0, strict: true},
    {label: 'At least 0.20', min: 0.20, strict: false},
    {label: 'At least 0.40', min: 0.40, strict: false},
    {label: 'At least 0.60', min: 0.60, strict: false}
  ],

  // Fixed display stretch in mol/m^2 for the context period-mean layer.
  // Display-only — not an air-quality threshold, AQI, health category, or
  // analysis parameter. Same ramp, range, and opacity as scripts 03–04.
  vis: {
    min: 0,
    max: 0.0002,
    palette: ['fff7ec', 'fee8c8', 'fdbb84', 'fc8d59', 'ef6548', 'd7301f',
              '990000']
  },
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

/*
 * startLocal / endLocal are ee.Date LOCAL-midnight instants
 * (America/Los_Angeles, end-exclusive). The filterBounds means each
 * returned collection member's geometry/footprint INTERSECTS the study
 * region — it does NOT mean the member contains valid NO2 measurements
 * inside BAAQMD.
 */
function loadRawCollection(regionGeom, startLocal, endLocal) {
  return ee.ImageCollection(CONFIG.collectionId)
      .select(CONFIG.bandName)
      .filterDate(startLocal, endLocal)
      .filterBounds(regionGeom);
}

/*
 * Total BAAQMD area in m^2, computed ONCE per refresh with
 * ee.Image.pixelArea() summed over the region at the explicit
 * CONFIG.statsCrs / CONFIG.statsScale — no bestEffort, no reproject().
 */
function computeTotalAreaM2(regionGeom) {
  return ee.Number(ee.Image.pixelArea().rename('area').reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: regionGeom,
    crs: CONFIG.statsCrs,
    scale: CONFIG.statsScale,
    maxPixels: 1e10
  }).get('area'));
}

// Binary valid-pixel indicator with zero fill everywhere: .gt(0) converts
// the source mask (which can hold fractional values) to a presence
// indicator, and unmask(0, false) — sameFootprint = false — makes masked
// and outside-footprint locations numeric zero throughout the reduction
// region. Identical construction to the live-tested script 04.
function binaryValidMask(image) {
  return image.mask()
      .gt(0)
      .rename('valid_mask')
      .unmask(0, false);
}

/*
 * One combined regional ee.Reducer.sum() over two diagnostic bands
 * (identical to the live-tested script 04 construction):
 *   valid_area_m2 — pixelArea × binary valid-mask (numeric zero where
 *                   invalid or outside the product footprint, so a
 *                   product with no valid BAAQMD pixel returns numeric
 *                   zero, never null);
 *   weighted_no2  — NO2 × pixelArea × binary valid-mask; valid NEGATIVE
 *                   NO2 retrievals are preserved — never clamped or
 *                   masked for being negative.
 * BAAQMD geometry supplied directly; explicit CONFIG.statsCrs /
 * CONFIG.statsScale; no bestEffort; no reproject().
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

// Area-weighted regional mean from contributionSums output:
// sum(NO2 × valid pixel area) / sum(valid pixel area); null when the
// valid area is zero. Area weighting is an EXPLORATION-STAGE candidate
// method, not a validated final choice.
function areaWeightedMean(sums) {
  var validArea = ee.Number(sums.get('valid_area_m2'));
  return ee.Algorithms.If(
      validArea.gt(0),
      ee.Number(sums.get('weighted_no2')).divide(validArea),
      null);
}

/*
 * DEFENSIVE product reconstruction, identical to the live-tested script
 * 04: members grouped by PRODUCT_ID; only same-PRODUCT_ID assets are
 * mosaicked (never distinct products); metadata copied defensively from
 * the first asset (absent stays absent — nothing invented); earliest
 * asset timestamp used; local_date in America/Los_Angeles
 * ('yyyy-MM-dd' — calendar year, not Joda week-based 'YYYY'). The live
 * test found one asset per product; the grouping remains only for the
 * official antimeridian two-asset exception.
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
    // has_valid_baaqmd_data is intentionally numeric 1/0 (ee.Number.gt),
    // consistent with ee.Filter.eq('has_valid_baaqmd_data', 1) and the
    // client-side check p.has_valid === 1.
    return image.set({
      'PRODUCT_ID': pid,
      'asset_count_for_product': memberAssets.size(),
      'system:time_start': t0,
      'local_date': ee.Date(t0).format('yyyy-MM-dd', CONFIG.timeZone),
      'baaqmd_valid_area_m2': validArea,
      'baaqmd_valid_fraction': validArea.divide(totalAreaM2),
      'baaqmd_area_weighted_mean_no2': areaWeightedMean(sums),
      'has_valid_baaqmd_data': validArea.gt(0)
    });
  });
  return ee.ImageCollection.fromImages(images);
}

/*
 * One daily image from a (possibly empty) set of contributing products:
 * pixel-wise arithmetic mean of the contributors, or a correctly named,
 * fully masked placeholder (double, same band name) when the set is
 * empty, so every date stays traceable. mosaic() is NEVER used to choose
 * between distinct products.
 */
function makeDailyImage(dateStr, contributors, methodName, placeholderName) {
  var count = contributors.size();
  var placeholder = ee.Image.constant(0).double()
      .rename(CONFIG.bandName)
      .updateMask(ee.Image.constant(0));
  var image = ee.Image(ee.Algorithms.If(
      count.gt(0), contributors.mean(), placeholder));
  return image.set({
    'system:time_start': ee.Date(dateStr, CONFIG.timeZone).millis(),
    'date_string': dateStr,
    'daily_method': ee.Algorithms.If(count.gt(0), methodName,
        placeholderName),
    'contributor_count': count,
    'product_ids': contributors.aggregate_array('PRODUCT_ID'),
    'orbit_numbers': contributors.aggregate_array('ORBIT')
  });
}

/*
 * Two same-local-date daily collections built from VALID CONTRIBUTORS
 * (products with valid unmasked BAAQMD pixels — the definition confirmed
 * by the script 04 live test):
 *   allQuality  — every valid contributor, regardless of PRODUCT_QUALITY;
 *   nominalOnly — valid contributors whose PRODUCT_QUALITY is exactly
 *                 'NOMINAL' (a missing PRODUCT_QUALITY therefore does NOT
 *                 qualify). Dates with no nominal contributor keep a
 *                 fully masked placeholder.
 * Both use the same local dates and the same local-midnight
 * system:time_start, so they align by calendar date. Degraded products
 * are NEVER excluded from the primary (allQuality) series — the
 * nominal-only series exists purely to measure what exclusion WOULD do.
 */
function buildQualityDailyCollections(products) {
  var dates = ee.List(products.aggregate_array('local_date'))
      .distinct().sort();

  var allQuality = ee.ImageCollection.fromImages(dates.map(function (d) {
    d = ee.String(d);
    var contributors = products
        .filter(ee.Filter.eq('local_date', d))
        .filter(ee.Filter.eq('has_valid_baaqmd_data', 1));
    return makeDailyImage(d, contributors,
        'mean_valid_contributors_all_quality',
        'placeholder_no_valid_contributor');
  }));

  var nominalOnly = ee.ImageCollection.fromImages(dates.map(function (d) {
    d = ee.String(d);
    var contributors = products
        .filter(ee.Filter.eq('local_date', d))
        .filter(ee.Filter.eq('has_valid_baaqmd_data', 1))
        .filter(ee.Filter.eq('PRODUCT_QUALITY', 'NOMINAL'));
    return makeDailyImage(d, contributors,
        'mean_valid_contributors_nominal_only',
        'placeholder_no_nominal_contributor');
  }));

  return {dates: dates, allQuality: allQuality, nominalOnly: nominalOnly};
}

/*
 * Dual-contributor overlap measurement for one date with EXACTLY two
 * valid contributors. One combined regional ee.Reducer.sum() over four
 * fully unmasked diagnostic bands built from the two binary valid masks:
 *   intersection_area_m2 — pixelArea × maskA × maskB (both valid);
 *   union_area_m2        — pixelArea × max(maskA, maskB) (either valid);
 *   only_a_pixels        — count of reduction-grid pixels valid in A only;
 *   only_b_pixels        — count of reduction-grid pixels valid in B only.
 * Same geometry / CRS / scale as every other regional statistic; no
 * bestEffort; no reproject(). No overlap threshold is imposed — this only
 * measures whether the two orbits are complementary or overlapping.
 * Contributors are ordered by acquisition time (A = earlier).
 */
function overlapFeature(dateStr, contributors, totalAreaM2, regionGeom) {
  var ordered = contributors.sort('system:time_start').toList(2);
  var a = ee.Image(ordered.get(0));
  var b = ee.Image(ordered.get(1));
  var maskA = binaryValidMask(a);
  var maskB = binaryValidMask(b);
  var pixelArea = ee.Image.pixelArea();
  var bands = pixelArea.multiply(maskA.multiply(maskB))
          .rename('intersection_area_m2')
      .addBands(pixelArea.multiply(maskA.max(maskB))
          .rename('union_area_m2'))
      .addBands(maskA.multiply(maskB.not()).rename('only_a_pixels'))
      .addBands(maskB.multiply(maskA.not()).rename('only_b_pixels'));
  var sums = bands.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: regionGeom,
    crs: CONFIG.statsCrs,
    scale: CONFIG.statsScale,
    maxPixels: 1e10
  });
  return ee.Feature(null, {
    series: 'overlap',
    millis: ee.Date(dateStr, CONFIG.timeZone).millis(),
    date_string: dateStr,
    product_id_a: a.get('PRODUCT_ID'),
    orbit_a: a.get('ORBIT'),
    valid_fraction_a: a.get('baaqmd_valid_fraction'),
    valid_area_a_m2: a.get('baaqmd_valid_area_m2'),
    product_id_b: b.get('PRODUCT_ID'),
    orbit_b: b.get('ORBIT'),
    valid_fraction_b: b.get('baaqmd_valid_fraction'),
    valid_area_b_m2: b.get('baaqmd_valid_area_m2'),
    intersection_area_m2: sums.get('intersection_area_m2'),
    union_area_m2: sums.get('union_area_m2'),
    only_a_pixels: sums.get('only_a_pixels'),
    only_b_pixels: sums.get('only_b_pixels'),
    total_baaqmd_area_m2: totalAreaM2
  });
}

/*
 * One merged FeatureCollection carrying everything the UI needs, in a
 * single server round trip:
 *   'collection_meta' — raw member count (grouping cross-check);
 *   'product'         — identity, quality/version metadata (absent stays
 *                       absent), and BAAQMD contribution numbers;
 *   'daily'           — per local date: contributor counts and the
 *                       all-quality vs nominal-only daily area-weighted
 *                       means and valid fractions (same valid-area
 *                       method throughout);
 *   'overlap'         — one feature per date with exactly two valid
 *                       contributors.
 */
function buildEvaluationFeatures(raw, products, daily, regionGeom,
                                 totalAreaM2) {
  var collectionMeta = ee.FeatureCollection([
    ee.Feature(null, {series: 'collection_meta', raw_count: raw.size()})
  ]);

  var productFeatures = ee.FeatureCollection(products.map(function (image) {
    return ee.Feature(null, {
      series: 'product',
      millis: image.get('system:time_start'),
      product_id: image.get('PRODUCT_ID'),
      orbit: image.get('ORBIT'),
      asset_count_for_product: image.get('asset_count_for_product'),
      local_date: image.get('local_date'),
      product_quality: image.get('PRODUCT_QUALITY'),
      processing_status: image.get('PROCESSING_STATUS'),
      processor_version: image.get('PROCESSOR_VERSION'),
      algorithm_version: image.get('ALGORITHM_VERSION'),
      valid_area_m2: image.get('baaqmd_valid_area_m2'),
      valid_fraction: image.get('baaqmd_valid_fraction'),
      area_weighted_mean_no2: image.get('baaqmd_area_weighted_mean_no2'),
      has_valid: image.get('has_valid_baaqmd_data')
    });
  }));

  var dailyFeatures = ee.FeatureCollection(daily.dates.map(function (d) {
    d = ee.String(d);
    var allImg = ee.Image(
        daily.allQuality.filter(ee.Filter.eq('date_string', d)).first());
    var nomImg = ee.Image(
        daily.nominalOnly.filter(ee.Filter.eq('date_string', d)).first());
    var allSums = contributionSums(allImg, regionGeom);
    var nomSums = contributionSums(nomImg, regionGeom);
    return ee.Feature(null, {
      series: 'daily',
      millis: ee.Date(d, CONFIG.timeZone).millis(),
      date_string: d,
      valid_contributor_count: allImg.get('contributor_count'),
      nominal_contributor_count: nomImg.get('contributor_count'),
      all_quality_mean: areaWeightedMean(allSums),
      nominal_only_mean: areaWeightedMean(nomSums),
      all_quality_fraction:
          ee.Number(allSums.get('valid_area_m2')).divide(totalAreaM2),
      nominal_only_fraction:
          ee.Number(nomSums.get('valid_area_m2')).divide(totalAreaM2)
    });
  }));

  // Overlap features only for dates with EXACTLY two valid contributors
  // (dropNulls removes every other date).
  var overlapFeatures = ee.FeatureCollection(
      daily.dates.map(function (d) {
        d = ee.String(d);
        var contributors = products
            .filter(ee.Filter.eq('local_date', d))
            .filter(ee.Filter.eq('has_valid_baaqmd_data', 1));
        return ee.Algorithms.If(
            contributors.size().eq(2),
            overlapFeature(d, contributors, totalAreaM2, regionGeom),
            null);
      }, true));

  return collectionMeta.merge(productFeatures).merge(dailyFeatures)
      .merge(overlapFeatures);
}

/*
 * Server construction for ONE evaluation chunk [chunkStart, chunkEnd):
 * exactly the tested per-product / daily / overlap science of this
 * script, unchanged, restricted to the chunk's local-date window. No
 * summaries, charts, warnings, or sensitivity scenarios are computed
 * here — those remain client-side after ALL chunks have completed.
 * Chunking only changes how the work is submitted to Earth Engine, never
 * what is computed.
 */
function buildChunkEvaluation(chunkStart, chunkEnd, regionGeom,
                              totalAreaM2) {
  var startLocal = ee.Date(chunkStart, CONFIG.timeZone);
  var endLocal = ee.Date(chunkEnd, CONFIG.timeZone);
  var raw = loadRawCollection(regionGeom, startLocal, endLocal);
  var products = buildProductImages(raw, regionGeom, totalAreaM2);
  var daily = buildQualityDailyCollections(products);
  return buildEvaluationFeatures(raw, products, daily, regionGeom,
      totalAreaM2);
}

/*
 * LIGHTWEIGHT whole-range period mean for the context map ONLY: pure
 * pixel operations — defensive product mosaics and daily means with NO
 * per-product regional reductions, no contribution properties, and no
 * has_valid filtering. It uses ALL orbit products and relies on Earth
 * Engine masks: the script 04 live test established that products with
 * no valid BAAQMD pixels do not alter the masked result, so this matches
 * the all-quality daily display intent. NEVER used for regional
 * statistics, quality auditing, overlap auditing, or sensitivity
 * results. Only this returned display copy is clipped.
 */
function buildDisplayPeriodMean(startStr, endStr, regionGeom) {
  var startLocal = ee.Date(startStr, CONFIG.timeZone);
  var endLocal = ee.Date(endStr, CONFIG.timeZone);
  var raw = loadRawCollection(regionGeom, startLocal, endLocal);
  var ids = ee.List(raw.aggregate_array('PRODUCT_ID')).distinct();
  var products = ee.ImageCollection.fromImages(ids.map(function (pid) {
    var memberAssets = raw.filter(ee.Filter.eq('PRODUCT_ID', pid));
    var t0 = memberAssets.aggregate_min('system:time_start');
    return memberAssets.mosaic().set({
      'local_date': ee.Date(t0).format('yyyy-MM-dd', CONFIG.timeZone)
    });
  }));
  var dates = ee.List(products.aggregate_array('local_date')).distinct();
  var daily = ee.ImageCollection.fromImages(dates.map(function (d) {
    return products.filter(ee.Filter.eq('local_date', ee.String(d)))
        .mean();
  }));
  return daily.mean().clip(regionGeom);
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
  allColor: '#2a78d6',      // all-quality daily series (blue)
  nominalColor: '#c2610f',  // nominal-only daily series (orange)
  fractionColor: '#4d7d64', // daily valid-fraction bars (muted green)
  refColor: '#8a8985',      // sensitivity-candidate reference lines
  overlapColor: '#6a51a3',  // overlap-of-union bars (purple)
  overlapTotalColor: '#cdccc8', // overlap-of-total bars (subdued gray)
  versionColors: ['#2a78d6', '#c2610f', '#4d7d64', '#6a51a3', '#8a8985'],
  grid: '#e1e0d9'
};

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

// '0' for zero, exponential notation otherwise (e.g., '2.0e-5').
function fmtMol(v) {
  return v === 0 ? '0' : v.toExponential(1);
}

// Whole calendar days in [startStr, endStr). Client-side UI arithmetic on
// the validated date strings only; the local-midnight filter window spans
// exactly this many Bay Area local calendar days.
function daysBetween(startStr, endStr) {
  return Math.round((Date.parse(endStr) - Date.parse(startStr)) / 86400000);
}

function median(values) {
  var s = values.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Chronological list of 'YYYY-MM' buckets covering every year-month in
// [startStr, endStr) — works for the seven-day default and for manually
// entered multi-month ranges alike. ES5 only (no padStart).
function yearMonthsInRange(startStr, endStr) {
  var months = [];
  var y = Number(startStr.substring(0, 4));
  var m = Number(startStr.substring(5, 7));
  var last = new Date(Date.parse(endStr) - 86400000); // last included day
  var lastY = last.getUTCFullYear();
  var lastM = last.getUTCMonth() + 1;
  while (y < lastY || (y === lastY && m <= lastM)) {
    months.push(y + '-' + (m < 10 ? '0' + m : String(m)));
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

// 'YYYY-MM-DD' from a UTC millisecond timestamp (ES5; no padStart).
function utcDateString(ms) {
  var d = new Date(ms);
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : String(m)) + '-' +
      (day < 10 ? '0' + day : String(day));
}

/*
 * Divides [startStr, endStr) into consecutive non-overlapping chunks of
 * at most chunkDays local calendar dates: start inclusive, end
 * exclusive, no missing or duplicated dates, final chunk possibly
 * shorter. The arithmetic runs on UTC calendar components derived from
 * the 'YYYY-MM-DD' strings (which parse as UTC midnight), so the browser
 * timezone and daylight-saving transitions cannot shift the calendar
 * dates. Earth Engine filtering inside each chunk still constructs
 * LOCAL midnights from these strings with CONFIG.timeZone.
 */
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

function byTime(a, b) { return a.t - b.t; }

// Google Charts DataTable date literals built from UTC components (months
// are zero-based in this format).
function toChartDateTime(millis) {
  var d = new Date(millis);
  return 'Date(' + d.getUTCFullYear() + ',' + d.getUTCMonth() + ',' +
      d.getUTCDate() + ',' + d.getUTCHours() + ',' + d.getUTCMinutes() + ')';
}

/*
 * All-quality vs nominal-only daily area-weighted regional means, aligned
 * by the shared local-midnight timestamps. Missing values (placeholder
 * days) are real gaps — never interpolated.
 */
function makeQualityComparisonChart(dailyRows, startStr, endStr) {
  var rows = [];
  for (var i = 0; i < dailyRows.length; i++) {
    rows.push({c: [
      {v: toChartDateTime(dailyRows[i].t)},
      {v: dailyRows[i].allMean},
      {v: dailyRows[i].nominalMean}
    ]});
  }
  return ui.Chart({
    dataTable: {
      cols: [
        {id: 'time', label: 'Local calendar day', type: 'datetime'},
        {id: 'all', label: 'All valid contributors (any quality)',
         type: 'number'},
        {id: 'nom', label: 'NOMINAL-quality contributors only',
         type: 'number'}
      ],
      rows: rows
    },
    chartType: 'LineChart',
    options: {
      title: 'Daily BAAQMD area-weighted mean NO2 — all-quality vs ' +
          'nominal-only contributors, ' + startStr + ' to ' + endStr,
      titleTextStyle: {fontSize: 12, bold: false},
      interpolateNulls: false, // a placeholder day is a real gap
      hAxis: {gridlines: {color: STYLE.grid}},
      vAxis: {
        title: 'mol/m²',
        format: 'scientific',
        gridlines: {color: STYLE.grid}
      },
      series: {
        0: {lineWidth: 1, pointSize: 3, color: STYLE.allColor},
        1: {lineWidth: 1, pointSize: 3, color: STYLE.nominalColor}
      },
      legend: {position: 'top', textStyle: {fontSize: 11}},
      chartArea: {left: 64, right: 16, top: 48, bottom: 32}
    }
  });
}

/*
 * Daily valid fraction (all-quality contributors) as bars, with constant
 * reference lines at the 0.20 / 0.40 / 0.60 coverage-sensitivity
 * candidates — clearly labeled candidates, NOT approved thresholds.
 */
function makeFractionChart(dailyRows) {
  var rows = [];
  for (var i = 0; i < dailyRows.length; i++) {
    rows.push({c: [
      {v: toChartDateTime(dailyRows[i].t)},
      {v: dailyRows[i].allFraction},
      {v: 0.20},
      {v: 0.40},
      {v: 0.60}
    ]});
  }
  return ui.Chart({
    dataTable: {
      cols: [
        {id: 'day', label: 'Local calendar day', type: 'datetime'},
        {id: 'frac', label: 'Daily valid fraction', type: 'number'},
        {id: 'c20', label: 'Candidate 0.20 (sensitivity only)',
         type: 'number'},
        {id: 'c40', label: 'Candidate 0.40 (sensitivity only)',
         type: 'number'},
        {id: 'c60', label: 'Candidate 0.60 (sensitivity only)',
         type: 'number'}
      ],
      rows: rows
    },
    chartType: 'ComboChart',
    options: {
      title: 'Daily BAAQMD valid-area fraction with coverage-sensitivity ' +
          'candidates (no threshold adopted)',
      titleTextStyle: {fontSize: 12, bold: false},
      seriesType: 'bars',
      hAxis: {gridlines: {color: STYLE.grid}},
      vAxis: {
        title: 'fraction of region area',
        viewWindow: {min: 0, max: 1},
        gridlines: {color: STYLE.grid}
      },
      series: {
        0: {color: STYLE.fractionColor},
        1: {type: 'line', lineWidth: 1, pointSize: 0, color: STYLE.refColor,
            lineDashStyle: [4, 4]},
        2: {type: 'line', lineWidth: 1, pointSize: 0, color: STYLE.refColor,
            lineDashStyle: [8, 4]},
        3: {type: 'line', lineWidth: 1, pointSize: 0, color: STYLE.refColor,
            lineDashStyle: [2, 2]}
      },
      legend: {position: 'top', textStyle: {fontSize: 10}},
      chartArea: {left: 64, right: 16, top: 48, bottom: 32}
    }
  });
}

/*
 * Dual-contributor overlap per date: intersection area as a fraction of
 * the union of the two valid areas (primary) and of total BAAQMD area
 * (subdued comparison).
 */
function makeOverlapChart(overlapRows) {
  var rows = [];
  for (var i = 0; i < overlapRows.length; i++) {
    rows.push({c: [
      {v: toChartDateTime(overlapRows[i].t)},
      {v: overlapRows[i].overlapOfUnion},
      {v: overlapRows[i].overlapOfTotal}
    ]});
  }
  return ui.Chart({
    dataTable: {
      cols: [
        {id: 'day', label: 'Local calendar day', type: 'datetime'},
        {id: 'ofUnion', label: 'Overlap ÷ union of valid areas',
         type: 'number'},
        {id: 'ofTotal', label: 'Overlap ÷ total BAAQMD area',
         type: 'number'}
      ],
      rows: rows
    },
    chartType: 'ColumnChart',
    options: {
      title: 'Dual-contributor days — overlap between the two valid ' +
          'contributors (no threshold imposed)',
      titleTextStyle: {fontSize: 12, bold: false},
      hAxis: {gridlines: {color: STYLE.grid}},
      vAxis: {
        title: 'fraction',
        viewWindow: {min: 0, max: 1},
        gridlines: {color: STYLE.grid}
      },
      series: {
        0: {color: STYLE.overlapColor},
        1: {color: STYLE.overlapTotalColor}
      },
      legend: {position: 'top', textStyle: {fontSize: 11}},
      chartArea: {left: 64, right: 16, top: 48, bottom: 32}
    }
  });
}

/*
 * Daily categorical summary of processor versions: stacked columns of
 * valid contributors per PROCESSOR_VERSION per local day (series built
 * dynamically from the versions actually present; missing version is
 * shown as its own category).
 */
function makeVersionChart(dailyRows, versionKeys, perDateVersionCounts) {
  var cols = [{id: 'day', label: 'Local calendar day', type: 'datetime'}];
  var i;
  for (i = 0; i < versionKeys.length; i++) {
    cols.push({id: 'v' + i, label: 'PROCESSOR_VERSION ' + versionKeys[i],
               type: 'number'});
  }
  var rows = [];
  for (i = 0; i < dailyRows.length; i++) {
    var cells = [{v: toChartDateTime(dailyRows[i].t)}];
    var counts = perDateVersionCounts[dailyRows[i].date] || {};
    for (var k = 0; k < versionKeys.length; k++) {
      cells.push({v: counts[versionKeys[k]] || 0});
    }
    rows.push({c: cells});
  }
  var series = {};
  for (i = 0; i < versionKeys.length; i++) {
    series[i] = {color:
        STYLE.versionColors[i % STYLE.versionColors.length]};
  }
  return ui.Chart({
    dataTable: {cols: cols, rows: rows},
    chartType: 'ColumnChart',
    options: {
      title: 'Valid contributors per local day by PROCESSOR_VERSION',
      titleTextStyle: {fontSize: 12, bold: false},
      isStacked: true,
      hAxis: {gridlines: {color: STYLE.grid}},
      vAxis: {
        title: 'valid contributors',
        viewWindow: {min: 0},
        format: '0',
        gridlines: {color: STYLE.grid}
      },
      series: series,
      legend: {position: 'top', textStyle: {fontSize: 10}},
      chartArea: {left: 64, right: 16, top: 48, bottom: 32}
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

// Result cache for the latest completed refresh: {hasData, startStr,
// endStr, periodMean} — periodMean is a display-only clipped copy of the
// all-quality valid-contributor period mean, shown for context.
var state = null;

// Guards against out-of-order async results when Update is clicked again
// before the previous computation finishes.
var refreshToken = 0;

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
var updateButton = ui.Button({label: 'Update', onClick: refresh});

var statusLabel = ui.Label('', STYLE.status);
var warningsPanel = ui.Panel();
var qualityPanel = ui.Panel();
var comparisonPanel = ui.Panel();
var versionPanel = ui.Panel();
var overlapPanel = ui.Panel();
var coveragePanel = ui.Panel();
var chartsPanel = ui.Panel();

function setStatus(text, isWarning) {
  statusLabel.setValue(text);
  statusLabel.style().set('color', isWarning ? STYLE.warn : '#52514e');
}

/*
 * Loading-state animation for the status label. Exactly one timer can
 * exist at a time: `loadingTimerId` holds the key returned by
 * ui.util.setInterval (null when idle), startLoadingAnimation() always
 * clears any previous timer first, and the timer is stopped with
 * ui.util.clearTimeout() when the CURRENT request reaches any terminal
 * state (success, evaluation error, or no-data). Stale callbacks from
 * superseded requests return on the refresh-token check before they can
 * touch the loading state. Only the trailing dots change — the colors are
 * fixed, not flashing.
 */
var LOADING_DOTS = ['', '.', '..', '...'];
// Rendered on its own line below the animated text (whiteSpace: 'pre'
// makes the label honor the newline).
var LOADING_SUFFIX = '\nLong ranges are evaluated in sequential ' +
    CONFIG.evaluationChunkDays + '-day chunks.';
var loadingTimerId = null;
// Progress base text (e.g. 'Computing chunk 2 of 13'). Updated between
// chunks via setLoadingProgress() WITHOUT restarting or duplicating the
// single timer; the dots keep animating on that timer.
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
// Mirrors STYLE.status so ending the animation restores the normal look
// (including normal text wrapping); setStatus() then applies the
// success/warning color.
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

// Called when a chunk begins: swaps the base text in place. The one
// existing timer keeps animating the dots — no restart, no duplicate.
function setLoadingProgress(baseText) {
  loadingBaseText = baseText;
  if (loadingTimerId !== null) {
    renderLoadingFrame();
  }
}

function stopLoadingAnimation() {
  if (loadingTimerId !== null) {
    ui.util.clearTimeout(loadingTimerId);
    loadingTimerId = null;
  }
  statusLabel.style().set(NORMAL_STATUS_STYLE);
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

// Horizontal row of small labels spread across the panel width.
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
      'Exploration 05 — quality, overlap, and coverage sensitivity ' +
      '(under evaluation)',
      STYLE.subtitle));

  panel.add(ui.Label(
      'What this evaluates, before any daily rule is selected: (1) ' +
      'whether non-NOMINAL products contribute valid BAAQMD data and ' +
      'what excluding them WOULD change (nothing is excluded ' +
      'automatically); (2) whether the two contributors on ' +
      'dual-contributor days overlap or complement each other; (3) how ' +
      'candidate coverage requirements (0.20 / 0.40 / 0.60 — sensitivity ' +
      'scenarios only, NOT approved thresholds) would change the ' +
      'retained-day count and daily statistics.',
      STYLE.body));
  panel.add(ui.Label(
      'Daily images are built from VALID CONTRIBUTORS — products with ' +
      'valid unmasked NO2 pixels over BAAQMD (the definition confirmed ' +
      'by the exploration 04 live test; footprint intersection alone is ' +
      'not contribution). All statistics are area-weighted at ' +
      CONFIG.statsCrs + ' / ' + CONFIG.statsScale + ' m — ' +
      'exploration-stage settings under owner evaluation, not final ' +
      'choices. Valid negative NO2 retrievals are preserved.',
      STYLE.emph));
  panel.add(ui.Label(
      'The NO2 band is a tropospheric vertical column density (mol/m²) — ' +
      'an indicator of pollution patterns in the atmospheric column, not ' +
      'a ground-level concentration, not an AQI value, not a health ' +
      'measure, and not an episode result.',
      STYLE.body));

  if (studyRegion.isApproximation) {
    panel.add(ui.Label(
        'Boundary note: the outline shown is a county-based approximation ' +
        'of the BAAQMD jurisdiction (Solano and Sonoma are included in ' +
        'full, which overstates the northern extent). It will be replaced ' +
        'by the official BAAQMD boundary asset.',
        STYLE.note));
  }

  panel.add(ui.Panel({
    widgets: [
      ui.Label('Start', STYLE.note), startBox,
      ui.Label('End', STYLE.note), endBox,
      updateButton
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  }));
  panel.add(ui.Label(
      'Latest available local collection date: ' +
      DEFAULT_DATE_RANGE.latestAvailableLocalDate + '. The default range ' +
      'above is the latest seven Bay Area local calendar days ' +
      'represented in the OFFL collection — not necessarily the previous ' +
      'seven real-world days, because OFFL data has publication latency. ' +
      'The End date is exclusive; another range can be entered manually.',
      STYLE.note));

  panel.add(statusLabel);
  panel.add(warningsPanel);
  panel.add(qualityPanel);
  panel.add(comparisonPanel);
  panel.add(versionPanel);
  panel.add(overlapPanel);
  panel.add(coveragePanel);
  panel.add(chartsPanel);

  // Context map layer legend (single fixed display stretch).
  panel.add(ui.Label('Legend — context map layer (display only)',
                     STYLE.emph));
  panel.add(makeColorBar(CONFIG.vis.palette));
  panel.add(labelRow([
    fmtMol(CONFIG.vis.min),
    fmtMol((CONFIG.vis.min + CONFIG.vis.max) / 2),
    fmtMol(CONFIG.vis.max) + ' mol/m²'
  ]));
  panel.add(ui.Label(
      'All-quality context map: period mean of daily means built from ' +
      'all orbit products through a lightweight masked-image path (no ' +
      'per-product regional reductions; the script 04 live test showed ' +
      'non-contributing products do not alter the masked result). ' +
      'Display only — never used for statistics or audits; clipped to ' +
      'the study region. Colors are a numerical display stretch — not ' +
      'an AQI, not health categories, and not a pollution/no-pollution ' +
      'classification.',
      STYLE.note));

  panel.add(ui.Label(
      'Notes: dates are Bay Area local calendar dates (filtered between ' +
      'local midnights in ' + CONFIG.timeZone + ', end exclusive). The ' +
      'default range is the latest seven Bay Area local calendar days ' +
      'currently represented in the OFFL collection (latest available ' +
      'local date: ' + DEFAULT_DATE_RANGE.latestAvailableLocalDate +
      ') — not necessarily the previous seven real-world days, because ' +
      'OFFL data has publication latency. The End date is exclusive; any ' +
      'other range can be entered manually. The ' +
      fmtMol(CONFIG.diffTolerance) + ' mol/m² comparison tolerance is an ' +
      'implementation-consistency check only, not a scientific ' +
      'threshold. Charts never interpolate missing values. Structured ' +
      'audit output is printed to the Console. This request computes one ' +
      'regional reduction per product, two per day, and one per ' +
      'dual-contributor day; long selected ranges are evaluated in ' +
      'sequential ' + CONFIG.evaluationChunkDays + '-day chunks and ' +
      'combined client-side after all chunks complete.',
      STYLE.note));
  panel.add(ui.Label({
    value: 'Project documentation (GitHub)',
    style: STYLE.note,
    targetUrl:
        'https://github.com/perez-eduardo/Bay-Area-Air-Quality-Episode-Finder'
  }));

  return panel;
}

/* --------------------------------------------------------------------- MAP */

// Context display only: the all-quality valid-contributor period mean.
function renderDisplay() {
  if (state === null || !state.hasData) {
    Map.layers().reset([boundaryLayer]);
    return;
  }
  Map.layers().reset([
    ui.Map.Layer(state.periodMean, CONFIG.vis,
        'Period mean NO2 — all-quality context (display only), ' +
            state.startStr + ' to ' + state.endStr,
        true, CONFIG.layerOpacity),
    boundaryLayer
  ]);
}

/* ----------------------------------------------------------------- REFRESH */

function refresh() {
  var startStr = startBox.getValue();
  var endStr = endBox.getValue();

  if (!isIsoDate(startStr) || !isIsoDate(endStr)) {
    setStatus('⚠ Dates must be valid and formatted YYYY-MM-DD.', true);
    return;
  }
  if (startStr >= endStr) { // ISO date strings compare lexicographically
    setStatus('⚠ Start date must be before end date.', true);
    return;
  }

  startLoadingAnimation();
  updateButton.setDisabled(true); // date fields and map controls stay live
  warningsPanel.clear();
  qualityPanel.clear();
  comparisonPanel.clear();
  versionPanel.clear();
  overlapPanel.clear();
  coveragePanel.clear();
  chartsPanel.clear();
  state = null;
  renderDisplay(); // boundary only until results arrive
  var token = ++refreshToken;

  // The selected local-date range is divided into consecutive
  // non-overlapping chunks (the rolling seven-day default is one chunk;
  // a 90-day range becomes thirteen). Chunks are evaluated STRICTLY
  // SEQUENTIALLY — at most one evaluate() is in flight at any moment —
  // and their features accumulate client-side; the combined analysis
  // renders only after every chunk has succeeded.
  var chunks = buildChunkRanges(startStr, endStr,
      CONFIG.evaluationChunkDays);
  var totalAreaM2 = computeTotalAreaM2(regionGeom);
  var accumulated = [];

  function runChunk(index) {
    if (token !== refreshToken) return; // superseded — do not launch
    setLoadingProgress('Computing chunk ' + (index + 1) + ' of ' +
        chunks.length);
    var chunk = chunks[index];
    buildChunkEvaluation(chunk.start, chunk.end, regionGeom, totalAreaM2)
        .evaluate(function (fc, error) {
      // Stale callbacks from superseded requests touch NOTHING: no
      // appending, no next chunk, no progress text, no loading-state or
      // button changes, no rendering.
      if (token !== refreshToken) return;

      if (error) {
        // Terminal error state for the CURRENT request: no retry, no
        // silent omission, no partial scientific summaries; the
        // boundary-only map remains.
        stopLoadingAnimation();
        updateButton.setDisabled(false);
        print('⚠ Earth Engine error in chunk ' + (index + 1) + ' of ' +
              chunks.length + ' (' + chunk.start + ' to ' + chunk.end +
              '): ' + error);
        setStatus('⚠ Computation failed in chunk ' + (index + 1) +
            ' of ' + chunks.length + ' (' + chunk.start + ' to ' +
            chunk.end + '): ' + error, true);
        return;
      }

      for (var f = 0; f < fc.features.length; f++) {
        accumulated.push(fc.features[f]);
      }
      if (index + 1 < chunks.length) {
        runChunk(index + 1); // next chunk starts only after this one
        return;
      }

      // Every chunk succeeded — terminal success state for the CURRENT
      // request: stop the animation, re-enable Update, render the
      // combined whole-range analysis once.
      stopLoadingAnimation();
      updateButton.setDisabled(false);
      renderResults(accumulated);
    });
  }

  /*
   * Whole-selected-range analysis over the accumulated features from ALL
   * chunks — identical client-side science to the previous
   * single-evaluation version. Runs exactly once, only after every chunk
   * succeeded.
   */
  function renderResults(features) {
    /* ---- Client-side handling of already-evaluated results only ---- */

    var warnings = [];
    function addWarning(text) {
      warnings.push(text);
      print('⚠ ' + text);
    }

    var rawCount = null;
    var productRows = [];
    var dailyRows = [];
    var overlapRows = [];
    var i, j, p;
    for (i = 0; i < features.length; i++) {
      p = features[i].properties;
      if (p.series === 'collection_meta') {
        // One meta feature per chunk — sum across all chunks.
        rawCount = (rawCount === null ? 0 : rawCount) + p.raw_count;
      } else if (p.series === 'product') {
        productRows.push({
          t: p.millis,
          productId: p.product_id,
          orbit: p.orbit !== undefined ? p.orbit : null,
          assetCount: p.asset_count_for_product,
          localDate: p.local_date,
          quality: p.product_quality !== undefined ?
              p.product_quality : null,
          status: p.processing_status !== undefined ?
              p.processing_status : null,
          processorVersion: p.processor_version !== undefined ?
              p.processor_version : null,
          algorithmVersion: p.algorithm_version !== undefined ?
              p.algorithm_version : null,
          validFraction: typeof p.valid_fraction === 'number' ?
              p.valid_fraction : 0,
          mean: typeof p.area_weighted_mean_no2 === 'number' ?
              p.area_weighted_mean_no2 : null,
          hasValid: p.has_valid === 1
        });
      } else if (p.series === 'daily') {
        dailyRows.push({
          t: p.millis,
          date: p.date_string,
          validCount: p.valid_contributor_count,
          nominalCount: p.nominal_contributor_count,
          allMean: typeof p.all_quality_mean === 'number' ?
              p.all_quality_mean : null,
          nominalMean: typeof p.nominal_only_mean === 'number' ?
              p.nominal_only_mean : null,
          allFraction: typeof p.all_quality_fraction === 'number' ?
              p.all_quality_fraction : 0,
          nominalFraction: typeof p.nominal_only_fraction === 'number' ?
              p.nominal_only_fraction : 0
        });
      } else if (p.series === 'overlap') {
        var interArea = typeof p.intersection_area_m2 === 'number' ?
            p.intersection_area_m2 : 0;
        var unionArea = typeof p.union_area_m2 === 'number' ?
            p.union_area_m2 : 0;
        var areaA = typeof p.valid_area_a_m2 === 'number' ?
            p.valid_area_a_m2 : 0;
        var areaB = typeof p.valid_area_b_m2 === 'number' ?
            p.valid_area_b_m2 : 0;
        overlapRows.push({
          t: p.millis,
          date: p.date_string,
          productIdA: p.product_id_a,
          orbitA: p.orbit_a !== undefined ? p.orbit_a : null,
          validFractionA: p.valid_fraction_a,
          validAreaA: areaA,
          productIdB: p.product_id_b,
          orbitB: p.orbit_b !== undefined ? p.orbit_b : null,
          validFractionB: p.valid_fraction_b,
          validAreaB: areaB,
          intersectionArea: interArea,
          unionArea: unionArea,
          areaOnlyA: areaA - interArea,
          areaOnlyB: areaB - interArea,
          pixelsOnlyA: typeof p.only_a_pixels === 'number' ?
              p.only_a_pixels : 0,
          pixelsOnlyB: typeof p.only_b_pixels === 'number' ?
              p.only_b_pixels : 0,
          overlapOfTotal: typeof p.total_baaqmd_area_m2 === 'number' &&
              p.total_baaqmd_area_m2 > 0 ?
              interArea / p.total_baaqmd_area_m2 : null,
          overlapOfUnion: unionArea > 0 ? interArea / unionArea : null
        });
      }
    }
    productRows.sort(byTime);
    dailyRows.sort(byTime);
    overlapRows.sort(byTime);

    /* ---- Structure cross-checks ---- */

    var assetSum = 0;
    for (i = 0; i < productRows.length; i++) {
      assetSum += productRows[i].assetCount;
    }
    if (rawCount !== null && rawCount !== assetSum) {
      addWarning('Grouped asset-count mismatch: ' + rawCount +
          ' raw collection members but per-product asset counts sum to ' +
          assetSum + '. Some members may be missing PRODUCT_ID.');
    }
    // Defensive chunking check: chunks are non-overlapping, so a
    // legitimate record set has each PRODUCT_ID in exactly one chunk. A
    // duplicate means a product's assets straddled a chunk boundary and
    // were split — records are NOT deduplicated (several products per
    // date are legitimate), only warned about.
    var productIdSeen = {};
    var duplicateProductIds = [];
    for (i = 0; i < productRows.length; i++) {
      var pidKey = String(productRows[i].productId);
      if (productIdSeen[pidKey]) {
        if (productIdSeen[pidKey] === 1) {
          duplicateProductIds.push(pidKey);
        }
        productIdSeen[pidKey]++;
      } else {
        productIdSeen[pidKey] = 1;
      }
    }
    if (duplicateProductIds.length > 0) {
      addWarning('PRODUCT_ID appears in more than one evaluation chunk ' +
          '(a product straddling a chunk boundary may be split): ' +
          duplicateProductIds.join(', '));
    }
    var outOfRange = [];
    for (i = 0; i < productRows.length; i++) {
      if (productRows[i].localDate < startStr ||
          productRows[i].localDate >= endStr) {
        outOfRange.push(productRows[i].localDate);
      }
    }
    if (outOfRange.length > 0) {
      addWarning('Product local dates outside the selected local-date ' +
          'window (expected none): ' + outOfRange.join(', '));
    }

    /* ---- 1. Product-quality audit ---- */

    var nonNominal = [];
    var degradedContributing = [];
    var datesWithDegradedContributor = {};
    for (i = 0; i < productRows.length; i++) {
      p = productRows[i];
      if (p.quality !== 'NOMINAL') {
        nonNominal.push({
          productId: p.productId,
          orbit: p.orbit,
          localDate: p.localDate,
          productQuality: p.quality,
          processorVersion: p.processorVersion,
          hasValidBaaqmdData: p.hasValid,
          validFraction: p.validFraction,
          areaWeightedMeanNo2: p.mean
        });
        if (p.hasValid) {
          degradedContributing.push(p);
          datesWithDegradedContributor[p.localDate] = true;
        }
      }
    }
    var degradedDates = [];
    for (var dateKey in datesWithDegradedContributor) {
      if (datesWithDegradedContributor.hasOwnProperty(dateKey)) {
        degradedDates.push(dateKey);
      }
    }
    degradedDates.sort();
    print('Non-NOMINAL products (' + nonNominal.length +
          '; nothing is excluded automatically):', nonNominal);

    qualityPanel.add(ui.Label('Product-quality audit', STYLE.emph));
    qualityPanel.add(ui.Label(
        'Products with PRODUCT_QUALITY not exactly "NOMINAL": ' +
            nonNominal.length + ' (full listing in the Console; nothing ' +
            'is excluded automatically)',
        STYLE.body));
    qualityPanel.add(ui.Label(
        'Non-NOMINAL products that actually contribute over BAAQMD: ' +
            degradedContributing.length,
        STYLE.body));
    qualityPanel.add(ui.Label(
        'Dates containing a contributing non-NOMINAL product: ' +
            (degradedDates.length > 0 ?
                degradedDates.length + ' (' + degradedDates.join(', ') + ')' :
                '0'),
        STYLE.body));

    /* ---- 2. All-quality vs nominal-only comparison ---- */

    var maxMeanDiff = null;
    var nonzeroDiffDates = [];
    var exceedDates = [];
    var maxCoverageDiff = 0;
    var datesLosingAllData = [];
    for (i = 0; i < dailyRows.length; i++) {
      var day = dailyRows[i];
      var diff = (day.allMean !== null && day.nominalMean !== null) ?
          Math.abs(day.allMean - day.nominalMean) : null;
      day.meanDiff = diff;
      if (diff !== null) {
        if (maxMeanDiff === null || diff > maxMeanDiff) maxMeanDiff = diff;
        if (diff > 0) nonzeroDiffDates.push(day.date);
        if (diff > CONFIG.diffTolerance) exceedDates.push(day.date);
      }
      var coverageDiff = Math.abs(day.allFraction - day.nominalFraction);
      if (coverageDiff > maxCoverageDiff) maxCoverageDiff = coverageDiff;
      if (day.validCount > 0 && day.nominalCount === 0) {
        datesLosingAllData.push(day.date);
      }
    }
    if (exceedDates.length > 0) {
      addWarning('All-quality vs nominal-only daily means differ by more ' +
          'than ' + fmtMol(CONFIG.diffTolerance) + ' mol/m² on ' +
          exceedDates.length + ' day(s): ' + exceedDates.join(', '));
    }
    if (datesLosingAllData.length > 0) {
      addWarning('Excluding non-NOMINAL products would remove ALL valid ' +
          'data on: ' + datesLosingAllData.join(', ') +
          ' (reported only — no exclusion is applied).');
    }

    comparisonPanel.add(ui.Label(
        'All-quality vs nominal-only comparison', STYLE.emph));
    comparisonPanel.add(ui.Label(
        'Maximum non-null daily mean difference: ' +
            (maxMeanDiff === null ?
                'not applicable (no comparable days)' :
                fmtMol(maxMeanDiff) + ' mol/m²'),
        STYLE.body));
    comparisonPanel.add(ui.Label(
        'Dates with any nonzero mean difference: ' +
            (nonzeroDiffDates.length > 0 ?
                nonzeroDiffDates.length + ' (' +
                    nonzeroDiffDates.join(', ') + ')' :
                '0'),
        STYLE.body));
    comparisonPanel.add(ui.Label(
        'Dates exceeding the ' + fmtMol(CONFIG.diffTolerance) +
            ' mol/m² tolerance: ' + exceedDates.length +
            (exceedDates.length > 0 ?
                ' (' + exceedDates.join(', ') + ')' : ''),
        STYLE.body));
    comparisonPanel.add(ui.Label(
        'Maximum daily coverage difference (valid fraction): ' +
            maxCoverageDiff.toFixed(4),
        STYLE.body));
    comparisonPanel.add(ui.Label(
        'Dates where excluding non-NOMINAL products removes all valid ' +
            'data: ' +
            (datesLosingAllData.length > 0 ?
                datesLosingAllData.length + ' (' +
                    datesLosingAllData.join(', ') + ')' :
                '0'),
        STYLE.body));

    /* ---- 3. Processor-version transition audit ---- */

    var versionInfo = {};
    var versionKeys = [];
    for (i = 0; i < productRows.length; i++) {
      p = productRows[i];
      var versionKey = p.processorVersion === null ?
          '(missing)' : String(p.processorVersion);
      if (!versionInfo[versionKey]) {
        versionInfo[versionKey] = {
          count: 0, firstDate: null, lastDate: null,
          minOrbit: null, maxOrbit: null
        };
        versionKeys.push(versionKey);
      }
      var info = versionInfo[versionKey];
      info.count++;
      if (info.firstDate === null || p.localDate < info.firstDate) {
        info.firstDate = p.localDate;
      }
      if (info.lastDate === null || p.localDate > info.lastDate) {
        info.lastDate = p.localDate;
      }
      if (p.orbit !== null) {
        if (info.minOrbit === null || p.orbit < info.minOrbit) {
          info.minOrbit = p.orbit;
        }
        if (info.maxOrbit === null || p.orbit > info.maxOrbit) {
          info.maxOrbit = p.orbit;
        }
      }
    }
    versionKeys.sort();
    print('Processor-version audit (all products):', versionInfo);

    // Valid contributors per date per version (also feeds the version
    // chart) and dates with valid contributors from >1 version.
    var perDateVersionCounts = {};
    var mixedVersionDates = [];
    for (i = 0; i < productRows.length; i++) {
      p = productRows[i];
      if (!p.hasValid) continue;
      var vKey = p.processorVersion === null ?
          '(missing)' : String(p.processorVersion);
      if (!perDateVersionCounts[p.localDate]) {
        perDateVersionCounts[p.localDate] = {};
      }
      perDateVersionCounts[p.localDate][vKey] =
          (perDateVersionCounts[p.localDate][vKey] || 0) + 1;
    }
    for (i = 0; i < dailyRows.length; i++) {
      var dateVersions = perDateVersionCounts[dailyRows[i].date] || {};
      var distinctVersions = 0;
      for (var dv in dateVersions) {
        if (dateVersions.hasOwnProperty(dv)) distinctVersions++;
      }
      if (distinctVersions > 1) mixedVersionDates.push(dailyRows[i].date);
    }
    if (versionKeys.length > 1) {
      addWarning('Multiple PROCESSOR_VERSION values in this period (' +
          versionKeys.join(', ') + '). Historical consistency requires ' +
          'further investigation — this single test does not establish ' +
          'whether the collection is homogeneous or inhomogeneous.');
    }

    versionPanel.add(ui.Label('Processor-version transition audit',
        STYLE.emph));
    for (i = 0; i < versionKeys.length; i++) {
      var vk = versionKeys[i];
      versionPanel.add(ui.Label(
          'PROCESSOR_VERSION ' + vk + ': ' + versionInfo[vk].count +
              ' products; local dates ' + versionInfo[vk].firstDate +
              ' to ' + versionInfo[vk].lastDate + '; orbits ' +
              versionInfo[vk].minOrbit + ' to ' + versionInfo[vk].maxOrbit,
          STYLE.body));
    }
    versionPanel.add(ui.Label(
        'Dates with valid BAAQMD contributors from more than one ' +
            'processor version: ' +
            (mixedVersionDates.length > 0 ?
                mixedVersionDates.length + ' (' +
                    mixedVersionDates.join(', ') + ')' :
                '0'),
        STYLE.body));
    versionPanel.add(ui.Label(
        'Documentation context (official NO2 Product Readme, issue 2.9): ' +
        'OFFL processor 2.5 is identified as beginning at orbit 28031 on ' +
        '2023-03-12 and is described as a small qa_value fix affecting ' +
        'snow/ice pixels. This is context only — not proof that the ' +
        'transition is irrelevant to the Bay Area data. No homogeneity ' +
        'verdict is made from this one test.',
        STYLE.note));

    /* ---- 4. Dual-contributor overlap audit ---- */

    var overlapUnionFracs = [];
    var overlapTotalFracs = [];
    for (i = 0; i < overlapRows.length; i++) {
      if (overlapRows[i].overlapOfUnion !== null) {
        overlapUnionFracs.push(overlapRows[i].overlapOfUnion);
      }
      if (overlapRows[i].overlapOfTotal !== null) {
        overlapTotalFracs.push(overlapRows[i].overlapOfTotal);
      }
    }
    var dualDatesExpected = 0;
    for (i = 0; i < dailyRows.length; i++) {
      if (dailyRows[i].validCount === 2) dualDatesExpected++;
    }
    if (dualDatesExpected !== overlapRows.length) {
      addWarning('Dual-contributor cross-check mismatch: ' +
          dualDatesExpected + ' dates with exactly two valid ' +
          'contributors vs ' + overlapRows.length + ' overlap records.');
    }
    print('Dual-contributor overlap audit (' + overlapRows.length +
          ' dates):', overlapRows);

    overlapPanel.add(ui.Label('Dual-contributor overlap audit',
        STYLE.emph));
    overlapPanel.add(ui.Label(
        'Dates with exactly two valid contributors: ' + overlapRows.length +
            ' (full per-date detail in the Console)',
        STYLE.body));
    overlapPanel.add(ui.Label(
        overlapUnionFracs.length ?
            'Overlap ÷ union of valid areas — min ' +
                Math.min.apply(null, overlapUnionFracs).toFixed(3) +
                ', median ' + median(overlapUnionFracs).toFixed(3) +
                ', max ' +
                Math.max.apply(null, overlapUnionFracs).toFixed(3) :
            'Overlap ÷ union — not applicable (no dual-contributor days).',
        STYLE.body));
    overlapPanel.add(ui.Label(
        overlapTotalFracs.length ?
            'Overlap ÷ total BAAQMD area — min ' +
                Math.min.apply(null, overlapTotalFracs).toFixed(3) +
                ', median ' + median(overlapTotalFracs).toFixed(3) +
                ', max ' +
                Math.max.apply(null, overlapTotalFracs).toFixed(3) :
            'Overlap ÷ total area — not applicable.',
        STYLE.body));
    overlapPanel.add(ui.Label(
        'High overlap fractions mean the two orbits mostly observe the ' +
        'same BAAQMD area (overlapping observations); low fractions mean ' +
        'they mostly cover different parts (complementary coverage). No ' +
        'overlap threshold is imposed.',
        STYLE.note));

    /* ---- 5. Coverage sensitivity (candidates only, none approved) ---- */

    var totalDays = daysBetween(startStr, endStr);
    coveragePanel.add(ui.Label(
        'Coverage sensitivity (candidates only — no approved threshold)',
        STYLE.emph));
    // Dynamic year-month buckets covering the whole selected range, so a
    // month with zero retained days still reports 0. Chronological order.
    var rangeMonths = yearMonthsInRange(startStr, endStr);
    var candidateReports = [];
    for (i = 0; i < CONFIG.coverageCandidates.length; i++) {
      var candidate = CONFIG.coverageCandidates[i];
      var retainedMeans = [];
      var monthCounts = {};
      for (j = 0; j < rangeMonths.length; j++) {
        monthCounts[rangeMonths[j]] = 0;
      }
      for (j = 0; j < dailyRows.length; j++) {
        var frac = dailyRows[j].allFraction;
        var retainedDay = candidate.strict ?
            frac > candidate.min : frac >= candidate.min;
        if (retainedDay && dailyRows[j].allMean !== null) {
          retainedMeans.push(dailyRows[j].allMean);
          var monthKey = dailyRows[j].date.substring(0, 7);
          if (monthCounts[monthKey] === undefined) {
            monthCounts[monthKey] = 0; // defensive: date outside range
          }
          monthCounts[monthKey]++;
        }
      }
      var monthParts = [];
      for (j = 0; j < rangeMonths.length; j++) {
        monthParts.push(rangeMonths[j] + ': ' +
            monthCounts[rangeMonths[j]]);
      }
      var report = {
        candidate: candidate.label,
        retainedDays: retainedMeans.length,
        excludedDays: totalDays - retainedMeans.length,
        retainedFractionOfPeriod: totalDays > 0 ?
            retainedMeans.length / totalDays : 0,
        meanDailyNo2: retainedMeans.length ?
            retainedMeans.reduce(function (a, b) { return a + b; }, 0) /
                retainedMeans.length : null,
        medianDailyNo2: retainedMeans.length ?
            median(retainedMeans) : null,
        minDailyNo2: retainedMeans.length ?
            Math.min.apply(null, retainedMeans) : null,
        maxDailyNo2: retainedMeans.length ?
            Math.max.apply(null, retainedMeans) : null,
        retainedDaysByYearMonth: monthCounts
      };
      candidateReports.push(report);
      coveragePanel.add(ui.Label(
          candidate.label + ': ' + report.retainedDays + ' retained / ' +
              report.excludedDays + ' excluded (' +
              (report.retainedFractionOfPeriod * 100).toFixed(0) +
              '% of the ' + totalDays + '-day period); retained by ' +
              'month — ' + monthParts.join(', '),
          STYLE.body));
      coveragePanel.add(ui.Label(
          '    daily NO2 of retained days — mean ' +
              (report.meanDailyNo2 === null ? 'n/a' :
                  fmtMol(report.meanDailyNo2)) +
              ', median ' +
              (report.medianDailyNo2 === null ? 'n/a' :
                  fmtMol(report.medianDailyNo2)) +
              ', min ' +
              (report.minDailyNo2 === null ? 'n/a' :
                  fmtMol(report.minDailyNo2)) +
              ', max ' +
              (report.maxDailyNo2 === null ? 'n/a' :
                  fmtMol(report.maxDailyNo2)) + ' mol/m²',
          STYLE.note));
    }
    print('Coverage-sensitivity candidates (none approved):',
          candidateReports);

    // Dates with valid fraction below the 0.20 candidate (including
    // zero-coverage dates), with daily mean and contributor products.
    var perDateContributorIds = {};
    for (i = 0; i < productRows.length; i++) {
      p = productRows[i];
      if (!p.hasValid) continue;
      if (!perDateContributorIds[p.localDate]) {
        perDateContributorIds[p.localDate] = [];
      }
      perDateContributorIds[p.localDate].push(p.productId);
    }
    var lowCoverage = [];
    for (i = 0; i < dailyRows.length; i++) {
      if (dailyRows[i].allFraction < 0.20) {
        lowCoverage.push({
          date: dailyRows[i].date,
          validFraction: dailyRows[i].allFraction,
          dailyMean: dailyRows[i].allMean,
          contributorProducts:
              perDateContributorIds[dailyRows[i].date] || []
        });
      }
    }
    print('Dates with valid fraction below 0.20 (candidate reference ' +
          'only):', lowCoverage);
    coveragePanel.add(ui.Label(
        'Dates with valid fraction below 0.20: ' + lowCoverage.length +
            ' (per-date detail in the Console)',
        STYLE.note));

    /* ---- Warnings panel ---- */

    if (warnings.length > 0) {
      warningsPanel.add(ui.Label('Warnings (also in the Console; none ' +
          'trigger automatic exclusions):', STYLE.emph));
      for (i = 0; i < warnings.length; i++) {
        warningsPanel.add(ui.Label('⚠ ' + warnings[i], STYLE.warnLabel));
      }
    }

    /* ---- No-data terminal state ---- */

    if (productRows.length === 0) {
      state = {hasData: false};
      renderDisplay();
      setStatus(
          '⚠ No usable data: no Sentinel-5P OFFL NO2 orbit products ' +
          'intersect the study region in this period. Try another range ' +
          '— OFFL NO2 imagery begins in late June 2018.',
          true);
      return;
    }

    /* ---- Success: context map + charts ---- */

    state = {
      hasData: true,
      startStr: startStr,
      endStr: endStr,
      // Lightweight whole-range display path (see buildDisplayPeriodMean):
      // no per-product regional reductions are repeated for the map, and
      // only this display copy is clipped.
      periodMean: buildDisplayPeriodMean(startStr, endStr, regionGeom)
    };
    renderDisplay();
    chartsPanel.add(makeQualityComparisonChart(dailyRows, startStr, endStr));
    chartsPanel.add(makeFractionChart(dailyRows));
    if (overlapRows.length > 0) {
      chartsPanel.add(makeOverlapChart(overlapRows));
    } else {
      chartsPanel.add(ui.Label(
          'No dual-contributor days in this period — overlap chart ' +
          'omitted.', STYLE.note));
    }
    chartsPanel.add(
        makeVersionChart(dailyRows, versionKeys, perDateVersionCounts));

    var validProducts = 0;
    for (i = 0; i < productRows.length; i++) {
      if (productRows[i].hasValid) validProducts++;
    }
    setStatus(
        productRows.length + ' products (' + validProducts +
        ' with valid BAAQMD data); ' + nonNominal.length +
        ' non-NOMINAL; ' + overlapRows.length +
        ' dual-contributor days; ' + warnings.length +
        ' warning(s). All methods remain UNDER EVALUATION — no daily ' +
        'rule, quality rule, or coverage threshold is decided.',
        warnings.length > 0);
  }

  runChunk(0);
}

/* -------------------------------------------------------------------- INIT */

ui.root.insert(1, buildPanel());
Map.centerObject(studyRegion.fc, 8);
refresh();
