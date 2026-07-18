/*
 * Bay Area Air Quality Episode Finder
 * Exploration 02 — Sentinel-5P NO2 map display modes (spatial readability)
 *
 * Purpose: DATA EXPLORATION ONLY. Builds on exploration 01 (which remains
 * unchanged) and focuses on making the SPATIAL pattern of the NO2 map easier
 * to read. It:
 *   - keeps the study-region boundary (official BAAQMD jurisdiction, with
 *     the labeled county fallback), the date controls, the regional
 *     time-series chart, and the data-availability / no-data handling from
 *     exploration 01,
 *   - adds two selectable map DISPLAY MODES:
 *       1) Absolute NO2 view — a fixed, documented numerical color scale in
 *          mol/m^2, identical for every date range; the lowest displayed
 *          values fade to transparent so the basemap stays visible.
 *       2) Relative pattern view — color limits computed from percentiles
 *          of the selected-period composite over the study region; shows
 *          relative spatial differences WITHIN the selected period only and
 *          must not be color-compared between different date ranges.
 *
 * Every number in CONFIG.displayModes is a VISUALIZATION setting only. None
 * of them is an air-quality threshold, an AQI value, a health category, or
 * an analysis parameter. This script contains NO episode detection,
 * baselines, anomaly analysis, scoring, or modeling. Satellite NO2 column
 * density is an indicator of pollution patterns in the atmospheric column —
 * it is not a ground-level concentration, not an AQI, and not air-quality
 * advice.
 *
 * How to run: paste this file into the Earth Engine Code Editor
 * (https://code.earthengine.google.com) and click Run. Pick a display mode
 * and a date range in the side panel; click Update after changing dates.
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

  // Map display modes. Every number in this block is a DISPLAY choice only —
  // NOT an air-quality threshold, AQI, health category, or analysis
  // parameter. See earthengine/README.md for the purpose and limitations of
  // each mode.
  displayModes: {
    absolute: {
      // Fixed display stretch in mol/m^2, identical for every date range
      // (the same range exploration 01 used). Values at/above `max` render
      // as the darkest color.
      min: 0,
      max: 0.0002,
      // Sequential single-hue blue ramp: the five darkest steps of the
      // ColorBrewer "Blues" 9-class scheme. Trimmed so the lightest
      // displayed color still stands out against a light basemap; ramp
      // checks (monotone lightness, visible step gaps, light-end contrast)
      // were verified with a palette validator during development. The map
      // interpolates between these stops, so the ramp is continuous.
      palette: ['#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
      // Display fade: pixel opacity ramps linearly from 0 at `start` to 1
      // at `end` (10% and 25% of `max`), so the lowest displayed values
      // fade out and the basemap underneath stays visible. Purely a
      // visualization aid — faded or fully transparent pixels can still
      // contain valid data.
      fade: {start: 0.00002, end: 0.00005}
    },
    relative: {
      // Per-period display stretch: lower/upper percentiles of the
      // selected-period mean composite within the study region, computed at
      // CONFIG.reduceScale. 2/98 is a common robust-stretch convention.
      // Used ONLY to set this period's color limits — never for analysis.
      percentiles: [2, 98],
      // Sequential single-hue purple ramp: the five darkest steps of the
      // ColorBrewer "Purples" 9-class scheme — deliberately a different hue
      // from the absolute view so images of the two modes are hard to
      // confuse. Same ramp checks as above.
      palette: ['#9e9ac8', '#807dba', '#6a51a3', '#54278f', '#3f007d'],
      // Fixed layer opacity so streets and terrain stay visible under the
      // fully colored region.
      layerOpacity: 0.75
    }
  },

  // Reduction scale in meters for the chart, the coverage check, and the
  // relative-mode percentile stretch. Coarser than the ~1113 m native L3
  // grid so interactive exploration stays responsive; exploration
  // convenience, not analysis-grade statistics.
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
 * Computes, in one server round trip, the availability facts from
 * exploration 01 plus the relative-mode display stretch, and passes them to
 * `callback` as:
 *   {
 *     imageCount:       number,       // images intersecting the region
 *     coverageFraction: number|null,  // fraction of the region with at
 *                                     // least one valid observation in the
 *                                     // mean composite
 *     stretch:          object        // {'no2_p<LO>': number|null,
 *                                     //  'no2_p<HI>': number|null}; empty
 *                                     // when imageCount is 0
 *   }
 * All reductions run at CONFIG.reduceScale (exploration convenience, not
 * analysis-grade statistics).
 */
