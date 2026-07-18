# Methodology (planning draft)

This document records the project's working definitions and the planned
evidence framework. It is a **planning draft**: no thresholds, baselines, or
detection parameters have been decided yet. Anything undecided is marked TODO
and will be decided by the project owner, not by coding tools.

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

The first dataset is delivered as a collection of raw Level-3 images (see
[data-sources.md](data-sources.md)). A raw collection image must **not** be
described as one daily observation: several collection images can carry the
same calendar date, and more than one of them may intersect the BAAQMD
region on that date. Any chart or count built directly on the raw collection
— as in exploration scripts 01 and 02 — is an exploratory **image-level**
series; it is not the final daily time series that episode analysis will
use.

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
| Temporal unit: daily compositing rule, same-date image combination, missing-day representation | TODO — not decided (see [Temporal unit and daily compositing](#temporal-unit-and-daily-compositing-open)) |
| Minimum valid daily spatial coverage; daily quality/missingness reporting | TODO — not decided |
| Final analysis scale; explicit CRS/transform if required | TODO — not decided |
| Regional reducer; pixel weighting, partial/masked pixels, boundary-edge behavior | TODO — not decided |
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
- present machine-learning output as ground truth.

## Limitations (to be expanded during implementation)

Every analysis view should carry limitation notes. Known categories to
document as they become concrete:

- Satellite columns vs. ground-level concentrations
- Cloud cover and retrieval-quality gaps
- Temporal aggregation: several collection images per calendar date and the
  sensitivity of results to the daily compositing choice
- Computation scale and reducer configuration sensitivity
- Baseline choice sensitivity
- Spatial resolution limits
- Monitor coverage and representativeness

TODO: expand with dataset-specific limitations once datasets are confirmed
(see [data-sources.md](data-sources.md)).
