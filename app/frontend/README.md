# Railway frontend — public UI

**Status: first vertical slice implemented in the repository
(2026-07-20); not yet deployed or public.** The UI analyzes **one Bay
Area local calendar date at a time** against the backend API
(`/api/context`, `/api/boundary`, `/api/analysis`), draws the official
BAAQMD boundary, and displays the signed Sentinel-5P tropospheric NO₂
column-anomaly layer with a backend-supplied legend. It presents the
backend's null/status semantics exactly (`docs/ui-data-contract.md`) —
a null scientific value is never rendered as zero, and nothing here
fabricates data, thresholds, or layers.

## Stack decision (delegated, 2026-07-19; retained 2026-07-20)

`docs/architecture.md` lists the frontend framework and the map library
as open final decisions. The project owner **explicitly delegated both
to the coding assistant** (2026-07-19) and retained the current choices
for this slice (2026-07-20). The owner can overturn either one.

### No framework, no build step

The UI is plain browser JavaScript, HTML, and CSS. There is no React,
no bundler, and no compile step. Reasons, in the order they mattered:

1. **The deployed artifact is the source.** A project whose stated
   purpose is that its reasoning can be inspected should ship a
   frontend that can be read directly. Nothing served here is
   generated, minified, or transpiled from something else.
2. **The state problem is small.** The dashboard has a handful of
   controls and display panels. A framework's core value —
   reconciling large component trees — does not apply, while its costs
   (toolchain, dependency churn, build reproducibility) do.
3. **Longevity.** This is a deliberately long-running project. A
   dependency-free frontend still builds and runs in five years; a
   toolchain of that age usually does not without archaeology.
4. **Continuity with the existing code.** `public/app.js` uses the
   same control-flow pattern as exploration scripts 02–06: a single
   `state` cache, a `render()` that redraws only from that cache, and
   per-phase request tokens that make stale asynchronous results
   harmless.

### Leaflet for the map

Vendored at `public/vendor/leaflet/` (v1.9.4, BSD-2-Clause, license
included). Earth Engine's `getMapId` produces XYZ raster tile URLs,
which is exactly what Leaflet's `L.tileLayer` consumes; Leaflet has no
dependencies of its own and needs no API key. It is vendored rather
than CDN-loaded so the application keeps working without third-party
runtime dependencies. OpenStreetMap remains the basemap.

### Still open

The charting approach for a future daily-series view is **not**
decided (this slice deliberately has no series); the binding
requirement remains that missing days render as gaps and are never
interpolated. The **frontend hostname** is an open owner decision, and
once chosen its exact origin must be added to the backend's
`ALLOWED_ORIGINS` Railway variable.

## What this service does

A dependency-free static file server (`server.js`). It holds no
credentials, performs no processing, and never calls Earth Engine. The
browser calls the backend service directly; this service only ships
files. The single piece of server-side templating substitutes
`BACKEND_ORIGIN` into `index.html` at request time.

## Page flow (public/app.js)

1. Render the shell and the OpenStreetMap basemap.
2. `GET /api/context` → dataset strip, freshness note, and the date
   picker's min/max/default. The backend's **last included local
   date** is authoritative — the UI never assumes today is available.
3. `GET /api/boundary` → the official BAAQMD GeoJSON outline (drawn
   once, fitted once, replaced — never duplicated — on retry; no
   county fallback is ever drawn).
4. `GET /api/analysis?date=<default>` automatically, then on demand
   via the single date input and the **Load date** button.

Fixed (read-only) parameters in this slice: indicator "Tropospheric
NO₂ column", map layer "Signed column anomaly", baseline "Previous
three same-calendar years".

### Request safety

An older in-flight analysis request is aborted when a new date is
requested; a monotonically increasing token per phase guarantees a
late response can never overwrite the current selection; the Load
button is disabled while a request is active; the selected date stays
visible during loading; context, boundary, and analysis failures each
get a Retry control.

**Timeout budget.** The browser's outer timeouts (context 70 s,
boundary 100 s, analysis 600 s) are deliberately longer than the
backend's own bounds (60 s, 90 s, and 540 s worst case — a 60 s
cold-context lookup plus the backend's 480 s overall analysis
deadline; see `app/backend/README.md`), so the browser never gives up
while the backend is still within its own budget. Cold-cache analyses
may legitimately take minutes; only repeat requests are fast.

### Map layer lifecycle

One boundary layer reference and one anomaly tile layer reference. A
new successful date replaces the anomaly layer (never stacked); every
unavailable/error state removes stale anomaly tiles; the basemap is
never removed. The legend renders exclusively from backend
visualization metadata (exact min, zero, max; palette stops; the
per-date-stretch warning; layer date and unit).

### Implemented UI states

Loading context; backend unavailable; Earth Engine not ready; boundary
loading/unavailable; analysis loading; available observation with
complete baseline and map; available observation with structurally
partial baseline; low valid-area fraction (displayed as-is — no hidden
cutoff exists); no products; products but no valid retrieval;
non-NOMINAL contributors (flagged, value retained); projection
incompatible; visualization unavailable; date outside the supported
range; request timeout. Null values render as an em dash with the
scientific reason — never as 0.

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

Open <http://localhost:8081>. Without backend credentials the UI shows
the truthful "Earth Engine not ready" state with a retry control; with
a credentialed backend it loads the default date automatically.

## Deploy on Railway

This is the **second** service in the existing Railway project, beside
`backend`.

1. In the Railway project, add a service from the same GitHub repo.
2. Set **Root Directory** to `app/frontend`.
3. Set the variable `BACKEND_ORIGIN` to `https://api.neuralnetworks.me`.
4. Generate a domain, or attach the chosen frontend hostname (still an
   open owner decision; the apex and `www` of `neuralnetworks.me` are
   already in use by another site).

**Required after the frontend origin exists:** add that exact origin
to the backend's `ALLOWED_ORIGINS` Railway variable. The variable
**replaces** the code defaults when set, and the backend grants
cross-origin browser access by allowlist — a frontend on an unlisted
origin will load but show the backend as unreachable.

## Accessibility and quality floor

Skip link, visible keyboard focus on every control, labelled form
fields, an `aria-label` on the map region, an ARIA live region
(`role="status"`) for asynchronous state changes, fixed parameters
rendered as read-only values instead of inert controls,
`prefers-reduced-motion` respected, and a layout that reflows to a
single column below 940 px. Colour is never the only carrier of
meaning: status is stated in words.
