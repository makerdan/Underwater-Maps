# BathyScan

**A 3D seafloor and lake-bed exploration app for anglers, navigators, and marine scientists.**

BathyScan turns raw bathymetry (seafloor depth data) into an interactive 3D world you can fly through, drop markers in, plan drifts on, and overlay with live tides, currents, wind, water temperature, and habitat data. It's built for places like Southeast Alaska where the right depth, the right tide, and the right structure decide whether you catch fish — or run aground.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Repository Layout](#repository-layout)
- [Getting Started on Replit](#getting-started-on-replit)
- [Environment Variables](#environment-variables)
- [Development Workflows](#development-workflows)
- [AI Assistant](#ai-assistant)
- [Offline / PWA](#offline--pwa)
- [Acknowledgements & Data Sources](#acknowledgements--data-sources)

---

## Overview

BathyScan loads a bathymetric dataset (a depth grid for a named area like Thorne Bay) and renders it as a navigable 3D terrain in the browser. On top of that terrain you can:

- Drop and label personal markers (fishing spots, hazards, dive sites).
- Plan a drift or trolling course and watch how wind + tidal current will push the boat over the next several hours.
- Toggle live overlays for wind, tidal currents, surface temperature, and habitat zones (Essential Fish Habitat).
- Ask the built-in AI assistant questions about what you're looking at (e.g. "where are the deepest holes near this marker?").

It is delivered as a single Progressive Web App that also works offline once you've loaded a region.

## Features

**Terrain & navigation**
- 3D bathymetric terrain rendered with React Three Fiber / Three.js.
- Free-fly camera, virtual joystick (mobile), keyboard shortcuts, and minimap.
- Depth scale bar, depth legend, and selectable depth colour palettes (Default, High-Contrast, Warm).
- Optional smoothed vs. raw bathymetry view, with a "raw bathymetry" badge when smoothing is off.
- Underwater caustics (toggleable for performance).

**Datasets**
- Built-in presets (e.g. Thorne Bay, SE Alaska coverage) sourced from NCEI BAG mosaics and GEBCO, with a synthetic fallback when remote tiles are unavailable.
- Upload your own custom terrain dataset (signed-in users).
- Organise saved datasets into folders, with drag-and-drop, recursive delete with progress feedback, and a catalog of shareable presets.
- Overview map with a 2D top-down view, marker layer, and right-click context menu.

**Markers, trails & drift planning**
- Place, edit, delete, and detail-view markers; validated input (Zod) with length and control-character checks.
- Record a GPS trail while you move, save trails per user, and replay them.
- Drift planner: pick a launch point and watch a 24-hour trajectory under live wind + tidal current, with timeline scrubbing and per-hour speed/heading breakdown.
- Trolling mode: simple heading-and-speed, or multi-waypoint circuits with on-water force arrows showing boat propulsion vs. drift contribution.
- Save and reload favourite trolling presets.

**Live conditions overlays**
- **Tides:** NOAA tide predictions for the nearest heights station, scrubbing through high/low events.
- **Currents:** NOAA tidal currents predictions for the nearest currents station, with cached peak speeds.
- **Wind:** surface wind direction and speed.
- **Surface temperature:** live sea-surface temperature for the marker's coordinates.
- Each overlay can be styled independently as **arrows** or **particles**; particles bend around terrain using the local bathymetry gradient.

**Habitat & substrate**
- Essential Fish Habitat (EFH) zones overlaid on the map and 3D scene.
- Alaska ShoreZone substrate polygons (where available) with credit display.
- Per-dataset metadata flags so the UI only offers overlays that actually have data.

**Personal account**
- Sign in with Clerk to sync settings, markers, trails, custom datasets, and trolling presets across devices.
- Per-section settings reset, dirty-state tracking, and import/export of settings.

**AI assistant**
- Ask natural-language questions about the current view, markers, depth profiles, and conditions.
- Powered by the Poe AI proxy with optional OpenAI integration.

**Quality-of-life**
- PWA install + offline support for previously loaded regions.
- Keyboard shortcuts, accessible Radix UI components, dark mode by default.
- Depth profile chart with hover-to-highlight in the 3D scene and CSV/image export.

## Architecture

BathyScan is a pnpm monorepo with three deployable artifacts and several shared libraries.

```
   ┌────────────────────────┐         ┌─────────────────────────┐
   │  artifacts/bathyscan   │  HTTP   │  artifacts/api-server   │
   │  React + Vite + R3F    │ ──────► │  Express 5 (port 5000)  │
   │  PWA / Service Worker  │         │  Clerk auth middleware  │
   └─────────┬──────────────┘         └─────────┬───────────────┘
             │                                  │
             │ Clerk SSO                        │ Drizzle ORM
             ▼                                  ▼
       ┌───────────┐                     ┌──────────────┐
       │  Clerk    │                     │  PostgreSQL  │
       └───────────┘                     └──────────────┘
                                                │
                              ┌─────────────────┴──────────────────┐
                              ▼                                    ▼
                    NOAA tides & currents,                   Poe AI / OpenAI
                    NCEI BAG, GEBCO, EFH,                    (AI assistant)
                    ShoreZone, SST feeds
```

**API contract is the single source of truth.** `lib/api-spec/openapi.yaml` defines every HTTP endpoint. Orval generates:
- `@workspace/api-client-react` — typed React Query hooks the frontend consumes.
- `@workspace/api-zod` — Zod schemas the server uses to validate requests and responses.

This means any backend route change starts in the OpenAPI spec, the codegen is rerun, and both client and server stay in lockstep.

**The third artifact, `mockup-sandbox`**, is a separate Vite dev server used for prototyping individual UI components on the workspace Canvas. It is not part of the deployed product.

## Tech Stack

**Frontend (`artifacts/bathyscan`)**
- React 19, Vite 7, TypeScript 5.9
- Three.js 0.184, @react-three/fiber, @react-three/drei
- TanStack React Query (server state)
- Zustand (client state, with localStorage persistence)
- Tailwind CSS v4 + Radix UI primitives (shadcn-style components)
- React Hook Form + Zod validation
- Framer Motion, Recharts, lucide-react
- Clerk (`@clerk/react`) for authentication
- `vite-plugin-pwa` + Workbox for offline support
- idb-keyval for IndexedDB caching
- dnd-kit for drag-and-drop in the dataset library

**API server (`artifacts/api-server`)**
- Node.js 24, Express 5, TypeScript
- Bundled with esbuild via `build.mjs`
- Drizzle ORM on PostgreSQL
- Clerk Express middleware + Clerk proxy for SSO
- Pino structured logging
- Multer for dataset uploads
- Supertest + Vitest for route tests

**Shared libraries (`lib/`)**
- `api-spec` — OpenAPI 3.1 spec and Orval codegen pipeline.
- `api-client-react` — generated React Query hooks (TS project reference, emits `dist/*.d.ts`).
- `api-zod` — generated Zod schemas.
- `db` — Drizzle schema, migration tooling, and DB client (`drizzle-kit push`).
- `poe` — Poe AI client wrapper.
- `integrations/openai_ai_integrations` — OpenAI AI integration helpers (server + React).

**Tooling**
- pnpm workspaces, Node.js 24
- ESLint, Prettier
- Vitest (unit/integration), Playwright (e2e)

## Repository Layout

```
.
├── artifacts/
│   ├── bathyscan/        # The web app (React + Vite + R3F PWA)
│   ├── api-server/       # Express 5 API on port 5000
│   └── mockup-sandbox/   # Canvas component preview server (not deployed)
├── lib/
│   ├── api-spec/         # openapi.yaml + Orval codegen
│   ├── api-client-react/ # Generated React Query hooks
│   ├── api-zod/          # Generated Zod schemas
│   ├── db/               # Drizzle schema + Postgres client
│   ├── poe/              # Poe AI proxy client
│   └── integrations/
│       └── openai_ai_integrations/
├── scripts/              # Post-merge and maintenance scripts
├── tests/                # Playwright e2e specs (under artifacts/bathyscan/tests/e2e)
├── package.json
├── pnpm-workspace.yaml
└── replit.md
```

Inside `artifacts/bathyscan/src/`:
- `components/` — terrain, overlays, panels, HUD, marker UI, drift planner, etc.
- `pages/` — top-level routes (`TourScene`, `Settings`, `not-found`).
- `hooks/` — `useTidalData`, `useTidalSchedule`, `useSurfaceTemperature`, etc.
- `lib/` — Zustand stores (`settingsStore`, `uiStore`, `driftStore`), drift physics (`computeDrift.ts`), dev-auth bypass, test helpers.

Inside `artifacts/api-server/src/routes/`:
- `datasets`, `markers`, `folders`, `user-datasets`, `catalog-saves`, `trails`, `trolling-presets`
- `tidal`, `surface-conditions`, `water-temperature`, `substrate`, `efh`
- `settings`, `me`, `poe`, `query`, `health`

## Getting Started on Replit

The project is configured to run as three long-lived workflows. They start automatically inside Replit:

| Workflow | Command | What it does |
|---|---|---|
| `artifacts/api-server: API Server` | `pnpm --filter @workspace/api-server run dev` | Bundles and runs the Express API on port 5000 |
| `artifacts/bathyscan: web` | `pnpm --filter @workspace/bathyscan run dev` | Runs the Vite dev server for the BathyScan web app |
| `artifacts/mockup-sandbox: Component Preview Server` | `pnpm --filter @workspace/mockup-sandbox run dev` | Runs the isolated component preview server used by the Canvas |

Each artifact binds to the `PORT` environment variable assigned by Replit and is exposed through the path-based preview proxy. Pick which artifact to view from the dropdown in the preview pane.

**First-time setup checklist:**
1. Make sure the Postgres database is provisioned (Replit creates one automatically; `DATABASE_URL` will be set).
2. Add the required secrets (see below).
3. Push the schema: `pnpm --filter @workspace/db run push`.
4. Restart the API Server workflow if you changed env vars.

## Environment Variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `DATABASE_URL` | API server | Yes | Postgres connection string (provided by Replit). |
| `CLERK_PUBLISHABLE_KEY` | API server | Yes (for auth) | Used by the Clerk proxy middleware. |
| `CLERK_SECRET_KEY` | API server | Yes (for auth) | Server-side Clerk session verification. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Web app | Yes (for auth) | Frontend Clerk SDK init. Without it, sign-in is disabled. |
| `VITE_CLERK_PROXY_URL` | Web app | Optional | Override the Clerk proxy URL (defaults to `${BASE_URL}clerk`). |
| `LOG_LEVEL` | API server | Optional | Pino log level (`info`, `debug`, `warn`, `error`). |
| `NODE_ENV` | Both | Auto | Set to `development` by dev workflows. |
| `VITE_ENABLE_CAUSTICS` | Web app | Optional | Toggle the underwater caustics shader. |
| `VITE_TEXTURE_TILING` | Web app | Optional | Override terrain texture tiling factor. |
| `VITE_DEV_AUTH_BYPASS` | Web app | Dev/e2e only | When `1`, bypasses Clerk in headless Playwright runs. Never set in production. |

Secrets should be set through the Replit Secrets pane, not committed to the repo.

## Development Workflows

Top-level scripts (`package.json`):

| Command | Purpose |
|---|---|
| `pnpm run typecheck` | Codegen check + full TypeScript build across libs and artifacts. |
| `pnpm run lint` | ESLint on the bathyscan and api-server source trees. |
| `pnpm run test:unit` | Vitest suites in every package that defines them. |
| `pnpm run test:e2e` | Playwright end-to-end specs. |
| `pnpm run test-all` | typecheck + lint + test:unit (the CI gate). |
| `pnpm run build` | typecheck + per-package builds. |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate React Query hooks and Zod schemas from `openapi.yaml`. |
| `pnpm --filter @workspace/db run push` | Apply Drizzle schema to the database (dev). |

There are also named workflows configured in Replit for `lint`, `typecheck`, `test-unit`, `test-e2e`, and `test-all` that can be started on demand.

**When changing an API endpoint**: edit `lib/api-spec/openapi.yaml` first, run the codegen, then update the server route and the frontend consumer.

**When changing the DB schema**: edit `lib/db/src/schema/*.ts`, then run `pnpm --filter @workspace/db run push`.

## AI Assistant

BathyScan ships with a built-in AI assistant for natural-language questions about the current scene, markers, depth profile, and conditions. Requests are proxied through `/api/poe/*` on the API server, which calls the Poe AI API via `@workspace/poe`. There is also an OpenAI integration available under `lib/integrations/openai_ai_integrations` for alternate models.

The assistant runs with safe LLM output parsing (no eval, structured response validation) and surfaces classification errors as warnings in the console rather than crashing the UI.

## Offline / PWA

The web app is a Progressive Web App built with `vite-plugin-pwa` and Workbox.

- Once a region has been loaded, its terrain, markers, and recent settings are available offline.
- The app can be installed to the home screen on mobile.
- Service-worker precache + runtime route caching cover the static shell and API responses for previously visited regions.
- IndexedDB (via `idb-keyval`) stores larger user-generated content like GPS trails and custom uploads.

## Acknowledgements & Data Sources

BathyScan stands on a lot of public data and open-source work:

- **Bathymetry:** NOAA NCEI BAG mosaics; GEBCO global grid as a fallback.
- **Tides & currents:** NOAA CO-OPS (`api.tidesandcurrents.noaa.gov`).
- **Sea-surface temperature:** public SST feeds via the API server's `water-temperature` route.
- **Habitat:** NOAA Essential Fish Habitat (EFH) zone data.
- **Substrate:** Alaska ShoreZone substrate polygons (credit displayed in-app).
- **Auth:** [Clerk](https://clerk.com/).
- **AI:** Poe AI and OpenAI.
- **3D rendering:** Three.js, React Three Fiber, drei.
- **UI:** Radix UI, Tailwind CSS, shadcn-style components, Framer Motion, Recharts, lucide-react.

If you use BathyScan with public bathymetric data, please credit the upstream provider (NOAA / GEBCO / ShoreZone) alongside BathyScan itself.
