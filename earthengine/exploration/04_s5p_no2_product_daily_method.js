/*
 * Bay Area Air Quality Episode Finder
 * Exploration 04 (revised) — orbit-product contribution audit and daily
 * temporal unit evaluation for Sentinel-5P OFFL NO2
 *
 * Purpose: DATA EXPLORATION ONLY. Determines which orbit products actually
 * contain valid unmasked NO2 data over BAAQMD and audits the processing
 * metadata, BEFORE any daily method is chosen. It:
 *   - keeps the study-region boundary handling from scripts 01–03
 *     (official BAAQMD jurisdiction asset, labeled county fallback),
 *   - treats the entered dates as Bay Area LOCAL calendar dates and
 *     filters the collection between local midnights in
 *     America/Los_Angeles (start inclusive, end exclusive),
 *   - reconstructs one image per PRODUCT_ID (defensive; see below),
 *   - measures every product's ACTUAL valid contribution over BAAQMD
 *     (valid area, valid fraction, area-weighted regional mean),
 *   - audits processing metadata (status, quality, processor / algorithm
 *     versions, spatial resolution, HARP version),
 *   - compares, per local calendar day and per period, a daily mean of
 *     ALL same-date orbit products against a daily mean of VALID
 *     CONTRIBUTORS only, including a numerical difference test.
 *
 * COLLECTION MODEL (corrected by the previous live test): the raw members
 * of this Earth Engine collection are ORBIT-PRODUCT ASSETS — one Level-3
 * grid per Sentinel-5P product/orbit. The live Bay Area test (default
 * period) found 1,276 raw assets with 1,276 distinct PRODUCT_ID and ORBIT
 * values — ONE asset per product — rejecting the earlier
 * multiple-tiles-per-product hypothesis. Grouping by PRODUCT_ID remains a
 * DEFENSIVE reconstruction step only because an antimeridian-spanning
 * product can officially appear as two Earth Engine assets.
 *
 * KEY DISTINCTION: filterBounds(BAAQMD) establishes geometric/footprint
 * intersection ONLY — it does not prove that valid measurements exist
 * inside BAAQMD. Roughly 14–15 orbit-product assets were assigned to each
 * local day in the live test; the meaningful daily contributor count is
 * the number of products with valid unmasked pixels over BAAQMD.
 *
 * Every method in this script is an EXPLORATION-STAGE candidate: area
 * weighting, the EPSG:3310 / 7000 m statistics configuration, the local
 * calendar-day rule, and both daily combination variants are under
 * evaluation — none is a validated final method, and no coverage
 * threshold is imposed. This script contains NO baselines, anomalies,
 * episode detection, thresholds, scoring, or modeling. The NO2 band is a
 * TROPOSPHERIC VERTICAL COLUMN density (mol/m^2): an indicator of column
 * patterns, not a ground-level concentration, not an AQI value, not a
 * health measure, and not an episode result.
 *
 * How to run: paste this file into the Earth Engine Code Editor
 * (https://code.earthengine.google.com) and click Run. Structured audit
 * output is printed to the Console.
 *
 * Project docs: https://github.com/perez-eduardo/Bay-Area-Air-Quality-Episode-Finder
 */

/* ------------------------------------------------------------------ CONFIG */

var CONFIG = {
  // Analysis period, 'YYYY-MM-DD' (start inclusive, end exclusive) — the
  // same default range as explorations 01–03. The entered dates are Bay
  // Area LOCAL calendar dates: the collection is filtered between local
  // midnights in CONFIG.timeZone, and all daily grouping uses that same
  // local calendar date.
  startDate: '2023-01-01',
  endDate: '2023-04-01',

  // Official BAAQMD jurisdiction boundary: uploaded California air-district
  // boundaries table asset, filtered to the Bay Area district (see
  // docs/data-sources.md). If the asset is unavailable (e.g., the running
  // account has no read access), the script falls back to the labeled
  // county approximation in getStudyRegion below.
  boundaryAssetId:
      'projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries',
  boundaryField: 'Air_Distri',
  boundaryValue: 'BAY AREA AQMD',

  // First dataset (owner-decided; see docs/data-sources.md).
  collectionId: 'COPERNICUS/S5P/OFFL/L3_NO2',
  bandName: 'tropospheric_NO2_column_number_density',

  // Calendar-day grouping and date labels use the Bay Area local time zone.
  timeZone: 'America/Los_Angeles',

  // Regional-statistics configuration: explicit equal-area CRS
  // (EPSG:3310, California Albers, meters) at an explicit 7000 m scale —
  // no bestEffort, no reproject(). Used for the total-region area, every
  // per-product contribution measurement, and both daily regional-mean
  // series. The 7000 m scale remains an EXPLORATION setting, not a final
  // scientific choice.
  statsCrs: 'EPSG:3310',
  statsScale: 7000,

  // Implementation-consistency tolerance for the all-products vs
  // valid-contributors-only daily difference test, in mol/m^2. This is
  // ONLY a numerical consistency tolerance — not a scientific threshold.
  diffTolerance: 1e-12,

  // Fixed display stretch in mol/m^2 shared by BOTH period-mean map
  // layers so their spatial patterns can be compared visually.
  // Display-only — not an air-quality threshold, AQI, health category, or
  // analysis parameter. Same ramp, range, and opacity as script 03.
  vis: {
    min: 0,
    max: 0.0002,
    palette: ['fff7ec', 'fee8c8', 'fdbb84', 'fc8d59', 'ef6548', 'd7301f',
              '990000']
  },

  // Fixed diagnostic stretch for the |all − valid| period-difference
  // layer. An arbitrary display choice for a NUMERICAL comparison layer —
  // it is not a pollution layer and carries no scientific meaning.
  diffVis: {
    min: 0,
    max: 0.00002,
    palette: ['ffffff', 'b2abd2', '5e3c99']
  },

  layerOpacity: 0.65
};

