# Roadmap

This is a long-term project, not a rushed MVP. Phases are ordered so
that structure and clarity come before advanced modeling. Dates are
deliberately absent; each phase ends with something reviewable. No
phase adds episode classification until the validation gate below is
complete, and the next major phase is an explicit owner decision.

## Phase 0: planning, documentation, and exploration (complete except noted)

Done:

- [x] Project concept written
      (`bay_area_air_quality_episode_finder_overview.md`)
- [x] Repository structure and planning docs
- [x] Exploration-script form: Earth Engine JavaScript API, developed
      and run through the Earth Engine Code Editor. Publishing the
      public app as an Earth Engine App is no longer the plan (possible
      fallback only); see the architecture decision below
- [x] Public-application architecture decided (2026-07-18): Railway
      hosts the complete public application (browser → Railway frontend
      → Railway backend/API → Google Earth Engine); see
      [architecture.md](architecture.md)
- [x] Study region: official BAAQMD jurisdiction (boundary source and
      fallback recorded in [data-sources.md](data-sources.md))
- [x] First dataset: Sentinel-5P OFFL tropospheric NO₂
      (`COPERNICUS/S5P/OFFL/L3_NO2`)
- [x] Script 01: initial data exploration
      (`earthengine/exploration/01_s5p_no2_exploration.js`)
- [x] Official BAAQMD boundary ingested as an Earth Engine asset
      (`projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries`,
      filter `Air_Distri == "BAY AREA AQMD"`); the county approximation
      remains only as a fallback
- [x] Script 02: two map display modes, absolute fixed-scale and
      relative period-stretched
      (`earthengine/exploration/02_s5p_no2_display_modes.js`)
- [x] Script 03: raw temporal structure and provisional calendar-day
      composites
      (`earthengine/exploration/03_s5p_no2_daily_composites.js`);
      distinguishes days with source images from days with a valid
      daily regional mean; the compositing method is provisional
- [x] Script 04: product-aware daily method exploration
      (`earthengine/exploration/04_s5p_no2_product_daily_method.js`).
      Its live test disproved the multiple-tiles-per-product premise
      for the Bay Area test period (one Earth Engine asset per
      product/orbit; roughly 14-15 footprint-intersecting assets per
      local day). Its contribution audit found only 101 of 1,276
      products contributed valid BAAQMD data (57 one-contributor days,
      22 two-contributor days, 11 with none) and confirmed that Earth
      Engine masks ignore non-contributing products
- [x] Script 05: quality, overlap, and coverage sensitivity
      (`earthengine/exploration/05_s5p_no2_quality_overlap_sensitivity.js`)
      with sequential 7-day chunked evaluation (prevents the 90-day
      interactive timeout). Findings: 9 non-NOMINAL products, 2 of
      which contributed over BAAQMD; excluding them changed 2023-01-20
      and removed all valid data on 2023-02-15, so non-NOMINAL products
      are flagged and retained, never silently excluded
- [x] Script 06: exploratory same-calendar-month historical median
      baseline and satellite-column anomaly visualization
      (`earthengine/exploration/06_s5p_no2_monthly_baseline_anomaly.js`),
      live regression test accepted 2026-07-18. Its two dynamically
      stretched layers can render slowly (accepted exploration-stage
      limitation). The exploratory baseline predates the decided
      baseline policy and is unchanged (details in
      [methodology.md](methodology.md))

Still open:

- [ ] Record the boundary layer's original download source (publisher,
      URL, version, retrieval date) in
      [data-sources.md](data-sources.md)
- [ ] Episode-spatial-analysis grid and spatial-extent methodology
      decision, and the R surface-monitor validation workflow

## Phase 1: basic app structure

Delivered through the Railway-hosted public application (see
[architecture.md](architecture.md)). The first slice (Phase 5 below)
implements most of this.

- [x] Bay Area map with the confirmed region boundary (in the deployed
      slice)
- [ ] Pollutant / indicator selector (the slice fixes NO₂ as a
      read-only parameter)
