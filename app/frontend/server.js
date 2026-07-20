/*
 * Bay Area Air Quality Episode Finder
 * Railway frontend service � static file server.
 *
 * Purpose: serve the public UI's static files. It performs no
 * processing, holds no credentials, and never calls Earth Engine. All
 * Earth Engine work happens in the backend service (app/backend/),
 * which the browser calls directly.
 *
 * No dependencies, by decision (see app/frontend/README.md): the
 * deployed artifact is the source, with no build step and nothing
 * generated, so what a reviewer reads in the repository is exactly what
 * runs in the browser.
 *
 * Environment variables:
 *   PORT            - listen port (Railway injects this; local default 8081).
 *   BACKEND_ORIGIN  - origin of the backend API, injected into the page at
 *                     request time so the origin is configurable per
 *                     environment instead of hardcoded in the client.
 *                     Default: https://api.neuralnetworks.me
 *
 * Project docs: https://github.com/perez-eduardo/Bay-Area-Air-Quality-Episode-Finder
 */

'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var CONFIG = {
  port: Number(process.env.PORT) || 8081,
  backendOrigin: process.env.BACKEND_ORIGIN || 'https://api.neuralnetworks.me',
  root: path.join(__dirname, 'public')
};

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// Resolves a URL path to a file inside CONFIG.root, or null when the
// path escapes the root (path traversal) or names nothing servable.
function resolveFile(urlPath) {
  var clean = decodeURIComponent(urlPath.split('?')[0]);
  if (clean === '/' || clean === '') clean = '/index.html';
  // The About panel is a dialog on the main page: both /about and the
  // legacy /about.html serve the application shell, and the client
  // opens the dialog when it sees those paths.
  if (clean === '/about' || clean === '/about.html') clean = '/index.html';
  var target = path.join(CONFIG.root, path.normalize(clean));
  var rootWithSep = CONFIG.root + path.sep;
  if (target !== CONFIG.root && target.indexOf(rootWithSep) !== 0) {
    return null; // escaped the served directory
  }
  return target;
}

/*
 * The one piece of server-side templating: the backend origin is
 * substituted into index.html at request time. This keeps the API
 * origin an environment setting rather than a value baked into client
 * code, without introducing a build step.
 */
function renderIndex(html) {
  return html.replace('__BACKEND_ORIGIN__', CONFIG.backendOrigin);
}

var server = http.createServer(function (req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Only GET is supported.');
    return;
  }

  // Liveness endpoint, mirroring the backend's, so both Railway
  // services can be checked the same way.
  if (req.url.split('?')[0] === '/healthz') {
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8',
                        'Cache-Control': 'no-store'});
    res.end(JSON.stringify({
      status: 'ok',
      service: 'baaqef-frontend',
      backendOrigin: CONFIG.backendOrigin
    }, null, 2));
    return;
  }

  var file = resolveFile(req.url);
  if (file === null) {
    res.writeHead(403, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Forbidden.');
    return;
  }

  fs.readFile(file, function (error, data) {
    if (error) {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end('Not found.');
      return;
    }
    var ext = path.extname(file).toLowerCase();
    var isIndex = ext === '.html';
    var body = isIndex ? Buffer.from(renderIndex(data.toString('utf8'))) : data;
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Vendored library files are immutable for a given version;
      // application files must not be cached while the UI is changing.
      'Cache-Control': file.indexOf('vendor') !== -1 ?
          'public, max-age=604800' : 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
});

server.listen(CONFIG.port, function () {
  console.log('[http] baaqef-frontend listening on port ' + CONFIG.port);
  console.log('[cfg]  backend origin: ' + CONFIG.backendOrigin);
});
