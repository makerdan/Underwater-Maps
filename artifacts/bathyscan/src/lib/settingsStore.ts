/**
 * settingsStore — persisted user preferences for BathyScan.
 *
 * Persisted to localStorage under the key "bathyscan:settings".
 * All settings are optional and fall back to sensible defaults.
 * On sign-in, GET /api/settings hydrates this store from the server.
 * On change, a 300 ms debounced PUT /api/settings persists to the server.
 *
 * Settings are grouped into named "sections" so the UI can offer
 * per-section reset and so future migrations have a stable namespace.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONVENTION: WHERE DOES NEW STATE LIVE?
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PERSISTENT STATE → settingsStore (this file)
 *   Any toggle, mode, overlay, or user-facing preference that should survive a
 *   page reload or sign-in from a different device MUST be added here:
 *     1. Add a typed field to `SettingsState`.
 *     2. Add a default value to `DEFAULT_SETTINGS`.
 *     3. Add a setter to `SettingsActions` and implement it in the `create()`
 *        factory below. The `satisfies SettingsStore` guard at the end of the
 *        factory will produce a TypeScript error if you forget either side.
 *     4. Add the key to the relevant section in `SECTION_KEYS`.
 *     5. Bump `SETTINGS_SCHEMA_VERSION` by 1 and add a v(n-1)→v(n) migration
 *        entry in the `migrate` function that injects the new default so
 *        existing users are not broken.
 *   uiStore reads the initial value from `useSettingsStore.getState()` and
 *   writes back via `useSettingsStore.setState()` on every change so the
 *   debounced server-sync pipeline fires automatically — no extra networking
 *   code is needed.
 *
 * INTENTIONALLY TRANSIENT STATE → uiStore (memory-only, resets on reload)
 *   State that should intentionally reset each session stays in uiStore and
 *   must NOT be added here:
 *   - Active selections (selectedSubstrate, selectedHotspot, selectedEfh)
 *   - Open/close state of modal panels (overviewOpen, markerFormOpen,
 *     findDataPanelOpen)
 *   - Camera jump queue (pendingDropIn)
 *   - Time scrubber (scrubDatetime)
 *   - Form prefill (markerFormPrefill)
 *
 * DEVICE-LOCAL STATE → raw localStorage (never settingsStore)
 *   One-time hints that should stay device-specific (e.g. hasSeenOrbitTouchHint)
 *   remain in raw localStorage and are handled directly in uiStore.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_KEY_BINDINGS,
  resolveKeyBindings,
  type ShortcutActionId,
} from "./keyBindings";
import { usePanelCollapseStore, type PanelId } from "./panelCollapseStore";
import type { MarkerTypeValue } from "./markerConstants";
import {
  toValidJoystickMode,
  toValidColormapTheme,
  toValidWaterType,
  toValidDefaultSpeedTier,
} from "./settingsGuards";

export const SETTINGS_SCHEMA_VERSION = 30;

/** Supported vertical-exaggeration range (matches the Settings slider). */
export const TERRAIN_EXAGGERATION_MIN = 1;
export const TERRAIN_EXAGGERATION_MAX = 20;

/**
 * Normalize a vertical-exaggeration value into the supported [1, 20] range.
 * Store setters and the persist migration both apply this, so the renderer,
 * the Settings slider, and the Provenance panel always agree on the value.
 * Non-finite input falls back to the 1× (true-to-life) default.
 */
export function clampTerrainExaggeration(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : TERRAIN_EXAGGERATION_MIN;
  return Math.min(TERRAIN_EXAGGERATION_MAX, Math.max(TERRAIN_EXAGGERATION_MIN, n));
}

export type SidebarMode = 'explore' | 'plan' | 'analyze' | 'live';

/**
 * Standard-mapping gamepad button index used to trigger the crosshair
 * action menu by default. Index 3 is Y (Xbox) / Triangle (PlayStation) /
 * X (Nintendo) — a free face button on every common controller layout.
 */
export const DEFAULT_CROSSHAIR_MENU_GAMEPAD_BUTTON = 3;

export type LandmassStyle = "realistic" | "flat";

/** Source for the ambient (depth-averaged) current vector. */
export type CurrentsSource = "manual" | "noaa";

export interface DatasetHomePosition {
  lon: number;
  lat: number;
  depth: number;
}

/**
 * Manual environmental conditions entered by the user for a freshwater lake
 * or any location where real sensor data is unavailable.
 * Stored per-dataset (keyed by datasetId) so conditions for one lake don't
 * bleed into another.
 */
export interface ManualConditions {
  windSpeedKnots: number;
  windDirectionDeg: number;
  surfaceTempC: number | null;
  currentSpeedKnots: number;
  currentDirectionDeg: number;
  waterLevelM: number | null;
}

/**
 * Snapshot of the camera position and active dataset saved automatically
 * as the user flies around. Restored on next load when cameraSpawnBehaviour
 * is "last". Written to settingsStore on a debounced interval and synced to
 * the server so cross-device resume works for signed-in users.
 */
export interface LastSession {
  lon: number;
  lat: number;
  depth: number;
  heading: number;
  datasetId: string;
}

export interface CameraBookmark {
  id: string;
  name: string;
  lon: number;
  lat: number;
  depth: number;
  heading: number;
}

export type WaterType = "saltwater" | "freshwater";
export type ParticleDensity = "off" | "sparse" | "dense";
export type TextureQuality = "off" | "low" | "high";
export type ColormapTheme = "ocean" | "thermal" | "grayscale" | "viridis" | "freshwater" | "custom";
export type CoordinateFormat = "decimal" | "dms";
export type DepthUnit = "metres" | "feet";
/**
 * Global units system. "nautical" is geared at boaters: speeds render in
 * knots while depths/distances follow the imperial-style feet/miles familiar
 * from nautical charts. Temperature defaults to Celsius (override via
 * `temperatureUnit`).
 */
export type UnitsSystem = "metric" | "imperial" | "nautical";
/**
 * Temperature display override. "auto" follows the global `units` selector
 * (metric → °C, imperial → °F); "celsius" / "fahrenheit" force a specific
 * unit regardless of the global selector — mirrors how `depthUnit` works.
 */
export type TemperatureUnit = "auto" | "celsius" | "fahrenheit";
export type CameraSpawnBehaviour = "deepest" | "home" | "last" | "center";
/** Every marker type value across all symbol-library sections (incl. legacy). */
export type MarkerType = MarkerTypeValue;
export type JoystickMode = "auto" | "always" | "off";

export type FontSizeLevel = "smallest" | "small" | "medium" | "large" | "x-large" | "largest";

/**
 * Maps each FontSizeLevel to a CSS scale multiplier applied via
 * `--bs-font-scale` on <body>. "medium" (1.0) matches the pre-existing
 * default appearance. Components that inline-style their font size (HUD,
 * panels) multiply their base px value by this factor.
 */
export const FONT_SIZE_SCALE: Record<FontSizeLevel, number> = {
  smallest: 0.80,
  small: 0.875,
  medium: 1.0,
  large: 1.15,
  "x-large": 1.30,
  largest: 1.45,
};

/**
 * The dataset that should load automatically when the app starts.
 * `kind: 'preset'` refers to a built-in dataset from /api/datasets.
 * `kind: 'upload'` refers to a user-uploaded dataset from /api/user/datasets.
 */
export interface DefaultMapLoad {
  kind: "preset" | "upload";
  id: string;
}
export type QualityPreset = "low" | "medium" | "high" | "ultra" | "custom";
export type TimeFormat = "utc" | "local" | "12h" | "24h";
export type CurrentArrowDensity = "sparse" | "normal" | "dense";
export type TidalDepthLayer = "surface" | "mid" | "near-bottom";
export type TrailRetention = "7" | "30" | "90" | "all";
export type ConditionsOverlayStyle = "arrows" | "particles";
export type WindOverlayStyle = ConditionsOverlayStyle;
export type TideOverlayStyle = ConditionsOverlayStyle;
export type CurrentOverlayStyle = ConditionsOverlayStyle;

export type SettingsSection =
  | "camera"
  | "visuals"
  | "hud"
  | "markers"
  | "tidal"
  | "habitat"
  | "gps"
  | "data"
  | "accessibility"
  | "account"
  | "overview"
  | "environment"
  | "currents"
  | "shortcuts"
  | "onboarding";

export interface SettingsState {
  schemaVersion: number;

  // ── Page-level ───────────────────────────────────────────────────────
  showAdvancedEverywhere: boolean;

  // ── Camera & Controls ─────────────────────────────────────────────────
  defaultSpeedTier: number;
  mouseSensitivity: number;
  invertMouseY: boolean;
  mouseZoomSensitivity: number;
  touchpadZoomSensitivity: number;
  pinchZoomSensitivity: number;
  joystickMode: JoystickMode;
  showJoystickInOrbit: boolean;
  fieldOfView: number;
  renderDistance: number;
  cameraSpawnBehaviour: CameraSpawnBehaviour;
  /**
   * Last-known camera position + active dataset. Written on a debounced
   * interval while the user is flying. Restored on app load when
   * `cameraSpawnBehaviour` is "last".
   */
  lastSession: LastSession | null;

  // ── Visuals & Performance ─────────────────────────────────────────────
  qualityPreset: QualityPreset;
  terrainExaggeration: number;
  enableMarineSnow: boolean;
  particleDensity: ParticleDensity;
  enableCaustics: boolean;
  fogDensity: number;
  fogColor: string;
  /** RGB hex colour for no-data (land / survey gap) tiles on the terrain mesh (default light gray). */
  nodataColor: string;
  ambientLightIntensity: number;
  directionalLightIntensity: number;
  lampIntensity: number;
  lampRange: number;
  antialiasing: boolean;
  textureQuality: TextureQuality;
  colormapTheme: ColormapTheme;
  smoothTerrainSpikes: boolean;
  /** Render the sea-level water surface plane over the bathymetry (default on). */
  showWaterSurface: boolean;
  /** Render the semi-transparent thermal water volume layer (default off — opt-in). */
  showWaterTempLayer: boolean;
  /** Render above-water landmass meshing from the terrain topography array (default off). */
  showLandmass: boolean;
  /** How the landmass is coloured: realistic elevation ramp or a single flat neutral colour. */
  landmassStyle: LandmassStyle;
  /** When true, drape the ESRI World Imagery satellite photo over the land mesh (default on). When false, use the procedural green→brown→grey colour ramp instead. */
  satelliteImagery: boolean;

