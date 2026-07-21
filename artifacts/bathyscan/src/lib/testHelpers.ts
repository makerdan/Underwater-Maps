/**
 * Dev/test-only window exposure of internal Zustand stores so end-to-end
 * tests (Playwright) can drive the UI without going through the full
 * Clerk-authenticated 3D canvas + raycaster pipeline.
 *
 * Hard gates (defense in depth):
 *   1. The call site in `main.tsx` is wrapped in
 *      `import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === "1"`,
 *      which Vite statically replaces in production builds so the entire
 *      module — and `window.__bathyTest` with it — is tree-shaken away.
 *   2. `installTestHelpers()` itself re-checks both flags at runtime and
 *      throws in `import.meta.env.PROD` so any accidental call in a
 *      production bundle crashes loudly instead of silently exposing the
 *      forge-auth-headers back door.
 *   3. A Vite plugin (`failOnTestBackdoor` in `vite.config.ts`) inspects
 *      every emitted chunk during production builds and fails the build
 *      if the literal `__bathyTest` is present.
 *   4. A vitest build-inspection test (`testHelpers.bundle.test.ts`) runs
 *      a real production build and asserts `__bathyTest` is absent from
 *      the output, so this guard is exercised in CI.
 */
import { useTerrainStore } from "./terrainStore";
import { useDriftStore } from "./driftStore";
import { useContextMenuStore, type ContextMenuItem } from "./contextMenuStore";
import { useMeasureStore } from "./measureStore";
import { useMarkerDetailStore } from "./markerDetailStore";
import { useMarkerEditStore } from "./markerEditStore";
import { useUiStore } from "./uiStore";
import { useCameraStore } from "./cameraStore";
import { useClassificationStore } from "./classificationStore";
import { useHabitatStore } from "./habitatStore";
import type { SpeciesId } from "./habitat";
import { haversineDistance } from "./geo";
import { getSimulatedTreatmentMap } from "./simulatedTreatmentRegistry";
import { queryClient } from "./queryClient";
import { runMarkerDelete, type DeleteMarkerMutation } from "./markerActions";
import {
  deleteMarkersId,
  getGetMarkersQueryKey,
  getGetDatasetsIdTerrainQueryKey,
  getGetDatasetsQueryKey,
  getGetEfhQueryKey,
  getGetSubstrateQueryKey,
  type DatasetMeta,
  type Marker,
  type TerrainData,
  type EfhFeatureCollection,
  type EfhSpeciesProperties,
  type SubstrateFeatureCollection,
} from "@workspace/api-client-react";
import { useDepthProfileStore, buildProfile } from "./depthProfileStore";
import { getUpscaleCacheInfo, getInMemCacheStats } from "../hooks/useUpscaledHeatmap";
import { useSettingsStore } from "./settingsStore";
import type { LastSession } from "./settingsStore";
import { usePaletteStore } from "./paletteStore";
import { usePaletteSuggestionStore } from "../hooks/usePaletteSuggestion";
import { useShallowSuggestionStore } from "../hooks/useShallowSuggestion";
import { worldXZToLonLat, buildTerrainGeometry } from "./terrain";
import { callRegisteredResetCamera } from "./resetCameraRegistry";
import { applyCameraSpawn } from "./cameraSpawn";
import {
  hasPendingOrInFlightSettingsSync,
  hasUnackedSettingsEdits,
  isServerSettled,
} from "../hooks/useServerSettingsSync";
import { processFlyWheel } from "./flyWheel";
import { useZoneOverlayStore, ZONE_DEFAULT_COLORS } from "./zoneOverlayStore";
import { openCrosshairContextMenu } from "./terrainContextMenu";
import { setBypassSimulateSignedOut } from "./clerkCompat";
import * as THREE from "three";

/** Small synthetic terrain grid used by e2e tests when no real dataset is
 *  loaded (no signed-in user). Depth ramps west→east 0→1000m so the profile
 *  has a non-zero MIN/MAX range. */
function syntheticTestGrid(): TerrainData {
  const N = 32;
  const depths: number[] = new Array(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      depths[r * N + c] = (c / (N - 1)) * 1000;
    }
  }
  return {
    datasetId: "e2e-synthetic",
    name: "e2e",
    waterType: "saltwater",
    resolution: N,
    width: N,
    height: N,
    depths,
    minDepth: 0,
    maxDepth: 1000,
    minLon: -132.5,
    maxLon: -132.3,
    minLat: 55.9,
    maxLat: 56.1,
    centerLon: -132.4,
    centerLat: 56.0,
  } as unknown as TerrainData;
}

// Getter for the number of substrate features currently held in the
// OverviewMap's substrateFeaturesRef. Registered by OverviewMap via
// registerSubstrateFeatureGetter so e2e tests can confirm the 2D layer has
// received the data that will be drawn to the canvas, without needing a pixel
// assertion.
let _substrateFeatureGetter: (() => number) | null = null;

export function registerSubstrateFeatureGetter(getter: () => number): void {
  _substrateFeatureGetter = getter;
}

// RAWS popup state setters registered by OverviewMap so e2e tests can open
// the popover without reverse-engineering canvas hit coordinates.
let _rawsPopupSetId: ((id: string | null) => void) | null = null;
let _rawsPopupSetPos: ((pos: { cx: number; cy: number } | null) => void) | null = null;

export function registerRawsPopupHandlers(
  setId: (id: string | null) => void,
  setPos: (pos: { cx: number; cy: number } | null) => void,
): void {
  _rawsPopupSetId = setId;
  _rawsPopupSetPos = setPos;
}

// Getter for the canvas-space positions of rendered RAWS station pins.
// Registered by OverviewMap via registerRawsCanvasPositionGetter so tests
// can read actual rendered coordinates and dispatch real canvas clicks.
let _rawsCanvasPositionGetter: (() => Array<{
  datasetId: string;
  cx: number;
  cy: number;
}>) | null = null;

export function registerRawsCanvasPositionGetter(
  getter: () => Array<{ datasetId: string; cx: number; cy: number }>,
): void {
  _rawsCanvasPositionGetter = getter;
}

// AppContext-backed setter wired up by the in-tree <TestBridge/> component
// mounted inside <AppProvider/>. Without this, helpers have no way to reach
// React context state from a plain window-side call.
let appSetTerrain: ((t: TerrainData | null) => void) | null = null;
let appSetDatasetId: ((id: string | null) => void) | null = null;
let appGetTerrainRef: { current: TerrainData | null } = { current: null };
let appSetRealisticMode: ((b: boolean) => void) | null = null;
let appRealisticModeRef: { current: boolean } = { current: false };
let appSetTidalOverlay: ((v: boolean) => void) | null = null;
let appFeedTidalData: ((data: unknown) => void) | null = null;
export function registerTestBridge(
  setTerrain: (t: TerrainData | null) => void,
  setDatasetId?: (id: string | null) => void,
  terrainRef?: { current: TerrainData | null },
  setRealisticMode?: (b: boolean) => void,
  realisticModeRef?: { current: boolean },
  setTidalOverlay?: (v: boolean) => void,
  feedTidalData?: (data: unknown) => void,
): void {
  appSetTerrain = setTerrain;
  if (setDatasetId) appSetDatasetId = setDatasetId;
  if (terrainRef) appGetTerrainRef = terrainRef;
  if (setRealisticMode) appSetRealisticMode = setRealisticMode;
  if (realisticModeRef) appRealisticModeRef = realisticModeRef;
  if (setTidalOverlay) appSetTidalOverlay = setTidalOverlay;
  if (feedTidalData) appFeedTidalData = feedTidalData;
}

// The EFH species detail panel is now driven by uiStore.selectedEfh so the
// 2D OverviewMap and the 3D EfhZoneLayer both open the same card. Tests
// drive it through `openEfhDetailForFeature` below, which writes directly
// to the store instead of reverse-engineering the canvas projection / 3D
// raycaster to click an exact pixel.

