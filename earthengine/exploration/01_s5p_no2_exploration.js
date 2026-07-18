/*
 * Bay Area Air Quality Episode Finder
 * Exploration 01 — Sentinel-5P OFFL tropospheric NO2 over the BAAQMD jurisdiction
 *
 * Purpose: DATA EXPLORATION ONLY.
 *   - displays the study-region boundary (official BAAQMD jurisdiction; see
 *     the boundary note in getStudyRegion below),
 *   - loads Sentinel-5P OFFL tropospheric NO2 and filters it by a
 *     configurable date range,
 *   - displays the mean tropospheric NO2 column layer for that period,
 *   - charts the regional mean NO2 over time,
 *   - reports when the selected period contains little or no usable data.
 *
 * This script contains NO episode detection, thresholds, scoring, or
 * modeling. Satellite NO2 column density is an indicator of pollution
 * patterns in the atmospheric column — it is not a ground-level
 * concentration, not an AQI, and not air-quality advice.
 *
 * How to run: paste this file into the Earth Engine Code Editor
 * (https://code.earthengine.google.com) and click Run. Adjust the dates in
 * the side panel and click Update, or edit CONFIG below and re-run.
 *
 * Project docs: https://github.com/perez-eduardo/Bay-Area-Air-Quality-Episode-Finder
 */

/* ------------------------------------------------------------------ CONFIG */

var CONFIG = {
  // Analysis period, 'YYYY-MM-DD' (start inclusive, end exclusive).
  // Sentinel-5P OFFL NO2 imagery is available from late June 2018 onward.
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

  // Display stretch for the map layer. Visualization only — NOT an
  // air-quality threshold of any kind. Sequential single-hue ramp,
  // light (low) to dark (high).
  vis: {
    min: 0,
    max: 0.0002, // mol/m^2
    palette: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5',
              '#256abf', '#184f95', '#0d366b']
  },

  // Reduction scale in meters for the chart and the coverage check. Coarser
  // than the ~1113 m native L3 grid so interactive exploration stays
  // responsive; exploration convenience, not analysis-grade statistics.
  reduceScale: 5000,

  // Display-only heuristic: below this valid-pixel fraction the panel warns
  // that the period has limited usable data. UI convenience for exploration,
  // not a methodological threshold.
  lowCoverageFraction: 0.5
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

function loadNo2Collection(regionGeom, startDate, endDate) {
  return ee.ImageCollection(CONFIG.collectionId)
      .select(CONFIG.bandName)
      .filterDate(startDate, endDate)
      .filterBounds(regionGeom);
}

function meanComposite(collection, regionGeom) {
  return collection.mean().clip(regionGeom);
}

/*
 * Computes simple data-availability facts and passes them to `callback` as
 * {imageCount: number, coverageFraction: number|null}:
 *   imageCount       — images intersecting the region in the period;
 *   coverageFraction — fraction of the study region with at least one valid
 *                      (unmasked) observation in the mean composite,
 *                      measured at CONFIG.reduceScale.
 */
function computeAvailability(collection, composite, regionGeom, callback) {
  var count = collection.size();
  var coverage = ee.Algorithms.If(
      count.gt(0),
      composite.mask().rename('valid').reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: regionGeom,
        scale: CONFIG.reduceScale,
        maxPixels: 1e10,
        bestEffort: true
      }).get('valid'),
      null);
  ee.Dictionary({imageCount: count, coverageFraction: coverage})
      .evaluate(callback);
}

/* ---------------------------------------------------------------------- UI */

// Text styles. Single-series chart: no legend box (the title names the
// series); line uses one fixed series color.
var STYLE = {
  title: {fontSize: '16px', fontWeight: 'bold', margin: '4px 8px 0 8px'},
  subtitle: {fontSize: '12px', color: '#52514e', margin: '2px 8px 8px 8px'},
  body: {fontSize: '12px', color: '#0b0b0b', margin: '4px 8px'},
  note: {fontSize: '11px', color: '#52514e', margin: '4px 8px'},
  status: {fontSize: '12px', color: '#52514e', margin: '6px 8px'},
  warn: '#d03b3b',
  seriesColor: '#2a78d6',
  grid: '#e1e0d9'
};

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

function makeChart(collection, regionGeom, startStr, endStr) {
  return ui.Chart.image.series({
    imageCollection: collection,
    region: regionGeom,
    reducer: ee.Reducer.mean(),
    scale: CONFIG.reduceScale
  }).setOptions({
    title: 'Regional mean tropospheric NO2, ' + startStr + ' to ' + endStr,
    titleTextStyle: {fontSize: 12, bold: false},
    hAxis: {gridlines: {color: STYLE.grid}},
    vAxis: {
      title: 'mol/m²',
      format: 'scientific',
      gridlines: {color: STYLE.grid}
    },
    legend: {position: 'none'},
    lineWidth: 2,
    pointSize: 3,
    colors: [STYLE.seriesColor],
    chartArea: {left: 64, right: 16, top: 32, bottom: 32}
  });
}

