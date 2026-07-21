# Methodology

This document records the project's working definitions, decided
methods, and open questions. Decided items are dated, most recently the
historical-record homogeneity outcome and historical-baseline policy
(2026-07-19) and the production regional-statistics and public map
display methods (2026-07-20). No episode thresholds, persistence rules,
spatial-extent rules, or episode-classification parameters have been
decided. Anything undecided is marked TODO and will be decided by the
project owner, not by coding tools.

Labels used throughout: **Official** means stated by an official source
(links and access dates in [data-sources.md](data-sources.md));
**Observed** means a result of our own live Earth Engine tests, for one
region and period, not proof of global collection behavior;
**Interpretation** means our working reading or hypothesis; **Open**
means an unresolved owner decision; **Planned** means validation or
audit work not yet performed.

## Working definition: air-quality episode

For this project, an air-quality episode means a period when pollution
indicators are:

1. unusually elevated compared with a baseline,
2. persistent across multiple days, and
3. spatially widespread, affecting more than a small isolated area.

This is the app's working definition, not a universal scientific
standard, and the app will make it visible to users.

### Episode label levels

The app will distinguish between:

- No strong episode signal
- Localized anomaly
- Possible regional episode
- Strong regional episode

TODO: define the criteria that separate these levels (magnitude,
persistence, spatial extent, evidence agreement). Not decided.

## Pollutants and indicators

### NO₂ (first focus)

NO₂ is the first focus because it connects well with satellite
observations. It is treated as a satellite-observed pollution signal
with spatial and temporal patterns, not as a direct measurement of
ground-level exposure. The selected band
(`tropospheric_NO2_column_number_density` from
`COPERNICUS/S5P/OFFL/L3_NO2`, units mol/m²) is a tropospheric vertical
NO₂ column, not a surface concentration, AQI value, health category,
or official air-quality advisory. Dataset details, including the
catalog's Level-3 ingestion description and validity filter, are in
[data-sources.md](data-sources.md).

### PM2.5 (careful, later)

PM2.5 matters for wildfire smoke and public concern, but the app must
not imply PM2.5 is directly observed from a single satellite image. Any
PM2.5 work will be framed as an estimate/evidence workflow that may
combine satellite-related indicators, reanalysis or model data, and
ground-monitor comparison.

TODO: decide whether and when PM2.5 enters scope, and the estimation
approach.

## Temporal unit and daily compositing (open)

The first dataset is delivered as a collection of orbit-product assets:
one Level-3 grid per Sentinel-5P product/orbit (**Official**; see the
corrected collection model in [data-sources.md](data-sources.md)).
**Observed** (script 04 live test, default period): roughly 14-15
orbit-product assets intersect the BAAQMD region's footprint on a
typical local calendar day, but footprint intersection does not mean
the asset contributes valid NO₂ pixels over BAAQMD. A raw collection
member must not be described as one daily observation, and a raw
collection count is not a daily contributor count. Charts built
directly on the raw collection (exploration scripts 01 and 02) are
exploratory collection-member-level series, not the daily time series
that episode analysis will use.

Explorations 04 and 05 completed the preprocessing investigation
(2026-07-18). Script 04's contribution audit (**Observed**, 2023 test
period) found that only 101 of 1,276 footprint-intersecting products
contributed valid BAAQMD data (57 one-contributor days, 22
two-contributor days, 11 days with none) and confirmed that Earth
Engine masks ignore non-contributing products: all-products and
valid-contributors-only daily means were identical on every comparable
day. Script 05 added the quality, overlap, and coverage-sensitivity
findings plus sequential 7-day chunked evaluation (a 90-day single
evaluation times out interactively). On that basis the project adopted
an accepted working daily rule, practical but not scientifically final:

- Bay Area local calendar dates (America/Los_Angeles);
- defensive PRODUCT_ID reconstruction (antimeridian exception);
- pixel-wise arithmetic mean of same-date orbit products, relying on
  Earth Engine masks so non-contributing products do not affect the
  daily image;
- valid-area fraction calculated and retained for every daily regional
  statistic;
