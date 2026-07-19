/*
 * Bay Area Air Quality Episode Finder
 * Exploration 07 — historical-record homogeneity audit EXPORT for
 * Sentinel-5P OFFL tropospheric NO2 (batch table exports for R analysis)
 *
 * Purpose: AUDIT DATA EXPORT ONLY. Creates reproducible YEARLY batch
 * Export.table tasks covering the OFFL record (2018-06-28 through the
 * day BEFORE the latest BAAQMD-footprint-intersecting represented local
 * date in the collection — a conservative rule that excludes a
 * potentially partially ingested latest date; footprint intersection
 * anchors the date range only and is not contribution; both dates are
 * recorded in the manifest) so
 * the historical-homogeneity audit can be performed in the supporting R
 * analysis layer (analysis/s5p_no2_historical_homogeneity.Rmd). This
 * script does NOT implement: baselines; anomalies; episode detection;
 * homogeneity verdicts; processor corrections; thresholds; charts; or
 * anomaly maps. It draws no scientific conclusion — it only exports the
 * audit record. The NO2 band is a TROPOSPHERIC VERTICAL COLUMN density
 * (mol/m^2): an indicator of column patterns, not a ground-level
 * concentration, not an AQI value, not a health measure, and not an
 * episode result.
 *
 * Accepted working processing rules preserved (from the live-tested
 * explorations 04–06):
 *   - official BAAQMD boundary asset (labeled county fallback only);
 *   - America/Los_Angeles local calendar dates (start inclusive, end
 *     exclusive);
 *   - defensive PRODUCT_ID reconstruction (antimeridian exception);
 *   - pixel-wise arithmetic mean of same-local-date orbit products,
 *     relying on Earth Engine masks (non-contributing products do not
 *     affect the daily image — established by exploration 04);
 *   - valid NEGATIVE retrievals retained (never clamped or masked);
 *   - explicit area-weighted regional mean with the valid-area fraction
 *     retained for every daily value;
 *   - requested dates with no products and dates with no valid value are
 *     represented explicitly as rows (never silently omitted);
 *   - non-NOMINAL products retained and flagged, never excluded;
 *   - EPSG:3310 at 7000 m as the FIXED REFERENCE CONFIGURATION for this
 *     audit only — not a final scientific scale claim;
 *   - no coverage threshold; no interpolation; no bestEffort; no
 *     reproject().
 *
 * Outputs (Export.table.toDrive, CSV, fixed column order via selectors):
 *   A. Daily scientific audit table  — one row per requested local
 *      calendar day; its metadata columns are CONTRIBUTOR-SCOPED
 *      (derived only from products with actual valid BAAQMD pixels)
 *      (one task per year).
 *   B. Product metadata table        — one row per footprint-intersecting
 *      orbit-product ASSET; metadata only, no regional NO2 reduction
 *      (one task per year).
 *   C. Audit manifest                — one row per exported year
 *      (one task for the whole run).
 *
 * How to run: paste this file into the Earth Engine Code Editor
 * (https://code.earthengine.google.com), click Run, review the year
 * range, then click "Create export tasks" and START each task from the
 * Tasks tab. Batch tasks avoid the interactive computation timeout that
 * chunked evaluation worked around in explorations 05–06.
 *
 * Project docs: https://github.com/perez-eduardo/Bay-Area-Air-Quality-Episode-Finder
 */

/* ------------------------------------------------------ DATASET CONSTANTS */

// Single dataset and timezone constants for the whole script
// (CONFIG.collectionId and CONFIG.timeZone reference them — no duplicate
// literals anywhere else).
var DATASET_ID = 'COPERNICUS/S5P/OFFL/L3_NO2';
var DEFAULT_TIME_ZONE = 'America/Los_Angeles';

// Documented start of OFFL NO2 availability (late June 2018). The 2018
// export year starts here, not on 2018-01-01.
var COLLECTION_START = '2018-06-28';
var FIRST_EXPORT_YEAR = 2018;

// Stamped into the audit manifest for provenance.
var SCRIPT_ID = 'earthengine/exploration/07_s5p_no2_historical_homogeneity_export.js';

