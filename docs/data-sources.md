# Data sources

**Decision status:** the study-region boundary and the first satellite NO₂
dataset are **decided** (owner decision, 2026-07-17) and recorded below.
Everything else remains a candidate: no other dataset is final until it passes
the evaluation checklist at the bottom and is approved by the project owner.

## Decided

### Satellite NO₂ signal — dataset decided, understanding evolving

Labels used below — **Official:** stated by an official source (see
[Sources and access dates](#sources-and-access-dates)); **Observed:** a
result of our own live Earth Engine tests, for one region and period, and
**not** proof of global collection behavior; **Interpretation:** our
working reading of the evidence; **Open:** an undecided owner decision.

- **Decided (2026-07-17):** Sentinel-5P TROPOMI **OFFL** tropospheric NO₂ via
  the Earth Engine dataset `COPERNICUS/S5P/OFFL/L3_NO2`, band
  `tropospheric_NO2_column_number_density` (units: mol/m²).

#### What the band measures — and what it does not

**Official.** The band is a **tropospheric vertical NO₂ column**: the
amount of NO₂ in the tropospheric part of the atmospheric column, per unit
area (mol/m²). It is **not**: ground-level NO₂ concentration; an AQI
value; a health-risk category; personal exposure; a direct measurement of
emissions from a particular road or facility; or an official air-quality
advisory.

**Interpretation — exploratory uses this dataset can support:**

- broad spatial patterns in tropospheric NO₂ columns;
- multi-day, monthly, seasonal, and annual comparisons;
- detection of unusual satellite-observed column enhancements;
- comparison of broad urban and regional patterns;
- one evidence source in a multi-source air-quality investigation.

**Interpretation — limitations:**

- it cannot resolve individual highways, road segments, neighborhoods, or
  facilities with defensible source attribution;
- visual alignment with highways or industrial areas is geographic
  coincidence, not proof of causation;
- satellite column values and surface-monitor concentrations describe
  different atmospheric quantities;
- a satellite anomaly alone must not be labeled an air-quality episode.

#### Collection model — corrected after the exploration 04 live test

**Official (catalog page content verified 2026-07-18).** Earth Engine
starts from Sentinel-5P **Level-2** products; each source product is
converted to a **Level-3 grid**; **one grid is retained per orbit/product**
(the catalog: a single grid per orbit, with no aggregation across
products); Earth Engine does **not** aggregate separate products into one
daily product during ingestion; the Level-3 data is binned to a
**0.01-degree grid** (1113.2 m pixels). An **antimeridian-spanning**
source product is ingested as **two** Earth Engine assets, with `_1` and
`_2` suffixes.

**Observed (script 04 live test; default period, local dates 2023-01-01 to
2023-04-01).** The Bay Area query returned **1,276 raw Earth Engine
collection assets**, containing **1,276 distinct `PRODUCT_ID` values** and
**1,276 distinct `ORBIT` values** — one returned asset per product/orbit —
with approximately **14–15 orbit-product assets assigned to each local
calendar day**. The earlier hypothesis that those daily assets were
multiple tiles belonging to one Bay Area product was **rejected** by this
test. This is an observed result for this region and period, not
necessarily a universal property of every region and date range.

**Interpretation.** A normal Bay Area collection member should be called
an **orbit-product asset** (equivalently, a single-orbit Level-3 asset or
an Earth Engine collection member) — not, in general, a tile. Grouping by
`PRODUCT_ID` remains a **defensive reconstruction step**: it is a no-op
when every product has one asset (as the Bay Area test found) and correct
if an antimeridian-spanning product ever appears as two assets.

**Key distinction (interpretation).** `filterBounds(BAAQMD)` means an
asset's geometry or footprint **intersects** the study region; it does
**not** prove the asset contains unmasked, valid NO₂ retrievals over
BAAQMD. The meaningful daily contributor count is the number of orbit
products with **valid pixels over BAAQMD**, not the total number of
collection members assigned to that date. A raw collection count is
therefore not a count of days, observations, or contributors. **Open:**
the daily contributor and combination rule — see
[methodology.md](methodology.md).

#### Grid resolution vs. native footprint

**Official.** The 0.01° (~1.1 km) Level-3 grid is a **gridding
resolution**, not the native independent observational footprint. The
TROPOMI nadir footprint was approximately **3.5 × 7.0 km** at the
beginning of the mission and approximately **3.5 × 5.5 km since
6 August 2019**.

**Interpretation.** The ~1.1 km Earth Engine grid is **oversampled**
relative to the native footprint. Neighboring Level-3 grid cells must not
be described as independent one-kilometre measurements. Map display may
use the fine grid, but documentation and the app must warn against
street-level interpretation and false precision.

#### Quality filtering — an inconsistency on the official page

**Official (internally inconsistent; page content inspected 2026-07-18).**
The current Earth Engine catalog page's explanatory ingestion rules
**state 75 %** for the tropospheric NO₂ band, while the example HARP
ingestion command on the same official page still shows
`tropospheric_NO2_column_number_density_validity > 50`. Google's
operational ingestion implementation has **not** been independently
verified by this project — we know only what the catalog page says.

**Official — Level-2 user guidance (Product User Manual issue 4.5.0,
relevant content inspected).** `qa_value > 0.75` is the recommended pixel
filter for most users of the tropospheric NO₂ product. A lower
`qa_value > 0.50` filter additionally retains good-quality retrievals
over clouds and snow/ice and is intended for special applications, such
as assimilation or model comparisons using averaging kernels — it is
**not** an equivalent general-quality threshold. **Checked
(2026-07-18):** the Earth Engine Level-3 collection does not expose the
original Level-2 `qa_value`, so neither filter can presently be reapplied
inside this app (see the next subsection).

**Observed (script 05 live test; 2023-01-01 to 2023-04-01 test period).**
9 of 1,276 products carried a non-NOMINAL `PRODUCT_QUALITY`
("DEGRADED"), of which only 2 contributed valid BAAQMD data; excluding
non-NOMINAL products changed the daily result on 2023-01-20 and removed
all valid data on 2023-02-15. Project policy: flag and retain, never
silently exclude (see [methodology.md](methodology.md)).

#### Level-3 limitations and metadata to audit

**Checked (catalog page, 2026-07-18).** The current catalog page documents
**no band or image property exposing the original Level-2 `qa_value`** —
so we must not claim to reapply the original `qa_value > 0.75` test inside
this Level-3 collection. **Interpretation (remaining audit).** The
collection does not necessarily expose every Level-2 diagnostic needed for
the most rigorous retrieval correction; fields still to audit band-by-band
— not to be declared absent without checking — include per-retrieval
precision, averaging kernels, detailed air-mass factors, and detailed
cloud and a-priori profile information. A more rigorous retrieval-level
workflow may eventually require official Level-2 or RPRO files outside
Earth Engine (see [architecture.md](architecture.md)) — not an immediate
commitment.

**Official — image metadata properties (names verified on the catalog
page 2026-07-18; actual values not yet inspected — do not assume the exact
string used for a nominal status until values are inspected):**
`PRODUCT_ID`, `ORBIT`, `PROCESSING_STATUS`, `PRODUCT_QUALITY`,
`PROCESSOR_VERSION`, `ALGORITHM_VERSION`, `SPATIAL_RESOLUTION`, plus
acquisition time and our derived local calendar date. The catalog lists
further properties (e.g. `HARP_VERSION`, `L3_PROCESSING_TIME`,
`LAT_MIN`/`LAT_MAX`/`LON_MIN`/`LON_MAX`, `PLATFORM`, `SENSOR`,
`TRACKING_ID`) that the metadata audit may also summarize.

#### Historical consistency (RPRO vs. OFFL)

**Official (per the Sentinel-5P NO₂ Product Readme File, issue 2.9;
relevant content inspected — see Sources).** A multi-year TROPOMI time
series may be affected by processor, algorithm, auxiliary-data, and
spatial-resolution changes. For consistent time-series studies, the
readme advises using the reprocessed **RPRO** record throughout the
period where RPRO is available and the **latest OFFL** record afterward;
specifically, it discusses combining the version-2.4 RPRO dataset with
OFFL versions 2.4 and 2.5 from **26 July 2022** onward. It also cautions
that processor version **2.6** produced reductions in midlatitude-winter
NO₂ compared with version 2.4 and should be used cautiously for
time-series analysis. This is **not** an unconditional guarantee that
every OFFL product after 26 July 2022 is homogeneous with the RPRO
record.

**Interpretation.** We do **not** claim that Earth Engine already
supplies the recommended RPRO/OFFL combined record. The homogeneity
audit was completed and the decision recorded on 2026-07-19 —
**Outcome B**: the Earth Engine OFFL record is usable for exploratory
historical comparison with explicit restrictions (the decided
historical-baseline policy) and is never treated as an unconditionally
homogeneous 2018–present trend record (see
[methodology.md](methodology.md)).

Other basics (**Official**): the L3 grid is ~1113 m; OFFL NO₂ imagery is
available from late June 2018 onward.

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
- **Validation-phase evaluation queue (no datasets or providers chosen;
  each candidate must pass the checklist below):** BAAQMD or EPA surface
  NO₂ monitors; monitor measurements near the TROPOMI overpass time; wind
  speed and direction; planetary-boundary-layer height if available; cloud
  and retrieval coverage; temperature or other relevant meteorological
  context. See the validation phase in [methodology.md](methodology.md).

## Evaluation checklist (apply to every candidate before adoption)

- [ ] Available in Google Earth Engine (or justify an off-platform pipeline)
- [ ] Spatial resolution appropriate for Bay Area analysis
- [ ] Temporal coverage supports both recent screening and historical exploration
- [ ] Quality flags / filtering approach understood and documented
- [ ] Known limitations written into [methodology.md](methodology.md)
- [ ] Licensing / attribution requirements recorded

## Sources and access dates

Authoritative sources for the technical claims above, accessed
**2026-07-18**. Verification status is stated per source and
distinguishes: *URL resolution verified* — the exact URL returned
HTTP 200 when requested; *identity confirmed* — the document name and
version were read from the official SentiWiki "S5P Documents" index; and
*content inspected* — we actually read the relevant statements. The
former `sentinel.esa.int` deep links no longer resolve; official
Sentinel-5P documentation now lives on SentiWiki. Content is paraphrased,
never quoted at length.

- Google Earth Engine Data Catalog — [Sentinel-5P OFFL NO2: Offline Nitrogen Dioxide](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_NO2).
  URL resolution verified; **content inspected** for: the explanatory
  75 % ingestion rule vs. the `> 50` example HARP command; a single grid
  per orbit with no aggregation across products; antimeridian products
  ingested as two assets (`_1`/`_2` suffixes); 0.01° binning at
  1113.2 m; the image-property list; and the absence of a documented
  `qa_value` band or property.
- [Google Earth Engine guides and API reference](https://developers.google.com/earth-engine/guides).
  URL resolution verified; content consulted during earlier work for
  scale, projection, reducer, and filtering behavior (not re-inspected on
  2026-07-18).
- TROPOMI mission site — [nitrogen dioxide data product page](https://www.tropomi.eu/data-products/nitrogen-dioxide).
  URL resolution verified; **content inspected** for the footprint
  history ("3.5 x 7.0 km … at beginning of mission"; "3.5 x 5.5 km …
  since 6 August 2019") and the `qa_value` guidance (0.75 as the general
  recommendation; 0.5 mentioned specifically for cloud-covered scenes).
- [S5P-KNMI-L2-0021-MA — Sentinel-5P Level 2 Product User Manual Nitrogendioxide, issue 4.5.0 (PDF)](https://sentiwiki.copernicus.eu/__attachments/a_9a684b9fae014dbd44f68f924be68b04ef2a8740ab3a4a756a2b18393c06a80b/S5P-KNMI-L2-0021-MA%20-%20Sentinel-5P%20Level%202%20Product%20User%20Manual%20Nitrogendioxide%202025-4.5.0.pdf).
  Issue 4.5.0, applicable to processor version 2.9.1. Exact URL
  resolution verified (HTTP 200, `application/pdf`); identity and version
  confirmed from the official SentiWiki S5P Documents index; **relevant
  content inspected** — the `qa_value > 0.75` recommended pixel filter
  for most users, and the `qa_value > 0.50` filter that additionally
  retains good-quality retrievals over clouds and snow/ice for special
  applications (e.g., assimilation or model comparisons using averaging
  kernels). Stable index pages if the versioned attachment moves:
  [SentiWiki S5P Documents](https://sentiwiki.copernicus.eu/web/s5p-documents)
  and [SentiWiki S5P Products](https://sentiwiki.copernicus.eu/web/s5p-products).
- [S5P-MPC-KNMI-PRF-NO2 — Sentinel-5P Nitrogen Dioxide Level 2 Product Readme File, issue 2.9 (PDF)](https://sentiwiki.copernicus.eu/__attachments/a_656dd28004fc0082ca1b2feb20a03e44bd7116083453a896f11a2599b90a7de2/S5P-MPC-KNMI-PRF-NO2%20-%20Sentinel-5P%20Nitrogen%20Dioxide%20Level%202%20Product%20Readme%20File%202025%20-%202.9.pdf).
  Exact URL resolution verified (HTTP 200, `application/pdf`); identity
  and version confirmed from the official SentiWiki S5P Documents index;
  **relevant content inspected** — the advice to use RPRO throughout the
  period where RPRO is available and the latest OFFL record afterward,
  the specific combination of the version-2.4 RPRO dataset with OFFL
  versions 2.4 and 2.5 from 26 July 2022 onward, and the caution that
  processor version 2.6 reduced midlatitude-winter NO₂ relative to
  version 2.4. Same stable index pages as above.
- Peer-reviewed TROPOMI NO₂ validation literature — to be cited
  specifically when the validation phase is designed.
