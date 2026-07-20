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
var fs = require('fs');

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
    },
    // <dialog> surface (harmless on non-dialog stubs).
    open: false,
    showModal: function () { node.open = true; },
    close: function () {
      node.open = false;
      (node.handlers.close || []).slice().forEach(function (fn) { fn({}); });
    },
    focusCalls: 0,
    focus: function () { node.focusCalls += 1; }
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
    panes: {},
    handlers: {},
    removeLayer: function (layer) {
      var i = mapObj.layers.indexOf(layer);
      if (i !== -1) mapObj.layers.splice(i, 1);
    },
    fitBoundsCalls: [],
    fitBounds: function (bounds, options) {
      mapObj.fitBoundsCalls.push({bounds: bounds, options: options});
    },
    createPane: function (name) {
      mapObj.panes[name] = {style: {}};
      return mapObj.panes[name];
    },
    getPane: function (name) { return mapObj.panes[name] || null; },
    getZoom: function () { return mapObj._zoom; },
    _zoom: 8,
    on: function (evt, fn) {
      (mapObj.handlers[evt] = mapObj.handlers[evt] || []).push(fn);
    },
    fireMap: function (evt) {
      (mapObj.handlers[evt] || []).slice().forEach(function (fn) { fn({}); });
    },
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

function bootApp(startPath) {
  pendingRequests.length = 0;
  var ids = {};
  // window stub with a working History API + popstate simulation.
  var win = {
    BACKEND_ORIGIN: 'http://backend.test',
    location: {pathname: startPath || '/'},
    handlers: {},
    addEventListener: function (evt, fn) {
      (win.handlers[evt] = win.handlers[evt] || []).push(fn);
    },
    _stack: [startPath || '/'],
    _idx: 0,
    _firePop: function () {
      (win.handlers.popstate || []).slice().forEach(function (fn) {
        fn({});
      });
    },
    history: {
      pushState: function (s, t, url) {
        win._stack = win._stack.slice(0, win._idx + 1);
        win._stack.push(url);
        win._idx += 1;
        win.location.pathname = url;
      },
      replaceState: function (s, t, url) {
        win._stack[win._idx] = url;
        win.location.pathname = url;
      },
      back: function () {
        if (win._idx > 0) {
          win._idx -= 1;
          win.location.pathname = win._stack[win._idx];
          win._firePop();
        }
      },
      forward: function () {
        if (win._idx < win._stack.length - 1) {
          win._idx += 1;
          win.location.pathname = win._stack[win._idx];
          win._firePop();
        }
      }
    }
  };
  global.window = win;
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
  return {ids: ids, L: L, map: L._map, win: win};
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

test('display-only smoothing: the anomaly layer rides its own pane ' +
    'with a zoom-scaled CSS blur; the basemap pane is untouched',
    async function () {
  var env = await bootToAnalysis();
  var pane = env.map.panes.anomaly;
  assert.ok(pane, 'anomaly pane created');
  assert.equal(pane.style.zIndex, 250);          // below vector overlay
  assert.match(pane.style.filter, /^blur\([\d.]+px\)$/);
  var sci = sciLayersOnMap(env)[0];
  assert.equal(sci.options.pane, 'anomaly');     // filter hits it alone
  var basemap = tileLayersOnMap(env).filter(function (l) {
    return l.url.indexOf('openstreetmap') !== -1;
  })[0];
  assert.equal(basemap.options.pane, undefined); // basemap: default pane
  // Blur scales with zoom (factor 1.5, clamped 4-12 px):
  // z8 cell ~1.82px -> 2.73 -> min clamp 4px; z10 -> ~10.9px;
  // z13 -> max clamp 12px.
  assert.equal(pane.style.filter, 'blur(4px)');
  env.map._zoom = 10;
  env.map.fireMap('zoomend');
  assert.match(pane.style.filter, /^blur\(10\.9/);
  env.map._zoom = 13;                            // clamp at max 12px
  env.map.fireMap('zoomend');
  assert.equal(pane.style.filter, 'blur(12px)');
  settleAll(); await flush();
});

test('tile status shows "Rendering map…" until a real tileload, ' +
    'then hides instead of leaving a permanent success message',
    async function () {
  var env = await bootToAnalysis();
  assert.match(env.ids.satLayerState.textContent, /Rendering map/);
  assert.equal(env.ids.satLayerState.hidden, false);

  sciLayersOnMap(env)[0].fire('tileload');
  assert.equal(env.ids.satLayerState.textContent, '');
  assert.equal(env.ids.satLayerState.hidden, true);
  // The successful boundary likewise leaves no visible status.
  assert.equal(env.ids.mapState.textContent, '');
  assert.equal(env.ids.mapState.hidden, true);
  // And plain availability leaves no permanent readout banner.
  assert.equal(env.ids.readoutState.textContent, '');
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
  assert.equal(env.ids.satLayerState.hidden, true); // rendered, quiet
  assert.ok(env.ids.anomalyLegend.childNodes.length > 1); // full legend

  // User requests another date.
  env.ids.analysisDate.value = '2026-07-08';
  env.ids.loadButton.handlers.click[0]();
  await flush();

  // Stale raster and legend are gone during loading; the loading
  // announcement lives in the live status region, not the tile line.
  assert.equal(sciLayersOnMap(env).length, 0);
  assert.ok(oldLayer.offCalled >= 1);
  assert.equal(env.ids.anomalyLegend.childNodes.length, 1);
  assert.match(env.ids.anomalyLegend.childNodes[0].textContent,
      /renders from backend visualization metadata/);
  assert.equal(env.ids.satLayerState.hidden, true);
  assert.match(env.ids.statusLive.textContent,
      /Loading analysis for 2026-07-08/);

  // New analysis arrives; new layer starts rendering.
  takeRequest('/api/analysis?date=2026-07-08')
      .resolve(200, analysisBody('2026-07-08'));
  await flush();
  assert.equal(sciLayersOnMap(env).length, 1);
  var newLayer = sciLayersOnMap(env)[0];
  assert.notEqual(newLayer, oldLayer);
  assert.match(env.ids.satLayerState.textContent, /Rendering map/);

  // A late event from the REMOVED layer must not change state.
  oldLayer.captured.tileload[0]({});
  assert.match(env.ids.satLayerState.textContent, /Rendering map/);

  // Only the new layer's own event completes the lifecycle, after
  // which the status hides rather than showing a success banner.
  newLayer.fire('tileload');
  assert.equal(env.ids.satLayerState.textContent, '');
  assert.equal(env.ids.satLayerState.hidden, true);
  settleAll(); await flush();
});

test('the boundary outline is brought above the raster and is never ' +
    'removed', async function () {
  var env = await bootToAnalysis();
  var geo = env.L._geoLayers[0];
  assert.ok(geo, 'boundary layer exists');
  assert.ok(geo.broughtToFront >= 1, 'bringToFront called');
  assert.ok(env.map.layers.indexOf(geo) !== -1, 'boundary on map');

  // The initial official-boundary fit runs exactly once and with the
  // zoom animation DISABLED (Leaflet 1.9.4 zoomanim race guard).
  assert.equal(env.map.fitBoundsCalls.length, 1);
  assert.deepEqual(env.map.fitBoundsCalls[0].options,
      {padding: [12, 12], animate: false});

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

test('Load button: loading state (disabled, aria-busy, is-loading, ' +
    '"Loading" label) and restore after success', async function () {
  var env = await bootToAnalysis();
  var btn = env.ids.loadButton;
  var label = env.ids.loadButtonText;
  // Idle after the automatic default-date load completed.
  assert.equal(btn.disabled, false);
  assert.equal(btn.className, 'go');
  assert.equal(btn.attributes['aria-busy'], 'false');
  assert.equal(btn.attributes['aria-label'], 'Load selected date');
  assert.equal(label.textContent, 'Load date');

  env.ids.analysisDate.value = '2026-07-08';
  btn.handlers.click[0]();
  await flush();
  assert.equal(btn.disabled, true);
  assert.match(btn.className, /\bis-loading\b/); // gates the dots span
  assert.equal(btn.attributes['aria-busy'], 'true');
  assert.equal(btn.attributes['aria-label'], 'Loading analysis');
  assert.equal(label.textContent, 'Loading');

  takeRequest('/api/analysis?date=2026-07-08')
      .resolve(200, analysisBody('2026-07-08'));
  await flush();
  assert.equal(btn.disabled, false);
  assert.equal(btn.className, 'go');       // dots no longer rendered
  assert.equal(btn.attributes['aria-busy'], 'false');
  assert.equal(label.textContent, 'Load date');
  settleAll(); await flush();
});

test('Load button: restores its normal state after a backend error',
    async function () {
  var env = await bootToAnalysis();
  var btn = env.ids.loadButton;
  env.ids.analysisDate.value = '2026-07-06';
  btn.handlers.click[0]();
  await flush();
  assert.equal(btn.disabled, true);
  takeRequest('/api/analysis?date=2026-07-06').resolve(502, {
    ok: false, error: {code: 'upstream_error', message: 'boom'}
  });
  await flush();
  assert.equal(btn.disabled, false);
  assert.equal(btn.className, 'go');
  assert.equal(btn.attributes['aria-busy'], 'false');
  assert.equal(env.ids.loadButtonText.textContent, 'Load date');
  settleAll(); await flush();
});

test('Load button: a stale superseded request cannot reset the ' +
    'button while a newer request is active', async function () {
  var env = await bootToAnalysis();
  var btn = env.ids.loadButton;
  env.ids.analysisDate.value = '2026-07-07';
  btn.handlers.click[0]();                    // request A
  await flush();
  var reqA = takeRequest('/api/analysis?date=2026-07-07');
  env.ids.retryAnalysis.handlers.click[0]();  // request B supersedes A
  await flush();
  assert.equal(btn.disabled, true);
  // The STALE request resolving must not touch the loading state.
  reqA.resolve(200, analysisBody('2026-07-07'));
  await flush();
  assert.equal(btn.disabled, true);
  assert.match(btn.className, /\bis-loading\b/);
  assert.equal(btn.attributes['aria-busy'], 'true');
  // Only the newer request's terminal state restores the button.
  takeRequest('/api/analysis?date=2026-07-07')
      .resolve(200, analysisBody('2026-07-07'));
  await flush();
  assert.equal(btn.disabled, false);
  assert.equal(btn.className, 'go');
  settleAll(); await flush();
});

/* ------------------------------- static files: CSS + about page */

test('CSS: dots are a fixed literal revealed by stepped width — the ' +
    'content property is never animated — with a stable 3ch box and ' +
    'a static reduced-motion presentation', function () {
  var css = fs.readFileSync(
      path.join(__dirname, 'public', 'app.css'), 'utf8');
  assert.match(css, /\.go \.dots \{ display: none; \}/);
  // Stable reserved box on the parent span.
  assert.match(css, /\.go\.is-loading \.dots \{[^}]*width: 3ch/);
  // Fixed three-dot literal, overflow-hidden reveal from width 0.
  assert.match(css,
      /\.go\.is-loading \.dots::after \{[^}]*content: '\.\.\.';/);
  assert.match(css,
      /\.go\.is-loading \.dots::after \{[^}]*overflow: hidden/);
  assert.match(css, /\.go\.is-loading \.dots::after \{[^}]*width: 0/);
  // The keyframes step width through 0 / 1ch / 2ch / 3ch dots…
  var kf = css.match(/@keyframes loading-dots \{[\s\S]*?\n\}/);
  assert.ok(kf, 'loading-dots keyframes exist');
  assert.match(kf[0], /0%, 24%\s+\{ width: 0; \}/);
  assert.match(kf[0], /25%, 49%\s+\{ width: 1ch; \}/);
  assert.match(kf[0], /50%, 74%\s+\{ width: 2ch; \}/);
  assert.match(kf[0], /75%, 100%\s+\{ width: 3ch; \}/);
  // …and never touch the content property.
  assert.doesNotMatch(kf[0], /content/);
  // Reduced motion: static ellipsis, no cycling, visible width.
  var reduced = css.slice(css.indexOf('prefers-reduced-motion'));
  assert.match(reduced,
      /\.go\.is-loading \.dots::after \{ content: '…'; animation: none; width: auto; \}/);
});

test('static markup: no navigation bar or EP mark; one plain About ' +
    'link; dialog content is exact and safe', function () {
  var html = fs.readFileSync(
      path.join(__dirname, 'public', 'index.html'), 'utf8');
  var css = fs.readFileSync(
      path.join(__dirname, 'public', 'app.css'), 'utf8');
  var flat = html.replace(/\s+/g, ' ');

  // No navigation bar, no EP monogram, anywhere.
  assert.doesNotMatch(html, /topnav|tn-title|tn-links/);
  assert.doesNotMatch(css, /topnav|\.ep-mark/);
  assert.doesNotMatch(html, /ep-mark/);
  assert.doesNotMatch(html, />EP</);

  // One plain text About link in the masthead with a real href.
  var link = html.match(/<a class="about-link"[^>]*>About<\/a>/);
  assert.ok(link, 'about link exists');
  assert.match(link[0], /id="aboutLink"/);
  assert.match(link[0], /href="\/about"/);

  // Native dialog with labelled heading and accessible close control.
  assert.match(html, /<dialog id="aboutDialog" aria-labelledby="aboutTitle">/);
  assert.match(html, /<h2 id="aboutTitle">Eduardo Perez<\/h2>/);
  assert.match(html,
      /<button type="button" class="dlg-close" id="aboutClose"\s+aria-label="Close About dialog">/);
  assert.match(css, /#aboutDialog::backdrop/);

  // Exact concise paragraph and footer texts.
  assert.ok(flat.indexOf('Bay Area Air Quality Episode Finder is an ' +
      'independent web application for exploring daily Sentinel-5P ' +
      'tropospheric NO₂ column anomalies across the Bay Area. It ' +
      'provides historical comparison and data coverage for each ' +
      'selected date.') !== -1);
  assert.ok(flat.indexOf('© 2026 Eduardo Perez') !== -1);
  assert.ok(flat.indexOf('Independent project. Not affiliated with ' +
      'or endorsed by BAAQMD, EPA, Google, Copernicus, or ' +
      'OpenStreetMap.') !== -1);
  assert.ok(flat.indexOf('Contains modified Copernicus Sentinel ' +
      'data. Map data © OpenStreetMap contributors.') !== -1);

  // Exact contacts; plain descriptive repository label.
  assert.match(html, /href="mailto:eduardojr\.perez@sjsu\.edu"/);
  assert.ok(html.indexOf('eduardojr.perez@sjsu.edu</a>') !== -1);
  assert.ok(html.indexOf(
      'https://www.linkedin.com/in/perez-eduardo/') !== -1);
  assert.ok(html.indexOf('https://github.com/perez-eduardo/' +
      'Bay-Area-Air-Quality-Episode-Finder') !== -1);
  assert.ok(html.indexOf(
      'View the application source repository</a>') !== -1);

  // None of the removed wording appears anywhere on the page.
  assert.doesNotMatch(flat, /NASA/i);
  assert.doesNotMatch(flat, /EarthRISE/i);
  assert.doesNotMatch(flat, /internship/i);
  assert.doesNotMatch(flat, /portfolio|résumé|resume/i);
  assert.doesNotMatch(flat, /MIT|BSD|GPL|Apache|public domain/);

  // External links open safely; the mailto stays in-context.
  var dialogHtml = html.match(/<dialog[\s\S]*?<\/dialog>/)[0];
  var links = dialogHtml.match(/<a [^>]*href="https:[^>]*>/g) || [];
  assert.ok(links.length >= 2);
  links.forEach(function (tag) {
    assert.match(tag, /target="_blank"/);
    assert.match(tag, /rel="noopener noreferrer"/);
  });
  var mailtoTag = dialogHtml.match(/<a [^>]*mailto:[^>]*>/)[0];
  assert.doesNotMatch(mailtoTag, /target=/);
});

test('About link opens the native dialog without navigating, X and ' +
    'Escape close it, focus returns, and panel clicks stay open',
    async function () {
  var env = await bootToAnalysis();
  var dlg = env.ids.aboutDialog;
  var link = env.ids.aboutLink;

  var prevented = 0;
  link.handlers.click[0]({preventDefault: function () { prevented += 1; }});
  assert.equal(prevented, 1);                 // no page navigation
  assert.equal(dlg.open, true);               // showModal() ran
  assert.equal(env.win.location.pathname, '/about'); // pushState

  // Clicking inside the panel does not close it.
  dlg.handlers.click[0]({target: {some: 'child'}});
  assert.equal(dlg.open, true);

  // The X control closes it, the URL returns to /, focus returns.
  var focusBefore = link.focusCalls;
  env.ids.aboutClose.handlers.click[0]();
  assert.equal(dlg.open, false);
  assert.equal(env.win.location.pathname, '/');
  assert.equal(link.focusCalls, focusBefore + 1);

  // Escape funnels through the same native close event: simulate the
  // native cancel -> close sequence directly.
  link.handlers.click[0]({preventDefault: function () {}});
  assert.equal(dlg.open, true);
  dlg.close();                                // what native Escape does
  assert.equal(dlg.open, false);
  assert.equal(env.win.location.pathname, '/');
  assert.equal(link.focusCalls, focusBefore + 2);

  // Backdrop clicks (event target is the dialog itself) close it.
  link.handlers.click[0]({preventDefault: function () {}});
  dlg.handlers.click[0]({target: dlg});
  assert.equal(dlg.open, false);
  assert.equal(env.win.location.pathname, '/');
  settleAll(); await flush();
});

test('/about deep link opens the dialog automatically and closing ' +
    'rewrites the URL to / without a reload', async function () {
  var env = bootApp('/about');
  assert.equal(env.ids.aboutDialog.open, true); // opened during init
  takeRequest('/api/context').resolve(200, contextBody());
  await flush();
  env.ids.aboutClose.handlers.click[0]();
  assert.equal(env.ids.aboutDialog.open, false);
  assert.equal(env.win.location.pathname, '/'); // replaceState path
  settleAll(); await flush();
});

test('browser Back closes the modal and Forward reopens it, with ' +
    'no history loops', async function () {
  var env = await bootToAnalysis();
  var dlg = env.ids.aboutDialog;
  env.ids.aboutLink.handlers.click[0]({preventDefault: function () {}});
  assert.equal(dlg.open, true);
  assert.deepEqual(env.win._stack, ['/', '/about']);

  env.win.history.back();                     // user presses Back
  assert.equal(dlg.open, false);
  assert.equal(env.win.location.pathname, '/');

  env.win.history.forward();                  // user presses Forward
  assert.equal(dlg.open, true);
  assert.equal(env.win.location.pathname, '/about');

  env.win.history.back();                     // Back again still works
  assert.equal(dlg.open, false);
  assert.equal(env.win.location.pathname, '/');
  assert.deepEqual(env.win._stack, ['/', '/about']); // no loop growth
  settleAll(); await flush();
});

test('no em or en dash appears in visible page prose or generated ' +
    'UI strings (null-value placeholder glyphs excepted)',
    function () {
  ['index.html'].forEach(function (name) {
    var html = fs.readFileSync(
        path.join(__dirname, 'public', name), 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '')      // comments are invisible
        .replace(/>—</g, '><');               // standalone null glyphs
    assert.doesNotMatch(html, /[–—]/,
        name + ' contains a visible em/en dash');
  });
  var js = fs.readFileSync(
      path.join(__dirname, 'public', 'app.js'), 'utf8');
  js.split('\n').forEach(function (line, i) {
    // String literals only; the bare '—' placeholder constant for
    // null values is the documented exception.
    if (/'[^']*[–—][^']*'/.test(line) &&
        line.indexOf("'—'") === -1) {
      assert.fail('app.js:' + (i + 1) +
          ' has an em/en dash inside a UI string: ' + line.trim());
    }
  });
});

test('the rail contains no dedicated Baseline method or Map layer ' +
    'control', function () {
  var html = fs.readFileSync(
      path.join(__dirname, 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /Baseline method/);
  assert.doesNotMatch(html, /id="baselineLabel"/);
  assert.doesNotMatch(html, /id="layerLabel"/);
  // The baseline is mentioned once, inside the compact map
  // explanation.
  var flat = html.replace(/\s+/g, ' ');
  assert.ok(flat.indexOf('compared with the same calendar month in ' +
      'the previous three years') !== -1);
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