/*
 * CONSERVATIVE latest-complete-date rule, anchored to the STUDY REGION:
 *   latest_represented_local_date — the maximum America/Los_Angeles
 *       local calendar date among OFFL collection assets whose
 *       FOOTPRINTS INTERSECT the BAAQMD study geometry (filterBounds
 *       BEFORE aggregate_max — not the global collection maximum);
 *   last_included_local_date      — latest_represented_local_date MINUS
 *       ONE local calendar day: the last day this audit exports;
 *   export end-exclusive          = latest_represented_local_date.
 * Footprint intersection is used here ONLY to anchor the export date
 * range — it is NOT scientific contribution (the exploration 04 rule is
 * preserved), and no per-product contribution audit is needed for this
 * anchor. Rationale for the minus-one-day rule: OFFL products are
 * published with latency, so the latest represented date may hold only
 * part of its day's orbits at export time; excluding it conservatively
 * avoids a potentially partial latest ingestion date. Both dates are
 * recorded in the manifest; prior complete years remain January 1
 * through January 1 of the next year (end exclusive).
 *
 * Invoked ONCE, after getStudyRegion() has constructed the single
 * study-region geometry (official BAAQMD asset, or its labeled county
 * fallback when the asset is unreadable) — the SAME geometry used by
 * every other step; no second or approximate boundary exists for this
 * lookup. One-time synchronous getInfo at script load; ES5-only;
 * DST-safe via the explicit timezone argument to ee.Date.advance().
 */
function latestAvailableInfo(regionGeom) {
  var latestMillis = ee.ImageCollection(DATASET_ID)
      .filterBounds(regionGeom)
      .aggregate_max('system:time_start');

  var latestRepresented = ee.Date(latestMillis)
      .format('yyyy-MM-dd', DEFAULT_TIME_ZONE);

  var latestLocalMidnight = ee.Date.parse(
      'yyyy-MM-dd',
      latestRepresented,
      DEFAULT_TIME_ZONE
  );

  var lastIncluded = latestLocalMidnight.advance(-1, 'day',
      DEFAULT_TIME_ZONE);

  return ee.Dictionary({
    latestRepresentedLocalDate: latestRepresented,
    lastIncludedLocalDate:
        lastIncluded.format('yyyy-MM-dd', DEFAULT_TIME_ZONE),
    // End-exclusive export bound: the latest represented date itself,
    // so the last exported day is the day before it.
    endExclusive: latestRepresented
  }).getInfo();
}

/* ------------------------------------------------------------------ CONFIG */

var CONFIG = {
  // Official BAAQMD jurisdiction boundary: uploaded California air-district
  // boundaries table asset, filtered to the Bay Area district (see
  // docs/data-sources.md). If the asset is unavailable (e.g., the running
  // account has no read access), the script falls back to the labeled
  // county approximation in getStudyRegion below — the manifest records
  // whichever boundary was actually used, and the panel warns that audit
  // exports should use the official boundary.
  boundaryAssetId:
      'projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries',
  boundaryField: 'Air_Distri',
  boundaryValue: 'BAY AREA AQMD',

  // First dataset (owner-decided; see docs/data-sources.md).
  collectionId: DATASET_ID,
  bandName: 'tropospheric_NO2_column_number_density',

  // Calendar-day grouping and date labels use the Bay Area local time
  // zone.
  timeZone: DEFAULT_TIME_ZONE,

  // FIXED REFERENCE CONFIGURATION for this audit only: explicit
  // equal-area CRS (EPSG:3310, California Albers, meters) at an explicit
  // 7000 m scale — no bestEffort, no reproject(). This is the accepted
  // exploration-stage statistics configuration from scripts 04–06, held
  // fixed here so every exported year is computed identically. It is NOT
  // a final scientific scale decision.
  statsCrs: 'EPSG:3310',
  statsScale: 7000,

  // Google Drive folder and file-name prefixes for the export tasks.
  driveFolder: 's5p_no2_homogeneity_audit',
  dailyPrefix: 's5p_no2_homogeneity_daily_',
  productsPrefix: 's5p_no2_homogeneity_products_',
  manifestPrefix: 's5p_no2_homogeneity_manifest',

  // Export-safe string conventions. Multi-value metadata is joined into
  // one stable string per cell; absent metadata becomes the literal
  // missing token so gaps are visible in the export, never silently
  // dropped. An empty string means "no values" (e.g., a day with no
  // products), which is distinct from '(missing)' (a product present but
  // lacking that property).
  setSeparator: ';',
  missingToken: '(missing)',

  // The accepted working daily combination rule, stamped verbatim into
  // the manifest for provenance (practical working rule — NOT a final
  // scientific method; see docs/methodology.md).
  dailyCombinationRule:
      'pixel-wise arithmetic mean of same-local-date orbit products; ' +
      'defensive PRODUCT_ID grouping (antimeridian exception); Earth ' +
      'Engine masks ignore non-contributing products; valid negatives ' +
      'preserved; no coverage threshold; no interpolation'
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
 * layer name, the side panel, a console warning, and the exported manifest
 * all say so.
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
        'county approximation of the BAAQMD jurisdiction. Audit exports ' +
        'should normally use the official boundary; the manifest records ' +
        'which boundary was actually used.');
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

