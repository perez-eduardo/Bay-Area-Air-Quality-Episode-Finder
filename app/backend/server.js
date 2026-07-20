/*
 * Bay Area Air Quality Episode Finder
 * Railway backend — Earth Engine PROOF OF CONNECTION (first deployment
 * target, owner-decided 2026-07-19).
 *
 * Purpose: INFRASTRUCTURE ONLY. Verifies that the decided architecture's
 * pipe works end to end:
 *   Railway backend → service-account authentication → Google Earth
 *   Engine → a trivial response back out as JSON.
 * It performs NO scientific processing: no composites, no regional
 * statistics, no baselines, no anomalies, no thresholds, and no episode
 * logic. The two Earth Engine calls it makes are cheap metadata queries
 * (a filtered feature count and a property aggregation) chosen only to
 * prove (a) the service account can read the official BAAQMD boundary
 * asset — required by docs/architecture.md before public deployment —
 * and (b) the Sentinel-5P OFFL collection is reachable.
 *
 * Framework note: the backend FRAMEWORK is still an open owner decision
 * (docs/architecture.md), so this proof deliberately uses only Node's
 * built-in http module. Nothing here locks in Express, Fastify, or any
 * other choice.
 *
 * Authentication (per the official Earth Engine npm guide):
 *   - Node.js supports server-side service-account auth only:
 *     ee.data.authenticateViaPrivateKey(key, success, error) followed by
 *     ee.initialize(null, null, success, error, null, projectId).
 *   - The private key is read from an environment variable or a file
 *     path environment variable — NEVER from the repository. Repo
 *     .gitignore already blocks *credentials*.json and .env*.
 *
 * Environment variables:
 *   PORT                        - listen port (Railway injects this).
 *   EE_PROJECT_ID               - Google Cloud project ID registered for
 *                                 Earth Engine. Defaults to the boundary
 *                                 asset's project.
 *   EE_SERVICE_ACCOUNT_KEY      - the service-account JSON key, pasted
 *                                 verbatim (Railway variables handle
 *                                 multi-line values). Preferred on
 *                                 Railway.
 *   EE_SERVICE_ACCOUNT_KEY_FILE - path to the JSON key file. Convenient
 *                                 for local runs; keep the file OUTSIDE
 *                                 the repository directory.
 * If both are set, EE_SERVICE_ACCOUNT_KEY wins. If neither is set, the
 * server still boots and reports "not_configured" so a misconfigured
 * deploy is diagnosable from the outside.
 *
 * Endpoints:
 *   GET /            - service description.
 *   GET /healthz     - liveness + current Earth Engine client state.
 *   GET /api/ee-check - the proof of connection (503 until EE is ready).
 *
 * Project docs: https://github.com/perez-eduardo/Bay-Area-Air-Quality-Episode-Finder
 */

'use strict';

var http = require('http');
var fs = require('fs');
var ee = require('@google/earthengine');

/* ------------------------------------------------------------------ CONFIG */

var CONFIG = {
  port: Number(process.env.PORT) || 8080,

  // Google Cloud project ID passed to ee.initialize(). Default: the
  // project that holds the boundary asset (owner-advised choice for the
  // proof of connection; override with EE_PROJECT_ID).
  eeProjectId: process.env.EE_PROJECT_ID || 'thematic-carver-502603-k5',

  // Official BAAQMD jurisdiction boundary (docs/data-sources.md). The
  // proof verifies the service account can READ this asset; it does not
  // process it.
  boundaryAssetId:
      'projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries',
  boundaryField: 'Air_Distri',
  boundaryValue: 'BAY AREA AQMD',

  // First dataset (owner-decided; docs/data-sources.md). Only a property
  // aggregation is run against it here.
  collectionId: 'COPERNICUS/S5P/OFFL/L3_NO2',

  // Local calendar convention used across the project.
  timeZone: 'America/Los_Angeles',

  // Upper bound for one diagnostic Earth Engine round trip.
  eeCallTimeoutMs: 60000,

  /*
   * Browser origins permitted to read this API cross-origin. The
   * frontend is a separate Railway service on a different origin, so
   * the browser requires an explicit grant. An allowlist is used rather
   * than a wildcard: these endpoints are public and unauthenticated
   * today, but a wildcard would silently keep granting access to any
   * origin if authenticated or rate-limited endpoints are added later.
   * Extra origins can be supplied through ALLOWED_ORIGINS as a
   * comma-separated list.
   */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ||
      'https://neuralnetworks.me,https://www.neuralnetworks.me')
      .split(',')
      .map(function (value) { return value.trim(); })
      .filter(function (value) { return value.length > 0; })
      .concat(['http://localhost:8081', 'http://127.0.0.1:8081'])
};