// Camera position is mutated each frame inside the Three.js render loop and
// pushed into AppContext via `setCameraPos`. The TestBridge component below
// hands us a ref that always points at the latest value so e2e tests can
// assert on camera movement without poking into React internals.
let cameraPosRef: { current: [number, number, number] } = { current: [0, 0, 0] };
export function registerTestCameraPosRef(
  ref: { current: [number, number, number] },
): void {
  cameraPosRef = ref;
}

// Direct handle on the THREE.PerspectiveCamera inside the <Canvas>. Used by
// e2e tests so we can observe wheel-dolly position changes synchronously,
// without waiting for the React useFrame → setCameraPos round-trip (which
// can lag behind dispatched events in headless test runs).
interface CameraLike {
  position: { x: number; y: number; z: number };
}
let threeCameraRef: CameraLike | null = null;
export function registerTestThreeCamera(camera: CameraLike | null): void {
  threeCameraRef = camera;
}

export interface BathyTestApi {
  showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  hideContextMenu: () => void;
  showTerrainMenu: (
    x: number,
    y: number,
    point: { lon: number; lat: number; depth: number },
  ) => void;
  measureAnchor: (point: { lon: number; lat: number; depth: number }) => void;
  measureTo: (point: { lon: number; lat: number; depth: number }) => void;
  clearMeasurement: () => void;
  showMarkerDetail: (marker: {
    id: string;
    lon: number;
    lat: number;
    depth: number;
    label: string;
  }) => void;
  hideMarkerDetail: () => void;
  getMeasurementResult: () =>
    | { distanceKm: number; depthDeltaM: number }
    | null;
  setOverviewOpen: (open: boolean) => void;
  isOverviewOpen: () => boolean;
  getPendingDropIn: () => { worldX: number; worldZ: number } | null;
  clearPendingDropIn: () => void;
  /** Whether the Marker form panel is currently open. */
  isMarkerFormOpen: () => boolean;
  /** Force-close the Marker form panel (used to reset between assertions). */
  setMarkerFormOpen: (open: boolean) => void;
  /** Coordinates last captured by a "Place marker here" or similar action. */
  getLastClickedGps: () => { lon: number; lat: number; depth: number } | null;
  /** Reset the lastClickedGps cameraStore slot (used to isolate tests). */
  clearLastClickedGps: () => void;
  /**
   * Drive the `crosshairGps` cameraStore slot that the underwater reticle
   * publishes each frame after raycasting the terrain. The Q-key shortcut
   * and the HUD's touch "⋯ ACTIONS" button both read this slot via
   * `openCrosshairContextMenu` to decide whether to pop the action menu, so
   * e2e tests use this helper to simulate "crosshair is on terrain" without
   * standing up a real Three.js raycaster in headless Chromium.
   */
  setCrosshairGps: (
    gps: { lon: number; lat: number; depth: number } | null,
  ) => void;
  /**
   * Mirror the Q-key block in `useFlyControls.handleKeyDown` so e2e specs
   * can exercise the crosshair shortcut without the real Three.js Canvas
   * being mounted (headless Chromium currently can't initialise WebGL on
   * Replit-managed hosts, so the production keydown listener inside
   * `useFlyControls` may not be attached).
   *
   * Returns whatever `openCrosshairContextMenu` returns — `true` when the
   * menu actually opened, `false` when the crosshair is off-terrain or no
   * dataset is loaded. The viewport-centre coordinates and the
   * test-bridged terrain ref match exactly what the production handler
   * passes.
   */
  pressCrosshairShortcut: () => boolean;
  /**
   * Read the persisted "home position" for a dataset (settings store
   * slice mutated by the "Set as home position" menu item). Returns
   * undefined when no home has been saved for that dataset.
   */
  getDatasetHome: (
    datasetId: string,
  ) => { lon: number; lat: number; depth: number } | undefined;
  /**
   * Current depth-profile anchor (set by "Start depth profile here").
   * Returns null when no anchor has been placed.
   */
  getDepthProfileAnchor: () =>
    | { lon: number; lat: number; depth: number }
    | null;
  /**
   * Current measurement anchor (set by "Measure from here"). Returns
   * null when no anchor has been placed.
   */
  getMeasurementAnchor: () =>
    | { lon: number; lat: number; depth: number }
    | null;
  /** Snapshot of the global right-click context menu (open + item labels). */
  getContextMenuSnapshot: () => {
    open: boolean;
    labels: string[];
    separators: number;
  };
  /**
   * Directly set the tidal overlay state (bypasses the TIDE button click and
   * the autoLoadTidal useEffect, which both depend on settings hydration and
   * are too slow for time-sensitive E2E tests).
   */
  setTidalOverlay: (v: boolean) => void;
  /**
   * Inject tidal data directly into App state, bypassing the useTidalData
   * fetch. The injected data persists until the page is navigated away.
   * Used by E2E tests to assert on TidePanel content without waiting for a
   * real (or mocked) HTTP response.
   */
  feedTidalData: (data: unknown) => void;
  /**
   * Seed the React Query marker-list cache for a dataset so tests can assert
   * on cache invalidation without going through a full GET round-trip.
   */
  seedMarkerCache: (datasetId: string, markers: Marker[]) => void;
  /**
   * Snapshot of the React Query marker-list cache for a dataset (or null if
   * none is set).
   */
  getMarkerCache: (datasetId: string) => Marker[] | null;
  /**
   * Returns the `dataUpdatedAt` of the marker-list query, or 0 if absent.
   * Tests use this to detect invalidation/refetch independent of cache value.
   */
  getMarkerCacheUpdatedAt: (datasetId: string) => number;
  /**
   * Returns whether the marker-list query for the dataset has been
   * invalidated (stale). Tests use this to verify dataset-scoped cache
   * invalidation after delete.
   */
  isMarkerCacheInvalidated: (datasetId: string) => boolean;
  /**
   * Returns the current colormapTheme value from the settings store.
   * Used by water-type-toggle e2e tests to verify auto-switch without
   * navigating to /settings (which would re-hydrate from the server).
   */
  getColormapTheme: () => string;
  /**
   * Write a single band colour into the paletteStore (same store action the
   * Custom band-colour editor calls when the user edits a hex input). This
   * triggers the paletteStore subscription in `useServerSettingsSync` so the
   * 300 ms debounced PUT /api/settings fires with the updated `bandColors`
   * array — identical to a real UI interaction.
   *
   * Use `waitForServerSettingsSync` after calling this to ensure the PUT has
   * completed before making assertions on the server-side row.
   */
  setBandColor: (index: number, hex: string) => void;
  /**
   * Resolves once the 300 ms debounced server sync has flushed and the
   * server has acknowledged the PUT (i.e. `lastSyncedAt` in the settings
   * store moves to a new value).  E2E tests that change settings and then
   * navigate away should await this instead of a fixed `waitForTimeout`, so
   * that the server copy is up-to-date before GET /api/settings re-hydrates
   * state on the next page.
   *
   * Rejects with a descriptive error after 5 s if the stamp never changes
   * (which would mean the debounce never fired or the PUT failed silently).
   */
  waitForServerSettingsSync: () => Promise<void>;
  /**
   * Resolves once the initial GET /api/settings response has been applied
   * (i.e. `_serverSettled = true` in useServerSettingsSync).  Call this
   * after `waitForSidebarTabs` in reload tests to ensure the server hydration
   * has completed before clicking tabs — otherwise the GET can arrive after
   * the click and overwrite the local mode via `hydrateFromServer`.
   *
   * Rejects with a descriptive error after 10 s if the server never settles.
   */
  waitForSettingsReady: () => Promise<void>;
  /**
   * Render a production-shaped marker context menu whose "Delete marker"
   * onClick fires the REAL `deleteMarkersId` request and the REAL
   * `runMarkerDelete` cache-invalidation path (same code as
   * `useFlyControls.buildMarkerMenuItems`). `capturedDatasetId` mirrors what
   * `terrainRef.current?.datasetId` would resolve to at click time.
   */
  showProductionMarkerMenu: (
    x: number,
    y: number,
    marker: Marker,
    capturedDatasetId: string,
  ) => void;
  /**
   * Configure headers that the dev-only production-menu Delete handler
   * forwards to `deleteMarkersId`. In end-to-end tests this is set to the
   * api-server's `E2E_AUTH_BYPASS` header (`x-e2e-user-id`) so the real
   * auth-gated route is exercised without a Clerk session in the browser.
   */
  setRequestHeaders: (headers: Record<string, string>) => void;
  /**
   * Zone classification helpers (paint mode coverage).
   *
   * The browser's WebGL stack in headless CI doesn't reliably support
   * react-three-fiber raycasting, so e2e tests drive the underlying
   * classification store directly instead of simulating a 3D pointer drag
   * on the terrain canvas. The store action invoked here (`paintSlot`) is
   * the same one TerrainMesh.tsx's pointer handlers call, so this faithfully
   * exercises the paint-mode write path.
   */
  /** Returns true when the TestBridge has been fully registered (appSetTerrain is non-null). */
  isTestBridgeReady: () => boolean;
  /**
   * Activate or deactivate the Drift Planner overlay. The production UI
   * opens it by clicking a forecast slot in ForecastStrip, but that requires
   * surface-conditions data and sidebar visibility. E2E tests drive the
   * Zustand store directly to exercise the WeatherPanel and DriftTimeline
   * without depending on the sidebar state.
   */
  setDriftPlannerActive: (v: boolean) => void;
  seedTerrain: (overrides?: Partial<TerrainData>) => boolean;
  /** Snapshot of the React-bound active terrain (datasetId + hasTopography). */
  getTerrainSummary: () =>
    | { datasetId: string | null | undefined; hasTopography: boolean | undefined }
    | null;
  seedZoneMap: (resolution: number, fillZone?: number) => void;
  paintZone: (
    row: number,
    col: number,
    radius: number,
    slot: 0 | 1 | 2 | 3,
    waterType: "saltwater" | "freshwater",
    resolution: number,
  ) => void;
  resetZonesToAi: () => void;
  getZoneSnapshot: () => {
    length: number;
    hasEdits: boolean;
    hash: string;
    sample: number[];
  } | null;
  /**
   * Habitat overlay helpers — drive HabitatPanel's species selector through
   * the same store action it calls, without depending on the headless-WebGL
   * raycaster. The Habitat overlay e2e spec uses this to flip species while
   * a real terrain mesh is mounted and to read back the resulting scores.
   */
  setHabitatSpecies: (id: SpeciesId | null) => void;
  /**
   * Snapshot of the habitat store: which species (if any) is active, how
   * many score cells are non-zero, the peak score, and how many hotspots
   * passed the 75% threshold. Tests assert non-zero values to prove the
   * scoring pipeline ran end-to-end after a species change.
   */
  getHabitatSummary: () => {
    activeSpecies: SpeciesId | null;
    scoreCount: number;
    nonZeroCount: number;
    maxScore: number;
    hotspotCount: number;
  };
  showDepthProfileTerrainMenu: (
    x: number,
    y: number,
    point: { lon: number; lat: number; depth: number },
  ) => void;
  clearDepthProfile: () => void;
  getDepthProfileSummary: () =>
    | { points: number; totalDistanceM: number; minDepthM: number; maxDepthM: number }
    | null;
  /**
   * Trigger the production `resetCamera` callback registered by
   * `useFlyControls`. Used by camera-spawn E2E tests to exercise the spawn
   * logic (center vs. saved-session fallback) without a real WebGL canvas.
   * Returns true when the callback was registered and called, false when
   * `useFlyControls` has not yet mounted (hook not active on this route).
   */
  resetCameraForSpawn: () => boolean;
  /**
   * Read the current THREE camera world-space XZ and convert it to
   * geographic lon/lat using the active terrain grid. Returns null when
   * either the camera or the terrain is not registered.
   * Used by camera-spawn E2E tests to assert post-spawn position without
   * waiting for the `useFrame` → `setCameraGeo` round-trip.
   */
  getCameraGeo: () => { lon: number; lat: number } | null;
  /**
   * Directly write `cameraSpawnBehaviour` into the settings store.
   * E2E tests use this to drive different spawn branches without navigating
   * to /settings.
   */
  setCameraSpawnBehaviour: (
    v: "deepest" | "home" | "last" | "center",
  ) => void;
  /**
   * Write (or clear) `lastSession` in the settings store.
   * E2E tests use this to simulate "first load" (null) or "returning user"
   * (a saved session object).
   */
  setLastSession: (session: LastSession | null) => void;
  /**
   * Scroll-to-zoom helpers. Tests use these to assert that wheel events
   * actually move the camera, that Shift+wheel steps the speed tier, and
   * that the Mouse Wheel Zoom Sensitivity setting scales the dolly.
   */
  getCameraPos: () => [number, number, number];
  getSpeedIndex: () => number;
  setSpeedIndex: (n: number) => void;
  getMouseZoomSensitivity: () => number;
  setMouseZoomSensitivity: (v: number) => void;
  /**
   * Realistic (boat-MPH throttle) mode lives in AppContext, not the settings
   * store, so it has to be reached through the TestBridge component. When ON,
   * `processFlyWheel` short-circuits Shift+wheel (the boat-MPH throttle owns
   * speed) — tests use these to cover that branch.
   */
  getRealisticMode: () => boolean;
  setRealisticMode: (b: boolean) => boolean;
  /**
   * Install a synthetic fly-mode test rig. Creates a THREE.PerspectiveCamera
   * at the given position pointing along `lookAt`, registers it so
   * `getCameraPos` returns its live position, and returns true on success.
   * Used by the scroll-zoom e2e test because the real Canvas can't initialise
   * WebGL in headless Playwright runs.
   */
  initFlyWheelTestRig: (
    pos: [number, number, number],
    lookAt: [number, number, number],
  ) => boolean;
  /**
   * Drive the production `processFlyWheel` logic against the test camera with
   * a synthesised WheelEvent shape. Applies any speed-tier change back to the
   * production cameraStore (the same store fly-mode tier consumers read).
   */
  simulateFlyWheel: (deltaY: number, shiftKey: boolean) => void;
  /**
   * EFH overlay helpers (Task #319).
   *
   * Drive dataset selection and the OverviewMap species detail panel through
   * the same store actions / React state setters the user interacts with so
   * the expanded EFH coverage (5 SE Alaska + 3 Texas reservoirs) can be
   * locked down end-to-end without depending on headless WebGL or on
   * reverse-engineering the OverviewMap's canvas projection to click an
   * exact polygon pixel.
   */
  setActiveDatasetId: (id: string | null) => boolean;
  setWaterType: (wt: "saltwater" | "freshwater") => void;
  /**
   * Toggle the EFH overlay on/off (same uiStore slice the HUD's 🐟 EFH
   * button and OverviewMap's overlay button mutate). Tests must enable this
   * before asserting on EFH rendering because EfhZoneLayer's React Query
   * fetch is gated on `efhOverlayEnabled && hasEfh` and OverviewMap's
   * `renderEfhOverlay` early-returns when the flag is false.
   */
  setEfhOverlayEnabled: (enabled: boolean) => void;
  isEfhOverlayEnabled: () => boolean;
  getEfhFeatureCount: (datasetId: string) => number;
  /**
   * Substrate overlay helpers.
   *
   * Toggle the substrate overlay on/off (same uiStore slice the HUD's
   * SUBSTRATE button and OverviewMap's overlay toggle mutate) and read the
   * number of substrate features currently in the React Query cache for a
   * given datasetId. Tests use these to enable the overlay, then poll for a
   * non-zero feature count — which proves the /substrate/:id fetch fired and
   * returned data — without requiring headless WebGL or pixel assertions.
   */
  setSubstrateOverlayEnabled: (enabled: boolean) => void;
  isSubstrateOverlayEnabled: () => boolean;
  /**
   * Number of substrate features in the React Query cache for the given
   * datasetId, or -1 when the query has not been fetched yet (no cache entry).
   * 0 means the server returned 200 with zero features (isEmpty path).
   */
  getSubstrateFeatureCount: (datasetId: string) => number;
  /**
   * Status snapshot of the /substrate/:id React Query for a given datasetId.
   * Lets E2E tests poll until the query settles and then distinguish the
   * isEmpty path (isError=false, featureCount=0) from the isError path.
   */
  getSubstrateQueryStatus: (datasetId: string) => {
    isFetched: boolean;
    isError: boolean;
    featureCount: number | null;
  };
  /**
   * Number of substrate features currently held in the OverviewMap's
   * substrateFeaturesRef — the array the rAF draw loop reads when painting
   * polygons and the legend to the 2D canvas. Non-zero proves the data
   * actually reached the 2D renderer, not just the React Query cache.
   * Returns -1 when the getter has not been registered yet (OverviewMap
   * not mounted).
   */
  getOverviewMapSubstrateFeatureCount: () => number;
  getEfhFeatureProperties: (
    datasetId: string,
    index: number,
  ) => EfhSpeciesProperties | null;
  openEfhDetailForFeature: (datasetId: string, index: number) => boolean;
  closeEfhDetail: () => void;
  /**
   * Toggle the dev-bypass auth simulation for the TerrainDownloadPopover UI
   * test.  When `true`, `useAuth().isSignedIn` returns `false` so the
   * unauthenticated popover branch (auth-gate warning + disabled download
   * button) can be exercised in E2E specs without a real Clerk session.
   *
   * Always reset to `false` after the assertion so subsequent tests that
   * rely on being signed in are unaffected.
   */
  setSimulateSignedOut: (v: boolean) => void;
  /**
   * Zone-colour isolation helpers.
   *
   * The zoneOverlayStore maintains independent four-slot colour palettes for
   * saltwater and freshwater.  These helpers let e2e tests drive colour
   * mutations and water-type switches without going through the Settings page
   * colour picker (a <input type="color"> whose native OS dialog is
   * unreliable in headless Playwright runs).
   *
   * `getZoneSlotColor` reads the colour directly from the named palette in
   * the store, regardless of which water type is currently active, so tests
   * can assert on both palettes after a switch.
   *
   * `setZoneSlotColor` calls `setSlotColor` on the currently active palette
   * — call `setActiveZoneWaterType` first to target the desired environment.
   *
   * `setActiveZoneWaterType` calls `setActiveWaterType` so the store's
   * convenience `slots` mirror points at the chosen palette.  This mirrors
   * what `ZoneColoursCard` does on mount via its `useEffect([waterType])`.
   *
   * `getZoneDefaultColor` returns the compile-time default hex for a slot so
   * specs can assert "still at default" without hard-coding colour strings.
   */
  getZoneSlotColor: (
    waterType: "saltwater" | "freshwater",
    slot: 0 | 1 | 2 | 3,
  ) => string;
  setZoneSlotColor: (slot: 0 | 1 | 2 | 3, color: string) => void;
  setActiveZoneWaterType: (wt: "saltwater" | "freshwater") => void;
  getZoneDefaultColor: (slot: 0 | 1 | 2 | 3) => string;
  /**
   * RAWS overlay helpers (Task #1070).
   *
   * Enable/disable the RAWS station overlay (same uiStore slice the 🌿 RAWS
   * toggle in OverlaysToolsPanel mutates) and directly open the RAWS popover
   * for a known datasetId without requiring a canvas hit-test. The overview
   * map must be open so the canvas is mounted when calling
   * `openRawsPopupForStation`.
   */
  setRawsOverlayActive: (active: boolean) => void;
  isRawsOverlayActive: () => boolean;
  openRawsPopupForStation: (datasetId: string) => boolean;
  closeRawsPopup: () => void;
  /**
   * Returns the current canvas-space positions of all rendered RAWS station
   * pins. Populated by the OverviewMap rAF loop after the RAWS overlay is
   * enabled and stations have been drawn. Tests can read the (cx, cy) for a
   * given datasetId and dispatch a real click event on the canvas element at
   * those coordinates to exercise the full pin hit-test path.
   */
  getRawsCanvasPositions: () => Array<{
    datasetId: string;
    cx: number;
    cy: number;
  }>;
  /**
   * Inject one or more entries into the terrainStore visibleDatasets array so
   * focus-trap / remove-dialog e2e tests can open the RemoveDatasetConfirmDialog
   * without needing a real authenticated terrain fetch. The injected entries
   * have null grids (no 3D rendering) — sufficient for the UI row to render.
   */
  setVisibleDatasets: (
    items: Array<{ datasetId: string; name: string; source: "preset" | "user" }>,
  ) => void;