// Total BAAQMD area (m^2) at the explicit CONFIG.statsCrs /
// CONFIG.statsScale — no bestEffort, no reproject().
function computeTotalAreaM2(regionGeom) {
  return ee.Number(ee.Image.pixelArea().rename('area').reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: regionGeom,
    crs: CONFIG.statsCrs,
    scale: CONFIG.statsScale,
    maxPixels: 1e10
  }).get('area'));
}

// Binary valid-pixel indicator with zero fill everywhere. VERIFIED
// negative-value preservation: .gt(0) is applied to image.mask() — the
// MASK band (0..1), never to the NO2 measurement values — so a valid
// NEGATIVE retrieval has mask 1, counts as a valid pixel, and makes its
// product a contributor. unmask(0, false) makes masked and
// outside-footprint locations numeric zero. Identical to the tested
// scripts 04–06 construction.
function binaryValidMask(image) {
  return image.mask()
      .gt(0)
      .rename('valid_mask')
      .unmask(0, false);
}

/*
 * One combined regional ee.Reducer.sum() over two diagnostic bands
 * (identical to the tested scripts 04–06 construction):
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
// null when the valid area is zero (exported as an empty CSV cell — the
// R notebook reads it as NA). Exploration-stage method held fixed for
// this audit.
function areaWeightedMean(sums) {
  var validArea = ee.Number(sums.get('valid_area_m2'));
  return ee.Algorithms.If(
      validArea.gt(0),
      ee.Number(sums.get('weighted_no2')).divide(validArea),
      null);
}

/*
 * Valid-area-only per-product reduction — the MINIMUM regional reduction
 * required to identify actual contributors (products with valid unmasked
 * BAAQMD pixels; footprint intersection alone is not contribution —
 * established by exploration 04). Deliberately reduces ONE band, not
 * two: the daily regional mean comes from one reduction of the daily
 * image, so no per-product NO2 reduction is needed.
 */
function validAreaSum(image, regionGeom) {
  return ee.Number(ee.Image.pixelArea()
      .multiply(binaryValidMask(image))
      .rename('valid_area_m2')
      .reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: regionGeom,
        crs: CONFIG.statsCrs,
        scale: CONFIG.statsScale,
        maxPixels: 1e10
      }).get('valid_area_m2'));
}

/* --------------------------------------------------- METADATA CONVENTIONS */

// Property value, or the literal missing token when the property is
// absent. propertyNames().contains() is an exact presence test — no
// falsy-value pitfalls — so unavailable metadata is exported as
// '(missing)', never silently omitted and never invented.
function propOrMissing(image, name) {
  image = ee.Image(image);
  return ee.Algorithms.If(
      image.propertyNames().contains(name),
      image.get(name),
      CONFIG.missingToken);
}

// Stable export-safe string cell from a server-side list: every element
// stringified, distinct, sorted, joined with CONFIG.setSeparator. An
// empty list yields an empty string ("no values").
function joinedDistinctStrings(list) {
  return ee.List(list)
      .map(function (v) { return ee.Algorithms.String(v); })
      .distinct()
      .sort()
      .join(CONFIG.setSeparator);
}

// Stable export-safe string cell preserving one entry per element
// (sorted, not de-duplicated) — used for contributor id/orbit lists.
function joinedSortedStrings(list) {
  return ee.List(list)
      .map(function (v) { return ee.Algorithms.String(v); })
      .sort()
      .join(CONFIG.setSeparator);
}

/* ------------------------------------------------- PRODUCT RECONSTRUCTION */

/*
 * DEFENSIVE product reconstruction for the audit: members grouped by
 * PRODUCT_ID; only same-PRODUCT_ID assets are mosaicked (never distinct
 * products); metadata copied defensively from the first asset (absent
 * stays absent on the image — the normalized meta_* properties below
 * carry the explicit missing token instead); earliest asset timestamp
 * used; local_date in America/Los_Angeles ('yyyy-MM-dd' — calendar
 * year, not Joda week-based 'YYYY'). Identical grouping to the tested
 * scripts 04–06; the per-product reduction here is the valid-area-only
 * minimum needed for contributor identification.
 *
 * Note on yearly windows: a product whose assets straddle a local-year
 * boundary would have its assets split between two yearly exports and
 * its PRODUCT_ID would appear in both files (the antimeridian two-asset
 * exception makes this conceivable, though the Bay Area live tests found
 * one asset per product). The R notebook's duplicate checks detect this;
 * nothing is deduplicated silently.
 */