function computeStats(collection, composite, regionGeom, callback) {
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
  // Percentiles of the period composite over the study region — used ONLY
  // as the relative view's color limits.
  var stretch = ee.Algorithms.If(
      count.gt(0),
      composite.rename('no2').reduceRegion({
        reducer:
            ee.Reducer.percentile(CONFIG.displayModes.relative.percentiles),
        geometry: regionGeom,
        scale: CONFIG.reduceScale,
        maxPixels: 1e10,
        bestEffort: true
      }),
      ee.Dictionary({}));
  ee.Dictionary({
    imageCount: count,
    coverageFraction: coverage,
    stretch: stretch
  }).evaluate(callback);
}

/* ---------------------------------------------------------------------- UI */

// Text styles. Single-series chart: no legend box (the title names the
// series); line uses one fixed series color.
var STYLE = {
  title: {fontSize: '16px', fontWeight: 'bold', margin: '4px 8px 0 8px'},
  subtitle: {fontSize: '12px', color: '#52514e', margin: '2px 8px 8px 8px'},
  body: {fontSize: '12px', color: '#0b0b0b', margin: '4px 8px'},
  note: {fontSize: '11px', color: '#52514e', margin: '4px 8px'},
  emph: {fontSize: '11px', color: '#0b0b0b', fontWeight: 'bold',
         margin: '4px 8px'},
  status: {fontSize: '12px', color: '#52514e', margin: '6px 8px'},
  warn: '#d03b3b',
  seriesColor: '#2a78d6',
  grid: '#e1e0d9'
};

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

