/*
 * Bay Area Air Quality Episode Finder — public UI map-lifecycle
 * harness. Drives the REAL public/app.js under Node's built-in test
 * runner (`npm test` → `node --test`) with stubbed DOM, Leaflet,
 * fetch, and AbortController. Nothing here touches a browser, the
 * network, or Earth Engine.
 *
 * Covered behaviors (this correction's contract):
 *   - scientific raster opacity is exactly 0.45; basemap untouched;
 *   - "Rendering anomaly tiles…" until a REAL tileload event;
 *   - "Anomaly layer displayed." only after tileload;
 *   - tileerror before any success -> failure; after success ->
 *     partial-load warning;
 *   - a new date removes the stale raster and legend immediately;
 *   - events from a removed layer cannot change current state;
 *   - exactly one scientific layer exists at a time;
 *   - the boundary is brought above the raster;
 *   - the legend is one continuous gradient from backend palette
 *     metadata with zero at the 50% midpoint;
 *   - an invalid backend palette gives a truthful legend-unavailable
 *     state without blocking tiles;
 *   - null scientific values render as em dashes, never zero.
 */

'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var APP_PATH = path.join(__dirname, 'public', 'app.js');

/* ------------------------------------------------------------- STUBS */

function makeNode(id) {
  var node = {
    id: id || null,
    tagName: null,
    textContent: '',
    className: '',
    value: '',
    min: '',
    max: '',
    disabled: false,
    hidden: false,
    style: {},
    attributes: {},
    childNodes: [],
    handlers: {},
    appendChild: function (child) { node.childNodes.push(child); return child; },
    setAttribute: function (k, v) { node.attributes[k] = v; },
    addEventListener: function (evt, fn) {
      (node.handlers[evt] = node.handlers[evt] || []).push(fn);
    }
  };
  Object.defineProperty(node, 'innerHTML', {
    get: function () { return node._innerHTML || ''; },
    set: function (v) {
      node._innerHTML = v;
      if (v === '') node.childNodes.length = 0;
    }
  });
  return node;
}

function makeLeafletStub() {
  var mapObj = {
    layers: [],
    removeLayer: function (layer) {
      var i = mapObj.layers.indexOf(layer);
      if (i !== -1) mapObj.layers.splice(i, 1);
    },
    fitBounds: function () {},
    _add: function (layer) { mapObj.layers.push(layer); }
  };
  var L = {
    _map: mapObj,
    _tileLayers: [],
    _geoLayers: [],
    map: function () { return mapObj; },
    tileLayer: function (url, opts) {
      var layer = {
        _type: 'tile',
        url: url,
        options: opts || {},
        handlers: {},
        captured: {},     // survives off(); used to replay stale events
        offCalled: 0,
        on: function (evt, fn) {
          (layer.handlers[evt] = layer.handlers[evt] || []).push(fn);
          (layer.captured[evt] = layer.captured[evt] || []).push(fn);
          return layer;
        },
        off: function () { layer.offCalled += 1; layer.handlers = {}; return layer; },
        addTo: function (m) { m._add(layer); return layer; },
        fire: function (evt) {
          (layer.handlers[evt] || []).slice().forEach(function (fn) { fn({}); });
        }
      };
      L._tileLayers.push(layer);
      return layer;
    },
    geoJSON: function (geojson, opts) {
      var layer = {
        _type: 'geojson',
        geojson: geojson,
        options: opts || {},
        broughtToFront: 0,
        addTo: function (m) { m._add(layer); return layer; },
        getBounds: function () { return {}; },
        bringToFront: function () { layer.broughtToFront += 1; return layer; }
      };
      L._geoLayers.push(layer);
      return layer;
    },
    control: {
      scale: function () { return {addTo: function () {}}; }
    }
  };
  return L;
}

/* fetch stub: every request becomes a controllable pending entry. */
var pendingRequests = [];

function stubFetch(url) {
  var entry = {url: String(url), settled: false};
  entry.promise = new Promise(function (resolve, reject) {
    entry.resolve = function (status, body) {
      if (entry.settled) return;
      entry.settled = true;
      resolve({
        status: status,
        json: function () { return Promise.resolve(body); }
      });
    };
    entry.reject = function (error) {
      if (entry.settled) return;
      entry.settled = true;
      reject(error);
    };
  });
  pendingRequests.push(entry);
  return entry.promise;
}

function takeRequest(match) {
  for (var i = 0; i < pendingRequests.length; i++) {
    var e = pendingRequests[i];
    if (!e.taken && e.url.indexOf(match) !== -1) {
      e.taken = true;
      return e;
    }
  }
  throw new Error('no pending request matching "' + match + '"; saw: ' +
      pendingRequests.map(function (e) { return e.url; }).join(', '));
}

