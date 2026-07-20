# Architecture (decided; both services deployed and live-verified)

Planned components and how they fit together. The public-application
architecture below is an owner decision (2026-07-18). **Both services
are deployed and live (2026-07-20)**: the backend API
(`/api/context`, `/api/boundary`, `/api/analysis?date=`) at
<https://api.neuralnetworks.me> implementing the decided regional
statistic, baseline, and signed column-anomaly map, and the one-date
public frontend at <https://airquality.neuralnetworks.me> consuming
it. Observation, baseline, Earth Engine map creation, and live tiles
have been verified against real Earth Engine data. The public
application remains a **one-date prototype**: no episode
classification exists, and daily-series and episode criteria remain
future work.

## Decision status

**Decided** (owner decisions):

- **Railway hosts the complete public application** (decided
  2026-07-18): a Railway-hosted frontend and a Railway backend/API,
  with the backend calling Google Earth Engine. Google Earth Engine
  remains the **geospatial processing engine**. The previous plan — a
  Railway landing page linking to a separately published Earth Engine
  App — is **no longer the planned final architecture**; the Earth
  Engine App form remains only a possible fallback. The **backend half
  of this chain is implemented** as an infrastructure proof of
  connection (see the implemented-backend section below); the frontend
  and the production application are not.
- The exploration scripts (`earthengine/exploration/`, scripts 01–06)
  are written in the Earth Engine JavaScript API and developed and run
  through the Earth Engine Code Editor. They remain validated
  exploration/prototype scripts and scientific references; their
  processing logic may later be reorganized into reusable Earth
  Engine/backend modules (not started).
- R is the supporting analysis/validation layer; Python may be used
  later for supporting analysis or notebooks. Neither is the app
  runtime.
- DNS: AWS Route 53 (the project owner's domain is managed there).
- Study region: the official BAAQMD jurisdiction, from the ingested
  Earth Engine asset
  `projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries`
  filtered to `Air_Distri == "BAY AREA AQMD"` (details and a provenance
  TODO in [data-sources.md](data-sources.md)).
- First dataset: Sentinel-5P OFFL tropospheric NO₂
  (`COPERNICUS/S5P/OFFL/L3_NO2`).
- Production regional-statistics method (2026-07-20): the canonical
  native-lattice regional calculation, selected after the completed
  full-history 08b daily audit; the legacy EPSG:3310 / 7000 m
  reduction is an exploration/reference method (decision, verified
  results, and scope limits in [methodology.md](methodology.md)).
- Public map DISPLAY method (2026-07-20): the primary layer is the
  signed **"Sentinel-5P tropospheric NO₂ column anomaly"** (target
  canonical-lattice daily composite minus the pixelwise
  same-calendar-month historical median under the adopted baseline
  policy; requires the complete prior-three-year window, with no
  silent raw-column fallback), served through normal Earth Engine map
  tiles with Web-Mercator display reprojection handled by tile
  rendering and no separate display aggregation (full specification,
  availability behavior, and required legend text in
  [methodology.md](methodology.md)). Display only — the
  episode-spatial-analysis grid is NOT decided by this.
- UI data contract (2026-07-20): the frontend/backend boundary is
  defined semantically in [ui-data-contract.md](ui-data-contract.md);
  endpoint paths and transport design remain open.

**Completed since (implementation facts, 2026-07-19/20 — moved out of
the open list; details in the implemented-backend section below):**

- Earth Engine backend authentication: service-account authentication
  is implemented and working (public users do not need their own Earth
  Engine accounts).
- Backend readability of the official BAAQMD boundary asset: verified
  live through the backend credentials.
- Backend repository placement: `app/backend/` (the frontend sibling
  `app/frontend/` now holds the in-progress UI shell).
- Railway backend deployment configuration: configured and running.
- API custom domain: `api.neuralnetworks.me` connected with TLS.

**Decided for the first vertical slice (owner, 2026-07-20)** — current
implementation choices, revisitable by the owner:

- Node's built-in `http` module for both services (no
  Express/Fastify/TypeScript); no-build frontend in plain browser
  JavaScript; vendored Leaflet 1.9.4 with the OpenStreetMap basemap;
  **no database** — bounded in-memory caches only; the UI analyzes
  one local calendar date at a time; the primary map layer is the
  signed Sentinel-5P tropospheric NO₂ column anomaly; no episode
  classification.
