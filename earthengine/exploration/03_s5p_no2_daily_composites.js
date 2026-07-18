/*
 * Bay Area Air Quality Episode Finder
 * Exploration 03 — Sentinel-5P NO2 raw temporal structure and PROVISIONAL
 * calendar-day composites
 *
 * Purpose: DATA EXPLORATION ONLY. Inspects the raw temporal structure of
 * COPERNICUS/S5P/OFFL/L3_NO2 over the study region and compares the existing
 * image-level series with a provisional calendar-day series. It:
 *   - keeps the study-region boundary handling from scripts 01 and 02
 *     (official BAAQMD jurisdiction asset, labeled county fallback),
 *   - builds, fully server-side, one PROVISIONAL daily composite — the
 *     arithmetic mean of that date's raw images — for every calendar date
 *     in the selected range that has at least one source image,
 *   - charts the raw image-level regional mean against the provisional
 *     daily-mean regional mean, and the number of source images per
 *     represented calendar day,
 *   - reports temporal-coverage summary metrics, distinguishing days that
 *     merely have source images from days with a valid (non-null)
 *     provisional daily regional mean,
 *   - displays the selected-period mean of either the raw collection or the
 *     provisional daily composites on one shared, fixed display scale.
 *
 * The daily MEAN is a PROVISIONAL compositing method chosen only so this
 * exploration has something concrete to inspect. It is NOT the final
 * approved calendar-day compositing method — that remains an open owner
 * decision (docs/methodology.md), along with the final analysis scale,
 * regional reducer, and weighting behavior. This script contains NO
 * baselines, anomalies, episode detection, thresholds, scoring, or
 * modeling.
 *
 * Language notes, used throughout: a raw collection image is NOT one daily
 * observation — several raw images can carry the same calendar date, and
 * more than one may intersect the study region on that date. The NO2 band
 * is a TROPOSPHERIC VERTICAL COLUMN density (mol/m^2): an indicator of
 * pollution patterns in the atmospheric column, not a ground-level
 * concentration, not an AQI value, not a health measure, and not an
 * episode result.
 *
 * How to run: paste this file into the Earth Engine Code Editor
 * (https://code.earthengine.google.com) and click Run. Adjust the dates in
 * the side panel and click Update; switch the displayed layer with the
 * selector.
 *
 * Project docs: https://github.com/perez-eduardo/Bay-Area-Air-Quality-Episode-Finder
 */

/* ------------------------------------------------------------------ CONFIG */

