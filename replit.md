# BathyScan

BathyScan turns raw bathymetry (seafloor and lake-bed depth data) into an interactive 3D world you can navigate, annotate, and overlay with live environmental data — tides, currents, wind, temperature, and habitat zones.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm run docs` — regenerate the API route tables in README.md and replit.md from openapi.yaml
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- **GitHub sync** — `scripts/post-merge.sh` automatically pushes to the GitHub mirror after every successful merge. The push is skipped (with a log message) if `GITHUB_TOKEN` or `GITHUB_REPO_URL` is not set, so contributors without those secrets are unaffected. Set both secrets to keep the GitHub mirror current with no manual effort.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

```
.
├── artifacts/
│   ├── bathyscan/        # React + Vite + R3F PWA (the web app)
│   ├── api-server/       # Express 5 API on port 5000
│   └── mockup-sandbox/   # Canvas component preview server (not deployed)
├── lib/
│   ├── api-spec/         # openapi.yaml + Orval codegen (source of truth)
│   ├── api-client-react/ # Generated React Query hooks (TS project ref)
│   ├── api-zod/          # Generated Zod schemas
│   ├── db/               # Drizzle schema + Postgres client
│   ├── poe/              # Poe AI proxy client
│   └── integrations/openai_ai_integrations/
├── scripts/              # Post-merge and maintenance scripts
└── artifacts/bathyscan/tests/e2e/   # Playwright e2e specs
```

Key source-of-truth files:
- DB schema: `lib/db/src/schema/*.ts`
- API contract: `lib/api-spec/openapi.yaml`
- Zustand stores: `artifacts/bathyscan/src/lib/{settingsStore,uiStore,driftStore}.ts`
- Upload worker: `artifacts/api-server/src/lib/parseWorker.ts`

## Architecture decisions

- **API contract is first.** Every change to HTTP endpoints starts in `lib/api-spec/openapi.yaml`. Running codegen re-derives both the typed client hooks (`@workspace/api-client-react`) and the server-side Zod validators (`@workspace/api-zod`), so client and server stay in lockstep.
- **Zustand selectors always** — `useDriftStore()` (or any store) without a per-field selector causes a "getSnapshot should be cached" crash in React 18 Concurrent Mode. Always pass a selector, e.g. `useDriftStore(s => s.heading)`.
- **Vite dedupes Zustand** — `@react-three/drei` (via tunnel-rat) pulls in Zustand v4 alongside the app's v5. `vite.config.ts` sets `resolve.dedupe: ["zustand"]` to force one copy.
- **laz-perf WASM heap re-read** — capturing `lp.HEAPU8` before a LAZ decompression loop is unsafe; WASM memory can grow mid-loop, detaching the ArrayBuffer. Always re-read `lp.HEAPU8.buffer` inside `getPoint()`.
- **Worker threads for heavy parsing** — CPU-intensive upload parsing (LAS/LAZ, GeoTIFF, BAG) runs in `parseWorker.ts` to avoid blocking the main event loop.

## Product

### Overview

BathyScan loads a bathymetric dataset for a named area (e.g. Thorne Bay, SE Alaska), renders it as a navigable 3D terrain in the browser, and lets users layer on live environmental data, personal annotations, and planning tools. It targets anglers, navigators, and marine scientists who need depth + habitat + conditions in a single, offline-capable interface.

The app supports two environment modes — **saltwater** and **freshwater** — which affect which overlays and datasets are offered.

---

### 3D Terrain & Camera

The 3D scene is built with React Three Fiber / Three.js. The terrain mesh is generated server-side from the active dataset and streamed to the client as a typed grid.

- **Free-fly camera** with keyboard, mouse, and touch input.
- **Virtual joystick** on mobile/tablet.
- **Minimap / overview map** (2D top-down canvas, always visible).
- **Depth colour palettes**: Default, High-Contrast, Warm.
- **Terrain smoothing toggle**: disable to view the raw sounder grid (shown with a "Raw Bathymetry" badge).
- **Underwater caustics**: optional shader (toggleable for performance; controlled via `VITE_ENABLE_CAUSTICS`).
- **Low-resolution overview grid** (64×64) for fast initial load; full-resolution grid loads progressively.

---

### HUD Elements

The HUD (`HUD.tsx`) renders persistent, transparent overlays directly on the viewscreen.

| Element | Description |
|---|---|
| Crosshair Reticle | 40×40 px centre target showing Lon/Lat and depth (▼) at the camera focus. Shortcut hint for the Action Menu (default `Q`). |
| Heading Indicator | Top-left panel: current camera yaw in degrees (e.g. `HDG 045°`). |
| Location Badges | Contextual panels for GPS position, dataset centre, or intertidal hotspot. |
| Offline Badge | Red ● OFFLINE indicator + "cached data" bolt when the network is unavailable. |
| Simulated Data Warning | Amber ⚠ SIMULATED DATA when real bathymetry sources are unreachable and depths are procedurally generated. |
| Raw Bathymetry Badge | Visible when terrain smoothing is off. |
| Follow Me Toggle | Locks the camera to the live GPS position. |
| Dive to GPS | Jumps the camera to current GPS coordinates. |
| Share Button | Copies the current view URL to the clipboard. |
| Trail Recorder Controls | HUD-integrated start/stop/save buttons for live GPS breadcrumb trails. |
| Depth Scale Bar | Visual indicator of the current vertical scale. |
| Measurement Banner | Displays the measured distance when the ruler tool is active. |

---

### Sidebar Panels

Panels are collapsible, managed by `uiStore.ts` and `panelCollapseStore.ts`.

| Panel | Purpose |
|---|---|
| **Overlays & Tools** | Central switchboard for toggling Substrate, Wind, Tide, Current, and Weather Station overlays. |
| **Dataset / My Library** | Manage saved datasets and preset regions. Supports folders, drag-and-drop, recursive delete, and a loading dial for active downloads. |
| **Find Data** | Global search of the NCEI bathymetry catalog by region or species (intertidal hotspots). Rubber-band bbox selection on the overview map triggers catalog queries. |
| **Tide** | NOAA tide predictions for the nearest heights station: high/low schedule, time scrubber for past/future predictions, Slack Jump buttons. |
| **Weather** | Wind speed/direction, tidal vectors, wave height for the Drift Planner; also hosts Trolling Presets and folder management. |
| **Habitat (EFH)** | Lists Essential Fish Habitat (EFH) species detected in the current view with colour-coded toggles. |
| **Query ("Ask the Ocean")** | Natural-language LLM interface backed by `/api/query` (OpenAI tool-calling) or `/api/poe/query`. |
| **Depth Profile** | Vertical chart of temperature vs. depth (thermocline), triggered by clicking the depth readout; CSV and image export available. |
| **Routes** | Saved camera fly-through paths with playback controls. |

---

### Overlay Layers

#### Conditions (rendered in 3D)
All vector overlays can be styled as **arrows** or **particles**; particle overlays bend around terrain using the local bathymetry gradient.

| Overlay | Data Source |
|---|---|
| Tidal currents | NOAA CO-OPS currents station nearest to the active marker |
| Wind | Surface wind via NOAA/AOOS weather stations |
| Surface temperature | NOAA/AOOS SST sensors |

#### Habitat & Substrate (rendered on terrain surface)
| Overlay | Data Source |
|---|---|
| Essential Fish Habitat (EFH) | NOAA EFH zone polygons (`/api/efh`) |
| ShoreZone substrate | Alaska ShoreZone sediment polygons (`/api/substrate/:id`), credit shown in-app |
| AI substrate zones | Server-side heuristic + Poe AI classification (`/api/poe/classify`, `/api/datasets/:id/zones`) |

#### Planning / Classification Overlays
| Overlay | Notes |
|---|---|
| Intertidal Hotspots | Pinned locations with species and habitat metadata; visible on the overview map and the Habitat panel. |
| Zone Paint Mode | Manual seabed classification by colour-coded zone; drawn directly on the 3D scene. |

---

### Planning Tools

#### Drift Planner
Calculates where a drifting boat will travel over a 24-hour window given current wind and tidal current vectors. Output: animated trajectory path on the 3D scene, per-hour speed and heading breakdown, and a timeline scrubber.

#### Trolling Mode
Plot a heading + speed or a multi-waypoint circuit. On-water force arrows show boat propulsion vs. drift contribution. Users can save and reload named Trolling Presets.

#### Depth Profiling
Click any point on the terrain or along a route to generate a vertical depth-vs-distance profile rendered in the Depth Profile panel.

#### Trail Recording
Record a live GPS breadcrumb trail, save it per user, and replay it over the 3D scene.

---

### Context Menu

Right-click (desktop) or long-press (mobile) opens a context menu with:
- Drop a marker at the tapped point.
- Start a route from here.
- Measure distance to here (activates ruler).
- Other contextual actions depending on what is under the pointer (marker, route waypoint, substrate segment).

---

### Marker System

Markers are per-dataset, per-user. Features:
- Place, label, edit, and delete markers; inputs validated (Zod) for length and control characters.
- Marker Detail Card with depth, coordinates, substrate type (if available), and tidal conditions at placement time.
- Markers appear on both the 3D scene and the 2D overview map.

---

### Overview Map

Always-visible 2D top-down canvas overlay:
- Heatmapped bathymetry + contour lines.
- Marker layer, route layer, GPS trail layer.
- Substrate legend, EFH legend.
- NOAA ASOS/AWOS weather-station pins and RAWS land-weather pins.
- Intertidal Hotspot pins.
- Rubber-band selection tool (bbox download or catalog search).
- Right-click context menu (same as 3D scene).

---

### Supported Upload Formats

| Format | Extension(s) | Notes |
|---|---|---|
| LAS point cloud | `.las` | Binary point cloud, direct WASM parse |
| LAZ compressed point cloud | `.laz` | `laz-perf` WASM decompressor; heap re-read rule applies |
| GeoTIFF raster | `.tif`, `.tiff` | Sub-sampled at 2 M points cap |
| NetCDF grid | `.nc` | Depth/elevation aliases: `bathy`, `topo`, etc. |
| BAG (Bathymetric Attributed Grid) | `.bag` | HDF5 format via `h5wasm` WASM |
| Comma/space-delimited depth grid | `.csv`, `.xyz`, `.txt` | Parsed by `parseXyzCsv` |
| GPX track log | `.gpx` | `<ele>` depth tags extracted |
| NMEA depth-sounder log | `.nmea` | NMEA-0183 position + depth sentences |
| KML waypoints | `.kml` | Waypoint positions |
| Gzip-wrapped any of the above | `.gz` | Stream-decompressed with 200 MB safety cap |

---

### Data Processing Pipeline

1. **Small uploads (≤ 50 MB)** — `POST /datasets/upload` accepts the full file via Multer.
2. **Chunked uploads (> 50 MB)** — clients slice the file into 5 MB chunks (`POST /datasets/upload/chunk`), then call `POST /datasets/upload/chunk/finalize`. Chunks are streamed on disk in `bathyscan-chunks/` to keep RAM flat.
3. **Direct-to-cloud (> 50 MB alternative)** — `POST /datasets/upload/request-gcs-url` returns a signed GCS URL; the client uploads directly to Google Cloud Storage. The server polls GCS completion via `GET /datasets/upload/gcs-job-status`.
4. **Assembly** — after finalization, chunks are streamed into a single file; `.gz` files are stream-decompressed with a 200 MB cap.
5. **Background worker thread** — CPU-intensive parsing (point-cloud decompression, raster sub-sampling) runs in `parseWorker.ts` so the event loop is never blocked.
6. **Stale-job recovery** — on server startup, `recoverStaleUploadJobs` marks jobs interrupted by a crash as "error" so users know to re-upload.

---

### Caching Strategy

| Layer | Mechanism | What is cached |
|---|---|---|
| In-memory (module-level `Map`) | `tidal.ts`, `ncei.ts`, `poe.ts` | Tide predictions, NCEI search results, Poe responses |
| Database rows | `weather_station_cache`, `raws_observation_cache` | NOAA station metadata, RAWS observations (pruned > 24 h, stale refresh > 15 min) |
| Background refresher | `weatherCacheRefresher.ts` (runs every 30 min) | Proactively re-fetches stale weather rows before the 1-hour fallback fires |
| Bucket monitor | `bucketMonitor.ts` | GCS upload ACL state + dataset materialization status |
| Cache registry | `cacheRegistry.ts` | Central handle for clearing all module caches during tests |
| Frontend service worker | `artifacts/bathyscan/src/sw.ts` (Workbox) | Static shell, API responses for visited regions |
| Frontend IndexedDB | `idb-keyval` | GPS trails, custom dataset blobs |

---

### AI Assistant

Two AI backends are integrated:

1. **Poe AI** (`/api/poe/*`, `@workspace/poe`):
   - `POST /poe/classify` — substrate classification from a depth grid.
   - `POST /poe/query` — general natural-language questions.
   - `POST /poe/describe` — narrative description of the current bathymetric scene.
   - `POST /poe/help` — AI-driven help and documentation answers.
   - `POST /poe/upscale` — AI-assisted substrate heatmap super-resolution.

2. **OpenAI** (`/api/query`, `lib/integrations/openai_ai_integrations`):
   - Tool-calling endpoint powering the "Ask the Ocean" Query Panel.
   - Structured response validation; classification errors surface as console warnings rather than crashes.

---

### Authentication

Authentication is handled by **Clerk** across all surfaces:
- Frontend: `@clerk/react` initialised with `VITE_CLERK_PUBLISHABLE_KEY`; proxied through `${BASE_URL}clerk`.
- API server: Clerk Express middleware validates session tokens on every protected route (`CLERK_SECRET_KEY`).
- Dev/e2e bypass: `VITE_DEV_AUTH_BYPASS=1` skips Clerk in headless Playwright runs. Never set in production.

---

<!-- GENERATED:API-ROUTES:START -->
### Full API Route Surface

#### Core Datasets

| Method | Path | Purpose |
|---|---|---|
| GET | `/datasets` | List available pre-loaded bathymetric regions |
| GET | `/datasets/:id/terrain` | Get gridded terrain data for a dataset |
| GET | `/datasets/:id/preview` | Probe which upstream source would serve this dataset |
| GET | `/datasets/:id/overview` | Get a low-resolution overview terrain for a dataset |
| GET | `/datasets/:id/zones` | Get AI-classified seafloor/lake-bed zones for a dataset |

#### Upload

| Method | Path | Purpose |
|---|---|---|
| POST | `/datasets/upload` | Upload an XYZ or CSV file and persist it to the user's dataset library |
| POST | `/datasets/upload/chunk` | Upload one chunk of a large dataset file |
| POST | `/datasets/upload/chunk/finalize` | Finalize a chunked upload and start processing |
| GET | `/datasets/upload/jobs/:jobId` | Poll the status of a chunked-upload processing job |
| POST | `/datasets/upload/request-gcs-url` | Get a presigned GCS PUT URL for oversized file uploads |
| GET | `/datasets/upload/gcs-job-status` | Check processing status for a GCS-backed upload job |

#### Catalog & Search

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

#### Habitat & Substrate

| Method | Path | Purpose |
|---|---|---|
| GET | `/intertidal-spots/:id` | Tidepool & beachcombing hotspot polygons scored from ShoreZone / AOOS data |
| GET | `/substrate/:id` | Real Alaska ShoreZone substrate polygons |
| GET | `/efh` | Essential Fish Habitat zones |

#### User Datasets & Folders

| Method | Path | Purpose |
|---|---|---|
| GET | `/user/datasets` | List the current user's saved custom terrain datasets |
| GET | `/user/datasets/:id/terrain` | Get full terrain grid for a saved user dataset |
| GET | `/user/datasets/:id/overview` | Get low-resolution overview grid for a saved user dataset |
| GET | `/user/datasets/:id/hyd93-features` | Get HYD93 cartographic annotation features for a saved user dataset |
| GET | `/user/datasets/:id/raster-image` | Get the scanned raster image for a dataset pending georeferencing |
| POST | `/user/datasets/:id/georef` | Submit georeferencing control points for a pending raster |
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

#### Markers

| Method | Path | Purpose |
|---|---|---|
| GET | `/markers` | List persisted markers for a dataset |
| POST | `/markers` | Create a new marker |
| DELETE | `/markers/mine` | Delete all markers created by the authenticated user |
| PATCH | `/markers/:id` | Edit a marker's label, type, or notes |
| DELETE | `/markers/:id` | Delete a marker by ID |

#### Trails

| Method | Path | Purpose |
|---|---|---|
| GET | `/trails` | List GPS trails for a dataset |
| POST | `/trails` | Create a new GPS trail |
| DELETE | `/trails/:id` | Delete a GPS trail |
| GET | `/trails/:id/points` | Get paginated trail points |

#### Trolling Presets & Folders

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

#### Environment & Conditions

| Method | Path | Purpose |
|---|---|---|
| GET | `/surface-conditions` | Fetch hourly surface weather and tidal conditions for drift planning |
| GET | `/weather-stations` | Fetch nearby NOAA aviation weather station observations |
| GET | `/raws-stations` | Fetch nearby AOOS RAWS weather station list |
| GET | `/raws-weather` | Fetch latest observation for a single AOOS RAWS station |
| GET | `/water-temperature` | Fetch current sea-surface temperature for a lat/lon point |
| GET | `/temperature-profile` | Fetch a depth-resolved temperature profile for a lat/lon point |
| GET | `/tidal` | Current tide height, current speed/direction, and next high/low event |
| GET | `/tidal/schedule` | Multi-day tide schedule with slack windows |
| GET | `/tidal/pack` | Packed tide-height and current predictions for a location |
| GET | `/weather/pack` | Weather snapshot for offline packs |

#### AI Assistant (Poe)

| Method | Path | Purpose |
|---|---|---|
| POST | `/poe/classify` | Classify terrain zones via AI |
| POST | `/poe/query` | Natural language terrain query |
| POST | `/poe/describe` | Stream a location description via SSE |
| GET | `/poe/models` | List available Poe models |
| POST | `/poe/help` | Answer a BathyScan help question using Poe AI |
| POST | `/poe/upscale` | Upscale a 2D heatmap PNG via Poe (TopazLabs model) |

#### AI Query (OpenAI)

| Method | Path | Purpose |
|---|---|---|
| POST | `/query` | Natural-language terrain query via OpenAI tool calling ("Ask the Ocean") |

#### Navigation Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/routes` | List saved navigation routes for a dataset |
| POST | `/routes` | Create a new saved navigation route |
| PATCH | `/routes/:id` | Rename a saved navigation route |
| DELETE | `/routes/:id` | Delete a saved navigation route |

#### GitHub Sync

| Method | Path | Purpose |
|---|---|---|
| GET | `/github/repos` | List GitHub repositories accessible to the configured PAT |
| GET | `/github/repos/:owner/:repo/contents/:path` | Read a file or list a directory from a GitHub repository |
| PUT | `/github/repos/:owner/:repo/contents/:path` | Create or update a file in a GitHub repository |
| DELETE | `/github/repos/:owner/:repo/contents/:path` | Delete a file from a GitHub repository |
| POST | `/github/repos/:owner/:repo/actions/workflows/:workflow_id/dispatches` | Trigger a GitHub Actions workflow_dispatch event |
| GET | `/github/repos/:owner/:repo/actions/runs` | List GitHub Actions workflow runs for a repository |
| GET | `/github/repos/:owner/:repo/actions/runs/:run_id` | Get a single GitHub Actions workflow run |

#### Account

| Method | Path | Purpose |
|---|---|---|
| GET | `/me/export` | Export all user data as a downloadable JSON file |
| DELETE | `/me` | Permanently delete the authenticated user's account and all associated data |

#### Settings & System

| Method | Path | Purpose |
|---|---|---|
| GET | `/settings` | Get the current user's settings |
| PUT | `/settings` | Upsert the current user's settings |
| GET | `/healthz` | Health check |
| GET | `/healthz/deep` | Deep health probe — checks DB, Poe, and AOOS subsystems |
| GET | `/admin/bucket-monitor` | GCS dataset landing bucket processing summary |
| GET | `/admin/large-datasets-diff` | Detect Large_Datasets files that have changed since last import |

#### Other

| Method | Path | Purpose |
|---|---|---|
| GET | `/efh/:id` | Essential Fish Habitat zones for a specific dataset |
| GET | `/terrain/land` | Fetch a land-elevation (DEM) grid for a bounding box |
| GET | `/terrain/satellite-tile` | Proxy a satellite/aerial imagery PNG for a bounding box |
| GET | `/terrain/terrain-tile` | Proxy a USGS hillshaded terrain PNG for a bounding box |
| GET | `/terrain/download/info` | Preflight for bbox terrain CSV download |
| GET | `/terrain/download` | Stream a terrain CSV for a bounding box |
| DELETE | `/datasets/presets/:id` | Disable a built-in preset dataset |

<!-- GENERATED:API-ROUTES:END -->

---

### Progressive Web App (Offline Support)

- Built with `vite-plugin-pwa` + Workbox.
- Static shell and API responses for visited regions are precached and available offline.
- App can be installed to the home screen on mobile.
- `idb-keyval` (IndexedDB) stores GPS trails and custom-uploaded dataset blobs for offline access.

---

## User preferences

- Always spell out "EFH" as "Essential Fish Habitat" in user-facing copy (UI strings, help articles, READMEs, OpenAPI summaries/descriptions). Bare "EFH" is allowed only as a parenthetical after the full phrase on first mention, e.g. "Essential Fish Habitat (EFH)". Code identifiers, file names, route paths, dataset `source` strings, log lines, and test-only strings are unaffected.

## Gotchas

- `pnpm run test-all` (typecheck + lint + unit tests) is the green-bar gate. It runs automatically after every merge via `scripts/post-merge.sh`, so a regression in any of the three will fail the merge.
- `react-hooks/exhaustive-deps` is configured as an **error** (not a warning) in `eslint.config.mjs`. Don't silence it lazily — either include the dependency or refactor; suppressions need an inline justification.
- When changing an API endpoint: edit `lib/api-spec/openapi.yaml` first, run codegen, then update the server route and the frontend consumer. After that run `pnpm run docs` to keep README.md and replit.md in sync (CI fails if they drift via `check:docs-stale`).
- When changing the DB schema: edit `lib/db/src/schema/*.ts`, then run `pnpm --filter @workspace/db run push`.

## Environment Variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `DATABASE_URL` | API server | Yes | Postgres connection string (provided by Replit) |
| `CLERK_PUBLISHABLE_KEY` | API server | Yes | Clerk proxy middleware |
| `CLERK_SECRET_KEY` | API server | Yes | Server-side session verification |
| `VITE_CLERK_PUBLISHABLE_KEY` | Web app | Yes | Frontend Clerk SDK init |
| `VITE_CLERK_PROXY_URL` | Web app | Optional | Override Clerk proxy URL |
| `LOG_LEVEL` | API server | Optional | Pino log level (`info`, `debug`, `warn`, `error`) |
| `VITE_ENABLE_CAUSTICS` | Web app | Optional | Toggle underwater caustics shader |
| `VITE_TEXTURE_TILING` | Web app | Optional | Override terrain texture tiling factor |
| `VITE_DEV_AUTH_BYPASS` | Web app | Dev/e2e only | Bypass Clerk in headless Playwright runs. Never set in production. |

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