- valid negative retrievals preserved;
- EPSG:3310 at 7000 m as exploration settings only.

The following remain unresolved owner decisions for the final
scientific method: the final daily compositing rule; how multiple
same-date source images are combined; whether a daily mean, median,
mosaic, or another method is appropriate; how dates with no usable
retrievals are represented; the minimum valid spatial coverage required
for a daily value; and how the daily series will later support
persistence and episode detection.

## Processing flow: analysis vs. display

```text
Raw Sentinel-5P collection
  → calendar-day composites
  → analysis images
  → regional statistics and baseline/anomaly products
  → display images and UI layers
```

Rules:

- Map clipping, layer opacity, palettes, percentile stretches, and
  transparency masks are display operations only. Display masks must
  not affect scientific statistics.
- Analysis images generally remain unclipped when a reducer already
  receives the BAAQMD geometry; copies used for map presentation may be
  clipped to the study region.
- Fixed and relative color scales help interpret the map but do not
  define pollution thresholds or episode criteria.

## Scale, projection, and reducers

Working rules recorded from the official Earth Engine guides:

- Earth Engine determines computation scale from the output request,
  and changing scale can change computed statistics.
- Final scientific `reduceRegion()` calls must use an explicit, stable
  scale or an explicitly documented CRS and transform.
- `bestEffort` may silently use a coarser scale. It must not be used
  for reproducible baseline, anomaly, or episode metrics; it is
  acceptable only in clearly labeled exploratory UI diagnostics.
- `reproject()` should be avoided unless a specific documented reason
  requires it.
- Reducer weighting, partial pixels, masked pixels, and boundary-edge
  behavior must be evaluated before final regional statistics are
  defined (done for the production regional statistic; see below).

## Preprocessing and quality findings

Explorations 04-05 completed the product-metadata audit,
actual-contribution measurement, quality comparison, and initial
coverage-sensitivity scenarios; further detailed product-level
investigation is deferred.

### Product metadata

For every orbit-product asset in a study period the audit inspected
`PRODUCT_ID`, `ORBIT`, `PROCESSING_STATUS`, `PRODUCT_QUALITY`,
`PROCESSOR_VERSION`, `ALGORITHM_VERSION`, `SPATIAL_RESOLUTION`, the
acquisition time, and the derived local calendar date. The exact string
used for a nominal status is never assumed until actual metadata values
are inspected.

### PRODUCT_QUALITY policy (adopted)

Project policy, not a claim that degraded products are scientifically
equivalent to nominal products: the daily series uses valid masked
Sentinel-5P observations regardless of PRODUCT_QUALITY; quality
metadata is retained and displayed; days containing contributing
non-NOMINAL products are flagged and kept, never silently excluded; and
flagged days are not treated as equally reliable without qualification.
**Observed** (script 05, 2023 test period): 9 non-NOMINAL products, of
which 2 contributed over BAAQMD; excluding them changed the daily
result on 2023-01-20 and removed all valid data on 2023-02-15. A formal
all-quality vs NOMINAL-only comparison is optional future work.

### Actual BAAQMD contribution

For every orbit product the audit records whether it contains valid
unmasked NO₂ pixels over BAAQMD, the valid pixel area inside BAAQMD,
the valid-area fraction, the regional mean NO₂ column, the product ID
and orbit, and the local acquisition date. Only products with valid
regional pixels count as actual daily contributors; footprint
intersection alone is not contribution.

### Negative values

**Official.** Retrieval noise can produce valid negative
tropospheric-column values. Rules: do not clamp negative analysis
values to zero; do not remove negative values automatically; display
styling may visually fade values, but display masking must not alter
the analysis; any extreme-outlier rule requires explicit source support
and sensitivity testing before adoption. No numerical outlier threshold
is defined.

### Regional statistic (area weighting)

```text
regional mean       = sum(NO2 × valid pixel area) / sum(valid pixel area)
valid-area fraction = sum(valid pixel area) / total BAAQMD area
```

