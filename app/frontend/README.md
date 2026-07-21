# Frontend service (public UI)

Live (2026-07-20) at <https://airquality.neuralnetworks.me>, consuming
the backend at <https://api.neuralnetworks.me>. The UI is a one-date
public prototype: it analyzes one Bay Area local calendar date at a
time against the backend API (`/api/context`, `/api/boundary`,
`/api/analysis`), draws the official BAAQMD boundary, and displays the
signed Sentinel-5P tropospheric NO₂ column-anomaly layer (tiles clipped
server-side to the official boundary) with a backend-supplied legend.
It presents the backend's null/status semantics exactly
(`docs/ui-data-contract.md`): a null scientific value is never rendered
as zero, and nothing here fabricates data, thresholds, or layers. No
feature classifies air-quality episodes; daily-series and episode
criteria remain future work.

## Stack decision (delegated 2026-07-19; retained 2026-07-20)

`docs/architecture.md` lists the frontend framework and the map library
as open final decisions. The project owner delegated both to the coding
assistant (2026-07-19) and retained the current choices for this slice
(2026-07-20). The owner can overturn either one.

### No framework, no build step

The UI is plain browser JavaScript, HTML, and CSS. There is no React,
no bundler, and no compile step. Reasons, in the order they mattered:

1. The deployed artifact is the source. Nothing served here is
   generated, minified, or transpiled, so the shipped frontend can be
   read directly.
2. The state problem is small: a handful of controls and display
   panels. A framework's main value (reconciling large component trees)
   does not apply here, while its costs (toolchain, dependency churn,
   build reproducibility) do.
3. Longevity. This is a long-running project, and a dependency-free
   frontend still runs unchanged in five years.
4. Continuity with the existing code. `public/app.js` uses the same
   control-flow pattern as exploration scripts 02-06: a single `state`
   cache, a `render()` that redraws only from that cache, and per-phase
   request tokens that make stale asynchronous results harmless.

### Leaflet for the map

Vendored at `public/vendor/leaflet/` (v1.9.4, BSD-2-Clause, license
included). Earth Engine's `getMapId` produces XYZ raster tile URLs,
which is what Leaflet's `L.tileLayer` consumes. Leaflet has no
dependencies of its own and needs no API key. It is vendored rather
than CDN-loaded so the application keeps working without third-party
runtime dependencies. OpenStreetMap is the basemap.

### Still open

The charting approach for a future daily-series view is not decided
(this prototype has no series); the binding requirement remains that
missing days render as gaps and are never interpolated.

## What this service does

A dependency-free static file server (`server.js`). It holds no
credentials, performs no processing, and never calls Earth Engine. The
browser calls the backend service directly; this service only ships
files. The single piece of server-side templating substitutes
`BACKEND_ORIGIN` into `index.html` at request time. The paths `/about`
and `/about.html` serve the same application shell; the About panel is
a native `<dialog>` on the main page, opened by the About link.

## Page flow (public/app.js)

1. Render the shell and the OpenStreetMap basemap.
2. `GET /api/context` fills the dataset strip, the freshness note, and
   the date picker's min/max/default. The backend's last included local
   date is authoritative; the UI never assumes today is available.
3. `GET /api/boundary` draws the official BAAQMD GeoJSON outline (drawn
   once, fitted once, replaced rather than duplicated on retry; no
   county fallback is ever drawn).
4. `GET /api/analysis?date=<default>` runs automatically, then on
   demand via the single date input and the Load date button.

Fixed (read-only) parameters in this slice: indicator "Tropospheric NO₂
column", map layer "Signed column anomaly", baseline "Previous three
same-calendar years".

### Request safety

An older in-flight analysis request is aborted when a new date is
requested. A monotonically increasing token per phase guarantees a late
response can never overwrite the current selection. The Load button is
disabled while a request is active, the selected date stays visible
during loading, and context, boundary, and analysis failures each get a
Retry control.

Timeout budget: the browser's outer timeouts (context 70 s, boundary
100 s, analysis 600 s) are deliberately longer than the backend's own
bounds (60 s, 90 s, and 540 s worst case; see
`app/backend/README.md`), so the browser never gives up while the
backend is still within its own budget. Cold-cache analyses may take
minutes; only repeat requests are fast.

### Map layer lifecycle