function buildAuditProducts(raw, regionGeom) {
  var ids = ee.List(raw.aggregate_array('PRODUCT_ID')).distinct();
  var images = ids.map(function (pid) {
    var memberAssets = raw.filter(ee.Filter.eq('PRODUCT_ID', pid));
    var first = ee.Image(memberAssets.first());
    var t0 = memberAssets.aggregate_min('system:time_start');
    var image = ee.Image(memberAssets.mosaic().copyProperties(first));
    var validArea = validAreaSum(image, regionGeom);
    // has_valid_baaqmd_data intentionally numeric 1/0 (ee.Number.gt),
    // consistent with ee.Filter.eq('has_valid_baaqmd_data', 1).
    return image.set({
      'PRODUCT_ID': pid,
      'asset_count_for_product': memberAssets.size(),
      'system:time_start': t0,
      'local_date': ee.Date(t0).format('yyyy-MM-dd', CONFIG.timeZone),
      'has_valid_baaqmd_data': validArea.gt(0),
      // Normalized audit metadata: always present, '(missing)' when the
      // source property is absent, stringified for stable set-joins.
      'meta_orbit': ee.Algorithms.String(propOrMissing(first, 'ORBIT')),
      'meta_processor_version':
          ee.Algorithms.String(propOrMissing(first, 'PROCESSOR_VERSION')),
      'meta_algorithm_version':
          ee.Algorithms.String(propOrMissing(first, 'ALGORITHM_VERSION')),
      'meta_product_quality':
          ee.Algorithms.String(propOrMissing(first, 'PRODUCT_QUALITY')),
      'meta_processing_status':
          ee.Algorithms.String(propOrMissing(first, 'PROCESSING_STATUS')),
      'meta_spatial_resolution':
          ee.Algorithms.String(propOrMissing(first, 'SPATIAL_RESOLUTION'))
    });
  });
  return ee.ImageCollection.fromImages(images);
}

/* ------------------------------------------------------- EXPORT TABLE A */

// Fixed column order for the daily scientific audit table.
var DAILY_COLUMNS = [
  'local_date',
  'regional_mean_no2',
  'valid_area_fraction',
  'has_valid_value',
  'daily_source_asset_count',
  'daily_distinct_product_count',
  'daily_distinct_orbit_count',
  'valid_contributor_count',
  'has_contributing_non_nominal',
  'contributing_product_quality_values',
  'contributing_processor_version_set',
  'contributing_algorithm_version_set',
  'contributing_processing_status_set',
  'contributing_spatial_resolution_set',
  'contributing_product_ids',
  'contributing_orbits'
];

/*
 * One daily audit feature per requested local calendar day. The daily
 * image is the accepted working rule (mean of ALL same-date products;
 * masks ignore non-contributors). Distinctions preserved:
 *   - daily_source_asset_count counts footprint-intersecting raw ASSETS
 *     whose own timestamps fall on this local date;
 *   - daily_distinct_product_count counts reconstructed PRODUCTS
 *     assigned to this local date (earliest-asset timestamp);
 *   - valid_contributor_count counts products with ACTUAL valid BAAQMD
 *     pixels — footprint intersection alone is never contribution.
 * Every contributing_* metadata column is CONTRIBUTOR-SCOPED — derived
 * only from products with actual valid BAAQMD pixels — so a daily
 * scientific value is never labeled with metadata from non-contributing
 * footprint-intersecting products. The full collection-wide metadata
 * timeline (every footprint-intersecting asset) lives in the product
 * metadata table (output B). A no-contributor day therefore has empty
 * contributor-scoped set strings — by design, not by omission.
 * has_contributing_non_nominal uses the strict scripts 05–06 rule: any
 * contributor whose PRODUCT_QUALITY is not exactly 'NOMINAL' (including
 * missing) counts as non-NOMINAL — flagged, never excluded.
 */
