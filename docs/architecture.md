# Architecture (planned)

Planned components and how they fit together. Nothing here is implemented yet.

## Decision status

**Decided** (from the project overview and owner direction):

- The app is built with the Earth Engine JavaScript API and developed and
  published through the Earth Engine Code Editor.
- R is the supporting analysis/validation layer; Python may be used later for
  supporting analysis or notebooks. Neither is the app runtime.
- Hosting: Google Earth Engine App, Railway landing page, AWS Route 53 DNS.
- Study region: the official BAAQMD jurisdiction, from the ingested Earth
  Engine asset
  `projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries`
  filtered to `Air_Distri == "BAY AREA AQMD"` (details and a provenance TODO
  in [data-sources.md](data-sources.md)).
- First dataset: Sentinel-5P OFFL tropospheric NO₂
  (`COPERNICUS/S5P/OFFL/L3_NO2`).

**Still open** (owner decisions, marked TODO here and in the other docs):

- Remaining datasets (reanalysis, ground monitors) — candidates only until
  evaluated and approved (see [data-sources.md](data-sources.md))
- Landing-page stack; domain/subdomain; Earth Engine app publish settings
- All methodological criteria, including the calendar-day temporal unit, the
  daily compositing rule, and the final analysis scale (see
  [methodology.md](methodology.md))

## Components

```
┌─────────────────────────┐     links to      ┌──────────────────────────┐
│  Landing page (Railway) │ ────────────────► │  Earth Engine App (GEE)  │
│  custom domain via      │                   │  map + charts + evidence │
│  AWS Route 53 DNS       │                   │  + methodology sections  │
└─────────────────────────┘                   └──────────────────────────┘
            │                                              │
            │ links to                                     │ analysis mirrored /
            ▼                                              ▼ validated by
┌─────────────────────────┐                   ┌──────────────────────────┐
│  GitHub repository      │                   │  R notebook(s)           │
│  docs + code + notebook │                   │  cleaning, baselines,    │
└─────────────────────────┘                   │  detection logic, charts │
                                              └──────────────────────────┘
```

### Earth Engine app (`earthengine/`)

The main runtime: geospatial analysis and the public-facing dashboard.
Planned dashboard sections (from the project overview):

- Header (title + subtitle)
- Control panel (pollutant/indicator, region, time window, analysis mode,
  eventually episode sensitivity)
- Main map (Bay Area, selected layer or anomaly layer)
- Charts and evidence panel (time series, baseline comparison, spatial extent,
  detected periods, evidence summary)
- Methodology / under-the-hood section
- Documentation links (GitHub, methodology, notebook, data notes)

**Decided:** the app is built with the **Earth Engine JavaScript API** and
developed and published through the **Earth Engine Code Editor**.

The planned data-processing flow (raw Sentinel-5P collection → calendar-day
composites → analysis images → regional statistics and later
baseline/anomaly products → display images and UI layers) and the strict
separation between analysis processing and display processing are
documented in [methodology.md](methodology.md).

### Analysis layer (`analysis/`)

Supporting analysis and validation, not the app runtime. R is the planned
first tool; Python may be used later for supporting analysis, validation, or
notebooks. Planned uses: data cleaning, exploratory analysis, baseline
calculation, episode-detection logic, model evaluation (only if ML is ever
added), and explanatory charts.

### Landing page (`landing-page/`)

A simple custom-domain page hosted on Railway providing: project title, short
explanation, screenshot, live app link, GitHub link, methodology/notebook
links.

TODO: choose the stack (static HTML vs. a small framework). Keep it minimal.

### Hosting and access

- Google Earth Engine App — the interactive geospatial app
- Railway — landing page hosting
- AWS Route 53 — DNS (the project owner's domain is managed there)

TODO: domain/subdomain choice; publish settings for the Earth Engine app.

## Performance and precomputation (planned)

Planned scalability posture. Precomputation is a **planned option**, not a
decision to implement immediately:

- Short exploratory date ranges may continue to be computed interactively.
- Multi-year calendar-day products, historical baselines, anomaly layers,
  and automatic episode scans may become too expensive for repeated
  interactive computation.
- Reusable expensive results may later be produced through Earth Engine
  **batch exports** and stored as **Earth Engine assets**.
- A public Earth Engine App should consume lightweight, reusable products
  when needed to remain responsive.
- The official BAAQMD boundary asset must be readable by the published Earth
  Engine App before public deployment (publish settings are an open TODO
  above).

## Development approach

- The project owner makes design, architecture, scientific-method, and
  interpretation decisions.
- Coding assistance (Claude Code etc.) is used only under human direction, for
  implementation, refactoring, UI layout, comments, documentation drafts, and
  fixing errors.
- Coding assistance must not invent scientific claims, thresholds, datasets,
  methodology, interpretation, or official-sounding conclusions.
