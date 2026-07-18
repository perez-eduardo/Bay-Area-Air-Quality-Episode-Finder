# R analysis / validation

**Status: not started.**

This directory will hold supporting analysis and validation notebooks for the
Earth Engine app — R first, possibly Python later. This is a supporting
layer, not the app runtime (the app itself uses the Earth Engine JavaScript
API).

First planned deliverable: a **small validation workflow** comparing
satellite NO₂ column values with surface monitors and meteorological
context — step 7 of the research-and-validation gate in
[docs/roadmap.md](../docs/roadmap.md), which precedes any baseline or
episode work (no monitor or meteorology datasets chosen yet; see
[docs/data-sources.md](../docs/data-sources.md)).

Later contents (Phase 4 in [docs/roadmap.md](../docs/roadmap.md)):

- data cleaning and exploratory analysis
- baseline calculation, mirroring the app's documented method (only after
  the validation gate defines one)
- episode-detection logic reproduction on exported data
- comparison against ground-monitor data (access method TODO)
- explanatory charts for the methodology section

If the Earth Engine Level-3 record proves insufficient for rigorous
historical analysis, this layer is also where official Level-2/RPRO files
outside Earth Engine would be processed (a recorded possibility, not a
commitment — see [docs/architecture.md](../docs/architecture.md)).