The valid-area fraction must accompany every daily regional value: two
identical regional means computed from 90 % and from 15 % of the region
describe very different amounts of evidence. **Adopted (2026-07-20):**
the area-weighted regional mean with its valid-area fraction is the
production regional statistic, computed on the canonical native lattice
(see the production method section below). The exploratory
implementations in scripts 04-07 (EPSG:3310 / 7000 m) remain the
documented exploration/reference path.

### Analysis grid

The grid question is decided for the regional statistic only
(2026-07-20): computation on the canonical native L3 lattice
(EPSG:4326, exact `crs` + `crsTransform`, no scale argument), selected
after the full-history 08b daily audit. The previously planned
5.5/7/10 km equal-area sensitivity study was not performed and is no
longer required for the regional statistic. The public map display
method is also decided (below). Still **Open**: the grid for any
eventual spatial-extent (episode) analysis, and the spatial-extent
methodology itself. The fine 0.01° grid is oversampled relative to the
native TROPOMI footprint; neighboring cells are not independent
one-kilometre observations, and neither decision makes the canonical
grid the episode-spatial-analysis grid.

### Calendar-day rule

`America/Los_Angeles` is the daily grouping convention. Products are
filtered to the local-midnight window; only products with valid BAAQMD
pixels are actual contributors; product IDs, orbit numbers, coverage,
and overlap are retained for traceability. The final multi-product
combination rule for the scientific method remains **Open**.

### Coverage sensitivity

No hard minimum-coverage threshold is imposed. The candidate coverage
requirements (any valid coverage, at least 20 %, 40 %, or 60 %) were
sensitivity-test candidates only, never approved thresholds. The
candidate comparison was performed retrospectively in
`analysis/s5p_no2_historical_homogeneity.Rmd` (retained-day counts,
rank and anomaly-sign changes, seasonal sampling effects, source-year
representation); candidate thresholds disproportionately removed winter
observations, and the decided historical-baseline policy adopts no hard
valid-area-fraction exclusion. Every valid retrieval is retained with
its valid-area fraction exposed. Low-coverage values may still be
displayed with a quality warning; that display convention remains open.

## Processor-version and historical-consistency audit

**Official** (per the NO₂ Product Readme File, issue 2.9; sources in
[data-sources.md](data-sources.md)). A multi-year TROPOMI time series
may be affected by processor, algorithm, auxiliary-data, and
spatial-resolution changes. The readme advises using the reprocessed
RPRO record throughout the period where RPRO is available and the
latest OFFL record afterward, specifically discussing the combination
of the version-2.4 RPRO dataset with OFFL versions 2.4 and 2.5 from
26 July 2022 onward, and cautions that processor version 2.6 reduced
midlatitude-winter NO₂ relative to version 2.4, so it should be used
cautiously in time-series analysis. This is not an unconditional
homogeneity guarantee for later OFFL products, and we do not claim that
Earth Engine already supplies the recommended RPRO/OFFL combined
record.

**Audit (completed 2026-07-19).** Exploration script 07
(`earthengine/exploration/07_s5p_no2_historical_homogeneity_export.js`)
exported full-history daily audit tables (2018-present), and the
accepted R report `analysis/s5p_no2_historical_homogeneity.Rmd`
summarized processor and algorithm versions through time, located
contributor-scoped version-transition dates, examined coverage,
missingness, and transition windows, and ran a retrospective
baseline-robustness study across all eligible target months from 2020
onward.

**Decision (project owner, 2026-07-19): Outcome B.** The Earth Engine
Sentinel-5P OFFL record is usable for exploratory historical comparison
with explicit restrictions; it must not be treated as an
unconditionally homogeneous 2018-present trend record. The adopted
restrictions are the historical-baseline policy in the next section.
The alternative responses (restricting the baseline to a single
homogeneous period, stratifying or modeling by processing version, or
using official RPRO Level-2 files outside Earth Engine) were not
chosen; the RPRO/Level-2 option remains a recorded future possibility
(see [architecture.md](architecture.md)) if rigorous long-term trend
analysis is ever required.

## Decided historical-baseline policy (Outcome B, 2026-07-19)