// Fixed language for every response. Careful-claims policy
// (docs/methodology.md): this endpoint returns infrastructure
// diagnostics only.
var PURPOSE_NOTE =
    'Infrastructure proof of connection only. No scientific processing, ' +
    'statistics, baselines, anomalies, thresholds, or episode logic runs ' +
    'here, and nothing in this response is an air-quality result.';

/* ---------------------------------------------------- EARTH ENGINE CLIENT */

/*
 * Earth Engine client state machine. The server always boots; the state
 * tells callers exactly where authentication stands:
 *   not_configured - no key material provided;
 *   authenticating - authenticateViaPrivateKey in flight;
 *   initializing   - ee.initialize in flight;
 *   ready          - client usable;
 *   error          - authentication or initialization failed (message
 *                    retained; the key itself is never echoed).
 */
var eeState = {
  status: 'not_configured',
  detail: 'No service-account key provided. Set EE_SERVICE_ACCOUNT_KEY ' +
      '(JSON contents) or EE_SERVICE_ACCOUNT_KEY_FILE (path).',
  since: new Date().toISOString()
};

function setEeState(status, detail) {
  eeState = {status: status, detail: detail, since: new Date().toISOString()};
  console.log('[ee] ' + status + (detail ? ' — ' + detail : ''));
}

// Reads the key from the environment. Returns the parsed key object or
// null. Never logs or returns key contents; parse failures report only
// the failure class.
function readServiceAccountKey() {
  var raw = null;
  var source = null;
  if (process.env.EE_SERVICE_ACCOUNT_KEY) {
    raw = process.env.EE_SERVICE_ACCOUNT_KEY;
    source = 'EE_SERVICE_ACCOUNT_KEY';
  } else if (process.env.EE_SERVICE_ACCOUNT_KEY_FILE) {
    source = 'EE_SERVICE_ACCOUNT_KEY_FILE';
    try {
      raw = fs.readFileSync(process.env.EE_SERVICE_ACCOUNT_KEY_FILE, 'utf8');
    } catch (readError) {
      setEeState('error', 'Could not read the key file at ' +
          'EE_SERVICE_ACCOUNT_KEY_FILE (' + readError.code + ').');
      return null;
    }
  } else {
    return null; // stays not_configured
  }
  try {
    var key = JSON.parse(raw);
    if (!key.client_email || !key.private_key) {
      setEeState('error', 'The value from ' + source + ' parsed as JSON ' +
          'but does not look like a service-account key (missing ' +
          'client_email or private_key).');
      return null;
    }
    return key;
  } catch (parseError) {
    setEeState('error', 'The value from ' + source + ' is not valid JSON.');
    return null;
  }
}

// Server-side auth + init, per the official npm guide (async callbacks
// only; no synchronous Earth Engine calls anywhere in this server).
function startEarthEngine() {
  var key = readServiceAccountKey();
  if (key === null) return;

  setEeState('authenticating',
      'Authenticating as ' + key.client_email + '.');
  ee.data.authenticateViaPrivateKey(key, function () {
    setEeState('initializing',
        'Initializing with project ' + CONFIG.eeProjectId + '.');
    ee.initialize(null, null, function () {
      setEeState('ready', 'Authenticated as ' + key.client_email +
          '; project ' + CONFIG.eeProjectId + '.');
    }, function (initError) {
      setEeState('error', 'ee.initialize failed: ' + initError);
    }, null, CONFIG.eeProjectId);
  }, function (authError) {
    setEeState('error',
        'authenticateViaPrivateKey failed: ' + authError);
  });
}

