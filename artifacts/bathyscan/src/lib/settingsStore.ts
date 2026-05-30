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
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_KEY_BINDINGS,
  resolveKeyBindings,
  type ShortcutActionId,
} from "./keyBindings";
import { usePanelCollapseStore, type PanelId } from "./panelCollapseStore";

export const SETTINGS_SCHEMA_VERSION = 13;

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
export type CameraSpawnBehaviour = "deepest" | "home" | "last";
export type MarkerType = "fish" | "shipwreck" | "coral" | "vent" | "custom" | "depth_pole" | "log" | "vegetation" | "sample" | "bass" | "trout" | "pike" | "walleye" | "crayfish";
export type JoystickMode = "auto" | "always" | "off";

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
  /** Render above-water landmass meshing from the terrain topography array (default off). */
  showLandmass: boolean;
  /** How the landmass is coloured: realistic elevation ramp or a single flat neutral colour. */
  landmassStyle: LandmassStyle;

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

  // ── Markers ──────────────────────────────────────────────────────────
  defaultMarkerType: MarkerType;
  defaultDepthPoleColor: string;
  showMarkerLabels: boolean;
  visibleMarkerTypes: MarkerType[];
  privateMarkers: boolean;
  markerClusterThreshold: number;

  // ── Tidal Defaults ───────────────────────────────────────────────────
  autoLoadTidal: boolean;
  defaultTidalDepthLayer: TidalDepthLayer;
  currentArrowDensity: CurrentArrowDensity;
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
  /** Habitat suitability overlay blend strength (0=invisible, 1=fully opaque amber). */
  habitatOverlayIntensity: number;

  // ── GPS & Trail ──────────────────────────────────────────────────────
  autoStartTrailRecording: boolean;
  defaultTrailColor: string;
  gpsRecordingInterval: number;
  trailRetention: TrailRetention;

  // ── Data & Storage ───────────────────────────────────────────────────
  defaultRegion: string;
  autoLoadLastDataset: boolean;
  /**
   * Dataset to load automatically on every app start.
   * `null` means "no preference — use the built-in default".
   * Persisted and synced cross-device like all other settings.
   */
  defaultMapLoad: DefaultMapLoad | null;

  // ── Accessibility ────────────────────────────────────────────────────
  reducedMotion: boolean;
  colorBlindSafePalette: boolean;
  largeHudText: boolean;
  highContrastHud: boolean;

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

  /** Per-dataset saved camera spawn positions (set via "Set as home" context menu). */
  datasetHomePositions: Record<string, DatasetHomePosition>;

  /** Per-dataset saved camera bookmarks, keyed by dataset id. */
  bookmarks: Record<string, CameraBookmark[]>;

  /** Expand/collapse state for dataset library folders, keyed by folder id. */
  datasetFolderExpanded: Record<string, boolean>;

  // ── Environment ───────────────────────────────────────────────────────
  waterType: WaterType;

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
  setAmbientLightIntensity: (v: number) => void;
  setDirectionalLightIntensity: (v: number) => void;
  setLampIntensity: (v: number) => void;
  setLampRange: (v: number) => void;
  setAntialiasing: (v: boolean) => void;
  setTextureQuality: (v: TextureQuality) => void;
  setColormapTheme: (v: ColormapTheme) => void;
  setSmoothTerrainSpikes: (v: boolean) => void;
  setShowWaterSurface: (v: boolean) => void;
  setShowLandmass: (v: boolean) => void;
  setLandmassStyle: (v: LandmassStyle) => void;

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

  // Markers
  setDefaultMarkerType: (v: MarkerType) => void;
  setDefaultDepthPoleColor: (v: string) => void;
  setShowMarkerLabels: (v: boolean) => void;
  setVisibleMarkerTypes: (v: MarkerType[]) => void;
  setPrivateMarkers: (v: boolean) => void;
  setMarkerClusterThreshold: (v: number) => void;

  // Tidal
  setAutoLoadTidal: (v: boolean) => void;
  setDefaultTidalDepthLayer: (v: TidalDepthLayer) => void;
  setCurrentArrowDensity: (v: CurrentArrowDensity) => void;
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

  // GPS / Trail
  setAutoStartTrailRecording: (v: boolean) => void;
  setDefaultTrailColor: (v: string) => void;
  setGpsRecordingInterval: (ms: number) => void;
  setTrailRetention: (v: TrailRetention) => void;

  // Data
  setDefaultRegion: (v: string) => void;
  setAutoLoadLastDataset: (v: boolean) => void;
  setDefaultMapLoad: (v: DefaultMapLoad | null) => void;

  // Accessibility
  setReducedMotion: (v: boolean) => void;
  setColorBlindSafePalette: (v: boolean) => void;
  setLargeHudText: (v: boolean) => void;
  setHighContrastHud: (v: boolean) => void;

  // Account
  setTelemetryOptIn: (v: boolean) => void;
  setLlmDisclosureAcknowledged: (v: boolean) => void;

  // Onboarding
  setHasSeenOnboarding: (v: boolean) => void;

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

  setWaterType: (v: WaterType) => void;

  // Shortcuts
  setKeyBinding: (action: ShortcutActionId, code: string) => void;
  resetKeyBinding: (action: ShortcutActionId) => void;
  resetAllKeyBindings: () => void;
  setCrosshairMenuGamepadButton: (v: number | null) => void;

  /** Hydrate the entire settings state from the server response. */
  hydrateFromServer: (partial: Partial<SettingsState>) => void;

  /** Reset every setting in the given section back to defaults. */
  resetSection: (section: SettingsSection) => void;

  /** Reset every setting back to defaults (preserves datasetHomePositions). */
  resetAll: () => void;

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
  terrainExaggeration: 0.8,
  enableMarineSnow: true,
  particleDensity: "sparse",
  enableCaustics: false,
  fogDensity: 0.012,
  fogColor: "#020818",
  ambientLightIntensity: 0.05,
  directionalLightIntensity: 0.35,
  lampIntensity: 2,
  lampRange: 40,
  antialiasing: true,
  textureQuality: "high",
  colormapTheme: "ocean",
  smoothTerrainSpikes: true,
  showWaterSurface: true,
  showLandmass: false,
  landmassStyle: "realistic",

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

  // Markers
  defaultMarkerType: "fish",
  defaultDepthPoleColor: "#22d3ee",
  showMarkerLabels: true,
  visibleMarkerTypes: ["fish", "shipwreck", "coral", "vent", "custom", "depth_pole"],
  privateMarkers: false,
  markerClusterThreshold: 25,

  // Tidal
  autoLoadTidal: true,
  defaultTidalDepthLayer: "surface",
  currentArrowDensity: "normal",
  windOverlayStyle: "arrows",
  tideOverlayStyle: "arrows",
  currentOverlayStyle: "arrows",

  // Currents (Task #136)
  currentsEnabled: false,
  currentsSource: "manual",
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

  // GPS / Trail
  autoStartTrailRecording: false,
  defaultTrailColor: "#ff6600",
  gpsRecordingInterval: 1000,
  trailRetention: "30",

  // Data
  defaultRegion: "",
  autoLoadLastDataset: true,
  defaultMapLoad: null,

  // Accessibility
  reducedMotion: false,
  colorBlindSafePalette: false,
  largeHudText: false,
  highContrastHud: false,

  // Account
  telemetryOptIn: false,
  llmDisclosureAcknowledged: false,

  // Onboarding
  hasSeenOnboarding: false,

  datasetHomePositions: {},
  datasetFolderExpanded: {},
  bookmarks: {},

  waterType: "saltwater",

  // Shortcuts
  keyBindings: { ...DEFAULT_KEY_BINDINGS },
  crosshairMenuGamepadButton: DEFAULT_CROSSHAIR_MENU_GAMEPAD_BUTTON,

  lastSyncedAt: null,
};

