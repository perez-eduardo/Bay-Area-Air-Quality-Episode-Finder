/*
 * Bay Area Air Quality Episode Finder — Railway backend.
 * HTTP layer: startup, routing, CORS, response helpers, and Earth
 * Engine readiness gating. First vertical slice (2026-07-20).
 *
 * Module structure (kept deliberately small; Node's built-in http
 * module only — no Express/Fastify/TypeScript/database):
 *   server.js       — this file (HTTP, routing, CORS, error mapping)
 *   earth-engine.js — Earth Engine auth state machine + async
 *                     evaluate/getMap Promise wrappers with timeouts
 *   analysis.js     — dataset constants, boundary, date availability,
 *                     daily observation, baseline, anomaly map, caches
 *
 * Endpoints:
 *   GET /              service description
 *   GET /healthz       liveness + Earth Engine client state
 *   GET /api/ee-check  legacy infrastructure proof of connection
 *   GET /api/context   dataset/availability/region bootstrap
 *   GET /api/boundary  official BAAQMD boundary GeoJSON
 *   GET /api/analysis  one-local-date observation/baseline/anomaly map
 *
 * Behavior preserved from the proof-of-connection stage:
 *   - boots without credentials (/healthz reports not_configured);
 *   - no crash loop after authentication or Earth Engine failures;
 *   - service-account credentials only via environment variables/file
 *     paths, never in the repository and never echoed;
 *   - no synchronous Earth Engine requests in request handlers — all
 *     Earth Engine work goes through the async Promise wrappers in
 *     earth-engine.js, each with its own timeout.
 *
 * Project docs: https://github.com/perez-eduardo/Bay-Area-Air-Quality-Episode-Finder
 */

'use strict';

var http = require('http');
var eeClient = require('./earth-engine');
var analysis = require('./analysis');
var ee = eeClient.ee;

/* ------------------------------------------------------------------ CONFIG */

var CONFIG = {
  port: Number(process.env.PORT) || 8080,

  // Upper bound for one legacy diagnostic Earth Engine round trip.
  eeCheckTimeoutMs: 60000,

  /*
   * Browser origins permitted to read this API cross-origin. The
   * frontend is a separate Railway service on a different origin, so
   * the browser requires an explicit grant. An allowlist is used rather
   * than a wildcard: these endpoints are public and unauthenticated
   * today, but a wildcard would silently keep granting access to any
   * origin if authenticated or rate-limited endpoints are added later.
   * Extra origins can be supplied through ALLOWED_ORIGINS as a
   * comma-separated list. NOTE: when ALLOWED_ORIGINS is set (as it is
   * on Railway), it REPLACES the defaults below — the chosen frontend
   * origin must be added to the Railway variable once it exists.
   */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ||
      'https://neuralnetworks.me,https://www.neuralnetworks.me')
      .split(',')
      .map(function (value) { return value.trim(); })
      .filter(function (value) { return value.length > 0; })
      .concat(['http://localhost:8081', 'http://127.0.0.1:8081'])
};

// Fixed language for the legacy proof endpoint. Careful-claims policy
// (docs/methodology.md): that endpoint returns infrastructure
// diagnostics only.
var PURPOSE_NOTE =
    'Infrastructure proof of connection only. No scientific processing, ' +
    'statistics, baselines, anomalies, thresholds, or episode logic runs ' +
    'here, and nothing in this response is an air-quality result.';

var ENDPOINTS = ['/', '/healthz', '/api/ee-check', '/api/context',
                 '/api/boundary', '/api/analysis?date=YYYY-MM-DD'];

/* ---------------------------------------------------- LEGACY PROOF CHECK */

/*
 * The original proof of connection, retained unchanged in behavior:
 * two independent cheap queries, run in parallel and reported
 * separately so a boundary-permission problem is distinguishable from
 * a collection-access problem.
 */