// Settles every remaining request so no 10-minute browser-timeout
// timer keeps the test process alive.
function settleAll() {
  pendingRequests.forEach(function (e) {
    if (!e.settled) e.resolve(599, null);
  });
}

function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); })
      .then(function () {
        return new Promise(function (r) { setImmediate(r); });
      });
}

/* ---------------------------------------------------------- FIXTURES */

function contextBody() {
  return {
    ok: true,
    dataset: {
      id: 'COPERNICUS/S5P/OFFL/L3_NO2',
      band: 'tropospheric_NO2_column_number_density',
      label: 'Sentinel-5P tropospheric NO₂ column',
      unit: 'mol/m²',
      timezone: 'America/Los_Angeles',
      collectionStartLocalDate: '2018-06-28'
    },
    availability: {
      latestRepresentedLocalDate: '2026-07-10',
      lastIncludedLocalDate: '2026-07-09',
      defaultLocalDate: '2026-07-09',
      freshnessNote: 'OFFL products publish with latency.'
    },
    region: {id: 'baaqmd', label: 'BAAQMD', boundaryAvailable: true},
    methods: {},
    disclaimer: 'test'
  };
}

function boundaryBody() {
  return {
    ok: true,
    region: {id: 'baaqmd'},
    geojson: {type: 'FeatureCollection', features: [
      {type: 'Feature', geometry: {type: 'Polygon', coordinates: [[]]},
       properties: {}}
    ]},
    disclaimer: 'test'
  };
}

function analysisBody(dateStr, overrides) {
  var body = {
    ok: true,
    localDate: dateStr,
    dataset: {id: 'COPERNICUS/S5P/OFFL/L3_NO2', band: 'b', label: 'l',
              unit: 'mol/m²', timezone: 'America/Los_Angeles'},
    observation: {
      status: 'available', hasValidValue: true,
      regionalMeanNo2: 3.02e-5, validAreaFraction: 0.97,
      sourceAssetCount: 14, distinctProductCount: 14,
      distinctOrbitCount: 14,
      hasNonNominalContributors: false, nonNominalProductCount: 0,
      unknownProductQualityCount: 0, productQualityStatus: 'nominal',
      projectionCompatibilityStatus: 'compatible',
      projectionCompatibilityDetail: null
    },
    baseline: {
      status: 'available', requestedPriorYears: [2025, 2024, 2023],
      contributingPriorYears: [2025, 2024, 2023],
      historicalSampleCount: 93, historicalMedianNo2: 3.2e-5,
      signedAnomalyNo2: -1.8e-6, percentile: 39.8, method: 'test'
    },
    map: {
      status: 'available', layerType: 'signed_column_anomaly',
      localDate: dateStr, unit: 'mol/m²', baselineStatus: 'available',
      requestedPriorYears: [2025, 2024, 2023],
      contributingPriorYears: [2025, 2024, 2023],
      historicalDailyImageCount: 93,
      tileUrlTemplate: 'https://tiles.test/' + dateStr + '/{z}/{x}/{y}',
      visualization: {
        min: -2.3e-5, max: 2.3e-5,
        paletteStops: ['2166ac', '67a9cf', 'f7f7f7', 'ef8a62', 'b2182b'],
        description: 'Per-date display stretch; not a threshold.'
      },
      attribution: 'test', hasNonNominalContributors: false,
      warning: null, disclaimer: 'test'
    },
    disclaimer: 'test'
  };
  Object.keys(overrides || {}).forEach(function (section) {
    Object.keys(overrides[section]).forEach(function (key) {
      body[section][key] = overrides[section][key];
    });
  });
  return body;
}

/* ------------------------------------------------------------- BOOT */

function bootApp() {
  pendingRequests.length = 0;
  var ids = {};
  global.window = {BACKEND_ORIGIN: 'http://backend.test'};
  global.document = {
    readyState: 'complete',
    getElementById: function (id) {
      return ids[id] || (ids[id] = makeNode(id));
    },
    createElement: function (tag) {
      var n = makeNode(null);
      n.tagName = tag;
      return n;
    },
    addEventListener: function () {}
  };
  var L = makeLeafletStub();
  global.L = L;
  global.fetch = stubFetch;
  global.AbortController = function () {
    var self = this;
    this.signal = {};
    this.abort = function () { self.signal.aborted = true; };
  };
  delete require.cache[require.resolve(APP_PATH)];
  require(APP_PATH);
  return {ids: ids, L: L, map: L._map};
}

// Boots and walks the app to a fully loaded default-date analysis.
async function bootToAnalysis(analysisOverrides) {
  var env = bootApp();
  takeRequest('/api/context').resolve(200, contextBody());
  await flush();
  takeRequest('/api/boundary').resolve(200, boundaryBody());
  takeRequest('/api/analysis?date=2026-07-09')
      .resolve(200, analysisBody('2026-07-09', analysisOverrides));
  await flush();
  return env;
}

