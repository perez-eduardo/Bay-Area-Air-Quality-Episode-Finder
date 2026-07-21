# Earth Engine scripts

Exploration scripts 01-06 plus the audit-export script 07 are tracked
here. The 08a/08b regional-method audit work is complete (08a accepted;
all 08b exports complete 2026-07-20), but the 08a/08b script files are
not yet committed to this repository. No script here detects or
classifies air-quality episodes, and none of them produces baselines,
thresholds, scoring, or modeling beyond what is described below; they
are exploration and audit tools.

Everything here uses the Earth Engine JavaScript API and is developed
and run through the Earth Engine Code Editor. The public application is
hosted on Railway (`app/`; see
[docs/architecture.md](../docs/architecture.md)); these scripts remain
validated exploration/prototype scripts and scientific references, and
their processing logic may later be reorganized into reusable backend
modules (not started). Publishing them as an Earth Engine App is no
longer the planned public architecture (a possible fallback only).

## Contents

- `exploration/01_s5p_no2_exploration.js`: first data exploration.
  Study-region boundary, a mean Sentinel-5P OFFL tropospheric NO₂
  layer for a configurable date range, a regional time-series chart
  (image-level and exploratory; see
  [Temporal behavior of scripts 01 and 02](#temporal-behavior-of-scripts-01-and-02)),
  and a data-availability note.
- `exploration/02_s5p_no2_display_modes.js`: spatial readability of the
  NO₂ map. Keeps script 01's behavior and adds a selector with two map
  display modes, an absolute fixed-scale view and a relative
  period-stretched view (see [Display modes](#display-modes-exploration-02)).
- `exploration/03_s5p_no2_daily_composites.js`: raw temporal structure
  and provisional calendar-day composites (see
  [Daily composites](#daily-composites-exploration-03)). The daily
  compositing method is provisional, not final.
- `exploration/04_s5p_no2_product_daily_method.js` (completed):
  orbit-product contribution audit. Filters by Bay Area local calendar
  dates (America/Los_Angeles), reconstructs products defensively by
  `PRODUCT_ID`, measures each product's actual valid contribution over
  BAAQMD, audits processing metadata, and compares an all-products
  daily mean against a valid-contributors-only daily mean (see
  [Completed explorations 04 and 05](#completed-explorations-04-and-05)).
- `exploration/05_s5p_no2_quality_overlap_sensitivity.js` (completed):
  product quality, dual-contributor overlap, and coverage sensitivity,
  with sequential seven-day chunked evaluation for long ranges and a
  default range anchored to the latest local date available in the OFFL
  collection.
- `exploration/06_s5p_no2_monthly_baseline_anomaly.js` (implemented and
  live-tested): exploratory same-calendar-month historical median
  baseline and satellite-column anomaly visualization, working
  description "Satellite NO₂ Column Anomaly Explorer" (see
  [Exploratory baseline and anomaly](#exploratory-baseline-and-anomaly-exploration-06)).
  The baseline is exploratory, not a final climatology.
- `exploration/07_s5p_no2_historical_homogeneity_export.js`
  (completed): yearly batch table exports (daily audit, product
  metadata, manifest) covering the full OFFL record, feeding the
  homogeneity audit in `analysis/s5p_no2_historical_homogeneity.Rmd`.
  That audit closed with the recorded Outcome B decision and baseline
  policy (2026-07-19; see
  [docs/methodology.md](../docs/methodology.md)). Audit export only.
- Exploration 08a (accepted, v2; script file not yet committed): pilot
  native-grid / projection-compatibility audit. Over four fixed pilot
  windows it compared the legacy EPSG:3310 / 7000 m statistics path
  against a native-L3-lattice calculation, inventoried exact projection
  signatures, and established the pixel-grid-compatibility rule and the
  fixed canonical grid used by 08b. Diagnostic only.
- Exploration 08b (complete 2026-07-20; script file not yet committed):
  full-history daily regional-method comparison export (both methods
  for every requested local date, yearly batch partitions, plus a
  projection summary and manifest). On its verified results the owner
  selected the canonical native-lattice calculation as the production
  regional-statistics method, with the legacy EPSG:3310 / 7000 m path
  reclassified as an exploration/reference method (results, decision,
  and scope limits in [docs/methodology.md](../docs/methodology.md)).
  Diagnostic export only.

## Running a script in the Code Editor

1. Open the Earth Engine Code Editor at
   <https://code.earthengine.google.com> (requires a Google account
   registered for Earth Engine access).
2. Create a new script and paste in the contents of the `.js` file.
3. Click **Run**. The map centers on the study region and shows the
   boundary and the mean NO₂ layer; a side panel shows explanatory
   text, date controls, a data-availability note, and the time-series
   chart. Script 02 adds a display-mode selector and legend; scripts 03
   and 04 add layer selectors, coverage summaries, and comparison
   charts; script 06 adds a historical-years control, a five-layer map
   selector, baseline-sample summaries, and anomaly charts.
4. Change the date range in the panel's date boxes and click
   **Update**, or edit the `CONFIG` block at the top of the script and
   re-run.

### Study-region boundary

The scripts use the official BAAQMD jurisdiction boundary from the
uploaded Earth Engine asset
`projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries`,
selected with the filter `Air_Distri == "BAY AREA AQMD"` and dissolved
into a single feature (`boundaryAssetId` / `boundaryField` /
`boundaryValue` in the script's `CONFIG`).

Only if that asset is unavailable (for example, the running account has
no read access) does a script fall back to a clearly labeled TIGER/2018
county approximation (Solano and Sonoma included in full, which
overstates the jurisdiction's northern extent). The fallback prints a
console warning and adds a note to the side panel. See
[docs/data-sources.md](../docs/data-sources.md).

## Temporal behavior of scripts 01 and 02

Both scripts work directly on the raw `COPERNICUS/S5P/OFFL/L3_NO2`
collection, whose members are orbit-product assets: one Level-3 grid
per Sentinel-5P product/orbit (see the corrected collection model in
[docs/data-sources.md](../docs/data-sources.md)). A collection member
is not one daily observation: several orbit-product assets can carry
the same calendar date, many intersect the BAAQMD footprint without
contributing valid NO₂ pixels over it, and the exploration 04 live test
found roughly 14-15 footprint-intersecting assets per local day.
Consequences:

- The "N images" count in the status line counts raw collection
  members, not days, independent daily observations, or valid regional
  contributors.
- The time-series chart plots one point per raw collection image. It is
  an exploratory image-level series, not the daily time series that
  episode analysis will use.
- The image-level chart requests an explicit 5000 m scale through
  `ui.Chart.image.series`; it does not use `bestEffort`.
- The coverage diagnostic uses `reduceRegion()` with `bestEffort`, an
  exploratory UI diagnostic only. In script 02, the relative-display
  percentile calculation also uses `bestEffort`, a visualization
  calculation only. Final scientific reductions use an explicit,
  stable, documented scale without `bestEffort` (see
  [docs/methodology.md](../docs/methodology.md)).

On quality filtering: the current catalog page states a 75 % validity
ingestion rule for the tropospheric NO₂ band while the example command
on the same page still shows
`tropospheric_NO2_column_number_density_validity > 50` (an
inconsistency on the official page), and the official Sentinel-5P NO₂
Product User Manual recommends `qa_value > 0.75` for most users. We
have not independently verified which rule Google's ingestion
implementation actually applies
([docs/data-sources.md](../docs/data-sources.md)).

## Display modes (exploration 02)

`exploration/02_s5p_no2_display_modes.js` adds a display-mode selector
with two ways to color the same mean-NO₂ composite. Both are
visualization choices only: every number involved (scale limits, fade
values, percentile choices, opacities) is a display setting, not an
air-quality threshold, AQI value, health category, or analysis
parameter.

### Absolute NO₂ view

- Purpose: show the mean tropospheric NO₂ column on a fixed numerical
  color scale so the same color corresponds to the same column density
  in every date range (at this display stretch).
- How it is drawn: a fixed display stretch of 0 to 2.0 × 10⁻⁴ mol/m²
  (the range script 01 used) with a sequential single-hue blue ramp
  (the five darkest steps of the ColorBrewer "Blues" 9-class scheme,
  trimmed so the lightest displayed color still stands out against a
  light basemap). Pixel opacity ramps linearly from fully transparent
  at 2.0 × 10⁻⁵ mol/m² to fully opaque at 5.0 × 10⁻⁵ mol/m² (10 % and
  25 % of the display maximum), so the lowest values fade out and the
  basemap stays visible.
- Limitations: values above the display maximum all render as the
  darkest color. Faded or transparent areas are not necessarily missing
  data; the fade is a display aid, and truly missing pixels (no valid
  retrieval) are also transparent, so the two can look alike in this
  view.

### Relative pattern view

- Purpose: make within-period spatial structure easier to see. The
  color range is stretched to the selected period's own values, so
  subtle spatial differences become visible even when the period's
  values occupy a narrow part of the absolute scale.
- How it is drawn: color limits are the 2nd and 98th percentiles of the
  selected-period mean composite within the study region (a common
  robust-stretch convention), computed at the script's 5000 m reduction
  scale and used only for visualization. The ramp is a sequential
  single-hue purple (the five darkest steps of ColorBrewer "Purples"
  9-class), deliberately a different hue from the absolute view so
  images of the two modes are hard to confuse, drawn at fixed 0.75
  layer opacity so streets and terrain stay visible.
- Limitations: the stretch is recomputed for every date range, so
  colors in this mode must not be compared between different periods; a
  dark purple in one period can correspond to a much lower column
  density than the same purple in another. The panel and legend state
  this. When a period has too little valid data (or values too uniform
  to form a stretch), the script says so and shows no NO₂ layer in this
  mode. Percentile limits are display parameters, not analysis
  statistics.

Both ramps were checked with a palette validator during development
(monotone lightness, visible step gaps, light-end contrast against a
light surface, single hue).

## Daily composites (exploration 03)

`exploration/03_s5p_no2_daily_composites.js` inspects the raw temporal
structure of the collection and compares the image-level series with a
provisional calendar-day series. The daily compositing method used here
(arithmetic mean of each date's raw images) is an exploratory
placeholder so the comparison can be inspected; the final method
remains an open owner decision (see
[docs/methodology.md](../docs/methodology.md)).

How the daily collection is built, fully server-side (an `ee.List` of
day offsets is mapped with `dropNulls`; no client-side loop touches
Earth Engine computation):

- For every calendar date in the selected range, the raw collection is
  filtered to that date and the source images are counted.
- Dates with at least one source image get one provisional composite
  (the arithmetic mean of that date's raw images) carrying the
  properties `system:time_start` (start of the calendar date),
  `date_string` (`YYYY-MM-dd`), and `source_image_count`.
- Dates with no source image are excluded from the daily collection but
  are still counted in the panel summary.

Terminology: a source-image day is a calendar date with at least one
raw collection image intersecting the region, not necessarily a day
with usable NO₂ data. Its provisional daily regional mean can still be
null when every relevant pixel over the region is masked (clouds or
quality filtering); only days with a non-null regional mean are called
valid/usable days in the UI. The valid-day counts are derived from the
same evaluated regional-mean results that feed the chart; no extra
reduction pass is made for the summary.

Analysis/display separation, per
[docs/methodology.md](../docs/methodology.md): raw and daily analysis
images stay unclipped, and the regional reducers receive the BAAQMD
geometry directly at an explicit 5000 m scale with no `bestEffort` and
no `reproject()`; both chart series are computed this way. Only the two
map layers (period mean of the raw collection, period mean of the
provisional daily composites) are clipped, and both use one shared
fixed display stretch (0 to 2.0 × 10⁻⁴ mol/m²) so their spatial
patterns can be compared visually. The 5000 m scale is itself an
exploration-stage choice.

The panel summary distinguishes collection presence from usable data.
It reports: total raw images intersecting the study region; total
calendar days in the range; days with at least one source image; days
with none; days with a valid (non-null) provisional daily regional
mean; days with source images but no valid regional mean; the
percentage of calendar days with a valid daily regional mean; and the
min/median/max number of source images per source-image day.

## Completed explorations 04 and 05

Both live tests used the default 2023-01-01 to 2023-04-01 test period
(one region and period, not proof of global collection behavior) and
closed the preprocessing investigation. Full corrected collection model
in [docs/data-sources.md](../docs/data-sources.md).

Exploration 04 established:

- Normal Bay Area collection members are orbit-product assets, not
  multiple tiles of one product: 1,276 raw assets contained 1,276
  distinct `PRODUCT_ID` values and 1,276 distinct `ORBIT` values, one
  asset per product. Grouping by `PRODUCT_ID` remains a defensive step
  for the official antimeridian two-asset exception.
- `filterBounds(BAAQMD)` is footprint intersection only: of the 1,276
  products, only 101 actually contributed valid unmasked NO₂ data over
  BAAQMD (57 days with one valid contributor, 22 with two, 11 with
  none).
- Products without valid BAAQMD pixels do not change the daily result;
  Earth Engine masks ignore them, and the all-products and
  valid-contributors-only daily means were identical on every
  comparable day.

Exploration 05 established:

- Sequential 7-day chunked evaluation prevents the 90-day interactive
  timeout (long ranges are split into consecutive local-date chunks and
  combined client-side).
- The rolling default correctly uses the latest seven Bay Area local
  calendar days represented in the OFFL collection (OFFL publication
  lags real time).
- The 2023 test period contained 9 non-NOMINAL products, of which only
  2 actually contributed over BAAQMD. Excluding non-NOMINAL products
  changed the daily result on 2023-01-20 and removed all valid data on
  2023-02-15, so non-NOMINAL products must not be automatically
  discarded; affected dates are flagged and retained.
- No final minimum-coverage threshold and no final processor-correction
  method were selected; no further detailed product-level investigation
  is required at the current project stage.

### PRODUCT_QUALITY policy

A project policy, not a claim that degraded products are scientifically
equivalent to nominal products: the exploratory daily series uses valid
masked Sentinel-5P observations regardless of `PRODUCT_QUALITY`;
quality metadata is retained and displayed; days containing
contributing non-NOMINAL products are flagged, never silently excluded;
and flagged days are not treated as equally reliable without
qualification. A future formal analysis may compare all-quality and
NOMINAL-only variants; that is not required before continuing the
dashboard project.

### Accepted working daily rule

The accepted working rule for the implementation phase, practical but
not scientifically final:

- Bay Area local calendar dates (`America/Los_Angeles`);
- defensive `PRODUCT_ID` reconstruction (antimeridian exception);
- pixel-wise arithmetic mean of same-date orbit products, relying on
  Earth Engine masks so non-contributing products do not affect the
  daily image;
- valid-area fraction calculated and retained for every daily regional
  statistic;
- valid negative retrievals preserved;
- `EPSG:3310` at 7000 m as exploration settings, not final universal
  resolution claims.

## Exploratory baseline and anomaly (exploration 06)

`exploration/06_s5p_no2_monthly_baseline_anomaly.js` implements the
exploratory historical baseline and satellite-column anomaly phase
(working description "Satellite NO₂ Column Anomaly Explorer"). Its live
regression test was accepted 2026-07-18. Every result is a Sentinel-5P
tropospheric NO₂ satellite-column result, never AQI, health categories,
surface concentration, source attribution, or an episode declaration.
The historical-baseline policy was decided afterward (2026-07-19,
Outcome B); script 06 predates the policy's full-window availability
rule and is intentionally unchanged as an exploration reference (see
[docs/methodology.md](../docs/methodology.md)).

### Method

- For every target Bay Area local calendar date, the baseline uses
  daily images from the same calendar month in the previous N years
  (Historical years control: integer 1-5, default 3), only years
  earlier than the target year, never the target year and never future
  dates. Month windows ending on or before the OFFL collection start
  (late June 2018) are skipped and reported, never substituted. A
  month-crossing target period gets a separate baseline sample per
  target month.
- The regional historical median is the median of the pooled non-null
  historical daily area-weighted BAAQMD regional means; it feeds the
  charts and the anomaly and percentile numbers.
- Signed anomaly = target daily regional mean − matched regional
  historical median. Percentile rank = 100 × (count of historical
  values ≤ the target value) ÷ (count of non-null historical values),
  with the 10th/90th percentiles as descriptive references only. No
  percentage-change metric is computed; nulls stay null; nothing is
  interpolated.
- The mapped historical median (pixel-wise median of historical daily
  images) exists only for the map display. The regional and mapped
  medians are related but not mathematically identical; the panel
  states this.
- Quality and coverage: valid negative retrievals are preserved; no
  minimum valid-area threshold is adopted (the 0.20 figure is a caution
  label inherited from the script 05 sensitivity study); the valid-area
  fraction accompanies every target daily statistic; target non-NOMINAL
  flags are based on actual BAAQMD contribution, while the lightweight
  historical baseline path does not audit contribution-level
  `PRODUCT_QUALITY` (historical valid observations are retained and the
  limitation is disclosed in the panel and Console).
- Processor versions are normalized for display and set comparison
  (e.g. `02.09.01` → `2.9.1`); mixed historical versions and
  target-vs-baseline set differences produce cautions only; nothing is
  automatically excluded or corrected.

### Map layers (all display-only; never used for statistics)

1. Target-period mean satellite NO₂ column (the fixed scripts 03-05
   display stretch).
2. Mapped historical monthly median, pixel-wise (same fixed stretch).
3. Mean signed anomaly, fixed comparison scale: a symmetric diverging
   stretch, identical for every period; use this view for cross-period
   display comparison.
4. Mean signed anomaly, detail display stretch: symmetric limits from
   the larger magnitude of the request-specific 2nd/98th anomaly
   percentiles over BAAQMD. Display-only, not a threshold, and not
   comparable across periods.
5. Minimum historical valid-day count: data availability, not pollution
   and not NO₂ magnitude. The stretch spans the observed count range (a
   visualization change only); the absolute integer counts are
   unchanged and Inspector-accessible.

### Live-test findings (observed; not universal dataset behavior)

From the accepted 2026-07-18 live regression test:

- Default run (local dates 2026-07-03 to 2026-07-10, end exclusive):
  7 of 7 target days valid.
- July baseline at the default 3 historical years: 93 valid historical
  regional days from 2023-2025.
- A month-crossing request created separate June and July baseline
  samples.
- Unavailable prior years were reported without target-year or future
  substitution.
- No-baseline runs retained the target results and returned n/a for
  baseline-dependent statistics; target days without valid data were
  reported.
- Minimum historical valid-day count: observed range 47-93 days
  (theoretical maximum 93 for three years).
- Performance (nonblocking limitation): the two dynamically stretched
  layers (anomaly detail display stretch and valid-day count) can
  render slowly. This limitation is part of why caching and
  precomputation must be evaluated before the public application
  exposes this processing (see
  [docs/architecture.md](../docs/architecture.md)).

## Current status

The audit line through these scripts is complete: the homogeneity
decision and baseline policy are recorded (script 07 plus the R
notebook, 2026-07-19), and the production regional-statistics method
was selected after the full-history 08b daily comparison (2026-07-20).
Application work lives in `app/` (both services deployed 2026-07-20;
see [docs/architecture.md](../docs/architecture.md) and
[docs/ui-data-contract.md](../docs/ui-data-contract.md)). The scripts
in this directory remain the scientific references; reorganizing their
processing into backend modules beyond the deployed slice is an open
owner decision. Still no Episode Finder classification, no health or
AQI interpretation, and anomalies remain labeled satellite-column
anomalies.
