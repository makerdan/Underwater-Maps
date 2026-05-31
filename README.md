# BathyScan

**A 3D seafloor and lake-bed exploration app for anglers, navigators, and marine scientists.**

BathyScan turns raw bathymetry (seafloor depth data) into an interactive 3D world you can navigate, annotate, and overlay with live environmental data — tides, currents, wind, temperature, and habitat zones. It is built for places like Southeast Alaska where the right depth, the right tide, and the right structure decide whether you catch fish or run aground.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [3D Terrain & Camera](#2-3d-terrain--camera)
3. [HUD Elements](#3-hud-elements)
4. [Sidebar Panels](#4-sidebar-panels)
5. [Overlay Layers](#5-overlay-layers)
6. [Planning Tools](#6-planning-tools)
7. [Context Menu](#7-context-menu)
8. [Marker System](#8-marker-system)
9. [Overview Map](#9-overview-map)
10. [Supported Upload Formats](#10-supported-upload-formats)
11. [Data Processing Pipeline](#11-data-processing-pipeline)
12. [Caching Strategy](#12-caching-strategy)
13. [AI Assistant](#13-ai-assistant)
14. [Authentication](#14-authentication)
15. [Full API Route Surface](#15-full-api-route-surface)
16. [Progressive Web App (Offline)](#16-progressive-web-app-offline)
17. [Tech Stack](#17-tech-stack)
18. [Repository Layout](#18-repository-layout)
19. [Getting Started on Replit](#19-getting-started-on-replit)
20. [Environment Variables](#20-environment-variables)
21. [Development Workflows](#21-development-workflows)
22. [Key Architectural Decisions](#22-key-architectural-decisions)
23. [Data Sources & Acknowledgements](#23-data-sources--acknowledgements)

---

## 1. Product Overview

BathyScan loads a bathymetric dataset for a named area (e.g. Thorne Bay, SE Alaska), renders it as a navigable 3D terrain in the browser, and lets users layer on live environmental data, personal annotations, and planning tools. It targets anglers, navigators, and marine scientists who need depth, habitat, and conditions in a single, offline-capable interface.

The app supports two **environment modes**:
- **Saltwater** — full overlay suite including tides, currents, Essential Fish Habitat (EFH), and ShoreZone substrate.
- **Freshwater** — lake and river datasets; tide and current overlays are hidden; habitat layer adapts accordingly.

Preset datasets are sourced from NOAA NCEI BAG mosaics and the GEBCO global grid (used as a fallback). Signed-in users can upload their own terrain.

---

## 2. 3D Terrain & Camera

The 3D scene is built with React Three Fiber / Three.js. The terrain mesh is generated server-side from the active dataset and streamed to the client as a typed grid.

- **Free-fly camera** controlled by keyboard, mouse, and touch input.
- **Virtual joystick** for mobile and tablet navigation.
- **Depth colour palettes**: Default, High-Contrast, Warm — selectable in settings.
- **Terrain smoothing toggle**: disable to view the raw sounder grid; a "Raw Bathymetry" badge appears when smoothing is off.
- **Underwater caustics**: optional GLSL shader (controlled by `VITE_ENABLE_CAUSTICS`; toggleable per-session for performance).
- **Progressive loading**: a 64×64 low-resolution overview grid loads instantly; the full-resolution terrain follows.

---

## 3. HUD Elements

The heads-up display (`HUD.tsx`) renders transparent overlays directly on the viewscreen at all times.

| Element | Description |
|---|---|
| **Crosshair Reticle** | 40×40 px centre target showing Lon/Lat and depth (▼) at the camera focus. Shortcut hint for the Action Menu (default `Q`). |
| **Heading Indicator** | Top-left panel: current camera yaw in degrees (e.g. `HDG 045°`). |
| **Location Badges** | Contextual panels for GPS position, dataset centre, or intertidal hotspot name. |
| **Offline Badge** | Red ● OFFLINE indicator with a "cached data" lightning bolt when the network is unavailable. |
| **Simulated Data Warning** | Amber ⚠ SIMULATED DATA when real bathymetry sources are unreachable and depths are procedurally generated. |
| **Raw Bathymetry Badge** | Visible when terrain smoothing is disabled. |
| **Follow Me Toggle** | Locks the camera to the device's live GPS position. |
| **Dive to GPS** | Jumps the camera instantly to the current GPS coordinates. |
| **Share Button** | Copies a deep-link URL for the current view to the clipboard. |
| **Trail Recorder Controls** | Integrated start / stop / save buttons for live GPS breadcrumb trails. |
| **Depth Scale Bar** | Visual indicator of the current zoom level's vertical scale. |
| **Measurement Banner** | Displays the straight-line distance while the ruler tool is active. |

---

## 4. Sidebar Panels

Panels are collapsible and managed by `uiStore.ts` and `panelCollapseStore.ts`. Most panels are accessible via the icon rail on the left edge of the screen.

| Panel | Purpose |
|---|---|
| **Overlays & Tools** | Central switchboard for toggling Substrate, Wind, Tide, Current, and Weather Station overlays. |
| **Dataset / My Library** | Manage saved datasets and preset regions. Supports folders, drag-and-drop reordering, recursive folder delete with progress feedback, and a loading dial for active downloads. |
| **Find Data** | Global search of the NOAA NCEI bathymetry catalog by region name or species (intertidal hotspots). A rubber-band bbox tool on the overview map triggers catalog queries. |
| **Tide** | NOAA tide predictions for the nearest heights station: full high/low schedule, a time scrubber for past and future predictions, and Slack Jump buttons to jump to each tide event. |
| **Weather** | Wind speed/direction, tidal vectors, and wave height for the Drift Planner. Also hosts Trolling Presets and their folder management. |
| **Habitat (EFH)** | Lists Essential Fish Habitat (EFH) species detected in the current view with colour-coded toggles. |
| **Query ("Ask the Ocean")** | Natural-language LLM interface backed by `/api/query` (OpenAI tool-calling) or `/api/poe/query`. |
| **Depth Profile** | Vertical chart of temperature vs. depth (thermocline), triggered by clicking the on-screen depth readout. Supports CSV and image export. |
| **Routes** | Saved camera fly-through paths with playback and management controls. |

---

## 5. Overlay Layers

### Conditions Overlays (rendered in 3D)

All vector overlays can be styled as **arrows** or **particles**. Particle overlays bend around terrain using the local bathymetry gradient for a physically plausible appearance.

| Overlay | Data Source |
|---|---|
| Tidal currents | NOAA CO-OPS currents station nearest to the active dataset |
| Wind | NOAA ASOS/AWOS and RAWS weather stations |
| Surface temperature | NOAA/AOOS SST sensors |

### Habitat & Substrate (rendered on the terrain surface)

| Overlay | Data Source |
|---|---|
| Essential Fish Habitat (EFH) | NOAA EFH zone polygons (`/api/efh`) |
| ShoreZone substrate | Alaska ShoreZone sediment-type polygons (`/api/substrate/:id`); attribution shown in-app |
| AI substrate zones | Server-side heuristic + Poe AI classification (`/api/poe/classify`, `/api/datasets/:id/zones`) |

### Planning / Classification Overlays

| Overlay | Notes |
|---|---|
| Intertidal Hotspots | Named locations with species and habitat metadata; shown on the overview map and the Habitat panel. |
| Zone Paint Mode | Manually classify seabed regions by dragging colour-coded zones directly onto the 3D scene. |

---

## 6. Planning Tools

### Drift Planner
Select a launch point and the planner calculates where a drifting vessel will travel over the next 24 hours given current wind speed/direction and tidal current vectors. Output includes an animated trajectory on the 3D scene, per-hour speed and heading breakdown, and a timeline scrubber.

### Trolling Mode
Plot a simple heading + speed or a multi-waypoint circuit. On-water force arrows show boat propulsion vs. drift contribution at each waypoint. Users can save and reload named **Trolling Presets**, which are synced to the server per user.

### Depth Profiling
Click any point on the terrain or along a saved route to generate a vertical depth-vs-distance profile chart in the Depth Profile panel. Hover over the chart to highlight the corresponding point in the 3D scene.

### Trail Recording
Record a live GPS breadcrumb trail while moving (boat, kayak, shore walk). Trails are saved per user, displayed as a polyline on both the 3D scene and the overview map, and can be replayed or exported.

---

## 7. Context Menu

Right-click (desktop) or long-press (mobile) opens a context menu with:
- Drop a marker at the tapped point.
- Start a route from here.
- Measure distance to here (activates ruler tool).
- Other context-sensitive actions depending on what is under the pointer (existing marker, route waypoint, substrate segment).

---

## 8. Marker System

Markers are stored per dataset per user. Features include:
- Place, label, edit, and delete markers.
- Input validated with Zod (max length, no control characters).
- Marker Detail Card shows depth, coordinates, substrate type (if available), and tidal conditions at placement time.
- Markers appear on both the 3D scene and the 2D overview map.

---

## 9. Overview Map

The always-visible 2D top-down canvas overlay (`OverviewMap.tsx`) mirrors the 3D scene and adds:
- Heatmapped bathymetry with contour lines.
- Marker, route, and GPS trail layers.
- Substrate legend and Essential Fish Habitat (EFH) legend.
- NOAA ASOS/AWOS weather station pins and RAWS land-weather station pins.
- Intertidal Hotspot pins.
- **Rubber-band selection tool**: draw a bounding box to trigger a catalog search or download a terrain tile.
- Right-click / long-press context menu (same actions as the 3D scene).

---

## 10. Supported Upload Formats

| Format | Extension(s) | Notes |
|---|---|---|
| LAS point cloud | `.las` | Binary point cloud; direct WASM parse |
| LAZ compressed point cloud | `.laz` | `laz-perf` WASM decompressor; WASM heap is re-read per point to guard against memory growth |
| GeoTIFF raster | `.tif`, `.tiff` | Geographic raster; sub-sampled at a 2 M point cap |
| NetCDF grid | `.nc` | Gridded data; depth/elevation variable aliases: `bathy`, `topo`, `elevation`, etc. |
| BAG (Bathymetric Attributed Grid) | `.bag` | HDF5-based format via `h5wasm` WASM |
| Depth grid (delimited text) | `.csv`, `.xyz`, `.txt` | Parsed by `parseXyzCsv`; space-, comma-, or tab-separated |
| GPX track log | `.gpx` | `<ele>` (and variant depth tags) extracted from track points |
| NMEA depth-sounder log | `.nmea` | NMEA-0183 position + depth sentences |
| KML waypoints | `.kml` | Point geometry extracted |
| Gzip-compressed archive | `.gz` | Any of the above wrapped in gzip; stream-decompressed with a 200 MB safety cap |

---

## 11. Data Processing Pipeline

Uploads flow through one of three paths depending on file size:

1. **Direct upload (≤ 50 MB)** — `POST /api/datasets/upload` accepts the full file via Multer and queues it for parsing.

2. **Chunked upload (> 50 MB)** — clients slice the file into 5 MB segments:
   - `POST /api/datasets/upload/chunk` — receives one slice at a time; slices are written to `bathyscan-chunks/` on disk.
   - `POST /api/datasets/upload/chunk/finalize` — enqueues a background job that streams all chunks into a single assembled file.

3. **Direct-to-cloud (> 50 MB alternative)** — `POST /api/datasets/upload/request-gcs-url` returns a signed Google Cloud Storage URL. The client uploads directly to GCS; the server polls for completion via `GET /api/datasets/upload/gcs-job-status`.

**After assembly:**
- `.gz` files are stream-decompressed with a 200 MB cap.
- CPU-intensive parsing (point-cloud decompression, raster sub-sampling, grid generation) is delegated to a **worker thread** (`parseWorker.ts`) to keep the Node.js event loop responsive.
- Large raster files (GeoTIFF, NetCDF) are sub-sampled to a maximum of 2,000,000 grid points.
- On server startup, `recoverStaleUploadJobs` marks any jobs interrupted by a crash as `"error"` so users are prompted to re-upload.

---

## 12. Caching Strategy

BathyScan uses a layered caching approach to balance freshness, performance, and third-party API rate limits.

| Layer | Mechanism | What is cached |
|---|---|---|
| **In-memory** (`Map`) | Module-level caches in `tidal.ts`, `ncei.ts`, `poe.ts` | Tide predictions, NCEI search results, Poe responses |
| **Database** | `weather_station_cache`, `raws_observation_cache` tables | NOAA station metadata and RAWS observations; rows older than 24 h are pruned |
| **Background refresher** | `weatherCacheRefresher.ts` (every 30 min) | Proactively re-fetches rows staler than 15 min before the 1-hour fallback fires |
| **GCS/bucket monitor** | `bucketMonitor.ts` | GCS upload ACL state and dataset materialization status |
| **Cache registry** | `cacheRegistry.ts` | Central handle for clearing all module caches during tests |
| **Service worker** | `sw.ts` (Workbox, frontend) | Static app shell; API responses for previously visited regions |
| **IndexedDB** | `idb-keyval` (frontend) | GPS trails; custom-uploaded dataset blobs for offline access |

---

## 13. AI Assistant

Two AI backends are available and can be used independently or together.

### Poe AI (`/api/poe/*`, `@workspace/poe`)

| Endpoint | Purpose |
|---|---|
| `POST /api/poe/classify` | Substrate zone classification from a depth grid |
| `POST /api/poe/query` | General natural-language questions about the current scene |
| `POST /api/poe/describe` | Narrative description of the bathymetric scene |
| `POST /api/poe/help` | AI-driven help and documentation answers |
| `POST /api/poe/upscale` | AI-assisted super-resolution of a substrate heatmap |
| `GET /api/poe/models` | List available Poe model identifiers |

### OpenAI (`/api/query`, `lib/integrations/openai_ai_integrations`)

- Tool-calling endpoint that powers the **"Ask the Ocean"** Query Panel.
- The model can call defined tools (depth lookup, marker search, conditions fetch) to ground answers in live data.

Both backends use structured response validation. Classification errors surface as console warnings rather than crashing the UI.

---

## 14. Authentication

Authentication is provided by **Clerk** across all surfaces.

- **Frontend** (`artifacts/bathyscan`): `@clerk/react` is initialised with `VITE_CLERK_PUBLISHABLE_KEY`. The Clerk JS bundle is proxied through `${BASE_URL}clerk` to avoid ad-blocker interference.
- **API server** (`artifacts/api-server`): Clerk Express middleware validates session tokens on all protected routes using `CLERK_SECRET_KEY`.
- **Dev / e2e bypass**: `VITE_DEV_AUTH_BYPASS=1` skips Clerk in headless Playwright runs. This must **never** be set in production.

Signed-in users get: synced settings, personal markers and trails, custom datasets, trolling presets, and catalog saves — all persisted per `userId` in PostgreSQL.

---

<!-- GENERATED:API-ROUTES:START -->
## 15. Full API Route Surface

All routes are served under the `/api` prefix by the Express 5 server.

### Core Datasets

| Method | Path | Purpose |
|---|---|---|
| GET | `/datasets` | List available pre-loaded bathymetric regions |
| GET | `/datasets/:id/terrain` | Get gridded terrain data for a dataset |
| GET | `/datasets/:id/preview` | Probe which upstream source would serve this dataset |
| GET | `/datasets/:id/overview` | Get a low-resolution overview terrain for a dataset |

### Upload

| Method | Path | Purpose |
|---|---|---|
| POST | `/datasets/upload` | Upload an XYZ or CSV file and persist it to the user's dataset library |

### Catalog & Search

| Method | Path | Purpose |
|---|---|---|
| GET | `/datasets/catalog` | List all known public data sources in the catalog |
| GET | `/datasets/catalog/search` | Keyword search over the dataset catalog |
| POST | `/datasets/bbox-query` | Find catalog datasets whose coverage intersects a bounding box |
| GET | `/ncei/search` | Search the NCEI Bathymetry Geoportal |
| POST | `/ncei/save` | Save an NCEI portal result to the user's library |
| POST | `/datasets/catalog/:id/save` | Save a catalog dataset to the user's account |
| GET | `/datasets/my-saves` | List the authenticated user's saved catalog datasets |
| DELETE | `/datasets/my-saves/:id` | Delete a saved catalog dataset |
| GET | `/datasets/my-saves/:id/status` | Poll the status of a user's save job |
| POST | `/datasets/my-saves/:id/retry` | Retry materialization of a failed save |

### Habitat & Substrate

| Method | Path | Purpose |
|---|---|---|
| GET | `/intertidal-spots/:id` | Tidepool & beachcombing hotspot polygons scored from ShoreZone / AOOS data |
| GET | `/substrate/:id` | Real Alaska ShoreZone substrate polygons |
| GET | `/efh` | Essential Fish Habitat zones |

### User Datasets & Folders

| Method | Path | Purpose |
|---|---|---|
| GET | `/user/datasets` | List the current user's saved custom terrain datasets |
| GET | `/user/datasets/:id/terrain` | Get full terrain grid for a saved user dataset |
| GET | `/user/datasets/:id/overview` | Get low-resolution overview grid for a saved user dataset |
| DELETE | `/user/datasets/:id` | Delete a saved user terrain dataset |
| PATCH | `/user/datasets/:id/move` | Move a user dataset into a folder (or to the root) |
| POST | `/user/datasets/:id/duplicate` | Duplicate a user dataset into the same folder |
| PATCH | `/user/datasets/:id/rename` | Rename a user dataset |
| GET | `/user/folders` | List all dataset folders for the current user |
| POST | `/user/folders` | Create a new folder |
| PATCH | `/user/folders/:id/rename` | Rename a folder |
| PATCH | `/user/folders/:id/move` | Move a folder to a new parent |
| POST | `/user/folders/:id/duplicate` | Duplicate a folder (recursive deep copy) |
| DELETE | `/user/folders/:id` | Delete a folder |

### Markers

| Method | Path | Purpose |
|---|---|---|
| GET | `/markers` | List persisted markers for a dataset |
| POST | `/markers` | Create a new marker |
| DELETE | `/markers/mine` | Delete all markers created by the authenticated user |
| PATCH | `/markers/:id` | Edit a marker's label, type, or notes |
| DELETE | `/markers/:id` | Delete a marker by ID |

### Trails

| Method | Path | Purpose |
|---|---|---|
| GET | `/trails` | List GPS trails for a dataset |
| POST | `/trails` | Create a new GPS trail |
| DELETE | `/trails/:id` | Delete a GPS trail |
| GET | `/trails/:id/points` | Get paginated trail points |

### Trolling Presets & Folders

| Method | Path | Purpose |
|---|---|---|
| GET | `/trolling-presets` | List the authenticated user's trolling presets |
| POST | `/trolling-presets` | Save a new trolling preset |
| PATCH | `/trolling-presets/:id` | Update a trolling preset's name or sort order |
| DELETE | `/trolling-presets/:id` | Delete a trolling preset by ID |
| GET | `/trolling-preset-folders` | List the authenticated user's trolling preset folders |
| POST | `/trolling-preset-folders` | Create a new trolling preset folder |
| PATCH | `/trolling-preset-folders/:id` | Rename a trolling preset folder |
| DELETE | `/trolling-preset-folders/:id` | Delete a trolling preset folder (presets inside are moved to root) |

### Environment & Conditions

| Method | Path | Purpose |
|---|---|---|
| GET | `/surface-conditions` | Fetch hourly surface weather and tidal conditions for drift planning |
| GET | `/weather-stations` | Fetch nearby NOAA aviation weather station observations |
| GET | `/raws-stations` | Fetch nearby AOOS RAWS weather station list |
| GET | `/raws-weather` | Fetch latest observation for a single AOOS RAWS station |
| GET | `/water-temperature` | Fetch current sea-surface temperature for a lat/lon point |
| GET | `/temperature-profile` | Fetch a depth-resolved temperature profile for a lat/lon point |

### AI Assistant (Poe)

| Method | Path | Purpose |
|---|---|---|
| POST | `/poe/classify` | Classify terrain zones via AI |
| POST | `/poe/query` | Natural language terrain query |
| POST | `/poe/describe` | Stream a location description via SSE |
| GET | `/poe/models` | List available Poe models |

### Settings & System

| Method | Path | Purpose |
|---|---|---|
| GET | `/settings` | Get the current user's settings |
| PUT | `/settings` | Upsert the current user's settings |
| GET | `/healthz` | Health check |

<!-- GENERATED:API-ROUTES:END -->

---

## 16. Progressive Web App (Offline)

BathyScan is a full Progressive Web App built with `vite-plugin-pwa` and Workbox.

- The static app shell and API responses for previously visited regions are precached and available without a network connection.
- The app can be installed to the home screen on iOS and Android.
- Service-worker precache + runtime route caching cover the shell and recently loaded terrain/overlay data.
- `idb-keyval` (IndexedDB) stores GPS trails and custom-uploaded dataset blobs locally so they survive offline sessions.

---

## 17. Tech Stack

### Frontend (`artifacts/bathyscan`)

| Library / Tool | Role |
|---|---|
| React 19, Vite 7, TypeScript 5.9 | UI framework, bundler, type system |
| Three.js 0.184, @react-three/fiber, @react-three/drei | 3D rendering and scene management |
| TanStack React Query | Server state (API data fetching + caching) |
| Zustand (v5) | Client state with localStorage persistence |
| Tailwind CSS v4 + Radix UI | Styling and accessible component primitives (shadcn-style) |
| React Hook Form + Zod | Form state management and input validation |
| Framer Motion | Animations and transitions |
| Recharts | Depth profile and analytics charts |
| lucide-react | Icon set |
| `@clerk/react` | Authentication |
| `vite-plugin-pwa` + Workbox | PWA manifest and service worker |
| `idb-keyval` | IndexedDB storage for large offline assets |
| `dnd-kit` | Drag-and-drop in the dataset library |

### API Server (`artifacts/api-server`)

| Library / Tool | Role |
|---|---|
| Node.js 24, Express 5, TypeScript | Runtime, HTTP server, type system |
| esbuild (`build.mjs`) | CJS bundle for production |
| Drizzle ORM | PostgreSQL schema + query builder |
| Clerk Express middleware | Session token verification |
| Pino | Structured logging |
| Multer | Multipart file upload handling |
| Vitest + Supertest | Route-level integration tests |

### Shared Libraries (`lib/`)

| Package | Contents |
|---|---|
| `api-spec` | `openapi.yaml` — the single API contract + Orval codegen pipeline |
| `api-client-react` | Generated typed React Query hooks (TS project reference, emits `dist/*.d.ts`) |
| `api-zod` | Generated Zod schemas for server-side request/response validation |
| `db` | Drizzle schema, migration tooling, and the shared DB client |
| `poe` | Poe AI proxy client (`@workspace/poe`) |
| `integrations/openai_ai_integrations` | OpenAI integration helpers for server and React |

### Tooling

| Tool | Purpose |
|---|---|
| pnpm workspaces | Monorepo dependency management |
| ESLint (error on `react-hooks/exhaustive-deps`) | Lint gate |
| Prettier | Code formatting |
| Vitest | Unit and integration test runner |
| Playwright | End-to-end test runner |

---

## 18. Repository Layout

```
.
├── artifacts/
│   ├── bathyscan/           # The web app (React + Vite + R3F PWA)
│   │   ├── src/
│   │   │   ├── components/  # Terrain, overlays, panels, HUD, markers, planner
│   │   │   ├── pages/       # Top-level routes (TourScene, Settings, not-found)
│   │   │   ├── hooks/       # useTidalData, useSurfaceTemperature, etc.
│   │   │   └── lib/         # Zustand stores, drift physics, dev-auth bypass
│   │   └── tests/e2e/       # Playwright end-to-end specs
│   ├── api-server/          # Express 5 API on port 5000
│   │   └── src/
│   │       ├── routes/      # One file per route domain
│   │       ├── lib/         # parseWorker, cacheRegistry, bucketMonitor, etc.
│   │       └── app.ts       # Express app setup
│   └── mockup-sandbox/      # Canvas component preview server (not deployed)
├── lib/
│   ├── api-spec/            # openapi.yaml + Orval config
│   ├── api-client-react/    # Generated React Query hooks
│   ├── api-zod/             # Generated Zod schemas
│   ├── db/                  # Drizzle schema (schema/*.ts) + DB client
│   ├── poe/                 # Poe AI client wrapper
│   └── integrations/
│       └── openai_ai_integrations/
├── scripts/                 # Post-merge and maintenance scripts
├── package.json             # Root workspace scripts
├── pnpm-workspace.yaml
└── replit.md                # Replit-facing project description + preferences
```

---

## 19. Getting Started on Replit

Each artifact registers itself with the Replit artifacts system (via `artifact.toml`) and gets a long-lived dev process managed by the workspace.

| Workflow | Command | What it does |
|---|---|---|
| `artifacts/api-server: API Server` | `pnpm --filter @workspace/api-server run dev` | Bundles and runs the Express API on the assigned port |
| `artifacts/bathyscan: web` | `pnpm --filter @workspace/bathyscan run dev` | Runs the Vite dev server for the web app |
| `artifacts/mockup-sandbox: Component Preview Server` | `pnpm --filter @workspace/mockup-sandbox run dev` | Isolated component preview for Canvas |

Each artifact binds to the `PORT` environment variable assigned by Replit and is exposed through the path-based preview proxy.

**First-time setup:**
1. Ensure PostgreSQL is provisioned (`DATABASE_URL` is set automatically by Replit).
2. Add required secrets (see [Environment Variables](#20-environment-variables)).
3. Push the schema: `pnpm --filter @workspace/db run push`.
4. Restart the API Server workflow after setting env vars.

---

## 20. Environment Variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `DATABASE_URL` | API server | Yes | Postgres connection string (provided by Replit) |
| `CLERK_PUBLISHABLE_KEY` | API server | Yes | Clerk proxy middleware |
| `CLERK_SECRET_KEY` | API server | Yes | Server-side session token verification |
| `VITE_CLERK_PUBLISHABLE_KEY` | Web app | Yes | Frontend Clerk SDK initialisation |
| `VITE_CLERK_PROXY_URL` | Web app | Optional | Override the Clerk proxy URL (default: `${BASE_URL}clerk`) |
| `LOG_LEVEL` | API server | Optional | Pino log level (`info`, `debug`, `warn`, `error`) |
| `NODE_ENV` | Both | Auto | Set to `development` by dev workflows |
| `VITE_ENABLE_CAUSTICS` | Web app | Optional | Toggle the underwater caustics GLSL shader |
| `VITE_TEXTURE_TILING` | Web app | Optional | Override terrain texture tiling factor |
| `VITE_DEV_AUTH_BYPASS` | Web app | Dev/e2e only | Bypass Clerk in headless Playwright runs. **Never set in production.** |

All secrets should be set through the Replit Secrets pane; never commit them to the repository.

---

## 21. Development Workflows

| Command | Purpose |
|---|---|
| `pnpm run typecheck` | Codegen check + full TypeScript build across all libs and artifacts |
| `pnpm run lint` | ESLint on the bathyscan and api-server source trees |
| `pnpm run test:unit` | Vitest suites in every package that defines them |
| `pnpm run test:e2e` | Playwright end-to-end specs |
| `pnpm run test-all` | typecheck + lint + test:unit (the CI gate; runs automatically after every merge) |
| `pnpm run build` | typecheck + per-package production builds |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate React Query hooks and Zod schemas from `openapi.yaml` |
| `pnpm --filter @workspace/db run push` | Apply the Drizzle schema to the database (dev only) |

**Changing an API endpoint:** edit `lib/api-spec/openapi.yaml` first → run codegen → update the server route → update the frontend consumer.

**Changing the DB schema:** edit `lib/db/src/schema/*.ts` → run `pnpm --filter @workspace/db run push`.

---

## 22. Key Architectural Decisions

### API contract is the single source of truth
`lib/api-spec/openapi.yaml` defines every HTTP endpoint. Orval generates both the typed client hooks (`@workspace/api-client-react`) and the server-side Zod validators (`@workspace/api-zod`). A backend route change always starts with the spec.

### Zustand selectors are mandatory
Calling a Zustand store hook without a per-field selector (e.g. `useDriftStore()` instead of `useDriftStore(s => s.heading)`) causes a "getSnapshot should be cached" error in React 18 Concurrent Mode. All store usages must pass a selector.

### Vite deduplication for Zustand
`@react-three/drei` pulls in Zustand v4 (via `tunnel-rat`) alongside the app's own Zustand v5. Without `resolve.dedupe: ["zustand"]` in `vite.config.ts`, two incompatible Zustand instances coexist, breaking all stores silently. The dedupe entry is load-bearing.

### laz-perf WASM heap must be re-read per point
When decompressing a `.laz` file, capturing `lp.HEAPU8` once before the decompression loop is unsafe. WASM memory can grow mid-loop, detaching the original ArrayBuffer and causing out-of-bounds reads or silent data corruption. The heap view must be re-read from `lp.HEAPU8.buffer` on every `getPoint()` call.

### Worker threads for heavy parsing
All CPU-intensive upload parsing (point-cloud decompression, raster sub-sampling, HDF5 extraction) runs inside `parseWorker.ts`. This prevents large uploads from blocking the main Node.js event loop and degrading API responsiveness for concurrent users.

---

## 23. Data Sources & Acknowledgements

BathyScan is built on a foundation of public data and open-source software:

- **Bathymetry:** NOAA NCEI BAG mosaics; GEBCO global grid as a fallback when NCEI tiles are unavailable.
- **Tides & currents:** NOAA CO-OPS (`api.tidesandcurrents.noaa.gov`).
- **Sea-surface temperature:** NOAA/AOOS SST feeds via the API server's `water-temperature` route.
- **Habitat:** NOAA Essential Fish Habitat (EFH) zone data.
- **Substrate:** Alaska ShoreZone substrate polygons (attribution displayed in-app).
- **Auth:** [Clerk](https://clerk.com/).
- **AI:** Poe AI and OpenAI.
- **3D rendering:** Three.js, React Three Fiber, @react-three/drei.
- **UI:** Radix UI, Tailwind CSS, shadcn-style components, Framer Motion, Recharts, lucide-react.

If you use BathyScan with public bathymetric data, please credit the upstream data provider (NOAA / GEBCO / ShoreZone) alongside BathyScan itself.