One boundary layer reference and one anomaly tile layer reference. A
new successful date replaces the anomaly layer (never stacked). Every
unavailable/error/date-changing state removes stale anomaly tiles and
clears the legend immediately. The basemap and boundary are never
removed, and the boundary outline is kept above the raster.

Scientific raster opacity is a single named configuration value, 0.45
(`CONFIG.scientificRasterOpacity`), applied to every scientific raster
layer; the signed column anomaly is currently the only one. Basemap and
boundary-line opacity are unaffected.

Tile-rendering states: attaching an Earth Engine tile URL to Leaflet is
not yet a displayed layer, because the first tile can take tens of
seconds to render server-side. The layer state is driven by real
Leaflet tile events with a generation token (events from a removed
layer are inert): *rendering* ("Rendering anomaly tiles…") until the
first `tileload`; *displayed* after it; *partial* when `tileerror`
occurs after at least one successful tile (loaded tiles are retained);
*failed* when errors arrive before any tile succeeds.

Legend: one continuous CSS `linear-gradient` built from the backend
`paletteStops` (evenly distributed 0-100 %; no color is hardcoded or
invented client-side), the exact backend min and max, and a zero marker
at the ramp midpoint (the backend range is symmetric, so 50 % is zero).
An uninterpretable backend palette produces a legend-unavailable
message without blocking the tiles. The per-date-stretch and cross-date
caveats are stated once, in the "About this layer" block, not repeated
under the legend.

Display-only raster smoothing (owner-directed 2026-07-20): the anomaly
layer rides a dedicated Leaflet pane carrying a CSS `blur()` whose
radius tracks the on-screen size of one native 0.01° cell at the
current zoom (factor 1.5, clamped 4-12 px, updated on `zoomend`), so
cell edges render as a continuous field without implying detail finer
than the source grid. This is purely a browser rendering effect: tiles,
backend data values, statistics, and the visualization stretch are
untouched, and the basemap and boundary panes are unaffected. The
oversampling disclosure lives in the "About this layer" block. Known
cosmetic limit: the blur softens the clipped edge by a few pixels
around the boundary line.

### Implemented UI states

Loading context; backend unavailable; Earth Engine not ready; boundary
loading/unavailable; analysis loading; available observation with
complete baseline and map; available observation with structurally
partial baseline; low valid-area fraction (displayed as-is; no hidden
cutoff exists); no products; products but no valid retrieval;
non-NOMINAL contributors (flagged, value retained); projection
incompatible; visualization unavailable; date outside the supported
range; request timeout; and the tile-rendering lifecycle (rendering /
displayed / partial / failed). Null values render as a placeholder dash
with the scientific reason, never as 0.

## Tests

`npm test` runs `ui-harness.test.js`, a Node `node:test` harness that
drives the real `public/app.js` with stubbed DOM/Leaflet/fetch and
asserts the map lifecycle: the 0.45 raster opacity, the dedicated
anomaly pane with its zoom-scaled display-only blur (and the basemap
pane untouched), tileload/tileerror states, stale-layer and
stale-legend removal on date changes, removed-layer event isolation,
the single-scientific-layer rule, boundary-above-raster, the
continuous-gradient legend, the legend-unavailable state for an
uninterpretable palette, and null-never-zero rendering. No browser or
network is involved.

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
the "Earth Engine not ready" state with a retry control; with a
credentialed backend it loads the default date automatically.

## Deploy on Railway

This is the second service in the existing Railway project, beside
`backend`: Root Directory `app/frontend`, variable
`BACKEND_ORIGIN=https://api.neuralnetworks.me`, custom domain
`airquality.neuralnetworks.me`, auto-deployed from GitHub `main`.

The frontend origin is present in the backend's `ALLOWED_ORIGINS`
Railway variable. That variable replaces the code defaults when set,
and the backend grants cross-origin browser access by allowlist; a
frontend on an unlisted origin would load but show the backend as
unreachable.

## Accessibility

Skip link, visible keyboard focus on every control, labelled form
fields, an `aria-label` on the map region, an ARIA live region
(`role="status"`) for asynchronous state changes, fixed parameters
rendered as read-only values instead of inert controls,
`prefers-reduced-motion` respected, and a layout that reflows to a
single column below 940 px. Color is never the only carrier of meaning:
status is stated in words.
