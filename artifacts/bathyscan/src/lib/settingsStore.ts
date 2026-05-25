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

export const SETTINGS_SCHEMA_VERSION = 3;

export interface DatasetHomePosition {
  lon: number;
  lat: number;
  depth: number;
}

export type WaterType = "saltwater" | "freshwater";
export type ParticleDensity = "off" | "sparse" | "dense";
export type TextureQuality = "off" | "low" | "high";
export type ColormapTheme = "ocean" | "thermal" | "grayscale" | "viridis" | "freshwater";
export type CoordinateFormat = "decimal" | "dms";
export type DepthUnit = "metres" | "feet";
export type UnitsSystem = "metric" | "imperial";
export type CameraSpawnBehaviour = "deepest" | "home" | "last";
export type MarkerType = "fish" | "shipwreck" | "coral" | "vent" | "custom" | "depth_pole" | "log" | "vegetation" | "sample" | "bass" | "trout" | "pike" | "walleye" | "crayfish";
export type NavMode = "fly" | "orbit";
export type JoystickMode = "auto" | "always" | "off";
export type QualityPreset = "low" | "medium" | "high" | "ultra" | "custom";
export type TimeFormat = "utc" | "local" | "12h" | "24h";
export type CurrentArrowDensity = "sparse" | "normal" | "dense";
export type TidalDepthLayer = "surface" | "mid" | "near-bottom";
export type TrailRetention = "7" | "30" | "90" | "all";

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
  | "environment";

export interface SettingsState {
  schemaVersion: number;

  // ── Page-level ───────────────────────────────────────────────────────
  showAdvancedEverywhere: boolean;

  // ── Camera & Controls ─────────────────────────────────────────────────
  defaultNavMode: NavMode;
  defaultSpeedTier: number;
  mouseSensitivity: number;
  invertMouseY: boolean;
  mouseZoomSensitivity: number;
  touchpadZoomSensitivity: number;
  pinchZoomSensitivity: number;
  joystickMode: JoystickMode;
  fieldOfView: number;
  renderDistance: number;
  cameraSpawnBehaviour: CameraSpawnBehaviour;

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

  // ── HUD & Layout ──────────────────────────────────────────────────────
  hudOpacity: number;
  showCrosshairGps: boolean;
  showCameraPosition: boolean;
  showSpeedIndicator: boolean;
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

  // ── Habitat & Zone Defaults ──────────────────────────────────────────
  autoShowZoneOverlay: boolean;
  defaultHabitatSpecies: string;

  // ── GPS & Trail ──────────────────────────────────────────────────────
  autoStartTrailRecording: boolean;
  defaultTrailColor: string;
  gpsRecordingInterval: number;
  trailRetention: TrailRetention;

  // ── Data & Storage ───────────────────────────────────────────────────
  defaultRegion: string;
  autoLoadLastDataset: boolean;

  // ── Accessibility ────────────────────────────────────────────────────
  reducedMotion: boolean;
  colorBlindSafePalette: boolean;
  largeHudText: boolean;
  highContrastHud: boolean;

  // ── Account & Privacy ────────────────────────────────────────────────
  telemetryOptIn: boolean;

  /** Per-dataset saved camera spawn positions (set via "Set as home" context menu). */
  datasetHomePositions: Record<string, DatasetHomePosition>;

  // ── Environment ───────────────────────────────────────────────────────
  waterType: WaterType;

  /**
   * Snapshot of the last "saved" data values. For signed-in users this is
   * refreshed after every successful PUT /api/settings. For signed-out users
   * (and on initial localStorage rehydration) it mirrors the persisted state.
   * Used by `useSectionDirty()` to drive per-section Save buttons.
   */
  syncedSnapshot?: Partial<SettingsState>;
}

interface SettingsActions {
  // Camera & Controls
  setDefaultNavMode: (v: NavMode) => void;
  setDefaultSpeedTier: (v: number) => void;
  setMouseSensitivity: (v: number) => void;
  setInvertMouseY: (v: boolean) => void;
  setMouseZoomSensitivity: (v: number) => void;
  setTouchpadZoomSensitivity: (v: number) => void;
  setPinchZoomSensitivity: (v: number) => void;
  setJoystickMode: (v: JoystickMode) => void;
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