var CONFIG = {
  // Analysis period, 'YYYY-MM-DD' (start inclusive, end exclusive) — the
  // same default range as exploration scripts 01 and 02. Sentinel-5P OFFL
  // NO2 imagery is available from late June 2018 onward.
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

  // Explicit regional reduction scale in meters, used for BOTH chart series
  // (raw image-level and provisional daily). No bestEffort anywhere in this
  // script: these series are the exploration's actual result, so the scale
  // must be explicit and stable. 5000 m is still an exploration-stage
  // choice — the FINAL analysis scale is an open owner decision
  // (docs/methodology.md).
  reduceScale: 5000,

  // Fixed display stretch in mol/m^2 shared by BOTH map layers (raw period
  // mean and provisional daily-composite period mean) so their spatial
  // patterns can be compared visually. Display-only — not an air-quality
  // threshold, AQI, health category, or analysis parameter. Sequential
  // multi-hue ramp, light (low) to dark (high); same fixed range as
  // script 02's absolute view.
  vis: {
    min: 0,
    max: 0.0002,
    palette: ['fff7ec', 'fee8c8', 'fdbb84', 'fc8d59', 'ef6548', 'd7301f',
              '990000']
  },

  // Fixed opacity for both NO2 map layers so the basemap stays visible
  // underneath. Display-only.
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

function loadRawCollection(regionGeom, startStr, endStr) {
  return ee.ImageCollection(CONFIG.collectionId)
      .select(CONFIG.bandName)
      .filterDate(startStr, endStr)
      .filterBounds(regionGeom);
}

/*
 * Builds the provisional calendar-day collection, fully server-side (an
 * ee.List of day offsets is mapped with dropNulls — no client-side loop
 * touches Earth Engine computation).
 *
 * For every calendar date in [startStr, endStr):
 *   - the raw collection is filtered to that date,
 *   - if at least one source image exists, one PROVISIONAL daily composite
 *     is created as the arithmetic mean of that date's raw images
 *     (provisional exploratory method — the final compositing method is an
 *     open owner decision), carrying the properties
 *       system:time_start   — start of that calendar date (UTC millis)
 *       date_string         — the calendar date as 'YYYY-MM-dd'
 *       source_image_count  — number of contributing raw images
 *   - dates with no source image are excluded from the collection (the UI
 *     summary still counts them as days with no source image).
 *
 * Terminology: a "source-image day" is a calendar date with at least one
 * source image — NOT necessarily a day with usable NO2 data over the
 * region. Its provisional daily regional mean can still be null when every
 * relevant pixel is masked; only days with a non-null regional mean are
 * called valid/usable in the UI.
 *
 * Daily composites are NOT clipped: analysis images stay unclipped and the
 * regional reducers receive the BAAQMD geometry directly. Only the map
 * display copies are clipped (see refresh()).
 */
function buildDailyCollection(raw, startStr, endStr) {
  var start = ee.Date(startStr);
  var dayTotal = ee.Date(endStr).difference(start, 'day').round();
  var offsets = ee.List.sequence(0, dayTotal.subtract(1));
  var images = offsets.map(function (offset) {
    var dayStart = start.advance(ee.Number(offset), 'day');
    var dayImages = raw.filterDate(dayStart, dayStart.advance(1, 'day'));
    var count = dayImages.size();
    return ee.Algorithms.If(
        count.gt(0),
        dayImages.mean().set({
          'system:time_start': dayStart.millis(),
          // 'yyyy' = calendar year. (Uppercase 'YYYY' is Joda week-based
          // year and gives the wrong year near year boundaries.)
          'date_string': dayStart.format('yyyy-MM-dd'),
          'source_image_count': count
        }),
        null);
  }, true); // dropNulls: dates with no source image are excluded here
  return ee.ImageCollection.fromImages(images);
}

/*
 * Regional mean of one UNCLIPPED image: the reducer receives the BAAQMD
 * geometry directly, at the explicit CONFIG.reduceScale — no bestEffort, no
 * reproject. mean_no2 is null when the image has no valid pixel over the
 * region (the chart shows a gap there).
 */
function meanFeature(image, regionGeom, seriesName) {
  var mean = image.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: regionGeom,
    scale: CONFIG.reduceScale,
    maxPixels: 1e10
  }).get(CONFIG.bandName);
  return ee.Feature(null, {
    series: seriesName,
    millis: image.get('system:time_start'),
    mean_no2: mean
  });
}

/*
 * One merged FeatureCollection holding both chart series — evaluated in a
 * single server round trip so the two series can never come from different
 * requests:
 *   series 'raw'   — one feature per raw collection image
 *   series 'daily' — one feature per provisional daily composite, also
 *                    carrying date_string and source_image_count
 */
function buildSeriesFeatures(raw, daily, regionGeom) {
  var rawFeatures = ee.FeatureCollection(raw.map(function (image) {
    return meanFeature(image, regionGeom, 'raw');
  }));
  var dailyFeatures = ee.FeatureCollection(daily.map(function (image) {
    return meanFeature(image, regionGeom, 'daily').set({
      date_string: image.get('date_string'),
      source_image_count: image.get('source_image_count')
    });
  }));
  return rawFeatures.merge(dailyFeatures);
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
  warn: '#d03b3b',
  rawColor: '#2a78d6',   // raw image-level series (blue)
  dailyColor: '#c2610f', // provisional daily series (orange) — distinct hue
  countColor: '#7c7c78', // source-image count bars (neutral gray)
  grid: '#e1e0d9'
};

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

// '0' for zero, exponential notation otherwise (e.g., '2.0e-5').
function fmtMol(v) {
  return v === 0 ? '0' : v.toExponential(1);
}

// Whole calendar days in [startStr, endStr) — ISO date strings parse as UTC
// midnight, matching the server-side filterDate arithmetic. Client-side UI
// arithmetic only; no Earth Engine computation happens here.
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
// are zero-based in this format), e.g. 'Date(2023,0,15,20,45)'.
function toChartDateTime(millis) {
  var d = new Date(millis);
  return 'Date(' + d.getUTCFullYear() + ',' + d.getUTCMonth() + ',' +
      d.getUTCDate() + ',' + d.getUTCHours() + ',' + d.getUTCMinutes() + ')';
}

function toChartDay(millis) {
  var d = new Date(millis);
  return 'Date(' + d.getUTCFullYear() + ',' + d.getUTCMonth() + ',' +
      d.getUTCDate() + ')';
}

/*
 * One chart holding both regional-mean series: raw image-level values as
 * unconnected points (several can share a calendar date), the provisional
 * daily means as a line. Built client-side from already-evaluated numbers.
 */
