/*
 * Bay Area Air Quality Episode Finder — public UI.
 *
 * STAGE: frontend proof of connection. The shell is wired to the
 * backend's infrastructure status endpoint only. No analysis runs here,
 * no scientific value is computed or displayed, and no map data layer
 * is loaded — the production API does not exist yet.
 *
 * Structure deliberately mirrors exploration scripts 02–06: a single
 * `state` cache, a `render()` that redraws purely from that cache, and a
 * request token that makes stale asynchronous results harmless. Keeping
 * the app's control flow identical to the scientific scripts means one
 * reading of the pattern covers both.
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

    // Bay Area view for the basemap. A convenient map view only: it is
    // not the study-region boundary, which is defined by the official
    // BAAQMD asset and is not drawn until the API can supply it.
    mapCenter: [37.75, -122.15],
    mapZoom: 8,

    statusTimeoutMs: 20000
  };

  /* ------------------------------------------------------------- STATE */

  // Single source of truth for everything rendered. Never read the DOM
  // to discover application state.
  var state = {
    status: 'checking',   // checking | ok | degraded | unreachable
    detail: null,
    product: null,
    region: null,
    latestLocalDate: null,
    publicationLagDays: null,
    boundaryReadable: null,
    collectionReachable: null
  };

  // Guards against out-of-order responses if a check is ever re-issued.
  var requestToken = 0;

  /* --------------------------------------------------------- ELEMENTS */

  function el(id) { return document.getElementById(id); }

  var nodes = {
    product: el('i-product'),
    region: el('i-region'),
    latest: el('i-latest'),
    lag: el('i-lag'),
    backend: el('i-backend'),
    mapState: el('mapState')
  };

  /* --------------------------------------------------------- HELPERS */

  // Whole days between two 'YYYY-MM-DD' local dates. ISO date strings
  // parse as UTC midnight, so this is calendar-day arithmetic and is
  // unaffected by the browser's timezone.
  function dayGap(fromDate, toDate) {
    var a = Date.parse(fromDate);
    var b = Date.parse(toDate);
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  function todayUtcDateString() {
    var now = new Date();
    var m = now.getUTCMonth() + 1;
    var d = now.getUTCDate();
    return now.getUTCFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' +
        (d < 10 ? '0' + d : d);
  }

  function setCell(node, text, className) {
    if (!node) return;
    node.textContent = text;
    node.className = 'ival' + (className ? ' ' + className : '');
  }

  /* ---------------------------------------------------------- RENDER */

  // Redraws every status-dependent element from `state`. Safe to call at
  // any time; calling it twice produces the same result.
  function render() {
    setCell(nodes.product, state.product || 'unavailable',
        state.product ? '' : 'pending');
    setCell(nodes.region, state.region || 'unavailable',
        state.region ? '' : 'pending');
    setCell(nodes.latest, state.latestLocalDate || 'unavailable',
        state.latestLocalDate ? '' : 'pending');

    if (state.publicationLagDays === null) {
      setCell(nodes.lag, 'unavailable', 'pending');
    } else {
      setCell(nodes.lag, state.publicationLagDays + ' d', 'flagged');
    }

    if (state.status === 'checking') {
      setCell(nodes.backend, 'checking…', 'pending');
    } else if (state.status === 'ok') {
      setCell(nodes.backend, 'reachable', 'good');
    } else if (state.status === 'degraded') {
      setCell(nodes.backend, 'degraded', 'bad');
    } else {
      setCell(nodes.backend, 'unreachable', 'bad');
    }

    if (nodes.mapState) {
      nodes.mapState.textContent = mapStateText();
    }
  }

  // Empty and failure states are directions, not apologies: each says
  // what is true and what would change it.
  function mapStateText() {
    if (state.status === 'unreachable') {
      return 'Basemap only. The backend could not be reached, so no ' +
          'study-region or data layer can be drawn.';
    }
    if (state.status === 'degraded') {
      return 'Basemap only. The backend responded but its Earth Engine ' +
          'checks did not pass; no layer is drawn.';
    }
    return 'Basemap only — no data layer is loaded. The study-region ' +
        'boundary and analysis layers appear here once the production ' +
        'API is built.';
  }

  /* -------------------------------------------------- BACKEND STATUS */

  /*
   * Reads the backend's infrastructure proof endpoint and records what
   * it reports. This is a connectivity and provenance check only: it
   * returns no scientific values, and the UI presents none.
   *
   * The publication lag is derived here rather than read from the
   * backend, and it is exactly what it says — the gap in calendar days
   * between today and the newest local date represented in the
   * collection. It is not a statement about valid Bay Area data on that
   * date.
   */
  function checkBackend() {
    var token = ++requestToken;
    state.status = 'checking';
    render();

    var controller = typeof AbortController !== 'undefined' ?
        new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, CONFIG.statusTimeoutMs);

    fetch(CONFIG.backendOrigin + '/api/ee-check', {
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('Backend returned HTTP ' + response.status);
      }
      return response.json();
    }).then(function (body) {
      if (token !== requestToken) return; // superseded
      clearTimeout(timer);

      state.product = body.collection && body.collection.id ?
          body.collection.id.replace('COPERNICUS/', '') : null;
      state.region = body.boundary && body.boundary.readable ?
          'BAAQMD jurisdiction' : null;
      state.boundaryReadable = body.boundary ? body.boundary.readable : null;
      state.collectionReachable =
          body.collection ? body.collection.reachable : null;
      state.latestLocalDate = body.collection ?
          body.collection.latestRepresentedLocalDate : null;
      state.publicationLagDays = state.latestLocalDate ?
          dayGap(state.latestLocalDate, todayUtcDateString()) : null;
      state.status = body.ok ? 'ok' : 'degraded';
      state.detail = null;
      render();
    }).catch(function (error) {
      if (token !== requestToken) return;
      clearTimeout(timer);
      state.status = 'unreachable';
      state.detail = String(error && error.message || error);
      render();
      // Surfaced for developers; the interface states the condition
      // plainly without echoing internals at the reader.
      console.warn('[status] backend check failed:', state.detail);
    });
  }

  /* -------------------------------------------------------------- MAP */

  /*
   * Basemap only. No study-region outline and no analysis layer are
   * drawn, because both must come from the documented BAAQMD asset
   * through the backend, and that API does not exist yet. Drawing an
   * approximate outline here would contradict the project's own rule
   * that the county approximation is a clearly labelled fallback, never
   * a silent substitute.
   */
  function initMap() {
    if (typeof L === 'undefined' || !el('map')) return;
    var map = L.map('map', {
      center: CONFIG.mapCenter,
      zoom: CONFIG.mapZoom,
      scrollWheelZoom: false   // avoids hijacking page scroll
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    // Keyboard users can still zoom; the control is focusable.
    L.control.scale({imperial: true, metric: true}).addTo(map);
  }

  /* ------------------------------------------------------------- INIT */

  function init() {
    render();
    initMap();
    checkBackend();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
