# Methodology (planning draft)

This document records the project's working definitions and the planned
evidence framework. It is a **planning draft**: no thresholds, baselines, or
detection parameters have been decided yet. Anything undecided is marked TODO
and will be decided by the project owner, not by coding tools.

Labels used throughout: **Official** = stated by an official source (links
and access dates in [data-sources.md](data-sources.md)); **Observed** = a
result of our own live Earth Engine tests, for one region and period, not
proof of global collection behavior; **Interpretation** = our working
reading or hypothesis; **Open** = an unresolved owner decision;
**Planned** = validation or audit work not yet performed. No
exploration-stage choice in this document is a final scientific method.

## Working definition: air-quality episode

For this project, an **air-quality episode** means a period when pollution
indicators are:

1. **unusually elevated** compared with a baseline,
2. **persistent** across multiple days, and
3. **spatially widespread** — affecting more than a small isolated area.

This is the app's working definition. It is not presented as a universal
scientific standard used by every agency or context, and the app will make the
definition visible to users.

### Episode label levels

The app will distinguish between:

- **No strong episode signal**
- **Localized anomaly**
- **Possible regional episode**
- **Strong regional episode**

TODO: define the criteria that separate these levels (magnitude, persistence,
spatial extent, evidence agreement). Not yet decided.

## Pollutants and indicators

### NO₂ (first focus)

NO₂ is the planned first focus because it connects well with satellite
observations. It will be treated as a *satellite-observed pollution signal*
with spatial and temporal patterns — not as a direct measurement of
ground-level exposure. The selected band
(`tropospheric_NO2_column_number_density` from `COPERNICUS/S5P/OFFL/L3_NO2`,
units mol/m²) is a **tropospheric vertical NO₂ column** — not a surface
concentration, AQI value, health category, or official air-quality advisory.
Dataset details, including the catalog's Level-3 ingestion description and
ingestion validity filter, are in [data-sources.md](data-sources.md).

### PM2.5 (careful, later)

PM2.5 matters for wildfire smoke and public concern, but the app must not imply
PM2.5 is directly observed from a single satellite image. Any PM2.5 work will
be framed as an **estimate / evidence workflow** that may combine
satellite-related indicators, reanalysis or model data, and ground-monitor
comparison.

TODO: decide whether/when PM2.5 enters scope, and the estimation approach.

## Temporal unit and daily compositing (open)

The first dataset is delivered as a collection of **orbit-product assets**
— one Level-3 grid per Sentinel-5P product/orbit (**Official**; see the
corrected collection model in [data-sources.md](data-sources.md)).
**Observed (script 04 live test, default period):** roughly 14–15
orbit-product assets intersect the BAAQMD region's footprint on a typical
local calendar day, but footprint intersection does **not** mean the asset
contributes valid NO₂ pixels over BAAQMD. A raw collection member must not
be described as one daily observation, and a raw collection count is not a
daily contributor count. Any chart or count built directly on the raw
collection — as in exploration scripts 01 and 02 — is an exploratory
**collection-member-level** series; it is not the final daily time series
that episode analysis will use.

**Status (updated 2026-07-18): explorations 04 and 05 are completed.**
Script 04's contribution audit (**Observed**, 2023 test period) found
that only 101 of 1,276 footprint-intersecting products contributed valid
BAAQMD data (57 one-contributor days, 22 two-contributor days, 11 none)
and confirmed that Earth Engine masks ignore non-contributing products —
all-products vs valid-contributors-only daily means were identical on
every comparable day. Script 05 added the quality, overlap, and
coverage-sensitivity findings plus sequential 7-day chunked evaluation
(a 90-day single evaluation times out interactively). On that basis the
project adopts an **accepted working daily rule for the next
implementation phase** — practical, **not** a scientifically final rule
for all future work:

- Bay Area local calendar dates (America/Los_Angeles);
- defensive PRODUCT_ID reconstruction (antimeridian exception);
- pixel-wise arithmetic mean of same-date orbit products, relying on
  Earth Engine masks so non-contributing products do not affect the
  daily image;
- valid-area fraction calculated and retained for every daily regional
  statistic;
- valid negative retrievals preserved;
- EPSG:3310 at 7000 m as current exploration settings only, not final
  universal resolution claims.

Before baselines, anomalies, persistence checks, or episode detection can be
defined, the project needs a stable calendar-day temporal unit. The
following are **unresolved owner decisions** — none has been chosen yet:

- The final daily compositing rule.
- How multiple source images from the same calendar date are combined.
- Whether a daily mean, median, mosaic, or another method is appropriate.
- How dates with no usable retrievals are represented.
- The minimum valid spatial coverage required for a daily value.
- The final stable analysis scale.
- Whether an explicit CRS or transform is required.
- The regional reducer.
- Pixel-weighting and boundary-edge behavior.
- How daily data quality and missingness will be reported.
- How the daily series will later support persistence and episode detection.