- API surface: `GET /api/context`, `GET /api/boundary`,
  `GET /api/analysis?date=YYYY-MM-DD` (no aliases or versioned
  paths), implementing the semantics in
  [ui-data-contract.md](ui-data-contract.md). Schemas are documented
  in `app/backend/README.md`.

**Still open** (owner decisions, marked TODO here and in the other
docs; none may be chosen by coding assistants):

- Final frontend framework/stack and map library — the slice retains
  the no-framework, vendored-Leaflet implementation; that remains a
  current implementation, not an immutable architecture requirement
- Final backend framework — the slice retains Node's built-in `http`
  module
- Precomputation design and whether any later phase needs persistent
  storage — the slice's bounded in-memory caches (context ~5 minutes;
  successful analyses per date, max 20, ~1 hour TTL; boundary and
  region area for the process lifetime) do not survive restarts and
  do not remove the multi-minute cold-cache cost of a first analysis
- Episode spatial-extent analysis grid and spatial-extent
  methodology — not chosen (the public map DISPLAY method is decided;
  neither the display nor the regional-statistics decision settles
  spatial-extent analysis)
- Frontend hostname — not chosen (the API hostname is live; the
  public-facing frontend name remains an owner decision). Once
  chosen, the exact frontend origin must be added to the backend's
  `ALLOWED_ORIGINS` Railway variable, which **overrides** the code
  defaults when set
- Remaining datasets (reanalysis, ground monitors) — candidates only
  until evaluated and approved (see [data-sources.md](data-sources.md))
- All remaining methodological criteria — episode thresholds,
  persistence rules, spatial-extent rules (see
  [methodology.md](methodology.md))

## Implemented backend infrastructure (2026-07-19/20)

The backend half of the decided architecture is implemented and running
as an infrastructure **proof of connection**, live-tested
2026-07-19/20. It performs no scientific processing and returns no
air-quality results; its only purpose is proving that the decided pipe
works end to end. The frontend and the scientific application API are
not built.

Request chain verified 2026-07-19/20:

```text
api.neuralnetworks.me
  → Railway service "backend"
  → Google Earth Engine
  → JSON response (infrastructure diagnostics only)
```

This is the backend half of the decided chain (browser → future Railway
frontend → Railway backend/API → Google Earth Engine).

### Repository placement

- `app/backend/` — the tracked backend service: `server.js`,
  `package.json`, `package-lock.json`, and a `README.md` with run and
  deploy instructions.
- `app/frontend/` — the frontend sibling; now holds the in-progress
  public UI shell (see the frontend status section below).
- Relevant commits: `9606a43` (backend proof of connection), `c896789`
  (`.gitignore` hardening against key-shaped JSON filenames).

### Railway deployment

- Project `bay-area-air-quality-episode`, environment `production`,
  service `backend`, region US West.
- Root Directory: `app/backend` — required because `package.json` is
  not at the repository root.
- Auto-deploy from GitHub `main` is enabled: **a push to `main`
  redeploys the backend**.
- Domains (both currently working): the generated
  `bay-area-air-quality-episode-finder-production.up.railway.app` and
  the custom `api.neuralnetworks.me`.

### Earth Engine service-account authentication

- Google Cloud project: `thematic-carver-502603-k5` (the Earth Engine
  API is enabled).
- Service account:
  `baaqef-backend@thematic-carver-502603-k5.iam.gserviceaccount.com`.
- Required IAM roles — **both** are required in this project:
  - **Earth Engine Resource Viewer**;
  - **Service Usage Consumer** — demonstrated required here: Earth
    Engine initialization failed with a project-use permission error
    until this role was added.
