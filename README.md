# Bay Area Air Quality Episode Finder

A Bay Area **air-quality evidence dashboard** built on Google Earth Engine.

The project brings satellite, reanalysis, and ground-monitor evidence together in
one place so that a user can examine Bay Area air-quality conditions and the
reasoning behind any interpretation of them. **Episode detection** — scanning the
data for periods that look unusually poor, persistent, and widespread — is one
planned feature of the dashboard, not the only one.

> **Status: exploratory baseline and anomaly visualization complete;
> dashboard app not built.**
> The dashboard app is not built yet. Six Earth Engine exploration
> scripts exist (see `earthengine/`); the preprocessing investigation is
> closed with an accepted **working** daily rule (practical, not final),
> and the approved exploratory historical baseline and
> **satellite-column anomaly** visualization is implemented and
> live-tested (script 06) — still not episode classification, with no
> health or AQI interpretation (see
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
| Bay Area map with air-quality-related layers | Exploration started (see `earthengine/`) |
| Time-series charts vs. a baseline | Exploration started (script 06 exploratory baseline; final baseline method undecided) |
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

## Repository layout

```
├── bay_area_air_quality_episode_finder_overview.md   # Original project concept (source of truth)
├── docs/
│   ├── methodology.md      # Working definitions, evidence framework, open TODOs
│   ├── data-sources.md     # Candidate data sources (none final yet)
│   ├── architecture.md     # Planned components and hosting
│   └── roadmap.md          # Phased development plan
├── earthengine/            # Earth Engine scripts (exploration started; app not built)
├── analysis/               # R analysis / validation notebooks (not started)
└── landing-page/           # Custom-domain landing page (not started)
```

## Documentation

- [Project overview](bay_area_air_quality_episode_finder_overview.md) — the
  original concept document and source of truth for project direction
- [Methodology](docs/methodology.md) — the working definition of an
  "air-quality episode," the evidence framework, and open methodological TODOs
- [Data sources](docs/data-sources.md) — candidate datasets under consideration
- [Architecture](docs/architecture.md) — planned components and hosting
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