Historical-baseline and anomaly development begins only after the temporal
unit and the final daily compositing approach have been evaluated (see the
script 03 milestone in [roadmap.md](roadmap.md)).

## Planned processing flow: analysis vs. display

The planned data-processing flow keeps analysis and display strictly
separate:

```text
Raw Sentinel-5P collection
  → calendar-day composites
  → analysis images
  → regional statistics and later baseline/anomaly products
  → display images and UI layers
```

Rules:

- Map clipping, layer opacity, palettes, percentile stretches, and
  transparency masks are **display operations only**. Display masks must not
  affect scientific statistics.
- Analysis images should generally remain **unclipped** when a reducer
  already receives the BAAQMD geometry; copies used for map presentation may
  be clipped to the study region.
- Fixed and relative color scales help interpret the map but do not define
  pollution thresholds or episode criteria.

## Scale, projection, and reducers

Working rules recorded from the official Earth Engine guides; the concrete
choices remain owner decisions (see the open decisions above):

- Earth Engine determines computation scale from the output request, and
  changing scale can change computed statistics.
- Final scientific `reduceRegion()` calls must use an explicit and stable
  scale, or an explicitly documented CRS and transform. The final analysis
  scale has not yet been selected.
- `bestEffort` may silently use a coarser scale. It must not be used for
  final reproducible baseline, anomaly, or episode metrics; it may remain
  acceptable only for clearly labeled exploratory UI diagnostics where the
  exact scale is not part of the result.
- `reproject()` should be avoided unless a specific and documented reason
  requires it.
- Reducer weighting, partial pixels, masked pixels, and boundary-edge
  behavior must be evaluated before final regional statistics are defined.

## Preprocessing and quality-audit plan (before any baseline or episode work)

**Status (updated 2026-07-18).** Explorations 04–05 completed this
plan's product-metadata audit, actual-contribution measurement, quality
comparison, and initial coverage-sensitivity scenarios; the practical
PRODUCT_QUALITY policy below was adopted, and further detailed
product-level investigation is **deferred**. The preprocessing gate is
sufficiently complete to begin the next exploratory dashboard feature
(see [roadmap.md](roadmap.md)). Coverage-threshold selection and formal
surface-monitor validation remain future work — not blockers. Where the
subsections below say a rule is open, that remains true for the final
scientific method.

### Product metadata audit

Inspect and summarize, for every orbit-product asset in a study period:
`PRODUCT_ID`, `ORBIT`, `PROCESSING_STATUS`, `PRODUCT_QUALITY`,
`PROCESSOR_VERSION`, `ALGORITHM_VERSION`, `SPATIAL_RESOLUTION`, the
acquisition time, and the derived local calendar date. Do **not** assume
the exact string used for a nominal status until actual metadata values
are inspected. The exclusion/flagging question is resolved practically by
the adopted PRODUCT_QUALITY policy below; a final formal rule remains
optional future work.

### Practical PRODUCT_QUALITY policy (adopted)

**Project policy — not a claim that degraded products are scientifically
equivalent to nominal products.** The exploratory daily series uses
valid masked Sentinel-5P observations **regardless of PRODUCT_QUALITY**;
quality metadata is retained and displayed; days containing contributing
non-NOMINAL products are **flagged** and kept, never silently excluded;
and flagged days are not treated as equally reliable without
qualification. **Observed (script 05, 2023 test period):** 9 non-NOMINAL
products, of which 2 contributed over BAAQMD; excluding them changed the
daily result on 2023-01-20 and removed all valid data on 2023-02-15. A
future formal all-quality vs NOMINAL-only comparison is optional, not
required before continuing the dashboard project.

### Actual BAAQMD contribution

For every orbit product, calculate (or plan to calculate): whether it
contains any valid unmasked NO₂ pixels over BAAQMD; the area of valid
pixels inside BAAQMD; the valid-area fraction; the regional mean NO₂
column; the product ID and orbit; and the local acquisition date. Only
products with valid regional pixels count as **actual daily
contributors** — footprint intersection alone is not contribution.

### Negative values

**Official.** Retrieval noise can produce valid negative
tropospheric-column values. Rules: do **not** automatically clamp negative
analysis values to zero; do **not** automatically remove all negative
values; display styling may visually fade values, but display masking must
not alter the scientific analysis; any extreme-outlier rule requires
explicit source support and sensitivity testing before adoption. No
numerical outlier threshold is introduced in this document.

### Regional statistics (area weighting)