function runEeCheck() {
  var C = analysis.CONSTANTS;
  var boundaryCount = ee.FeatureCollection(C.boundaryAssetId)
      .filter(ee.Filter.eq(C.boundaryField, C.boundaryValue))
      .size();

  var latestLocalDate = ee.Date(
      ee.ImageCollection(C.datasetId)
          .aggregate_max('system:time_start'))
      .format('yyyy-MM-dd', C.timeZone);

  function settle(promise, label) {
    return promise.then(function (value) {
      return {ok: true, value: value};
    }).catch(function (error) {
      return {ok: false, error: String(error && error.message || error)};
    });
  }

  return Promise.all([
    settle(eeClient.evaluate(boundaryCount, 'Boundary-asset check',
        CONFIG.eeCheckTimeoutMs)),
    settle(eeClient.evaluate(latestLocalDate, 'Collection check',
        CONFIG.eeCheckTimeoutMs))
  ]).then(function (results) {
    var boundary = results[0];
    var collection = results[1];
    return {
      service: 'baaqef-backend',
      check: 'earth-engine-proof-of-connection',
      timestampUtc: new Date().toISOString(),
      eeProjectId: eeClient.getProjectId(),
      boundary: {
        assetId: C.boundaryAssetId,
        filter: C.boundaryField + ' == "' + C.boundaryValue + '"',
        readable: boundary.ok,
        matchingFeatureCount: boundary.ok ? boundary.value : null,
        error: boundary.ok ? null : boundary.error
      },
      collection: {
        id: C.datasetId,
        reachable: collection.ok,
        latestRepresentedLocalDate: collection.ok ? collection.value : null,
        latestDateNote: 'Latest local calendar date (' + C.timeZone +
            ') represented in the collection, from a global ' +
            'system:time_start property aggregation. A represented date ' +
            'is not a statement about valid Bay Area data.',
        error: collection.ok ? null : collection.error
      },
      ok: boundary.ok && collection.ok,
      note: PURPOSE_NOTE
    };
  });
}

/* -------------------------------------------------------------- HTTP LAYER */

// Grants cross-origin read access to allowlisted browser origins only.
// Requests without an Origin header (curl, server-to-server, health
// probes) are unaffected: they never needed the grant.
function applyCors(req, res) {
  var origin = req.headers.origin;
  if (origin && CONFIG.allowedOrigins.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    // The response varies by request origin, so caches must key on it.
    res.setHeader('Vary', 'Origin');
  }
}

