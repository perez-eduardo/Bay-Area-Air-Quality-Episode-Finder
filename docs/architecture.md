# Architecture

The application has a Railway-hosted frontend and a Railway-hosted
backend API. The backend calls Google Earth Engine, which performs the
geospatial processing. Both services are deployed and were verified
against live Earth Engine data on 2026-07-20: the backend at
<https://api.neuralnetworks.me> and the frontend at
<https://airquality.neuralnetworks.me>. The public application is a
one-date prototype: no episode classification exists, and daily-series
and episode criteria remain future work.

## Components and data flow

```text
Browser
  → Railway frontend (static public UI)
  → Railway backend/API (orchestration; Earth Engine authentication; caching)
  → Google Earth Engine (geospatial processing)
  → statistics, map layers/tiles, and geospatial results
```

Division of responsibilities:

- Google Earth Engine performs the geospatial processing:
  ImageCollection filtering, daily compositing, spatial reductions, and
  baseline/anomaly image generation, following the documented
  processing rules (analysis/display separation, explicit projections;
  see [methodology.md](methodology.md)).
- The Railway backend (`app/backend/`) exposes the public API
  (`/api/context`, `/api/boundary`, `/api/analysis?date=YYYY-MM-DD`),
  authenticates to Earth Engine with a service account (public users do
  not need Earth Engine accounts), and holds bounded in-memory caches.
  Routes, schemas, caching, and timeouts are documented in
  `app/backend/README.md`.
- The Railway frontend (`app/frontend/`) serves the static one-date UI.
  It holds no credentials and never calls Earth Engine directly; the
  browser calls the backend API. Behavior is documented in
  `app/frontend/README.md`.
- The GitHub repository holds documentation, exploration scripts, and
  the application code under `app/`.
- R notebooks under `analysis/` provide supporting analysis and
  validation. They are not part of the app runtime.

The frontend/backend boundary is defined semantically in
[ui-data-contract.md](ui-data-contract.md): the backend is the
authority for date availability and for null/status semantics, and the
frontend presents those concepts without reconstructing Earth Engine
rules.

## Decisions

Owner decisions to date:

- Railway hosts the complete public application (2026-07-18). The
  earlier plan, a Railway landing page linking to a separately
  published Earth Engine App, is no longer the planned architecture and
  remains only a possible fallback.
- Study region: the official BAAQMD jurisdiction, from the ingested
  Earth Engine asset
  `projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries`
  filtered to `Air_Distri == "BAY AREA AQMD"` (details and a provenance
  TODO in [data-sources.md](data-sources.md)).
- First dataset: Sentinel-5P OFFL tropospheric NO₂
  (`COPERNICUS/S5P/OFFL/L3_NO2`).
- Production regional-statistics method (2026-07-20): the canonical
  native-lattice regional calculation, selected after the full-history
  08b daily audit. The legacy EPSG:3310 / 7000 m reduction is an
  exploration/reference method (decision, verified results, and scope
  limits in [methodology.md](methodology.md)).
- Public map display method (2026-07-20): the primary layer is the
  signed Sentinel-5P tropospheric NO₂ column anomaly, served through
  normal Earth Engine map tiles (full specification in
  [methodology.md](methodology.md)). This is a display decision only;
  it does not decide the episode spatial-extent analysis grid.
- UI data contract adopted (2026-07-20); see
  [ui-data-contract.md](ui-data-contract.md).
- First-slice implementation choices (2026-07-20, revisitable by the
  owner): Node's built-in `http` module for both services (no
  Express/Fastify/TypeScript), a no-build frontend in plain browser
  JavaScript, vendored Leaflet 1.9.4 with an OpenStreetMap basemap, no
  database (bounded in-memory caches only), one local calendar date at
  a time, and no episode classification.
