# Roadmap (planned phases)

This is a long-term project, not a rushed MVP. Phases are ordered so that
structure and clarity come before advanced modeling. Dates are deliberately
absent; each phase ends with something reviewable.

## Phase 0 — Planning and documentation *(current)*

Decided:

- [x] Project concept written (`bay_area_air_quality_episode_finder_overview.md`)
- [x] Repository structure and planning docs (this phase)
- [x] Exploration-script form: Earth Engine JavaScript API, developed and
      run through the Earth Engine Code Editor (scripts 01–06).
      *Superseded for the public app (2026-07-18):* publishing the
      public app as an Earth Engine App is no longer the plan (possible
      fallback only) — see the architecture decision below
- [x] Public-application architecture decided (2026-07-18): **Railway
      hosts the complete public application** — browser →
      Railway-hosted frontend → Railway backend/API → Google Earth
      Engine → statistics, map layers/tiles, and geospatial results.
      Earth Engine remains the geospatial processing engine.
      Implementation has not started (see Phase 5 and
      [architecture.md](architecture.md))
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
      **Completed:** its revised contribution audit found only 101 of the
      1,276 products contributed valid BAAQMD data (57 one-contributor
      days, 22 two-contributor days, 11 none) and confirmed that Earth
      Engine masks ignore non-contributing products (all-products vs
      valid-contributors-only daily means identical on every comparable
      day).
- [x] Fifth exploration script — quality, overlap, and coverage
      sensitivity
      (`earthengine/exploration/05_s5p_no2_quality_overlap_sensitivity.js`)
      with sequential 7-day chunked evaluation (prevents the 90-day
      interactive timeout) and a default range anchored to the latest
      seven local days available in the OFFL collection. Findings: 9
      non-NOMINAL products, of which 2 contributed over BAAQMD;
      excluding them changed 2023-01-20 and removed all valid data on
      2023-02-15 — so non-NOMINAL products are flagged and retained,
      never silently excluded. No coverage threshold or
      processor-correction method was selected; further detailed
      product-level investigation is deferred.
- [x] Sixth exploration script — exploratory same-calendar-month
      historical median baseline and satellite-column anomaly
      visualization
      (`earthengine/exploration/06_s5p_no2_monthly_baseline_anomaly.js`),
      the first script of the approved exploratory baseline/anomaly
      phase (working description "Satellite NO₂ Column Anomaly
      Explorer"). Implemented and live-tested (regression test accepted
      2026-07-18): the default seven-day run had 7 of 7 valid target
      days; the July baseline pooled 93 valid historical regional days
      from 2023–2025 at the default 3 historical years; a
      month-crossing request created separate June and July baseline
      samples; unavailable prior years were reported without
      target-year or future substitution; no-baseline runs retained
      target results with n/a baseline-dependent statistics; missing
      target days were reported. The dynamically stretched
      anomaly-detail and valid-day-count layers can render slowly —
      recorded as a nonblocking exploration-stage performance
      limitation (no redesign or optimization now). The baseline
      remains exploratory — **not** a final climatology or baseline
      definition (method details in [methodology.md](methodology.md)).

Still open:

- [ ] Record the boundary layer's original download source (publisher, URL,
      version, retrieval date) in [data-sources.md](data-sources.md)
- [ ] Remaining gate work (future, non-blocking for the next exploratory
      feature): the episode-spatial-analysis grid and spatial-extent
      methodology decision, and the R surface-monitor validation
      workflow (the public map DISPLAY method was decided 2026-07-20 —
      see [methodology.md](methodology.md)).
      The historical-homogeneity decision and baseline policy were
      recorded 2026-07-19 (Outcome B), and the production
      regional-statistics method was selected 2026-07-20 after the
      full-history 08b daily audit (see the gate status below and
      [methodology.md](methodology.md))

## Phase 1 — Basic app structure

Matches the overview's "initial build direction": structure before
modeling. Under the decided Railway full-application architecture (see
[architecture.md](architecture.md)), this app structure will ultimately
be delivered in the Railway-hosted public application; Code Editor
prototyping may continue to inform it, and the Earth Engine App form is
a possible fallback only.

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

**Gate status (updated 2026-07-19).** Explorations 04 and 05 completed
steps 1–6 sufficiently for the current project stage: the accepted
**working** daily rule and the practical PRODUCT_QUALITY policy are
recorded in [methodology.md](methodology.md) and `earthengine/README.md`
(practical, not scientifically final). **Step 8 is decided
(2026-07-19):** exploration script 07
(`earthengine/exploration/07_s5p_no2_historical_homogeneity_export.js`)
exported full-history audit tables, the accepted R report
(`analysis/s5p_no2_historical_homogeneity.Rmd`) ran the metadata,
coverage, transition, and retrospective baseline-robustness analyses,
and the owner recorded **Outcome B** — the OFFL record is usable for
exploratory historical comparison with explicit restrictions, never as
an unconditionally homogeneous 2018–present trend record. **Step 9's
baseline and anomaly method is decided** as the historical-baseline
policy in [methodology.md](methodology.md) (previous three
same-calendar years, pooled median, signed anomaly, ≤-percentile,
full-window availability rule, no version matching, no correction
factors, no hard coverage exclusion). The coverage question for the
baseline is resolved by that policy (no hard valid-area-fraction
exclusion). Step 7 (the R surface-monitor validation workflow) remains
future work — not a blocker. **Step 10 still gates episode
classification**: no episode thresholds, persistence rules, or
spatial-extent rules are defined. Script 06 predates the full-window
availability rule and is intentionally unchanged; implementing the
decided policy in a user-facing feature is follow-up work.