function makeComparisonChart(rawPoints, dailyPoints, startStr, endStr) {
  var merged = [];
  var i;
  for (i = 0; i < rawPoints.length; i++) {
    merged.push({t: rawPoints[i].t, raw: rawPoints[i].v, daily: null});
  }
  for (i = 0; i < dailyPoints.length; i++) {
    merged.push({t: dailyPoints[i].t, raw: null, daily: dailyPoints[i].v});
  }
  merged.sort(byTime);
  var rows = [];
  for (i = 0; i < merged.length; i++) {
    rows.push({c: [
      {v: toChartDateTime(merged[i].t)},
      {v: merged[i].raw},
      {v: merged[i].daily}
    ]});
  }
  return ui.Chart({
    dataTable: {
      cols: [
        {id: 'time', label: 'Time (UTC)', type: 'datetime'},
        {id: 'raw', label: 'Raw image regional mean', type: 'number'},
        {id: 'daily', label: 'Provisional daily mean', type: 'number'}
      ],
      rows: rows
    },
    chartType: 'LineChart',
    options: {
      title: 'Regional mean tropospheric NO2 column — raw images vs ' +
          'provisional daily means, ' + startStr + ' to ' + endStr,
      titleTextStyle: {fontSize: 12, bold: false},
      interpolateNulls: true, // the two series occupy different rows
      hAxis: {gridlines: {color: STYLE.grid}},
      vAxis: {
        title: 'mol/m²',
        format: 'scientific',
        gridlines: {color: STYLE.grid}
      },
      series: {
        0: {lineWidth: 0, pointSize: 3, color: STYLE.rawColor},
        1: {lineWidth: 2, pointSize: 3, color: STYLE.dailyColor}
      },
      legend: {position: 'top', textStyle: {fontSize: 11}},
      chartArea: {left: 64, right: 16, top: 48, bottom: 32}
    }
  });
}

