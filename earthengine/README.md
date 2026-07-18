# Earth Engine scripts

**Status: data exploration started.** The dashboard app itself is not built
yet.

**Decided:** everything here uses the Earth Engine JavaScript API and is
developed and run through the Earth Engine Code Editor.

## Contents

- `exploration/01_s5p_no2_exploration.js` — first data-exploration script.
  Displays the study-region boundary, a mean Sentinel-5P OFFL tropospheric
  NO₂ layer for a configurable date range, a regional time-series chart
  (image-level and exploratory; see
  [Temporal behavior](#temporal-behavior-of-scripts-01-and-02-image-level-exploratory)
  below), and a data-availability note. **Exploration only** — no episode
  detection, thresholds, scoring, or modeling.
- `exploration/02_s5p_no2_display_modes.js` — second data-exploration
  script, focused on the spatial readability of the NO₂ map. Keeps the
  boundary, date controls, chart, and data-availability / no-data handling
  from script 01 unchanged in behavior, and adds a selector with two map
  display modes — an absolute fixed-scale view and a relative
  period-stretched view (see [Display modes](#display-modes-exploration-02)
  below). Its chart and image count are image-level and exploratory, like
  script 01's. **Exploration only** — no episode detection, thresholds,
  scoring, or modeling.
- `exploration/03_s5p_no2_daily_composites.js` — third data-exploration
  script: raw temporal structure and **provisional** calendar-day
  composites (see
  [Daily composites (exploration 03)](#daily-composites-exploration-03)
  below). Charts the raw image-level regional mean against a provisional
  daily-mean series, reports calendar-day coverage, and displays both
  period means on one shared fixed display scale. The daily compositing
  method used is provisional — **not** the final approved method.
  **Exploration only** — no baselines, anomalies, episode detection,
  thresholds, scoring, or modeling.

## Running a script in the Code Editor

1. Open the Earth Engine Code Editor at <https://code.earthengine.google.com>
   (requires a Google account registered for Earth Engine access).
2. Create a new script and paste in the contents of the `.js` file.
3. Click **Run**. The map centers on the study region and shows the boundary
   and the mean NO₂ layer; a side panel shows explanatory text, date
   controls, a data-availability note, and the time-series chart. Script 02
   additionally shows a display-mode selector and a mode-specific legend;
   script 03 shows a layer selector, a temporal-coverage summary, and two
   charts.
4. Change the date range in the panel's date boxes and click **Update** — or
   edit the `CONFIG` block at the top of the script and re-run.

### Study-region boundary

The script uses the official BAAQMD jurisdiction boundary from the uploaded
Earth Engine asset
`projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries`,
selected with the filter `Air_Distri == "BAY AREA AQMD"` and dissolved into a
single feature so it displays as one clean outer boundary (`boundaryAssetId`
/ `boundaryField` / `boundaryValue` in the script's `CONFIG`).

Only if that asset is unavailable (for example, the running account has no
read access to it) does the script fall back to a clearly labeled TIGER/2018
county approximation (Solano and Sonoma included in full, which overstates
the jurisdiction's northern extent). The fallback prints a console warning
and adds a note to the side panel. See
[docs/data-sources.md](../docs/data-sources.md) for details.

## Temporal behavior of scripts 01 and 02 (image-level, exploratory)

Both scripts work directly on the raw `COPERNICUS/S5P/OFFL/L3_NO2`
collection. A raw collection image is **not one daily observation**: several
collection images can carry the same calendar date, and more than one of
them may intersect the BAAQMD region on that date. Consequences:

- The "N images" count in the status line counts raw collection images. It
  is **not** a count of days or of independent daily observations.
- The time-series chart plots one point per raw collection image. It is an
  exploratory **image-level** series, not the final daily time series that
  episode analysis will use. The final calendar-day compositing method is an
  open owner decision; script 03 explores a provisional daily mean (see
  [Daily composites (exploration 03)](#daily-composites-exploration-03)).
- The image-level chart requests an explicit 5000 m scale through
  `ui.Chart.image.series`; it does not use `bestEffort`.
- The coverage diagnostic uses `reduceRegion()` with `bestEffort` — an
  exploratory UI diagnostic only. In script 02, the relative-display
  percentile calculation also uses `reduceRegion()` with `bestEffort` — an
  exploratory visualization calculation only. Final scientific reductions
  will use an explicit, stable, documented scale without `bestEffort` (see
  [docs/methodology.md](../docs/methodology.md)).

Dataset details — including the catalog's Level-3 ingestion description
(filtering source data, merging it into mosaics, and producing raster tiles)
and the ingestion validity filter
`tropospheric_NO2_column_number_density_validity > 50` for the selected
band — are recorded in [docs/data-sources.md](../docs/data-sources.md).

## Display modes (exploration 02)

`exploration/02_s5p_no2_display_modes.js` adds a display-mode selector with
two ways to color the same mean-NO₂ composite. Both are **visualization
choices only**: every number involved (scale limits, fade values, percentile
choices, opacities) is a display setting, not an air-quality threshold, AQI
value, health category, or analysis parameter. Switching the mode or
updating the date range re-renders the map layer and the legend.

### Absolute NO₂ view

- **Purpose:** show the mean tropospheric NO₂ column on a fixed numerical
  color scale so the same color corresponds to the same column density in
  every date range (at this display stretch).
- **How it is drawn:** a fixed display stretch of 0 to 2.0 × 10⁻⁴ mol/m²
  (the range script 01 used) with a sequential single-hue blue ramp — the
  five darkest steps of the ColorBrewer "Blues" 9-class scheme, trimmed so
  the lightest displayed color still stands out against a light basemap.
  Pixel opacity ramps linearly from fully transparent at 2.0 × 10⁻⁵ mol/m²
  to fully opaque at 5.0 × 10⁻⁵ mol/m² (10 % and 25 % of the display
  maximum), so the lowest values fade out and the basemap stays visible.
- **Limitations:** values above the display maximum all render as the
  darkest color. Faded or transparent areas are *not* necessarily missing
  data — the fade is a display aid, and truly missing pixels (no valid
  retrieval) are also transparent, so the two can look alike in this view.
  The colors are a numerical display stretch only, never AQI or health
  categories.

### Relative pattern view

- **Purpose:** make within-period spatial structure easier to see. The color
  range is stretched to the selected period's own values, so subtle spatial
  differences become visible even when the period's values occupy a narrow
  part of the absolute scale.
- **How it is drawn:** color limits are the 2nd and 98th percentiles of the
  selected-period mean composite within the study region (a common
  robust-stretch convention), computed at the script's 5000 m reduction
  scale and used **only** for visualization. The ramp is a sequential
  single-hue purple (the five darkest steps of ColorBrewer "Purples"
  9-class) — deliberately a different hue from the absolute view so images
  of the two modes are hard to confuse — drawn at fixed 0.75 layer opacity
  so streets and terrain stay visible.
- **Limitations:** the stretch is recomputed for every date range, so colors
  in this mode **must not be compared between different periods** — a dark
  purple in one period can correspond to a much lower column density than
  the same purple in another. The panel and legend state this. When a period
  has too little valid data (or values too uniform to form a stretch), the
  script says so and shows no NO₂ layer in this mode. Percentile limits are
  display parameters, not analysis statistics.

Both ramps were checked with a palette validator during development
(monotone lightness, visible step gaps, light-end contrast against a light
surface, single hue).

## Daily composites (exploration 03)

`exploration/03_s5p_no2_daily_composites.js` inspects the raw temporal
structure of the collection and compares the image-level series with a
**provisional** calendar-day series. The daily compositing method used here
(arithmetic mean of each date's raw images) is an exploratory placeholder so
the comparison can be inspected — it is **not** the final approved method,
which remains an open owner decision along with the final analysis scale,
regional reducer, and weighting behavior (see
[docs/methodology.md](../docs/methodology.md)).

How the daily collection is built — fully server-side (an `ee.List` of day
offsets is mapped with `dropNulls`; no client-side loop touches Earth Engine
computation):

- For every calendar date in the selected range, the raw collection is
  filtered to that date and the source images are counted.
- Dates with at least one source image get one provisional composite — the
  arithmetic mean of that date's raw images — carrying the properties
  `system:time_start` (start of the calendar date), `date_string`
  (`YYYY-MM-dd`), and `source_image_count`.
- Dates with no source image are excluded from the daily collection but are
  still counted in the panel summary as days with no source image.

Terminology: a **source-image day** is a calendar date with at least one raw
collection image intersecting the region — not necessarily a day with
usable NO₂ data. Its provisional daily regional mean can still be null when
every relevant pixel over the region is masked (e.g., clouds or quality
filtering); only days with a non-null regional mean are called
**valid/usable days** in the UI. The valid-day counts are derived from the
same evaluated regional-mean results that feed the chart — no extra
reduction pass is made for the summary.

Analysis/display separation, per [docs/methodology.md](../docs/methodology.md):
raw and daily analysis images stay **unclipped**, and the regional reducers
receive the BAAQMD geometry directly at an explicit 5000 m scale with no
`bestEffort` and no `reproject()` — both chart series (raw image-level
regional mean and provisional daily regional mean) are computed this way.
Only the two map layers (period mean of the raw collection, period mean of
the provisional daily composites) are clipped, and both use one shared fixed
display stretch (0 to 2.0 × 10⁻⁴ mol/m²) so their spatial patterns can be
compared visually. The 5000 m scale is itself an exploration-stage choice;
the final analysis scale is undecided.

The panel summary distinguishes collection presence from usable data. It
reports: total raw images intersecting the study region; total calendar
days in the range; days with at least one source image; days with no
source image; days with a valid (non-null) provisional daily regional
mean; days with source images but no valid regional mean; the percentage
of calendar days with a valid daily regional mean; and the min/median/max
number of source images per source-image day. A raw collection image is
never described as a daily observation.

## Next milestone

Script 03 exists and remains exploratory. The next analytical step is the
owner's evaluation of the provisional daily-compositing results and the
temporal-unit decisions listed in
[docs/methodology.md](../docs/methodology.md) — the daily compositing
method is **not** decided. Historical baseline and anomaly development
begins only after those decisions are made.

The Phase 1 app structure in [docs/roadmap.md](../docs/roadmap.md) — map,
indicator selector, time series, placeholder episode summary, and visible
methodology/limitations notes — remains the next app-structure milestone.