  // ── What's Here card ────────────────────────────────────────────────────
  /** Open or close the "What's Here?" summary card. */
  setWhatsHereOpen: (v: boolean) => void;
  /** Returns true when the "What's Here?" card is currently visible. */
  isWhatsHereOpen: () => boolean;
  /** Pin or unpin the "What's Here?" card (prevents auto-close and camera-move close). */
  setWhatsHerePinned: (v: boolean) => void;
  /** Returns true when the "What's Here?" card is currently pinned. */
  isWhatsHerePinned: () => boolean;
  /**
   * Enable or disable the substrate colour overlay (same store action the
   * Substrate toggle in OverlaysToolsPanel calls). Used by e2e tests to
   * verify that the substrate row disappears from the What's Here card
   * when the overlay is toggled OFF mid-session.
   */
  setSubstrateColorMode: (v: boolean) => void;
  /**
   * Advance the camera geo position in the cameraStore.  Mirrors
   * setCameraGeo() — the same action the real fly-controls write each frame.
   * Used by e2e tests to simulate camera movement (e.g. to confirm a pinned
   * What's Here card stays open after the camera moves).
   */
  moveCameraGeo: (geo: {
    lon: number;
    lat: number;
    depth: number;
    heading: number;
    altitude: number;
  }) => void;