// Raw source images contributing to each source-image day (a calendar date
// with at least one source image — not necessarily usable NO2 data).
function makeCountChart(dailyPoints) {
  var rows = [];
  for (var i = 0; i < dailyPoints.length; i++) {
    rows.push({c: [
      {v: toChartDay(dailyPoints[i].t)},
      {v: dailyPoints[i].n}
    ]});
  }
  return ui.Chart({
    dataTable: {
      cols: [
        {id: 'day', label: 'Calendar day (UTC)', type: 'date'},
        {id: 'count', label: 'Raw source images', type: 'number'}
      ],
      rows: rows
    },
    chartType: 'ColumnChart',
    options: {
      title: 'Raw source images per source-image day',
      titleTextStyle: {fontSize: 12, bold: false},
      hAxis: {gridlines: {color: STYLE.grid}},
      vAxis: {
        title: 'source images',
        viewWindow: {min: 0},
        format: '0',
        gridlines: {color: STYLE.grid}
      },
      legend: {position: 'none'},
      colors: [STYLE.countColor],
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

// Map display selection. `currentDisplay` is 'raw' or 'daily'. Both layers
// share CONFIG.vis so their spatial values can be compared visually.
var DISPLAY_LABELS = {
  'Period mean — raw image collection': 'raw',
  'Period mean — provisional daily composites': 'daily'
};
var currentDisplay = 'raw';

// Result cache for the latest completed refresh. Display switches re-render
// the map from this cache without recomputing. null until the first refresh
// completes (or while one is running).
//   {hasData, startStr, endStr, rawMean, dailyMean}
//   rawMean / dailyMean are display-only clipped copies of the two period
//   means.
var state = null;

// Guards against out-of-order async results when Update is clicked again
// before the previous computation finishes.
var refreshToken = 0;

var displaySelect = ui.Select({
  items: Object.keys(DISPLAY_LABELS),
  value: 'Period mean — raw image collection',
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
var summaryPanel = ui.Panel();
var chartPanel = ui.Panel();
var countChartPanel = ui.Panel();

function setStatus(text, isWarning) {
  statusLabel.setValue(text);
  statusLabel.style().set('color', isWarning ? STYLE.warn : '#52514e');
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
  var panel = ui.Panel({style: {width: '400px', padding: '8px'}});

  panel.add(ui.Label('Bay Area Air Quality Episode Finder', STYLE.title));
  panel.add(ui.Label(
      'Exploration 03 — raw temporal structure and provisional ' +
      'calendar-day composites',
      STYLE.subtitle));

  panel.add(ui.Label(
      'What this shows: how the raw Sentinel-5P (TROPOMI) OFFL NO2 ' +
      'collection is structured in time over the study region, compared ' +
      'with a provisional calendar-day version of the same data. The NO2 ' +
      'band is a tropospheric vertical column density (mol/m²) — an ' +
      'indicator of pollution patterns in the atmospheric column, not a ' +
      'ground-level concentration, not an AQI value, not a health measure, ' +
      'and not an episode result.',
      STYLE.body));
  panel.add(ui.Label(
      'A raw collection image is not one daily observation: several raw ' +
      'images can carry the same calendar date, and more than one may ' +
      'intersect the study region on that date. The blue chart points are ' +
      'the regional mean of each raw image; the orange line is the ' +
      'regional mean of one composite per calendar day with source ' +
      'images. A date with source images does not necessarily have usable ' +
      'NO2 data: its daily regional mean is null (a chart gap) when every ' +
      'relevant pixel over the region is masked.',
      STYLE.body));
  panel.add(ui.Label(
      'Provisional method: each daily composite is the arithmetic mean of ' +
      'that date\'s raw images. This is an exploratory choice made so the ' +
      'comparison can be inspected — it is NOT the final approved ' +
      'calendar-day compositing method, which remains an open owner ' +
      'decision (see docs/methodology.md).',
      STYLE.emph));

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
  panel.add(summaryPanel);
  panel.add(chartPanel);
  panel.add(countChartPanel);

  // Legend: one fixed display stretch shared by both map layers.
  panel.add(ui.Label('Legend — shared fixed display scale (both layers)',
                     STYLE.emph));
  panel.add(makeColorBar(CONFIG.vis.palette));
  panel.add(labelRow([
    fmtMol(CONFIG.vis.min),
    fmtMol((CONFIG.vis.min + CONFIG.vis.max) / 2),
    fmtMol(CONFIG.vis.max) + ' mol/m²'
  ]));
  panel.add(ui.Label(
      'Mean tropospheric NO2 column density in mol/m². Both map layers use ' +
      'this identical fixed stretch so their spatial patterns can be ' +
      'compared; values above the maximum render as the darkest color. ' +
      'Colors are a numerical display stretch only — not an AQI, not ' +
      'health categories, and not a pollution/no-pollution classification.',
      STYLE.note));

  panel.add(ui.Label(
      'Notes: the two period-mean layers can differ slightly — the raw ' +
      'layer weights every image equally, while the daily-composite layer ' +
      'weights every represented day equally. That difference is a ' +
      'property of the provisional compositing arithmetic, not new ' +
      'information. Gaps in either layer are pixels with no valid ' +
      'retrieval in the period (e.g., clouds or quality filtering). All ' +
      'regional reductions here use an explicit ' + CONFIG.reduceScale +
      ' m scale without bestEffort; that scale is itself an ' +
      'exploration-stage choice, and the final analysis scale is an open ' +
      'owner decision. Long periods can take a while to compute.',
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

/*
 * Rebuilds the map layers for the current display selection from the cached
 * `state`. Called after every completed refresh and on every selector
 * change; draws the boundary only while a refresh is computing or when the
 * period has no data.
 */
function renderDisplay() {
  if (state === null || !state.hasData) {
    Map.layers().reset([boundaryLayer]);
    return;
  }
  var isRaw = currentDisplay === 'raw';
  var layer = ui.Map.Layer(
      isRaw ? state.rawMean : state.dailyMean,
      CONFIG.vis,
      (isRaw ?
          'Period mean NO2 — raw image collection, ' :
          'Period mean NO2 — provisional daily composites, ') +
          state.startStr + ' to ' + state.endStr,
      true, CONFIG.layerOpacity);
  Map.layers().reset([layer, boundaryLayer]);
}

/* ----------------------------------------------------------------- SUMMARY */

function renderSummary(m) {
  summaryPanel.clear();
  summaryPanel.add(ui.Label('Temporal coverage summary', STYLE.emph));
  summaryPanel.add(ui.Label(
      'Raw collection images intersecting the study region: ' + m.rawImages,
      STYLE.body));
  summaryPanel.add(ui.Label(
      'Calendar days in the selected range: ' + m.totalDays, STYLE.body));
  summaryPanel.add(ui.Label(
      'Days with at least one source image: ' + m.sourceImageDays,
      STYLE.body));
  summaryPanel.add(ui.Label(
      'Days with no source image: ' + m.noSourceDays, STYLE.body));
  summaryPanel.add(ui.Label(
      'Days with a valid provisional daily regional mean: ' + m.validDays,
      STYLE.body));
  summaryPanel.add(ui.Label(
      'Days with source images but no valid regional mean: ' + m.maskedDays,
      STYLE.body));
  summaryPanel.add(ui.Label(
      'Calendar days with a valid daily regional mean: ' + m.pctValid + '%',
      STYLE.body));
  summaryPanel.add(ui.Label(
      m.sourceImageDays > 0 ?
          'Raw source images per source-image day — min ' + m.minCount +
              ', median ' + m.medianCount + ', max ' + m.maxCount :
          'Raw source images per source-image day — not applicable ' +
              '(no days with source images).',
      STYLE.body));
  summaryPanel.add(ui.Label(
      'A "source image" is a raw collection image intersecting the study ' +
      'region — not one daily observation. A source-image day is not ' +
      'necessarily a day with usable NO2 data: its regional mean is null ' +
      '(a chart gap) when every relevant pixel over the region is masked ' +
      '(e.g., clouds or quality filtering).',
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

  setStatus('Computing… (long periods can take a while)', false);
  summaryPanel.clear();
  chartPanel.clear();
  countChartPanel.clear();
  state = null;
  renderDisplay(); // boundary only until results arrive
  var token = ++refreshToken;

  var raw = loadRawCollection(regionGeom, startStr, endStr);
  var daily = buildDailyCollection(raw, startStr, endStr);

  // Both chart series in one evaluate: one server round trip, and the
  // stale-request token below protects against out-of-order results.
  buildSeriesFeatures(raw, daily, regionGeom).evaluate(
      function (fc, error) {
        if (token !== refreshToken) return; // superseded by a newer Update

        if (error) {
          setStatus('⚠ Computation failed: ' + error, true);
          return;
        }

        // Client-side handling of already-evaluated results only (chart
        // rows and summary arithmetic) — no Earth Engine computation.
        var rawPoints = [];
        var dailyPoints = [];
        for (var i = 0; i < fc.features.length; i++) {
          var p = fc.features[i].properties;
          // A null regional mean (image fully masked over the region) is
          // dropped from the evaluated properties; chart it as a gap.
          var value = typeof p.mean_no2 === 'number' ? p.mean_no2 : null;
          if (p.series === 'raw') {
            rawPoints.push({t: p.millis, v: value});
          } else {
            dailyPoints.push({t: p.millis, v: value,
                              n: p.source_image_count});
          }
        }
        rawPoints.sort(byTime);
        dailyPoints.sort(byTime);

        // Valid-day counts come from the already-evaluated daily features
        // (a null regional mean ⇔ no valid pixel over the region) — no
        // extra reduceRegion pass is made for this summary.
        var totalDays = daysBetween(startStr, endStr);
        var counts = [];
        var validDays = 0;
        for (var j = 0; j < dailyPoints.length; j++) {
          counts.push(dailyPoints[j].n);
          if (dailyPoints[j].v !== null) validDays++;
        }
        var metrics = {
          rawImages: rawPoints.length,
          totalDays: totalDays,
          sourceImageDays: dailyPoints.length,
          noSourceDays: totalDays - dailyPoints.length,
          validDays: validDays,
          maskedDays: dailyPoints.length - validDays,
          pctValid: totalDays > 0 ?
              Math.round(100 * validDays / totalDays) : 0,
          // Source-image counts are per source-image day, by definition.
          minCount: counts.length ? Math.min.apply(null, counts) : null,
          maxCount: counts.length ? Math.max.apply(null, counts) : null,
          medianCount: counts.length ? median(counts) : null
        };
        renderSummary(metrics);

        if (rawPoints.length === 0) {
          state = {hasData: false};
          renderDisplay();
          setStatus(
              '⚠ No usable data: no Sentinel-5P OFFL NO2 images intersect ' +
              'the study region in this period, so no calendar day in the ' +
              'range has a source image. Try another range — OFFL NO2 ' +
              'imagery begins in late June 2018.',
              true);
          return;
        }

        state = {
          hasData: true,
          startStr: startStr,
          endStr: endStr,
          // Display copies ONLY are clipped; the analysis images that fed
          // the chart series above stayed unclipped.
          rawMean: raw.mean().clip(regionGeom),
          dailyMean: daily.mean().clip(regionGeom)
        };
        renderDisplay();
        chartPanel.add(
            makeComparisonChart(rawPoints, dailyPoints, startStr, endStr));
        countChartPanel.add(makeCountChart(dailyPoints));

        setStatus(
            metrics.rawImages + ' raw images; source images on ' +
            metrics.sourceImageDays + ' of ' + metrics.totalDays +
            ' calendar days; a valid provisional daily mean on ' +
            metrics.validDays + ' days (' + metrics.pctValid + '%). The ' +
            'daily series uses a PROVISIONAL mean — the final compositing ' +
            'method is undecided.',
            false);
      });
}

/* -------------------------------------------------------------------- INIT */

ui.root.insert(1, buildPanel());
Map.centerObject(studyRegion.fc, 8);
refresh();
