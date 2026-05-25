/**
 * settingsStore — persisted user preferences for BathyScan.
 *
 * Persisted to localStorage under the key "bathyscan:settings".
 * All settings are optional and fall back to sensible defaults.
 * On sign-in, GET /api/settings hydrates this store from the server.
 * On change, a 300 ms debounced PUT /api/settings persists to the server.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface DatasetHomePosition {
  lon: number;
  lat: number;
  depth: number;
}

export type ParticleDensity = "off" | "sparse" | "dense";
export type TextureQuality = "off" | "low" | "high";
export type ColormapTheme = "ocean" | "thermal" | "grayscale" | "viridis";
export type CoordinateFormat = "decimal" | "dms";
export type DepthUnit = "metres" | "feet";
export type CameraSpawnBehaviour = "deepest" | "home" | "last";
export type MarkerType = "fish" | "shipwreck" | "coral" | "vent" | "custom";

export interface SettingsState {
  // ── Visuals ──────────────────────────────────────────────────────────
  textureQuality: TextureQuality;
  enableCaustics: boolean;
  particleDensity: ParticleDensity;
  fogDensity: number;
  colormapTheme: ColormapTheme;
  lampIntensity: number;

  // ── Navigation ───────────────────────────────────────────────────────
  defaultSpeedTier: number;
  invertMouseY: boolean;
  mouseSensitivity: number;
  cameraSpawnBehaviour: CameraSpawnBehaviour;

  // ── HUD ──────────────────────────────────────────────────────────────
  showCrosshairGps: boolean;
  showCameraPosition: boolean;
  showSpeedIndicator: boolean;
  showHeading: boolean;
  coordinateFormat: CoordinateFormat;
  depthUnit: DepthUnit;
  hudOpacity: number;

  // ── Overview Map ─────────────────────────────────────────────────────
  overviewDefaultZoom: number;
  overviewShowGrid: boolean;
  overviewShowMarkers: boolean;
  overviewOpenOnLoad: boolean;

  // ── Markers ──────────────────────────────────────────────────────────
  visibleMarkerTypes: MarkerType[];
  showMarkerLabels: boolean;
  privateMarkers: boolean;
  defaultMarkerType: MarkerType;

  // ── Terrain rendering ────────────────────────────────────────────────
  smoothTerrainSpikes: boolean;

  // ── Dataset ───────────────────────────────────────────────────────────
  defaultRegion: string;

  // ── GPS recording ─────────────────────────────────────────────────────
  gpsRecordingInterval: number;

  /** Per-dataset saved camera spawn positions (set via "Set as home" context menu). */
  datasetHomePositions: Record<string, DatasetHomePosition>;
}

interface SettingsActions {
  setTextureQuality: (v: TextureQuality) => void;
  setEnableCaustics: (v: boolean) => void;
  setParticleDensity: (v: ParticleDensity) => void;
  setFogDensity: (v: number) => void;
  setColormapTheme: (v: ColormapTheme) => void;
  setLampIntensity: (v: number) => void;

  setDefaultSpeedTier: (v: number) => void;
  setInvertMouseY: (v: boolean) => void;
  setMouseSensitivity: (v: number) => void;
  setCameraSpawnBehaviour: (v: CameraSpawnBehaviour) => void;

  setShowCrosshairGps: (v: boolean) => void;
  setShowCameraPosition: (v: boolean) => void;
  setShowSpeedIndicator: (v: boolean) => void;
  setShowHeading: (v: boolean) => void;
  setCoordinateFormat: (v: CoordinateFormat) => void;
  setDepthUnit: (v: DepthUnit) => void;
  setHudOpacity: (v: number) => void;

  setOverviewDefaultZoom: (v: number) => void;
  setOverviewShowGrid: (v: boolean) => void;
  setOverviewShowMarkers: (v: boolean) => void;
  setOverviewOpenOnLoad: (v: boolean) => void;

  setVisibleMarkerTypes: (v: MarkerType[]) => void;
  setShowMarkerLabels: (v: boolean) => void;
  setPrivateMarkers: (v: boolean) => void;
  setDefaultMarkerType: (v: MarkerType) => void;

  setSmoothTerrainSpikes: (v: boolean) => void;