Recorded by the project owner after reviewing the accepted full-history
homogeneity report. This policy governs how baseline, anomaly, and
percentile results are calculated and presented. It defines no episode
thresholds, persistence rules, or spatial-extent rules, and its output
is an exploratory rolling comparison, never a homogeneous long-term
trend product.

1. Use the previous three same-calendar years.
2. Pool all valid daily BAAQMD regional means from those years.
3. Baseline = median of that pooled historical sample.
4. Signed anomaly = target daily regional mean − historical median.
5. Percentile = percentage of historical values ≤ the target.
6. Require all three requested prior years to supply at least one
   valid same-calendar-month observation before presenting the
   official anomaly or percentile.
7. When the reference window is structurally partial, retain and
   display the raw daily satellite value and valid-area fraction, but
   report the baseline/anomaly/percentile as unavailable because the
   full historical window is not represented.
8. Do not require exact processor-version or algorithm-version
   matching; the retrospective audit showed those variants are
   unavailable for most targets and completely unavailable for the
   evaluated 2026 targets.
9. Do not calculate processor correction factors.
10. Apply no hard valid-area-fraction exclusion to the baseline;
    retain every valid retrieval and expose the valid-area fraction
    (the audit showed candidate thresholds disproportionately remove
    winter observations).
11. Continue retaining and flagging days with contributing non-NOMINAL
    products.
12. Disclose processor/algorithm changes and state that the result is
    an exploratory rolling comparison, not a homogeneous long-term
    trend, causal processor analysis, surface concentration, AQI,
    health measure, or episode classification.

Implementation status: exploration script 06 predates points 6-7; it
reports unavailable prior years but still presents baseline statistics
from partially represented windows. Script 06 is intentionally
unchanged as an exploration reference. Any user-facing feature
presenting official anomalies or percentiles must implement the
full-window availability rule (the deployed backend does). The
UI-facing semantics of this policy are specified in
[ui-data-contract.md](ui-data-contract.md).

## Production regional-statistics method (decided 2026-07-20)

**Audit basis.** Exploration 08a (accepted v2 pilot) distinguished
exact projection-signature identity from pixel-grid compatibility,
validated the fixed canonical native-lattice calculation over four
pilot windows, and defined the compatibility rule: equal CRS; x/y scale
and shear within 1e-9 of canonical; translation differences within 1e-6
of an integer pixel offset. Exploration 08b then exported the
full-history daily regional-method comparison. All 08b exports are
complete (2026-07-20): nine yearly daily CSVs (2018-2026), the
manifest, and the optional projection-summary batch export (roughly a
12-hour run). The projection summary was archival confirmation only;
the decision was finalized without it and nothing below depends on it.

**Projection-summary export results (Observed; independently checked
from the owner-provided CSV, 2026-07-20).** 207 calendar-year ×
exact-projection-signature rows spanning 2018 through 2026, with 44
distinct exact projection signatures, all EPSG:4326, all compatible
with the canonical grid, all belonging to one compatible lattice group
(nominal scale ≈ 1113.1949 m). Summed asset count and summed distinct
PRODUCT_ID count are both 41,192 (2,679 in the 2026 window). This
independently confirms the startup-catalog conclusion: exact affine
origins vary, but every observed projection is an integer-pixel shift
of one compatible 0.01° lattice. The CSV is audit evidence only; it is
not read by the application runtime.

**Verified full-history daily results (Observed; independently verified
from the nine completed daily CSV exports):**

- Study period 2018-06-28 through 2026-07-09 inclusive: 2,934 requested
  local calendar dates (America/Los_Angeles), none missing, none
  duplicated; one explicit zero-product date retained (2025-11-02).
- Availability: valid regional values on 2,791 days (legacy method),
  2,786 (native), 2,786 (both). Availability differed on only 5 dates;
  on all five, the legacy method returned a value from extremely small
  regional coverage (largest legacy valid-area fraction among them
  ≈ 0.268 %) while the native method returned no valid value.
- Regional-value comparison: full-record Spearman rank correlation
  ≈ 0.9717; median absolute relative regional-mean difference ≈ 1.55 %;
  mean native-minus-legacy valid-area-fraction difference ≈ −2.30
  percentage points (native lower on 2,068 dates, equal on 835, higher
  on 31).