### Regional-statistics method audit and decision (completed 2026-07-20)

- [x] Exploration 08a — native-grid pilot and projection-compatibility
      audit (accepted v2): established exact-signature vs
      compatible-lattice classification and the canonical-grid
      calculation over four pilot windows
- [x] Exploration 08b — full-history DAILY regional-method comparison
      export: all nine yearly daily CSVs (2018–2026) and the manifest
      are complete (2,934 requested local dates, none missing or
      duplicated). **All 08b exports are complete (2026-07-20)**: the
      optional projection-summary batch export finished after roughly
      12 hours and independently confirms 44 exact projection
      signatures, all EPSG:4326, all compatible, in one lattice group
      (archival audit evidence only — not read by the application;
      details in [methodology.md](methodology.md))
- [x] Production regional-statistics method selected (2026-07-20): the
      canonical native-lattice regional calculation; the legacy
      EPSG:3310 / 7000 m reduction is reclassified as an
      exploration/reference method (verified audit results, decision
      details, and scope limits in [methodology.md](methodology.md)).
      This does NOT decide any episode-spatial-analysis grid or any
      episode threshold, persistence, or spatial-extent rule (the
      public map DISPLAY method was decided separately on 2026-07-20)

### Exploratory baseline and anomaly visualization (completed)

- [x] Exploratory historical baseline and **satellite-column anomaly**
      visualization — implemented as exploration script 06 and
      live-tested (regression test accepted 2026-07-18). Still **not**
      Episode Finder classification; no health or AQI interpretation;
      anomalies remain clearly labeled as satellite-column anomalies.
      The final historical-baseline policy was decided 2026-07-19 (see
      [methodology.md](methodology.md)); script 06 predates its
      full-window availability rule and remains an unchanged
      exploration reference. The next major project phase is still an
      explicit owner decision that has not been made.

## Phase 2 — Baseline and anomaly views

**Partially unblocked.** The exploratory historical baseline and
satellite-column anomaly visualization is complete (script 06,
live-tested 2026-07-18), and the historical-baseline policy is decided
(2026-07-19). The remaining items are implementation work that follows
that policy — and no next major phase is chosen without an explicit
owner decision.

- [x] Baseline definition decided and documented in
      [methodology.md](methodology.md) (2026-07-19): same-calendar-month
      pooled median over the previous three years, signed anomaly,
      ≤-percentile, full-window availability rule, no
      processor/algorithm version matching, no correction factors, no
      hard valid-area-fraction exclusion. Script 06 predates the
      full-window rule; the final views below must implement it
- [x] Exploratory baseline-comparison view (target period vs.
      exploratory same-calendar-month historical median — script 06,
      live-tested 2026-07-18)
- [ ] Final baseline-comparison view (selected period vs. the decided
      baseline) — follows the baseline definition above
- [x] Exploratory anomaly map layers (fixed comparison scale and detail
      display stretch — script 06)
- [ ] Final anomaly map layer (based on the decided baseline method)
- [x] Limitation notes visible in the exploratory views (script 06
      panel and Console)
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

## Phase 5 — Railway public application and publishing

**Architecture decided (2026-07-18); backend infrastructure implemented
and live-tested (2026-07-19/20); first vertical slice — production API
routes plus the one-date frontend — implemented in the repository
(2026-07-20); deployment of the slice and public exposure are NOT
done.** Railway hosts the complete public application: browser →
Railway-hosted frontend → Railway backend/API → Google Earth Engine →
statistics, map layers/tiles, and geospatial results. Earth Engine
remains the geospatial processing engine; the previous plan (a Railway
landing page linking to a separately published Earth Engine App) is no
longer the final architecture and remains a possible fallback only
(see [architecture.md](architecture.md)). The completed items below
are **infrastructure only** — the remaining stack choices (frontend
framework, backend framework, map library, caching design, any
database, frontend hostname) are open owner decisions, and the broad
public-application deployment is **not** finished.

Completed backend infrastructure (2026-07-19/20; details in
[architecture.md](architecture.md)):

- [x] `app/backend/` proof-of-connection service created (deliberately
      Node's built-in `http` module — an infrastructure proof, not a
      backend-framework decision; commits `9606a43` and `c896789`)
- [x] Railway backend service configured (project
      `bay-area-air-quality-episode`, environment `production`,
      service `backend`, region US West) with Root Directory
      `app/backend` — required because `package.json` is not at the
      repository root
- [x] Earth Engine service-account authentication working from the
      backend
      (`baaqef-backend@thematic-carver-502603-k5.iam.gserviceaccount.com`;
      key injected via the Railway variable `EE_SERVICE_ACCOUNT_KEY`,
      kept outside the repository and never committed)