**Interpretation — leading candidate, not finally validated.** The
preferred method to evaluate is the area-weighted regional mean:

```text
regional mean      = sum(NO2 × valid pixel area) / sum(valid pixel area)
valid-area fraction = sum(valid pixel area) / total BAAQMD area
```

The valid-area fraction must accompany **every** daily regional value:
two identical regional means computed from 90 % and from 15 % of the
region describe very different amounts of evidence, and baseline or
anomaly logic that ignores coverage would silently mix them. Area
weighting is documented as the leading scientifically defensible method
but is **not** marked validated until implemented and tested.

### Analysis grid and scale sensitivity

7,000 m is **not** adopted as a final scale. **Planned:** a sensitivity
study in an equal-area California projection at candidate scales such as
5.5 km, 7 km, and 10 km, comparing: daily regional means; valid-area
fractions; spatial patterns; number of usable days; anomaly rankings; and
computational cost. The final scale remains an **Open** owner decision.
The fine 0.01° grid may remain for display, with an explicit warning that
it is oversampled and does not represent independent one-kilometre
observations.

### Calendar-day rule

`America/Los_Angeles` is the current daily grouping convention **under
evaluation**. Planned rules to evaluate: products are first filtered to
the entered local-midnight window; only products with valid BAAQMD pixels
are actual contributors; one valid contributor can be used directly;
several valid contributors require a documented combination rule;
disjoint and overlapping valid coverage should be examined separately;
product IDs, orbit numbers, coverage, and overlap are retained for
traceability. The multi-product combination rule is **Open** — not
finalized.

### Coverage sensitivity

No final minimum-coverage threshold is imposed. **Planned:** compare
candidate coverage requirements — any valid coverage; at least 20 %; at
least 40 %; at least 60 % — as **sensitivity-test candidates only, not
approved thresholds**, measuring the effect of each candidate on:
retained-day count; seasonal sampling bias; geographic
representativeness; daily-value stability; baseline construction; and
anomaly rankings. Low-coverage values may eventually be displayed with a
quality warning even if excluded from baseline construction.

## Processor-version and historical-consistency audit

**Official (per the NO₂ Product Readme File, issue 2.9; sources in
[data-sources.md](data-sources.md)).** A multi-year TROPOMI time series
may be affected by processor, algorithm, auxiliary-data, and
spatial-resolution changes. The readme advises using the reprocessed RPRO
record throughout the period where RPRO is available and the latest OFFL
record afterward — specifically discussing the combination of the
version-2.4 RPRO dataset with OFFL versions 2.4 and 2.5 from
26 July 2022 onward — and cautions that processor version 2.6 reduced
midlatitude-winter NO₂ relative to version 2.4, so it should be used
cautiously in time-series analysis. This is not an unconditional
homogeneity guarantee for every later OFFL product, and we do **not**
claim that Earth Engine already supplies the recommended RPRO/OFFL
combined record.

**Planned audit tasks:** summarize processor and algorithm versions
through time; locate version-transition dates; inspect spatial-resolution
changes; test for discontinuities in the Bay Area series; determine
whether the Earth Engine collection is sufficiently homogeneous for the
planned baseline.

**Open — possible responses if the Earth Engine history is not
homogeneous (none chosen):** restrict the baseline to a homogeneous
period; model or stratify by processing version; use official RPRO
Level-2 files outside Earth Engine for rigorous historical analysis.

## Validation phase (before episode classification)

**Planned.** A validation phase precedes historical-baseline and Episode
Finder work. Planned comparisons: BAAQMD or EPA surface NO₂ monitors;
monitor measurements near the TROPOMI overpass time; wind speed and
direction; planetary-boundary-layer height if available; cloud and
retrieval coverage; temperature or other relevant meteorological context.
No monitor datasets or meteorological providers are chosen yet — they are
in the data-source evaluation queue
([data-sources.md](data-sources.md)).

What validation means here: satellite columns and surface concentrations
are **not expected to match perfectly** — they describe different
atmospheric quantities. Validation tests whether satellite enhancements
correspond meaningfully with local air-quality conditions, and should
identify the conditions under which satellite and surface evidence
disagree. A 24-hour surface average must **not** automatically be treated
as equivalent to a satellite overpass snapshot.

## Planned evidence framework

The episode finder is planned to follow these steps, all of which should be
visible and explainable in the app:

1. Load air-quality-related data for the Bay Area.
2. Compare selected or scanned values against a baseline.
3. Check whether elevated values persist.
4. Check whether the pattern is geographically widespread.
5. Compare multiple evidence sources when available.
6. Assign an episode label.
7. Show the evidence and limitations.

### Open methodological decisions (all TODO)