  // ── HUD & Layout ──────────────────────────────────────────────────────
  hudOpacity: number;
  showCrosshairGps: boolean;
  showCameraPosition: boolean;
  showHeading: boolean;
  showDepthLegend: boolean;
  showDepthScaleBar: boolean;
  showCompassMinimap: boolean;
  showControlsLegend: boolean;
  showTidePanel: boolean;
  showHabitatPanel: boolean;
  showDatasetPanel: boolean;
  showQueryPanel: boolean;
  showUiTooltips: boolean;
  /** Show the /health latency badge in the bottom-right corner (dev builds only). */
  showHealthBadge: boolean;
  timeFormat: TimeFormat;
  coordinateFormat: CoordinateFormat;
  depthUnit: DepthUnit;
  units: UnitsSystem;
  temperatureUnit: TemperatureUnit;

  // ── Overview Map ──────────────────────────────────────────────────────
  overviewDefaultZoom: number;
  overviewShowGrid: boolean;
  overviewShowMarkers: boolean;
  overviewOpenOnLoad: boolean;
  /** Draw iso-depth contour lines on the 2D overview map. */
  contoursEnabled: boolean;
  /**
   * Spacing between contour lines in the user's active unit system
   * (metres for metric, feet for imperial/nautical).
   */
  contourInterval: number;

  // ── Markers ──────────────────────────────────────────────────────────
  defaultMarkerType: MarkerType;
  defaultDepthPoleColor: string;
  showMarkerLabels: boolean;
  visibleMarkerTypes: MarkerType[];
  privateMarkers: boolean;
  markerClusterThreshold: number;

  // ── Tidal Defaults ───────────────────────────────────────────────────
  autoLoadTidal: boolean;
  /**
   * Minimum trip length in hours for the Trip Window finder. Windows
   * shorter than this are dimmed so they can't be mistaken for usable
   * outings. 0 = no minimum (show every window normally).
   */
  tripMinDurationH: number;
  /** Wind speed (knots) below which an hour counts as "go". Matches the boatGoWindKn server setting. */
  boatGoWindKn: number;
  /** Wave height (metres) below which an hour counts as "go". Matches the boatGoWaveM server setting. */
  boatGoWaveM: number;
  /** Wind speed (knots) at or above which an hour becomes "no-go". */
  boatNoGoWindKn: number;
  /** Wave height (metres) at or above which an hour becomes "no-go". */
  boatNoGoWaveM: number;
  defaultTidalDepthLayer: TidalDepthLayer;
  currentArrowDensity: CurrentArrowDensity;
  /**
   * Per-depth-layer arrow density override. When set, overrides the global
   * `currentArrowDensity` for that specific layer, letting users e.g. keep
   * surface arrows sparse while boosting near-bottom density for drift
   * planning. Defaults to "normal" for each layer on first install.
   */
  layerArrowDensity: Record<TidalDepthLayer, CurrentArrowDensity>;
  /**
   * Per-overlay visual style for the always-on Wind / Tide / Current
   * overlays. "arrows" (default) keeps the directional arrow field;
   * "particles" replaces it with a streaming particle flow that emphasises
   * eddies and shear. Choices are independent so users can, e.g., use
   * particles for fast-moving wind but arrows for directional tide.
   */
  windOverlayStyle: WindOverlayStyle;
  tideOverlayStyle: TideOverlayStyle;
  currentOverlayStyle: CurrentOverlayStyle;

  // ── Bathymetric Currents Simulation (Task #136) ──────────────────────
  /** Master enable for the bathymetry-shaped current simulation. */
  currentsEnabled: boolean;
  /** Where the ambient (depth-averaged) current vector comes from. */
  currentsSource: CurrentsSource;
  /** Manual ambient direction (degrees, compass "going-to"). */
  currentsManualDirectionDeg: number;
  /** Manual ambient speed in knots. */
  currentsManualSpeedKt: number;
  /** Tide-phase scrubber position in [0, 1) — 0 = flood peak, 0.5 = ebb peak. */
  currentsTidePhase: number;
  /** Animate the tide-phase scrubber automatically. */
  currentsAutoAdvance: boolean;
  /** Show the animated particle layer. */
  currentsShowParticles: boolean;
  /** Show the instanced speed-coloured arrow layer. */
  currentsShowArrows: boolean;
  /** Show the integrated streamline ribbons layer. */
  currentsShowStreamlines: boolean;

  // ── Habitat & Zone Defaults ──────────────────────────────────────────
  autoShowZoneOverlay: boolean;
  defaultHabitatSpecies: string;
  /** Habitat suitability overlay blend strength (0=invisible, 1=fully opaque). */
  habitatOverlayIntensity: number;
  /** Habitat suitability overlay tint colour (hex, default amber #ff9919). */
  habitatOverlayColor: string;

  // ── GPS & Trail ──────────────────────────────────────────────────────
  autoStartTrailRecording: boolean;
  defaultTrailColor: string;
  gpsRecordingInterval: number;
  trailRetention: TrailRetention;
  /**
   * Seconds of inactivity after a manual camera interaction before GPS
   * Follow Me mode automatically resumes tracking. Range 5–120, default 20.
   */
  followResumeDelaySec: number;

  // ── Data & Storage ───────────────────────────────────────────────────
  defaultRegion: string;
  autoLoadLastDataset: boolean;
  /**
   * Dataset to load automatically on every app start.
   * `null` means "no preference — use the built-in default".
   * Persisted and synced cross-device like all other settings.
   */
  defaultMapLoad: DefaultMapLoad | null;
  /** Last-used radius value for the manual coordinate search (in coordSearchRadiusUnit). */
  coordSearchRadius: number;
  /** Unit for coordSearchRadius: kilometres or nautical miles. */
  coordSearchRadiusUnit: "km" | "nmi";

  // ── Accessibility ────────────────────────────────────────────────────
  reducedMotion: boolean;
  colorBlindSafePalette: boolean;
  /** @deprecated replaced by globalFontSize — kept for v15→v16 migration only */
  largeHudText: boolean;
  highContrastHud: boolean;
  /** 6-level global text size selector. "medium" = current default appearance. */
  globalFontSize: FontSizeLevel;
  /** Outdoor display mode: opaque panels, bold text, cobalt accent for direct-sunlight use. */
  brightDaylight: boolean;
  /**
   * True when the user has explicitly chosen a depth colormap via the
   * Settings UI. False when still on the water-type default. Used by the
   * Bright Daylight mode to decide whether to auto-switch to the
   * high-contrast grayscale colormap for improved depth legibility outdoors.
   */
  colormapUserSet: boolean;

  // ── Account & Privacy ────────────────────────────────────────────────
  telemetryOptIn: boolean;
  /**
   * Whether the user has read and dismissed the one-time disclosure
   * explaining that AI queries transmit their approximate camera location
   * and dataset name to a third-party LLM service.
   */
  llmDisclosureAcknowledged: boolean;

  // ── Onboarding ───────────────────────────────────────────────────────
  /**
   * Set to true once the user completes or skips the first-time guided
   * tour. Synced to the server so a signed-in user who finishes the tour
   * on one device does not see it again on another.
   */
  hasSeenOnboarding: boolean;

  /**
   * Set to true once the user dismisses the one-time hint explaining that
   * the Drive Boat, Tidal 3D, and Drift toggles moved into the left sidebar.
   * Synced cross-device.
   */
  hasSeenToolbarRelocationHint: boolean;

  /** Per-dataset saved camera spawn positions (set via "Set as home" context menu). */
  datasetHomePositions: Record<string, DatasetHomePosition>;

  /** Per-dataset saved camera bookmarks, keyed by dataset id. */
  bookmarks: Record<string, CameraBookmark[]>;

  /**
   * Per-dataset manually-entered environmental conditions (persisted +
   * server-synced). Keyed by datasetId. Populated when the user checks
   * "Remember for this lake" in the ManualConditionsForm.
   */
  datasetManualConditions: Record<string, ManualConditions>;

  /**
   * Per-dataset active data source selection.
   * 'manual' = use the user's entered values; 'real' = use station/API data.
   * Keyed by datasetId.
   */
  manualConditionsActiveSource: Record<string, 'real' | 'manual'>;

  /** Expand/collapse state for dataset library folders, keyed by folder id. */
  datasetFolderExpanded: Record<string, boolean>;

  /** Expand/collapse state for My Saves folder sections, keyed by folder id. */
  saveFolderExpanded: Record<string, boolean>;

  // ── Environment ───────────────────────────────────────────────────────
  waterType: WaterType;

  // ── Overlay & UI toggles (promoted from uiStore / localStorage to enable
  //    cross-device sync via the server-side user profile) ─────────────────
  /** NOAA Aviation Weather station pins on the OverviewMap. */
  weatherStationsActive: boolean;
  /** AOOS RAWS land-weather station pins on the OverviewMap. */
  rawsOverlayActive: boolean;
  /** Always-on Wind arrow overlay. */
  windOverlayActive: boolean;
  /** Always-on Tide arrow overlay. */
  tideOverlayActive: boolean;
  /** Always-on Current arrow overlay. */
  currentOverlayActive: boolean;
  /** Which depth layers the Current overlay renders (multi-select). */
  currentDepthLayers: TidalDepthLayer[];
  /** Whether the left side pane (datasets, habitat, tides…) is collapsed. */
  sidePaneCollapsed: boolean;
  /** Brush radius in grid cells (1–20) for the zone-paint tool. */
  zonePaintBrushRadius: number;
  /** Show real Alaska ShoreZone substrate polygons as a draped overlay. */
  zoneOverlayEnabled: boolean;
  /** Whether the zone-paint tool is active. */
  zonePaintMode: boolean;
  /** Which texture slot (0–3) the paint brush is currently set to. */
  zonePaintSlot: number;
  /** Show substrate colour overlay. */
  substrateColorMode: boolean;
  /**
   * CMECS substrate classes the user has hidden via the legend (lower-cased).
   * Stored as a plain array for JSON serialisability; uiStore converts to Set.
   */
  hiddenSubstrateClasses: string[];
  /** Show intertidal hotspot polygons in the 3D scene. */
  intertidalHotspotsEnabled: boolean;
  /** Which score type to highlight in the Intertidal Hotspots layer. */
  intertidalScoreMode: 'tidepool' | 'beachcombing';
  /**
   * User override for the Mean High Water datum (ft above MLLW) used by
   * intertidal classification. null = use the resolved station value.
   */
  intertidalMhwOverrideFt: number | null;
  /**
   * User override for the Mean Higher High Water datum (ft above MLLW) used
   * by intertidal classification. null = use the resolved station value.
   */
  intertidalMhhwOverrideFt: number | null;
  /** Show EFH zone polygon outlines in the 3D scene. */
  efhOverlayEnabled: boolean;
  /**
   * EFH species common names the user has hidden via the legend.
   * Stored as a plain array for JSON serialisability; uiStore converts to Set.
   */
  hiddenEfhSpecies: string[];
  /**
   * HYD93 feature type codes currently visible.
   * Codes: 89 (Rocks), 103 (Kelp), 146 (Ledge), 530 (Rocky reef), 988 (Obstruction).
   * Stored as a plain array for JSON serialisability; uiStore converts to Set.
   * Default = all five codes visible.
   */
  hyd93ActiveFeatureCodes: number[];
  /**
   * Master toggle for the HYD93 cartographic annotation overlay (kelp,
   * rocks, rocky reefs, ledges, obstructions). Persisted so power users
   * who always work with HYD93 datasets keep the overlay on between sessions.
   */
  hyd93FeaturesEnabled: boolean;