function tileLayersOnMap(env) {
  return env.map.layers.filter(function (l) { return l._type === 'tile'; });
}

// The scientific raster: every tile layer except the OpenStreetMap
// basemap (always the first tileLayer the app creates).
function sciLayersOnMap(env) {
  return tileLayersOnMap(env).filter(function (l) {
    return l.url.indexOf('openstreetmap') === -1;
  });
}

/* -------------------------------------------------------------- TESTS */

test('raster opacity is exactly 0.45 and the basemap stays fully ' +
    'opaque', async function () {
  var env = await bootToAnalysis();
  var sci = sciLayersOnMap(env);
  assert.equal(sci.length, 1);
  assert.equal(sci[0].options.opacity, 0.45);
  var basemap = tileLayersOnMap(env).filter(function (l) {
    return l.url.indexOf('openstreetmap') !== -1;
  })[0];
  assert.ok(basemap);
  assert.equal(basemap.options.opacity, undefined); // Leaflet default 1
  settleAll(); await flush();
});

test('"displayed" appears only after a real tileload event',
    async function () {
  var env = await bootToAnalysis();
  var status = env.ids.satLayerState.textContent;
  assert.match(status, /Rendering anomaly tiles/);
  assert.doesNotMatch(status, /displayed/i);

  sciLayersOnMap(env)[0].fire('tileload');
  assert.match(env.ids.satLayerState.textContent,
      /Anomaly layer displayed\./);
  assert.match(env.ids.satLayerState.textContent, /2026-07-09/);
  assert.match(env.ids.satLayerState.textContent, /mol\/m²/);
  assert.match(env.ids.satLayerState.textContent,
      /not comparable across dates/);
  settleAll(); await flush();
});

test('tileerror before any success reports failure; a later ' +
    'success upgrades to a partial-load warning', async function () {
  var env = await bootToAnalysis();
  var layer = sciLayersOnMap(env)[0];
  layer.fire('tileerror');
  assert.match(env.ids.satLayerState.textContent,
      /tile rendering failed/i);
  layer.fire('tileload');
  assert.match(env.ids.satLayerState.textContent,
      /partially rendered/i);
  settleAll(); await flush();
});

test('tileerror after a success produces the partial-load warning ' +
    'and keeps visible tiles', async function () {
  var env = await bootToAnalysis();
  var layer = sciLayersOnMap(env)[0];
  layer.fire('tileload');
  layer.fire('tileerror');
  assert.match(env.ids.satLayerState.textContent,
      /partially rendered/i);
  assert.equal(sciLayersOnMap(env).length, 1); // tiles retained
  settleAll(); await flush();
});

test('a new date removes the stale raster and legend immediately, ' +
    'stale events cannot touch the new layer, and only one ' +
    'scientific layer ever exists', async function () {
  var env = await bootToAnalysis();
  var oldLayer = sciLayersOnMap(env)[0];
  oldLayer.fire('tileload');
  assert.match(env.ids.satLayerState.textContent, /displayed/);
  assert.ok(env.ids.anomalyLegend.childNodes.length > 1); // full legend

  // User requests another date.
  env.ids.analysisDate.value = '2026-07-08';
  env.ids.loadButton.handlers.click[0]();
  await flush();

  // Stale raster and legend are gone during loading.
  assert.equal(sciLayersOnMap(env).length, 0);
  assert.ok(oldLayer.offCalled >= 1);
  assert.equal(env.ids.anomalyLegend.childNodes.length, 1);
  assert.match(env.ids.anomalyLegend.childNodes[0].textContent,
      /renders from backend visualization metadata/);
  assert.match(env.ids.satLayerState.textContent,
      /loading analysis for 2026-07-08/);

  // New analysis arrives; new layer starts rendering.
  takeRequest('/api/analysis?date=2026-07-08')
      .resolve(200, analysisBody('2026-07-08'));
  await flush();
  assert.equal(sciLayersOnMap(env).length, 1);
  var newLayer = sciLayersOnMap(env)[0];
  assert.notEqual(newLayer, oldLayer);
  assert.match(env.ids.satLayerState.textContent,
      /Rendering anomaly tiles/);

  // A late event from the REMOVED layer must not change state.
  oldLayer.captured.tileload[0]({});
  assert.match(env.ids.satLayerState.textContent,
      /Rendering anomaly tiles/);
  assert.doesNotMatch(env.ids.satLayerState.textContent, /displayed/i);

  // Only the new layer's own event moves it forward.
  newLayer.fire('tileload');
  assert.match(env.ids.satLayerState.textContent,
      /Anomaly layer displayed\./);
  assert.match(env.ids.satLayerState.textContent, /2026-07-08/);
  settleAll(); await flush();
});

