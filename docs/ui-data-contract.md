# UI data contract (semantics)

**Status: adopted semantic contract for the public UI (2026-07-20).**
This document defines the **meaning** of the data the frontend consumes
and the states it must present. It deliberately does **not** define
HTTP endpoint paths, transport design, payload encodings, or
framework-specific interfaces — those remain open owner decisions (see
[architecture.md](architecture.md)). The backend is the authority for
date availability and null/status semantics; the frontend must consume
these concepts, never reconstruct Earth Engine rules on its own.

Scientific grounding: the selected production regional-statistics
method and the adopted historical-baseline policy in
[methodology.md](methodology.md). Nothing in this contract introduces
an episode threshold, persistence rule, spatial-extent rule, or any
AQI/health interpretation — none of those exists in this project.

## A. Dataset and date metadata

The UI needs these dataset/date concepts from the backend:

| Concept | Meaning |
| --- | --- |
| Dataset ID | `COPERNICUS/S5P/OFFL/L3_NO2` |
| Band name | `tropospheric_NO2_column_number_density` |
| Unit | mol/m² (tropospheric vertical column density) |
| Timezone | `America/Los_Angeles` — every date in the contract is a Bay Area local calendar date |
| Requested local date | The local calendar date a value describes |
| Latest represented local date | The newest local date represented in the collection (its ingestion may still be partial) |
| Last included local date | The newest local date the backend treats as complete — the day **before** the latest represented date |
| Data-latency / freshness note | Human-readable note that OFFL products publish with latency (multi-day delays are normal) |

**Date-picker rule.** The date picker must **not** assume "today" is
available. Its latest selectable date comes from the backend's **last
included local date**, which conservatively excludes the newest
represented date. Dates newer than the last included date are a
distinct UI state (see G), not an error.

## B. Daily regional observation

One daily regional observation carries:

| Concept | Meaning |
| --- | --- |
| Method identifier | Which regional-statistics method produced the value (production: the canonical native-lattice method; see [methodology.md](methodology.md)) |
| Regional NO₂ value | Area-weighted regional mean of the tropospheric NO₂ column (mol/m²) — **nullable** |
| Has-valid-value flag | Whether any valid regional retrieval exists for the date |
| Valid-area fraction | Valid pixel area ÷ total region area for the date — always present for valid days, reported with every value |
| Source asset count | Footprint-intersecting raw assets on the date (footprint intersection is **not** contribution) |
| Distinct product count | Reconstructed products assigned to the date |
| Distinct orbit count | Where available |
| Non-NOMINAL flag/count | Whether contributing products with non-NOMINAL `PRODUCT_QUALITY` exist (retained and flagged, never excluded) |
| Projection-compatibility status | Whether the date's source grids satisfied the accepted compatibility rule (an incompatible date has null native statistics by design) |
| Quality/status code | Machine-readable status distinguishing the cases in section D |

**Labeling rule.** The displayed quantity label must say something
equivalent to **"Tropospheric NO₂ column"**. Never label it simply
"NO₂ concentration", "surface NO₂", or AQI — the column and the air a
person breathes are different physical quantities.

## C. Baseline comparison

The baseline concepts implement the adopted policy (Outcome B,
2026-07-19; full text in [methodology.md](methodology.md)) and carry:

| Concept | Meaning |
| --- | --- |
| Baseline status | Available / structurally partial (unavailable) / not applicable (see D) |
| Requested prior years | The previous three same-calendar years |
| Contributing prior years | Which of the three actually supplied at least one valid same-month value |
| Historical sample count | Number of pooled valid same-calendar-month daily values |
| Historical median | Median of the pooled sample — **nullable** |
| Signed anomaly | Target value − historical median — **nullable** |
| Percentile | 100 × count(historical ≤ target) ÷ historical count — **nullable** |
| Baseline method description | Human-readable statement of the policy (below) |

