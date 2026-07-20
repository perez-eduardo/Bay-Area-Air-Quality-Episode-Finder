/*
 * Bay Area Air Quality Episode Finder — public UI.
 *
 * STAGE: first vertical slice. The UI analyzes ONE Bay Area local
 * calendar date at a time against the backend API:
 *   GET /api/context   — dataset, availability, region bootstrap
 *   GET /api/boundary  — official BAAQMD boundary GeoJSON
 *   GET /api/analysis  — observation, baseline, anomaly-map metadata
 *
 * Structure deliberately mirrors exploration scripts 02–06: a single
 * `state` cache, a `render()` that redraws purely from that cache, and
 * request tokens that make stale asynchronous results harmless.
 *
 * Scientific presentation rules (docs/ui-data-contract.md):
 *   - the backend is the authority for date availability and for
 *     null/status semantics; nothing here reconstructs Earth Engine
 *     rules or fabricates values;
 *   - a null scientific value is NEVER rendered as zero;
 *   - the valid-area fraction is displayed with every value and never
 *     used as a hidden pass/fail filter;
 *   - the anomaly legend renders only from backend visualization
 *     metadata; no palette, range, or threshold is invented here;
 *   - no AQI, health, surface-concentration, or episode wording.
 *
 * Plain browser JavaScript, no framework and no build step: the file
 * served is the file in the repository.
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------ CONFIG */

  var CONFIG = {
    // Injected by the frontend server from BACKEND_ORIGIN so the API
    // origin is an environment setting, not a hardcoded client value.
    backendOrigin: (window.BACKEND_ORIGIN || '').indexOf('__') === 0 ?
        'https://api.neuralnetworks.me' : window.BACKEND_ORIGIN,

    // Bay Area view for the basemap until the official boundary
    // arrives; the map is fitted to the boundary exactly once.
    mapCenter: [37.75, -122.15],
    mapZoom: 8,

    // Opacity for every SCIENTIFIC raster tile layer (0.45, decided
    // for this correction): low enough that basemap roads, shorelines,
    // and labels stay readable underneath. The signed column anomaly
    // is currently the only scientific raster layer. Basemap and
    // boundary-line opacity are not governed by this value.
    scientificRasterOpacity: 0.45,

    /*
     * DISPLAY-ONLY smoothing of the anomaly raster (owner-directed
     * 2026-07-20): a CSS blur on the layer's dedicated map pane. The
     * radius is tied to the size of one native 0.01° grid cell at the
     * current zoom (clamped below), so the display smooths cell edges
     * without inventing detail finer than the source grid. Purely a
     * browser rendering effect: tiles, backend data values, and every
     * statistic are untouched, and disabling it costs one CSS filter.
     */
    anomalySmoothingCellFactor: 1.5,
    anomalySmoothingMinPx: 4,
    anomalySmoothingMaxPx: 12,

    /*
     * Outer browser timeouts. Each is deliberately LONGER than the
     * matching backend bound (app/backend/analysis.js CONSTANTS:
     * context 60 s; boundary 90 s; analysis worst case 540 s = 60 s
     * cold-context lookup + the 480 s overall analysis deadline), so
     * the browser never gives up while the backend is still within
     * its own budget. Cold-cache analyses may legitimately take
     * minutes.
     */
    contextTimeoutMs: 70000,
    boundaryTimeoutMs: 100000,
    analysisTimeoutMs: 600000
  };

  /* ------------------------------------------------------------- STATE */

  // Single source of truth for everything rendered. Never read the DOM
  // to discover application state.
  var state = {
    // context: loading | ready | ee_not_ready | timeout | unreachable |
    //          error
    context: {status: 'loading', data: null, message: null},
    // boundary: idle | loading | ready | timeout | unavailable
    boundary: {status: 'idle', message: null},
    // analysis: idle | loading | ready | invalid_date | out_of_range |
    //           ee_not_ready | upstream_error | upstream_timeout |
    //           timeout | unreachable | error
    analysis: {status: 'idle', data: null, message: null,
               requestedDate: null},
    statusMessage: 'Loading…'
  };

  // Monotonic per-phase request tokens: a response is applied only if
  // its token is still current, so a late response for an older
  // request can never overwrite the current one.
  var contextToken = 0;
  var boundaryToken = 0;
  var analysisToken = 0;
  var analysisRequest = null;   // {controller, timedOut} of the active request

  /* --------------------------------------------------------- ELEMENTS */

  function el(id) { return document.getElementById(id); }

  var nodes = {
    product: el('i-product'),
    region: el('i-region'),
    latest: el('i-latest'),
    lastinc: el('i-lastinc'),
    backend: el('i-backend'),
    freshness: el('freshnessNote'),
    dateInput: el('analysisDate'),
    loadButton: el('loadButton'),
    statusLive: el('statusLive'),
    retryContext: el('retryContext'),
    retryBoundary: el('retryBoundary'),
    retryAnalysis: el('retryAnalysis'),
    mapState: el('mapState'),
    satLayer: el('satLayerState'),
    legend: el('anomalyLegend'),
    readoutState: el('readoutState'),
    roMean: el('ro-mean'), roMeanUnit: el('ro-mean-unit'),
    roAnom: el('ro-anom'), roAnomUnit: el('ro-anom-unit'),
    roPct: el('ro-pct'), roPctUnit: el('ro-pct-unit'),
    roCov: el('ro-cov'), roCovUnit: el('ro-cov-unit'),
    warnings: el('warnings'),
    dDate: el('d-date'), dObs: el('d-obs'), dAssets: el('d-assets'),
    dProducts: el('d-products'), dOrbits: el('d-orbits'),
    dQuality: el('d-quality'), dProj: el('d-proj'),
    dBaseline: el('d-baseline'), dMedian: el('d-median'),
    dSamples: el('d-samples'), dReqYears: el('d-reqyears'),
    dContribYears: el('d-contribyears')
  };

  /* --------------------------------------------------------- HELPERS */

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // Scientific notation for column values (mol/m² magnitudes are tiny;
  // fixed-point would hide them or read as zero). Null stays null.
  function fmtSci(value) {
    if (value === null || value === undefined ||
        typeof value !== 'number' || !isFinite(value)) {
      return null;
    }
    if (value === 0) return '0';
    return value.toExponential(3);
  }

  // Signed variant for anomalies: an explicit '+' keeps the sign of
  // small positive anomalies visible.
  function fmtSciSigned(value) {
    var s = fmtSci(value);
    if (s === null) return null;
    return value > 0 ? '+' + s : s;
  }

  function fmtPercentile(value) {
    if (value === null || value === undefined ||
        typeof value !== 'number' || !isFinite(value)) {
      return null;
    }
    return value.toFixed(1);
  }

  // Valid-area fraction as a percentage. 0 is a real scientific value
  // here (no valid area), distinct from null (not applicable).
  function fmtCoverage(fraction) {
    if (fraction === null || fraction === undefined ||
        typeof fraction !== 'number' || !isFinite(fraction)) {
      return null;
    }
    var pct = fraction * 100;
    return (pct !== 0 && pct < 1 ? pct.toFixed(2) : pct.toFixed(1)) + '%';
  }

  function joinYears(years) {
    if (!years || !years.length) return null;
    return years.join(', ');
  }

  function setCell(node, text, className) {
    if (!node) return;
    node.textContent = text;
    node.className = 'ival' + (className ? ' ' + className : '');
  }

  function setText(node, text) {
    if (node) node.textContent = text;
  }

  // Readout setter: null values render as an em dash with the reason
  // on the unit line — never as zero.
  function setReadout(valueNode, unitNode, formatted, unitText) {
    if (formatted === null) {
      valueNode.textContent = '—';
      valueNode.className = 'roval awaiting';
    } else {
      valueNode.textContent = formatted;
      valueNode.className = 'roval';
    }
    unitNode.textContent = unitText || '';
  }

  /*
   * fetch wrapper: JSON body (null if unparsable) plus HTTP status,
   * with an outer timeout wired through AbortController. The holder's
   * timedOut flag distinguishes a timeout abort from a supersede
   * abort.
   */
  function fetchJson(url, timeoutMs, holder) {
    var timer = setTimeout(function () {
      holder.timedOut = true;
      holder.controller.abort();
    }, timeoutMs);
    return fetch(url, {signal: holder.controller.signal})
        .then(function (response) {
          return response.json().catch(function () {
            return null;
          }).then(function (body) {
            return {httpStatus: response.status, body: body};
          });
        })
        .finally(function () { clearTimeout(timer); });
  }

  function isAbortError(error) {
    return !!error && (error.name === 'AbortError' ||
        error.code === 20);
  }

  function errorMessageFrom(result, fallback) {
    if (result && result.body && result.body.error &&
        result.body.error.message) {
      return String(result.body.error.message);
    }
    return fallback;
  }

  /* -------------------------------------------------------------- MAP */

  var leafletMap = null;
  var boundaryLayer = null;        // single reference; never duplicated
  var boundaryFitted = false;      // fit to the boundary exactly once
  var satelliteTileLayer = null;   // single reference; never stacked

  /*
   * Truthful tile-rendering lifecycle. Attaching an Earth Engine tile
   * URL to Leaflet is NOT the same as displaying a rendered tile —
   * the first tile can take tens of seconds server-side. The layer
   * therefore has its own state, derived from real Leaflet tile
   * events, with a generation token so events from a removed layer
   * can never update the state of a newer one:
   *   none      — no scientific layer exists;
   *   rendering — layer attached, no tile outcome yet;
   *   displayed — at least one tile rendered, none failed;
   *   partial   — tiles rendered, but one or more failed;
   *   failed    — tile errors before any successful tile.
   */
  var tileGeneration = 0;
  var tileState = {status: 'none', loaded: 0, errored: 0};

  function resetTileState() {
    tileGeneration += 1;             // invalidates removed-layer events
    tileState = {status: 'none', loaded: 0, errored: 0};
  }

  var anomalyPaneReady = false;

  // Sets the display-only blur on the anomaly pane, scaled to the
  // on-screen size of one native 0.01° cell at the current zoom.
  function updateAnomalySmoothing() {
    if (!leafletMap || !anomalyPaneReady || !leafletMap.getPane) return;
    var pane = leafletMap.getPane('anomaly');
    if (!pane) return;
    var zoom = typeof leafletMap.getZoom === 'function' ?
        leafletMap.getZoom() : CONFIG.mapZoom;
    var cellPx = 256 * Math.pow(2, zoom) * 0.01 / 360;
    var blur = Math.min(CONFIG.anomalySmoothingMaxPx,
        Math.max(CONFIG.anomalySmoothingMinPx,
            CONFIG.anomalySmoothingCellFactor * cellPx));
    pane.style.filter = 'blur(' + blur + 'px)';
  }

  function initMap() {
    if (typeof L === 'undefined' || !el('map')) return;
    leafletMap = L.map('map', {
      center: CONFIG.mapCenter,
      zoom: CONFIG.mapZoom,
      scrollWheelZoom: false   // avoids hijacking page scroll
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(leafletMap);
    // Dedicated pane for the scientific raster so the display-only
    // smoothing filter applies to it alone — never the basemap and
    // never the vector boundary (overlay pane, z-index 400, above).
    if (typeof leafletMap.createPane === 'function') {
      var pane = leafletMap.createPane('anomaly');
      pane.style.zIndex = 250;
      pane.style.pointerEvents = 'none';
      anomalyPaneReady = true;
      if (typeof leafletMap.on === 'function') {
        leafletMap.on('zoomend', updateAnomalySmoothing);
      }
      updateAnomalySmoothing();
    }
    // Keyboard users can still zoom; the control is focusable.
    L.control.scale({imperial: true, metric: true}).addTo(leafletMap);
  }

  // Draws the official boundary. Removing any previous layer first
  // means retries never duplicate it; the basemap is never touched.
  function setBoundaryLayer(geojson) {
    if (!leafletMap) return;
    if (boundaryLayer) {
      leafletMap.removeLayer(boundaryLayer);
      boundaryLayer = null;
    }
    boundaryLayer = L.geoJSON(geojson, {
      style: {
        color: '#0b3d91', weight: 2, opacity: 0.9,
        fillOpacity: 0.02, interactive: false
      }
    }).addTo(leafletMap);
    // If a scientific raster is already on the map (boundary retry),
    // the official outline still goes above it.
    if (boundaryLayer.bringToFront) boundaryLayer.bringToFront();
    if (!boundaryFitted) {
      try {
        leafletMap.fitBounds(boundaryLayer.getBounds(),
            {padding: [12, 12]});
        boundaryFitted = true;
      } catch (ignored) { /* keep the default view */ }
    }
  }

  // Removes the scientific layer and resets the tile lifecycle.
  // Called before adding a new date's layer and on EVERY
  // unavailable/error/date-changing state so stale anomaly tiles never
  // linger under a message that says otherwise. Handlers are detached
  // and the generation token advances, so a removed layer's late tile
  // events are doubly inert.
  function removeAnomalyLayer() {
    if (satelliteTileLayer) {
      if (satelliteTileLayer.off) satelliteTileLayer.off();
      if (leafletMap) leafletMap.removeLayer(satelliteTileLayer);
    }
    satelliteTileLayer = null;
    resetTileState();
  }

  // Adds the anomaly tile layer for a successful date. Refuses to run
  // without a real tile URL template: nothing is ever fabricated. The
  // layer starts in 'rendering' state; only real tileload/tileerror
  // events move it forward.
  function setAnomalyLayer(mapBlock) {
    if (!leafletMap || !mapBlock ||
        typeof mapBlock.tileUrlTemplate !== 'string' ||
        mapBlock.tileUrlTemplate.length === 0) {
      return false;
    }
    removeAnomalyLayer();
    var generation = tileGeneration;   // this layer's identity
    tileState = {status: 'rendering', loaded: 0, errored: 0};

    function onTileEvent(kind) {
      return function () {
        if (generation !== tileGeneration) return; // removed layer
        if (kind === 'load') tileState.loaded += 1;
        else tileState.errored += 1;
        var next = tileState.loaded > 0 ?
            (tileState.errored > 0 ? 'partial' : 'displayed') :
            (tileState.errored > 0 ? 'failed' : 'rendering');
        if (next !== tileState.status) {
          tileState.status = next;
          render();
        }
      };
    }

    var layerOptions = {
      opacity: CONFIG.scientificRasterOpacity,
      attribution: mapBlock.attribution ||
          'Contains modified Copernicus Sentinel data'
    };
    if (anomalyPaneReady) layerOptions.pane = 'anomaly';
    satelliteTileLayer = L.tileLayer(mapBlock.tileUrlTemplate,
        layerOptions);
    satelliteTileLayer.on('tileload', onTileEvent('load'));
    satelliteTileLayer.on('tileerror', onTileEvent('error'));
    satelliteTileLayer.addTo(leafletMap);
    // The official boundary outline must stay visible above the
    // scientific raster.
    if (boundaryLayer && boundaryLayer.bringToFront) {
      boundaryLayer.bringToFront();
    }
    return true;
  }

  /* ---------------------------------------------------------- RENDER */

  function render() {
    renderInstrumentStrip();
    renderControls();
    renderMapStates();
    renderLegend();
    renderReadouts();
    renderDetail();
    renderWarnings();
    setText(nodes.statusLive, state.statusMessage);
  }

  function renderInstrumentStrip() {
    var ctx = state.context;
    var d = ctx.data;

    setCell(nodes.product,
        d ? d.dataset.id.replace('COPERNICUS/', '') : 'unavailable',
        d ? '' : 'pending');
    setCell(nodes.region,
        d && d.region.boundaryAvailable ? 'BAAQMD jurisdiction' :
            'unavailable',
        d ? '' : 'pending');
    setCell(nodes.latest,
        d ? d.availability.latestRepresentedLocalDate : 'unavailable',
        d ? '' : 'pending');
    setCell(nodes.lastinc,
        d ? d.availability.lastIncludedLocalDate : 'unavailable',
        d ? 'flagged' : 'pending');

    var backendText, backendClass;
    if (ctx.status === 'loading') {
      backendText = 'checking…'; backendClass = 'pending';
    } else if (ctx.status === 'ready') {
      if (state.analysis.status === 'ee_not_ready') {
        backendText = 'EE not ready'; backendClass = 'bad';
      } else {
        backendText = 'reachable'; backendClass = 'good';
      }
    } else if (ctx.status === 'ee_not_ready') {
      backendText = 'EE not ready'; backendClass = 'bad';
    } else {
      backendText = 'unreachable'; backendClass = 'bad';
    }
    setCell(nodes.backend, backendText, backendClass);

    setText(nodes.freshness,
        d ? d.availability.freshnessNote : '');
  }

  function renderControls() {
    var ctx = state.context;
    var ready = ctx.status === 'ready';
    var loading = state.analysis.status === 'loading';

    nodes.dateInput.disabled = !ready || loading;
    // The Load button is disabled while a request is active; the
    // selected date stays visible in the input during loading.
    nodes.loadButton.disabled = !ready || loading;
    nodes.loadButton.textContent = loading ? 'Loading…' : 'Load date';

    nodes.retryContext.hidden = !(ctx.status === 'ee_not_ready' ||
        ctx.status === 'timeout' || ctx.status === 'unreachable' ||
        ctx.status === 'error');

    nodes.retryBoundary.hidden = !(state.boundary.status === 'timeout' ||
        state.boundary.status === 'unavailable');

    var a = state.analysis.status;
    nodes.retryAnalysis.hidden = !(a === 'ee_not_ready' ||
        a === 'upstream_error' || a === 'upstream_timeout' ||
        a === 'timeout' || a === 'unreachable' || a === 'error');
  }

  function renderMapStates() {
    setText(nodes.mapState, boundaryStateText());
    setText(nodes.satLayer, anomalyStateText());
  }

  function boundaryStateText() {
    var ctx = state.context.status;
    if (ctx === 'loading') {
      return 'Basemap only — waiting for the backend.';
    }
    if (ctx !== 'ready' && ctx !== 'ee_not_ready') {
      return 'Basemap only. The backend could not be reached, so the ' +
          'official boundary cannot be drawn.';
    }
    switch (state.boundary.status) {
      case 'loading':
        return 'Loading the official BAAQMD boundary…';
      case 'ready':
        return 'Official BAAQMD jurisdiction boundary drawn from the ' +
            'backend asset.';
      case 'timeout':
        return 'Boundary unavailable — the boundary request timed ' +
            'out. No approximate boundary is substituted.';
      case 'unavailable':
        return 'Boundary unavailable — ' +
            (state.boundary.message || 'the backend could not supply ' +
                'the official boundary') +
            '. No approximate boundary is substituted.';
      default:
        return 'Basemap only — boundary not requested yet.';
    }
  }

  function anomalyStateText() {
    var a = state.analysis;
    if (state.context.status !== 'ready') {
      return 'Anomaly layer: waiting for the backend connection.';
    }
    if (a.status === 'idle') {
      return 'Anomaly layer: waiting for the first analysis.';
    }
    if (a.status === 'loading') {
      return 'Anomaly layer: loading analysis for ' +
          a.requestedDate + '…';
    }
    if (a.status !== 'ready') {
      return 'Anomaly layer removed — ' + analysisStateText() + '';
    }
    var map = a.data.map;
    switch (map.status) {
      case 'available':
        // Truthful lifecycle: a tile URL attached to Leaflet is not a
        // displayed layer. The wording follows real tile events.
        switch (tileState.status) {
          case 'rendering':
            return 'Rendering anomaly tiles… First Earth Engine tile ' +
                'rendering can take tens of seconds.';
          case 'displayed':
            return 'Anomaly layer displayed. Local date ' +
                map.localDate + '; unit ' + map.unit + '. Per-date ' +
                'display stretch — colour intensity is not ' +
                'comparable across dates.';
          case 'partial':
            return 'Anomaly layer partially rendered — ' +
                tileState.errored + ' tile request(s) failed; ' +
                'successfully rendered tiles remain visible. Local ' +
                'date ' + map.localDate + '; unit ' + map.unit +
                '. Per-date display stretch — colour intensity is ' +
                'not comparable across dates.';
          case 'failed':
            return 'Anomaly tile rendering failed — the tile service ' +
                'returned errors before any tile rendered. The ' +
                'observation and baseline values above stand.';
          default:
            return 'Anomaly layer state: ' + tileState.status + '.';
        }
      case 'baseline_unavailable':
        return 'Anomaly map unavailable — complete three-year ' +
            'historical baseline is not available for this date.';
      case 'no_products':
        return 'Anomaly map unavailable — no source products were ' +
            'acquired for this date.';
      case 'no_valid_retrieval':
        return 'Anomaly map unavailable — products exist for this ' +
            'date but none produced a valid retrieval.';
      case 'projection_incompatible':
        return 'Anomaly map unavailable — this date’s source ' +
            'grid is incompatible with the canonical lattice.';
      case 'visualization_unavailable':
        return 'Anomaly map unavailable — valid visualization bounds ' +
            'could not be calculated for this date.';
      case 'upstream_error':
        return 'Anomaly map unavailable — the tile request failed. ' +
            'The observation and baseline values above it stand.';
      default:
        return 'Anomaly map unavailable (' + map.status + ').';
    }
  }

  // Normalizes one backend palette entry to a CSS hex colour with a
  // leading '#'. Returns null for anything that is not a hex colour —
  // no replacement colour is ever invented client-side.
  function normalizePaletteColor(value) {
    if (typeof value !== 'string') return null;
    var hex = value.charAt(0) === '#' ? value.slice(1) : value;
    if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) {
      return null;
    }
    return '#' + hex;
  }

  /*
   * One continuous CSS gradient derived from the backend palette
   * stops, distributed evenly from 0% to 100% (the backend supplies
   * no explicit stop positions today). The anomaly is a continuous
   * variable; the stops are interpolation control points, never
   * categories. Because the backend range is symmetric, the ramp
   * midpoint (50%) is zero by construction. Returns null when any
   * entry is not interpretable — the caller then shows a truthful
   * legend-unavailable state instead of inventing a palette.
   * NOTE: this smooths the LEGEND only; the map raster keeps its
   * blocky 0.01° display-grid appearance.
   */
  function legendGradientCss(paletteStops) {
    if (!paletteStops || !paletteStops.length) return null;
    var colors = [];
    for (var i = 0; i < paletteStops.length; i++) {
      var color = normalizePaletteColor(paletteStops[i]);
      if (color === null) return null;
      colors.push(color);
    }
    var pieces = [];
    for (var k = 0; k < colors.length; k++) {
      var pct = colors.length === 1 ? 50 :
          (100 * k / (colors.length - 1));
      pieces.push(colors[k] + ' ' + (Math.round(pct * 100) / 100) + '%');
    }
    return 'linear-gradient(to right, ' + pieces.join(', ') + ')';
  }

  /*
   * Legend renderer. Renders ONLY from backend visualization metadata
   * (minimum, maximum, palette stops, description): no fixed palette,
   * numeric limits, or thresholds are invented client-side. Shows the
   * exact min, a centered zero, and the max of the per-date stretch.
   */
  function renderLegend() {
    var legend = nodes.legend;
    if (!legend) return;
    var a = state.analysis;
    var vis = a.status === 'ready' && a.data.map.status === 'available' ?
        a.data.map.visualization : null;
    legend.innerHTML = '';
    if (!vis || !vis.paletteStops || !vis.paletteStops.length ||
        typeof vis.min !== 'number' || typeof vis.max !== 'number') {
      var placeholder = document.createElement('span');
      placeholder.className = 'bmeta';
      placeholder.textContent = 'Anomaly legend renders from backend ' +
          'visualization metadata when the layer loads.';
      legend.appendChild(placeholder);
      return;
    }
    var map = a.data.map;
    var gradient = legendGradientCss(vis.paletteStops);
    if (gradient === null) {
      var unavailable = document.createElement('span');
      unavailable.className = 'bmeta';
      unavailable.textContent = 'Anomaly legend unavailable — the ' +
          'backend palette metadata could not be interpreted. No ' +
          'replacement palette is invented; map tiles are unaffected.';
      legend.appendChild(unavailable);
      return;
    }
    var title = document.createElement('span');
    title.className = 'bmeta';
    title.textContent = 'Signed column anomaly (' + map.unit + ') — ' +
        map.localDate;
    legend.appendChild(title);

    var row = document.createElement('div');
    row.className = 'legend-row';
    var low = document.createElement('span');
    low.className = 'rlab';
    low.textContent = fmtSci(vis.min);
    row.appendChild(low);

    var rampWrap = document.createElement('div');
    rampWrap.className = 'ramp-wrap';
    var ramp = document.createElement('div');
    ramp.className = 'ramp';
    ramp.style.background = gradient;
    ramp.setAttribute('role', 'img');
    ramp.setAttribute('aria-label',
        'Continuous anomaly colour gradient from backend ' +
        'visualization metadata, from ' + fmtSci(vis.min) +
        ' through zero at the midpoint to +' + fmtSci(vis.max) +
        ' ' + map.unit);
    rampWrap.appendChild(ramp);
    var zero = document.createElement('span');
    zero.className = 'rlab rzero';
    zero.textContent = '0';
    rampWrap.appendChild(zero);
    row.appendChild(rampWrap);

    var high = document.createElement('span');
    high.className = 'rlab';
    high.textContent = '+' + fmtSci(vis.max);
    row.appendChild(high);
    legend.appendChild(row);
    // The per-date-stretch and cross-date-comparability caveats live
    // in the single "About this layer" block, not repeated here.
  }

  // One-line human state for non-ready analysis statuses.
  function analysisStateText() {
    var a = state.analysis;
    switch (a.status) {
      case 'idle': return 'Waiting for the first analysis';
      case 'loading':
        return 'Loading analysis for ' + a.requestedDate + '…';
      case 'invalid_date':
        return a.message || 'The selected date is not a valid date.';
      case 'out_of_range':
        return a.message ||
            'The selected date is outside the supported range.';
      case 'ee_not_ready':
        return 'The backend’s Earth Engine client is not ready. ' +
            'Retry shortly.';
      case 'upstream_error':
        return 'Earth Engine reported an error for this request. ' +
            (a.message || '');
      case 'upstream_timeout':
        return 'The backend’s Earth Engine request timed out. ' +
            'Retry may succeed once cached.';
      case 'timeout':
        return 'The analysis request timed out in the browser. The ' +
            'backend may still be computing; retry shortly.';
      case 'unreachable':
        return 'The backend could not be reached.';
      case 'error':
        return a.message || 'Unexpected analysis failure.';
      default: return '';
    }
  }

  // Short reason strings for the readout unit lines when a value is
  // null. Wording comes from the documented scientific states.
  function observationReason(obs) {
    switch (obs.status) {
      case 'no_products': return 'no source products for this date';
      case 'no_valid_retrieval':
        return 'products exist, no valid retrieval';
      case 'projection_incompatible':
        return 'source grid incompatible — value withheld by design';
      default: return 'unavailable';
    }
  }

  function baselineReason(baseline) {
    switch (baseline.status) {
      case 'partial_window':
        return 'historical window structurally partial';
      case 'target_unavailable':
        return 'no valid target value for this date';
      case 'upstream_error': return 'baseline calculation failed';
      default: return 'unavailable';
    }
  }

  function renderReadouts() {
    var a = state.analysis;
    if (a.status !== 'ready') {
      setText(nodes.readoutState, analysisStateText() ||
          'Waiting for the first analysis');
      setReadout(nodes.roMean, nodes.roMeanUnit, null, '');
      setReadout(nodes.roAnom, nodes.roAnomUnit, null, '');
      setReadout(nodes.roPct, nodes.roPctUnit, null, '');
      setReadout(nodes.roCov, nodes.roCovUnit, null, '');
      return;
    }
    var data = a.data;
    var obs = data.observation;
    var base = data.baseline;

    setText(nodes.readoutState, 'Local date ' + data.localDate +
        ' — observation: ' + obs.status.replace(/_/g, ' ') +
        '; baseline: ' + base.status.replace(/_/g, ' '));

    var mean = fmtSci(obs.regionalMeanNo2);
    setReadout(nodes.roMean, nodes.roMeanUnit, mean,
        mean !== null ? data.dataset.unit : observationReason(obs));

    var anom = fmtSciSigned(base.signedAnomalyNo2);
    setReadout(nodes.roAnom, nodes.roAnomUnit, anom,
        anom !== null ? data.dataset.unit : baselineReason(base));

    var pct = fmtPercentile(base.percentile);
    setReadout(nodes.roPct, nodes.roPctUnit, pct,
        pct !== null ? 'percentile (≤ convention)' :
            baselineReason(base));

    var cov = fmtCoverage(obs.validAreaFraction);
    setReadout(nodes.roCov, nodes.roCovUnit, cov,
        cov !== null ? 'of BAAQMD area with valid pixels' :
            observationReason(obs));
  }

  function renderDetail() {
    var a = state.analysis;
    var dash = '—';
    if (a.status !== 'ready') {
      var pendingDate = a.requestedDate || dash;
      setText(nodes.dDate, a.status === 'loading' ?
          pendingDate + ' (loading…)' : pendingDate);
      [nodes.dObs, nodes.dAssets, nodes.dProducts, nodes.dOrbits,
       nodes.dQuality, nodes.dProj, nodes.dBaseline, nodes.dMedian,
       nodes.dSamples, nodes.dReqYears, nodes.dContribYears]
          .forEach(function (node) { setText(node, dash); });
      return;
    }
    var data = a.data;
    var obs = data.observation;
    var base = data.baseline;

    function show(value) {
      return value === null || value === undefined ? dash :
          String(value);
    }

    setText(nodes.dDate, data.localDate);
    setText(nodes.dObs, obs.status.replace(/_/g, ' '));
    setText(nodes.dAssets, show(obs.sourceAssetCount));
    setText(nodes.dProducts, show(obs.distinctProductCount));
    setText(nodes.dOrbits, show(obs.distinctOrbitCount));
    var qualityQualifiers = [];
    if (obs.nonNominalProductCount) {
      qualityQualifiers.push(obs.nonNominalProductCount +
          ' non-NOMINAL');
    }
    if (obs.unknownProductQualityCount) {
      qualityQualifiers.push(obs.unknownProductQualityCount +
          ' unknown');
    }
    setText(nodes.dQuality, obs.productQualityStatus.replace(/_/g, ' ') +
        (qualityQualifiers.length ?
            ' (' + qualityQualifiers.join(', ') + ')' : ''));
    setText(nodes.dProj,
        obs.projectionCompatibilityStatus.replace(/_/g, ' '));
    setText(nodes.dBaseline, base.status.replace(/_/g, ' '));
    var median = fmtSci(base.historicalMedianNo2);
    setText(nodes.dMedian, median === null ? dash :
        median + ' ' + data.dataset.unit);
    setText(nodes.dSamples, show(base.historicalSampleCount));
    setText(nodes.dReqYears, show(joinYears(base.requestedPriorYears)));
    setText(nodes.dContribYears,
        show(joinYears(base.contributingPriorYears)));
  }

  function renderWarnings() {
    var box = nodes.warnings;
    var a = state.analysis;
    box.innerHTML = '';
    if (a.status !== 'ready') { box.hidden = true; return; }
    var data = a.data;
    var items = [];

    if (data.observation.hasNonNominalContributors) {
      items.push('Non-NOMINAL contributors: ' +
          data.observation.nonNominalProductCount +
          ' contributing product(s) carry an explicit ' +
          'PRODUCT_QUALITY other than NOMINAL. Values are retained ' +
          'and flagged, never excluded.');
    }
    if (data.observation.unknownProductQualityCount) {
      items.push('Unknown product quality: ' +
          data.observation.unknownProductQualityCount +
          ' contributing product(s) carry no PRODUCT_QUALITY ' +
          'metadata. Unknown quality is reported as unknown — it is ' +
          'not counted as non-NOMINAL — and the products are ' +
          'retained.');
    }
    if (data.observation.projectionCompatibilityStatus ===
        'incompatible') {
      items.push('Projection incompatibility: this date’s source ' +
          'grid failed the canonical-lattice compatibility rule' +
          (data.observation.projectionCompatibilityDetail ?
              ' (' + data.observation.projectionCompatibilityDetail +
              ')' : '') +
          '. Regional statistics and the anomaly map are withheld by ' +
          'design rather than silently computed on a different grid.');
    }
    if (data.baseline.status === 'partial_window') {
      items.push('Baseline unavailable: the previous-three-year ' +
          'same-calendar-month window is structurally partial ' +
          '(contributing years: ' +
          (joinYears(data.baseline.contributingPriorYears) || 'none') +
          '). The daily value and coverage remain; the historical ' +
          'median, anomaly, and percentile are unavailable — not zero.');
    }
    if (data.map.warning) {
      items.push('Map: ' + data.map.warning);
    }

    if (!items.length) { box.hidden = true; return; }
    items.forEach(function (text) {
      var p = document.createElement('p');
      p.textContent = text;
      box.appendChild(p);
    });
    box.hidden = false;
  }

  /* ------------------------------------------------------ DATA LOADING */

  function setStatusMessage(text) {
    state.statusMessage = text;
  }

  /*
   * Step 2–3 of the page-load flow: /api/context populates dataset,
   * region, availability, and the date-picker bounds/default. The
   * frontend never assumes "today" is available — the backend's last
   * included local date is authoritative.
   */
  function loadContext() {
    var token = ++contextToken;
    state.context = {status: 'loading', data: null, message: null};
    setStatusMessage('Loading dataset context from the backend…');
    render();

    var holder = {controller: new AbortController(), timedOut: false};
    fetchJson(CONFIG.backendOrigin + '/api/context',
        CONFIG.contextTimeoutMs, holder)
        .then(function (result) {
          if (token !== contextToken) return;
          if (result.httpStatus === 200 && result.body &&
              result.body.ok) {
            state.context = {status: 'ready', data: result.body,
                             message: null};
            configureDatePicker(result.body);
            setStatusMessage('Context loaded. Loading the official ' +
                'boundary and the default date…');
            render();
            loadBoundary();
            loadAnalysis(result.body.availability.defaultLocalDate);
            return;
          }
          if (result.httpStatus === 503) {
            state.context = {status: 'ee_not_ready', data: null,
                message: errorMessageFrom(result,
                    'Earth Engine is not ready.')};
            setStatusMessage('The backend is up, but its Earth Engine ' +
                'client is not ready. Retry shortly.');
          } else {
            state.context = {status: 'error', data: null,
                message: errorMessageFrom(result, 'Backend returned ' +
                    'HTTP ' + result.httpStatus + '.')};
            setStatusMessage('Could not load the dataset context: ' +
                state.context.message);
          }
          render();
        })
        .catch(function (error) {
          if (token !== contextToken) return;
          if (isAbortError(error) && !holder.timedOut) return;
          state.context = {
            status: holder.timedOut ? 'timeout' : 'unreachable',
            data: null,
            message: String(error && error.message || error)
          };
          setStatusMessage(holder.timedOut ?
              'The context request timed out.' :
              'The backend could not be reached.');
          render();
          console.warn('[context] failed:', state.context.message);
        });
  }

  function configureDatePicker(context) {
    var input = nodes.dateInput;
    input.min = context.dataset.collectionStartLocalDate;
    input.max = context.availability.lastIncludedLocalDate;
    // Keep a user's already-chosen date across context retries; only
    // seed the default when the input is empty or out of range.
    if (!input.value || input.value < input.min ||
        input.value > input.max) {
      input.value = context.availability.defaultLocalDate;
    }
  }

  /* Step 4–5: /api/boundary → the official BAAQMD GeoJSON layer. */
  function loadBoundary() {
    var token = ++boundaryToken;
    state.boundary = {status: 'loading', message: null};
    render();

    var holder = {controller: new AbortController(), timedOut: false};
    fetchJson(CONFIG.backendOrigin + '/api/boundary',
        CONFIG.boundaryTimeoutMs, holder)
        .then(function (result) {
          if (token !== boundaryToken) return;
          if (result.httpStatus === 200 && result.body &&
              result.body.ok && result.body.geojson) {
            setBoundaryLayer(result.body.geojson);
            state.boundary = {status: 'ready', message: null};
            setStatusMessage('Official boundary loaded.');
          } else {
            state.boundary = {status: 'unavailable',
                message: errorMessageFrom(result, 'the backend ' +
                    'returned HTTP ' + result.httpStatus)};
            setStatusMessage('The official boundary is unavailable.');
          }
          render();
        })
        .catch(function (error) {
          if (token !== boundaryToken) return;
          if (isAbortError(error) && !holder.timedOut) return;
          state.boundary = {
            status: holder.timedOut ? 'timeout' : 'unavailable',
            message: String(error && error.message || error)
          };
          setStatusMessage('The official boundary could not be ' +
              'loaded.');
          render();
          console.warn('[boundary] failed:', state.boundary.message);
        });
  }

  /*
   * Step 6–7: /api/analysis?date=… for the default date, then for any
   * user-selected supported date. An older in-flight request is
   * aborted when a new date is requested; the token guarantees a late
   * response can never overwrite the current selection.
   */
  function loadAnalysis(dateStr) {
    if (state.context.status !== 'ready') return;

    var token = ++analysisToken;
    if (analysisRequest) analysisRequest.controller.abort();
    var holder = {controller: new AbortController(), timedOut: false};
    analysisRequest = holder;

    state.analysis = {status: 'loading', data: null, message: null,
                      requestedDate: dateStr};
    // Date-changing state: the previous date's anomaly tiles come off
    // the map immediately — no stale layer may sit under a "loading"
    // message that describes a different date.
    removeAnomalyLayer();
    setStatusMessage('Loading analysis for ' + dateStr + '…');
    render();

    fetchJson(CONFIG.backendOrigin + '/api/analysis?date=' +
        encodeURIComponent(dateStr), CONFIG.analysisTimeoutMs, holder)
        .then(function (result) {
          if (token !== analysisToken) return;
          applyAnalysisResult(dateStr, result);
          render();
        })
        .catch(function (error) {
          if (token !== analysisToken) return;
          if (isAbortError(error) && !holder.timedOut) return;
          removeAnomalyLayer();
          state.analysis = {
            status: holder.timedOut ? 'timeout' : 'unreachable',
            data: null,
            message: String(error && error.message || error),
            requestedDate: dateStr
          };
          setStatusMessage(holder.timedOut ?
              'The analysis request for ' + dateStr + ' timed out.' :
              'The backend could not be reached for ' + dateStr + '.');
          render();
          console.warn('[analysis] failed:', state.analysis.message);
        });
  }

  function applyAnalysisResult(dateStr, result) {
    var status = result.httpStatus;
    var body = result.body;

    if (status === 200 && body && body.ok) {
      state.analysis = {status: 'ready', data: body, message: null,
                        requestedDate: dateStr};
      if (body.map.status === 'available' && body.map.tileUrlTemplate) {
        // Remove the prior date's layer, then add the new one — the
        // anomaly layer is never stacked.
        setAnomalyLayer(body.map);
      } else {
        // Any unavailable state removes stale tiles immediately.
        removeAnomalyLayer();
      }
      setStatusMessage('Analysis loaded for ' + body.localDate + '.');
      return;
    }

    removeAnomalyLayer();
    var mapped;
    if (status === 400) mapped = 'invalid_date';
    else if (status === 422) mapped = 'out_of_range';
    else if (status === 503) mapped = 'ee_not_ready';
    else if (status === 502) mapped = 'upstream_error';
    else if (status === 504) mapped = 'upstream_timeout';
    else mapped = 'error';
    state.analysis = {
      status: mapped,
      data: null,
      message: errorMessageFrom(result,
          'Backend returned HTTP ' + status + '.'),
      requestedDate: dateStr
    };
    setStatusMessage('Analysis for ' + dateStr + ' unavailable: ' +
        analysisStateText());
  }

  /* ------------------------------------------------------ INTERACTION */

  function onLoadClicked() {
    var value = nodes.dateInput.value;
    if (!DATE_RE.test(value)) {
      state.analysis = {status: 'invalid_date', data: null,
          message: 'Enter a complete date as YYYY-MM-DD.',
          requestedDate: value || null};
      removeAnomalyLayer();
      setStatusMessage('The selected date is not a valid date.');
      render();
      return;
    }
    var ctx = state.context.data;
    if (ctx && (value < ctx.dataset.collectionStartLocalDate ||
        value > ctx.availability.lastIncludedLocalDate)) {
      state.analysis = {status: 'out_of_range', data: null,
          message: 'Supported local dates run from ' +
              ctx.dataset.collectionStartLocalDate + ' to ' +
              ctx.availability.lastIncludedLocalDate +
              ' (the newest represented date is conservatively ' +
              'excluded).',
          requestedDate: value};
      removeAnomalyLayer();
      setStatusMessage('The selected date is outside the supported ' +
          'range.');
      render();
      return;
    }
    loadAnalysis(value);
  }

  function wireEvents() {
    nodes.loadButton.addEventListener('click', onLoadClicked);
    nodes.dateInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !nodes.loadButton.disabled) {
        onLoadClicked();
      }
    });
    nodes.retryContext.addEventListener('click', loadContext);
    nodes.retryBoundary.addEventListener('click', loadBoundary);
    nodes.retryAnalysis.addEventListener('click', function () {
      var date = state.analysis.requestedDate || nodes.dateInput.value;
      if (date) loadAnalysis(date);
    });
  }

  /* ------------------------------------------------------------- INIT */

  function init() {
    render();
    initMap();
    wireEvents();
    loadContext();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
