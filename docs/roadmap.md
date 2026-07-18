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
- [x] Third exploration script — raw temporal structure and provisional
      calendar-day composites
      (`earthengine/exploration/03_s5p_no2_daily_composites.js`): counts
      source images per calendar date, builds one provisional
      (arithmetic-mean) daily composite per date with source images
      preserving `system:time_start`, compares the raw image-level chart
      with the provisional daily chart, and reports calendar-day coverage —
      distinguishing days that merely have source images from days with a
      valid (non-null) daily regional mean. The daily compositing method
      remains provisional — **not** decided.
- [x] Fourth exploration script — product-aware daily method exploration
      (`earthengine/exploration/04_s5p_no2_product_daily_method.js`) with
      local-date filtering (America/Los_Angeles) and product-metadata
      reporting. Its live test **disproved** the multiple-tiles-per-product
      premise for the Bay Area test period (one Earth Engine asset per
      product/orbit; ~14–15 footprint-intersecting orbit-product assets
      per local day) and motivated the research-and-validation gate below.
      The script remains exploratory and under evaluation — no daily
      method is decided.

Still open:

- [ ] Record the boundary layer's original download source (publisher, URL,
      version, retrieval date) in [data-sources.md](data-sources.md)
- [ ] Work through the research-and-validation gate below — the temporal
      unit, daily contributor rule, combination rule, scale, and coverage
      handling are all decided there (open decisions listed in
      [methodology.md](methodology.md))

## Phase 1 — Basic Earth Engine app structure

Matches the overview's "initial build direction": structure before modeling.

- [ ] Bay Area map with the confirmed region boundary
- [ ] Pollutant / indicator selector (may start with NO₂ only)
- [ ] Basic time-series visualization
- [ ] Simple episode summary area (static placeholder text is acceptable at
      this stage — no detection logic yet)
- [ ] Methodology and limitations notes visible in the app
- [ ] Links to GitHub and documentation

## Research and validation gate (before any baseline or anomaly work)

Added 2026-07-18 after the exploration 04 live test. This gate must be
completed, in order, before Phase 2 begins. Each step ends with something
reviewable; no threshold or method is adopted in advance (details in
[methodology.md](methodology.md)).

1. Correct script 04 terminology and identify products with actual valid
   BAAQMD contribution.
2. Audit processing status, product quality, processor versions, algorithm
   versions, and spatial resolution.
3. Implement and test area-weighted regional means and valid-area
   fractions.
4. Run scale sensitivity at candidate equal-area analysis scales.
5. Run coverage-threshold sensitivity without adopting a threshold.
6. Determine the final daily contributor and combination rule.
7. Build a small R validation workflow using surface monitors and
   meteorological context.
8. Decide whether the Earth Engine historical record is sufficiently
   homogeneous.
9. Only then define a baseline and anomaly method.
10. Only after corroboration rules are established may the project
    classify a result as a candidate air-quality episode.

## Phase 2 — Baseline and anomaly views

**Paused, not abandoned.** Begins only after the research and validation
gate above is complete (see [methodology.md](methodology.md)).

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

A small R validation workflow (surface monitors plus meteorological
context) is pulled forward into the research-and-validation gate (step 7);
this fuller phase remains for the reproduction and methodology work below.

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
- Optional contextual map overlays for later interpretation (geographic
  context only): major highways and transportation corridors; industrial
  and permitted-facility locations; land-use categories such as
  residential, commercial, and industrial; ports and airports; possibly
  population density and meteorological context such as wind. Spatial
  coincidence must not be presented as proof that a road, facility, or
  land-use category caused an observed NO₂ pattern, and Sentinel-5P
  resolution does not support attributing values to individual road
  segments or facilities without additional evidence. No overlay datasets
  or providers selected; not implemented (see
  [methodology.md](methodology.md))
