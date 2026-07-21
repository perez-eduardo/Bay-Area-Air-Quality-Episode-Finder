# R analysis / validation

This directory holds supporting analysis and validation notebooks (R
first, possibly Python later). It is a supporting layer, not the app
runtime.

Contents:

- `s5p_no2_historical_homogeneity.Rmd`: the accepted full-history
  historical-record homogeneity audit (processor/algorithm versions,
  coverage, transition windows, and a retrospective baseline-robustness
  study on the script 07 exports). The audit closed with the owner's
  Outcome B decision and the historical-baseline policy recorded
  2026-07-19 (see [docs/methodology.md](../docs/methodology.md)).

Planned next: a small validation workflow comparing satellite NO₂
column values with surface monitors and meteorological context, step 7
of the research-and-validation gate in
[docs/roadmap.md](../docs/roadmap.md). No monitor or meteorology
datasets are chosen yet (see
[docs/data-sources.md](../docs/data-sources.md)).

Later contents (Phase 4 in [docs/roadmap.md](../docs/roadmap.md)):

- data cleaning and exploratory analysis
- baseline calculation, mirroring the app's documented method
- episode-detection logic reproduction on exported data (once such
  logic exists)
- comparison against ground-monitor data (access method TODO)
- explanatory charts for the methodology section

If the Earth Engine Level-3 record proves insufficient for rigorous
historical analysis, this layer is also where official Level-2/RPRO
files outside Earth Engine would be processed (a recorded possibility,
not a commitment; see [docs/architecture.md](../docs/architecture.md)).
