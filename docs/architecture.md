# Architecture (decided; implementation not started)

Planned components and how they fit together. The public-application
architecture below is an owner decision (2026-07-18); none of its
implementation has started.

## Decision status

**Decided** (owner decisions):

- **Railway hosts the complete public application** (decided
  2026-07-18): a Railway-hosted frontend and a Railway backend/API,
  with the backend calling Google Earth Engine. Google Earth Engine
  remains the **geospatial processing engine**. The previous plan — a
  Railway landing page linking to a separately published Earth Engine
  App — is **no longer the planned final architecture**; the Earth
  Engine App form remains only a possible fallback. Migration to this
  architecture has **not** been implemented.
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

**Still open** (owner decisions, marked TODO here and in the other
docs; none may be chosen by coding assistants):

- Frontend framework and stack — not chosen (no framework, React or
  otherwise, is decided)
- Backend runtime and framework — not chosen (no runtime, Node or
  otherwise, is decided)
- Map library for the public UI — not chosen
- Earth Engine service authentication design for the backend — TODO;
  public users must not need their own Earth Engine accounts
- Caching design; whether any database is used — not chosen
- Backend API endpoint design — TODO
- Railway deployment configuration; domain/subdomain — TODO
- Repository organization for the Railway application code — TODO
- Remaining datasets (reanalysis, ground monitors) — candidates only
  until evaluated and approved (see [data-sources.md](data-sources.md))
- All methodological criteria, including the final daily compositing
  rule and the final analysis scale (see
  [methodology.md](methodology.md))

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
  authentication and deployment details are implementation TODOs.
- **GitHub repository.** Documentation, exploration scripts, and —
  later — the application code (repository organization TODO).
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

### Railway application (`landing-page/`)

This directory was originally planned as a simple custom-domain landing
page. Under the full-application decision, the Railway application —
public UI plus backend/API — replaces the landing-page-only role; where
the application code lives in the repository is an open TODO. A simple
landing or entry page may still exist as part of the application.

### Hosting and access

- Railway — the complete public application (frontend and backend/API)
- Google Earth Engine — the geospatial processing engine, called by the
  Railway backend
- AWS Route 53 — DNS (the project owner's domain is managed there)
- The previously planned separately published Earth Engine App is no
  longer the final public architecture; it remains a possible fallback
  only.

TODO: Railway deployment configuration; domain/subdomain choice; Earth
Engine service authentication design.

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
- The official BAAQMD boundary asset must be readable by the backend's
  Earth Engine credentials before public deployment (the authentication
  design is a TODO above).

## Development approach

- The project owner makes design, architecture, scientific-method, and
  interpretation decisions.
- Coding assistance (Claude Code etc.) is used only under human direction, for
  implementation, refactoring, UI layout, comments, documentation drafts, and
  fixing errors.
- Coding assistance must not invent scientific claims, thresholds, datasets,
  methodology, interpretation, or official-sounding conclusions.