  /**
   * Adaptive palette suggestion helpers — let e2e specs drive the
   * usePaletteSuggestionStore without needing real terrain to load.
   *
   * `setPaletteSuggestion` injects a suggestion (theme + bandBoundaries) for a
   * given datasetId so PaletteSuggestionBanner renders it immediately.
   * `clearPaletteSuggestion` removes the active suggestion (same as the hook
   * calling clear() after auto-apply).
   * `isPaletteSuggestionDismissed` queries whether a datasetId has been
   * dismissed this session — used to assert the dismiss-stays-hidden invariant.
   * `setColormapUserSet` / `getColormapUserSet` expose the colormapUserSet flag
   * so tests can toggle the auto-apply gate without going through the Settings UI.
   * `setColormapThemeByUser` calls the same action used by the Settings UI
   * (sets both colormapTheme and colormapUserSet=true) so the no-overwrite
   * scenario can be set up without navigating to the settings page.
   */
  setPaletteSuggestion: (
    suggestion: { theme: string; bandBoundaries: number[]; reason?: "freshwater" | "depth" },
    datasetId: string,
  ) => void;
  clearPaletteSuggestion: () => void;
  isPaletteSuggestionDismissed: (datasetId: string) => boolean;
  setColormapUserSet: (v: boolean) => void;
  getColormapUserSet: () => boolean;
  setColormapThemeByUser: (theme: string) => void;
  /** Current terrainExaggeration value from the settings store. */
  getTerrainExaggeration: () => number;
  /** Current contourInterval (in user units) from the settings store. */
  getContourInterval: () => number;
  /** Whether depth contours are enabled in the settings store. */
  getContoursEnabled: () => boolean;
  /** Current units system from the settings store. */
  getUnits: () => "metric" | "imperial" | "nautical";
  /**
   * datasetId of the pending shallow-dataset suggestion (banner visible),
   * or null when no suggestion is pending.
   */
  getShallowSuggestionDatasetId: () => string | null;

