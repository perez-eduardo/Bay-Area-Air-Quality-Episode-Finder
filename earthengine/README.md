# Earth Engine scripts

**Status: data exploration started.** The dashboard app itself is not built
yet.

**Decided:** everything here uses the Earth Engine JavaScript API and is
developed and run through the Earth Engine Code Editor.

## Contents

- `exploration/01_s5p_no2_exploration.js` — first data-exploration script.
  Displays the study-region boundary, a mean Sentinel-5P OFFL tropospheric
  NO₂ layer for a configurable date range, a regional time-series chart, and
  a data-availability note. **Exploration only** — no episode detection,
  thresholds, scoring, or modeling.

## Running a script in the Code Editor

1. Open the Earth Engine Code Editor at <https://code.earthengine.google.com>
   (requires a Google account registered for Earth Engine access).
2. Create a new script and paste in the contents of the `.js` file.
3. Click **Run**. The map centers on the study region and shows the boundary
   and the mean NO₂ layer; a side panel shows explanatory text, date
   controls, a data-availability note, and the time-series chart.
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

## Next milestone

Phase 1 in [docs/roadmap.md](../docs/roadmap.md): the basic app structure —
map, indicator selector, time series, placeholder episode summary, and
visible methodology/limitations notes.