- Frontend hostname: `airquality.neuralnetworks.me` (live; the origin
  is present in the backend's `ALLOWED_ORIGINS` variable).
- DNS: AWS Route 53 (the project owner's domain is managed there).
- Exploration scripts (`earthengine/exploration/`) are Earth Engine
  Code Editor JavaScript prototypes and remain the scientific
  references. The first slice implements the decided subset of that
  processing in `app/backend/analysis.js`; the scripts themselves are
  unchanged.
- R is the supporting analysis/validation layer; Python may be added
  later for supporting analysis. Neither is the app runtime.

Still open (owner decisions; not to be chosen by coding assistants):

- Final frontend and backend frameworks. The current no-framework
  implementation is retained for this slice, not fixed as architecture.
- Precomputation design and whether any later phase needs persistent
  storage. The in-memory caches do not survive restarts and do not
  remove the multi-minute cold-cache cost of a first analysis.
- Episode spatial-extent analysis grid and spatial-extent methodology.
- Remaining datasets (reanalysis, ground monitors); candidates only
  (see [data-sources.md](data-sources.md)).
- Episode thresholds, persistence rules, and spatial-extent rules (see
  [methodology.md](methodology.md)).

## Deployment (live, 2026-07-20)

Railway project `bay-area-air-quality-episode`, environment
`production`, region US West, with two services:

| Service | Root directory | Custom domain |
| --- | --- | --- |
| `backend` | `app/backend` | `api.neuralnetworks.me` |
| frontend | `app/frontend` | `airquality.neuralnetworks.me` |

- Auto-deploy from GitHub `main` is enabled for both services: a push
  to `main` redeploys them.
- Root directories are required because neither `package.json` is at
  the repository root.
- The generated
  `bay-area-air-quality-episode-finder-production.up.railway.app`
  domain also works for the backend.
- Custom domains are CNAME records in Route 53 with Railway
  domain-verification TXT records; TLS is provided by Railway.
  Unrelated records in the zone are out of scope for this
  documentation.

### Earth Engine service-account authentication

- Google Cloud project: `thematic-carver-502603-k5` (Earth Engine API
  enabled).
- Service account:
  `baaqef-backend@thematic-carver-502603-k5.iam.gserviceaccount.com`.
- IAM roles on the live account: **Earth Engine Resource Writer**
  (required for map/tile creation; `earthengine.maps.create` was denied
  until this role was granted on 2026-07-20), **Earth Engine Resource
  Viewer**, and **Service Usage Consumer** (required for project use;
  Earth Engine initialization failed with a project-use permission
  error until it was added).
- Credentials: the service-account JSON key is injected through the
  Railway variable `EE_SERVICE_ACCOUNT_KEY`. `EE_PROJECT_ID` is not
  set; the backend defaults to `thematic-carver-502603-k5`.
- The key is kept outside the repository and has never been committed;
  `.gitignore` blocks key-shaped JSON filenames. Key contents and local
  key paths are never documented.

### Verified live behavior

Observation, baseline, Earth Engine map creation, and tile rendering
were verified against real Earth Engine data after deployment
(2026-07-20). Observed timings: a cold analysis takes about a minute;
warm analysis-cache responses are sub-second; the first tile of a fresh
map can take roughly 30 seconds to render. The legacy `/api/ee-check`
infrastructure proof endpoint is retained unchanged.

## Performance and precomputation

The bounded in-memory caches (context about 5 minutes; successful
analyses per date, max 20 entries, about 1 hour each; boundary and
region area for the process lifetime) make repeat requests fast but do
not survive restarts. Expensive reusable results may later be produced
through Earth Engine batch exports and stored as Earth Engine assets,
for example precomputed quality-controlled daily regional values with
valid-area fractions and product traceability. Precomputation is a
planned option, not a commitment, and has not been designed. The slow
dynamically stretched layers observed in exploration script 06
(2026-07-18) are part of the motivation.

## Earth Engine's role vs. external retrieval-level analysis

The Earth Engine Level-3 collection is suitable for exploration, broad
maps, temporal summaries, preliminary anomaly work, and the public
evidence layer. A more rigorous retrieval-level workflow may eventually
require official Level-2 or RPRO files processed outside Earth Engine
in the supporting analysis layer, because the Level-3 collection may
not expose all retrieval diagnostics (original `qa_value`,
per-retrieval precision, averaging kernels, air-mass factors,
cloud/a-priori detail; to be audited against the current catalog before
any field is declared absent; see [data-sources.md](data-sources.md)).
External Level-2 ingestion is a recorded possibility, not a commitment.

## Development approach

The project owner makes design, architecture, scientific-method, and
interpretation decisions. Coding assistants work only under human
direction (implementation, refactoring, UI layout, comments,
documentation drafts, fixing errors) and must not invent scientific
claims, thresholds, datasets, methodology, interpretation, or
official-sounding conclusions.