- Projection validation (year-by-year startup catalog): 44 distinct
  exact projection signatures, all classified as one compatible pixel
  lattice; no genuinely incompatible source projection found. The
  projection-summary export independently confirms this.

**Adopted-baseline robustness (Observed; same source).** On dates where
both methods had a valid target value and a complete
previous-three-year same-calendar-month window: 1,775 comparable target
dates; anomaly sign agreed on 1,680 of 1,775 (≈ 94.65 %); median
absolute percentile difference ≈ 2.30 percentile points; percentile
≥ 90 on 202 dates (legacy), 207 (native), 175 (both). Interpretation:
the two methods are strongly consistent overall but not interchangeable
on every individual date; the valid-area fraction must remain visible
with every value; one method must be used consistently in production.

**Decision (project owner, 2026-07-20).** The production
regional-statistics method is the canonical native-lattice regional
calculation:

- CRS `EPSG:4326` with affine transform
  `[0.01, 0, -180, 0, 0.01, -90]`, used as the exact canonical
  `crs` + `crsTransform` with no scale argument;
- source signatures must satisfy the accepted 08a v2 compatibility
  rule;
- valid negative retrievals preserved; no hard valid-area cutoff; no
  interpolation; no bestEffort;
- the valid-area fraction is exposed with every value;
- contributing non-NOMINAL products are retained and flagged.

The legacy EPSG:3310 / 7000 m reduction is reclassified as an
exploration/reference method: it remains the documented statistics path
of exploration scripts 04-07 and the audit comparisons.

**Scope limit.** This decision selects the regional-statistics
reduction only. It does not select the eventual spatial-extent analysis
grid, an episode threshold, a persistence rule, a spatial-extent rule,
or any AQI or health interpretation. The public map display method is a
separate owner decision (next section).

**Reproducibility note (ingestion timing).** The interactive
year-by-year startup catalog counted 41,187 assets; the completed batch
exports contain 41,192 because five additional within-window 2026 OFFL
assets were observed during the later batch evaluation. This is
consistent with asynchronous collection ingestion and does not change
the date range, the compatibility result, or the method decision.

## Public map display method (decided 2026-07-20)

Owner decision; applies to public map visualization only.

**Primary public map product.** The default scientific map layer is the
"Sentinel-5P tropospheric NO₂ column anomaly": a signed pixelwise
anomaly, the target daily canonical-lattice composite minus the
pixelwise historical median for the same calendar month. The map
baseline follows the adopted historical-baseline policy: previous three
same-calendar years; all three requested prior years must contribute
valid same-month observations; pixelwise median of the valid historical
daily images; no future or target-date leakage; no processor correction
factors; no hard valid-area cutoff; valid negative retrievals retained;
contributing non-NOMINAL products retained and flagged. Both the target
composite and the historical images use the canonical native lattice.
The mapped pixelwise median and the regional pooled median of the
numeric baseline are related but not identical (the script 06
distinction). A raw daily-column map may be considered later as a
separate selectable layer; it is not selected now, and the anomaly
layer never silently falls back to it.

**Grid and tile behavior.**

- Source CRS `EPSG:4326` with affine transform
  `[0.01, 0, -180, 0, 0.01, -90]`, assigned with
  `setDefaultProjection()`;
- no separate 5.5 km, 7 km, or 10 km aggregation is introduced for
  display;
- Earth Engine serves normal map tiles, and tile rendering performs the
  display reprojection to Web Mercator;
- valid negative retrievals are preserved;
- displayed cells are oversampled and must never be used to infer
  episode extent or independent 1 km observations.

**Availability behavior (no silent fallback).** If the complete
prior-three-year baseline is unavailable for a date (structurally
partial window), no anomaly tile layer is served or loaded; the basemap
and any available official boundary remain, and the UI shows "Anomaly
map unavailable: a complete three-year historical baseline is not
available for this date." Dates with no products or no valid retrieval
likewise show their documented states, never an anomaly layer.
Structurally partial dates may still show the raw regional numeric
value and its valid-area fraction, but the anomaly map, the anomaly
number, and the percentile are unavailable.

