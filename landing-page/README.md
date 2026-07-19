# Railway public application

**Status: not started.**

Architecture decision (2026-07-18): Railway hosts the **complete public
application** — a Railway-hosted frontend and a Railway backend/API that
calls Google Earth Engine, which remains the geospatial processing
engine and returns statistics, map layers/tiles, and geospatial results
(Phase 5 in [docs/roadmap.md](../docs/roadmap.md); details in
[docs/architecture.md](../docs/architecture.md)). This replaces this
directory's original role as a simple custom-domain landing page linking
to a separately published Earth Engine App — that earlier plan is no
longer the planned final architecture and remains only a possible
fallback.

Planned responsibilities: the public UI (map, charts, legends, loading
and error states, responsive layout, branding), backend/API
orchestration, authentication to Earth Engine (public users will not
need their own Earth Engine accounts), caching, and custom-domain
hosting (DNS via AWS Route 53).

Migration is **not** implemented, and nothing here changes the
documented scientific methods. TODO (owner decisions, none chosen):
frontend framework, backend runtime, map library, Earth Engine service
authentication design, caching design, any database, and the repository
organization for the application code.
