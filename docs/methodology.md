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
ground-level exposure.

### PM2.5 (careful, later)

PM2.5 matters for wildfire smoke and public concern, but the app must not imply
PM2.5 is directly observed from a single satellite image. Any PM2.5 work will
be framed as an **estimate / evidence workflow** that may combine
satellite-related indicators, reanalysis or model data, and ground-monitor
comparison.

TODO: decide whether/when PM2.5 enters scope, and the estimation approach.

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
| Exact Bay Area region definition | TODO — not decided |

## Analysis modes

- **Current / recent screening** — examine recent data for a possibly
  developing or recently occurring episode.
- **Historical episode exploration** — scan historical data for past periods
  matching the episode definition, so the project can be demonstrated on known
  or interesting periods.

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
- Baseline choice sensitivity
- Spatial resolution limits
- Monitor coverage and representativeness

TODO: expand with dataset-specific limitations once datasets are confirmed
(see [data-sources.md](data-sources.md)).
