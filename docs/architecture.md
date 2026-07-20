# Architecture (decided; backend infrastructure live, application not built)

Planned components and how they fit together. The public-application
architecture below is an owner decision (2026-07-18). The **backend
infrastructure — a proof of connection — is implemented and running**
(live-tested 2026-07-19/20; details below). The frontend, the
scientific/production API endpoints, caching, production processing,
and the public UI are **not** implemented.

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

**Completed since (implementation facts, 2026-07-19/20 — moved out of
the open list; details in the implemented-backend section below):**

- Earth Engine backend authentication: service-account authentication
  is implemented and working (public users do not need their own Earth
  Engine accounts).
- Backend readability of the official BAAQMD boundary asset: verified
  live through the backend credentials.
- Backend repository placement: `app/backend/` (the intended future
  frontend sibling is `app/frontend/`, not yet created).
- Railway backend deployment configuration: configured and running.
- API custom domain: `api.neuralnetworks.me` connected with TLS.

**Still open** (owner decisions, marked TODO here and in the other
docs; none may be chosen by coding assistants):

- Frontend framework and stack — not chosen (no framework, React or
  otherwise, is decided)
- Backend framework — not chosen (the proof service deliberately uses
  only Node's built-in `http` module; that is an infrastructure proof,
  not a framework decision)
- Map library for the public UI — not chosen
- Caching and precomputation design; whether any database is used —
  not chosen
- Production backend API endpoint design — TODO (the three proof
  endpoints below are not the application API)
- Frontend hostname — not chosen (the API hostname is live; the
  public-facing frontend name remains an owner decision)
- How the exploration scripts' processing logic is reorganized into
  backend modules — not started
- Remaining datasets (reanalysis, ground monitors) — candidates only
  until evaluated and approved (see [data-sources.md](data-sources.md))
- All methodological criteria, including the final daily compositing
  rule and the final analysis scale (see
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
- `app/frontend/` — the intended future frontend sibling; **not yet
  created**.
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

### Still not implemented

Frontend service, framework, and hostname; the production scientific
API endpoints; the map/chart UI and map library;
caching/precomputation; any database; reorganization of the
exploration scripts' processing into backend modules; public-app
testing. These remain the open owner decisions listed above.

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
  above); the production API, caching, and the entire frontend remain
  future work.
- **GitHub repository.** Documentation, exploration scripts, and the
  application code under `app/` (backend implemented at
  `app/backend/`; `app/frontend/` is the intended future sibling).
- **R notebook(s) (`analysis/`).** Supporting analysis and validation,
  not the app runtime.

### Earth Engine exploration scripts (`earthengine/`)

Exploration scripts 01–06 remain the scientific reference for the
processing the public application will expose: study-region handling,
the accepted working daily rule, quality flagging, and the exploratory
baseline/anomaly method (see `earthengine/README.md` and
[methodology.md](methodology.md)). Their processing logic may later be
reorganized into reusable Earth Engine/backend modules; that migration
has not started, and nothing in the hosting decision changes the
documented scientific methods.

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

The application code lives under `app/`: the backend service exists at
`app/backend/` (the running proof of connection described above), and
`app/frontend/` is the intended future sibling for the public UI (not
yet created). The `landing-page/` directory holds superseded planning
notes from the earlier landing-page-only plan; it is **not** the
application location. A simple landing or entry page may still exist
later as part of the application.

### Hosting and access

- Railway — the complete public application (the backend service is
  deployed and running; the frontend is future work)
- Google Earth Engine — the geospatial processing engine, called by the
  Railway backend (service-account authentication working)
- AWS Route 53 — DNS (the project owner's domain is managed there; the
  API hostname `api.neuralnetworks.me` is live)
- The previously planned separately published Earth Engine App is no
  longer the final public architecture; it remains a possible fallback
  only.

TODO: frontend hostname choice; production API endpoint design;
frontend framework and deployment.

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
