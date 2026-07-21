# Backend API service

Deployed and live-verified (2026-07-20) at
<https://api.neuralnetworks.me>. This service implements the first
production API surface: a one-local-date Sentinel-5P tropospheric NO₂
column observation, the adopted three-year baseline, and the signed
column-anomaly map metadata, following the decided methods in
`docs/methodology.md`. The public frontend consuming this API is live
at <https://airquality.neuralnetworks.me>. The application is a
one-date public prototype.

Nothing here classifies air-quality episodes, and nothing in any
response is an AQI value, a surface concentration, or health advice.

Decisions recorded here:

- Backend runtime: Node.js, built-in `http` module only (no
  Express/Fastify/TypeScript, no database); retained for this slice by
  owner decision (2026-07-20).
- Railway layout: two services, this backend plus the frontend
  (`app/frontend/`).
- Service-account Cloud project: `thematic-carver-502603-k5` (override
  with `EE_PROJECT_ID`).

## Module structure

| File | Responsibility |
| --- | --- |
| `server.js` | HTTP startup, routing, CORS allowlist, response helpers, Earth Engine readiness gating, error-to-status mapping |
| `earth-engine.js` | Earth Engine authentication state machine plus asynchronous `evaluate`/`getMap` Promise wrappers, each with its own timeout |
| `analysis.js` | Dataset constants, boundary, date availability, daily canonical-lattice observation, baseline, anomaly image and visualization, bounded in-memory caches |
| `helpers.test.js` | `node:test` unit tests for the pure helpers (`npm test`) |

No synchronous Earth Engine calls run in request handlers. Every Earth
Engine round trip goes through the async wrappers with an independent
timeout, and errors are structured (`timeout` gives 504, `upstream`
gives 502, unexpected gives 500).

## Endpoints

| Path | Purpose |
| --- | --- |
| `/` | Service description |
| `/healthz` | Liveness plus the Earth Engine client state (`not_configured` / `authenticating` / `initializing` / `ready` / `error`) |
| `/api/ee-check` | Legacy infrastructure proof of connection (retained unchanged) |
| `/api/context` | Bootstrap: dataset metadata, authoritative date availability, region, method identifiers |
| `/api/boundary` | The official BAAQMD boundary as GeoJSON |
| `/api/analysis?date=YYYY-MM-DD` | One-local-date observation, baseline comparison, and anomaly-map metadata |

All Earth Engine-backed routes return 503 with a structured
`ee_not_ready` body until the client is ready. The server always boots
without credentials and reports `not_configured` from `/healthz`.

### GET /api/context

```jsonc
{
  "ok": true,
  "dataset": {
    "id": "COPERNICUS/S5P/OFFL/L3_NO2",
    "band": "tropospheric_NO2_column_number_density",
    "label": "Sentinel-5P tropospheric NO₂ column",
    "unit": "mol/m²",
    "timezone": "America/Los_Angeles",
    "collectionStartLocalDate": "2018-06-28"
  },
  "availability": {
    "latestRepresentedLocalDate": "YYYY-MM-DD", // newest represented local date over BAAQMD
    "lastIncludedLocalDate": "YYYY-MM-DD",      // the day before it (conservative exclusion)
    "defaultLocalDate": "YYYY-MM-DD",           // equals lastIncludedLocalDate
    "freshnessNote": "…"
  },
  "region": { "id": "baaqmd", "label": "Bay Area Air Quality Management District", "boundaryAvailable": true },
  "methods": {
    "regionalStatistic": "canonical_native_lattice",
    "baseline": "previous_three_same_calendar_years_pooled_monthly_median",
    "mapLayer": "signed_column_anomaly"
  },
  "disclaimer": "…"
}
```

The newest represented date is conservatively excluded because its
ingestion may still be partial; the frontend must never assume "today"
is available. Cached about 5 minutes.

### GET /api/boundary

```jsonc
{
  "ok": true,
  "region": { "id": "baaqmd", "label": "…", "sourceAsset": "…", "filter": "Air_Distri == \"BAY AREA AQMD\"" },
  "geojson": { "type": "FeatureCollection", "features": [ … ] },
  "disclaimer": "…"
}
```

Only the official filtered asset is served (dissolved/unioned to a
stable outline). No county fallback exists in this API; a boundary-read
failure is a 502. Cached for the process lifetime.

### GET /api/analysis?date=YYYY-MM-DD

Validation: 400 malformed date; 422 well-formed but outside the
supported range (`collectionStartLocalDate` through
`lastIncludedLocalDate`); 503/502/504/500 for
readiness/upstream/timeout/unexpected failures. A scientifically
unavailable date is HTTP 200 with explicit status fields, never an HTTP
error.

