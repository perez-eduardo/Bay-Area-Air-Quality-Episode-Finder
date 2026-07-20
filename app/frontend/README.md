# Railway frontend — public UI

**Status: frontend proof of connection.** The interface shell is built
and wired to the backend's infrastructure status endpoint. No analysis
runs, no scientific values are displayed, and no map data layer is
loaded, because the production API does not exist yet.

## Stack decision (delegated, 2026-07-19)

`docs/architecture.md` lists the frontend framework and the map library
as open owner decisions. The project owner **explicitly delegated both
to the coding assistant** in the session of 2026-07-19. They are
recorded here as delegated decisions, and the owner can overturn either
one.

### No framework, no build step

The UI is plain browser JavaScript, HTML, and CSS. There is no React,
no bundler, and no compile step. Reasons, in the order they mattered:

1. **The deployed artifact is the source.** A project whose stated
   purpose is that its reasoning can be inspected should ship a
   frontend that can be read directly. Nothing served here is
   generated, minified, or transpiled from something else.
2. **The state problem is small.** The dashboard has roughly ten
   controls and five display panels. A framework's core value —
   reconciling large component trees — does not apply, while its costs
   (toolchain, dependency churn, build reproducibility) do.
3. **Longevity.** This is a deliberately long-running project. A
   dependency-free frontend still builds and runs in five years; a
   toolchain of that age usually does not without archaeology.
4. **Continuity with the existing code.** `app/frontend/public/app.js`
   uses the same control-flow pattern as exploration scripts 02–06: a
   single `state` cache, a `render()` that redraws only from that cache,
   and a request token that makes stale asynchronous results harmless.
   One reading of the pattern now covers the scientific scripts and the
   UI alike.

**What would justify revisiting this:** the evidence panel growing into
genuinely nested, independently-updating components, or a second
developer joining who is more productive in a framework. Neither is
true today.

### Leaflet for the map

Vendored at `public/vendor/leaflet/` (v1.9.4, BSD-2-Clause, license
included). Reasons:

1. Earth Engine's `getMapId` produces **XYZ raster tile URLs**, which is
   exactly what Leaflet's `L.tileLayer` consumes. A vector-first library
   would be solving a problem this project does not have.
2. **Zero dependencies of its own** (`npm install leaflet` adds exactly
   one package), and no API key or billing account, unlike the Google
   Maps JavaScript API used in Earth Engine's own examples.
3. Stable for over a decade, with a small and well-documented surface.

It is vendored rather than loaded from a CDN so the application has no
third-party runtime dependency and keeps working if a CDN does not.

### Still open

The charting approach is **not** decided. It becomes a real decision
when the production API can supply a daily series; the binding
requirement is exact control over missing days, which must render as
gaps and never be interpolated.

## What this service does

A dependency-free static file server (`server.js`). It holds no
credentials, performs no processing, and never calls Earth Engine. The
browser calls the backend service directly; this service only ships
files.

The single piece of server-side templating substitutes `BACKEND_ORIGIN`
into `index.html` at request time, so the API origin is an environment
setting rather than a value baked into client code — without
introducing a build step.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `PORT` | Listen port (Railway injects it; local default 8081) |
| `BACKEND_ORIGIN` | Origin of the backend API (default `https://api.neuralnetworks.me`) |

## Run locally

Start the backend first (see `app/backend/README.md`), then:

```powershell
cd E:\Personal_projects\Bay-Area-Air-Quality-Episode-Finder\app\frontend
$env:BACKEND_ORIGIN = "http://localhost:8080"
npm start
```

Open <http://localhost:8081>. The instrument strip fills in from the
backend; the map shows a basemap with no data layer, and says so.

## Deploy on Railway

This is the **second** service in the existing Railway project, beside
`backend`.

1. In the Railway project, add a service from the same GitHub repo.
2. Set **Root Directory** to `app/frontend`.
3. Set the variable `BACKEND_ORIGIN` to `https://api.neuralnetworks.me`.
4. Generate a domain, or attach the chosen frontend hostname (still an
   open owner decision; the apex and `www` of `neuralnetworks.me` are
   already in use by another site).

**Required after the frontend origin exists:** add that origin to the
backend's `ALLOWED_ORIGINS` variable. The backend grants cross-origin
browser access by allowlist, not by wildcard, so a frontend on an
unlisted origin will load but show the backend as unreachable.

## Accessibility and quality floor

Skip link, visible keyboard focus on every control, labelled form
fields, an `aria-label` on the map region, `prefers-reduced-motion`
respected, and a layout that reflows to a single column below 940 px.
Colour is never the only carrier of meaning: status is stated in words.