// Metadata properties audited on every reconstructed product (values may
// be null or absent — never invented; see the audit section).
var AUDIT_PROPS = ['PROCESSING_STATUS', 'PRODUCT_QUALITY',
                   'PROCESSOR_VERSION', 'ALGORITHM_VERSION',
                   'SPATIAL_RESOLUTION', 'HARP_VERSION'];

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
 * (America/Los_Angeles, end-exclusive), so the collection contains exactly
 * the acquisitions belonging to the selected local-date window. The
 * filterBounds means each returned collection member's geometry/footprint
 * INTERSECTS the study region — it does NOT mean the member contains
 * valid NO2 measurements inside BAAQMD.
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

/*
 * One combined regional ee.Reducer.sum() over two diagnostic bands:
 *   valid_area_m2 — pixelArea × valid-mask, with masked / outside-product
 *                   locations FILLED AS ZERO, so a product with no valid
 *                   pixel over BAAQMD returns numeric zero (never null);
 *   weighted_no2  — NO2 × pixelArea × valid-mask, invalid locations
 *                   contributing zero. Valid NEGATIVE NO2 retrievals are
 *                   preserved — they are neither clamped to zero nor
 *                   masked for being negative.
 * Mask handling, in two deliberate steps:
 *   .gt(0) converts the source mask to a BINARY valid-pixel indicator —
 *     Earth Engine masks can hold floating-point values between 0 and 1,
 *     and a pixel counts as valid when its mask is greater than zero;
 *     without .gt(0) a fractional mask would fractionally weight the
 *     valid area instead of acting as a presence indicator (the intended
 *     baaqmd_valid_area_m2 diagnostic is the area of valid pixels: 1
 *     where valid, 0 where invalid).
 *   unmask(0, false) fills masked and outside-footprint locations with
 *     zero — sameFootprint = false is necessary because the default
 *     (sameFootprint = true) keeps the fill inside the image's own
 *     footprint, so locations OUTSIDE the orbit-product footprint would
 *     not become valid zero-valued pixels and a product with no valid
 *     BAAQMD pixels could return null sums instead of numeric zero. With
 *     it, masked and outside-product locations contribute numeric zero
 *     throughout the BAAQMD reduction region.
 * BAAQMD geometry is supplied directly; explicit CONFIG.statsCrs /
 * CONFIG.statsScale; no bestEffort; no reproject().
 */