  setDefaultRegion: (v: string) => void;
  setGpsRecordingInterval: (ms: number) => void;

  setDatasetHome: (datasetId: string, pos: DatasetHomePosition) => void;
  clearDatasetHome: (datasetId: string) => void;

  /** Hydrate the entire settings state from the server response. */
  hydrateFromServer: (partial: Partial<SettingsState>) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

export const DEFAULT_SETTINGS: SettingsState = {
  textureQuality: "high",
  enableCaustics: false,
  particleDensity: "sparse",
  fogDensity: 0.012,
  colormapTheme: "ocean",
  lampIntensity: 2,

  defaultSpeedTier: 2,
  invertMouseY: false,
  mouseSensitivity: 1.0,
  cameraSpawnBehaviour: "deepest",

  showCrosshairGps: true,
  showCameraPosition: true,
  showSpeedIndicator: true,
  showHeading: true,
  coordinateFormat: "decimal",
  depthUnit: "metres",
  hudOpacity: 0.75,

  overviewDefaultZoom: 1.0,
  overviewShowGrid: true,
  overviewShowMarkers: true,
  overviewOpenOnLoad: false,

  visibleMarkerTypes: ["fish", "shipwreck", "coral", "vent", "custom"],
  showMarkerLabels: true,
  privateMarkers: false,
  defaultMarkerType: "fish",

  smoothTerrainSpikes: true,

  defaultRegion: "mariana-trench",
  gpsRecordingInterval: 10_000,

  datasetHomePositions: {},
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      setTextureQuality: (v) => set({ textureQuality: v }),
      setEnableCaustics: (v) => set({ enableCaustics: v }),
      setParticleDensity: (v) => set({ particleDensity: v }),
      setFogDensity: (v) => set({ fogDensity: v }),
      setColormapTheme: (v) => set({ colormapTheme: v }),
      setLampIntensity: (v) => set({ lampIntensity: v }),

      setDefaultSpeedTier: (v) => set({ defaultSpeedTier: v }),
      setInvertMouseY: (v) => set({ invertMouseY: v }),
      setMouseSensitivity: (v) => set({ mouseSensitivity: v }),
      setCameraSpawnBehaviour: (v) => set({ cameraSpawnBehaviour: v }),

      setShowCrosshairGps: (v) => set({ showCrosshairGps: v }),
      setShowCameraPosition: (v) => set({ showCameraPosition: v }),
      setShowSpeedIndicator: (v) => set({ showSpeedIndicator: v }),
      setShowHeading: (v) => set({ showHeading: v }),
      setCoordinateFormat: (v) => set({ coordinateFormat: v }),
      setDepthUnit: (v) => set({ depthUnit: v }),
      setHudOpacity: (v) => set({ hudOpacity: v }),

      setOverviewDefaultZoom: (v) => set({ overviewDefaultZoom: v }),
      setOverviewShowGrid: (v) => set({ overviewShowGrid: v }),
      setOverviewShowMarkers: (v) => set({ overviewShowMarkers: v }),
      setOverviewOpenOnLoad: (v) => set({ overviewOpenOnLoad: v }),

      setVisibleMarkerTypes: (v) => set({ visibleMarkerTypes: v }),
      setShowMarkerLabels: (v) => set({ showMarkerLabels: v }),
      setPrivateMarkers: (v) => set({ privateMarkers: v }),
      setDefaultMarkerType: (v) => set({ defaultMarkerType: v }),

      setSmoothTerrainSpikes: (v) => set({ smoothTerrainSpikes: v }),

      setDefaultRegion: (v) => set({ defaultRegion: v }),
      setGpsRecordingInterval: (ms) => set({ gpsRecordingInterval: ms }),

      setDatasetHome: (datasetId, pos) =>
        set((state) => ({
          datasetHomePositions: {
            ...state.datasetHomePositions,
            [datasetId]: pos,
          },
        })),
      clearDatasetHome: (datasetId) =>
        set((state) => {
          const next = { ...state.datasetHomePositions };
          delete next[datasetId];
          return { datasetHomePositions: next };
        }),

      hydrateFromServer: (partial) =>
        set((state) => ({ ...state, ...partial })),
    }),
    { name: "bathyscan:settings" },
  ),
);