function dailyAuditFeature(dateString, raw, products, regionGeom,
                           totalAreaM2) {
  var d = ee.String(dateString);
  var dayAssets = raw.filter(ee.Filter.eq('asset_local_date', d));
  var dayProducts = products.filter(ee.Filter.eq('local_date', d));
  var productCount = dayProducts.size();

  // Fully masked placeholder (double, same band name) so a date with no
  // products still yields a well-formed zero-valid-area reduction
  // (tested scripts 04–06 pattern). No interpolation anywhere.
  var placeholder = ee.Image.constant(0).double()
      .rename(CONFIG.bandName)
      .updateMask(ee.Image.constant(0));
  var dailyImage = ee.Image(ee.Algorithms.If(
      productCount.gt(0), dayProducts.mean(), placeholder));

  var sums = contributionSums(dailyImage, regionGeom);
  var validArea = ee.Number(sums.get('valid_area_m2'));

  var contributors = dayProducts.filter(
      ee.Filter.eq('has_valid_baaqmd_data', 1));
  var nonNominalContributors = contributors.filter(
      ee.Filter.neq('meta_product_quality', 'NOMINAL'));

  return ee.Feature(null, {
    local_date: d,
    // null (empty CSV cell) when the day has no valid area — the row
    // itself is always exported.
    regional_mean_no2: areaWeightedMean(sums),
    valid_area_fraction: validArea.divide(totalAreaM2),
    has_valid_value: validArea.gt(0),
    daily_source_asset_count: dayAssets.size(),
    daily_distinct_product_count: productCount,
    daily_distinct_orbit_count: ee.List(
        dayProducts.aggregate_array('meta_orbit')).distinct().size(),
    valid_contributor_count: contributors.size(),
    has_contributing_non_nominal: nonNominalContributors.size().gt(0),
    contributing_product_quality_values: joinedDistinctStrings(
        contributors.aggregate_array('meta_product_quality')),
    contributing_processor_version_set: joinedDistinctStrings(
        contributors.aggregate_array('meta_processor_version')),
    contributing_algorithm_version_set: joinedDistinctStrings(
        contributors.aggregate_array('meta_algorithm_version')),
    contributing_processing_status_set: joinedDistinctStrings(
        contributors.aggregate_array('meta_processing_status')),
    contributing_spatial_resolution_set: joinedDistinctStrings(
        contributors.aggregate_array('meta_spatial_resolution')),
    contributing_product_ids: joinedSortedStrings(
        contributors.aggregate_array('PRODUCT_ID')),
    contributing_orbits: joinedSortedStrings(
        contributors.aggregate_array('meta_orbit'))
  });
}

/* ------------------------------------------------------- EXPORT TABLE B */

// Fixed column order for the product metadata table.
var PRODUCT_COLUMNS = [
  'local_date',
  'system_time_start',
  'PRODUCT_ID',
  'ORBIT',
  'PROCESSOR_VERSION',
  'ALGORITHM_VERSION',
  'PRODUCT_QUALITY',
  'PROCESSING_STATUS',
  'SPATIAL_RESOLUTION'
];

// One metadata row per footprint-intersecting raw ASSET (collection
// member) — deliberately per asset, not per reconstructed product, so
// the export records exactly what Earth Engine holds. No regional NO2
// reduction is performed here. local_date is the asset's OWN local
// calendar date. Absent metadata becomes '(missing)'.
function assetMetadataFeature(image) {
  image = ee.Image(image);
  return ee.Feature(null, {
    local_date: ee.Date(image.get('system:time_start'))
        .format('yyyy-MM-dd', CONFIG.timeZone),
    system_time_start: image.get('system:time_start'),
    PRODUCT_ID: propOrMissing(image, 'PRODUCT_ID'),
    ORBIT: propOrMissing(image, 'ORBIT'),
    PROCESSOR_VERSION: propOrMissing(image, 'PROCESSOR_VERSION'),
    ALGORITHM_VERSION: propOrMissing(image, 'ALGORITHM_VERSION'),
    PRODUCT_QUALITY: propOrMissing(image, 'PRODUCT_QUALITY'),
    PROCESSING_STATUS: propOrMissing(image, 'PROCESSING_STATUS'),
    SPATIAL_RESOLUTION: propOrMissing(image, 'SPATIAL_RESOLUTION')
  });
}

/* ------------------------------------------------------- EXPORT TABLE C */

// Fixed column order for the audit manifest.
var MANIFEST_COLUMNS = [
  'export_year',
  'requested_start',
  'requested_end',
  'latest_represented_local_date',
  'last_included_local_date',
  'actual_collection_start',
  'actual_collection_end',
  'dataset_id',
  'band',
  'boundary_asset',
  'boundary_filter',
  'timezone',
  'crs',
  'scale_m',
  'daily_combination_rule',
  'export_created_at',
  'script_identifier'
];