- [ ] Basic time-series visualization
- [ ] Simple episode summary area (static placeholder text acceptable;
      no detection logic)
- [x] Methodology and limitations notes visible in the app (About
      dialog and layer notes in the deployed slice)
- [x] Links to GitHub and documentation

## Research and validation gate (before episode work)

Added 2026-07-18 after the exploration 04 live test. Steps, in order:

1. Correct script 04 terminology and identify products with actual
   valid BAAQMD contribution.
2. Audit processing status, product quality, processor versions,
   algorithm versions, and spatial resolution.
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

Gate status (2026-07-19/20): explorations 04 and 05 completed steps 1-6
sufficiently for the current stage (the accepted working daily rule and
the PRODUCT_QUALITY policy in [methodology.md](methodology.md)). Step 8
is decided (2026-07-19): script 07
(`earthengine/exploration/07_s5p_no2_historical_homogeneity_export.js`)
exported full-history audit tables, the accepted R report
(`analysis/s5p_no2_historical_homogeneity.Rmd`) ran the metadata,
coverage, transition, and retrospective baseline-robustness analyses,
and the owner recorded Outcome B: the OFFL record is usable for
exploratory historical comparison with explicit restrictions. Step 9 is
decided as the historical-baseline policy in
[methodology.md](methodology.md). Step 7 (the R surface-monitor
validation workflow) remains future work, not a blocker. Step 10 still
gates episode classification: no episode thresholds, persistence rules,
or spatial-extent rules are defined.

### Regional-statistics method audit and decision (completed 2026-07-20)

- [x] Exploration 08a: native-grid pilot and projection-compatibility
      audit (accepted v2); established exact-signature vs
      compatible-lattice classification and the canonical-grid
      calculation over four pilot windows
- [x] Exploration 08b: full-history daily regional-method comparison
      export. All exports complete (2026-07-20): nine yearly daily CSVs
      (2018-2026, 2,934 requested local dates, none missing or
      duplicated), the manifest, and the optional projection-summary
      batch export (roughly 12 hours; independently confirms 44 exact
      projection signatures, all EPSG:4326, all compatible, one lattice
      group; archival audit evidence only)
- [x] Production regional-statistics method selected (2026-07-20): the
      canonical native-lattice regional calculation; the legacy
      EPSG:3310 / 7000 m reduction reclassified as an
      exploration/reference method (results and scope limits in
      [methodology.md](methodology.md)). This does not decide any
      episode-spatial-analysis grid or episode rule

## Phase 2: baseline and anomaly views

- [x] Baseline definition decided and documented (2026-07-19):
      same-calendar-month pooled median over the previous three years,
      signed anomaly, ≤-percentile, full-window availability rule, no
      version matching, no correction factors, no hard
      valid-area-fraction exclusion
- [x] Exploratory baseline-comparison view (script 06)
- [x] Final baseline-comparison view implementing the decided policy
      (the deployed one-date slice; a daily-series view remains future
      work)
- [x] Exploratory anomaly map layers (script 06)
- [x] Final anomaly map layer based on the decided baseline method
      (the deployed signed column-anomaly layer)
- [x] Limitation notes visible in the exploratory and deployed views
- [ ] Daily-series baseline charts (deferred; charting approach TODO)

## Phase 3: episode detection (not started)

- [ ] Persistence and spatial-extent criteria decided and documented
- [ ] Historical scan: detect candidate episode periods and list them
- [ ] Episode label levels wired to evidence (no strong signal /
      localized anomaly / possible regional episode / strong regional
      episode)
- [ ] Evidence breakdown panel: why a period was labeled
- [ ] Current/recent screening mode

## Phase 4: R validation layer

The small R validation workflow (surface monitors plus meteorological
context) is pulled forward into the gate (step 7); this phase covers
the fuller reproduction and methodology work.

- [ ] R notebook reproducing baseline and detection logic on exported
      data
- [ ] Comparison against ground-monitor data (access method TODO)
- [ ] Explanatory charts for the methodology section

## Phase 5: Railway public application

