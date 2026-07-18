# Data sources

**Decision status:** the study-region boundary and the first satellite NO₂
dataset are **decided** (owner decision, 2026-07-17) and recorded below.
Everything else remains a candidate: no other dataset is final until it passes
the evaluation checklist at the bottom and is approved by the project owner.

## Decided

### Satellite NO₂ signal — decided

- **Decided (2026-07-17):** Sentinel-5P TROPOMI **OFFL** tropospheric NO₂ via
  the Earth Engine dataset `COPERNICUS/S5P/OFFL/L3_NO2`, band
  `tropospheric_NO2_column_number_density` (units: mol/m²).
- **What the band is:** a **tropospheric vertical NO₂ column** — the amount
  of NO₂ in the tropospheric part of the atmospheric column, per unit area.
  It is not a surface concentration, not an AQI value, not a health
  category, and not an official air-quality advisory.
- **Level-3 ingestion (per the official Earth Engine Data Catalog):** the
  catalog describes the L3 ingestion process as filtering the source data,
  merging it into mosaics, and producing raster tiles. For the selected band
  the catalog records the ingestion validity filter
  `tropospheric_NO2_column_number_density_validity > 50`. The L3 grid is
  ~1113 m; OFFL NO₂ imagery is available from late June 2018 onward.
- **Temporal structure (important):** a raw image in this Earth Engine
  collection must **not** be described as one daily observation. Several
  collection images can carry the same calendar date, and more than one of
  them may intersect the BAAQMD region on that date. A count of raw
  collection images is therefore not a count of days or of independent
  daily observations. The final calendar-day compositing method is an open
  owner decision — see
  [methodology.md](methodology.md#temporal-unit-and-daily-compositing-open).
- TODO: record further dataset-specific limitations in
  [methodology.md](methodology.md) as exploration reveals them (column vs.
  ground-level, cloud/retrieval coverage gaps, seasonal coverage differences).

### Region boundary — decided and ingested

- **Decided (2026-07-17):** the study region is the official **BAAQMD
  jurisdiction** — all of Alameda, Contra Costa, Marin, Napa, San Francisco,
  San Mateo, and Santa Clara counties plus the southern portions of Solano and
  Sonoma counties.
- **Earth Engine asset (ingested):**
  `projects/thematic-carver-502603-k5/assets/ca_air_district_boundaries` — a
  California air-district boundaries table. Scripts select the district with
  the filter `Air_Distri == "BAY AREA AQMD"` and dissolve the result into a
  single feature so the map shows one clean outer boundary.
  - TODO: record the boundary layer's original download source here
    (publisher page/URL, version, retrieval date).
- **Fallback only:** the TIGER/2018 county approximation (the seven full
  counties plus *all* of Solano and Sonoma) remains in the exploration script
  solely as a clearly labeled fallback for when the asset is unavailable
  (e.g., an account without read access). It is not used in normal operation
  and overstates the jurisdiction's northern extent.

## Candidate categories (still open)

### Reanalysis / model support

- Candidates: to be surveyed (e.g., atmospheric-composition reanalysis
  products available in Earth Engine).
- TODO: survey what is actually available and usable in Earth Engine; decide
  whether reanalysis enters the first version at all.

### Ground monitors (comparison / validation)

- Official context sources: AirNow, EPA monitoring data, BAAQMD.
- These are the official references the app explicitly does **not** replace.
- TODO: decide whether and how monitor data is accessed (export, API, manual
  download for the R notebook), and which role it plays (validation only vs.
  displayed evidence).

## Evaluation checklist (apply to every candidate before adoption)

- [ ] Available in Google Earth Engine (or justify an off-platform pipeline)
- [ ] Spatial resolution appropriate for Bay Area analysis
- [ ] Temporal coverage supports both recent screening and historical exploration
- [ ] Quality flags / filtering approach understood and documented
- [ ] Known limitations written into [methodology.md](methodology.md)
- [ ] Licensing / attribution requirements recorded