**Required legend and explanatory text.** The legend and accompanying
text must identify the layer as "Sentinel-5P tropospheric NO₂ column
anomaly"; the legend renders from backend-supplied visualization
metadata (no fixed palette or numeric limits are decided here); and the
text must explain that the 0.01° display grid is oversampled relative
to the TROPOMI sensor footprint, that neighboring display cells are not
independent 1 km observations, and that the layer is not surface
concentration, AQI, health advice, or an episode classification.

Still open (not settled by this decision): the grid for future
spatial-extent calculations; episode thresholds; persistence rules;
spatial-extent rules; any final episode-classification method.

## Exploratory baseline and anomaly (script 06)

Exploration script 06
(`earthengine/exploration/06_s5p_no2_monthly_baseline_anomaly.js`)
implements the exploratory historical baseline and satellite-column
anomaly visualization; its live regression test was accepted
2026-07-18. Everything in this section is exploratory, not a final
climatology. The historical-baseline policy was decided afterward
(2026-07-19); script 06 predates its full-window availability rule
(policy points 6-7) and is intentionally unchanged as an exploration
reference. All results are Sentinel-5P tropospheric NO₂
satellite-column results, never AQI, health categories, surface
concentrations, source attribution, or episode declarations.

### Method

Built on the accepted working daily rule (Bay Area local calendar
dates; defensive `PRODUCT_ID` grouping; arithmetic mean of same-date
orbit products; area-weighted regional means with valid-area fractions
at EPSG:3310 / 7000 m exploration settings):

- **Baseline sample.** For each target date, the baseline uses daily
  images from the same calendar month in the previous N years
  (Historical years control: integer 1-5, default 3). Only years
  strictly earlier than the target year are used, never the target year
  and never future dates. Month windows that end on or before the OFFL
  collection start (late June 2018) are unavailable: they are skipped
  and reported (requested vs available years), never substituted. A
  target period crossing a month boundary gets a separate month-matched
  baseline sample per target month.
- **Regional historical median.** The median of the pooled non-null
  historical daily area-weighted regional means.
- **Signed anomaly** = target daily regional mean − matched regional
  historical median. A positive anomaly means the satellite-observed
  column was above its exploratory same-calendar-month historical
  median, nothing more.
- **Percentile rank** = 100 × (count of historical values ≤ the target
  value) ÷ (count of non-null historical values). The 90th/10th
  percentile labels are descriptive references only.
- No percentage-change metric is computed. Nulls remain null: a target
  day without a valid regional value, or without any baseline sample,
  gets null anomaly and percentile values; nothing is interpolated.

### Two historical summaries, related but not identical

- **Regional historical median**: the median of historical daily BAAQMD
  regional means, used by the charts and all regional anomaly
  statistics.
- **Mapped historical median**: the pixel-wise median of historical
  daily images, used only by the map display.

The two are not mathematically identical, and the script's panel states
this wherever both appear.

### Quality and coverage handling

- Valid negative retrievals are preserved.
- No minimum valid-area threshold is adopted. The 0.20 valid-fraction
  figure inherited from the script 05 sensitivity study is a caution
  label only; nothing is excluded because of it.
- The valid-area fraction accompanies every target daily statistic.
- Target-period non-NOMINAL flags are based on actual BAAQMD
  contribution (the fully audited product path).
- The lightweight historical baseline path does not audit
  contribution-level `PRODUCT_QUALITY`. Historical valid observations
  are retained, and this limitation is disclosed in the script's panel
  and Console output.

### Processor-version handling

Processor-version strings are normalized for display and set comparison
(e.g. `02.09.01` → `2.9.1`); genuine version differences are preserved.
Mixed processor versions within a baseline sample, and differences
between the target and baseline version sets, produce cautions only;
nothing is automatically excluded or corrected.

### Map layers and display stretches (display-only)

Five map layers, all display-only clipped copies that never feed the
regional statistics:

1. Target-period mean satellite NO₂ column;
2. Mapped historical monthly median (pixel-wise);
3. Mean signed anomaly, fixed comparison scale;
4. Mean signed anomaly, detail display stretch;
5. Minimum historical valid-day count.