  // HUD
  setHudOpacity: (v: number) => void;
  setShowCrosshairGps: (v: boolean) => void;
  setShowCameraPosition: (v: boolean) => void;
  setShowSpeedIndicator: (v: boolean) => void;
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

  // Habitat
  setAutoShowZoneOverlay: (v: boolean) => void;
  setDefaultHabitatSpecies: (v: string) => void;

  // GPS / Trail
  setAutoStartTrailRecording: (v: boolean) => void;
  setDefaultTrailColor: (v: string) => void;
  setGpsRecordingInterval: (ms: number) => void;
  setTrailRetention: (v: TrailRetention) => void;

  // Data
  setDefaultRegion: (v: string) => void;
  setAutoLoadLastDataset: (v: boolean) => void;

  // Accessibility
  setReducedMotion: (v: boolean) => void;
  setColorBlindSafePalette: (v: boolean) => void;
  setLargeHudText: (v: boolean) => void;
  setHighContrastHud: (v: boolean) => void;

  // Account
  setTelemetryOptIn: (v: boolean) => void;

  // Page-level
  setShowAdvancedEverywhere: (v: boolean) => void;

  // Dataset home positions
  setDatasetHome: (datasetId: string, pos: DatasetHomePosition) => void;
  clearDatasetHome: (datasetId: string) => void;

  setWaterType: (v: WaterType) => void;

  /** Hydrate the entire settings state from the server response. */
  hydrateFromServer: (partial: Partial<SettingsState>) => void;

  /** Reset every setting in the given section back to defaults. */
  resetSection: (section: SettingsSection) => void;

  /** Reset every setting back to defaults (preserves datasetHomePositions). */
  resetAll: () => void;

  /** Mark every section as saved (snapshot equals current data values). */
  markAllSaved: () => void;
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
  defaultNavMode: "fly",
  defaultSpeedTier: 2,
  mouseSensitivity: 1.0,
  invertMouseY: false,
  mouseZoomSensitivity: 1.0,
  touchpadZoomSensitivity: 1.0,
  pinchZoomSensitivity: 1.0,
  joystickMode: "auto",
  fieldOfView: 45,
  renderDistance: 400,
  cameraSpawnBehaviour: "deepest",

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

  // HUD
  hudOpacity: 0.75,
  showCrosshairGps: true,
  showCameraPosition: true,
  showSpeedIndicator: true,
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

  // Habitat
  autoShowZoneOverlay: false,
  defaultHabitatSpecies: "",

  // GPS / Trail
  autoStartTrailRecording: false,
  defaultTrailColor: "#ff6600",
  gpsRecordingInterval: 1000,
  trailRetention: "30",

  // Data
  defaultRegion: "mariana-trench",
  autoLoadLastDataset: true,

  // Accessibility
  reducedMotion: false,
  colorBlindSafePalette: false,
  largeHudText: false,
  highContrastHud: false,

  // Account
  telemetryOptIn: false,

  datasetHomePositions: {},

  waterType: "saltwater",
};

export const SECTION_KEYS: Record<SettingsSection, (keyof SettingsState)[]> = {
  camera: [
    "defaultNavMode", "defaultSpeedTier", "mouseSensitivity", "invertMouseY",
    "mouseZoomSensitivity", "touchpadZoomSensitivity", "pinchZoomSensitivity",
    "joystickMode", "fieldOfView", "renderDistance", "cameraSpawnBehaviour",
  ],
  visuals: [
    "qualityPreset", "terrainExaggeration", "enableMarineSnow", "particleDensity",
    "enableCaustics", "fogDensity", "fogColor", "ambientLightIntensity",
    "directionalLightIntensity", "lampIntensity", "lampRange", "antialiasing",
    "textureQuality", "colormapTheme", "smoothTerrainSpikes",
    "showWaterSurface", "showLandmass",
  ],
  hud: [
    "hudOpacity", "showCrosshairGps", "showCameraPosition", "showSpeedIndicator",
    "showHeading", "showDepthLegend", "showDepthScaleBar", "showCompassMinimap",
    "showControlsLegend", "showTidePanel", "showHabitatPanel", "showDatasetPanel",
    "showQueryPanel", "showUiTooltips", "timeFormat", "coordinateFormat", "depthUnit", "units",
  ],
  overview: [
    "overviewDefaultZoom", "overviewShowGrid", "overviewShowMarkers", "overviewOpenOnLoad",
  ],
  markers: [
    "defaultMarkerType", "defaultDepthPoleColor", "showMarkerLabels",
    "visibleMarkerTypes", "privateMarkers", "markerClusterThreshold",
  ],
  tidal: ["autoLoadTidal", "defaultTidalDepthLayer", "currentArrowDensity"],
  habitat: ["autoShowZoneOverlay", "defaultHabitatSpecies"],
  gps: [
    "autoStartTrailRecording", "defaultTrailColor", "gpsRecordingInterval", "trailRetention",
  ],
  data: ["defaultRegion", "autoLoadLastDataset"],
  accessibility: [
    "reducedMotion", "colorBlindSafePalette", "largeHudText", "highContrastHud",
  ],
  account: ["telemetryOptIn"],
  environment: ["waterType"],
};