Architecture decided 2026-07-18. Both services are deployed and were
verified against live Earth Engine data on 2026-07-20 (backend
`api.neuralnetworks.me`, frontend `airquality.neuralnetworks.me`).

Completed infrastructure (2026-07-19/20; details in
[architecture.md](architecture.md)):

- [x] `app/backend/` proof-of-connection service (commits `9606a43`
      and `c896789`)
- [x] Railway backend service configured (project
      `bay-area-air-quality-episode`, environment `production`,
      service `backend`, region US West, Root Directory `app/backend`)
- [x] Earth Engine service-account authentication working
      (`baaqef-backend@thematic-carver-502603-k5.iam.gserviceaccount.com`;
      key injected via `EE_SERVICE_ACCOUNT_KEY`, never committed)
- [x] IAM roles configured (Earth Engine Resource Writer, Earth Engine
      Resource Viewer, Service Usage Consumer; see
      [architecture.md](architecture.md))
- [x] Official BAAQMD boundary asset readability verified through the
      backend credentials (filtered feature count 1, live check)
- [x] Sentinel-5P OFFL collection access verified through the backend
      (latest represented local date 2026-07-10 at verification, a
      snapshot consistent with OFFL publication latency)
- [x] Railway auto-deployment from GitHub `main`
- [x] Custom API domain `api.neuralnetworks.me` with Railway TLS
      (Route 53 CNAME plus verification TXT record)

Completed application work (2026-07-20):

- [x] First application slice implemented and deployed: backend API
      (`/api/context`, `/api/boundary`, `/api/analysis?date=`)
      implementing the decided canonical native-lattice observation,
      the adopted three-year baseline, and the signed column-anomaly
      map with a per-date robust display stretch (display tiles clipped
      to the official BAAQMD boundary; never the statistics); one-date
      frontend with the official boundary, backend-driven date bounds,
      a backend-metadata-only legend, tile-event-driven rendering
      states, and the documented null/status states
- [x] UI data contract ([ui-data-contract.md](ui-data-contract.md))
      implemented end to end and live-verified
- [x] Documented UI states implemented and exercised (loading, partial
      baseline, low coverage shown as-is, no products, no valid
      retrieval, non-NOMINAL warning, backend/Earth Engine unavailable,
      out-of-range date, projection incompatible, visualization
      unavailable, timeout, tile lifecycle)
- [x] Public map display method decided (2026-07-20; see
      [methodology.md](methodology.md))
- [x] Database decision for the first slice: no database; bounded
      in-memory caches only
- [x] Decided processing migrated into backend modules
      (`app/backend/analysis.js`); exploration scripts 01-07 unchanged
      as scientific references
- [x] Frontend hostname chosen and live
      (`airquality.neuralnetworks.me`; origin present in the backend
      `ALLOWED_ORIGINS` variable)

Remaining work:

- [ ] Final frontend framework decision (the no-framework prototype is
      a current implementation, not a decision)
- [ ] Public chart UI (daily-series view; charting approach TODO)
- [ ] Episode spatial-extent analysis grid and methodology decision
- [ ] Caching/precomputation evaluation (in-memory caches do not
      survive restarts; cold-cache analyses take minutes; batch-export
      precomputation remains the documented option, see
      [architecture.md](architecture.md))
- [ ] Whether any later phase needs persistent storage
- [ ] Rate limiting / per-client quotas (none exist; the API is public
      and unauthenticated)
- [ ] Final documentation pass: methodology, limitations, screenshots

## Later / optional (not commitments)

- PM2.5 estimation workflow (satellite-related indicators plus
  reanalysis plus monitor comparison; framed as an estimate, never as
  direct observation)
- Explainable ML for episode-day classification, with error reporting,
  only after the explainable non-ML workflow is credible on its own
- Optional contextual map overlays for geographic context (highways,
  industrial and permitted facilities, land use, ports and airports,
  population density, wind). Spatial coincidence is not proof of
  causation, and Sentinel-5P resolution does not support per-road or
  per-facility attribution; see [methodology.md](methodology.md)
