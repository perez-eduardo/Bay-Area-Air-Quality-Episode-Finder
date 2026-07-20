# Bay Area Air Quality Episode Finder

A Bay Area **air-quality evidence dashboard** built on Google Earth Engine.

The project brings satellite, reanalysis, and ground-monitor evidence together in
one place so that a user can examine Bay Area air-quality conditions and the
reasoning behind any interpretation of them. **Episode detection** — scanning the
data for periods that look unusually poor, persistent, and widespread — is one
planned feature of the dashboard, not the only one.

> **Status: backend infrastructure live; first vertical slice
> implemented in the repository (2026-07-20); NOT deployed.**
> The Railway backend infrastructure proof is live (2026-07-19/20):
> Earth Engine service-account authentication and read access to the
> official BAAQMD boundary asset are verified through the deployed
> backend. After the completed full-history daily regional-method
> audit (all Exploration 08b exports are complete, including the
> optional projection summary, which independently confirmed one
> compatible source lattice), the **canonical native-lattice regional
> calculation** is the selected production regional-statistics method
> (details and verified results in
> [docs/methodology.md](docs/methodology.md)). The **first vertical
> slice** is implemented in the repository: backend API routes for
> one-local-date observation, the adopted three-year baseline, and
> the signed satellite column-anomaly map, plus a one-date frontend
> consuming them — **implemented and locally tested, but not
> deployed**; the live backend still runs the earlier
> proof-of-connection build, and no scientific result is publicly
> served yet. The historical-record homogeneity audit is complete
> with the recorded Outcome B baseline policy — still not episode
> classification, with no health or AQI interpretation (see
> [docs/roadmap.md](docs/roadmap.md)). No current feature detects or
> classifies episodes.

## What this project is

- A transparent Earth-observation analysis workflow for Bay Area air quality
- A dashboard that shows **evidence** (maps, time series, baseline comparisons),
  not just a final label
- A demonstration project: the design, methodology, and limitations are meant to
  be readable and reviewable by others

## What this project is not