The detail anomaly limits are symmetric, taken from the larger
magnitude of the request-specific 2nd/98th percentiles of the anomaly
image over BAAQMD. This is display-only, not a threshold, and not
comparable across periods; the fixed anomaly scale remains the view for
cross-period comparison. The count layer's stretch spans the observed
count range; the absolute integer counts are unchanged and
Inspector-accessible.

### Live-test findings (Observed; one configuration, not universal)

From the accepted 2026-07-18 live regression test:

- Default run (local dates 2026-07-03 to 2026-07-10, end exclusive):
  7 of 7 target days valid.
- July baseline at the default 3 historical years: 93 valid historical
  regional days from 2023-2025.
- A month-crossing request created separate June and July baseline
  samples.
- Unavailable prior years were reported without target-year or future
  substitution.
- Runs with no available baseline windows retained the target results
  and returned n/a for baseline-dependent statistics; target days
  without valid data were reported.
- Minimum historical valid-day count: observed range 47-93 days
  (theoretical maximum 93 for three years).
- Performance limitation (nonblocking, exploration stage): the two
  dynamically stretched layers (anomaly detail stretch and valid-day
  count) can render slowly. Recorded as a limitation only; the
  precomputation option is noted in
  [architecture.md](architecture.md).

## Validation phase (before episode classification)

**Planned.** A validation phase precedes Episode Finder work. Planned
comparisons: BAAQMD or EPA surface NO₂ monitors; monitor measurements
near the TROPOMI overpass time; wind speed and direction;
planetary-boundary-layer height if available; cloud and retrieval
coverage; temperature or other relevant meteorological context. No
monitor datasets or meteorological providers are chosen yet
([data-sources.md](data-sources.md)).

Satellite columns and surface concentrations are not expected to match
perfectly; they describe different atmospheric quantities. Validation
tests whether satellite enhancements correspond meaningfully with local
air-quality conditions and should identify the conditions under which
satellite and surface evidence disagree. A 24-hour surface average must
not automatically be treated as equivalent to a satellite overpass
snapshot.

## Planned evidence framework

The episode finder is planned to follow these steps, all visible and
explainable in the app:

1. Load air-quality-related data for the Bay Area.
2. Compare selected or scanned values against a baseline.
3. Check whether elevated values persist.
4. Check whether the pattern is geographically widespread.
5. Compare multiple evidence sources when available.
6. Assign an episode label.
7. Show the evidence and limitations.

### Open methodological decisions

