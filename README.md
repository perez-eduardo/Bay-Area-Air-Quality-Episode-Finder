# Bay Area Air Quality Episode Finder

A public dashboard that shows daily Sentinel-5P satellite NO₂ evidence
for the San Francisco Bay Area. For one selected date it reports the
regional tropospheric NO₂ column, compares it with the same calendar
month in the previous three years, and maps the anomaly across the
region. The application grew from an undergraduate data science project
that used R and Google Earth Engine.

- Live application: <https://airquality.neuralnetworks.me>
- Backend API: <https://api.neuralnetworks.me>

Both services run on Railway and auto-deploy from `main`. They were
deployed and verified against live Earth Engine data on 2026-07-20.

This is an evidence dashboard, not an advisory tool. It does not
replace [AirNow](https://www.airnow.gov/),
[BAAQMD](https://www.baaqmd.gov/), or EPA, and it gives no health
guidance. A satellite NO₂ column is not a ground-level concentration
and is never presented as AQI. No feature detects or classifies
air-quality episodes; episode detection is planned but not implemented
(see [docs/roadmap.md](docs/roadmap.md)).

## Function

The application analyzes one Bay Area local calendar date at a time
(America/Los_Angeles). For the selected date it:

- reads Sentinel-5P OFFL tropospheric NO₂
  (`COPERNICUS/S5P/OFFL/L3_NO2`, band
  `tropospheric_NO2_column_number_density`, unit mol/m²) through
  Google Earth Engine;
- computes the area-weighted regional mean over the official BAAQMD
  jurisdiction, always reported with the valid-area fraction (the
  share of the region with valid retrievals that day);
- compares the value with a baseline built from the same calendar
  month in the previous three years;
- draws a signed anomaly map, clipped for display to the BAAQMD
  boundary;
- reports data quality: product counts, non-NOMINAL product flags
  (flagged and retained, never silently excluded), and
  unknown-quality counts.

The date picker is bounded by backend-supplied availability; the newest
date represented in the collection is excluded because its ingestion
may still be partial.

## Defining the Anomaly

The regional anomaly is the selected day's regional mean minus the
median of pooled valid daily regional means from the same calendar
month over the previous three years. The percentile is the share of
those historical values less than or equal to the selected day's value.
If any of the three prior years has no valid same-month observation,
the baseline, anomaly, and percentile are reported as unavailable; the
raw daily value is still shown.

At each map pixel, the anomaly is the selected day's value minus the
median of valid daily observations from the same calendar month over
the previous three years. Positive values mean the column was above its
historical median for that location.

Full definitions, audit results, and limitations are in
[docs/methodology.md](docs/methodology.md).

## Technology

- Google Earth Engine performs the geospatial processing: daily
  compositing, regional reductions, baseline and anomaly images, and
  map tiles.
- Backend (`app/backend/`): Node.js using only the built-in `http`
  module, no framework and no database, with bounded in-memory caches.
  It authenticates to Earth Engine with a service account, so users do
  not need Earth Engine accounts. Routes, schemas, and setup are in
  [app/backend/README.md](app/backend/README.md).
- Frontend (`app/frontend/`): plain browser JavaScript with no build
  step, vendored Leaflet 1.9.4, OpenStreetMap basemap. Details in
  [app/frontend/README.md](app/frontend/README.md).
- Hosting: two Railway services; DNS in AWS Route 53.

## Run locally

Backend first (needs an Earth Engine service-account key; see
[app/backend/README.md](app/backend/README.md)):

```powershell
cd app\backend
npm install
npm test
$env:EE_SERVICE_ACCOUNT_KEY_FILE = "C:\path\outside\repo\key.json"
npm start
```

Frontend in a second terminal:

```powershell
cd app\frontend
$env:BACKEND_ORIGIN = "http://localhost:8080"
npm start
```

Open <http://localhost:8081>. Without a key the backend still boots and
the UI shows an "Earth Engine not ready" state.

## Repository layout

```
├── bay_area_air_quality_episode_finder_overview.md   # Original project concept
├── docs/                # Methodology, data sources, architecture, UI contract, roadmap
├── app/backend/         # API service (Railway)
├── app/frontend/        # Public UI (Railway)
├── earthengine/         # Earth Engine exploration scripts 01-07 (scientific references)
├── analysis/            # R supporting analysis (historical homogeneity audit)
└── landing-page/        # Superseded planning notes
```

## Documentation

- [Project overview](bay_area_air_quality_episode_finder_overview.md):
  the original concept document and source of truth for project
  direction
- [Methodology](docs/methodology.md): definitions, decided methods,
  audit results, and open decisions
- [Data sources](docs/data-sources.md): dataset facts and candidate
  sources
- [Architecture](docs/architecture.md): components, hosting, and
  infrastructure
- [UI data contract](docs/ui-data-contract.md): response semantics,
  statuses, and null handling
- [Roadmap](docs/roadmap.md): completed and remaining work

## Geographic focus

The study region is the official jurisdiction of the Bay Area Air
Quality Management District (BAAQMD): all of Alameda, Contra Costa,
Marin, Napa, San Francisco, San Mateo, and Santa Clara counties plus
the southern portions of Solano and Sonoma counties. The boundary comes
from an uploaded Earth Engine asset of California air-district
boundaries filtered to the Bay Area district (asset ID, field, and
filter value in [docs/data-sources.md](docs/data-sources.md)).

## Current limitations

- A first (cold-cache) analysis of a date can take about a minute, and
  the first anomaly tile can take roughly 30 seconds to render. Repeat
  requests are served from in-memory caches and are fast, but caches do
  not survive restarts. Precomputation has not been designed.
- The API is public with no rate limiting.
- One date at a time; no daily time-series view yet.
- The 0.01° display grid is oversampled relative to the native TROPOMI
  footprint (about 3.5 × 5.5 km since August 2019). Neighboring cells
  are not independent measurements, and street-level or per-facility
  attribution is not supported.
- The Sentinel-5P OFFL record is used for exploratory historical
  comparison with explicit restrictions; it is not a homogeneous
  long-term trend record (see [docs/methodology.md](docs/methodology.md)).

## License

TODO: choose a license.