- **Not** an official air-quality advisory tool
- **Not** a replacement for [AirNow](https://www.airnow.gov/),
  [BAAQMD](https://www.baaqmd.gov/), EPA, or other official sources
- **Not** a source of health guidance
- **Not** a claim that satellite imagery directly measures ground-level air
  quality in all cases

The project deliberately uses careful language — *possible episode*,
*localized anomaly*, *evidence suggests*, *estimate*, *limitation* — and
documents its assumptions and uncertainty.

## Planned features

| Feature | Status |
| --- | --- |
| Bay Area map with air-quality-related layers | First slice implemented (official boundary + signed column-anomaly layer, one date at a time; **not deployed**) |
| Time-series charts vs. a baseline | One-date baseline comparison implemented in the slice (decided policy); daily-series charts deferred |
| Evidence panel (persistence, spatial extent, source agreement) | Planned |
| Episode detection (scan for candidate episode periods) | Planned — paused pending the validation gate (see roadmap) |
| Methodology / "under the hood" section in the app | Planned |
| R-based validation notebook | Planned (later phase) |
| PM2.5 estimation, machine learning | Optional (much later; see roadmap) |

Sentinel-5P NO₂ is used as a **tropospheric-column evidence source** — a
satellite indicator of column patterns, never ground-level concentration,
AQI, health risk, or per-road/per-facility attribution. The exploration
scripts' charts are exploratory: scripts 01–02 plot one point per raw
Earth Engine collection member (an **orbit-product asset**; many can
intersect the region's footprint on one day without contributing valid
data), and scripts 03–05 developed the calendar-day approach now adopted
as a **working rule** (practical, not final; satellite NO₂ remains a
column-density evidence layer, never AQI, surface concentration, or an
episode declaration). The initial Sentinel-5P analytical feature
carries the cautious working description **"Satellite NO₂ Column Anomaly
Explorer"** and is implemented as exploration script 06 (live regression
test accepted 2026-07-18): an exploratory **same-calendar-month
historical median baseline** with signed satellite-column anomalies and
descriptive percentile references — exploratory only, **not** a final
climatology or baseline definition (method details in
[docs/methodology.md](docs/methodology.md)). The broader "candidate
air-quality episode" label will require corroborating evidence later
(ground monitors, persistence, coverage, meteorological context), and
neither the repository nor the final product is renamed without an
explicit owner decision. Coverage sensitivity and formal
surface-monitor validation remain future work. No current feature
detects or classifies episodes.

## Architecture (decided; backend live, first slice implemented, not deployed)

Railway hosts the **complete public application** (owner decision,
2026-07-18):

```text
Browser
  → Railway-hosted frontend      (one-date UI slice implemented; not deployed)
  → Railway backend/API          (proof build live; slice API implemented, not deployed)
  → Google Earth Engine
  → statistics, map layers/tiles, and geospatial results
```

Google Earth Engine remains the **geospatial processing engine**
(ImageCollection filtering, daily compositing, spatial reductions,
baseline/anomaly image generation); the Railway application provides the
public UI, backend/API orchestration, and authentication to Earth
Engine, so public users will not need their own Earth Engine accounts.
The previous plan — a Railway landing page linking to a separately
published Earth Engine App — is no longer the planned final architecture
(it remains a possible fallback).

**Infrastructure status (2026-07-19/20):** the backend half of the
chain exists and is running — `api.neuralnetworks.me` reaches the
Railway backend service, which authenticates to Google Earth Engine
with a service account and returns JSON. The **deployed** endpoints
(including `/api/ee-check`) are **infrastructure checks only** and
return no air-quality results.

**First vertical slice (2026-07-20, implemented — not deployed):**
the repository now contains the first production API surface
(`/api/context`, `/api/boundary`, `/api/analysis?date=YYYY-MM-DD` —
schemas in `app/backend/README.md`) implementing the decided
canonical native-lattice regional statistic, the adopted
previous-three-year baseline, and the signed **Sentinel-5P
tropospheric NO₂ column anomaly** map with a per-date robust display
stretch, plus a one-date frontend at `app/frontend/` implementing the
semantics of [docs/ui-data-contract.md](docs/ui-data-contract.md)
(backend-driven date availability; nulls never rendered as zero; no
hidden coverage cutoff; non-NOMINAL contributors flagged and
retained). Both services use Node's built-in `http` module, in-memory
caches only, and no database (owner decisions for this slice). The
slice is **not deployed**: deploying it, choosing the frontend
hostname, and adding that origin to the backend's `ALLOWED_ORIGINS`
variable remain owner steps, and the episode spatial-extent analysis
grid and final framework decisions remain open (see
[docs/architecture.md](docs/architecture.md)).

## Repository layout

```
├── bay_area_air_quality_episode_finder_overview.md   # Original project concept (source of truth)
├── docs/
│   ├── methodology.md      # Working definitions, decided methods, open TODOs
│   ├── data-sources.md     # Candidate data sources (none final yet)
│   ├── architecture.md     # Decided architecture + implemented infrastructure status
│   ├── ui-data-contract.md # Semantic data contract the production API/UI must follow
│   └── roadmap.md          # Phased development plan
├── app/
│   ├── backend/            # Railway backend API (first slice implemented; deployed instance still runs the proof build)
│   └── frontend/           # One-date public UI slice (implemented; not deployed)
├── earthengine/            # Earth Engine scripts 01–07 (exploration prototypes and audit exports)
├── analysis/               # R supporting analysis (historical homogeneity audit notebook)
└── landing-page/           # Superseded landing-page planning notes (application code lives under app/)
```

The frontend framework and hostname remain open owner decisions; the
current `app/frontend/` shell is an in-progress implementation, not a
final stack choice.

## Documentation

- [Project overview](bay_area_air_quality_episode_finder_overview.md) — the
  original concept document and source of truth for project direction
- [Methodology](docs/methodology.md) — the working definition of an
  "air-quality episode," the evidence framework, and open methodological TODOs
- [Data sources](docs/data-sources.md) — candidate datasets under consideration
- [Architecture](docs/architecture.md) — the decided Railway
  full-application + Earth Engine architecture, the implemented
  backend infrastructure, and the in-progress frontend status
- [UI data contract](docs/ui-data-contract.md) — the semantic data
  concepts, null/status rules, and UI states the production API and
  frontend must follow
- [Roadmap](docs/roadmap.md) — development phases

## Geographic focus

The San Francisco Bay Area, defined as the official jurisdiction of the Bay
Area Air Quality Management District (BAAQMD): all of Alameda, Contra Costa,
Marin, Napa, San Francisco, San Mateo, and Santa Clara counties plus the
southern portions of Solano and Sonoma counties.

The boundary comes from an uploaded Earth Engine asset of California
air-district boundaries, filtered to the Bay Area district (asset ID, field,
and filter value in [docs/data-sources.md](docs/data-sources.md)). A
county-based approximation remains in the exploration script only as a
clearly labeled fallback for when that asset is unavailable.

## License

- TODO: choose a license.