| Decision | Status |
| --- | --- |
| Baseline definition (climatology window, seasonal handling, statistic) | TODO — not decided |
| "Unusually elevated" criterion (anomaly measure, threshold or percentile) | TODO — not decided |
| Persistence criterion (number of days, gap handling) | TODO — not decided |
| Spatial-extent criterion (area fraction, contiguity) | TODO — not decided |
| Evidence-agreement rules across sources | TODO — not decided |
| Episode sensitivity control (user-adjustable?) | TODO — not decided |
| Validation approach (comparison against known historical events / monitors) | TODO — not decided |
| Temporal unit: daily compositing rule, same-date combination, missing-day representation | TODO — not decided (see [Temporal unit and daily compositing](#temporal-unit-and-daily-compositing-open)) |
| Daily contributor definition (valid-pixel products only) and multi-product combination rule | TODO — not decided |
| Minimum valid daily spatial coverage; daily quality/missingness reporting | TODO — sensitivity candidates only (any/20 %/40 %/60 %), none approved |
| Area-weighted regional statistics | TODO — leading candidate, not implemented or validated |
| Final analysis scale; explicit CRS/transform if required | TODO — sensitivity candidates 5.5/7/10 km, none adopted |
| Regional reducer; pixel weighting, partial/masked pixels, boundary-edge behavior | TODO — not decided |
| Non-nominal product exclusion/flagging rule | TODO — audit first; not decided |
| Historical homogeneity handling (RPRO/OFFL, processor versions) | TODO — audit first; response not chosen |
| Validation design (monitors, overpass timing, meteorological context) | TODO — datasets/providers not chosen |
| Exact Bay Area region definition | **Decided** — official BAAQMD jurisdiction (see [data-sources.md](data-sources.md)) |

## Analysis modes

- **Current / recent screening** — examine recent data for a possibly
  developing or recently occurring episode.
- **Historical episode exploration** — scan historical data for past periods
  matching the episode definition, so the project can be demonstrated on known
  or interesting periods.

## Contextual overlays (optional, later)

A possible later feature is a set of optional map overlays that give
geographic context when interpreting NO₂ patterns: major highways and
transportation corridors; industrial and permitted-facility locations;
land-use categories such as residential, commercial, and industrial; ports
and airports; and possibly population density and meteorological context
such as wind.

These overlays would provide **geographic context only**. Spatial
coincidence must not be presented as proof that a road, facility, or
land-use category caused an observed NO₂ pattern. Sentinel-5P's resolution
also does not support attributing column values to individual road segments
or facilities without additional evidence. No overlay datasets or providers
have been selected and nothing is implemented; any future adoption would go
through the data-source evaluation checklist in
[data-sources.md](data-sources.md).

## Language and claims policy

The app and documentation must use careful language, for example: *possible
episode*, *likely regional episode*, *localized anomaly*, *evidence suggests*,
*satellite/reanalysis indicator*, *estimate*, *limitation*, *uncertainty*.

The app must not:

- present itself as an official air-quality advisory tool,
- claim to replace AirNow, BAAQMD, EPA, or other official sources,
- make strong health guidance claims,
- overclaim that satellite imagery directly gives ground-level air quality,
- present machine-learning output as ground truth,
- attribute NO₂ column values to individual highways, road segments,
  neighborhoods, or facilities (visual alignment is geographic
  coincidence, not proof of causation; the grid is oversampled relative to
  the native footprint, so street-level interpretation is false precision),
- label a satellite anomaly alone an air-quality episode.

Naming: the initial Sentinel-5P analytical feature carries the cautious
working description **"Satellite NO₂ Column Anomaly Explorer"**. The
broader label **"candidate air-quality episode"** requires corroborating
evidence later — ground monitors, persistence, sufficient coverage, and
meteorological context. The repository and final product are not renamed
without an explicit owner decision; the overall project name and broader
dashboard scope are unchanged.

## Limitations (to be expanded during implementation)

Every analysis view should carry limitation notes. Known categories to
document as they become concrete:

- Satellite columns vs. ground-level concentrations
- Cloud cover and retrieval-quality gaps
- Temporal aggregation: several orbit-product assets per calendar date,
  footprint intersection vs. actual valid contribution, and the
  sensitivity of results to the daily compositing choice
- Computation scale and reducer configuration sensitivity
- Grid oversampling: the 0.01° Level-3 grid does not represent independent
  one-kilometre observations (native footprint ≈3.5 × 5.5 km since
  6 August 2019; ≈3.5 × 7.0 km before)
- Processor/algorithm version history and RPRO/OFFL record consistency
- Baseline choice sensitivity
- Spatial resolution limits
- Monitor coverage and representativeness

TODO: expand with dataset-specific limitations once datasets are confirmed
(see [data-sources.md](data-sources.md)).