```jsonc
{
  "ok": true,
  "localDate": "YYYY-MM-DD",
  "dataset": { "id": "…", "band": "…", "label": "…", "unit": "mol/m²", "timezone": "America/Los_Angeles" },
  "observation": {
    "status": "available | no_products | no_valid_retrieval | projection_incompatible",
    "hasValidValue": true,
    "regionalMeanNo2": 0.000063,        // null when unavailable, never 0
    "validAreaFraction": 0.8321,        // 0 for no_products / no_valid_retrieval; null when incompatible
    "sourceAssetCount": 14,             // footprint intersection is NOT contribution
    "distinctProductCount": 2,
    "distinctOrbitCount": 2,
    "hasNonNominalContributors": false,      // true only for explicit non-NOMINAL values
    "nonNominalProductCount": 0,             // explicit, present values other than "NOMINAL" only
    "unknownProductQualityCount": 0,         // contributing products with absent/null PRODUCT_QUALITY
    "productQualityStatus": "nominal | non_nominal | unknown",
    "projectionCompatibilityStatus": "compatible | incompatible | unknown",
    "projectionCompatibilityDetail": null
  },
  "baseline": {
    "status": "available | partial_window | target_unavailable | upstream_error",
    "requestedPriorYears": [2025, 2024, 2023],
    "contributingPriorYears": [2025, 2024, 2023],
    "historicalSampleCount": 93,
    "historicalMedianNo2": 0.000059,    // null on partial_window
    "signedAnomalyNo2": 0.0000047,      // null unless observation and window complete
    "percentile": 62.4,                 // ≤ convention; null unless complete
    "method": "…"
  },
  "map": {
    "status": "available | baseline_unavailable | no_products | no_valid_retrieval | projection_incompatible | visualization_unavailable | upstream_error",
    "layerType": "signed_column_anomaly",
    "tileUrlTemplate": "https://…/{z}/{x}/{y}", // null unless status is available
    "localDate": "YYYY-MM-DD",
    "unit": "mol/m²",
    "baselineStatus": "…",
    "requestedPriorYears": [ … ],
    "contributingPriorYears": [ … ],
    "historicalDailyImageCount": 93,
    "visualization": {
      "min": -0.000031, "max": 0.000031,        // symmetric: max(|p2|, |p98|) within BAAQMD
      "paletteStops": ["2166ac", "67a9cf", "f7f7f7", "ef8a62", "b2182b"],
      "description": "Per-date symmetric robust display stretch; not a threshold …"
    },
    "attribution": "Contains modified Copernicus Sentinel data",
    "hasNonNominalContributors": false,
    "warning": null,
    "disclaimer": "…"
  },
  "disclaimer": "…"
}
```

Hard rules implemented: numeric nulls stay JSON `null`, never 0; no
coverage threshold; valid negative retrievals preserved; non-NOMINAL
contributors retained and flagged.

`PRODUCT_QUALITY` keeps three distinct concepts for contributing
products. An explicit `"NOMINAL"` value is known nominal. An explicit,
present value other than `"NOMINAL"` is non-NOMINAL
(`nonNominalProductCount` counts only these, and
`hasNonNominalContributors` is true only when that count is positive).
An absent or null property is unknown (`unknownProductQualityCount`),
reported as `unknown` and never counted as nominal or as non-NOMINAL.
`productQualityStatus` is `non_nominal` when at least one explicit
non-NOMINAL contributor exists; `unknown` when none exists but at least
one contributor has missing/null quality metadata (or there are no
products); `nominal` only when every contributor is explicitly NOMINAL.
No exclusion rule exists: unknown and non-NOMINAL products are always
retained.

An incompatible source grid refuses rather than silently continuing.
The anomaly map exists only when all three prior years contribute valid
same-month data (no silent raw daily-column fallback). The
visualization stretch is per-date display only.

## Scientific processing (decided methods)

- Canonical native lattice: `EPSG:4326` with exact `crsTransform`
  `[0.01, 0, -180, 0, 0.01, -90]`, no `scale` argument, no
  `reproject()`, no `bestEffort`, no interpolation.
- Defensive PRODUCT_ID reconstruction (scripts 04-06): only
  same-`PRODUCT_ID` assets are mosaicked; the earliest member timestamp
  determines the product's local date (the raw window is read one day
  wider on each side so midnight-straddling members are never split
  across dates); same-local-date products are combined by arithmetic
  mean.
- Regional statistic: area-weighted mean = Σ(NO₂ × valid pixel area) ÷
  Σ(valid pixel area); valid-area fraction against total BAAQMD area on
  the same grid; reported with every value.
- Projection compatibility rule (accepted 08a v2): same CRS; x/y scale
  and shear within 1e-9 of canonical; origin offsets integer pixel
  multiples within 1e-6.
- Baseline (adopted policy, 2026-07-19): previous three same-calendar
  years, same calendar month, pooled valid daily regional means,
  median, signed anomaly, ≤-percentile; every requested year must
  contribute or the window is `partial_window`.
- Anomaly image: target daily canonical-lattice composite minus the
  pixelwise median of the valid historical daily composites; tile URL
  obtained via the async `getMapId`/`getMap` path; credentials are
  never exposed.
- Display-only boundary clip: the image handed to the tile service is
  the anomaly image clipped to the official BAAQMD geometry, so
  rendered tiles stop at the jurisdiction (outside pixels are
  masked/transparent). The clip is applied only at the tile step.
  Regional statistics, the baseline, and the visualization percentiles
  all use the un-clipped anomaly image, and the anomaly values,
  palette, and stretch are unchanged. No buffering, no geometry
  simplification, no interpolation.