test('the boundary outline is brought above the raster and is never ' +
    'removed', async function () {
  var env = await bootToAnalysis();
  var geo = env.L._geoLayers[0];
  assert.ok(geo, 'boundary layer exists');
  assert.ok(geo.broughtToFront >= 1, 'bringToFront called');
  assert.ok(env.map.layers.indexOf(geo) !== -1, 'boundary on map');

  // Unavailable state removes only the scientific raster.
  env.ids.analysisDate.value = '2026-07-07';
  env.ids.loadButton.handlers.click[0]();
  await flush();
  takeRequest('/api/analysis?date=2026-07-07')
      .resolve(200, analysisBody('2026-07-07', {
        map: {status: 'baseline_unavailable', tileUrlTemplate: null,
              visualization: null}
      }));
  await flush();
  assert.equal(sciLayersOnMap(env).length, 0);
  assert.ok(env.map.layers.indexOf(geo) !== -1, 'boundary retained');
  assert.match(env.ids.satLayerState.textContent,
      /complete three-year historical baseline/);
  settleAll(); await flush();
});

test('backend/tile error states remove the raster and reset the ' +
    'legend', async function () {
  var env = await bootToAnalysis();
  sciLayersOnMap(env)[0].fire('tileload');

  env.ids.analysisDate.value = '2026-07-06';
  env.ids.loadButton.handlers.click[0]();
  await flush();
  takeRequest('/api/analysis?date=2026-07-06').resolve(502, {
    ok: false,
    error: {code: 'upstream_error', message: 'test upstream failure'}
  });
  await flush();
  assert.equal(sciLayersOnMap(env).length, 0);
  assert.equal(env.ids.anomalyLegend.childNodes.length, 1);
  assert.match(env.ids.satLayerState.textContent,
      /Anomaly layer removed/);
  assert.equal(env.ids.retryAnalysis.hidden, false);
  settleAll(); await flush();
});

test('legend is ONE continuous gradient from backend palette ' +
    'metadata with zero centered at the midpoint', async function () {
  var env = await bootToAnalysis();
  var legend = env.ids.anomalyLegend;
  var row = legend.childNodes[1];
  var rampWrap = row.childNodes[1];
  var ramp = rampWrap.childNodes[0];
  assert.equal(ramp.className, 'ramp');
  assert.equal(ramp.childNodes.length, 0); // no per-colour boxes
  assert.equal(ramp.style.background,
      'linear-gradient(to right, #2166ac 0%, #67a9cf 25%, ' +
      '#f7f7f7 50%, #ef8a62 75%, #b2182b 100%)');
  var zero = rampWrap.childNodes[1];
  assert.equal(zero.textContent, '0'); // centered under the ramp (CSS)
  assert.equal(zero.className, 'rlab rzero');
  // Backend min/max retained verbatim, in scientific notation.
  assert.equal(row.childNodes[0].textContent, '-2.300e-5');
  assert.equal(row.childNodes[2].textContent, '+2.300e-5');
  settleAll(); await flush();
});

test('an invalid backend palette yields a truthful ' +
    'legend-unavailable state without blocking tiles',
    async function () {
  var env = await bootToAnalysis({
    map: {visualization: {min: -1e-5, max: 1e-5,
        paletteStops: ['2166ac', 'not-a-colour'], description: 'x'}}
  });
  assert.equal(sciLayersOnMap(env).length, 1); // tiles unaffected
  var legend = env.ids.anomalyLegend;
  assert.equal(legend.childNodes.length, 1);
  assert.match(legend.childNodes[0].textContent,
      /legend unavailable/i);
  assert.doesNotMatch(legend.childNodes[0].textContent,
      /#?[0-9a-f]{6}/i); // no invented palette
  settleAll(); await flush();
});

test('null scientific values render as em dashes, never zero',
    async function () {
  var env = await bootToAnalysis({
    observation: {status: 'no_products', hasValidValue: false,
        regionalMeanNo2: null, validAreaFraction: 0,
        sourceAssetCount: 0, distinctProductCount: 0,
        distinctOrbitCount: 0},
    baseline: {status: 'target_unavailable', historicalMedianNo2: 3.2e-5,
        signedAnomalyNo2: null, percentile: null},
    map: {status: 'no_products', tileUrlTemplate: null,
        visualization: null}
  });
  assert.equal(env.ids['ro-mean'].textContent, '—');
  assert.equal(env.ids['ro-anom'].textContent, '—');
  assert.equal(env.ids['ro-pct'].textContent, '—');
  assert.notEqual(env.ids['ro-mean'].textContent, '0');
  // Coverage 0 is a REAL scientific zero for no_products — distinct
  // from null — and renders as a percentage, not a dash.
  assert.equal(env.ids['ro-cov'].textContent, '0.0%');
  assert.equal(sciLayersOnMap(env).length, 0);
  settleAll(); await flush();
});