- Credentials: the service-account JSON key is injected through the
  Railway variable `EE_SERVICE_ACCOUNT_KEY`. `EE_PROJECT_ID` is
  currently not set; the backend defaults to
  `thematic-carver-502603-k5`.
- Security posture: the key is kept outside the repository and has
  never been committed; the repository `.gitignore` blocks key-shaped
  JSON filenames. Key contents and local key paths are never
  documented.

### Custom API domain and TLS (Route 53)

The `neuralnetworks.me` hosted zone is managed in AWS Route 53. The
API hostname `api.neuralnetworks.me` is implemented as a CNAME to
Railway with a Railway domain-verification TXT record; TLS is provided
by Railway. Unrelated records in the zone are out of scope for this
project's documentation, and the future **frontend hostname remains an
open owner decision**.

### Proof endpoints (infrastructure only)

Three GET endpoints exist: `/` (service description), `/healthz`
(liveness plus the Earth Engine client state), and `/api/ee-check`
(the proof of connection). Behavior:

- the server starts even without credentials; `/healthz` reports
  `not_configured` instead of causing a crash loop;
- `/api/ee-check` returns `503` until the Earth Engine client is
  ready;
- when ready, `/api/ee-check` runs two inexpensive metadata checks:
  (1) the official BAAQMD boundary asset can be read and its filter
  returns exactly one matching feature, and (2) the Sentinel-5P OFFL
  NO₂ collection is reachable and its latest represented local date
  can be aggregated;
- every response explicitly states that it is an infrastructure check,
  not an air-quality result. A represented collection date is **not**
  a statement about valid Bay Area data.

### Live verification snapshot (2026-07-19/20)

The proof was verified live: `ok: true`; the official BAAQMD boundary
was readable with `matchingFeatureCount: 1`; the Sentinel-5P
collection was reachable with `latestRepresentedLocalDate:
2026-07-10`. That date is a **verification-time snapshot**, not a
permanently current value; the observed roughly nine-day delay is
consistent
with OFFL publication latency, and it is not an air-quality result or
a valid-regional-data claim.

### Still not implemented or verified

The chart/daily-series UI; precomputation (cold analyses and first
Earth Engine tile rendering take noticeable time — live-observed
~1 minute and ~30 s respectively — while warm backend analysis-cache
responses are sub-second); rate limiting; episode classification of
any kind.

## First application slice — deployed API and UI (2026-07-20)

### Backend API (deployed at api.neuralnetworks.me)

`app/backend/` now implements the first production API surface on the
decided methods (canonical native-lattice regional statistic; adopted
three-year baseline; signed column-anomaly map with a per-date robust
display stretch):

- `GET /api/context` — dataset metadata, authoritative date
  availability (the newest represented local date is conservatively
  excluded; the last included date is the day before it), region, and
  method identifiers; cached ~5 minutes;
- `GET /api/boundary` — the official BAAQMD boundary as GeoJSON
  (dissolved; no county fallback; cached for the process lifetime);
- `GET /api/analysis?date=YYYY-MM-DD` — one-local-date observation,
  baseline comparison, and anomaly-map metadata with tile URL (the
  tile image is the anomaly clipped to the official BAAQMD boundary —
  display-only; statistics and visualization percentiles use the
  un-clipped image); successful responses cached in memory (max 20
  dates, ~1 hour TTL);
- structured errors: 400 malformed date; 422 outside the supported
  range; 503 Earth Engine not ready; 502 upstream failure; 504
  upstream timeout; 500 unexpected — while scientifically unavailable
  dates are HTTP 200 with explicit status fields;
- module structure: `server.js` (HTTP/routing/CORS/gating),
  `earth-engine.js` (auth state machine, async wrappers),
  `analysis.js` (constants, processing graphs, caches), plus
  `node:test` unit tests for the pure helpers. Full schemas in
  `app/backend/README.md`.

### Frontend (deployed at airquality.neuralnetworks.me)

`app/frontend/` implements the one-date public UI (scientific raster
opacity 0.45 via one named configuration value; anomaly tile status
follows real Leaflet tile events — "Rendering anomaly tiles…" until
the first tile actually loads; the legend is a continuous gradient
derived from backend palette metadata):