## Caching (in-memory only; no database)

| What | Bound | Lifetime |
| --- | --- | --- |
| `/api/context` | 1 entry | ~5 minutes |
| `/api/analysis` (successful responses) | 20 dates, insertion-order eviction | ~1 hour per entry |
| Boundary GeoJSON, total region area | 1 each | process lifetime |
| Projection-signature verdicts | per distinct exact signature | process lifetime |

Responses whose visualization-percentile or tile stage failed are not
cached; the observation and baseline still return, with
`map.status: "upstream_error"` and a warning, so a retry recomputes the
map. The boundary and total-area caches store only resolved values,
never promises, so a transient upstream failure is never retained.
Nothing persists across restarts. Precomputation (batch exports to
Earth Engine assets) is the documented future option for scaling
(`docs/architecture.md`).

## Timeout budget

One coherent budget, documented here and in the code (`analysis.js`
`CONSTANTS`, `app/frontend/public/app.js` `CONFIG`):

| Request | Backend bound | Frontend outer timeout |
| --- | --- | --- |
| `/api/context` | 60 s | 70 s |
| `/api/boundary` | 90 s | 100 s |
| `/api/analysis` | 60 s cold-context lookup + 480 s overall analysis deadline = 540 s worst case | 600 s |

The 480 s deadline caps the whole analysis pipeline. Each sub-operation
(projection signatures 60 s, main statistics 240 s, total area 60 s,
visualization percentiles 120 s, tile URL 60 s) keeps its own smaller
cap but is clamped to the time remaining under the deadline, so
sequential sub-timeouts can never total more than the deadline. The
frontend timeout is always longer than the matching backend bound, so
the browser never gives up while the backend is still within budget.
Cold-cache analyses may legitimately take minutes; only repeat requests
are fast.

## One-time Google Cloud setup

Per the official Earth Engine service-account guide
(<https://developers.google.com/earth-engine/guides/service_account>):

1. In the Cloud Console, select project `thematic-carver-502603-k5` and
   confirm the Earth Engine API is enabled.
2. *IAM & Admin → Service Accounts → Create service account* (e.g.
   `baaqef-backend`). Grant these roles; all were required in this
   project:
   - **Earth Engine Resource Writer**: required for map/tile creation
     (`earthengine.maps.create` was denied with only the Viewer role;
     granted 2026-07-20);
   - **Earth Engine Resource Viewer**;
   - **Service Usage Consumer**: Earth Engine initialization failed
     with a project-use permission error until this role was added (see
     `docs/architecture.md`).
3. Open the account, then *Keys → Add key → Create new key → JSON*.
   Keep the key outside the repository directory entirely. The repo
   `.gitignore` blocks `*credentials*.json` and `.env*` as a second
   line of defense.

## Run locally (Windows 11, PowerShell)

```powershell
cd E:\Personal_projects\Bay-Area-Air-Quality-Episode-Finder\app\backend
npm install
npm test                                  # pure-helper unit tests (no credentials needed)
$env:EE_SERVICE_ACCOUNT_KEY_FILE = "C:\path\outside\repo\baaqef-key.json"
npm start
```

Without a key the server still boots: `/healthz` reports
`not_configured` and the API routes return the structured 503.

## Deploy on Railway

The Railway service exists (project `bay-area-air-quality-episode`,
service `backend`, Root Directory `app/backend`, auto-deploy from
GitHub `main`). The custom API domain `api.neuralnetworks.me` is
connected with Railway TLS via Route 53 (see `docs/architecture.md`).
Pushing to `main` redeploys the backend.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `PORT` | Listen port (Railway injects it; local default 8080) |
| `EE_SERVICE_ACCOUNT_KEY` | Service-account JSON key contents (preferred on Railway) |
| `EE_SERVICE_ACCOUNT_KEY_FILE` | Path to the JSON key file (convenient locally) |
| `EE_PROJECT_ID` | Earth Engine Cloud project ID (default `thematic-carver-502603-k5`) |
| `ALLOWED_ORIGINS` | Comma-separated browser origins granted CORS read access. When set, it replaces the code defaults (the Railway value does exactly that and includes the live frontend origin `https://airquality.neuralnetworks.me`). `http://localhost:8081` and `http://127.0.0.1:8081` are always appended for local development. |

If both key variables are set, `EE_SERVICE_ACCOUNT_KEY` wins.

## Known limitations

- A cold-cache `/api/analysis` request evaluates roughly three months
  of historical daily reductions plus visualization percentiles and a
  tile lookup in a few large Earth Engine round trips. The first
  request for a date can take minutes (live-observed: about 1 minute
  for the default date). The bounded caches make repeat requests fast
  (live-observed: sub-second). Precomputation is the documented future
  mitigation and has not been designed.
- Earth Engine renders map tiles on demand: the first tile of a fresh
  map can take tens of seconds (live-observed about 30 s) even when the
  analysis response was cached. The frontend shows "Rendering anomaly
  tiles…" until a real tile loads.
- No rate limiting or per-client quotas exist yet; the API is public
  and unauthenticated.