Baseline semantics (fixed by the adopted policy — the UI presents,
never modifies, these rules): previous three same-calendar years;
pooled valid daily BAAQMD regional values from the same calendar
month; median baseline; signed anomaly = target − median; percentile
uses the ≤ convention; **every one of the three requested prior years
must contribute at least one valid same-month value** — otherwise the
window is structurally partial and baseline, anomaly, and percentile
are unavailable/null while the raw daily value and valid-area fraction
may still be shown; no exact processor/algorithm matching; no
processor correction factors; no hard valid-area cutoff; contributing
non-NOMINAL products retained and flagged. This is an **exploratory
rolling historical comparison**, not a homogeneous long-term trend or
a causal processor analysis — and the UI must describe it that way.

## D. Null and status semantics

The UI must distinguish, at minimum:

1. **Available value** — a valid regional value exists.
2. **No source products** — nothing was acquired for the date.
3. **Products but no valid regional retrieval** — products exist, but
   none contributed valid regional pixels (clouds/quality masking).
4. **Baseline unavailable** — the full previous-three-year window is
   not represented (structurally partial); the daily value may still
   exist.
5. **Backend or Earth Engine error** — the system, not the data.

**Never convert a null scientific value to numeric zero.** A null
regional mean and a zero regional mean are different scientific
statements.

Examples:

| Case | Product count | Regional value | Valid-area fraction | Baseline / anomaly / percentile |
| --- | --- | --- | --- | --- |
| No products | 0 | null | 0 | null |
| Products, no valid retrieval | > 0 | null | 0 | null |
| Value, partial baseline window | > 0 | present | > 0 | null (structurally partial) |
| Value, complete baseline | > 0 | present | > 0 | present |

## E. UI display requirements

The UI must visibly expose:

- the selected local date;
- the tropospheric-column value with its mol/m² unit;
- the valid-area percentage;
- baseline availability/status;
- the historical median when available;
- the signed anomaly when available;
- the percentile when available;
- data freshness — the latest included local date;
- a non-NOMINAL warning when applicable;
- the scientific disclaimer (not an official advisory; a column, not
  ground-level air; no AQI or health meaning).

Hard rules:

- **Do not use the valid-area fraction as an undisclosed pass/fail
  filter.** Low-coverage valid values remain visible with their
  coverage; coverage travels with every number.
- **Do not clamp negative values to zero.** Valid negative retrievals
  are legitimate retrieval noise and are preserved end to end.
- Do not use words such as *safe*, *unsafe*, *healthy*, *unhealthy*,
  *AQI*, *episode detected*, or *pollution emergency* — unless a
  future approved methodology explicitly supports them (none does
  today).

## F. Map separation

- The regional numeric statistic and the map are **separate output
  products**.
- The native-lattice decision governs the **regional statistic** only.
- The final map rendering/analysis grid **remains an open owner
  decision** — the canonical 0.01° reduction grid is not automatically
  the public map grid or any future episode-spatial-analysis grid.
- The frontend must **not** infer an episode or a spatial extent
  merely from map colors; map styling is display processing and never
  feeds statistics.
- Map legends must identify the layer as **Sentinel-5P tropospheric
  NO₂ column** data.

## G. Suggested UI states (implementation/testing)

Testable states the frontend should implement and exercise:

1. Loading.
2. Ready with a value and a complete baseline.
3. Ready with a value but an incomplete (structurally partial)
   baseline.
4. Ready with a low valid-area fraction (value shown with its
   coverage — never hidden).
5. No products for the date.
6. Products but no valid regional retrieval.
7. Non-NOMINAL contributors present (warning shown, value retained).
8. Backend unavailable.
9. Earth Engine unavailable (backend up, upstream not ready).
10. Requested date newer than the last included local date.

Test-fixture note: 2025-11-02 is a known zero-product date in the
audited record and is a useful fixture for state 5 — but it is a
historical observation, not a permanent application assumption; fixtures
must not hardcode it as forever product-free.

## Related documents

- [methodology.md](methodology.md) — selected regional-statistics
  method, adopted baseline policy, audit results, and everything still
  open (episode criteria, map grid, validation).
- [architecture.md](architecture.md) — the frontend/backend boundary
  and infrastructure status.
- [data-sources.md](data-sources.md) — dataset details and caveats.