| Decision | Status |
| --- | --- |
| Baseline definition (climatology window, seasonal handling, statistic) | **Decided (2026-07-19)**: same-calendar-month pooled median over the previous three years with the full-window availability rule; script 06 predates the full-window rule and is unchanged |
| "Unusually elevated" criterion (anomaly measure, threshold or percentile) | Partially decided: the anomaly measure (signed anomaly vs the historical median) and ≤-percentile are set by the baseline policy; episode-level criteria remain TODO |
| Persistence criterion (number of days, gap handling) | TODO |
| Spatial-extent criterion (area fraction, contiguity) | TODO |
| Evidence-agreement rules across sources | TODO |
| Episode sensitivity control (user-adjustable?) | TODO |
| Validation approach (known historical events / monitors) | TODO |
| Temporal unit: final daily compositing rule, same-date combination, missing-day representation | TODO (see [Temporal unit and daily compositing](#temporal-unit-and-daily-compositing-open)) |
| Daily contributor definition and multi-product combination rule | TODO |
| Minimum valid daily spatial coverage; daily quality/missingness reporting | **Decided (2026-07-19)**: no hard valid-area-fraction exclusion; every valid retrieval retained with the fraction exposed; low-coverage display warnings remain an open convention |
| Area-weighted regional statistics | **Decided (2026-07-20)**: area-weighted regional mean with valid-area fraction on the canonical native lattice |
| Regional-statistics grid; explicit CRS/transform | **Decided (2026-07-20)**: canonical native lattice, EPSG:4326 with exact `crs` + `crsTransform` `[0.01, 0, -180, 0, 0.01, -90]`, no scale argument (the 5.5/7/10 km equal-area study was not performed) |
| Public map display method | **Decided (2026-07-20)**: signed "Sentinel-5P tropospheric NO₂ column anomaly" per the display-method section above; the episode-spatial-analysis grid remains TODO |
| Episode spatial-extent analysis grid | TODO; not decided by the regional-statistics or map-display decisions |
| Regional reducer; pixel weighting, partial/masked pixels, boundary-edge behavior | **Decided for the regional statistic (2026-07-20)**: binary valid-pixel masks, pixelArea weighting, canonical native lattice. Display/map-grid behavior remains open |
| Non-nominal product exclusion/flagging rule | **Decided (2026-07-19)**: retain and flag days with contributing non-NOMINAL products |
| Historical homogeneity handling (RPRO/OFFL, processor versions) | **Decided (2026-07-19)**: Outcome B; exploratory historical comparison with explicit restrictions; no version matching; no correction factors; changes disclosed |
| Validation design (monitors, overpass timing, meteorological context) | TODO; datasets/providers not chosen |
| Exact Bay Area region definition | **Decided**: official BAAQMD jurisdiction (see [data-sources.md](data-sources.md)) |

## Analysis modes

- Current / recent screening: examine recent data for a possibly
  developing or recently occurring episode.
- Historical episode exploration: scan historical data for past periods
  matching the episode definition, so the project can be demonstrated
  on known or interesting periods.

## Contextual overlays (optional, later)

A possible later feature is a set of optional map overlays that give
geographic context when interpreting NO₂ patterns: major highways and
transportation corridors; industrial and permitted-facility locations;
land-use categories; ports and airports; possibly population density
and meteorological context such as wind.

These overlays would provide geographic context only. Spatial
coincidence must not be presented as proof that a road, facility, or
land-use category caused an observed NO₂ pattern, and Sentinel-5P's
resolution does not support attributing column values to individual
road segments or facilities without additional evidence. No overlay
datasets are selected and nothing is implemented; any future adoption
goes through the evaluation checklist in
[data-sources.md](data-sources.md).

## Language and claims policy

The app and documentation must use careful language, for example:
*possible episode*, *likely regional episode*, *localized anomaly*,
*evidence suggests*, *satellite/reanalysis indicator*, *estimate*,
*limitation*, *uncertainty*.

The app must not:

- present itself as an official air-quality advisory tool,
- claim to replace AirNow, BAAQMD, EPA, or other official sources,
- make health guidance claims,
- claim that satellite imagery directly gives ground-level air quality,
- present machine-learning output as ground truth,
- attribute NO₂ column values to individual highways, road segments,
  neighborhoods, or facilities (visual alignment is geographic
  coincidence, not proof of causation; the grid is oversampled relative
  to the native footprint, so street-level interpretation is false
  precision),
- label a satellite anomaly alone an air-quality episode.

Naming: the initial Sentinel-5P analytical feature carries the working
description "Satellite NO₂ Column Anomaly Explorer". The broader label
"candidate air-quality episode" requires corroborating evidence:
ground monitors, persistence, sufficient coverage, and meteorological
context. The repository and final product are not renamed without an
explicit owner decision.

## Limitations

Every analysis view should carry limitation notes. Known categories:

- Satellite columns vs. ground-level concentrations
- Cloud cover and retrieval-quality gaps
- Temporal aggregation: several orbit-product assets per calendar date,
  footprint intersection vs. actual valid contribution, and sensitivity
  to the daily compositing choice
- Computation scale and reducer configuration sensitivity
- Grid oversampling: the 0.01° Level-3 grid does not represent
  independent one-kilometre observations (native footprint
  ≈ 3.5 × 5.5 km since 6 August 2019; ≈ 3.5 × 7.0 km before)
- Processor/algorithm version history and RPRO/OFFL record consistency
- Baseline choice sensitivity
- Spatial resolution limits
- Monitor coverage and representativeness

TODO: expand with dataset-specific limitations as datasets are
confirmed (see [data-sources.md](data-sources.md)).