export const SECTION_KEYS: Record<SettingsSection, (keyof SettingsState)[]> = {
  camera: [
    "defaultSpeedTier", "mouseSensitivity", "invertMouseY",
    "mouseZoomSensitivity", "touchpadZoomSensitivity", "pinchZoomSensitivity",
    "joystickMode", "showJoystickInOrbit", "fieldOfView", "renderDistance", "cameraSpawnBehaviour",
  ],
  visuals: [
    "qualityPreset", "terrainExaggeration", "enableMarineSnow", "particleDensity",
    "enableCaustics", "fogDensity", "fogColor", "ambientLightIntensity",
    "directionalLightIntensity", "lampIntensity", "lampRange", "antialiasing",
    "textureQuality", "colormapTheme", "smoothTerrainSpikes",
    "showWaterSurface", "showLandmass", "landmassStyle",
  ],
  hud: [
    "hudOpacity", "showCrosshairGps", "showCameraPosition",
    "showHeading", "showDepthLegend", "showDepthScaleBar", "showCompassMinimap",
    "showControlsLegend", "showTidePanel", "showHabitatPanel", "showDatasetPanel",
    "showQueryPanel", "showUiTooltips", "timeFormat", "coordinateFormat", "depthUnit", "units",
    "temperatureUnit",
  ],
  overview: [
    "overviewDefaultZoom", "overviewShowGrid", "overviewShowMarkers", "overviewOpenOnLoad",
  ],
  markers: [
    "defaultMarkerType", "defaultDepthPoleColor", "showMarkerLabels",
    "visibleMarkerTypes", "privateMarkers", "markerClusterThreshold",
  ],
  tidal: [
    "autoLoadTidal", "defaultTidalDepthLayer", "currentArrowDensity",
    "windOverlayStyle", "tideOverlayStyle", "currentOverlayStyle",
  ],
  currents: [
    "currentsEnabled", "currentsSource", "currentsManualDirectionDeg",
    "currentsManualSpeedKt", "currentsTidePhase", "currentsAutoAdvance",
    "currentsShowParticles", "currentsShowArrows", "currentsShowStreamlines",
  ],
  habitat: ["autoShowZoneOverlay", "defaultHabitatSpecies", "habitatOverlayIntensity"],
  gps: [
    "autoStartTrailRecording", "defaultTrailColor", "gpsRecordingInterval", "trailRetention",
  ],
  data: ["defaultRegion", "autoLoadLastDataset", "defaultMapLoad"],
  accessibility: [
    "reducedMotion", "colorBlindSafePalette", "largeHudText", "highContrastHud",
  ],
  account: ["telemetryOptIn", "llmDisclosureAcknowledged"],
  environment: ["waterType"],
  shortcuts: ["keyBindings", "crosshairMenuGamepadButton"],
  onboarding: ["hasSeenOnboarding"],
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
        setTerrainExaggeration: setter("terrainExaggeration"),
        setEnableMarineSnow: setter("enableMarineSnow"),
        setParticleDensity: (v) => set({ particleDensity: v, qualityPreset: "custom" }),
        setEnableCaustics: (v) => set({ enableCaustics: v, qualityPreset: "custom" }),
        setFogDensity: (v) => set({ fogDensity: v, qualityPreset: "custom" }),
        setFogColor: setter("fogColor"),
        setAmbientLightIntensity: (v) => set({ ambientLightIntensity: v, qualityPreset: "custom" }),
        setDirectionalLightIntensity: (v) => set({ directionalLightIntensity: v, qualityPreset: "custom" }),
        setLampIntensity: (v) => set({ lampIntensity: v, qualityPreset: "custom" }),
        setLampRange: (v) => set({ lampRange: v, qualityPreset: "custom" }),
        setAntialiasing: (v) => set({ antialiasing: v, qualityPreset: "custom" }),
        setTextureQuality: (v) => set({ textureQuality: v, qualityPreset: "custom" }),
        setColormapTheme: setter("colormapTheme"),
        setSmoothTerrainSpikes: setter("smoothTerrainSpikes"),
        setShowWaterSurface: setter("showWaterSurface"),
        setShowLandmass: setter("showLandmass"),
        setLandmassStyle: setter("landmassStyle"),

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

        // Markers
        setDefaultMarkerType: setter("defaultMarkerType"),
        setDefaultDepthPoleColor: setter("defaultDepthPoleColor"),
        setShowMarkerLabels: setter("showMarkerLabels"),
        setVisibleMarkerTypes: setter("visibleMarkerTypes"),
        setPrivateMarkers: setter("privateMarkers"),
        setMarkerClusterThreshold: setter("markerClusterThreshold"),

        // Tidal
        setAutoLoadTidal: setter("autoLoadTidal"),
        setDefaultTidalDepthLayer: setter("defaultTidalDepthLayer"),
        setCurrentArrowDensity: setter("currentArrowDensity"),
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

        // GPS / Trail
        setAutoStartTrailRecording: setter("autoStartTrailRecording"),
        setDefaultTrailColor: setter("defaultTrailColor"),
        setGpsRecordingInterval: setter("gpsRecordingInterval"),
        setTrailRetention: setter("trailRetention"),

        // Data
        setDefaultRegion: setter("defaultRegion"),
        setAutoLoadLastDataset: setter("autoLoadLastDataset"),
        setDefaultMapLoad: setter("defaultMapLoad"),

        // Accessibility
        setReducedMotion: setter("reducedMotion"),
        setColorBlindSafePalette: setter("colorBlindSafePalette"),
        setLargeHudText: setter("largeHudText"),
        setHighContrastHud: setter("highContrastHud"),

        // Account
        setTelemetryOptIn: setter("telemetryOptIn"),
        setLlmDisclosureAcknowledged: setter("llmDisclosureAcknowledged"),

        // Onboarding
        setHasSeenOnboarding: setter("hasSeenOnboarding"),

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

        setWaterType: setter("waterType"),

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
              applied[k] = serverVal;
              nextSnap[k] = serverVal;
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

        markAllSaved: (lastSyncedAt) =>
          set((state) => ({
            syncedSnapshot: snapshotData(state),
            lastSyncedAt:
              lastSyncedAt === undefined
                ? new Date().toISOString()
                : lastSyncedAt,
          })),
      };
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
          return {
            ...DEFAULT_SETTINGS,
            ...rest,
            ...split,
            keyBindings: mergedBindings,
            cameraSpawnBehaviour: migratedSpawnBehaviour,
            schemaVersion: SETTINGS_SCHEMA_VERSION,
          };
        }
        // Even at the current version, ensure newly added actions get
        // their defaults filled in if the persisted map is missing them.
        const cur = persisted as SettingsState;
        return {
          ...cur,
          keyBindings: resolveKeyBindings(cur.keyBindings),
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
