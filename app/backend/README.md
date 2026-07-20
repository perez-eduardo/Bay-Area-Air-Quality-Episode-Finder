# Railway backend — Earth Engine proof of connection

**Status: first deployment target (owner-decided 2026-07-19).**
Infrastructure only: this service verifies that the decided architecture's
pipe works (Railway backend → service-account authentication → Google
Earth Engine → JSON out). It performs **no scientific processing** and
returns **no air-quality results**. The backend *framework* is still an
open owner decision, so this proof uses only Node's built-in `http`
module and locks nothing in.

Decisions recorded here (2026-07-19):

- Backend runtime: **Node.js** (owner decision).
- Railway layout: **two services** — this backend plus a frontend later
  (owner decision).
- Application code location: **`app/backend/`**, with `app/frontend/`
  to follow (decided by the coding assistant under explicit owner
  delegation).
- Service-account Cloud project: **`thematic-carver-502603-k5`** (the
  boundary asset's project; assistant-advised, owner-accepted default —
  override with `EE_PROJECT_ID` if this changes).

## Endpoints

| Path | Purpose |
| --- | --- |
| `/` | Service description |
| `/healthz` | Liveness plus the Earth Engine client state (`not_configured` / `authenticating` / `initializing` / `ready` / `error`) |
| `/api/ee-check` | The proof: (1) the service account can read the official BAAQMD boundary asset (filtered feature count; expected 1), and (2) the Sentinel-5P OFFL collection is reachable (latest represented local date via a `system:time_start` property aggregation). `503` until the client is ready. |

A "represented" date is not a statement about valid Bay Area data
(footprint intersection and representation are never contribution — see
`docs/data-sources.md`).

## One-time Google Cloud setup

Per the official Earth Engine service-account guide
(<https://developers.google.com/earth-engine/guides/service_account>):

1. In the Cloud Console, select project **`thematic-carver-502603-k5`**
   (already registered for Earth Engine — the project's assets prove it).
   Under *APIs & Services*, confirm the **Earth Engine API** is enabled.
2. *IAM & Admin → Service Accounts → Create service account* (e.g.
   `baaqef-backend`). Grant it the **Earth Engine Resource Viewer** role
   on the project (add **Service Usage Consumer** only if initialization
   later complains about quota-project permissions — the official access
   guide lists it as sometimes required).
3. Open the account → *Keys → Add key → Create new key → JSON*. Download
   the key. **Keep it outside the repository directory entirely.** The
   repo `.gitignore` blocks `*credentials*.json` and `.env*` as a second
   line of defense, but the key never needs to be near the repo.

## Run locally (Windows 11, PowerShell)

```powershell
cd E:\Personal_projects\Bay-Area-Air-Quality-Episode-Finder\app\backend
npm install
$env:EE_SERVICE_ACCOUNT_KEY_FILE = "C:\path\outside\repo\baaqef-key.json"
npm start
```

Then open <http://localhost:8080/healthz> (watch the state reach
`ready`) and <http://localhost:8080/api/ee-check>.

## Deploy on Railway

1. Create the Railway project → *Deploy from GitHub repo* → select this
   repository.
2. In the service settings, set **Root Directory** to `app/backend`.
   Railway detects Node from `package.json`; the start command is
   `npm start`.
3. Under *Variables*, add:
   - `EE_SERVICE_ACCOUNT_KEY` — paste the **entire JSON key file
     contents** (Railway variables accept multi-line values).
   - `EE_PROJECT_ID` — optional; defaults to
     `thematic-carver-502603-k5`.
4. Deploy, then *Settings → Networking → Generate Domain* for a
   `*.up.railway.app` URL. Hit `/healthz` and `/api/ee-check`.

No custom domain yet: Route 53 stays untouched until there is a public
frontend worth naming (domain/subdomain remains an open owner decision).

## Environment variables

| Variable | Meaning |
| --- | --- |
| `PORT` | Listen port (Railway injects it; local default 8080) |
| `EE_SERVICE_ACCOUNT_KEY` | Service-account JSON key contents (preferred on Railway) |
| `EE_SERVICE_ACCOUNT_KEY_FILE` | Path to the JSON key file (convenient locally) |
| `EE_PROJECT_ID` | Earth Engine Cloud project ID (default `thematic-carver-502603-k5`) |

If both key variables are set, `EE_SERVICE_ACCOUNT_KEY` wins. With
neither set, the server boots and reports `not_configured` so a
misconfigured deploy is diagnosable from `/healthz`.

## What comes after the proof

All open owner decisions stay open (`docs/architecture.md`): backend
framework, API endpoint design, caching/precomputation, any database,
map library and frontend framework, domain/subdomain, and how the
exploration scripts' processing logic is reorganized into backend
modules. Nothing in this directory presupposes any of them.