/**
 * Keys whose values should be snapshotted/synced. Excludes function-typed
 * actions and the snapshot itself; `datasetHomePositions` is excluded too
 * since it is mutated outside the per-section editors.
 */
const DATA_KEYS: (keyof SettingsState)[] = (Object.keys(DEFAULT_SETTINGS) as (keyof SettingsState)[])
  .filter((k) => k !== "datasetHomePositions");

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

        // Camera
        setDefaultNavMode: setter("defaultNavMode"),
        setDefaultSpeedTier: setter("defaultSpeedTier"),
        setMouseSensitivity: setter("mouseSensitivity"),
        setInvertMouseY: setter("invertMouseY"),
        setMouseZoomSensitivity: setter("mouseZoomSensitivity"),
        setTouchpadZoomSensitivity: setter("touchpadZoomSensitivity"),
        setPinchZoomSensitivity: setter("pinchZoomSensitivity"),
        setJoystickMode: setter("joystickMode"),
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

        // HUD
        setHudOpacity: setter("hudOpacity"),
        setShowCrosshairGps: setter("showCrosshairGps"),
        setShowCameraPosition: setter("showCameraPosition"),
        setShowSpeedIndicator: setter("showSpeedIndicator"),
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
        setUnits: (v) => set({ units: v, depthUnit: v === "imperial" ? "feet" : "metres" }),

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

        // Habitat
        setAutoShowZoneOverlay: setter("autoShowZoneOverlay"),
        setDefaultHabitatSpecies: setter("defaultHabitatSpecies"),

        // GPS / Trail
        setAutoStartTrailRecording: setter("autoStartTrailRecording"),
        setDefaultTrailColor: setter("defaultTrailColor"),
        setGpsRecordingInterval: setter("gpsRecordingInterval"),
        setTrailRetention: setter("trailRetention"),

        // Data
        setDefaultRegion: setter("defaultRegion"),
        setAutoLoadLastDataset: setter("autoLoadLastDataset"),

        // Accessibility
        setReducedMotion: setter("reducedMotion"),
        setColorBlindSafePalette: setter("colorBlindSafePalette"),
        setLargeHudText: setter("largeHudText"),
        setHighContrastHud: setter("highContrastHud"),

        // Account
        setTelemetryOptIn: setter("telemetryOptIn"),

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

        setWaterType: setter("waterType"),

        hydrateFromServer: (partial) =>
          set((state) => {
            const merged = { ...state, ...partial };
            return { ...partial, syncedSnapshot: snapshotData(merged) };
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
            // Preserve per-dataset home positions across "Reset all"
            datasetHomePositions: current.datasetHomePositions,
          });
        },

        markAllSaved: () =>
          set((state) => ({ syncedSnapshot: snapshotData(state) })),
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
          return {
            ...DEFAULT_SETTINGS,
            ...(persisted as Partial<SettingsState>),
            schemaVersion: SETTINGS_SCHEMA_VERSION,
          };
        }
        return persisted as SettingsState;
      },
      // After localStorage rehydrates, treat the persisted values as the
      // "saved" baseline so per-section dirty tracking starts clean.
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.syncedSnapshot = snapshotData(state);
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

/** Snapshot helper exported for the Settings page's auto-sync subscriber. */
export function getDataSnapshot(): Partial<SettingsState> {
  return snapshotData(useSettingsStore.getState());
}