// One manifest feature per exported year. actual_collection_start/end
// are the local dates of the earliest and latest raw assets actually in
// the year window ('(none)' when the window is empty). requested_end is
// END-EXCLUSIVE, matching every local-date filter in this project.
function manifestFeature(year, requestedStart, requestedEnd, regionGeom,
                         boundaryDescription, exportCreatedAt) {
  var raw = loadRawCollection(regionGeom,
      ee.Date(requestedStart, CONFIG.timeZone),
      ee.Date(requestedEnd, CONFIG.timeZone));
  var count = raw.size();
  return ee.Feature(null, {
    export_year: year,
    requested_start: requestedStart,
    requested_end: requestedEnd,
    // Conservative completeness rule, recorded on every row: the latest
    // BAAQMD-FOOTPRINT-INTERSECTING represented local date (footprint
    // intersection anchors the date range only — it is not
    // contribution) is excluded from the export because its ingestion
    // may still be partial at export time; the LAST INCLUDED day is the
    // day before it. Prior complete years are unaffected.
    latest_represented_local_date:
        LATEST_AVAILABLE.latestRepresentedLocalDate,
    last_included_local_date: LATEST_AVAILABLE.lastIncludedLocalDate,
    actual_collection_start: ee.Algorithms.If(count.gt(0),
        ee.Date(raw.aggregate_min('system:time_start'))
            .format('yyyy-MM-dd', CONFIG.timeZone),
        '(none)'),
    actual_collection_end: ee.Algorithms.If(count.gt(0),
        ee.Date(raw.aggregate_max('system:time_start'))
            .format('yyyy-MM-dd', CONFIG.timeZone),
        '(none)'),
    dataset_id: CONFIG.collectionId,
    band: CONFIG.bandName,
    boundary_asset: boundaryDescription,
    boundary_filter:
        CONFIG.boundaryField + ' == "' + CONFIG.boundaryValue + '"',
    timezone: CONFIG.timeZone,
    crs: CONFIG.statsCrs,
    scale_m: CONFIG.statsScale,
    daily_combination_rule: CONFIG.dailyCombinationRule,
    export_created_at: exportCreatedAt,
    script_identifier: SCRIPT_ID
  });
}

/* ------------------------------------------------------ YEAR CONSTRUCTION */

// 'YYYY-MM-DD' from a UTC millisecond timestamp (ES5; no padStart).
function utcDateString(ms) {
  var d = new Date(ms);
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : String(m)) + '-' +
      (day < 10 ? '0' + day : String(day));
}

// Every local calendar date string in [startStr, endStr), via UTC
// arithmetic on the date strings (browser-timezone- and DST-proof) —
// tested scripts 05–06 helper. Client-side UI arithmetic only.
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

// Requested [start, end) window for one export year, handling the
// partial first year (OFFL starts 2018-06-28) and the partial current
// year (end-exclusive at the latest BAAQMD-footprint-intersecting
// represented local date, so the last included day is the day before
// it — the conservative completeness rule above). Prior complete years
// run January 1 through January 1.
// Returns null when the year contributes no dates. ISO date strings
// compare lexicographically.
function yearWindow(year) {
  var start = (year === FIRST_EXPORT_YEAR) ?
      COLLECTION_START : (year + '-01-01');
  var end = (year + 1) + '-01-01';
  if (end > LATEST_AVAILABLE.endExclusive) {
    end = LATEST_AVAILABLE.endExclusive;
  }
  if (start >= end) return null;
  return {start: start, end: end};
}

/*
 * Server-side tables for one export year [start, end): the raw asset
 * collection (with each asset's own local date attached), the
 * defensively reconstructed products, the daily audit features (one per
 * requested local date — including dates with no products and dates
 * with no valid value), and the per-asset metadata features. All
 * science runs inside the batch task; nothing here evaluates
 * interactively.
 */
function buildYearTables(window, regionGeom, totalAreaM2) {
  var raw = loadRawCollection(regionGeom,
      ee.Date(window.start, CONFIG.timeZone),
      ee.Date(window.end, CONFIG.timeZone))
      .map(function (image) {
        return image.set('asset_local_date',
            ee.Date(image.get('system:time_start'))
                .format('yyyy-MM-dd', CONFIG.timeZone));
      });
  var products = buildAuditProducts(raw, regionGeom);
  var dateStrings = dateStringsInRange(window.start, window.end);
  var daily = ee.FeatureCollection(
      ee.List(dateStrings).map(function (d) {
        return dailyAuditFeature(d, raw, products, regionGeom,
            totalAreaM2);
      }));
  var productTable = ee.FeatureCollection(raw.map(assetMetadataFeature));
  return {daily: daily, products: productTable};
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
  warn: '#d03b3b'
};

var studyRegion = getStudyRegion();
var regionGeom = studyRegion.fc.geometry();
var boundaryDescription = studyRegion.isApproximation ?
    'TIGER/2018/Counties county approximation (FALLBACK — official ' +
        'boundary asset unavailable to this account)' :
    CONFIG.boundaryAssetId;

// Latest-date anchor, computed AFTER the study region exists and from
// the SAME single study-region geometry (footprint intersection anchors
// the date range only — it is not contribution). LATEST_YEAR is the
// year of the LAST INCLUDED day (the latest year with exportable
// dates).
var LATEST_AVAILABLE = latestAvailableInfo(regionGeom);
var LATEST_YEAR =
    Number(LATEST_AVAILABLE.lastIncludedLocalDate.substring(0, 4));

