# Bay Area Air Quality Episode Finder

A Bay Area **air-quality evidence dashboard** built on Google Earth Engine.

The project brings satellite, reanalysis, and ground-monitor evidence together in
one place so that a user can examine Bay Area air-quality conditions and the
reasoning behind any interpretation of them. **Episode detection** — scanning the
data for periods that look unusually poor, persistent, and widespread — is one
planned feature of the dashboard, not the only one.

> **Status: planning / documentation phase.**
> No application code exists yet. This repository currently holds the project
> concept, methodology notes, and planned structure.

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
| Bay Area map with air-quality-related layers | Planned |
| Time-series charts vs. a baseline | Planned |
| Evidence panel (persistence, spatial extent, source agreement) | Planned |
| Episode detection (scan for candidate episode periods) | Planned |
| Methodology / "under the hood" section in the app | Planned |
| R-based validation notebook | Planned (later phase) |
| PM2.5 estimation, machine learning | Optional (much later; see roadmap) |

## Repository layout

```
├── bay_area_air_quality_episode_finder_overview.md   # Original project concept (source of truth)
├── docs/
│   ├── methodology.md      # Working definitions, evidence framework, open TODOs
│   ├── data-sources.md     # Candidate data sources (none final yet)
│   ├── architecture.md     # Planned components and hosting
│   └── roadmap.md          # Phased development plan
├── earthengine/            # Google Earth Engine app (not started)
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

The San Francisco Bay Area.

- TODO: decide the exact region definition (e.g., 9-county Bay Area, BAAQMD
  jurisdiction, or a bounding box) before implementation.

## License

- TODO: choose a license.