// '0' for zero, exponential notation otherwise (e.g., '2.0e-5').
function fmtMol(v) {
  return v === 0 ? '0' : v.toExponential(1);
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

/* ----------------------------------------------------------- PANEL + STATE */

var studyRegion = getStudyRegion();
var regionGeom = studyRegion.fc.geometry();

var boundaryLayer = ui.Map.Layer(
    studyRegion.fc.style({color: 'black', fillColor: '00000000', width: 2}),
    {},
    studyRegion.isApproximation ?
        'Study region (county approximation of BAAQMD jurisdiction)' :
        'Study region (official BAAQMD jurisdiction)');

// Display-mode selection. `currentMode` is 'absolute' or 'relative'.
var MODE_LABELS = {
  'Absolute NO2 (fixed scale)': 'absolute',
  'Relative pattern (this period only)': 'relative'
};
var currentMode = 'absolute';

// Result cache for the latest completed refresh. Mode switches re-render the
// map and legend from this cache without recomputing anything. null until
// the first refresh completes (or while one is running).
//   {startStr, endStr, composite, imageCount, coverageFraction,
//    stretchLo, stretchHi}   — stretchLo/stretchHi are the relative view's
//                              percentile color limits, or null when they
//                              could not be computed.
var state = null;

// Guards against out-of-order async results when Update is clicked again
// before the previous computation finishes.
var refreshToken = 0;

var modeSelect = ui.Select({
  items: Object.keys(MODE_LABELS),
  value: 'Absolute NO2 (fixed scale)',
  onChange: function (label) {
    currentMode = MODE_LABELS[label];
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
var chartPanel = ui.Panel();
var legendPanel = ui.Panel();

function setStatus(text, isWarning) {
  statusLabel.setValue(text);
  statusLabel.style().set('color', isWarning ? STYLE.warn : '#52514e');
}

function buildPanel() {
  var panel = ui.Panel({style: {width: '380px', padding: '8px'}});

  panel.add(ui.Label('Bay Area Air Quality Episode Finder', STYLE.title));
  panel.add(ui.Label('Exploration 02 — Sentinel-5P NO2 display modes',
                     STYLE.subtitle));

  panel.add(ui.Label(
      'What this shows: the map displays the mean Sentinel-5P (TROPOMI) ' +
      'tropospheric NO2 column density over the study region for the ' +
      'selected period, in one of two display modes. The chart shows the ' +
      'regional mean of each satellite image over time.',
      STYLE.body));
  panel.add(ui.Label(
      'Absolute NO2 view: a fixed numerical color scale in mol/m², ' +
      'identical for every date range. The lowest displayed values fade ' +
      'toward transparent so the basemap and the location of ' +
      'higher-column areas are easier to see.',
      STYLE.body));
  panel.add(ui.Label(
      'Relative pattern view: the color range is stretched to the ' +
      'selected period\'s own values (percentiles over the study region). ' +
      'This makes within-period spatial structure easier to see, but the ' +
      'colors are recomputed for every date range and must not be ' +
      'compared between different periods.',
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
    widgets: [ui.Label('Display mode', STYLE.note), modeSelect],
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
  panel.add(chartPanel);
  panel.add(legendPanel);

  panel.add(ui.Label(
      'Notes: gaps in the NO2 layer are pixels with no valid retrieval in ' +
      'the period (e.g., clouds or quality filtering). In the absolute ' +
      'view, transparent areas can be either faded low values or missing ' +
      'data; the relative view colors every valid pixel, which helps tell ' +
      'the two apart. Chart, coverage, and stretch numbers are computed ' +
      'at ' + CONFIG.reduceScale + ' m to stay responsive and are for ' +
      'exploration, not analysis-grade statistics.',
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

function hasStretch() {
  return state !== null &&
         typeof state.stretchLo === 'number' &&
         typeof state.stretchHi === 'number' &&
         state.stretchLo < state.stretchHi;
}

/*
 * Rebuilds the map layers and the legend for the current mode from the
 * cached `state`. Called after every completed refresh and on every mode
 * switch; safe to call while a refresh is still computing (draws the
 * boundary only).
 */
function renderDisplay() {
  renderLegend();

  if (state === null || state.imageCount === 0) {
    Map.layers().reset([boundaryLayer]);
    return;
  }

  var no2Layer = null;
  if (currentMode === 'absolute') {
    var m = CONFIG.displayModes.absolute;
    // Opacity ramps linearly from 0 at fade.start to 1 at fade.end.
    // Display aid only — faded pixels still contain valid data.
    var opacity = state.composite
        .unitScale(m.fade.start, m.fade.end).clamp(0, 1);
    no2Layer = ui.Map.Layer(
        state.composite.updateMask(opacity),
        {min: m.min, max: m.max, palette: m.palette},
        'Mean NO2 — absolute scale, ' +
            state.startStr + ' to ' + state.endStr);
  } else if (hasStretch()) {
    var r = CONFIG.displayModes.relative;
    no2Layer = ui.Map.Layer(
        state.composite,
        {min: state.stretchLo, max: state.stretchHi, palette: r.palette},
        'Mean NO2 — relative stretch (this period only), ' +
            state.startStr + ' to ' + state.endStr,
        true, r.layerOpacity);
  }
  // In relative mode with no computable stretch, only the boundary is shown;
  // the legend explains why.

  Map.layers().reset(no2Layer === null ?
      [boundaryLayer] : [no2Layer, boundaryLayer]);
}

function renderLegend() {
  legendPanel.clear();

  if (currentMode === 'absolute') {
    var m = CONFIG.displayModes.absolute;
    legendPanel.add(ui.Label(
        'Legend — absolute NO2 view (fixed display scale)', STYLE.emph));
    legendPanel.add(makeColorBar(m.palette));
    legendPanel.add(labelRow([
      fmtMol(m.min),
      fmtMol((m.min + m.max) / 2),
      fmtMol(m.max) + ' mol/m²'
    ]));
    legendPanel.add(ui.Label(
        'Mean tropospheric NO2 column density in mol/m². The scale is ' +
        'identical for every date range; values above the maximum render ' +
        'as the darkest color.',
        STYLE.note));
    legendPanel.add(ui.Label(
        'Pixels fade to transparent below ' + fmtMol(m.fade.end) +
        ' mol/m² (fully transparent at or below ' + fmtMol(m.fade.start) +
        '). Display aid only — faded or transparent areas can still ' +
        'contain valid data.',
        STYLE.note));
    legendPanel.add(ui.Label(
        'Colors are a numerical display stretch only — not an AQI, not ' +
        'health categories, and not a pollution/no-pollution ' +
        'classification.',
        STYLE.note));
    return;
  }

  legendPanel.add(ui.Label(
      'Legend — relative pattern view (this period only)', STYLE.emph));
  if (hasStretch()) {
    var pcts = CONFIG.displayModes.relative.percentiles;
    legendPanel.add(makeColorBar(CONFIG.displayModes.relative.palette));
    legendPanel.add(labelRow([
      fmtMol(state.stretchLo),
      fmtMol(state.stretchHi) + ' mol/m²'
    ]));
    legendPanel.add(ui.Label(
        'Color limits are percentiles ' + pcts[0] + ' and ' + pcts[1] +
        ' of this period\'s mean composite within the study region ' +
        '(mol/m²), used for display only.',
        STYLE.note));
  } else if (state !== null && state.imageCount > 0) {
    legendPanel.add(ui.Label(
        '⚠ A period stretch could not be computed (too little valid data, ' +
        'or values too uniform). No NO2 layer is shown in this mode — try ' +
        'the absolute view.',
        STYLE.note));
  } else {
    legendPanel.add(ui.Label(
        'Stretch values appear here once the selected period has been ' +
        'computed and contains usable data.',
        STYLE.note));
  }
  legendPanel.add(ui.Label(
      'This mode highlights relative spatial differences within the ' +
      'selected period only. Colors are re-stretched for every date ' +
      'range, so they must NOT be compared between different periods — ' +
      'use the absolute view for that.',
      STYLE.emph));
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
  state = null;
  renderDisplay(); // boundary only until results arrive
  var token = ++refreshToken;

  var collection = loadNo2Collection(regionGeom, startStr, endStr);
  var composite = meanComposite(collection, regionGeom);

  computeStats(collection, composite, regionGeom,
      function (result, error) {
        if (token !== refreshToken) return; // superseded by a newer Update

        if (error) {
          setStatus('⚠ Computation failed: ' + error, true);
          return;
        }

        if (result.imageCount === 0) {
          state = {imageCount: 0};
          renderDisplay();
          setStatus(
              '⚠ No usable data: no Sentinel-5P OFFL NO2 images intersect ' +
              'the study region in this period. Try another range — OFFL ' +
              'NO2 imagery begins in late June 2018.',
              true);
          return;
        }

        var pcts = CONFIG.displayModes.relative.percentiles;
        var lo = result.stretch ? result.stretch['no2_p' + pcts[0]] : null;
        var hi = result.stretch ? result.stretch['no2_p' + pcts[1]] : null;
        state = {
          startStr: startStr,
          endStr: endStr,
          composite: composite,
          imageCount: result.imageCount,
          coverageFraction: result.coverageFraction,
          stretchLo: typeof lo === 'number' ? lo : null,
          stretchHi: typeof hi === 'number' ? hi : null
        };

        chartPanel.add(makeChart(collection, regionGeom, startStr, endStr));
        renderDisplay();

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