  /**
   * Simulated-terrain rainbow treatment — per-dataset map of whether the
   * mounted TerrainMesh has activated the rainbow "SIMULATED" treatment.
   * Key = datasetId, value = true only when the grid is synthetic.
   */
  getSimulatedTreatment: () => Record<string, boolean>;
  /**
   * Inject a synthetic entry into the React Query datasets-catalog cache for
   * the given waterType.  Useful in E2E tests for datasets that have been
   * removed from PRESET_DATASETS (so they won't appear in /api/datasets) but
   * whose EFH data is still served by the API.  Merges into the existing
   * cache array (replaces any entry with the same id, appends otherwise) so
   * other catalog entries remain intact.
   */
  seedCatalogEntry: (entry: {
    id: string;
    name?: string;
    hasEfh?: boolean;
    waterType?: "saltwater" | "freshwater";
  }) => void;
  /**
   * Snapshot of the upscale cache (IndexedDB entries + in-memory entries).
   * E2E tests use this to verify that a Poe upscale result was cached and
   * that the cache size stays within expected bounds during long sessions.
   */
  getUpscaleCacheInfo: () => Promise<{
    idb: { count: number; bytes: number };
    mem: { count: number; bytes: number };
  }>;

  /**
   * Inspect the active terrain grid for null-depth cells and verify that their
   * geometry vertices sit at Y = 0 (flat at the water surface) rather than
   * producing depth spikes.
   *
   * Returns null when no active grid is loaded.
   *
   * Used by the null-cell-terrain E2E regression test.
   */
  getActiveTerrainNullCellStats: () => {
    totalCells: number;
    nullCells: number;
    /** true iff every null-depth cell has its geometry Y-position at 0 (±0.001). */
    allNullAtZero: boolean;
  } | null;
}

declare global {
  interface Window {
    __bathyTest?: BathyTestApi;
  }
}

