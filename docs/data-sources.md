# Data sources (candidates only — nothing final)

**No dataset in this document is final.** These are candidates consistent with
the project overview (satellite NO₂ signal, reanalysis support, ground-monitor
comparison). Each must be evaluated in the Earth Engine Data Catalog (coverage,
resolution, latency, quality flags) before being adopted, and that evaluation
is a TODO for the project owner.

## Candidate categories

### Satellite NO₂ signal

- Example candidate to evaluate: Sentinel-5P TROPOMI NO₂. **Not selected** —
  like every dataset here, it must pass the evaluation checklist below and be
  approved by the project owner before adoption.
- TODO: evaluate product/level choice, quality filtering, temporal coverage,
  and suitability for Bay Area spatial scale.

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

### Region boundary

- TODO: decide the Bay Area region definition (9-county, BAAQMD jurisdiction,
  or bounding box) and the boundary dataset used to draw it.

## Evaluation checklist (apply to every candidate before adoption)

- [ ] Available in Google Earth Engine (or justify an off-platform pipeline)
- [ ] Spatial resolution appropriate for Bay Area analysis
- [ ] Temporal coverage supports both recent screening and historical exploration
- [ ] Quality flags / filtering approach understood and documented
- [ ] Known limitations written into [methodology.md](methodology.md)
- [ ] Licensing / attribution requirements recorded