  // ── Shortcuts (remappable bindings) ──────────────────────────────────
  /**
   * Map of action id (e.g. "moveForward", "crosshairMenu") to
   * `KeyboardEvent.code` (e.g. "KeyW", "KeyQ"). Every action listed in
   * `SHORTCUT_ACTIONS` is individually remappable. Missing keys fall back
   * to the action's default via `resolveKeyBindings`.
   */
  keyBindings: Record<ShortcutActionId, string>;
  /**
   * Standard-mapping gamepad button index that opens the same crosshair
   * action menu. `null` disables the gamepad binding. Default = Y/Triangle.
   */
  crosshairMenuGamepadButton: number | null;

  /**
   * Snapshot of the last "saved" data values. For signed-in users this is
   * refreshed after every successful PUT /api/settings. For signed-out users
   * (and on initial localStorage rehydration) it mirrors the persisted state.
   * Used by `useSectionDirty()` to drive per-section Save buttons.
   */
  syncedSnapshot?: Partial<SettingsState>;

  /**
   * ISO timestamp of the most recent successful sync with the server (either
   * a GET hydration or a PUT save). `null` when the user has never synced
   * (signed-out, offline, or first launch). Surfaced in the Account tab so
   * users can confirm cross-device sync is working.
   */
  lastSyncedAt: string | null;

  // ── Timeline scrubber (best-effort session restore) ───────────────────
  /** Last timeline scrubber position (ISO string). Restored on next load. */
  timelineCurrentTime: string | null;
  /** Last timeline range (ISO strings). Restored on next load. */
  timelineRange: { start: string; end: string } | null;

  // ── Sidebar mode ──────────────────────────────────────────────────────
  /**
   * Which contextual mode the left sidebar is showing.
   * 'explore' = DatasetPanel + OverlaysToolsPanel
   * 'plan'    = TidePanel + CurrentsPanel + WeatherPanel / DriftPlanner
   * 'analyze' = HabitatPanel + SeafloorClassificationPanel + QueryPanel
   * 'live'    = on-the-water Live panel (GPS follow + trail recording)
   * Persisted so the user's last mode survives page reloads.
   */
  sidebarMode: SidebarMode;
}

interface SettingsActions {
  // Camera & Controls
  setDefaultSpeedTier: (v: number) => void;
  setMouseSensitivity: (v: number) => void;
  setInvertMouseY: (v: boolean) => void;
  setMouseZoomSensitivity: (v: number) => void;
  setTouchpadZoomSensitivity: (v: number) => void;
  setPinchZoomSensitivity: (v: number) => void;
  setJoystickMode: (v: JoystickMode) => void;
  setShowJoystickInOrbit: (v: boolean) => void;
  setFieldOfView: (v: number) => void;
  setRenderDistance: (v: number) => void;
  setCameraSpawnBehaviour: (v: CameraSpawnBehaviour) => void;

  // Visuals
  setQualityPreset: (v: QualityPreset) => void;
  applyQualityPreset: (v: Exclude<QualityPreset, "custom">) => void;
  setTerrainExaggeration: (v: number) => void;
  setEnableMarineSnow: (v: boolean) => void;
  setParticleDensity: (v: ParticleDensity) => void;
  setEnableCaustics: (v: boolean) => void;
  setFogDensity: (v: number) => void;
  setFogColor: (v: string) => void;
  setNodataColor: (v: string) => void;
  setAmbientLightIntensity: (v: number) => void;
  setDirectionalLightIntensity: (v: number) => void;
  setLampIntensity: (v: number) => void;
  setLampRange: (v: number) => void;
  setAntialiasing: (v: boolean) => void;
  setTextureQuality: (v: TextureQuality) => void;
  setColormapTheme: (v: ColormapTheme) => void;
  setColormapThemeByUser: (v: ColormapTheme) => void;
  setSmoothTerrainSpikes: (v: boolean) => void;
  setShowWaterSurface: (v: boolean) => void;
  setShowWaterTempLayer: (v: boolean) => void;
  setShowLandmass: (v: boolean) => void;
  setLandmassStyle: (v: LandmassStyle) => void;
  setSatelliteImagery: (v: boolean) => void;

  // HUD
  setHudOpacity: (v: number) => void;
  setShowCrosshairGps: (v: boolean) => void;
  setShowCameraPosition: (v: boolean) => void;
  setShowHeading: (v: boolean) => void;
  setShowDepthLegend: (v: boolean) => void;
  setShowDepthScaleBar: (v: boolean) => void;
  setShowCompassMinimap: (v: boolean) => void;
  setShowControlsLegend: (v: boolean) => void;
  setShowTidePanel: (v: boolean) => void;
  setShowHabitatPanel: (v: boolean) => void;
  setShowDatasetPanel: (v: boolean) => void;
  setShowQueryPanel: (v: boolean) => void;
  setShowUiTooltips: (v: boolean) => void;
  setShowHealthBadge: (v: boolean) => void;
  setTimeFormat: (v: TimeFormat) => void;
  setCoordinateFormat: (v: CoordinateFormat) => void;
  setDepthUnit: (v: DepthUnit) => void;
  setUnits: (v: UnitsSystem) => void;
  setTemperatureUnit: (v: TemperatureUnit) => void;

  // Overview Map
  setOverviewDefaultZoom: (v: number) => void;
  setOverviewShowGrid: (v: boolean) => void;
  setOverviewShowMarkers: (v: boolean) => void;
  setOverviewOpenOnLoad: (v: boolean) => void;
  setContoursEnabled: (v: boolean) => void;
  setContourInterval: (v: number) => void;

  // Markers
  setDefaultMarkerType: (v: MarkerType) => void;
  setDefaultDepthPoleColor: (v: string) => void;
  setShowMarkerLabels: (v: boolean) => void;
  setVisibleMarkerTypes: (v: MarkerType[]) => void;
  setPrivateMarkers: (v: boolean) => void;
  setMarkerClusterThreshold: (v: number) => void;

  // Tidal
  setAutoLoadTidal: (v: boolean) => void;
  setTripMinDurationH: (v: number) => void;
  setBoatGoWindKn: (v: number) => void;
  setBoatGoWaveM: (v: number) => void;
  setBoatNoGoWindKn: (v: number) => void;
  setBoatNoGoWaveM: (v: number) => void;
  setDefaultTidalDepthLayer: (v: TidalDepthLayer) => void;
  setCurrentArrowDensity: (v: CurrentArrowDensity) => void;
  setLayerArrowDensity: (layer: TidalDepthLayer, density: CurrentArrowDensity) => void;
  setWindOverlayStyle: (v: WindOverlayStyle) => void;
  setTideOverlayStyle: (v: TideOverlayStyle) => void;
  setCurrentOverlayStyle: (v: CurrentOverlayStyle) => void;

  // Currents (Task #136)
  setCurrentsEnabled: (v: boolean) => void;
  setCurrentsSource: (v: CurrentsSource) => void;
  setCurrentsManualDirectionDeg: (v: number) => void;
  setCurrentsManualSpeedKt: (v: number) => void;
  setCurrentsTidePhase: (v: number) => void;
  setCurrentsAutoAdvance: (v: boolean) => void;
  setCurrentsShowParticles: (v: boolean) => void;
  setCurrentsShowArrows: (v: boolean) => void;
  setCurrentsShowStreamlines: (v: boolean) => void;

  // Habitat
  setAutoShowZoneOverlay: (v: boolean) => void;
  setDefaultHabitatSpecies: (v: string) => void;
  setHabitatOverlayIntensity: (v: number) => void;
  setHabitatOverlayColor: (color: string) => void;

  // GPS / Trail
  setAutoStartTrailRecording: (v: boolean) => void;
  setDefaultTrailColor: (v: string) => void;
  setGpsRecordingInterval: (ms: number) => void;
  setTrailRetention: (v: TrailRetention) => void;
  setFollowResumeDelaySec: (v: number) => void;

  // Data
  setDefaultRegion: (v: string) => void;
  setAutoLoadLastDataset: (v: boolean) => void;
  setDefaultMapLoad: (v: DefaultMapLoad | null) => void;
  setCoordSearchRadius: (v: number) => void;
  setCoordSearchRadiusUnit: (v: "km" | "nmi") => void;

  // Accessibility
  setReducedMotion: (v: boolean) => void;
  setColorBlindSafePalette: (v: boolean) => void;
  setLargeHudText: (v: boolean) => void;
  setHighContrastHud: (v: boolean) => void;
  setBrightDaylight: (v: boolean) => void;
  setColormapUserSet: (v: boolean) => void;
  setGlobalFontSize: (v: FontSizeLevel) => void;

  // Account
  setTelemetryOptIn: (v: boolean) => void;
  setLlmDisclosureAcknowledged: (v: boolean) => void;

  // Onboarding
  setHasSeenOnboarding: (v: boolean) => void;
  setHasSeenToolbarRelocationHint: (v: boolean) => void;

  // Last session
  setLastSession: (v: LastSession | null) => void;

  // Page-level
  setShowAdvancedEverywhere: (v: boolean) => void;

  // Dataset home positions
  setDatasetHome: (datasetId: string, pos: DatasetHomePosition) => void;
  clearDatasetHome: (datasetId: string) => void;