export function installTestHelpers(): void {
  // Hard runtime guards — see file header for the full defense-in-depth
  // story. Both checks are deliberately redundant with the call-site gate
  // in main.tsx so that even if someone re-introduces an unconditional
  // call, this back door cannot ship.
  if (import.meta.env.PROD) {
    throw new Error(
      "[bathyscan] installTestHelpers() must never run in a production build. " +
        "window.__bathyTest exposes forge-auth-headers helpers and is e2e-only.",
    );
  }
  if (!import.meta.env.DEV) return;
  if (import.meta.env.VITE_DEV_AUTH_BYPASS !== "1") return;
  if (typeof window === "undefined") return;

  const buildDepthProfileTerrainMenuItems = (
    lon: number,
    lat: number,
    depth: number,
  ): ContextMenuItem[] => {
    const profileAnchor = useDepthProfileStore.getState().anchor;
    const items: ContextMenuItem[] = [
      {
        label: profileAnchor
          ? "End depth profile here"
          : "Start depth profile here",
        icon: "📈",
        onClick: () => {
          const store = useDepthProfileStore.getState();
          if (store.anchor) {
            const grid = syntheticTestGrid();
            const result = buildProfile(
              grid,
              store.anchor,
              { lon, lat, depth },
              null,
            );
            store.pushProfile(result);
          } else {
            store.setAnchor({ lon, lat, depth });
          }
        },
      },
    ];
    if (profileAnchor) {
      items.push({
        label: "Cancel depth profile",
        icon: "✖",
        onClick: () => useDepthProfileStore.getState().clearAnchor(),
      });
    }
    return items;
  };

  const buildTerrainMenuItems = (
    lon: number,
    lat: number,
    depth: number,
  ): ContextMenuItem[] => {
    const anchor = useMeasureStore.getState().anchorGps;
    return [
      {
        label: "Drop GPS pin here",
        icon: "📍",
        onClick: () => {
          useCameraStore.getState().setLastClickedGps({ lon, lat, depth });
          useUiStore.getState().setMarkerFormOpen(true);
        },
      },
      {
        label: anchor ? "Measure to here" : "Measure from here",
        icon: "📏",
        onClick: () => {
          const ms = useMeasureStore.getState();
          if (ms.anchorGps) {
            const distanceKm = haversineDistance(
              { lon: ms.anchorGps.lon, lat: ms.anchorGps.lat },
              { lon, lat },
            );
            ms.setResult(distanceKm, depth - ms.anchorGps.depth);
          } else {
            ms.setAnchor({ lon, lat, depth });
          }
        },
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: "Copy coordinates",
        icon: "📋",
        onClick: () => {
          /* no-op in tests */
        },
      },
    ];
  };

  let requestHeaders: Record<string, string> = {};

  // Track dataset IDs whose marker-list query has been invalidated at least
  // once since installTestHelpers() ran (i.e. since the current page load).
  // We persist this in a Set rather than relying solely on
  // `getQueryState().isInvalidated` because TanStack Query v5 resets that
  // flag to `false` as soon as a refetch triggered by the invalidation
  // completes — which can happen in < 500 ms when there is an active
  // observer.  If the poll interval in the test is slower than the refetch,
  // `isInvalidated` would already be `false` by the time the poll reads it,
  // causing a spurious 15-second timeout.
  const _invalidatedMarkerDatasets = new Set<string>();

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const { query } = event;
    if (!query.state.isInvalidated) return;
    const key = query.queryKey as unknown[];
    if (
      Array.isArray(key) &&
      key[0] === "/api/markers" &&
      key.length > 1 &&
      key[1] !== null &&
      typeof key[1] === "object"
    ) {
      const params = key[1] as Record<string, unknown>;
      const datasetId = params["datasetId"];
      if (typeof datasetId === "string" && datasetId) {
        _invalidatedMarkerDatasets.add(datasetId);
      }
    }
  });

  const buildProductionMarkerMenuItems = (
    marker: Marker,
    capturedDatasetId: string,
  ): ContextMenuItem[] => [
    { label: "Fly to marker", icon: "✈️", onClick: () => {} },
    {
      label: "View details",
      icon: "ℹ️",
      onClick: () => useMarkerDetailStore.getState().show(marker),
    },
    {
      label: "Edit marker",
      icon: "✏️",
      onClick: () => useMarkerEditStore.getState().open(marker),
    },
    { label: "Copy coordinates", icon: "📋", onClick: () => {} },
    { label: "", onClick: () => {}, separator: true },
    {
      label: "Delete marker",
      icon: "🗑️",
      onClick: () => {
        // Mirror useFlyControls.buildMarkerMenuItems: real DELETE +
        // dataset-scoped query-cache invalidation through the same
        // runMarkerDelete helper that production code uses.
        runMarkerDelete({
          marker,
          datasetId: capturedDatasetId,
          queryClient,
          mutation: {
            mutate: ((vars: { id: string }, opts?: {
              onSuccess?: (...args: unknown[]) => void;
              onError?: (...args: unknown[]) => void;
            }) => {
              void deleteMarkersId(vars.id, { headers: requestHeaders })
                .then((res) => opts?.onSuccess?.(res, vars, {}, {}))
                .catch((err) => opts?.onError?.(err, vars, {}, {}));
            }) as unknown as DeleteMarkerMutation["mutate"],
          },
        });
      },
    },
  ];

  window.__bathyTest = {
    showContextMenu: (x, y, items) =>
      useContextMenuStore.getState().show(x, y, items),
    hideContextMenu: () => useContextMenuStore.getState().hide(),
    setDriftPlannerActive: (v) =>
      useDriftStore.getState().setDriftPlannerActive(v),
    seedMarkerCache: (datasetId, markers) => {
      queryClient.setQueryData(getGetMarkersQueryKey({ datasetId }), markers);
    },
    getMarkerCache: (datasetId) =>
      queryClient.getQueryData<Marker[]>(
        getGetMarkersQueryKey({ datasetId }),
      ) ?? null,
    getMarkerCacheUpdatedAt: (datasetId) =>
      queryClient.getQueryState(getGetMarkersQueryKey({ datasetId }))
        ?.dataUpdatedAt ?? 0,
    isMarkerCacheInvalidated: (datasetId) =>
      _invalidatedMarkerDatasets.has(datasetId) ||
      (queryClient.getQueryState(getGetMarkersQueryKey({ datasetId }))
        ?.isInvalidated ?? false),
    getColormapTheme: () => useSettingsStore.getState().colormapTheme,
    setBandColor: (index, hex) => usePaletteStore.getState().setBandColor(index, hex),
    setPaletteSuggestion: (suggestion, datasetId) =>
      usePaletteSuggestionStore.getState().setSuggestion(
        {
          theme: suggestion.theme as import("./settingsStore").ColormapTheme,
          bandBoundaries: suggestion.bandBoundaries,
          reason: suggestion.reason ?? "depth",
        },
        datasetId,
      ),
    clearPaletteSuggestion: () => usePaletteSuggestionStore.getState().clear(),
    isPaletteSuggestionDismissed: (datasetId) =>
      usePaletteSuggestionStore.getState().isDismissed(datasetId),
    getSimulatedTreatment: () => getSimulatedTreatmentMap(),
    seedCatalogEntry: (entry) => {
      const wt: "saltwater" | "freshwater" = entry.waterType ?? "saltwater";
      const key = getGetDatasetsQueryKey({ waterType: wt });
      const current =
        queryClient.getQueryData<DatasetMeta[]>(key) ?? [];
      const without = current.filter((d) => d.id !== entry.id);
      const synthetic: DatasetMeta = {
        id: entry.id,
        name: entry.name ?? entry.id,
        description: "",
        waterType: wt,
        hasEfh: entry.hasEfh ?? false,
        minDepth: 0,
        maxDepth: 20,
        centerLon: 0,
        centerLat: 0,
        bbox: { minLon: -1, minLat: -1, maxLon: 1, maxLat: 1 },
      };
      queryClient.setQueryData(key, [...without, synthetic]);
    },
    getUpscaleCacheInfo: async () => {
      const idb = await getUpscaleCacheInfo();
      const mem = getInMemCacheStats();
      return { idb, mem };
    },
    setColormapUserSet: (v) => useSettingsStore.getState().setColormapUserSet(v),
    getColormapUserSet: () => useSettingsStore.getState().colormapUserSet,
    setColormapThemeByUser: (theme) =>
      useSettingsStore.getState().setColormapThemeByUser(
        theme as import("./settingsStore").ColormapTheme,
      ),
    waitForServerSettingsSync: () => {
      return new Promise<void>((resolve, reject) => {
        // Fast path: if nothing is pending/in-flight AND every local edit has
        // been acknowledged by the server, the server is already up-to-date
        // (either no mutation happened, or a prior sync already completed).
        // The hasUnackedSettingsEdits() guard is load-bearing: a fast PUT
        // failure (e.g. a rate-limit 429) clears _flushInFlight before this
        // helper runs, so "nothing in flight" alone would wrongly report a
        // FAILED flush as "already synced" and callers would read a stale
        // server value.
        if (!hasPendingOrInFlightSettingsSync() && !hasUnackedSettingsEdits()) {
          resolve();
          return;
        }
        // Slow path: a sync is outstanding (debounce armed, PUT in flight, or
        // a failed flush awaiting retry). Poll until lastSyncedAt changes —
        // the authoritative signal that markAllSaved() fired after the server
        // acknowledged the PUT — AND all edits are acked.
        //
        // Deadline note: flush() itself waits up to 10 s for _serverSettled
        // before sending its PUT, so this helper's deadline must exceed that
        // or a legitimate slow flush outlives the helper and its PUT lands
        // AFTER the test (or its retry) has moved on — clobbering state the
        // retry just reset.
        const before = useSettingsStore.getState().lastSyncedAt;
        const deadline = Date.now() + 15_000;
        const poll = () => {
          const current = useSettingsStore.getState().lastSyncedAt;
          // lastSyncedAt also changes when the initial GET hydration applies
          // the server row (hydrateFromServer stamps it with __updatedAt).
          // That change alone does NOT mean the pending PUT completed — so
          // only resolve once the timestamp moved AND nothing is still
          // debounced or in flight AND no unacked (or failed-flush) edits
          // remain. Otherwise a hydration landing during the debounce window
          // resolves this promise early, the caller reloads the page, and the
          // pending PUT is aborted by navigation.
          if (
            current !== before &&
            !hasPendingOrInFlightSettingsSync() &&
            !hasUnackedSettingsEdits()
          ) {
            resolve();
            return;
          }
          if (Date.now() >= deadline) {
            reject(
              new Error(
                "waitForServerSettingsSync: timed out after 15 s — " +
                  "server did not acknowledge the settings write. " +
                  "The debounce may not have fired or the PUT /api/settings failed.",
              ),
            );
            return;
          }
          setTimeout(poll, 50);
        };
        setTimeout(poll, 50);
      });
    },
    waitForSettingsReady: () => {
      return new Promise<void>((resolve, reject) => {
        if (isServerSettled()) {
          resolve();
          return;
        }
        const deadline = Date.now() + 10_000;
        const poll = () => {
          if (isServerSettled()) {
            resolve();
            return;
          }
          if (Date.now() >= deadline) {
            reject(
              new Error(
                "waitForSettingsReady: timed out after 10 s — " +
                  "_serverSettled never became true. " +
                  "The GET /api/settings may have failed or not fired.",
              ),
            );
            return;
          }
          setTimeout(poll, 50);
        };
        setTimeout(poll, 50);
      });
    },
    showProductionMarkerMenu: (x, y, marker, capturedDatasetId) =>
      useContextMenuStore
        .getState()
        .show(x, y, buildProductionMarkerMenuItems(marker, capturedDatasetId)),
    setRequestHeaders: (headers) => {
      requestHeaders = { ...headers };
    },
    showTerrainMenu: (x, y, point) =>
      useContextMenuStore
        .getState()
        .show(x, y, buildTerrainMenuItems(point.lon, point.lat, point.depth)),
    measureAnchor: (point) => useMeasureStore.getState().setAnchor(point),
    measureTo: (point) => {
      const ms = useMeasureStore.getState();
      if (!ms.anchorGps) {
        ms.setAnchor(point);
        return;
      }
      const distanceKm = haversineDistance(
        { lon: ms.anchorGps.lon, lat: ms.anchorGps.lat },
        { lon: point.lon, lat: point.lat },
      );
      ms.setResult(distanceKm, point.depth - ms.anchorGps.depth);
    },
    clearMeasurement: () => {
      useMeasureStore.getState().clearAnchor();
      useMeasureStore.getState().clearResult();
    },
    showMarkerDetail: (marker) =>
      useMarkerDetailStore.getState().show(marker as never),
    hideMarkerDetail: () => useMarkerDetailStore.getState().hide(),
    getMeasurementResult: () => {
      const r = useMeasureStore.getState().result;
      return r ? { distanceKm: r.distanceKm, depthDeltaM: r.depthDeltaM } : null;
    },
    setOverviewOpen: (open) => useUiStore.getState().setOverviewOpen(open),
    isOverviewOpen: () => useUiStore.getState().overviewOpen,
    getPendingDropIn: () => useUiStore.getState().pendingDropIn,
    clearPendingDropIn: () => useUiStore.getState().clearPendingDropIn(),
    isMarkerFormOpen: () => useUiStore.getState().markerFormOpen,
    setMarkerFormOpen: (open) => useUiStore.getState().setMarkerFormOpen(open),
    getLastClickedGps: () => useCameraStore.getState().lastClickedGps,
    clearLastClickedGps: () => useCameraStore.getState().setLastClickedGps(null),
    setCrosshairGps: (gps) => useCameraStore.getState().setCrosshairGps(gps),
    getDatasetHome: (datasetId) =>
      useSettingsStore.getState().datasetHomePositions[datasetId],
    getDepthProfileAnchor: () => useDepthProfileStore.getState().anchor,
    getMeasurementAnchor: () => useMeasureStore.getState().anchorGps,
    pressCrosshairShortcut: () => {
      // Mirror the Q-key handler in useFlyControls: anchor at the centre
      // of the browser viewport (where the crosshair reticle sits), pass
      // the same test-bridged terrain ref the real hook would have, and
      // delegate to the production helper.
      const w = typeof window !== "undefined" ? window.innerWidth : 0;
      const h = typeof window !== "undefined" ? window.innerHeight : 0;
      return openCrosshairContextMenu({
        centerX: w / 2,
        centerY: h / 2,
        getTerrainGrid: () => appGetTerrainRef.current,
      });
    },
    getContextMenuSnapshot: () => {
      const s = useContextMenuStore.getState();
      return {
        open: s.open,
        labels: s.items.filter((i) => !i.separator).map((i) => i.label),
        separators: s.items.filter((i) => i.separator).length,
      };
    },
    isTestBridgeReady: () => !!appSetTerrain,
    setTidalOverlay: (v) => {
      if (appSetTidalOverlay) appSetTidalOverlay(v);
    },
    feedTidalData: (data) => {
      if (appFeedTidalData) appFeedTidalData(data);
    },
    seedTerrain: (overrides) => {
      if (!appSetTerrain) return false;
      const resolution = overrides?.resolution ?? 64;
      const N = resolution * resolution;
      const depths = overrides?.depths ?? new Array(N).fill(10);
      const base: TerrainData = {
        datasetId: "e2e-test",
        name: "E2E Test Dataset",
        waterType: "saltwater",
        resolution,
        width: resolution,
        height: resolution,
        depths: depths as number[],
        minDepth: 0,
        maxDepth: 20,
        minLon: -1,
        maxLon: 1,
        minLat: -1,
        maxLat: 1,
        centerLon: 0,
        centerLat: 0,
        ...overrides,
      };
      // Pre-seed the React Query cache for the same datasetId so that
      // TourScene's `useGetDatasetsIdTerrain(datasetId)` query (which calls
      // setTerrain(data) on settle) hands back OUR seeded terrain instead of
      // re-fetching from the API and overwriting our seed.
      if (base.datasetId) {
        queryClient.setQueryData(
          getGetDatasetsIdTerrainQueryKey(base.datasetId),
          base,
        );
      }
      appSetTerrain(base);
      if (appSetDatasetId) appSetDatasetId(base.datasetId);
      // Also seed the terrain store's overviewGrid so components that read
      // from terrainStore (OverviewMap, minimap) see terrain immediately.
      // Seed BOTH grids: overviewGrid for minimap/LivePanel depth reads, and
      // activeGrid so visibleDatasets[0].activeGrid is populated — the GPS
      // follow out-of-bounds check only consults entries with an activeGrid.
      useTerrainStore.getState().setGrids({ activeGrid: base, overviewGrid: base });
      return true;
    },
    getTerrainSummary: () => {
      const t = appGetTerrainRef.current;
      if (!t) return null;
      return {
        datasetId: t.datasetId,
        hasTopography: (t as unknown as { hasTopography?: boolean }).hasTopography,
      };
    },
    seedZoneMap: (resolution, fillZone = 0) => {
      const N = resolution * resolution;
      const zoneMap = new Uint8Array(N);
      if (fillZone !== 0) zoneMap.fill(fillZone);
      useClassificationStore.setState({
        zoneMap,
        aiZoneMap: new Uint8Array(zoneMap),
        hasEdits: false,
        loading: false,
        error: null,
        currentGridHash: "e2etest0",
      });
    },
    paintZone: (row, col, radius, slot, waterType, resolution) => {
      useClassificationStore
        .getState()
        .paintSlot(row, col, radius, slot, waterType, resolution);
    },
    resetZonesToAi: () => {
      useClassificationStore.getState().resetToAi();
    },
    getZoneSnapshot: () => {
      const s = useClassificationStore.getState();
      const zm = s.zoneMap;
      if (!zm) return null;
      let h = 0x811c9dc5;
      for (let i = 0; i < zm.length; i++) {
        h ^= zm[i] ?? 0;
        h = (Math.imul(h, 0x01000193) >>> 0);
      }
      const hash = (h >>> 0).toString(16).padStart(8, "0");
      const sample: number[] = [];
      const step = Math.max(1, Math.floor(zm.length / 16));
      for (let i = 0; i < zm.length; i += step) sample.push(zm[i] ?? 0);
      return { length: zm.length, hasEdits: s.hasEdits, hash, sample };
    },
    resetCameraForSpawn: () => {
      // Prefer the production callback registered by useFlyControls (live
      // Canvas). In headless e2e runs the WebGL Canvas never mounts, so fall
      // back to running the same production spawn logic (applyCameraSpawn)
      // against the fly-wheel rig camera and the React-bound terrain.
      if (callRegisteredResetCamera()) return true;
      const cam = threeCameraRef as THREE.PerspectiveCamera | null;
      const terrain = appGetTerrainRef.current;
      if (!cam || !terrain) return false;
      const euler = new THREE.Euler(0, 0, 0, "YXZ");
      applyCameraSpawn(cam, euler, terrain, useSettingsStore.getState());
      return true;
    },
    getCameraGeo: () => {
      const cam = threeCameraRef;
      const terrain = appGetTerrainRef.current;
      if (!cam || !terrain) return null;
      return worldXZToLonLat(cam.position.x, cam.position.z, terrain);
    },
    setCameraSpawnBehaviour: (v) =>
      useSettingsStore.getState().setCameraSpawnBehaviour(v),
    setLastSession: (session) =>
      useSettingsStore.getState().setLastSession(session),
    getCameraPos: () => {
      // Prefer the live THREE camera (mutated synchronously by the wheel
      // handler) so tests don't have to wait for the useFrame → setCameraPos
      // round-trip. Fall back to the AppContext-synced value when the
      // Canvas isn't mounted (e.g. signed-out page).
      if (threeCameraRef) {
        const p = threeCameraRef.position;
        return [p.x, p.y, p.z];
      }
      return [
        cameraPosRef.current[0],
        cameraPosRef.current[1],
        cameraPosRef.current[2],
      ];
    },
    getSpeedIndex: () => useCameraStore.getState().speedIndex,
    setSpeedIndex: (n) => useCameraStore.getState().setSpeedIndex(n),
    getMouseZoomSensitivity: () => useSettingsStore.getState().mouseZoomSensitivity,
    setMouseZoomSensitivity: (v) =>
      useSettingsStore.getState().setMouseZoomSensitivity(v),
    getRealisticMode: () => appRealisticModeRef.current,
    setRealisticMode: (b) => {
      if (!appSetRealisticMode) return false;
      appSetRealisticMode(b);
      return true;
    },
    initFlyWheelTestRig: (pos, lookAt) => {
      const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
      cam.position.set(pos[0], pos[1], pos[2]);
      cam.lookAt(lookAt[0], lookAt[1], lookAt[2]);
      cam.updateMatrixWorld();
      registerTestThreeCamera(cam);
      return true;
    },
    simulateFlyWheel: (deltaY, shiftKey) => {
      const cam = threeCameraRef as THREE.Camera | null;
      if (!cam) return;
      const settings = useSettingsStore.getState();
      const camStore = useCameraStore.getState();
      const result = processFlyWheel(
        cam,
        { deltaY, deltaMode: 0, shiftKey },
        camStore.speedIndex,
        {
          mouseZoomSensitivity: settings.mouseZoomSensitivity,
          touchpadZoomSensitivity: settings.touchpadZoomSensitivity,
          // realisticMode lives in AppContext (not the settings store) and is
          // mirrored into appRealisticModeRef by <TestBridge/>. When ON, the
          // boat-MPH throttle owns speed and processFlyWheel short-circuits
          // Shift+wheel — the realistic-mode e2e case relies on this wiring.
          realisticMode: appRealisticModeRef.current,
        },
      );
      if (result.newSpeedIndex !== null) {
        camStore.setSpeedIndex(result.newSpeedIndex);
      }
    },
    setHabitatSpecies: (id) => {
      const terrain = appGetTerrainRef.current;
      const zoneMap = useClassificationStore.getState().zoneMap;
      if (id === null) {
        useHabitatStore.getState().setSpecies(null);
        return;
      }
      useHabitatStore.getState().setSpecies(id, terrain ?? undefined, zoneMap);
    },
    getHabitatSummary: () => {
      const s = useHabitatStore.getState();
      if (s.scores.status !== "done") {
        return {
          activeSpecies: s.activeSpecies,
          scoreCount: 0,
          nonZeroCount: 0,
          maxScore: 0,
          hotspotCount: s.hotspots.length,
        };
      }
      let nz = 0;
      let max = 0;
      for (let i = 0; i < s.scores.data.length; i++) {
        const v = s.scores.data[i] ?? 0;
        if (v > 0) nz++;
        if (v > max) max = v;
      }
      return {
        activeSpecies: s.activeSpecies,
        scoreCount: s.scores.data.length,
        nonZeroCount: nz,
        maxScore: max,
        hotspotCount: s.hotspots.length,
      };
    },
    setActiveDatasetId: (id) => {
      if (!appSetDatasetId) return false;
      appSetDatasetId(id);
      return true;
    },
    setWaterType: (wt) => useSettingsStore.getState().setWaterType(wt),
    setSubstrateOverlayEnabled: (enabled) =>
      useUiStore.getState().setSubstrateColorMode(enabled),
    isSubstrateOverlayEnabled: () => useUiStore.getState().substrateColorMode,
    getSubstrateFeatureCount: (datasetId) => {
      if (!datasetId) return -1;
      const state = queryClient.getQueryState<SubstrateFeatureCollection>(
        getGetSubstrateQueryKey(datasetId),
      );
      if (!state || state.status === "pending") return -1;
      return state.data?.features?.length ?? 0;
    },
    getSubstrateQueryStatus: (datasetId) => {
      const key = getGetSubstrateQueryKey(datasetId);
      const state = queryClient.getQueryState<SubstrateFeatureCollection>(key);
      if (!state || state.status === "pending") {
        return { isFetched: false, isError: false, featureCount: null };
      }
      return {
        isFetched: true,
        isError: state.status === "error",
        featureCount:
          state.status === "success"
            ? (state.data?.features?.length ?? 0)
            : null,
      };
    },
    getOverviewMapSubstrateFeatureCount: () =>
      _substrateFeatureGetter ? _substrateFeatureGetter() : -1,
    setEfhOverlayEnabled: (enabled) =>
      useUiStore.getState().setEfhOverlayEnabled(enabled),
    isEfhOverlayEnabled: () => useUiStore.getState().efhOverlayEnabled,
    getEfhFeatureCount: (datasetId) => {
      if (!datasetId) return 0;
      const data = queryClient.getQueryData<EfhFeatureCollection>(
        getGetEfhQueryKey({ datasetId }),
      );
      return data?.features?.length ?? 0;
    },
    getEfhFeatureProperties: (datasetId, index) => {
      if (!datasetId) return null;
      const data = queryClient.getQueryData<EfhFeatureCollection>(
        getGetEfhQueryKey({ datasetId }),
      );
      return data?.features?.[index]?.properties ?? null;
    },
    openEfhDetailForFeature: (datasetId, index) => {
      const data = queryClient.getQueryData<EfhFeatureCollection>(
        getGetEfhQueryKey({ datasetId }),
      );
      const props = data?.features?.[index]?.properties;
      if (!props) return false;
      useUiStore.getState().setSelectedEfh(props);
      return true;
    },
    closeEfhDetail: () => {
      useUiStore.getState().setSelectedEfh(null);
    },
    setSimulateSignedOut: (v) => {
      setBypassSimulateSignedOut(v);
    },
    getZoneSlotColor: (waterType, slot) => {
      const state = useZoneOverlayStore.getState();
      return state[waterType][slot]?.color ?? ZONE_DEFAULT_COLORS[slot];
    },
    setZoneSlotColor: (slot, color) => {
      useZoneOverlayStore.getState().setSlotColor(slot, color);
    },
    setActiveZoneWaterType: (wt) => {
      useZoneOverlayStore.getState().setActiveWaterType(wt);
    },
    getZoneDefaultColor: (slot) => ZONE_DEFAULT_COLORS[slot],
    setRawsOverlayActive: (active) =>
      useUiStore.getState().setRawsOverlayActive(active),
    isRawsOverlayActive: () => useUiStore.getState().rawsOverlayActive,
    openRawsPopupForStation: (datasetId) => {
      if (!_rawsPopupSetId || !_rawsPopupSetPos) return false;
      _rawsPopupSetId(datasetId);
      _rawsPopupSetPos({ cx: 120, cy: 120 });
      return true;
    },
    closeRawsPopup: () => {
      _rawsPopupSetId?.(null);
      _rawsPopupSetPos?.(null);
    },
    getRawsCanvasPositions: () =>
      _rawsCanvasPositionGetter ? _rawsCanvasPositionGetter() : [],
    showDepthProfileTerrainMenu: (x, y, point) =>
      useContextMenuStore
        .getState()
        .show(
          x,
          y,
          buildDepthProfileTerrainMenuItems(point.lon, point.lat, point.depth),
        ),
    clearDepthProfile: () => {
      useDepthProfileStore.getState().clearAnchor();
      useDepthProfileStore.getState().clearProfile();
    },
    getDepthProfileSummary: () => {
      const p = useDepthProfileStore.getState().profile;
      return p
        ? {
            points: p.points.length,
            totalDistanceM: p.totalDistanceM,
            minDepthM: p.minDepthM,
            maxDepthM: p.maxDepthM,
          }
        : null;
    },
    setVisibleDatasets: (items) => {
      useTerrainStore.setState({
        visibleDatasets: items.map((item) => ({
          datasetId: item.datasetId,
          source: item.source,
          activeGrid: null,
          overviewGrid: null,
        })),
      });
    },

    // ── What's Here card ──────────────────────────────────────────────────
    setWhatsHereOpen: (v) => useUiStore.getState().setWhatsHereOpen(v),
    isWhatsHereOpen: () => useUiStore.getState().whatsHereOpen,
    setWhatsHerePinned: (v) => useUiStore.getState().setWhatsHerePinned(v),
    isWhatsHerePinned: () => useUiStore.getState().whatsHerePinned,
    setSubstrateColorMode: (v) => useUiStore.getState().setSubstrateColorMode(v),
    getTerrainExaggeration: () => useSettingsStore.getState().terrainExaggeration,
    getContourInterval: () => useSettingsStore.getState().contourInterval,
    getContoursEnabled: () => useSettingsStore.getState().contoursEnabled,
    getUnits: () => useSettingsStore.getState().units,
    getShallowSuggestionDatasetId: () =>
      useShallowSuggestionStore.getState().suggestionDatasetId,
    moveCameraGeo: (geo) =>
      useCameraStore.getState().setCameraGeo({
        lon: geo.lon,
        lat: geo.lat,
        depth: geo.depth,
        heading: geo.heading,
        altitude: geo.altitude,
      }),

    getActiveTerrainNullCellStats: () => {
      const { visibleDatasets, primaryDatasetId } = useTerrainStore.getState();
      const entry =
        visibleDatasets.find((d) => d.datasetId === primaryDatasetId) ??
        visibleDatasets[0];
      const grid = entry?.activeGrid;
      if (!grid) return null;

      const depths = grid.depths;
      const totalCells = depths.length;
      const nullIndices: number[] = [];
      for (let i = 0; i < depths.length; i++) {
        const d = depths[i];
        if (d === null || d === undefined || Number.isNaN(d as number)) {
          nullIndices.push(i);
        }
      }
      const nullCells = nullIndices.length;
      if (nullCells === 0) {
        return { totalCells, nullCells, allNullAtZero: true };
      }

      // Build the geometry (CPU-only, no WebGL needed) and check Y values.
      // buildTerrainGeometry places vertex i at positions[i*3+1]=0 for null
      // depths (see terrain.ts:44 "positions[i * 3 + 1] = 0").
      const geometry = buildTerrainGeometry(grid);
      const posAttr = geometry.getAttribute("position");
      let allNullAtZero = true;
      for (const idx of nullIndices) {
        const y = posAttr?.getY(idx) ?? 0;
        if (Math.abs(y) > 0.001) {
          allNullAtZero = false;
          break;
        }
      }
      geometry.dispose();
      return { totalCells, nullCells, allNullAtZero };
    },
  };
}