function sendJson(res, statusCode, body) {
  var payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

// Structured 503 for every Earth Engine-backed route while the client
// is not ready. The state detail makes a misconfigured deploy
// diagnosable from the outside without exposing key material.
function sendNotReady(res) {
  sendJson(res, 503, {
    ok: false,
    error: {
      code: 'ee_not_ready',
      message: 'The Earth Engine client is not ready.'
    },
    earthEngine: eeClient.getState()
  });
}

/*
 * Maps the structured errors thrown by earth-engine.js/analysis.js to
 * HTTP statuses:
 *   timeout  -> 504  (an Earth Engine round trip exceeded its budget)
 *   upstream -> 502  (Earth Engine / boundary / collection failure)
 *   anything else -> 500 (unexpected backend failure)
 * Never echoes credentials; messages come from the wrappers only.
 */
function sendUpstreamError(res, error) {
  var kind = error && error.isAppError ? error.kind : 'internal';
  var status = kind === 'timeout' ? 504 :
      kind === 'upstream' ? 502 : 500;
  var code = kind === 'timeout' ? 'upstream_timeout' :
      kind === 'upstream' ? 'upstream_error' : 'internal_error';
  sendJson(res, status, {
    ok: false,
    error: {
      code: code,
      message: String(error && error.message || error)
    }
  });
}

/* ----------------------------------------------------------- API ROUTES */

function handleContext(res) {
  if (!eeClient.isReady()) { sendNotReady(res); return; }
  analysis.getContext().then(function (context) {
    sendJson(res, 200, context);
  }).catch(function (error) {
    sendUpstreamError(res, error);
  });
}

function handleBoundary(res) {
  if (!eeClient.isReady()) { sendNotReady(res); return; }
  analysis.getBoundary().then(function (boundary) {
    sendJson(res, 200, boundary);
  }).catch(function (error) {
    sendUpstreamError(res, error);
  });
}

/*
 * GET /api/analysis?date=YYYY-MM-DD
 * Validation order (documented contract):
 *   400 — malformed date (not a real YYYY-MM-DD calendar date);
 *   422 — well-formed but before the collection start;
 *   503 — Earth Engine not ready (the upper range bound is
 *         backend-authoritative and needs Earth Engine);
 *   422 — after the current last included local date;
 *   200 — always, for supported dates: a scientifically unavailable
 *         date is a scientific status, never an HTTP error.
 * Timeout budget: worst case = contextTimeoutMs (60 s, only when the
 * context cache is cold) + analysisDeadlineMs (480 s, one overall
 * deadline clamping every analysis sub-operation) = 540 s. The
 * frontend's outer analysis timeout (600 s) is deliberately longer.
 */
function handleAnalysis(res, query) {
  var C = analysis.CONSTANTS;
  var date = query.get('date');
  if (!analysis._pure.isValidDateString(date)) {
    sendJson(res, 400, {
      ok: false,
      error: {
        code: 'malformed_date',
        message: 'The date parameter must be a valid YYYY-MM-DD ' +
            'local calendar date.'
      }
    });
    return;
  }
  if (date < C.collectionStartLocalDate) {
    sendJson(res, 422, {
      ok: false,
      error: {
        code: 'date_out_of_range',
        message: 'Dates before the collection start (' +
            C.collectionStartLocalDate + ') are not supported.'
      },
      supportedRange: {
        firstLocalDate: C.collectionStartLocalDate,
        lastIncludedLocalDate: null
      }
    });
    return;
  }
  if (!eeClient.isReady()) { sendNotReady(res); return; }

  // The upper bound comes from the same cached context the frontend
  // uses, so both sides always agree on the last included date.
  analysis.getContext().then(function (context) {
    var lastIncluded = context.availability.lastIncludedLocalDate;
    if (date > lastIncluded) {
      sendJson(res, 422, {
        ok: false,
        error: {
          code: 'date_out_of_range',
          message: 'The requested date is after the last included ' +
              'local date (' + lastIncluded + '). The newest ' +
              'represented date is conservatively excluded because ' +
              'its ingestion may still be partial.'
        },
        supportedRange: {
          firstLocalDate: C.collectionStartLocalDate,
          lastIncludedLocalDate: lastIncluded
        }
      });
      return;
    }
    return analysis.getAnalysis(date).then(function (body) {
      sendJson(res, 200, body);
    });
  }).catch(function (error) {
    sendUpstreamError(res, error);
  });
}

/* -------------------------------------------------------------- ROUTING */

var server = http.createServer(function (req, res) {
  var parsed = new URL(req.url, 'http://localhost');
  var path = parsed.pathname;

  applyCors(req, res);

  // Preflight: only simple GETs are served, but browsers may still ask.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, {error: 'Only GET is supported.'});
    return;
  }

  if (path === '/') {
    sendJson(res, 200, {
      service: 'baaqef-backend',
      project: 'Bay Area Air Quality Episode Finder',
      stage: 'first vertical slice: one-local-date observation, ' +
          'baseline, and anomaly-map API',
      endpoints: ENDPOINTS,
      disclaimer: analysis.CONSTANTS.scientificDisclaimer,
      docs: 'https://github.com/perez-eduardo/' +
          'Bay-Area-Air-Quality-Episode-Finder'
    });
    return;
  }

  if (path === '/healthz') {
    // Liveness is about the HTTP process, so this is always 200; the
    // Earth Engine client state rides along for diagnosis.
    sendJson(res, 200, {status: 'ok', earthEngine: eeClient.getState()});
    return;
  }

  if (path === '/api/ee-check') {
    if (!eeClient.isReady()) {
      sendJson(res, 503, {
        error: 'Earth Engine client is not ready.',
        earthEngine: eeClient.getState(),
        note: PURPOSE_NOTE
      });
      return;
    }
    runEeCheck().then(function (body) {
      sendJson(res, body.ok ? 200 : 502, body);
    }).catch(function (unexpected) {
      sendJson(res, 500, {
        error: 'Unexpected failure running the check: ' +
            String(unexpected && unexpected.message || unexpected),
        note: PURPOSE_NOTE
      });
    });
    return;
  }

  if (path === '/api/context') { handleContext(res); return; }
  if (path === '/api/boundary') { handleBoundary(res); return; }
  if (path === '/api/analysis') {
    handleAnalysis(res, parsed.searchParams);
    return;
  }

  sendJson(res, 404, {error: 'Not found.', endpoints: ENDPOINTS});
});

/* -------------------------------------------------------------------- INIT */

server.listen(CONFIG.port, function () {
  console.log('[http] baaqef-backend listening on port ' + CONFIG.port);
  eeClient.start();
});
