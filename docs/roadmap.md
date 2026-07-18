# Roadmap (planned phases)

This is a long-term project, not a rushed MVP. Phases are ordered so that
structure and clarity come before advanced modeling. Dates are deliberately
absent; each phase ends with something reviewable.

## Phase 0 — Planning and documentation *(current)*

Decided:

- [x] Project concept written (`bay_area_air_quality_episode_finder_overview.md`)
- [x] Repository structure and planning docs (this phase)
- [x] Earth Engine app form: JavaScript API, developed and published through
      the Earth Engine Code Editor
- [x] Study region: official BAAQMD jurisdiction (boundary source and interim
      county approximation recorded in [data-sources.md](data-sources.md))
- [x] First dataset: Sentinel-5P OFFL tropospheric NO₂
      (`COPERNICUS/S5P/OFFL/L3_NO2`)
- [x] Initial data-exploration script
      (`earthengine/exploration/01_s5p_no2_exploration.js`)
- [x] Official BAAQMD boundary ingested as an Earth Engine asset
      (`projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries`,
      filter `Air_Distri == "BAY AREA AQMD"`) and used by the exploration
      script; the county approximation remains only as a fallback
- [x] Second exploration script with two map display modes — absolute
      fixed-scale and relative period-stretched views
      (`earthengine/exploration/02_s5p_no2_display_modes.js`); purpose and
      limitations of both modes documented in `earthengine/README.md`

Still open:

- [ ] Record the boundary layer's original download source (publisher, URL,
      version, retrieval date) in [data-sources.md](data-sources.md)

## Phase 1 — Basic Earth Engine app structure

Matches the overview's "initial build direction": structure before modeling.

- [ ] Bay Area map with the confirmed region boundary
- [ ] Pollutant / indicator selector (may start with NO₂ only)
- [ ] Basic time-series visualization
- [ ] Simple episode summary area (static placeholder text is acceptable at
      this stage — no detection logic yet)
- [ ] Methodology and limitations notes visible in the app
- [ ] Links to GitHub and documentation

## Phase 2 — Baseline and anomaly views

- [ ] Baseline definition decided and documented in
      [methodology.md](methodology.md)
- [ ] Baseline-comparison view (selected period vs. baseline)
- [ ] Anomaly map layer
- [ ] Limitation notes updated for the chosen baseline approach

## Phase 3 — Episode detection

- [ ] Persistence and spatial-extent criteria decided and documented
- [ ] Historical scan: detect candidate episode periods and list them
- [ ] Episode label levels wired to evidence (no strong signal / localized
      anomaly / possible regional episode / strong regional episode)
- [ ] Evidence breakdown panel: why a period was labeled
- [ ] Current/recent screening mode

## Phase 4 — R validation layer

- [ ] R notebook reproducing baseline and detection logic on exported data
- [ ] Comparison against ground-monitor data (access method TODO)
- [ ] Explanatory charts for the methodology section

## Phase 5 — Publishing

- [ ] Publish the Earth Engine app
- [ ] Landing page on Railway with custom domain (Route 53)
- [ ] Final documentation pass: methodology, limitations, screenshots

## Later / optional (not commitments)

- PM2.5 estimation workflow (satellite-related indicators + reanalysis +
  monitor comparison; framed as an estimate, never as direct observation)
- Explainable ML for episode-day classification, with error reporting —
  only after the explainable non-ML workflow is credible on its own