var boundaryLayer = ui.Map.Layer(
    studyRegion.fc.style({color: 'black', fillColor: '00000000', width: 2}),
    {},
    studyRegion.isApproximation ?
        'Study region (county approximation of BAAQMD jurisdiction)' :
        'Study region (official BAAQMD jurisdiction)');

var startYearBox = ui.Textbox({
  value: String(FIRST_EXPORT_YEAR),
  placeholder: 'YYYY',
  style: {width: '64px'}
});
var endYearBox = ui.Textbox({
  value: String(LATEST_YEAR),
  placeholder: 'YYYY',
  style: {width: '64px'}
});
var createButton = ui.Button({
  label: 'Create export tasks',
  onClick: createExportTasks
});
var statusLabel = ui.Label('', STYLE.status);

function setStatus(text, isWarning) {
  statusLabel.setValue(text);
  statusLabel.style().set('color', isWarning ? STYLE.warn : '#52514e');
}

function buildPanel() {
  var panel = ui.Panel({style: {width: '420px', padding: '8px'}});

  panel.add(ui.Label('Bay Area Air Quality Episode Finder', STYLE.title));
  panel.add(ui.Label(
      'Exploration 07 — historical-record homogeneity audit export ' +
      '(batch tables for R analysis)',
      STYLE.subtitle));

  panel.add(ui.Label(
      'What this does: creates YEARLY batch Export.table tasks covering ' +
      COLLECTION_START + ' through ' +
      LATEST_AVAILABLE.lastIncludedLocalDate + ' — the day BEFORE the ' +
      'latest BAAQMD-footprint-intersecting represented local date in ' +
      'the OFFL collection (' +
      LATEST_AVAILABLE.latestRepresentedLocalDate + '), which is ' +
      'conservatively excluded because its ingestion may still be ' +
      'partial. Footprint intersection anchors the date range only — ' +
      'it is not contribution. Three outputs: a daily scientific audit ' +
      'table (one row ' +
      'per requested local day, including days with no products and ' +
      'days with no valid value; metadata columns are ' +
      'CONTRIBUTOR-SCOPED), a product metadata table (one row per ' +
      'footprint-intersecting orbit-product asset; the collection-wide ' +
      'metadata record; no NO2 reduction), and one audit manifest (one ' +
      'row per exported year). The homogeneity ANALYSIS happens in ' +
      'analysis/s5p_no2_historical_homogeneity.Rmd — this script draws ' +
      'no conclusion and chooses no outcome.',
      STYLE.body));
  panel.add(ui.Label(
      'Accepted working rules preserved: local calendar dates (' +
      CONFIG.timeZone + ', end exclusive); defensive PRODUCT_ID ' +
      'grouping; pixel-wise arithmetic mean of same-date orbit products ' +
      '(masks ignore non-contributors); valid negatives retained; ' +
      'area-weighted regional means with valid-area fractions at ' +
      CONFIG.statsCrs + ' / ' + CONFIG.statsScale + ' m (fixed ' +
      'reference configuration for THIS AUDIT ONLY — not a final ' +
      'scale); non-NOMINAL products retained and flagged; no coverage ' +
      'threshold; no interpolation; no bestEffort.',
      STYLE.emph));
  panel.add(ui.Label(
      'The NO2 band is a tropospheric vertical column density (mol/m²) ' +
      '— an indicator of column patterns, not a ground-level ' +
      'concentration, not an AQI value, not a health measure, and not ' +
      'an episode result. No baseline, anomaly, or episode logic exists ' +
      'in this script.',
      STYLE.note));

  if (studyRegion.isApproximation) {
    panel.add(ui.Label(
        '⚠ Boundary warning: the official BAAQMD boundary asset is not ' +
        'readable by this account, so the labeled county APPROXIMATION ' +
        'is active. Audit exports should normally use the official ' +
        'boundary — the manifest records which boundary was actually ' +
        'used.',
        {fontSize: '11px', color: STYLE.warn, margin: '4px 8px'}));
  }

  panel.add(ui.Panel({
    widgets: [
      ui.Label('First year', STYLE.note), startYearBox,
      ui.Label('Last year', STYLE.note), endYearBox,
      createButton
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  }));
  panel.add(ui.Label(
      'Valid years: ' + FIRST_EXPORT_YEAR + ' to ' + LATEST_YEAR + '. ' +
      '2018 starts at ' + COLLECTION_START + '. The current year ends ' +
      'at ' + LATEST_AVAILABLE.lastIncludedLocalDate + ' (last included ' +
      'day): the latest BAAQMD-footprint-intersecting represented ' +
      'local date, ' +
      LATEST_AVAILABLE.latestRepresentedLocalDate + ', is ' +
      'conservatively EXCLUDED because OFFL publication latency means ' +
      'its ingestion may still be partial. Both dates are recorded in ' +
      'the manifest; re-create the current-year export later to ' +
      'refresh it.',
      STYLE.note));

  panel.add(statusLabel);

  panel.add(ui.Label(
      'After clicking: START each task from the Tasks tab (batch tasks ' +
      'are created unstarted). Files go to the Drive folder "' +
      CONFIG.driveFolder + '" as CSV. Clicking the button again creates ' +
      'DUPLICATE tasks. Each yearly daily task computes one small ' +
      'regional reduction per product (contributor identification only) ' +
      'plus one per day; expect yearly tasks to run for a while — batch ' +
      'export avoids the interactive timeout that scripts 05–06 worked ' +
      'around with 7-day chunks.',
      STYLE.note));
  panel.add(ui.Label({
    value: 'Project documentation (GitHub)',
    style: STYLE.note,
    targetUrl:
        'https://github.com/perez-eduardo/Bay-Area-Air-Quality-Episode-Finder'
  }));

  return panel;
}

/* ------------------------------------------------------------ TASK CREATION */

function isYearString(s) {
  return /^\d{4}$/.test(s);
}

function createExportTasks() {
  var startRaw = String(startYearBox.getValue()).replace(/\s/g, '');
  var endRaw = String(endYearBox.getValue()).replace(/\s/g, '');

  if (!isYearString(startRaw) || !isYearString(endRaw)) {
    setStatus('⚠ Years must be four-digit integers (YYYY).', true);
    return;
  }
  var startYear = parseInt(startRaw, 10);
  var endYear = parseInt(endRaw, 10);
  if (startYear < FIRST_EXPORT_YEAR || endYear > LATEST_YEAR ||
      startYear > endYear) {
    setStatus('⚠ Year range must satisfy ' + FIRST_EXPORT_YEAR +
        ' ≤ first ≤ last ≤ ' + LATEST_YEAR + '.', true);
    return;
  }

  // Stamped identically into every manifest row of this click.
  var exportCreatedAt = new Date().toISOString();
  var totalAreaM2 = computeTotalAreaM2(regionGeom);

  var manifestFeatures = [];
  var taskNames = [];
  var year, window;
  for (year = startYear; year <= endYear; year++) {
    window = yearWindow(year);
    if (window === null) continue; // year contributes no requested dates

    var tables = buildYearTables(window, regionGeom, totalAreaM2);

    Export.table.toDrive({
      collection: tables.daily,
      description: CONFIG.dailyPrefix + year,
      folder: CONFIG.driveFolder,
      fileNamePrefix: CONFIG.dailyPrefix + year,
      fileFormat: 'CSV',
      selectors: DAILY_COLUMNS
    });
    taskNames.push(CONFIG.dailyPrefix + year +
        ' (' + window.start + ' to ' + window.end + ', end exclusive)');

    Export.table.toDrive({
      collection: tables.products,
      description: CONFIG.productsPrefix + year,
      folder: CONFIG.driveFolder,
      fileNamePrefix: CONFIG.productsPrefix + year,
      fileFormat: 'CSV',
      selectors: PRODUCT_COLUMNS
    });
    taskNames.push(CONFIG.productsPrefix + year);

    manifestFeatures.push(manifestFeature(year, window.start, window.end,
        regionGeom, boundaryDescription, exportCreatedAt));
  }

  if (manifestFeatures.length === 0) {
    setStatus('⚠ The selected year range contains no requested dates.',
        true);
    return;
  }

  Export.table.toDrive({
    collection: ee.FeatureCollection(manifestFeatures),
    description: CONFIG.manifestPrefix,
    folder: CONFIG.driveFolder,
    fileNamePrefix: CONFIG.manifestPrefix,
    fileFormat: 'CSV',
    selectors: MANIFEST_COLUMNS
  });
  taskNames.push(CONFIG.manifestPrefix + ' (one row per exported year)');

  print('Export tasks created (start each from the Tasks tab):',
        taskNames);
  setStatus('Created ' + taskNames.length + ' export tasks for years ' +
      startYear + '–' + endYear + '. Start them from the Tasks tab; ' +
      'files arrive in Drive folder "' + CONFIG.driveFolder + '". ' +
      'Clicking again creates duplicate tasks.', false);
}

/* -------------------------------------------------------------------- INIT */

ui.root.insert(1, buildPanel());
Map.centerObject(studyRegion.fc, 8);
Map.layers().reset([boundaryLayer]);
setStatus('Review the year range, then click "Create export tasks". ' +
    'No Earth Engine computation starts until tasks are created and ' +
    'started.', false);