function contributionSums(image, regionGeom) {
  var pixelArea = ee.Image.pixelArea();
  var validMask = image.mask()
      .gt(0)
      .rename('valid_mask')
      .unmask(0, false);
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
 * DEFENSIVE product reconstruction. Collection members are grouped by
 * PRODUCT_ID and only same-PRODUCT_ID assets are mosaicked — never
 * distinct products. In the live Bay Area test every product had exactly
 * one asset (asset_count_for_product = 1), making the mosaic a no-op; the
 * step is kept because an antimeridian-spanning product can officially
 * appear as two Earth Engine assets.
 *
 * Metadata is copied defensively from the first asset in the group with
 * copyProperties (no property list, so properties that are absent simply
 * stay absent — no values are invented). Each product image then gets:
 *   PRODUCT_ID, asset_count_for_product,
 *   system:time_start (earliest asset timestamp of the product),
 *   local_date ('yyyy-MM-dd' — calendar year; uppercase 'YYYY' is Joda
 *     week-based year and is wrong near year boundaries),
 *   baaqmd_valid_area_m2, baaqmd_valid_fraction,
 *   baaqmd_area_weighted_mean_no2 (null when no valid area — a null value
 *     removes/omits the property, which the client reads as null),
 *   has_valid_baaqmd_data (1/0; 1 only when the valid area is > 0, which
 *     by construction is exactly when the area-weighted mean is
 *     non-null).
 * ORBIT, PROCESSING_STATUS, PRODUCT_QUALITY, PROCESSOR_VERSION,
 * ALGORITHM_VERSION, SPATIAL_RESOLUTION, HARP_VERSION, and
 * L3_PROCESSING_TIME ride along via the defensive copy when present.
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
    // has_valid_baaqmd_data is intentionally stored as numeric 1 or 0
    // (ee.Number.gt returns 1/0), keeping the server-side filter
    // ee.Filter.eq('has_valid_baaqmd_data', 1) and the client-side check
    // p.has_valid === 1 consistent.
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
 * Two daily image collections over the same local dates (every date with
 * at least one orbit product), both with the same local-midnight
 * system:time_start and the same date_string, so they align by calendar
 * date:
 *   all   — pixel-wise arithmetic mean of ALL same-date reconstructed
 *           product images, relying on Earth Engine masks;
 *   valid — pixel-wise arithmetic mean of only the products with
 *           has_valid_baaqmd_data = 1. A date with zero valid
 *           contributors gets a correctly named, fully masked placeholder
 *           image so the date remains traceable.
 * mosaic() is NEVER used to choose between distinct products. Contributor
 * counts and product identifiers are retained on every daily image.
 */
function buildDailyCollections(products) {
  var dates = ee.List(products.aggregate_array('local_date'))
      .distinct().sort();

  var all = ee.ImageCollection.fromImages(dates.map(function (d) {
    d = ee.String(d);
    var dayProducts = products.filter(ee.Filter.eq('local_date', d));
    return dayProducts.mean().set({
      'system:time_start': ee.Date(d, CONFIG.timeZone).millis(),
      'date_string': d,
      'daily_method': 'mean_all_orbit_products',
      'total_product_count': dayProducts.size(),
      'product_ids': dayProducts.aggregate_array('PRODUCT_ID'),
      'orbit_numbers': dayProducts.aggregate_array('ORBIT')
    });
  }));

  var valid = ee.ImageCollection.fromImages(dates.map(function (d) {
    d = ee.String(d);
    var contributors = products
        .filter(ee.Filter.eq('local_date', d))
        .filter(ee.Filter.eq('has_valid_baaqmd_data', 1));
    var count = contributors.size();
    // Fully masked placeholder (double, same band name) keeps zero-valid
    // dates traceable without contributing pixels to any mean.
    var placeholder = ee.Image.constant(0).double()
        .rename(CONFIG.bandName)
        .updateMask(ee.Image.constant(0));
    var image = ee.Image(ee.Algorithms.If(
        count.gt(0), contributors.mean(), placeholder));
    return image.set({
      'system:time_start': ee.Date(d, CONFIG.timeZone).millis(),
      'date_string': d,
      'daily_method': ee.Algorithms.If(count.gt(0),
          'mean_valid_contributors', 'placeholder_no_valid_contributor'),
      'valid_contributor_count': count,
      'product_ids': contributors.aggregate_array('PRODUCT_ID'),
      'orbit_numbers': contributors.aggregate_array('ORBIT')
    });
  }));

  return {dates: dates, all: all, valid: valid};
}

/*
 * One merged FeatureCollection carrying everything the UI needs, evaluated
 * in a single server round trip:
 *   series 'collection_meta' — raw collection-member count, used to
 *       cross-check that PRODUCT_ID grouping accounted for every member;
 *   series 'product' — per reconstructed product: identity, audit
 *       metadata (values may be absent — read as missing), and the BAAQMD
 *       contribution numbers;
 *   series 'daily' — per local date: total product count, valid
 *       contributor count, and the two daily area-weighted regional means
 *       (all-products vs valid-contributors-only), computed with the SAME
 *       valid-area method as the per-product numbers.
 */
function buildEvaluationFeatures(raw, products, daily, regionGeom) {
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
      processing_status: image.get('PROCESSING_STATUS'),
      product_quality: image.get('PRODUCT_QUALITY'),
      processor_version: image.get('PROCESSOR_VERSION'),
      algorithm_version: image.get('ALGORITHM_VERSION'),
      spatial_resolution: image.get('SPATIAL_RESOLUTION'),
      harp_version: image.get('HARP_VERSION'),
      valid_area_m2: image.get('baaqmd_valid_area_m2'),
      valid_fraction: image.get('baaqmd_valid_fraction'),
      area_weighted_mean_no2: image.get('baaqmd_area_weighted_mean_no2'),
      has_valid: image.get('has_valid_baaqmd_data')
    });
  }));

  var dailyFeatures = ee.FeatureCollection(daily.dates.map(function (d) {
    d = ee.String(d);
    var allImg = ee.Image(
        daily.all.filter(ee.Filter.eq('date_string', d)).first());
    var validImg = ee.Image(
        daily.valid.filter(ee.Filter.eq('date_string', d)).first());
    return ee.Feature(null, {
      series: 'daily',
      millis: ee.Date(d, CONFIG.timeZone).millis(),
      date_string: d,
      total_product_count: allImg.get('total_product_count'),
      valid_contributor_count: validImg.get('valid_contributor_count'),
      all_products_mean: areaWeightedMean(
          contributionSums(allImg, regionGeom)),
      valid_only_mean: areaWeightedMean(
          contributionSums(validImg, regionGeom))
    });
  }));

  return collectionMeta.merge(productFeatures).merge(dailyFeatures);
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
  allColor: '#2a78d6',     // all-orbit-products series (blue)
  validColor: '#c2610f',   // valid-contributors series (orange, primary)
  totalColor: '#cdccc8',   // subdued total-products comparison bars
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
// exactly this many Bay Area local calendar days (DST changes the length
// of a day in hours, not the day count).
function daysBetween(startStr, endStr) {
  return Math.round((Date.parse(endStr) - Date.parse(startStr)) / 86400000);
}