- page flow: context → boundary → automatic analysis of the backend's
  default date; a single `<input type="date">` bounded by the
  backend's collection start and last included date; one "Load date"
  action; indicator, map layer, and baseline method are fixed
  read-only parameters in this slice;
- the official boundary is drawn once and never duplicated on
  retries; the anomaly tile layer is replaced on success and removed
  on every unavailable/error state; the basemap is never removed; the
  legend renders exclusively from backend visualization metadata
  (exact min/zero/max, palette stops, per-date-stretch warning);
- null/status semantics per [ui-data-contract.md](ui-data-contract.md):
  null values render as em dashes with the scientific reason, never
  as zero; low-coverage values are shown with their coverage — no
  hidden cutoff; non-NOMINAL contributors produce a visible warning
  with the value retained; the daily-series and episode features are
  explicitly deferred/not implemented;
- request safety: per-phase request tokens, aborted stale requests,
  a disabled action button while loading, retry controls for context,
  boundary, and analysis failures, and an ARIA live region for
  asynchronous status.

## Semantic data boundary (backend is the authority)

The frontend/backend boundary is defined **semantically** in
[ui-data-contract.md](ui-data-contract.md) — response concepts, null
and status semantics, date-availability rules, labeling requirements,
and testable UI states. Endpoint paths, transport design, and payload
encodings remain open owner decisions. Two principles govern the
boundary:

- the **backend supplies authoritative date availability** — including
  the last included local date that conservatively excludes the newest
  represented date — and the frontend's date picker must consume it
  rather than assuming "today" is available;
- the **backend supplies authoritative null/status semantics** (no
  products; products but no valid retrieval; structurally partial
  baseline; upstream error) so the frontend never reconstructs Earth
  Engine rules, and a null scientific value is never converted to
  numeric zero.

## Components

Request flow of the decided public application:

```text
Browser
  → Railway-hosted frontend (public UI)
  → Railway backend/API (orchestration; Earth Engine authentication)
  → Google Earth Engine (geospatial processing engine)
  → statistics, map layers/tiles, and geospatial results
    (returned through the backend to the frontend)
```

Division of responsibilities:

- **Google Earth Engine — geospatial processing engine.** Performs the
  geospatial processing: ImageCollection filtering, daily compositing,
  spatial reductions, baseline/anomaly image generation, and other
  geospatial computation, following the documented processing rules
  (analysis/display separation, explicit scales; see
  [methodology.md](methodology.md)).
- **Railway application — public UI and orchestration.** Provides the
  public user interface, backend/API orchestration, authentication to
  Earth Engine (public users do not need their own Earth Engine
  accounts), loading and error states, caching, charts, legends,
  responsive layout, branding, and custom-domain hosting. Backend
  authentication and backend deployment are implemented (proof stage,
  above); the one-date API, in-memory caching, and one-date frontend
  are implemented and deployed (2026-07-20); charts and everything
  beyond one date at a time remain future work.
- **GitHub repository.** Documentation, exploration scripts, and the
  application code under `app/` (`app/backend/` and `app/frontend/`).
- **R notebook(s) (`analysis/`).** Supporting analysis and validation,
  not the app runtime.

### Earth Engine exploration scripts (`earthengine/`)

Exploration scripts 01–07 remain the scientific reference for the
processing the public application exposes: study-region handling,
the accepted working daily rule, quality flagging, and the exploratory
baseline/anomaly method (see `earthengine/README.md` and
[methodology.md](methodology.md)). The first vertical slice
(2026-07-20) implements the DECIDED subset of that processing in
`app/backend/analysis.js` (canonical native-lattice daily observation,
adopted baseline policy, signed column-anomaly map); the scripts
themselves are unchanged, and nothing in the hosting decision changes
the documented scientific methods.

The planned data-processing flow (raw Sentinel-5P collection →
calendar-day composites → analysis images → regional statistics and
later baseline/anomaly products → display images and UI layers) and the
strict separation between analysis processing and display processing
are documented in [methodology.md](methodology.md) and are unchanged by
the hosting decision.