/* ------------------------------------------------------- DIAGNOSTIC CALLS */

// Wraps one callback-style evaluate() in a Promise with a timeout. An
// Earth Engine evaluation cannot be cancelled; on timeout the caller
// just stops waiting and says so.
function evaluateWithTimeout(eeObject, label) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      resolve({ok: false, error: label + ' timed out after ' +
          CONFIG.eeCallTimeoutMs + ' ms (the request may still be ' +
          'running server-side).'});
    }, CONFIG.eeCallTimeoutMs);
    eeObject.evaluate(function (result, error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        resolve({ok: false, error: String(error)});
      } else {
        resolve({ok: true, value: result});
      }
    });
  });
}

/*
 * The proof of connection. Two independent cheap queries, run in
 * parallel and reported separately so a boundary-permission problem is
 * distinguishable from a collection-access problem:
 *   1) boundary  - count of features matching the BAAQMD filter in the
 *                  official boundary asset (verifies the service
 *                  account can READ the asset; expected count: 1).
 *   2) collection - the latest represented local calendar date in the
 *                  OFFL collection (property aggregation over
 *                  system:time_start, formatted in America/Los_Angeles;
 *                  global collection maximum, unfiltered — the same
 *                  cheap anchor style the exploration scripts use).
 */
function runEeCheck() {
  var boundaryCount = ee.FeatureCollection(CONFIG.boundaryAssetId)
      .filter(ee.Filter.eq(CONFIG.boundaryField, CONFIG.boundaryValue))
      .size();

  var latestLocalDate = ee.Date(
      ee.ImageCollection(CONFIG.collectionId)
          .aggregate_max('system:time_start'))
      .format('yyyy-MM-dd', CONFIG.timeZone);

  return Promise.all([
    evaluateWithTimeout(boundaryCount, 'Boundary-asset check'),
    evaluateWithTimeout(latestLocalDate, 'Collection check')
  ]).then(function (results) {
    var boundary = results[0];
    var collection = results[1];
    return {
      service: 'baaqef-backend',
      check: 'earth-engine-proof-of-connection',
      timestampUtc: new Date().toISOString(),
      eeProjectId: CONFIG.eeProjectId,
      boundary: {
        assetId: CONFIG.boundaryAssetId,
        filter: CONFIG.boundaryField + ' == "' + CONFIG.boundaryValue + '"',
        readable: boundary.ok,
        matchingFeatureCount: boundary.ok ? boundary.value : null,
        error: boundary.ok ? null : boundary.error
      },
      collection: {
        id: CONFIG.collectionId,
        reachable: collection.ok,
        latestRepresentedLocalDate: collection.ok ? collection.value : null,
        latestDateNote: 'Latest local calendar date (' + CONFIG.timeZone +
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

var server = http.createServer(function (req, res) {
  var path = req.url.split('?')[0];

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
      stage: 'proof of connection (no application features yet)',
      endpoints: ['/healthz', '/api/ee-check'],
      note: PURPOSE_NOTE,
      docs: 'https://github.com/perez-eduardo/' +
          'Bay-Area-Air-Quality-Episode-Finder'
    });
    return;
  }

  if (path === '/healthz') {
    // Liveness is about the HTTP process, so this is always 200; the
    // Earth Engine client state rides along for diagnosis.
    sendJson(res, 200, {status: 'ok', earthEngine: eeState});
    return;
  }

  if (path === '/api/ee-check') {
    if (eeState.status !== 'ready') {
      sendJson(res, 503, {
        error: 'Earth Engine client is not ready.',
        earthEngine: eeState,
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

  sendJson(res, 404, {error: 'Not found.',
                      endpoints: ['/', '/healthz', '/api/ee-check']});
});

/* -------------------------------------------------------------------- INIT */

server.listen(CONFIG.port, function () {
  console.log('[http] baaqef-backend listening on port ' + CONFIG.port);
  startEarthEngine();
});