function median(values) {
  var s = values.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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
 * Daily regional-mean comparison: all orbit products vs valid contributors
 * only. Both series share the same local-midnight timestamps, so rows are
 * merged by timestamp and align point-for-point by local calendar date. A
 * null mean (no valid area that day) is a real gap — not interpolated.
 */
function makeComparisonChart(dailyRows, startStr, endStr) {
  var rows = [];
  for (var i = 0; i < dailyRows.length; i++) {
    rows.push({c: [
      {v: toChartDateTime(dailyRows[i].t)},
      {v: dailyRows[i].allMean},
      {v: dailyRows[i].validMean}
    ]});
  }
  return ui.Chart({
    dataTable: {
      cols: [
        {id: 'time', label: 'Local calendar day', type: 'datetime'},
        {id: 'all', label: 'All orbit products (daily area-weighted mean)',
         type: 'number'},
        {id: 'valid', label: 'Valid contributors only', type: 'number'}
      ],
      rows: rows
    },
    chartType: 'LineChart',
    options: {
      title: 'Daily BAAQMD area-weighted mean NO2 — all orbit products vs ' +
          'valid contributors only, ' + startStr + ' to ' + endStr,
      titleTextStyle: {fontSize: 12, bold: false},
      interpolateNulls: false, // a day with no valid area is a real gap
      hAxis: {gridlines: {color: STYLE.grid}},
      vAxis: {
        title: 'mol/m²',
        format: 'scientific',
        gridlines: {color: STYLE.grid}
      },
      series: {
        0: {lineWidth: 1, pointSize: 3, color: STYLE.allColor},
        1: {lineWidth: 1, pointSize: 3, color: STYLE.validColor}
      },
      legend: {position: 'top', textStyle: {fontSize: 11}},
      chartArea: {left: 64, right: 16, top: 48, bottom: 32}
    }
  });
}

/*
 * Valid contributors per local day (primary series) with the total
 * orbit-product count as a subdued comparison series. The valid
 * contributor count — products with valid unmasked BAAQMD pixels — is the
 * meaningful number; the total merely counts footprint-intersecting
 * collection members.
 */
function makeContributorChart(dailyRows) {
  var rows = [];
  for (var i = 0; i < dailyRows.length; i++) {
    rows.push({c: [
      {v: toChartDateTime(dailyRows[i].t)},
      {v: dailyRows[i].validCount},
      {v: dailyRows[i].totalCount}
    ]});
  }
  return ui.Chart({
    dataTable: {
      cols: [
        {id: 'day', label: 'Local calendar day', type: 'datetime'},
        {id: 'valid', label: 'Valid contributors (primary)',
         type: 'number'},
        {id: 'total', label: 'All footprint-intersecting products',
         type: 'number'}
      ],
      rows: rows
    },
    chartType: 'ColumnChart',
    options: {
      title: 'Orbit products with valid BAAQMD data per local calendar day',
      titleTextStyle: {fontSize: 12, bold: false},
      hAxis: {gridlines: {color: STYLE.grid}},
      vAxis: {
        title: 'products',
        viewWindow: {min: 0},
        format: '0',
        gridlines: {color: STYLE.grid}
      },
      series: {
        0: {color: STYLE.validColor},
        1: {color: STYLE.totalColor}
      },
      legend: {position: 'top', textStyle: {fontSize: 11}},
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

// Map display selection. All three layers are display copies clipped to
// BAAQMD so valid data outside the study region cannot confuse the test.
var DISPLAY_LABELS = {
  'Period mean — valid contributors only': 'valid',
  'Period mean — all orbit products': 'all',
  'Difference |all − valid| (numerical diagnostic)': 'diff'
};
var currentDisplay = 'valid';

// Result cache for the latest completed refresh. Display switches re-render
// the map and legend from this cache without recomputing. null until the
// first refresh completes (or while one is running).
//   {hasData, startStr, endStr, allMean, validMean, diffMean}
var state = null;

// Guards against out-of-order async results when Update is clicked again
// before the previous computation finishes.
var refreshToken = 0;

var displaySelect = ui.Select({
  items: Object.keys(DISPLAY_LABELS),
  value: 'Period mean — valid contributors only',
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
var updateButton = ui.Button({label: 'Update', onClick: refresh});

var statusLabel = ui.Label('', STYLE.status);
var warningsPanel = ui.Panel();
var summaryPanel = ui.Panel();
var auditPanel = ui.Panel();
var comparisonChartPanel = ui.Panel();
var contributorChartPanel = ui.Panel();
var legendPanel = ui.Panel();

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
var LOADING_FRAMES = ['Computing', 'Computing.', 'Computing..',
                      'Computing...'];
// Rendered on its own line below the animated word (whiteSpace: 'pre'
// makes the label honor the newline).
var LOADING_SUFFIX = '\nLong periods can take a while.';
var loadingTimerId = null;

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

function startLoadingAnimation() {
  stopLoadingAnimation(); // only one loading timer may exist at a time
  var frame = 0;
  statusLabel.style().set(LOADING_STYLE);
  statusLabel.setValue(LOADING_FRAMES[0] + LOADING_SUFFIX);
  loadingTimerId = ui.util.setInterval(function () {
    frame = (frame + 1) % LOADING_FRAMES.length;
    statusLabel.setValue(LOADING_FRAMES[frame] + LOADING_SUFFIX);
  }, 450);
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
      'Exploration 04 (revised) — orbit-product contribution audit ' +
      '(under evaluation)',
      STYLE.subtitle));

  panel.add(ui.Label(
      'Collection model: the raw members of this collection are ' +
      'ORBIT-PRODUCT ASSETS — one Level-3 grid per Sentinel-5P ' +
      'product/orbit. The previous live test found one asset per ' +
      'product/orbit for the default Bay Area period, rejecting the ' +
      'earlier multiple-assets-per-product hypothesis; grouping by ' +
      'PRODUCT_ID is kept only as a defensive step for the official ' +
      'antimeridian exception (a product spanning it can appear as two ' +
      'assets).',
      STYLE.emph));
  panel.add(ui.Label(
      'filterBounds(BAAQMD) establishes geometric/footprint intersection ' +
      'only — it does NOT prove valid measurements exist inside BAAQMD. ' +
      'This revision measures each product\'s ACTUAL valid contribution ' +
      '(valid area, valid fraction, area-weighted regional mean), audits ' +
      'the processing metadata, and compares an all-products daily mean ' +
      'against a valid-contributors-only daily mean.',
      STYLE.body));
  panel.add(ui.Label(
      'Everything here is an exploration-stage candidate under owner ' +
      'evaluation: area weighting, the ' + CONFIG.statsCrs + ' / ' +
      CONFIG.statsScale + ' m statistics configuration, the local ' +
      'calendar-day rule, and both daily variants. No coverage threshold ' +
      'is imposed; no daily method is decided. Valid negative NO2 ' +
      'retrievals are preserved (retrieval noise can legitimately ' +
      'produce them).',
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
    widgets: [ui.Label('Map layer', STYLE.note), displaySelect],
    layout: ui.Panel.Layout.flow('horizontal')
  }));
  panel.add(ui.Panel({
    widgets: [
      ui.Label('Start', STYLE.note), startBox,
      ui.Label('End', STYLE.note), endBox,
      updateButton
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  }));

  panel.add(statusLabel);
  panel.add(warningsPanel);
  panel.add(summaryPanel);
  panel.add(comparisonChartPanel);
  panel.add(contributorChartPanel);
  panel.add(auditPanel);
  panel.add(legendPanel);

  panel.add(ui.Label(
      'Notes: the entered dates are Bay Area local calendar dates; the ' +
      'collection is filtered between local midnights in ' +
      CONFIG.timeZone + ' (end date exclusive), and both daily series ' +
      'group by that same local date with local-midnight timestamps. All ' +
      'regional statistics use the BAAQMD geometry directly in ' +
      CONFIG.statsCrs + ' at an explicit ' + CONFIG.statsScale + ' m ' +
      'scale — no bestEffort, no reproject(). The ' +
      fmtMol(CONFIG.diffTolerance) + ' mol/m² difference tolerance is an ' +
      'implementation-consistency check only, not a scientific ' +
      'threshold. Structured audit output is printed to the Console. ' +
      'This request computes one regional reduction per product and per ' +
      'day and can take a while.',
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

/*
 * Rebuilds the map layers and legend for the current display selection
 * from the cached `state`. Called after every completed refresh and on
 * every selector change; draws the boundary only while a refresh is
 * computing or when the period has no data. All three layers are
 * display-only clipped copies — the analysis images stayed unclipped.
 */
function renderDisplay() {
  renderLegend();
  if (state === null || !state.hasData) {
    Map.layers().reset([boundaryLayer]);
    return;
  }
  var layer;
  if (currentDisplay === 'all') {
    layer = ui.Map.Layer(state.allMean, CONFIG.vis,
        'Period mean NO2 — all orbit products, ' +
            state.startStr + ' to ' + state.endStr,
        true, CONFIG.layerOpacity);
  } else if (currentDisplay === 'valid') {
    layer = ui.Map.Layer(state.validMean, CONFIG.vis,
        'Period mean NO2 — valid contributors only, ' +
            state.startStr + ' to ' + state.endStr,
        true, CONFIG.layerOpacity);
  } else {
    layer = ui.Map.Layer(state.diffMean, CONFIG.diffVis,
        'Difference |all − valid| (numerical diagnostic), ' +
            state.startStr + ' to ' + state.endStr,
        true, CONFIG.layerOpacity);
  }
  Map.layers().reset([layer, boundaryLayer]);
}

function renderLegend() {
  legendPanel.clear();
  if (currentDisplay === 'diff') {
    legendPanel.add(ui.Label(
        'Legend — |all − valid| period difference (numerical diagnostic)',
        STYLE.emph));
    legendPanel.add(makeColorBar(CONFIG.diffVis.palette));
    legendPanel.add(labelRow([
      fmtMol(CONFIG.diffVis.min),
      fmtMol(CONFIG.diffVis.max) + ' mol/m²'
    ]));
    legendPanel.add(ui.Label(
        'Absolute difference between the two period-mean computation ' +
        'paths, on an arbitrary fixed diagnostic stretch. This is a ' +
        'numerical comparison layer — NOT a pollution layer, not an AQI, ' +
        'and not evidence of air quality. It is not used to select a ' +
        'method automatically.',
        STYLE.note));
    return;
  }
  legendPanel.add(ui.Label(
      'Legend — shared fixed display scale (both period-mean layers)',
      STYLE.emph));
  legendPanel.add(makeColorBar(CONFIG.vis.palette));
  legendPanel.add(labelRow([
    fmtMol(CONFIG.vis.min),
    fmtMol((CONFIG.vis.min + CONFIG.vis.max) / 2),
    fmtMol(CONFIG.vis.max) + ' mol/m²'
  ]));
  legendPanel.add(ui.Label(
      'Mean tropospheric NO2 column density in mol/m². Both period-mean ' +
      'layers use this identical fixed stretch and opacity so their ' +
      'spatial patterns can be compared; values above the maximum render ' +
      'as the darkest color. Colors are a numerical display stretch only ' +
      '— not an AQI, not health categories, and not a ' +
      'pollution/no-pollution classification.',
      STYLE.note));
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
  summaryPanel.clear();
  auditPanel.clear();
  comparisonChartPanel.clear();
  contributorChartPanel.clear();
  state = null;
  renderDisplay(); // boundary only until results arrive
  var token = ++refreshToken;

  // Local-midnight filter boundaries: the entered strings are Bay Area
  // local calendar dates, start inclusive, end exclusive.
  var startLocal = ee.Date(startStr, CONFIG.timeZone);
  var endLocal = ee.Date(endStr, CONFIG.timeZone);
  var raw = loadRawCollection(regionGeom, startLocal, endLocal);
  var totalAreaM2 = computeTotalAreaM2(regionGeom);
  var products = buildProductImages(raw, regionGeom, totalAreaM2);
  var daily = buildDailyCollections(products);

  buildEvaluationFeatures(raw, products, daily, regionGeom).evaluate(
      function (fc, error) {
    if (token !== refreshToken) return; // superseded by a newer Update

    // The CURRENT request has reached a terminal state (error, no-data, or
    // success below): stop the loading animation, restore normal status
    // styling, and re-enable Update. Stale callbacks returned above and
    // never touch the loading state.
    stopLoadingAnimation();
    updateButton.setDisabled(false);

    if (error) {
      setStatus('⚠ Computation failed: ' + error, true);
      return;
    }

    /* ---- Client-side handling of already-evaluated results only ---- */

    var warnings = [];
    function addWarning(text) {
      warnings.push(text);
      print('⚠ ' + text);
    }

    var rawCount = null;
    var productRows = [];
    var dailyRows = [];
    var i, p;
    for (i = 0; i < fc.features.length; i++) {
      p = fc.features[i].properties;
      if (p.series === 'collection_meta') {
        rawCount = p.raw_count;
      } else if (p.series === 'product') {
        productRows.push({
          t: p.millis,
          productId: p.product_id,
          orbit: p.orbit !== undefined ? p.orbit : null,
          assetCount: p.asset_count_for_product,
          localDate: p.local_date,
          processingStatus:
              p.processing_status !== undefined ? p.processing_status : null,
          productQuality:
              p.product_quality !== undefined ? p.product_quality : null,
          processorVersion:
              p.processor_version !== undefined ? p.processor_version : null,
          algorithmVersion:
              p.algorithm_version !== undefined ? p.algorithm_version : null,
          spatialResolution:
              p.spatial_resolution !== undefined ?
                  p.spatial_resolution : null,
          harpVersion:
              p.harp_version !== undefined ? p.harp_version : null,
          validArea: typeof p.valid_area_m2 === 'number' ?
              p.valid_area_m2 : 0,
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
          totalCount: p.total_product_count,
          validCount: p.valid_contributor_count,
          allMean: typeof p.all_products_mean === 'number' ?
              p.all_products_mean : null,
          validMean: typeof p.valid_only_mean === 'number' ?
              p.valid_only_mean : null
        });
      }
    }
    productRows.sort(byTime);
    dailyRows.sort(byTime);

    /* ---- Structure and defensive-grouping cross-checks ---- */

    var assetSum = 0;
    var assetCounts = [];
    var orbitSeen = {};
    var orbitCount = 0;
    for (i = 0; i < productRows.length; i++) {
      assetSum += productRows[i].assetCount;
      assetCounts.push(productRows[i].assetCount);
      var orbitKey = String(productRows[i].orbit);
      if (productRows[i].orbit !== null && !orbitSeen[orbitKey]) {
        orbitSeen[orbitKey] = true;
        orbitCount++;
      }
    }
    if (rawCount !== null && rawCount !== assetSum) {
      addWarning('Grouped asset-count mismatch: ' + rawCount +
          ' raw collection members but per-product asset counts sum to ' +
          assetSum + '. Some members may be missing PRODUCT_ID — ' +
          'investigate before relying on this grouping.');
    }

    // Assertion: with local-midnight filter boundaries, every product's
    // local date must lie inside the selected local-date window.
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

    /* ---- Contribution metrics ---- */

    var validProducts = 0;
    var contributorFractions = [];
    for (i = 0; i < productRows.length; i++) {
      if (productRows[i].hasValid) {
        validProducts++;
        contributorFractions.push(productRows[i].validFraction);
      }
    }

    /* ---- Processing-metadata audit (client-side, exact values) ---- */

    var auditFields = [
      {key: 'processingStatus', name: 'PROCESSING_STATUS'},
      {key: 'productQuality', name: 'PRODUCT_QUALITY'},
      {key: 'processorVersion', name: 'PROCESSOR_VERSION'},
      {key: 'algorithmVersion', name: 'ALGORITHM_VERSION'},
      {key: 'spatialResolution', name: 'SPATIAL_RESOLUTION'},
      {key: 'harpVersion', name: 'HARP_VERSION'}
    ];
    var audit = {};
    for (i = 0; i < auditFields.length; i++) {
      var field = auditFields[i];
      var counts = {};
      var missing = 0;
      for (var j = 0; j < productRows.length; j++) {
        var value = productRows[j][field.key];
        if (value === null) {
          missing++;
        } else {
          var valueKey = String(value);
          counts[valueKey] = (counts[valueKey] || 0) + 1;
        }
      }
      audit[field.name] = {values: counts, missing: missing};
      if (missing > 0) {
        addWarning('Metadata gap: ' + missing + ' of ' +
            productRows.length + ' products are missing ' + field.name +
            '. Values are reported as found — nothing is invented or ' +
            'excluded.');
      }
    }
    // Multiple processor/algorithm/spatial-resolution values → visible
    // historical-consistency warning (no homogeneity verdict either way
    // from this one test).
    var versionFields = ['PROCESSOR_VERSION', 'ALGORITHM_VERSION',
                         'SPATIAL_RESOLUTION'];
    for (i = 0; i < versionFields.length; i++) {
      var distinct = 0;
      for (var vk in audit[versionFields[i]].values) {
        if (audit[versionFields[i]].values.hasOwnProperty(vk)) distinct++;
      }
      if (distinct > 1) {
        addWarning('Multiple ' + versionFields[i] + ' values in this ' +
            'period (' + distinct + '). Historical consistency requires ' +
            'further investigation — this single test does not establish ' +
            'whether the collection is homogeneous or inhomogeneous.');
      }
    }
    print('Processing metadata audit (distinct values, counts, missing):',
          audit);

    /* ---- Daily contributor diagnostic ---- */

    var perDateValid = {};
    for (i = 0; i < productRows.length; i++) {
      p = productRows[i];
      if (!perDateValid[p.localDate]) perDateValid[p.localDate] = [];
      if (p.hasValid) perDateValid[p.localDate].push(p);
    }
    var dailyDiagnostics = [];
    var daysOneValid = 0;
    var daysMultiValid = 0;
    var daysNoValid = 0;
    for (i = 0; i < dailyRows.length; i++) {
      var day = dailyRows[i];
      var contributors = perDateValid[day.date] || [];
      var fractions = [];
      var ids = [];
      var orbits = [];
      for (var c = 0; c < contributors.length; c++) {
        fractions.push(contributors[c].validFraction);
        ids.push(contributors[c].productId);
        orbits.push(contributors[c].orbit);
      }
      if (day.validCount === 1) daysOneValid++;
      else if (day.validCount > 1) daysMultiValid++;
      else daysNoValid++;
      // No valid contributor → min/median/max are null, not zero.
      dailyDiagnostics.push({
        date: day.date,
        totalProducts: day.totalCount,
        validProducts: day.validCount,
        productsWithoutValid: day.totalCount - day.validCount,
        validProductIds: ids,
        validOrbits: orbits,
        minValidFraction: fractions.length ?
            Math.min.apply(null, fractions) : null,
        medianValidFraction: fractions.length ? median(fractions) : null,
        maxValidFraction: fractions.length ?
            Math.max.apply(null, fractions) : null
      });
      if (contributors.length !== day.validCount) {
        addWarning('Contributor cross-check mismatch on ' + day.date +
            ': server-side valid_contributor_count ' + day.validCount +
            ' vs client-side per-product count ' + contributors.length +
            '.');
      }
    }
    print('Daily contributor diagnostic (per local date):',
          dailyDiagnostics);

    /* ---- All-products vs valid-only numerical difference test ---- */

    // Hypothesis under test (not an assumed outcome): products with no
    // valid BAAQMD pixels are ignored by masks, so removing them should
    // not alter the BAAQMD result.
    var maxDiff = null;
    var exceedDates = [];
    for (i = 0; i < dailyRows.length; i++) {
      var a = dailyRows[i].allMean;
      var v = dailyRows[i].validMean;
      var diff = (a !== null && v !== null) ? Math.abs(a - v) : null;
      dailyRows[i].diff = diff;
      if (diff !== null && (maxDiff === null || diff > maxDiff)) {
        maxDiff = diff;
      }
      if (diff !== null && diff > CONFIG.diffTolerance) {
        exceedDates.push(dailyRows[i].date);
      }
    }
    if (exceedDates.length > 0) {
      addWarning('All-products vs valid-only daily means differ by more ' +
          'than ' + fmtMol(CONFIG.diffTolerance) + ' mol/m² on ' +
          exceedDates.length + ' day(s): ' + exceedDates.join(', ') +
          '. The masks-ignore-empty-products hypothesis did not hold ' +
          'exactly — investigate before choosing a daily method.');
    }

    /* ---- Render warnings, summary, audit panel ---- */

    if (warnings.length > 0) {
      warningsPanel.add(ui.Label('Warnings (also in the Console; none ' +
          'trigger automatic exclusions):', STYLE.emph));
      for (i = 0; i < warnings.length; i++) {
        warningsPanel.add(ui.Label('⚠ ' + warnings[i], STYLE.warnLabel));
      }
    }

    var totalDays = daysBetween(startStr, endStr);
    var daysNoProduct = Math.max(0, totalDays - dailyRows.length);

    summaryPanel.add(ui.Label('Collection structure', STYLE.emph));
    summaryPanel.add(ui.Label(
        'Raw Earth Engine collection members (orbit-product assets whose ' +
            'footprints intersect the study region — intersection only, ' +
            'not valid contribution): ' +
            (rawCount !== null ? rawCount : assetSum),
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Distinct products (PRODUCT_ID): ' + productRows.length,
        STYLE.body));
    summaryPanel.add(ui.Label('Distinct orbits: ' + orbitCount,
        STYLE.body));
    summaryPanel.add(ui.Label(
        assetCounts.length ?
            'Assets per product — min ' +
                Math.min.apply(null, assetCounts) + ', median ' +
                median(assetCounts) + ', max ' +
                Math.max.apply(null, assetCounts) +
                ' (more than 1 is expected only for the antimeridian ' +
                'exception)' :
            'Assets per product — not applicable (no products).',
        STYLE.body));

    summaryPanel.add(ui.Label('Actual BAAQMD contribution', STYLE.emph));
    summaryPanel.add(ui.Label(
        'Products WITH valid BAAQMD data: ' + validProducts, STYLE.body));
    summaryPanel.add(ui.Label(
        'Products WITHOUT valid BAAQMD data: ' +
            (productRows.length - validProducts),
        STYLE.body));
    summaryPanel.add(ui.Label(
        contributorFractions.length ?
            'Contributor valid fraction — min ' +
                Math.min.apply(null, contributorFractions).toFixed(3) +
                ', median ' + median(contributorFractions).toFixed(3) +
                ', max ' +
                Math.max.apply(null, contributorFractions).toFixed(3) :
            'Contributor valid fraction — not applicable (no ' +
                'contributing products).',
        STYLE.body));

    summaryPanel.add(ui.Label('Local calendar days', STYLE.emph));
    summaryPanel.add(ui.Label(
        'Days in the selected range: ' + totalDays, STYLE.body));
    summaryPanel.add(ui.Label(
        'Days with exactly one valid contributing product: ' + daysOneValid,
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Days with more than one valid contributing product: ' +
            daysMultiValid,
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Days with orbit products but no valid contributor: ' + daysNoValid,
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Days with no orbit product: ' + daysNoProduct, STYLE.body));

    summaryPanel.add(ui.Label(
        'All-products vs valid-only consistency test', STYLE.emph));
    summaryPanel.add(ui.Label(
        'Maximum non-null absolute daily difference: ' +
            (maxDiff === null ? 'not applicable (no comparable days)' :
                fmtMol(maxDiff) + ' mol/m²'),
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Days exceeding the ' + fmtMol(CONFIG.diffTolerance) +
            ' mol/m² consistency tolerance: ' + exceedDates.length +
            (exceedDates.length > 0 ?
                ' (' + exceedDates.join(', ') + ')' : ''),
        STYLE.body));
    summaryPanel.add(ui.Label(
        'Hypothesis under test: fully non-contributing products are ' +
        'ignored by masks, so removing them should not change the BAAQMD ' +
        'result. This is tested, not assumed; the tolerance is an ' +
        'implementation-consistency check, not a scientific threshold.',
        STYLE.note));

    auditPanel.add(ui.Label('Processing metadata audit', STYLE.emph));
    auditPanel.add(ui.Label(
        'Exact values as found across ' + productRows.length +
        ' products (nothing assumed, excluded, or altered):', STYLE.note));
    for (i = 0; i < auditFields.length; i++) {
      var entry = audit[auditFields[i].name];
      var parts = [];
      for (var key in entry.values) {
        if (entry.values.hasOwnProperty(key)) {
          parts.push('"' + key + '" ×' + entry.values[key]);
        }
      }
      auditPanel.add(ui.Label(
          auditFields[i].name + ': ' +
              (parts.length ? parts.join(', ') : '(none found)') +
              '; missing: ' + entry.missing,
          STYLE.body));
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

    /* ---- Success: cache display images, draw charts ---- */

    var allMeanImg = daily.all.mean();
    var validMeanImg = daily.valid.mean();
    state = {
      hasData: true,
      startStr: startStr,
      endStr: endStr,
      // Display copies ONLY are clipped to BAAQMD (so valid data outside
      // the study region cannot confuse the comparison); the analysis
      // images that fed the regional statistics stayed unclipped.
      allMean: allMeanImg.clip(regionGeom),
      validMean: validMeanImg.clip(regionGeom),
      diffMean: allMeanImg.subtract(validMeanImg).abs().clip(regionGeom)
    };
    renderDisplay();
    comparisonChartPanel.add(
        makeComparisonChart(dailyRows, startStr, endStr));
    contributorChartPanel.add(makeContributorChart(dailyRows));

    setStatus(
        (rawCount !== null ? rawCount : assetSum) + ' collection members; ' +
        productRows.length + ' products, of which ' + validProducts +
        ' have valid BAAQMD data; valid contributors on ' +
        (daysOneValid + daysMultiValid) + ' of ' + totalDays +
        ' local days; ' + warnings.length + ' warning(s). All methods ' +
        'here remain UNDER EVALUATION — no daily method is decided.',
        warnings.length > 0);
  });
}

/* -------------------------------------------------------------------- INIT */

ui.root.insert(1, buildPanel());
Map.centerObject(studyRegion.fc, 8);
refresh();
