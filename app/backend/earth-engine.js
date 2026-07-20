/*
 * Bay Area Air Quality Episode Finder — Railway backend.
 * Earth Engine client module: authentication state machine plus the
 * asynchronous evaluate/getMap wrappers every route uses.
 *
 * Rules preserved from the proof-of-connection stage:
 *   - the server boots without credentials (state 'not_configured');
 *   - authentication/initialization failures set state, never crash;
 *   - the service-account key comes ONLY from environment variables or
 *     a file path in an environment variable, is never logged, and is
 *     never echoed in a response;
 *   - no synchronous Earth Engine requests anywhere: all server
 *     communication goes through the Promise wrappers below, each with
 *     its own timeout.
 */

'use strict';

var fs = require('fs');
var ee = require('@google/earthengine');

var CONFIG = {
  // Google Cloud project ID passed to ee.initialize(). Default: the
  // project that holds the boundary asset (owner-accepted default for
  // the proof of connection; override with EE_PROJECT_ID).
  projectId: process.env.EE_PROJECT_ID || 'thematic-carver-502603-k5'
};

/* ------------------------------------------------------------ STATE MACHINE */

/*
 * States: not_configured | authenticating | initializing | ready |
 * error. /healthz embeds this so a misconfigured deploy is diagnosable
 * from the outside.
 */
var state = {
  status: 'not_configured',
  detail: 'No service-account key provided. Set EE_SERVICE_ACCOUNT_KEY ' +
      '(JSON contents) or EE_SERVICE_ACCOUNT_KEY_FILE (path).',
  since: new Date().toISOString()
};

function setState(status, detail) {
  state = {status: status, detail: detail,
           since: new Date().toISOString()};
  console.log('[ee] ' + status + (detail ? ' — ' + detail : ''));
}

function getState() {
  return state;
}

function isReady() {
  return state.status === 'ready';
}

function getProjectId() {
  return CONFIG.projectId;
}

/* ------------------------------------------------------------- CREDENTIALS */

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
      raw = fs.readFileSync(process.env.EE_SERVICE_ACCOUNT_KEY_FILE,
          'utf8');
    } catch (readError) {
      setState('error', 'Could not read the key file at ' +
          'EE_SERVICE_ACCOUNT_KEY_FILE (' + readError.code + ').');
      return null;
    }
  } else {
    return null; // stays not_configured
  }
  try {
    var key = JSON.parse(raw);
    if (!key.client_email || !key.private_key) {
      setState('error', 'The value from ' + source + ' parsed as JSON ' +
          'but does not look like a service-account key (missing ' +
          'client_email or private_key).');
      return null;
    }
    return key;
  } catch (parseError) {
    setState('error', 'The value from ' + source +
        ' is not valid JSON.');
    return null;
  }
}

// Server-side auth + init, per the official npm guide (async callbacks
// only).
function start() {
  var key = readServiceAccountKey();
  if (key === null) return;

  setState('authenticating',
      'Authenticating as ' + key.client_email + '.');
  ee.data.authenticateViaPrivateKey(key, function () {
    setState('initializing',
        'Initializing with project ' + CONFIG.projectId + '.');
    ee.initialize(null, null, function () {
      setState('ready', 'Authenticated as ' + key.client_email +
          '; project ' + CONFIG.projectId + '.');
    }, function (initError) {
      setState('error', 'ee.initialize failed: ' + initError);
    }, null, CONFIG.projectId);
  }, function (authError) {
    setState('error',
        'authenticateViaPrivateKey failed: ' + authError);
  });
}

/* ------------------------------------------------------- ASYNC WRAPPERS */

/*
 * Structured errors carried through every rejection so the HTTP layer
 * can map them to a status code without string matching:
 *   kind 'timeout'  -> 504
 *   kind 'upstream' -> 502 (Earth Engine returned an error)
 *   kind 'internal' -> 500
 */
function makeError(kind, message) {
  return {isAppError: true, kind: kind, message: String(message)};
}

// Wraps one callback-style evaluate() in a Promise with a timeout. An
// Earth Engine evaluation cannot be cancelled; on timeout the caller
// just stops waiting and says so.
function evaluate(eeObject, label, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(makeError('timeout', label + ' timed out after ' +
          timeoutMs + ' ms (the request may still be running ' +
          'server-side).'));
    }, timeoutMs);
    try {
      eeObject.evaluate(function (result, error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(makeError('upstream', label + ': ' + error));
        } else {
          resolve(result);
        }
      });
    } catch (thrown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(makeError('internal', label + ': ' +
          (thrown && thrown.message || thrown)));
    }
  });
}

/*
 * Obtains a browser-usable Earth Engine tile URL template for an image
 * with visualization parameters. Uses the asynchronous
 * getMapId/getMap callback form; never exposes credentials — the tile
 * URL is the standard public Earth Engine tile endpoint for the
 * generated map ID.
 */
function getMapUrl(image, visParams, label, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(makeError('timeout', label + ' timed out after ' +
          timeoutMs + ' ms.'));
    }, timeoutMs);
    function done(mapInfo, error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error || !mapInfo) {
        reject(makeError('upstream', label + ': ' +
            (error || 'no map information returned')));
        return;
      }
      var url = mapInfo.urlFormat ||
          (mapInfo.tile_fetcher && mapInfo.tile_fetcher.url_format) ||
          null;
      if (!url) {
        reject(makeError('upstream', label +
            ': the map response contained no tile URL template.'));
        return;
      }
      resolve(url);
    }
    try {
      if (typeof image.getMapId === 'function') {
        image.getMapId(visParams, done);
      } else {
        image.getMap(visParams, done);
      }
    } catch (thrown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(makeError('internal', label + ': ' +
          (thrown && thrown.message || thrown)));
    }
  });
}

module.exports = {
  ee: ee,
  start: start,
  getState: getState,
  isReady: isReady,
  getProjectId: getProjectId,
  evaluate: evaluate,
  getMapUrl: getMapUrl,
  makeError: makeError
};