The dashboard sections planned in the project overview — header,
control panel, main map, charts and evidence panel, methodology /
under-the-hood section, documentation links — now describe the future
Railway-hosted public UI.

### Analysis layer (`analysis/`)

Supporting analysis and validation, not the app runtime. R is the
planned first tool; Python may be used later for supporting analysis,
validation, or notebooks. Planned uses: data cleaning, exploratory
analysis, baseline calculation, episode-detection logic, model
evaluation (only if ML is ever added), and explanatory charts.

### Railway application (`app/`)

The application code lives under `app/`: `app/backend/` holds the API
service (first-slice routes implemented; the deployed Railway
instance still runs the earlier proof build), and `app/frontend/`
holds the one-date public UI slice (implemented; never deployed). The
`landing-page/` directory holds superseded planning notes from the
earlier landing-page-only plan; it is **not** the application
location. A simple landing or entry page may still exist later as part
of the application.

### Hosting and access

- Railway — the complete public application (the backend service is
  deployed and running the proof build; the first-slice backend and
  the frontend service are implemented in the repository but not
  deployed)
- Google Earth Engine — the geospatial processing engine, called by the
  Railway backend (service-account authentication working)
- AWS Route 53 — DNS (the project owner's domain is managed there; the
  API hostname `api.neuralnetworks.me` is live)
- The previously planned separately published Earth Engine App is no
  longer the final public architecture; it remains a possible fallback
  only.

TODO: frontend hostname choice (plus its `ALLOWED_ORIGINS` entry);
deployment of the first slice; final frontend framework decision.

## Earth Engine's role vs. external rigorous analysis

The Earth Engine Level-3 collection (interactive, in the app and Code
Editor) is suitable for: exploration; broad maps; temporal summaries;
preliminary anomaly detection; and a public interactive evidence layer.

A more rigorous retrieval-level workflow may eventually require official
Level-2 or RPRO files processed **outside** Earth Engine (in the
supporting analysis layer — R first, possibly Python later), because the
Level-3 collection may not expose all retrieval diagnostics (original
`qa_value`, per-retrieval precision, averaging kernels, air-mass factors,
cloud/a-priori detail — to be audited against the current catalog before
any field is declared absent; see [data-sources.md](data-sources.md)).
External Level-2 ingestion is **not** an immediate implementation
commitment — it is a recorded possibility, contingent on the audits in
[methodology.md](methodology.md).

## Performance and precomputation (planned)

Planned scalability posture. Precomputation is a **planned option**, not
a decision to implement immediately:

- Short exploratory date ranges may continue to be computed
  interactively.
- Multi-year calendar-day products, historical baselines, anomaly
  layers, and automatic episode scans may become too expensive for
  repeated interactive computation.
- Reusable expensive results may later be produced through Earth Engine
  **batch exports** and stored as **Earth Engine assets** — including
  possible future precomputed, quality-controlled daily assets (daily
  regional values with valid-area fractions and product traceability).
- The public application should consume lightweight, reusable products
  when needed to remain responsive. **Observed (script 06 live test,
  2026-07-18):** the dynamically stretched anomaly-detail and
  valid-day-count layers can render slowly — a nonblocking
  exploration-stage limitation that strengthens the need to evaluate
  caching and precomputation before the public application exposes this
  processing.
- The official BAAQMD boundary asset is readable by the backend's
  Earth Engine credentials — **verified live** through the deployed
  backend on 2026-07-19/20 (see the implemented-backend section
  above), satisfying this prerequisite for public deployment.

## Development approach

- The project owner makes design, architecture, scientific-method, and
  interpretation decisions.
- Coding assistance (Claude Code etc.) is used only under human direction, for
  implementation, refactoring, UI layout, comments, documentation drafts, and
  fixing errors.
- Coding assistance must not invent scientific claims, thresholds, datasets,
  methodology, interpretation, or official-sounding conclusions.