  // Bookmarks
  addBookmark: (datasetId: string, bookmark: Omit<CameraBookmark, "id">) => void;
  renameBookmark: (datasetId: string, bookmarkId: string, name: string) => void;
  deleteBookmark: (datasetId: string, bookmarkId: string) => void;
  reorderBookmarks: (datasetId: string, orderedBookmarks: CameraBookmark[]) => void;

  // Manual conditions
  setDatasetManualConditions: (datasetId: string, conditions: ManualConditions) => void;
  clearDatasetManualConditions: (datasetId: string) => void;
  setManualConditionsActiveSource: (datasetId: string, source: 'real' | 'manual') => void;

  setWaterType: (v: WaterType) => void;

  // Overlay & UI toggles
  setWeatherStationsActive: (v: boolean) => void;
  setRawsOverlayActive: (v: boolean) => void;
  setWindOverlayActive: (v: boolean) => void;
  setTideOverlayActive: (v: boolean) => void;
  setCurrentOverlayActive: (v: boolean) => void;
  setCurrentDepthLayers: (v: TidalDepthLayer[]) => void;
  setSidePaneCollapsed: (v: boolean) => void;
  setZonePaintBrushRadius: (v: number) => void;
  setZoneOverlayEnabled: (v: boolean) => void;
  setZonePaintMode: (v: boolean) => void;
  setZonePaintSlot: (v: number) => void;
  setSubstrateColorMode: (v: boolean) => void;
  setHiddenSubstrateClasses: (v: string[]) => void;
  setIntertidalHotspotsEnabled: (v: boolean) => void;
  setIntertidalScoreMode: (v: 'tidepool' | 'beachcombing') => void;
  setIntertidalMhwOverrideFt: (v: number | null) => void;
  setIntertidalMhhwOverrideFt: (v: number | null) => void;
  setEfhOverlayEnabled: (v: boolean) => void;
  setHiddenEfhSpecies: (v: string[]) => void;
  setHyd93ActiveFeatureCodes: (v: number[]) => void;
  setHyd93FeaturesEnabled: (v: boolean) => void;

  // Shortcuts
  setKeyBinding: (action: ShortcutActionId, code: string) => void;
  resetKeyBinding: (action: ShortcutActionId) => void;
  resetAllKeyBindings: () => void;
  setCrosshairMenuGamepadButton: (v: number | null) => void;

  setSidebarMode: (v: SidebarMode) => void;

  /** Hydrate the entire settings state from the server response. */
  hydrateFromServer: (partial: Partial<SettingsState>) => void;

  /** Reset every setting in the given section back to defaults. */
  resetSection: (section: SettingsSection) => void;

  /** Reset every setting back to defaults (preserves datasetHomePositions). */
  resetAll: () => void;

  /**
   * Fully reset all settings to defaults and remove the localStorage entry.
   * Called on sign-out to prevent cross-account state bleed on shared devices.
   * Unlike `resetAll`, this does NOT preserve datasetHomePositions or bookmarks.
   */
  clearForSignOut: () => void;

  /**
   * Mark every section as saved (snapshot equals current data values).
   * Pass the server-provided ISO timestamp (from the PUT response) so the
   * "Last synced" indicator in the Account tab reflects the server's clock.
   */
  markAllSaved: (lastSyncedAt?: string | null) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

/**
 * Quality preset value tables. Applying a preset overwrites the visuals
 * advanced knobs to a known-good combination.
 */
export const QUALITY_PRESETS: Record<
  Exclude<QualityPreset, "custom">,
  Pick<
    SettingsState,
    | "particleDensity"
    | "enableMarineSnow"
    | "enableCaustics"
    | "antialiasing"
    | "textureQuality"
    | "fogDensity"
    | "ambientLightIntensity"
    | "directionalLightIntensity"
    | "lampIntensity"
    | "lampRange"
    | "renderDistance"
  >
> = {
  low: {
    particleDensity: "off",
    enableMarineSnow: false,
    enableCaustics: false,
    antialiasing: false,
    textureQuality: "low",
    fogDensity: 0.018,
    ambientLightIntensity: 0.05,
    directionalLightIntensity: 0.25,
    lampIntensity: 1.5,
    lampRange: 30,
    renderDistance: 200,
  },
  medium: {
    particleDensity: "sparse",
    enableMarineSnow: true,
    enableCaustics: false,
    antialiasing: true,
    textureQuality: "high",
    fogDensity: 0.012,
    ambientLightIntensity: 0.05,
    directionalLightIntensity: 0.35,
    lampIntensity: 2,
    lampRange: 40,
    renderDistance: 400,
  },
  high: {
    particleDensity: "sparse",
    enableMarineSnow: true,
    enableCaustics: true,
    antialiasing: true,
    textureQuality: "high",
    fogDensity: 0.010,
    ambientLightIntensity: 0.08,
    directionalLightIntensity: 0.45,
    lampIntensity: 2.5,
    lampRange: 50,
    renderDistance: 600,
  },
  ultra: {
    particleDensity: "dense",
    enableMarineSnow: true,
    enableCaustics: true,
    antialiasing: true,
    textureQuality: "high",
    fogDensity: 0.008,
    ambientLightIntensity: 0.10,
    directionalLightIntensity: 0.55,
    lampIntensity: 3,
    lampRange: 70,
    renderDistance: 1000,
  },
};

export const DEFAULT_SETTINGS: SettingsState = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,

  showAdvancedEverywhere: false,

  // Camera
  defaultSpeedTier: 2,
  mouseSensitivity: 1.0,
  invertMouseY: false,
  mouseZoomSensitivity: 1.0,
  touchpadZoomSensitivity: 1.0,
  pinchZoomSensitivity: 1.0,
  joystickMode: "auto",
  showJoystickInOrbit: false,
  fieldOfView: 45,
  renderDistance: 400,
  cameraSpawnBehaviour: "last",
  lastSession: null,

  // Visuals
  qualityPreset: "medium",
  terrainExaggeration: 1,
  enableMarineSnow: false,
  particleDensity: "sparse",
  enableCaustics: false,
  fogDensity: 0.012,
  fogColor: "#020818",
  nodataColor: "#bfbfbf",
  ambientLightIntensity: 0.05,
  directionalLightIntensity: 0.35,
  lampIntensity: 2,
  lampRange: 40,
  antialiasing: true,
  textureQuality: "high",
  colormapTheme: "ocean",
  smoothTerrainSpikes: true,
  showWaterSurface: true,
  showWaterTempLayer: false,
  showLandmass: false,
  landmassStyle: "realistic",
  satelliteImagery: true,

  // HUD
  hudOpacity: 0.75,
  showCrosshairGps: true,
  showCameraPosition: true,
  showHeading: true,
  showDepthLegend: true,
  showDepthScaleBar: true,
  showCompassMinimap: true,
  showControlsLegend: true,
  showTidePanel: true,
  showHabitatPanel: true,
  showDatasetPanel: true,
  showQueryPanel: true,
  showUiTooltips: true,
  showHealthBadge: true,
  timeFormat: "local",
  coordinateFormat: "decimal",
  depthUnit: "metres",
  units: "metric",
  temperatureUnit: "auto",

  // Overview
  overviewDefaultZoom: 1.0,
  overviewShowGrid: true,
  overviewShowMarkers: true,
  overviewOpenOnLoad: false,
  contoursEnabled: true,
  contourInterval: 10,

  // Markers
  defaultMarkerType: "fish",
  defaultDepthPoleColor: "#22d3ee",
  showMarkerLabels: true,
  // Must match the server default in api-server routes/settings.ts exactly
  // (same values, same order) so settings sync sees them as equal.
  visibleMarkerTypes: ["fish", "shipwreck", "coral", "vent", "custom", "depth_pole", "log", "vegetation", "sample", "bass", "trout", "pike", "walleye", "crayfish", "salmon", "tuna", "halibut", "shark", "swordfish", "rockfish", "cod", "mahi_mahi", "grouper", "snapper", "crab", "lobster", "shrimp", "krill", "jellyfish", "octopus", "squid", "sea_urchin", "starfish", "sea_turtle", "school_herring", "school_sardine", "school_mackerel", "school_tuna", "school_anchovy", "catfish", "crappie", "bluegill", "sunfish", "carp", "yellow_perch", "muskie", "largemouth_bass", "smallmouth_bass", "channel_catfish", "freshwater_shrimp", "freshwater_crab", "snapping_turtle", "bullfrog", "beaver_dam", "lily_pad", "cattail", "reed_bed", "submerged_grass", "spring", "school_perch", "school_bluegill", "school_bass", "school_crappie", "school_carp", "sand_bass", "lake_trout", "perch", "rainbow_trout", "silver_salmon", "chinook_salmon", "pink_salmon", "turbot", "black_rockfish", "yelloweye_rockfish", "dog_shark", "dungeness_crab", "prawn_shrimp", "school_salmon", "school_rockfish", "lingcod", "sole", "multiple_logs", "multiple_fish", "submerged_rock", "land", "red_light", "green_light", "red_buoy", "green_buoy", "rock", "clam", "clam_beach", "cool_rocks", "rock_beach", "anchorage", "hazard_rock", "marina", "boat_ramp", "fuel_dock", "diver_down", "no_anchor", "channel_marker", "daymark"],
  privateMarkers: false,
  markerClusterThreshold: 25,

  // Tidal
  autoLoadTidal: false,
  tripMinDurationH: 0,
  boatGoWindKn: 12,
  boatGoWaveM: 0.8,
  boatNoGoWindKn: 22,
  boatNoGoWaveM: 1.5,
  defaultTidalDepthLayer: "surface",
  currentArrowDensity: "normal",
  layerArrowDensity: { surface: "normal", mid: "normal", "near-bottom": "normal" },
  windOverlayStyle: "arrows",
  tideOverlayStyle: "arrows",
  currentOverlayStyle: "arrows",

  // Currents (Task #136)
  currentsEnabled: false,
  currentsSource: "noaa",
  currentsManualDirectionDeg: 90,
  currentsManualSpeedKt: 0.8,
  currentsTidePhase: 0,
  currentsAutoAdvance: false,
  currentsShowParticles: true,
  currentsShowArrows: true,
  currentsShowStreamlines: false,

  // Habitat
  autoShowZoneOverlay: false,
  defaultHabitatSpecies: "",
  habitatOverlayIntensity: 0.4,
  habitatOverlayColor: "#ff9919",

  // GPS / Trail
  autoStartTrailRecording: false,
  defaultTrailColor: "#ff6600",
  gpsRecordingInterval: 1000,
  trailRetention: "30",
  followResumeDelaySec: 20,