function makeLegendPanel() {
  var colorBar = ui.Thumbnail({
    image: ee.Image.pixelLonLat().select('longitude'),
    params: {
      bbox: [0, 0, 1, 0.1],
      dimensions: '120x10',
      format: 'png',
      min: 0,
      max: 1,
      palette: CONFIG.vis.palette
    },
    style: {stretch: 'horizontal', margin: '2px 8px', maxHeight: '18px'}
  });
  var endLabels = ui.Panel({
    widgets: [
      ui.Label(String(CONFIG.vis.min), STYLE.note),
      ui.Label('', {stretch: 'horizontal'}),
      ui.Label(CONFIG.vis.max.toExponential(1) + ' mol/m²', STYLE.note)
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  });
  return ui.Panel([
    ui.Label('Map layer: mean NO2 column (display stretch only)', STYLE.note),
    colorBar,
    endLabels
  ]);
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
var chartPanel = ui.Panel();

function setStatus(text, isWarning) {
  statusLabel.setValue(text);
  statusLabel.style().set('color', isWarning ? STYLE.warn : '#52514e');
}

function buildPanel() {
  var panel = ui.Panel({style: {width: '380px', padding: '8px'}});

  panel.add(ui.Label('Bay Area Air Quality Episode Finder', STYLE.title));
  panel.add(ui.Label('Exploration 01 — Sentinel-5P tropospheric NO2',
                     STYLE.subtitle));

  panel.add(ui.Label(
      'What this shows: the map displays the mean Sentinel-5P (TROPOMI) ' +
      'tropospheric NO2 column density over the study region for the ' +
      'selected period. The chart shows the regional mean of each satellite ' +
      'image over time.',
      STYLE.body));
  panel.add(ui.Label(
      'NO2 column density (mol/m²) is a satellite indicator of pollution ' +
      'patterns in the atmospheric column. It is not a ground-level ' +
      'concentration, not an AQI, and this tool is not an air-quality ' +
      'advisory. No episode detection is performed here.',
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

  panel.add(statusLabel);
  panel.add(chartPanel);
  panel.add(makeLegendPanel());

  panel.add(ui.Label(
      'Notes: gaps in the NO2 layer are pixels with no valid retrieval in ' +
      'the period (e.g., clouds or quality filtering). Chart and coverage ' +
      'numbers are computed at ' + CONFIG.reduceScale + ' m to stay ' +
      'responsive and are for exploration, not analysis-grade statistics.',
      STYLE.note));
  panel.add(ui.Label({
    value: 'Project documentation (GitHub)',
    style: STYLE.note,
    targetUrl:
        'https://github.com/perez-eduardo/Bay-Area-Air-Quality-Episode-Finder'
  }));

  return panel;
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

  setStatus('Computing… (long periods can take a while)', false);
  chartPanel.clear();
  Map.layers().reset([boundaryLayer]);

  var collection = loadNo2Collection(regionGeom, startStr, endStr);
  var composite = meanComposite(collection, regionGeom);

  computeAvailability(collection, composite, regionGeom,
      function (result, error) {
        if (error) {
          setStatus('⚠ Computation failed: ' + error, true);
          return;
        }

        if (result.imageCount === 0) {
          setStatus(
              '⚠ No usable data: no Sentinel-5P OFFL NO2 images intersect ' +
              'the study region in this period. Try another range — OFFL ' +
              'NO2 imagery begins in late June 2018.',
              true);
          return;
        }

        Map.layers().reset([
          ui.Map.Layer(composite, CONFIG.vis,
                       'Mean tropospheric NO2, ' + startStr + ' to ' + endStr),
          boundaryLayer
        ]);
        chartPanel.add(makeChart(collection, regionGeom, startStr, endStr));

        var coverage = result.coverageFraction;
        var summary = result.imageCount + ' images; valid data covers ' +
            (coverage === null || coverage === undefined ?
                'an unknown fraction' :
                'about ' + Math.round(coverage * 100) + '%') +
            ' of the study region in the mean layer.';
        if (coverage !== null && coverage !== undefined &&
            coverage < CONFIG.lowCoverageFraction) {
          setStatus(
              '⚠ Limited usable data this period: ' + summary + ' Coverage ' +
              'gaps (clouds, retrieval quality) are common — interpret with ' +
              'care.',
              true);
        } else {
          setStatus(summary, false);
        }
      });
}

/* -------------------------------------------------------------------- INIT */

ui.root.insert(1, buildPanel());
Map.centerObject(studyRegion.fc, 8);
refresh();