- [x] Required IAM roles configured: **Earth Engine Resource Viewer**
      plus **Service Usage Consumer** — the latter demonstrated
      required in this project (initialization failed with a
      project-use permission error until it was added)
- [x] Official BAAQMD boundary asset readability verified through the
      backend credentials (filtered feature count 1, live check)
- [x] Sentinel-5P OFFL collection access verified through the backend
      (latest represented local date 2026-07-10 at verification — a
      snapshot consistent with OFFL publication latency, not an
      air-quality result or a valid-regional-data claim)
- [x] Railway auto-deployment from GitHub `main` configured (a push to
      `main` redeploys the backend)
- [x] Custom API domain `api.neuralnetworks.me` working with Railway
      TLS (Route 53 CNAME plus verification TXT record)

Remaining application work:

- [x] First application slice implemented and **deployed** (2026-07-20;
      live-verified against real Earth Engine data): the backend API
      (`/api/context`, `/api/boundary`, `/api/analysis?date=`)
      implements the decided canonical native-lattice observation,
      the adopted three-year baseline, and the signed column-anomaly
      map with a per-date robust display stretch (display tiles
      clipped to the official BAAQMD boundary — display-only, never
      the statistics); the frontend analyzes one local calendar date
      at a time with the official boundary, backend-driven date
      bounds, a backend-metadata-only continuous-gradient legend,
      truthful Leaflet tile-event rendering states, and the
      documented null/status states. Node built-in `http` for both
      services, no-build frontend, vendored Leaflet 1.9.4,
      OpenStreetMap basemap, no database, bounded in-memory caches
      only — all retained by owner decision for this slice
- [ ] The final frontend framework decision remains open (the
      prototype's no-framework approach is a current implementation,
      not a decision)
- [x] Deploy both services on Railway: backend live at
      `api.neuralnetworks.me`, frontend live at
      `airquality.neuralnetworks.me`, CORS allowlist configured;
      observation, baseline, Earth Engine map creation, and tiles
      verified live (cold analyses and first tile rendering take
      noticeable time; warm backend analysis-cache responses are
      fast)
- [x] Production scientific backend API endpoints for statistics and
      map tiles — implemented, deployed, and live-verified
      (2026-07-20), following the semantics in
      [ui-data-contract.md](ui-data-contract.md)
- [x] Implement the UI data contract
      ([ui-data-contract.md](ui-data-contract.md)) end to end in the
      slice: semantic response concepts, null/status semantics (a null
      scientific value is never converted to numeric zero),
      backend-supplied date availability (the date picker never
      assumes "today" is available), and the labeling rules
      (implemented 2026-07-20; live-verified after deployment)
- [x] Implement and test the documented UI states: loading; value with
      complete baseline; value with structurally partial baseline; low
      valid-area fraction (shown, never hidden); no products; products
      but no valid retrieval; non-NOMINAL contributors present;
      backend unavailable; Earth Engine unavailable; date outside the
      supported range; projection incompatible; visualization
      unavailable; timeout (implemented and locally exercised
      2026-07-20; the default-date Earth Engine-backed path —
      observation, baseline, map, tiles — verified live after
      deployment)
- [ ] Public chart UI (charting approach TODO; the daily-series view
      is deferred — this slice analyzes one date at a time; the map
      UI, legend, responsive layout, and loading/error UX exist in
      the slice)
- [x] Public map DISPLAY method decided (2026-07-20): the primary
      layer is the signed "Sentinel-5P tropospheric NO₂ column
      anomaly" (target canonical-lattice composite minus pixelwise
      same-calendar-month historical median under the adopted baseline
      policy; complete prior-three-year window required — no silent
      raw-column fallback), served through normal Earth Engine map
      tiles (Web-Mercator display reprojection by tile rendering; no
      separate display aggregation; legend from backend visualization
      metadata with required identification and oversampling text —
      see [methodology.md](methodology.md)). The backend tile endpoint
      that will serve it is part of the production-API work above
- [ ] Episode spatial-extent analysis grid and spatial-extent
      methodology decision (still open; not settled by the display or
      regional-statistics decisions)
- [ ] Caching/precomputation evaluation before public exposure — the
      slice implements bounded in-memory caches (context ~5 min;
      successful analyses per date, max 20 entries, ~1 h TTL;
      boundary/area for the process lifetime), which do not survive
      restarts and do not remove the multi-minute cold-cache cost of
      a first analysis; the documented option of precomputing
      expensive daily/baseline products as Earth Engine assets
      remains open (see [architecture.md](architecture.md))
- [x] Database decision for the first slice (owner, 2026-07-20): **no
      database** — bounded in-memory caches only. Whether any later
      phase needs persistent storage remains open
- [x] Migration of the decided processing into backend modules —
      first slice (2026-07-20): `app/backend/analysis.js` implements
      the decided daily observation, baseline, and anomaly-map
      processing; exploration scripts 01–07 remain unchanged
      scientific references
- [ ] Public-app testing (local credential-free testing done for the
      slice; Earth Engine-backed behavior needs the Railway
      deployment)
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