  // Data
  defaultRegion: "",
  autoLoadLastDataset: true,
  defaultMapLoad: null,
  coordSearchRadius: 10,
  coordSearchRadiusUnit: "km",

  // Accessibility
  reducedMotion: false,
  colorBlindSafePalette: false,
  largeHudText: false,
  highContrastHud: false,
  brightDaylight: false,
  colormapUserSet: false,
  globalFontSize: "medium",

  // Account
  telemetryOptIn: false,
  llmDisclosureAcknowledged: false,

  // Onboarding
  hasSeenOnboarding: false,
  hasSeenToolbarRelocationHint: false,

  datasetHomePositions: {},
  datasetFolderExpanded: {},
  saveFolderExpanded: {},
  bookmarks: {},
  datasetManualConditions: {},
  manualConditionsActiveSource: {},

  waterType: "saltwater",

  // Overlay & UI toggles
  weatherStationsActive: false,
  rawsOverlayActive: false,
  windOverlayActive: false,
  tideOverlayActive: false,
  currentOverlayActive: false,
  currentDepthLayers: ["mid"],
  sidePaneCollapsed: false,
  zonePaintBrushRadius: 4,
  zoneOverlayEnabled: false,
  zonePaintMode: false,
  zonePaintSlot: 0,
  substrateColorMode: false,
  hiddenSubstrateClasses: [],
  intertidalHotspotsEnabled: false,
  intertidalScoreMode: 'tidepool',
  intertidalMhwOverrideFt: null,
  intertidalMhhwOverrideFt: null,
  efhOverlayEnabled: false,
  hiddenEfhSpecies: [],
  hyd93ActiveFeatureCodes: [89, 103, 146, 530, 988],
  hyd93FeaturesEnabled: false,

  // Shortcuts
  keyBindings: { ...DEFAULT_KEY_BINDINGS },
  crosshairMenuGamepadButton: DEFAULT_CROSSHAIR_MENU_GAMEPAD_BUTTON,

  lastSyncedAt: null,

  timelineCurrentTime: null,
  timelineRange: null,

  sidebarMode: 'explore',
};

export const SECTION_KEYS: Record<SettingsSection, (keyof SettingsState)[]> = {
  camera: [
    "defaultSpeedTier", "mouseSensitivity", "invertMouseY",
    "mouseZoomSensitivity", "touchpadZoomSensitivity", "pinchZoomSensitivity",
    "joystickMode", "showJoystickInOrbit", "fieldOfView", "renderDistance", "cameraSpawnBehaviour",
  ],
  visuals: [
    "qualityPreset", "terrainExaggeration", "enableMarineSnow", "particleDensity",
    "enableCaustics", "fogDensity", "fogColor", "nodataColor", "ambientLightIntensity",
    "directionalLightIntensity", "lampIntensity", "lampRange", "antialiasing",
    "textureQuality", "colormapTheme", "smoothTerrainSpikes",
    "showWaterSurface", "showWaterTempLayer", "showLandmass", "landmassStyle", "satelliteImagery", "colormapUserSet",
    "contoursEnabled", "contourInterval",
  ],
  hud: [
    "hudOpacity", "showCrosshairGps", "showCameraPosition",
    "showHeading", "showDepthLegend", "showDepthScaleBar", "showCompassMinimap",
    "showControlsLegend", "showTidePanel", "showHabitatPanel", "showDatasetPanel",
    "showQueryPanel", "showUiTooltips", "showHealthBadge", "timeFormat", "coordinateFormat", "depthUnit", "units",
    "temperatureUnit", "sidePaneCollapsed", "sidebarMode",
  ],
  overview: [
    "overviewDefaultZoom", "overviewShowGrid", "overviewShowMarkers", "overviewOpenOnLoad",
  ],
  markers: [
    "defaultMarkerType", "defaultDepthPoleColor", "showMarkerLabels",
    "visibleMarkerTypes", "privateMarkers", "markerClusterThreshold",
  ],
  tidal: [
    "autoLoadTidal", "tripMinDurationH", "boatGoWindKn", "boatGoWaveM", "boatNoGoWindKn", "boatNoGoWaveM",
    "defaultTidalDepthLayer", "currentArrowDensity",
    "layerArrowDensity", "windOverlayStyle", "tideOverlayStyle", "currentOverlayStyle",
    "weatherStationsActive", "rawsOverlayActive", "windOverlayActive",
    "tideOverlayActive", "currentOverlayActive", "currentDepthLayers",
    "datasetManualConditions", "manualConditionsActiveSource",
  ],
  currents: [
    "currentsEnabled", "currentsSource", "currentsManualDirectionDeg",
    "currentsManualSpeedKt", "currentsTidePhase", "currentsAutoAdvance",
    "currentsShowParticles", "currentsShowArrows", "currentsShowStreamlines",
  ],
  habitat: [
    "autoShowZoneOverlay", "defaultHabitatSpecies", "habitatOverlayIntensity", "habitatOverlayColor",
    "zonePaintBrushRadius", "zoneOverlayEnabled", "zonePaintMode", "zonePaintSlot",
    "substrateColorMode", "hiddenSubstrateClasses",
    "intertidalHotspotsEnabled", "intertidalScoreMode",
    "intertidalMhwOverrideFt", "intertidalMhhwOverrideFt",
    "efhOverlayEnabled", "hiddenEfhSpecies",
    "hyd93ActiveFeatureCodes", "hyd93FeaturesEnabled",
  ],
  gps: [
    "autoStartTrailRecording", "defaultTrailColor", "gpsRecordingInterval", "trailRetention",
    "followResumeDelaySec",
  ],
  data: ["defaultRegion", "autoLoadLastDataset", "defaultMapLoad", "coordSearchRadius", "coordSearchRadiusUnit"],
  accessibility: [
    "reducedMotion", "colorBlindSafePalette", "largeHudText", "highContrastHud", "brightDaylight",
    "colormapUserSet", "globalFontSize",
  ],
  account: ["telemetryOptIn", "llmDisclosureAcknowledged"],
  environment: ["waterType"],
  shortcuts: ["keyBindings", "crosshairMenuGamepadButton"],
  onboarding: ["hasSeenOnboarding", "hasSeenToolbarRelocationHint"],
};

/**
 * Keys whose values should be snapshotted/synced. Excludes function-typed
 * actions and the snapshot itself; `datasetHomePositions` is excluded since
 * it is mutated outside the per-section editors (bookmarks uses the same
 * server-settings round-trip and IS included so cross-device sync works).
 */
const DATA_KEYS: (keyof SettingsState)[] = (Object.keys(DEFAULT_SETTINGS) as (keyof SettingsState)[])
  .filter((k) => k !== "datasetHomePositions" && k !== "lastSyncedAt");

function snapshotData(state: Partial<SettingsState>): Partial<SettingsState> {
  const out: Partial<SettingsState> = {};
  for (const k of DATA_KEYS) {
    if (k in state) {
      (out as Record<string, unknown>)[k] = (state as Record<string, unknown>)[k];
    }
  }
  return out;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => valuesEqual(v, b[i]));
  }
  if (
    a && b &&
    typeof a === "object" && typeof b === "object" &&
    !Array.isArray(a) && !Array.isArray(b)
  ) {
    const ar = a as Record<string, unknown>;
    const br = b as Record<string, unknown>;
    const ak = Object.keys(ar);
    const bk = Object.keys(br);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!valuesEqual(ar[k], br[k])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Module-level write-time guard for manual conditions.
 *
 * Bumped every time `setDatasetManualConditions` or
 * `setManualConditionsActiveSource` is called. `hydrateFromServer` checks this
 * before applying the server's `datasetManualConditions` /
 * `manualConditionsActiveSource` values: if the user wrote new conditions more
 * recently than the server payload was authored, the local values are kept.
 * This prevents a concurrent PUT flush triggered by a lake-switch from
 * silently overwriting freshly entered manual conditions.
 */
let _manualConditionsLastWriteMs = 0;
const MANUAL_CONDITIONS_GUARD_MS = 30_000;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => {
      const setter = <K extends keyof SettingsState>(key: K) =>
        (v: SettingsState[K]) => set({ [key]: v } as unknown as Partial<SettingsState>);

      return {
        ...DEFAULT_SETTINGS,
        syncedSnapshot: snapshotData(DEFAULT_SETTINGS),
        lastSyncedAt: null,

        // Camera
        setDefaultSpeedTier: setter("defaultSpeedTier"),
        setMouseSensitivity: setter("mouseSensitivity"),
        setInvertMouseY: setter("invertMouseY"),
        setMouseZoomSensitivity: setter("mouseZoomSensitivity"),
        setTouchpadZoomSensitivity: setter("touchpadZoomSensitivity"),
        setPinchZoomSensitivity: setter("pinchZoomSensitivity"),
        setJoystickMode: setter("joystickMode"),
        setShowJoystickInOrbit: setter("showJoystickInOrbit"),
        setFieldOfView: setter("fieldOfView"),
        setRenderDistance: setter("renderDistance"),
        setCameraSpawnBehaviour: setter("cameraSpawnBehaviour"),

        // Visuals
        setQualityPreset: setter("qualityPreset"),
        applyQualityPreset: (v) => {
          const preset = QUALITY_PRESETS[v];
          set({ ...preset, qualityPreset: v });
        },
        setTerrainExaggeration: (v) =>
          set({ terrainExaggeration: clampTerrainExaggeration(v) }),
        setEnableMarineSnow: setter("enableMarineSnow"),
        setParticleDensity: (v) => set({ particleDensity: v, qualityPreset: "custom" }),
        setEnableCaustics: (v) => set({ enableCaustics: v, qualityPreset: "custom" }),
        setFogDensity: (v) => set({ fogDensity: v, qualityPreset: "custom" }),
        setFogColor: setter("fogColor"),
        setNodataColor: setter("nodataColor"),
        setAmbientLightIntensity: (v) => set({ ambientLightIntensity: v, qualityPreset: "custom" }),
        setDirectionalLightIntensity: (v) => set({ directionalLightIntensity: v, qualityPreset: "custom" }),
        setLampIntensity: (v) => set({ lampIntensity: v, qualityPreset: "custom" }),
        setLampRange: (v) => set({ lampRange: v, qualityPreset: "custom" }),
        setAntialiasing: (v) => set({ antialiasing: v, qualityPreset: "custom" }),
        setTextureQuality: (v) => set({ textureQuality: v, qualityPreset: "custom" }),
        setColormapTheme: setter("colormapTheme"),
        setColormapThemeByUser: (v) => set({ colormapTheme: v, colormapUserSet: true }),
        setSmoothTerrainSpikes: setter("smoothTerrainSpikes"),
        setShowWaterSurface: setter("showWaterSurface"),
        setShowWaterTempLayer: setter("showWaterTempLayer"),
        setShowLandmass: setter("showLandmass"),
        setLandmassStyle: setter("landmassStyle"),
        setSatelliteImagery: setter("satelliteImagery"),

        // HUD
        setHudOpacity: setter("hudOpacity"),
        setShowCrosshairGps: setter("showCrosshairGps"),
        setShowCameraPosition: setter("showCameraPosition"),
        setShowHeading: setter("showHeading"),
        setShowDepthLegend: setter("showDepthLegend"),
        setShowDepthScaleBar: setter("showDepthScaleBar"),
        setShowCompassMinimap: setter("showCompassMinimap"),
        setShowControlsLegend: setter("showControlsLegend"),
        setShowTidePanel: setter("showTidePanel"),
        setShowHabitatPanel: setter("showHabitatPanel"),
        setShowDatasetPanel: setter("showDatasetPanel"),
        setShowQueryPanel: setter("showQueryPanel"),
        setShowUiTooltips: setter("showUiTooltips"),
        setShowHealthBadge: setter("showHealthBadge"),
        setTimeFormat: setter("timeFormat"),
        setCoordinateFormat: setter("coordinateFormat"),
        setDepthUnit: setter("depthUnit"),
        setUnits: (v) =>
          set({ units: v, depthUnit: v === "metric" ? "metres" : "feet" }),
        setTemperatureUnit: setter("temperatureUnit"),

        // Overview
        setOverviewDefaultZoom: setter("overviewDefaultZoom"),
        setOverviewShowGrid: setter("overviewShowGrid"),
        setOverviewShowMarkers: setter("overviewShowMarkers"),
        setOverviewOpenOnLoad: setter("overviewOpenOnLoad"),
        setContoursEnabled: setter("contoursEnabled"),
        setContourInterval: setter("contourInterval"),

        // Markers
        setDefaultMarkerType: setter("defaultMarkerType"),
        setDefaultDepthPoleColor: setter("defaultDepthPoleColor"),
        setShowMarkerLabels: setter("showMarkerLabels"),
        setVisibleMarkerTypes: setter("visibleMarkerTypes"),
        setPrivateMarkers: setter("privateMarkers"),
        setMarkerClusterThreshold: setter("markerClusterThreshold"),

        // Tidal
        setAutoLoadTidal: setter("autoLoadTidal"),
        setTripMinDurationH: setter("tripMinDurationH"),
        setBoatGoWindKn: setter("boatGoWindKn"),
        setBoatGoWaveM: setter("boatGoWaveM"),
        setBoatNoGoWindKn: setter("boatNoGoWindKn"),
        setBoatNoGoWaveM: setter("boatNoGoWaveM"),
        setDefaultTidalDepthLayer: setter("defaultTidalDepthLayer"),
        setCurrentArrowDensity: setter("currentArrowDensity"),
        setLayerArrowDensity: (layer, density) =>
          set((state) => ({
            layerArrowDensity: { ...state.layerArrowDensity, [layer]: density },
          })),
        setWindOverlayStyle: setter("windOverlayStyle"),
        setTideOverlayStyle: setter("tideOverlayStyle"),
        setCurrentOverlayStyle: setter("currentOverlayStyle"),

        // Currents (Task #136)
        setCurrentsEnabled: setter("currentsEnabled"),
        setCurrentsSource: setter("currentsSource"),
        setCurrentsManualDirectionDeg: setter("currentsManualDirectionDeg"),
        setCurrentsManualSpeedKt: setter("currentsManualSpeedKt"),
        setCurrentsTidePhase: setter("currentsTidePhase"),
        setCurrentsAutoAdvance: setter("currentsAutoAdvance"),
        setCurrentsShowParticles: setter("currentsShowParticles"),
        setCurrentsShowArrows: setter("currentsShowArrows"),
        setCurrentsShowStreamlines: setter("currentsShowStreamlines"),

        // Habitat
        setAutoShowZoneOverlay: setter("autoShowZoneOverlay"),
        setDefaultHabitatSpecies: setter("defaultHabitatSpecies"),
        setHabitatOverlayIntensity: setter("habitatOverlayIntensity"),
        setHabitatOverlayColor: setter("habitatOverlayColor"),

        // GPS / Trail
        setAutoStartTrailRecording: setter("autoStartTrailRecording"),
        setDefaultTrailColor: setter("defaultTrailColor"),
        setGpsRecordingInterval: setter("gpsRecordingInterval"),
        setTrailRetention: setter("trailRetention"),
        setFollowResumeDelaySec: setter("followResumeDelaySec"),

        // Data
        setDefaultRegion: setter("defaultRegion"),
        setAutoLoadLastDataset: setter("autoLoadLastDataset"),
        setDefaultMapLoad: setter("defaultMapLoad"),
        setCoordSearchRadius: setter("coordSearchRadius"),
        setCoordSearchRadiusUnit: setter("coordSearchRadiusUnit"),

        // Accessibility
        setReducedMotion: setter("reducedMotion"),
        setColorBlindSafePalette: setter("colorBlindSafePalette"),
        setLargeHudText: setter("largeHudText"),
        setHighContrastHud: setter("highContrastHud"),
        setBrightDaylight: setter("brightDaylight"),
        setColormapUserSet: setter("colormapUserSet"),
        setGlobalFontSize: setter("globalFontSize"),

        // Account
        setTelemetryOptIn: setter("telemetryOptIn"),
        setLlmDisclosureAcknowledged: setter("llmDisclosureAcknowledged"),

        // Onboarding
        setHasSeenOnboarding: setter("hasSeenOnboarding"),
        setHasSeenToolbarRelocationHint: setter("hasSeenToolbarRelocationHint"),

        // Last session
        setLastSession: setter("lastSession"),

        // Page-level
        setShowAdvancedEverywhere: setter("showAdvancedEverywhere"),

        // Dataset home positions
        setDatasetHome: (datasetId, pos) =>
          set((state) => ({
            datasetHomePositions: { ...state.datasetHomePositions, [datasetId]: pos },
          })),
        clearDatasetHome: (datasetId) =>
          set((state) => {
            const next = { ...state.datasetHomePositions };
            delete next[datasetId];
            return { datasetHomePositions: next };
          }),

        // Bookmarks
        addBookmark: (datasetId, bookmark) =>
          set((state) => {
            const existing = state.bookmarks[datasetId] ?? [];
            const id = `bk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            return {
              bookmarks: {
                ...state.bookmarks,
                [datasetId]: [...existing, { id, ...bookmark }],
              },
            };
          }),
        renameBookmark: (datasetId, bookmarkId, name) =>
          set((state) => {
            const existing = state.bookmarks[datasetId] ?? [];
            return {
              bookmarks: {
                ...state.bookmarks,
                [datasetId]: existing.map((b) =>
                  b.id === bookmarkId ? { ...b, name } : b,
                ),
              },
            };
          }),
        deleteBookmark: (datasetId, bookmarkId) =>
          set((state) => {
            const existing = state.bookmarks[datasetId] ?? [];
            return {
              bookmarks: {
                ...state.bookmarks,
                [datasetId]: existing.filter((b) => b.id !== bookmarkId),
              },
            };
          }),
        reorderBookmarks: (datasetId, orderedBookmarks) =>
          set((state) => ({
            bookmarks: {
              ...state.bookmarks,
              [datasetId]: orderedBookmarks,
            },
          })),

        setWaterType: setter("waterType"),

        // Overlay & UI toggles
        setWeatherStationsActive: setter("weatherStationsActive"),
        setRawsOverlayActive: setter("rawsOverlayActive"),
        setWindOverlayActive: setter("windOverlayActive"),
        setTideOverlayActive: setter("tideOverlayActive"),
        setCurrentOverlayActive: setter("currentOverlayActive"),
        setCurrentDepthLayers: setter("currentDepthLayers"),
        setSidePaneCollapsed: setter("sidePaneCollapsed"),
        setZonePaintBrushRadius: (v) => set({ zonePaintBrushRadius: Math.max(1, Math.min(20, Math.round(v))) }),
        setZoneOverlayEnabled: setter("zoneOverlayEnabled"),
        setZonePaintMode: setter("zonePaintMode"),
        setZonePaintSlot: setter("zonePaintSlot"),
        setSubstrateColorMode: setter("substrateColorMode"),
        setHiddenSubstrateClasses: setter("hiddenSubstrateClasses"),
        setIntertidalHotspotsEnabled: setter("intertidalHotspotsEnabled"),
        setIntertidalScoreMode: setter("intertidalScoreMode"),
        setIntertidalMhwOverrideFt: (v) =>
          set({ intertidalMhwOverrideFt: v === null || !Number.isFinite(v) ? null : v }),
        setIntertidalMhhwOverrideFt: (v) =>
          set({ intertidalMhhwOverrideFt: v === null || !Number.isFinite(v) ? null : v }),
        setEfhOverlayEnabled: setter("efhOverlayEnabled"),
        setHiddenEfhSpecies: setter("hiddenEfhSpecies"),
        setHyd93ActiveFeatureCodes: setter("hyd93ActiveFeatureCodes"),
        setHyd93FeaturesEnabled: setter("hyd93FeaturesEnabled"),

        setSidebarMode: setter("sidebarMode"),

        // Manual conditions
        setDatasetManualConditions: (datasetId, conditions) => {
          _manualConditionsLastWriteMs = Date.now();
          set((state) => ({
            datasetManualConditions: { ...state.datasetManualConditions, [datasetId]: conditions },
          }));
        },
        clearDatasetManualConditions: (datasetId) =>
          set((state) => {
            const nextConditions = { ...state.datasetManualConditions };
            delete nextConditions[datasetId];
            const nextActiveSource = { ...state.manualConditionsActiveSource };
            delete nextActiveSource[datasetId];
            return {
              datasetManualConditions: nextConditions,
              manualConditionsActiveSource: nextActiveSource,
            };
          }),
        setManualConditionsActiveSource: (datasetId, source) => {
          _manualConditionsLastWriteMs = Date.now();
          set((state) => ({
            manualConditionsActiveSource: { ...state.manualConditionsActiveSource, [datasetId]: source },
          }));
        },

        // Shortcuts
        setKeyBinding: (action, code) =>
          set((state) => ({
            keyBindings: { ...state.keyBindings, [action]: code },
          })),
        resetKeyBinding: (action) =>
          set((state) => ({
            keyBindings: {
              ...state.keyBindings,
              [action]: DEFAULT_KEY_BINDINGS[action],
            },
          })),
        resetAllKeyBindings: () => set({ keyBindings: { ...DEFAULT_KEY_BINDINGS } }),
        setCrosshairMenuGamepadButton: setter("crosshairMenuGamepadButton"),

        hydrateFromServer: (partial) =>
          set((state) => {
            const partialRec = partial as Record<string, unknown>;
            const serverUpdatedAt =
              typeof partialRec.__updatedAt === "string"
                ? (partialRec.__updatedAt as string)
                : undefined;

            // Recency check: only apply server values when the server has
            // moved forward since the last time we synced. If we've never
            // synced (`lastSyncedAt == null`) the server is authoritative
            // for any field we haven't locally edited.
            const lastSyncedAt = state.lastSyncedAt;
            const serverIsNewer =
              !lastSyncedAt ||
              (serverUpdatedAt !== undefined && serverUpdatedAt > lastSyncedAt);

            if (!serverIsNewer) {
              // Server hasn't changed since our last sync. Just refresh the
              // displayed "Last synced" timestamp if the server reported one.
              return {
                lastSyncedAt: serverUpdatedAt ?? state.lastSyncedAt,
              };
            }

            // Server is newer than what we last saw — server wins. Apply every
            // known data field from the payload, overwriting any local value
            // (including unsynced local edits). `syncedSnapshot` also advances
            // to the new server values so dirty-tracking goes clean.
            const snap = (state.syncedSnapshot ?? {}) as Record<string, unknown>;
            const dataKeySet = new Set<string>(DATA_KEYS as string[]);
            const applied: Record<string, unknown> = {};
            const nextSnap: Record<string, unknown> = { ...snap };

            for (const [k, serverVal] of Object.entries(partialRec)) {
              if (k === "__updatedAt") continue;
              if (!dataKeySet.has(k)) continue;
              // Sync-race guard: skip manual-conditions keys that were written
              // locally more recently than the server payload was authored.
              // A lake-switch can trigger a concurrent PUT that the server
              // processes after a freshly entered value — keeping the local
              // value here prevents that stale server response from reverting
              // the user's input.
              if (
                (k === "datasetManualConditions" || k === "manualConditionsActiveSource") &&
                _manualConditionsLastWriteMs > 0 &&
                Date.now() - _manualConditionsLastWriteMs < MANUAL_CONDITIONS_GUARD_MS &&
                (serverUpdatedAt === undefined ||
                  new Date(_manualConditionsLastWriteMs).toISOString() > serverUpdatedAt)
              ) {
                continue;
              }
              // Guard the high-risk union/range fields so a corrupted server
              // value cannot silently overwrite a valid local value.
              let safeVal: unknown = serverVal;
              if (k === "joystickMode") safeVal = toValidJoystickMode(serverVal);
              else if (k === "colormapTheme") safeVal = toValidColormapTheme(serverVal);
              else if (k === "waterType") safeVal = toValidWaterType(serverVal);
              else if (k === "defaultSpeedTier") safeVal = toValidDefaultSpeedTier(serverVal);
              else if (k === "terrainExaggeration") safeVal = clampTerrainExaggeration(serverVal);
              applied[k] = safeVal;
              nextSnap[k] = safeVal;
            }

            // Apply the server's panel collapse map to panelCollapseStore.
            // Server keys win; keys absent from the server map keep their
            // local localStorage value (additive merge, never destructive).
            if (
              typeof partialRec.panelCollapse === "object" &&
              partialRec.panelCollapse !== null
            ) {
              const serverCollapse = partialRec.panelCollapse as Record<string, boolean>;
              const { collapsed, setCollapsed } = usePanelCollapseStore.getState();
              // Start from local state so localStorage-only keys are preserved.
              const merged = { ...collapsed, ...serverCollapse };
              for (const [panelId, value] of Object.entries(merged)) {
                if (collapsed[panelId as PanelId] !== value) {
                  setCollapsed(panelId as PanelId, value);
                }
              }
            }

            return {
              ...(applied as Partial<SettingsState>),
              syncedSnapshot: nextSnap as Partial<SettingsState>,
              lastSyncedAt: serverUpdatedAt ?? new Date().toISOString(),
            };
          }),

        resetSection: (section) => {
          const keys = SECTION_KEYS[section];
          const patch: Partial<SettingsState> = {};
          for (const k of keys) {
            (patch as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k];
          }
          set(patch);
        },

        resetAll: () => {
          const current = get();
          set({
            ...DEFAULT_SETTINGS,
            // Preserve per-dataset home positions and bookmarks across "Reset all"
            datasetHomePositions: current.datasetHomePositions,
            bookmarks: current.bookmarks,
          });
        },

        clearForSignOut: () => {
          // Full reset — no preservation of per-user data — to prevent cross-account
          // state bleed when a different user signs in on the same device.
          set({ ...DEFAULT_SETTINGS, syncedSnapshot: undefined, lastSyncedAt: null });
          // Remove the persisted localStorage entry so the next user starts clean.
          try {
            localStorage.removeItem("bathyscan:settings");
          } catch {
            /* ignore — storage may be unavailable in some environments */
          }
        },

        markAllSaved: (lastSyncedAt) =>
          set((state) => ({
            syncedSnapshot: snapshotData(state),
            lastSyncedAt:
              lastSyncedAt === undefined
                ? new Date().toISOString()
                : lastSyncedAt,
          })),
      } satisfies SettingsStore;
      // ↑ DRIFT GUARD: `satisfies` performs excess-property checking on the
      // object literal, so TypeScript will error here if any action is
      // implemented without a matching declaration in SettingsActions (or
      // SettingsState). Without this, function return values are only checked
      // structurally and extra keys are silently ignored.
    },
    {
      name: "bathyscan:settings",
      version: SETTINGS_SCHEMA_VERSION,
      migrate: (persisted, version) => {
        // For pre-v2 stored states, merge with defaults so newly added
        // fields are present without losing user preferences.
        if (!persisted || typeof persisted !== "object") return DEFAULT_SETTINGS;
        if (version < SETTINGS_SCHEMA_VERSION) {
          const prev = persisted as Partial<SettingsState> & {
            conditionsOverlayStyle?: ConditionsOverlayStyle;
            showSpeedIndicator?: boolean;
            crosshairMenuKey?: string;
            defaultNavMode?: string;
          };
          // v5 → v6: split the single `conditionsOverlayStyle` into three
          // independent per-overlay keys, preserving the user's previous
          // choice across all three so the visual stays identical.
          const legacyStyle = prev.conditionsOverlayStyle;
          const split: Partial<SettingsState> =
            legacyStyle === "arrows" || legacyStyle === "particles"
              ? {
                  windOverlayStyle: legacyStyle,
                  tideOverlayStyle: legacyStyle,
                  currentOverlayStyle: legacyStyle,
                }
              : {};
          // v8 → v9: collapse the single remappable `crosshairMenuKey`
          // field into the new `keyBindings` action-id map so every
          // shortcut is individually remappable.
          const mergedBindings = resolveKeyBindings({
            ...(prev.keyBindings ?? {}),
            ...(typeof prev.crosshairMenuKey === "string"
              ? { crosshairMenu: prev.crosshairMenuKey }
              : {}),
          });
          // Drop obsolete keys so they don't linger in persisted state.
          // v7 → v8: `showSpeedIndicator` was removed along with the HUD
          // SPD panel.
          // v9 → v10: `defaultNavMode` was retired — orbit is now a
          // transient right-drag gesture rather than a persistent mode.
          const {
            conditionsOverlayStyle: _drop,
            showSpeedIndicator: _dropSpd,
            crosshairMenuKey: _dropKey,
            defaultNavMode: _dropNavMode,
            ...rest
          } = prev;
          void _drop;
          void _dropSpd;
          void _dropKey;
          void _dropNavMode;
          // v12 → v13: `cameraSpawnBehaviour` default changed from
          // "deepest" to "last". Migrate users who still have the old
          // default ("deepest") so they benefit from resume-last-session
          // automatically. Users who explicitly changed to "home" or
          // any other value are left untouched.
          const migratedSpawnBehaviour =
            rest.cameraSpawnBehaviour === "deepest"
              ? "last"
              : (rest.cameraSpawnBehaviour ?? "last");
          // v13 → v14: inject contour defaults for existing stored settings.
          const migratedContours: Partial<SettingsState> = {};
          if (rest.contoursEnabled === undefined) {
            migratedContours.contoursEnabled = DEFAULT_SETTINGS.contoursEnabled;
          }
          if (rest.contourInterval === undefined) {
            // Default is unit-aware: 10 m (metric), 50 ft (imperial), 10 fathoms (nautical).
            const activeUnits = rest.units ?? "metric";
            migratedContours.contourInterval =
              activeUnits === "metric" ? 10 : activeUnits === "nautical" ? 10 : 50;
          }
          // v14 → v15: inject overlay toggle defaults for existing stored settings.
          // These fields were previously held only in uiStore / localStorage; they
          // are now persisted in settingsStore so they sync cross-device. Any field
          // already present in the stored state is preserved; absent fields get the
          // sensible default so existing users are not broken.
          const migratedOverlays: Partial<SettingsState> = {};
          const overlayDefaults: (keyof SettingsState)[] = [
            "weatherStationsActive", "rawsOverlayActive", "windOverlayActive",
            "tideOverlayActive", "currentOverlayActive", "currentDepthLayers",
            "sidePaneCollapsed", "zonePaintBrushRadius", "zoneOverlayEnabled",
            "zonePaintMode", "zonePaintSlot", "substrateColorMode",
            "hiddenSubstrateClasses", "intertidalHotspotsEnabled",
            "intertidalScoreMode", "efhOverlayEnabled", "hiddenEfhSpecies",
          ];
          for (const key of overlayDefaults) {
            if ((rest as Record<string, unknown>)[key] === undefined) {
              (migratedOverlays as Record<string, unknown>)[key] = DEFAULT_SETTINGS[key];
            }
          }
          // v15 → v16: replace binary largeHudText with 6-level globalFontSize.
          // Users who had largeHudText: true → "large"; everyone else → "medium".
          const migratedFontSize: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).globalFontSize === undefined) {
            migratedFontSize.globalFontSize = (rest as Record<string, unknown>).largeHudText === true
              ? "large"
              : "medium";
          }
          // v16 → v17: inject hyd93ActiveFeatureCodes default for existing stored settings.
          // Previously transient (reset each session); now persisted so power users'
          // filter choices survive page reloads.
          const migratedHyd93: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).hyd93ActiveFeatureCodes === undefined) {
            migratedHyd93.hyd93ActiveFeatureCodes = DEFAULT_SETTINGS.hyd93ActiveFeatureCodes;
          }
          // v17 → v18: inject hyd93FeaturesEnabled default for existing stored settings.
          // The master HYD93 overlay toggle was previously intentionally transient
          // (reset to false each session); now persisted so power users who always
          // want the overlay on keep it on between sessions.
          if ((rest as Record<string, unknown>).hyd93FeaturesEnabled === undefined) {
            migratedHyd93.hyd93FeaturesEnabled = DEFAULT_SETTINGS.hyd93FeaturesEnabled;
          }
          // v19 → v20: inject showWaterTempLayer default (false — opt-in layer).
          const migratedWaterTemp: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).showWaterTempLayer === undefined) {
            migratedWaterTemp.showWaterTempLayer = DEFAULT_SETTINGS.showWaterTempLayer;
          }
          // v20 → v21: inject timeline scrubber restore fields.
          // Both fields default to null so existing users start fresh.
          const migratedTimeline: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).timelineCurrentTime === undefined) {
            migratedTimeline.timelineCurrentTime = DEFAULT_SETTINGS.timelineCurrentTime;
          }
          if ((rest as Record<string, unknown>).timelineRange === undefined) {
            migratedTimeline.timelineRange = DEFAULT_SETTINGS.timelineRange;
          }
          // v21 → v22: inject sidebarMode default ('explore') for existing users.
          const migratedSidebarMode: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).sidebarMode === undefined) {
            migratedSidebarMode.sidebarMode = DEFAULT_SETTINGS.sidebarMode;
          }
          // v22 → v23: inject showHealthBadge default (true) for existing users.
          const migratedHealthBadge: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).showHealthBadge === undefined) {
            migratedHealthBadge.showHealthBadge = DEFAULT_SETTINGS.showHealthBadge;
          }
          // v24 → v25: inject tripMinDurationH default (0 = show all windows).
          const migratedTripWindow: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).tripMinDurationH === undefined) {
            migratedTripWindow.tripMinDurationH = DEFAULT_SETTINGS.tripMinDurationH;
          }
          // v24 → v25: inject manual coordinate-search radius defaults.
          const migratedCoordSearch: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).coordSearchRadius === undefined) {
            migratedCoordSearch.coordSearchRadius = DEFAULT_SETTINGS.coordSearchRadius;
          }
          if ((rest as Record<string, unknown>).coordSearchRadiusUnit === undefined) {
            migratedCoordSearch.coordSearchRadiusUnit = DEFAULT_SETTINGS.coordSearchRadiusUnit;
          }
          // v25 → v26: inject followResumeDelaySec default (20s inactivity
          // before Follow Me auto-resumes after a manual camera interaction).
          const migratedFollowResume: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).followResumeDelaySec === undefined) {
            migratedFollowResume.followResumeDelaySec = DEFAULT_SETTINGS.followResumeDelaySec;
          }
          // v26 → v27: inject per-boat condition threshold defaults so existing
          // users get the same fixed thresholds they had before (12 kn / 0.8 m
          // for "go", 22 kn / 1.5 m for "no-go").
          const migratedBoatThresholds: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).boatGoWindKn === undefined) {
            migratedBoatThresholds.boatGoWindKn = DEFAULT_SETTINGS.boatGoWindKn;
          }
          if ((rest as Record<string, unknown>).boatGoWaveM === undefined) {
            migratedBoatThresholds.boatGoWaveM = DEFAULT_SETTINGS.boatGoWaveM;
          }
          if ((rest as Record<string, unknown>).boatNoGoWindKn === undefined) {
            migratedBoatThresholds.boatNoGoWindKn = DEFAULT_SETTINGS.boatNoGoWindKn;
          }
          if ((rest as Record<string, unknown>).boatNoGoWaveM === undefined) {
            migratedBoatThresholds.boatNoGoWaveM = DEFAULT_SETTINGS.boatNoGoWaveM;
          }
          // v27 → v28: inject saveFolderExpanded default for My Saves folder
          // organisation (new feature — existing users start with all roots visible).
          const migratedSaveFolderExpanded: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).saveFolderExpanded === undefined) {
            migratedSaveFolderExpanded.saveFolderExpanded = DEFAULT_SETTINGS.saveFolderExpanded;
          }
          // v28 → v29: inject nodataColor default so existing users see the same
          // light-gray nodata color they had before (now user-configurable).
          const migratedNodataColor: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).nodataColor === undefined) {
            migratedNodataColor.nodataColor = DEFAULT_SETTINGS.nodataColor;
          }
          // v29 → v30: inject datasetManualConditions and manualConditionsActiveSource
          // defaults so existing users start with empty records (no manual conditions set).
          const migratedManualConditions: Partial<SettingsState> = {};
          if ((rest as Record<string, unknown>).datasetManualConditions === undefined) {
            migratedManualConditions.datasetManualConditions = DEFAULT_SETTINGS.datasetManualConditions;
          }
          if ((rest as Record<string, unknown>).manualConditionsActiveSource === undefined) {
            migratedManualConditions.manualConditionsActiveSource = DEFAULT_SETTINGS.manualConditionsActiveSource;
          }
          const mergedState: SettingsState = {
            ...DEFAULT_SETTINGS,
            ...rest,
            ...split,
            ...migratedContours,
            ...migratedOverlays,
            ...migratedFontSize,
            ...migratedHyd93,
            ...migratedWaterTemp,
            ...migratedTimeline,
            ...migratedSidebarMode,
            ...migratedHealthBadge,
            ...migratedTripWindow,
            ...migratedCoordSearch,
            ...migratedFollowResume,
            ...migratedBoatThresholds,
            ...migratedSaveFolderExpanded,
            ...migratedNodataColor,
            ...migratedManualConditions,
            keyBindings: mergedBindings,
            cameraSpawnBehaviour: migratedSpawnBehaviour,
            schemaVersion: SETTINGS_SCHEMA_VERSION,
          };
          // Guard high-risk union fields against corrupted or future-schema values
          // that slipped in before migration ran (e.g. from a cross-device sync
          // or a manually edited localStorage entry).
          mergedState.joystickMode = toValidJoystickMode(mergedState.joystickMode);
          // v23 → v24: terrainExaggeration is now normalized to the slider's
          // [1, 20] range (old default was 0.8, below the supported minimum).
          mergedState.terrainExaggeration = clampTerrainExaggeration(
            mergedState.terrainExaggeration,
          );
          mergedState.colormapTheme = toValidColormapTheme(mergedState.colormapTheme);
          mergedState.waterType = toValidWaterType(mergedState.waterType);
          mergedState.defaultSpeedTier = toValidDefaultSpeedTier(mergedState.defaultSpeedTier);
          return mergedState;
        }
        // Even at the current version, ensure newly added actions get
        // their defaults filled in if the persisted map is missing them.
        // Also guard union fields so a corrupted or manually edited stored
        // entry doesn't silently produce an unrecognised value.
        const cur = persisted as SettingsState;
        return {
          ...cur,
          keyBindings: resolveKeyBindings(cur.keyBindings),
          joystickMode: toValidJoystickMode(cur.joystickMode),
          colormapTheme: toValidColormapTheme(cur.colormapTheme),
          waterType: toValidWaterType(cur.waterType),
          defaultSpeedTier: toValidDefaultSpeedTier(cur.defaultSpeedTier),
          terrainExaggeration: clampTerrainExaggeration(cur.terrainExaggeration),
        };
      },
      // After localStorage rehydrates, treat the persisted values as the
      // "saved" baseline so per-section dirty tracking starts clean.
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.syncedSnapshot = snapshotData(state);
          // Preserved as-is from persisted state if present; defaults to null
          // so the Account tab can show "Never" until the first sync lands.
          if (state.lastSyncedAt === undefined) state.lastSyncedAt = null;
        }
      },
    },
  ),
);


/**
 * Returns true when any setting in the given section has changed since the
 * last successful save (server PUT for signed-in users, or localStorage
 * rehydration for signed-out users).
 */
export function useSectionDirty(section: SettingsSection): boolean {
  return useSettingsStore((s) => {
    const snap = s.syncedSnapshot ?? {};
    for (const k of SECTION_KEYS[section]) {
      if (!valuesEqual(
        (s as unknown as Record<string, unknown>)[k],
        (snap as Record<string, unknown>)[k],
      )) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Returns true when any section has unsaved changes since the last sync.
 * Used by the Settings page to warn the user before navigating away.
 */
export function useAnySectionDirty(): boolean {
  return useSettingsStore((s) => {
    const snap = s.syncedSnapshot ?? {};
    for (const section of Object.keys(SECTION_KEYS) as SettingsSection[]) {
      for (const k of SECTION_KEYS[section]) {
        if (!valuesEqual(
          (s as unknown as Record<string, unknown>)[k],
          (snap as Record<string, unknown>)[k],
        )) {
          return true;
        }
      }
    }
    return false;
  });
}

/** Snapshot helper exported for the Settings page's auto-sync subscriber. */
export function getDataSnapshot(): Partial<SettingsState> {
  return snapshotData(useSettingsStore.getState());
}

/**
 * Derives the effective depth colormap theme for the 3D terrain mesh.
 *
 * When Bright Daylight mode is active and the user has NOT explicitly chosen
 * a colormap (colormapUserSet === false), grayscale is returned automatically
 * because it provides the strongest depth contrast in direct sunlight.
 * Once the user makes a manual choice (colormapUserSet === true), that choice
 * is always honoured — even while Bright Daylight is on.
 *
 * Exported as a pure function so it can be tested independently of the
 * Three.js renderer and React component lifecycle in TerrainMesh.
 */
export function deriveEffectiveColormapTheme(
  brightDaylight: boolean,
  colormapUserSet: boolean,
  colormapTheme: ColormapTheme,
): ColormapTheme {
  return brightDaylight && !colormapUserSet ? "grayscale" : colormapTheme;
}
