/**
 * uiStore — ephemeral runtime UI state for BathyScan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONVENTION: WHERE DOES NEW STATE LIVE?
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PERSISTENT STATE → settingsStore  (cross-device, server-synced)
 *   Any toggle, mode, overlay, or user-facing preference that should survive a
 *   page reload or sign-in from a different device MUST be added to
 *   settingsStore, NOT here. See settingsStore.ts for the full guide.
 *
 *   Fields in this store that mirror a settingsStore key:
 *   - Read their initial value from DEFAULT_SETTINGS so they are correct on
 *     first render (applySettingsToUiStore corrects them once localStorage
 *     has hydrated).
 *   - Are AUTOMATICALLY written back to settingsStore by the auto-mirror
 *     subscription defined below — NO useSettingsStore.setState() call is
 *     needed inside a setter. Just call set().
 *   - Are re-applied from settingsStore by useServerSettingsSync after a
 *     server GET hydration so cross-device changes propagate automatically.
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  ADDING A NEW MIRRORED (PERSISTED) FIELD:                           │
 *   │  1. Add to SettingsState + DEFAULT_SETTINGS + SECTION_KEYS          │
 *   │     in settingsStore.ts.                                             │
 *   │  2. Add the field + setter to the UiStore interface below.           │
 *   │  3. Initialise the field in the create() factory from DEFAULT_SETTINGS│
 *   │  4. Add an entry to MIRRORED_UI_KEYS and computeSettingsPatch        │
 *   │     (the two functions just below applySettingsToUiStore).           │
 *   │  5. Add the field to applySettingsToUiStore.                         │
 *   │  Your setter ONLY needs set({…}) — the subscription handles          │
 *   │  useSettingsStore.setState() automatically.                          │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * INTENTIONALLY TRANSIENT STATE → here (memory-only, resets on reload)
 *   State that should intentionally reset each session:
 *   - Active selections (selectedSubstrate, selectedHotspot, selectedEfh)
 *   - Open/close state of modal panels (overviewOpen, markerFormOpen,
 *     findDataPanelOpen)
 *   - Camera jump queue (pendingDropIn)
 *   - Time scrubber (scrubDatetime)
 *   - Form prefill (markerFormPrefill)
 *
 * DEVICE-LOCAL STATE → raw localStorage  (one-time hints, never settingsStore)
 *   hasSeenOrbitTouchHint is intentionally device-local and stays here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { create } from "zustand";
import type { DepthLayer } from "@/components/TidalCurrentArrows";
import type { EfhSpeciesProperties } from "@workspace/api-client-react";
import { useSettingsStore, DEFAULT_SETTINGS, type SidebarMode, type SettingsState } from "./settingsStore";
import { onSidebarModeChange } from "./liveMode";

export const CURRENT_DEPTH_LAYERS: DepthLayer[] = ["surface", "mid", "near-bottom"];

export interface DropInTarget {
  worldX: number;
  worldZ: number;
  /**
   * Optional target world-Y for the camera. When provided the drop-in skips
   * the downward terrain raycast and places the camera at exactly this Y.
   * Used by both share-link restoration and bookmark fly-to.
   */
  worldY?: number;
  /** Compass heading (degrees, 0 = North, 90 = East …) for bookmark fly-to.
   *  Applied via the same formula as the cameraStore heading computation:
   *  euler.y = heading * PI / 180. */
  heading?: number;
  /** Compass heading (degrees, 0 = north) for share-link restoration.
   *  Applied via the share-link convention:
   *  yaw = -(headingDeg * PI / 180) + PI. */
  headingDeg?: number;
}

export interface SelectedHotspot {
  unitId: string;
  substrate: string;
  shoreZoneClass: string;
  tidepoolScore: number;
  beachcombingScore: number;
  szMaterial: string | null;
  szForm: string | null;
  signals: {
    tidepool: {
      substrate: string;
      bioband: string | null;
      debris: string | null;
      energy: string | null;
      humanUse: string | null;
      whySummary: string;
    };
    beachcombing: {
      substrate: string;
      bioband: string | null;
      debris: string | null;
      energy: string | null;
      humanUse: string | null;
      whySummary: string;
    };
  };
  sourceName: string;
  creditUrl: string;
}

export interface SelectedSubstrate {
  unitId: string;
  substrate: string;
  shoreZoneClass: string;
  cmecsCode: string;
  color: string;
  szMaterial: string | null;
  szForm: string | null;
  areaSqM: number | null;
  /**
   * Per-feature citation narrative. For ENC features this is the raw S-57
   * NATSUR; for TPWD Texas lake features this is the lake-survey sentence
   * explaining the classification. Rendered in the info-card tooltip body.
   */
  natsur: string | null;
  /**
   * Per-feature outbound link. For TPWD Texas lake features this is the
   * TPWD lake page URL ("↗ TPWD lake page"); for ENC features this is the
   * chart number string (no link rendered then).
   */
  encChart: string | null;
  /** Source / credit metadata from the FeatureCollection. */
  sourceName: string;
  creditUrl: string;
}

/** A manual coordinate-search request queued for the OverviewMap to run. */
export interface CoordSearchRequest {
  lat: number;
  lon: number;
  /** Search radius in kilometres (already converted from the chosen unit). */
  radiusKm: number;
}

/** The active coordinate-search area (centre + radius + derived bbox). */
export interface CoordSearchArea {
  lat: number;
  lon: number;
  radiusKm: number;
  bbox: { north: number; south: number; east: number; west: number };
}

interface UiStore {
  pendingDropIn: DropInTarget | null;
  setPendingDropIn: (target: DropInTarget | null) => void;
  clearPendingDropIn: () => void;
  overviewOpen: boolean;
  setOverviewOpen: (open: boolean) => void;
  /** Whether the "What's Here?" summary card is visible. */
  whatsHereOpen: boolean;
  setWhatsHereOpen: (open: boolean) => void;
  /** When true the card stays open past the 8-second auto-close and updates live. */
  whatsHerePinned: boolean;
  setWhatsHerePinned: (pinned: boolean) => void;
  markerFormOpen: boolean;
  setMarkerFormOpen: (open: boolean) => void;
  /**
   * Optional values the next-opened MarkerForm should start with — used by
   * features like the depth-profile auto-suggest list to hand the form a
   * sensible default label/type. Cleared when the form closes.
   */
  markerFormPrefill: { label?: string; type?: string } | null;
  setMarkerFormPrefill: (p: { label?: string; type?: string } | null) => void;
  zoneOverlayEnabled: boolean;
  setZoneOverlayEnabled: (enabled: boolean) => void;
  zonePaintMode: boolean;
  setZonePaintMode: (enabled: boolean) => void;
  /** Which texture slot (0–3) the paint brush is currently set to. */
  zonePaintSlot: 0 | 1 | 2 | 3;
  setZonePaintSlot: (slot: 0 | 1 | 2 | 3) => void;
  /** Brush radius in grid cells (1–20). Persists across sessions via settingsStore. */
  zonePaintBrushRadius: number;
  setZonePaintBrushRadius: (radius: number) => void;
  /** Show real Alaska ShoreZone substrate polygons as a draped overlay. */
  substrateColorMode: boolean;
  setSubstrateColorMode: (enabled: boolean) => void;
  /** Currently selected substrate polygon (set on click; null = closed card). */
  selectedSubstrate: SelectedSubstrate | null;
  setSelectedSubstrate: (s: SelectedSubstrate | null) => void;
  /**
   * CMECS substrate classes the user has hidden via the legend (lower-cased
   * keys, matching `feature.properties.substrate`). Empty set = all visible.
   * Shared between the 2D overview legend and the 3D SubstrateLayer so the
   * two views stay in sync.
   */
  hiddenSubstrateClasses: Set<string>;
  toggleSubstrateClass: (substrate: string) => void;
  clearHiddenSubstrateClasses: () => void;
  /** Show intertidal hotspot polygons (tidepool + beachcombing scores) in the 3D scene. */
  intertidalHotspotsEnabled: boolean;
  setIntertidalHotspotsEnabled: (enabled: boolean) => void;
  /**
   * Which score type to highlight in the Intertidal Hotspots layer.
   * Passed as the `type` query param to the intertidal spots endpoint.
   * 'tidepool' = teal polygons, 'beachcombing' = amber polygons.
   */
  intertidalScoreMode: 'tidepool' | 'beachcombing';
  setIntertidalScoreMode: (mode: 'tidepool' | 'beachcombing') => void;
  /** Currently selected intertidal hotspot polygon. null = card closed. */
  selectedHotspot: SelectedHotspot | null;
  setSelectedHotspot: (h: SelectedHotspot | null) => void;
  /** Show EFH zone polygon outlines in the 3D scene. */
  efhOverlayEnabled: boolean;
  setEfhOverlayEnabled: (enabled: boolean) => void;
  /**
   * Show HYD93 cartographic annotation points (kelp, rocks, rocky reefs,
   * ledges, obstructions) as a labelled overlay in the 3D scene.
   * Only meaningful when the active dataset was sourced from a HYD93 archive.
   * Persisted via settingsStore so power users who always want the overlay on
   * keep it on between sessions.
   */
  hyd93FeaturesEnabled: boolean;
  setHyd93FeaturesEnabled: (enabled: boolean) => void;
  /**
   * The subset of HYD93 feature codes currently visible.
   * Codes: 89 (Rocks), 103 (Kelp), 146 (Ledge), 530 (Rocky reef), 988 (Obstruction).
   * Defaults to all five codes. Persisted via settingsStore so the user's
   * filter choices survive page reloads and sync cross-device.
   */
  hyd93ActiveFeatureCodes: Set<number>;
  toggleHyd93FeatureCode: (code: number) => void;
  /**
   * Currently selected EFH species (set on click in the OverviewMap or in
   * the 3D scene). When non-null, the shared EfhDetailPanel renders the
   * species info card. Null = panel closed.
   */
  selectedEfh: EfhSpeciesProperties | null;
  setSelectedEfh: (p: EfhSpeciesProperties | null) => void;
  /**
   * EFH species common names the user has hidden via the legend toggle.
   * Keys match `feature.properties.commonName` (case-sensitive).
   * Empty set = all species visible.
   * Shared between the 2D overview legend and the 3D EfhZoneLayer.
   */
  hiddenEfhSpecies: Set<string>;
  toggleEfhSpecies: (commonName: string) => void;
  clearHiddenEfhSpecies: () => void;
  /** Controls visibility of the Find Data slide-in panel. */
  findDataPanelOpen: boolean;
  setFindDataPanelOpen: (open: boolean) => void;
  /**
   * Incremented each time the Find Data panel is opened. Used as the `key`
   * prop on <FindDataPanel> so React remounts it fresh on every open,
   * clearing stale search state automatically.
   */
  openFindDataCount: number;
  /** NOAA Aviation Weather station pins on the OverviewMap. */
  weatherStationsActive: boolean;
  setWeatherStationsActive: (b: boolean) => void;
  /** AOOS RAWS land-weather station pins on the OverviewMap. */
  rawsOverlayActive: boolean;
  setRawsOverlayActive: (b: boolean) => void;
  /** Always-on Wind arrow overlay. */
  windOverlayActive: boolean;
  setWindOverlayActive: (b: boolean) => void;
  /** Always-on Tide arrow overlay. */
  tideOverlayActive: boolean;
  setTideOverlayActive: (b: boolean) => void;
  /** Always-on Current arrow overlay. */
  currentOverlayActive: boolean;
  setCurrentOverlayActive: (b: boolean) => void;
  /** Which depth layers the Current overlay renders (multi-select). */
  currentDepthLayers: DepthLayer[];
  setCurrentDepthLayers: (layers: DepthLayer[]) => void;
  toggleCurrentDepthLayer: (layer: DepthLayer) => void;
  /** Whether the left side pane (datasets, habitat, tides…) is collapsed. */
  sidePaneCollapsed: boolean;
  setSidePaneCollapsed: (collapsed: boolean) => void;
  /**
   * Shared time scrubber value — drives TidePanel's time slider and the tidal
   * data fetch. Stored here so HabitatPanel can snap the scrubber to a fishing
   * window without requiring prop drilling through App.tsx.
   * null = live / "now".
   */
  scrubDatetime: Date | null;
  setScrubDatetime: (d: Date | null) => void;
  /** Queued manual coordinate search — consumed by OverviewMap when it opens. */
  pendingCoordSearch: CoordSearchRequest | null;
  setPendingCoordSearch: (req: CoordSearchRequest | null) => void;
  clearPendingCoordSearch: () => void;
  /** Active coordinate-search area (circle drawn on the OverviewMap; also
   *  provides a derived bbox for the Find Data NCEI tab). */
  coordSearchArea: CoordSearchArea | null;
  setCoordSearchArea: (area: CoordSearchArea | null) => void;
  clearCoordSearchArea: () => void;
  /** Whether the user has already seen the one-time two-finger orbit hint toast. */
  hasSeenOrbitTouchHint: boolean;
  setHasSeenOrbitTouchHint: (seen: boolean) => void;
  /**
   * Depth in metres currently under the pointer in the 3D scene when the
   * TEMP LAYER is active. null = pointer is off-canvas or temp layer is off.
   * Updated by ThermalCursorTracker (lives inside the R3F Canvas).
   */
  thermalCursorDepthM: number | null;
  setThermalCursorDepthM: (depthM: number | null) => void;
  /**
   * Which contextual mode the left sidebar is currently showing.
   * Mirrors settingsStore.sidebarMode for persistence across sessions.
   */
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;
  /**
   * Pending follow-mode dataset handoff — set when the user taps
   * "Load & keep following" on the out-of-bounds suggestion toast.
   * Consumed by App.tsx: it switches the active dataset and re-enables
   * GPS follow mode once that dataset's terrain is loaded.
   */
  pendingFollowHandoff: string | null;
  requestFollowHandoff: (datasetId: string) => void;
  clearFollowHandoff: () => void;
}

// ── Device-local helpers (hasSeenOrbitTouchHint only) ────────────────────────
// These are intentionally NOT promoted to settingsStore; the orbit hint is a
// one-time device-local experience that should fire fresh on new devices.
function readLocalBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function writeLocalBool(key: string, value: boolean): void {
  try { localStorage.setItem(key, String(value)); } catch {}
}

// ── Clean up stale localStorage keys (superseded by settingsStore v15) ────────
// These keys were written by earlier versions of uiStore directly to
// localStorage.  They are removed on first load so they can never shadow the
// server-synced values from settingsStore in future sessions.
(function cleanupLegacyLocalStorageKeys() {
  const legacy = [
    "bathyscan:weatherStationsActive",
    "bathyscan:rawsOverlayActive",
    "bathyscan:windOverlayActive",
    "bathyscan:tideOverlayActive",
    "bathyscan:currentOverlayActive",
    "bathyscan:currentDepthLayers",
    "bathyscan:sidePaneCollapsed",
    "bathyscan:zonePaintBrushRadius",
  ];
  try {
    for (const key of legacy) {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage may be unavailable (private browsing, sandboxed iframe, etc.)
  }
})();

// ── Helpers to validate depth layers from stored state ───────────────────────
function validDepthLayers(raw: unknown): DepthLayer[] {
  if (!Array.isArray(raw)) return ["mid"];
  const valid = (raw as unknown[]).filter(
    (v): v is DepthLayer => CURRENT_DEPTH_LAYERS.includes(v as DepthLayer),
  );
  return valid.length ? valid : ["mid"];
}

// ── Auto-mirror: uiStore → settingsStore ─────────────────────────────────────
//
// When any "mirrored" field changes in uiStore, the subscription below
// automatically pushes the new value(s) to settingsStore so the debounced
// PUT /api/settings fires — no useSettingsStore.setState() call is needed
// inside individual setters.
//
// _suppressMirror is set to true during applySettingsToUiStore (the
// settingsStore→uiStore direction) to prevent an infinite write-back loop.

let _suppressMirror = false;

/**
 * The uiStore field names that must be kept in sync with settingsStore.
 * This is the authoritative list for both directions:
 *   • uiStore→settingsStore: the subscription below reads this list.
 *   • settingsStore→uiStore: applySettingsToUiStore below reads from the
 *     same fields.
 *
 * Add a new key here whenever you add a field that should persist across
 * sessions (see the guide at the top of this file).
 */
export const MIRRORED_UI_KEYS = [
  "zoneOverlayEnabled",
  "zonePaintMode",
  "zonePaintSlot",
  "zonePaintBrushRadius",
  "substrateColorMode",
  "hiddenSubstrateClasses",
  "intertidalHotspotsEnabled",
  "intertidalScoreMode",
  "efhOverlayEnabled",
  "hiddenEfhSpecies",
  "hyd93ActiveFeatureCodes",
  "hyd93FeaturesEnabled",
  "weatherStationsActive",
  "rawsOverlayActive",
  "windOverlayActive",
  "tideOverlayActive",
  "currentOverlayActive",
  "currentDepthLayers",
  "sidePaneCollapsed",
  "sidebarMode",
] as const satisfies ReadonlyArray<keyof UiStore>;

/**
 * Convert the mirrored subset of the current uiStore state into a
 * settingsStore patch.  Set fields are serialised to plain arrays because
 * settingsStore persists JSON-safe values.
 *
 * Keep this function in sync with MIRRORED_UI_KEYS and applySettingsToUiStore.
 */
function computeSettingsPatch(state: UiStore): Partial<SettingsState> {
  return {
    zoneOverlayEnabled: state.zoneOverlayEnabled,
    zonePaintMode: state.zonePaintMode,
    zonePaintSlot: state.zonePaintSlot,
    zonePaintBrushRadius: state.zonePaintBrushRadius,
    substrateColorMode: state.substrateColorMode,
    hiddenSubstrateClasses: [...state.hiddenSubstrateClasses],
    intertidalHotspotsEnabled: state.intertidalHotspotsEnabled,
    intertidalScoreMode: state.intertidalScoreMode,
    efhOverlayEnabled: state.efhOverlayEnabled,
    hiddenEfhSpecies: [...state.hiddenEfhSpecies],
    hyd93ActiveFeatureCodes: [...state.hyd93ActiveFeatureCodes],
    hyd93FeaturesEnabled: state.hyd93FeaturesEnabled,
    weatherStationsActive: state.weatherStationsActive,
    rawsOverlayActive: state.rawsOverlayActive,
    windOverlayActive: state.windOverlayActive,
    tideOverlayActive: state.tideOverlayActive,
    currentOverlayActive: state.currentOverlayActive,
    currentDepthLayers: state.currentDepthLayers,
    sidePaneCollapsed: state.sidePaneCollapsed,
    sidebarMode: state.sidebarMode,
  };
}

// ── Helper: apply persisted settingsStore values to uiStore ──────────────────
// Called once after settingsStore finishes rehydrating from localStorage so
// the initial render sees the correct persisted overlay/toggle state rather
// than the DEFAULT_SETTINGS fallbacks used during store construction.
// _suppressMirror prevents the subscription from writing back to settingsStore
// during this settingsStore→uiStore hydration pass.
function applySettingsToUiStore(s: typeof DEFAULT_SETTINGS) {
  _suppressMirror = true;
  try {
    const prevSidebarMode = useUiStore.getState().sidebarMode;
    useUiStore.setState({
      zoneOverlayEnabled: s.zoneOverlayEnabled,
      zonePaintMode: s.zonePaintMode,
      zonePaintSlot: (s.zonePaintSlot as 0 | 1 | 2 | 3) ?? 0,
      zonePaintBrushRadius: s.zonePaintBrushRadius,
      substrateColorMode: s.substrateColorMode,
      hiddenSubstrateClasses: new Set<string>(s.hiddenSubstrateClasses ?? []),
      intertidalHotspotsEnabled: s.intertidalHotspotsEnabled,
      intertidalScoreMode: s.intertidalScoreMode ?? 'tidepool',
      efhOverlayEnabled: s.efhOverlayEnabled,
      hiddenEfhSpecies: new Set<string>(s.hiddenEfhSpecies ?? []),
      hyd93ActiveFeatureCodes: new Set<number>(s.hyd93ActiveFeatureCodes ?? [89, 103, 146, 530, 988]),
      hyd93FeaturesEnabled: s.hyd93FeaturesEnabled,
      weatherStationsActive: s.weatherStationsActive,
      rawsOverlayActive: s.rawsOverlayActive,
      windOverlayActive: s.windOverlayActive,
      tideOverlayActive: s.tideOverlayActive,
      currentOverlayActive: s.currentOverlayActive,
      currentDepthLayers: validDepthLayers(s.currentDepthLayers),
      sidePaneCollapsed: s.sidePaneCollapsed,
      sidebarMode: s.sidebarMode ?? 'explore',
    });
    // Resume Live-mode orchestration (GPS watch, follow, trail recording) when
    // a persisted 'live' sidebar mode is restored on page load.
    onSidebarModeChange(prevSidebarMode, s.sidebarMode ?? 'explore');
  } finally {
    _suppressMirror = false;
  }
}

export const useUiStore = create<UiStore>((set, get) => {
  // Use DEFAULT_SETTINGS as the initial values for fields that mirror
  // settingsStore. The correct persisted values are applied via
  // onFinishHydration (below) once settingsStore rehydrates from localStorage.
  // This avoids reading useSettingsStore.getState() before persist has had a
  // chance to hydrate, which could cause a flash of wrong defaults.
  const s = DEFAULT_SETTINGS;

  return {
    // ── Transient state (resets on reload) ─────────────────────────────────
    pendingDropIn: null,
    setPendingDropIn: (target) => set({ pendingDropIn: target }),
    clearPendingDropIn: () => set({ pendingDropIn: null }),
    overviewOpen: false,
    setOverviewOpen: (open) => set({ overviewOpen: open }),
    whatsHereOpen: false,
    setWhatsHereOpen: (open) => set(open ? { whatsHereOpen: true } : { whatsHereOpen: false, whatsHerePinned: false }),
    whatsHerePinned: false,
    setWhatsHerePinned: (pinned) => set({ whatsHerePinned: pinned }),
    markerFormOpen: false,
    setMarkerFormOpen: (open) =>
      set(open ? { markerFormOpen: true } : { markerFormOpen: false, markerFormPrefill: null }),
    markerFormPrefill: null,
    setMarkerFormPrefill: (p) => set({ markerFormPrefill: p }),
    selectedSubstrate: null,
    setSelectedSubstrate: (sub) => set({ selectedSubstrate: sub }),
    selectedHotspot: null,
    setSelectedHotspot: (h) => set({ selectedHotspot: h }),
    selectedEfh: null,
    setSelectedEfh: (p) => set({ selectedEfh: p }),
    findDataPanelOpen: false,
    openFindDataCount: 0,
    setFindDataPanelOpen: (open) =>
      set((state) =>
        open
          ? { findDataPanelOpen: true, openFindDataCount: state.openFindDataCount + 1 }
          : { findDataPanelOpen: false },
      ),
    pendingFollowHandoff: null,
    requestFollowHandoff: (datasetId) => set({ pendingFollowHandoff: datasetId }),
    clearFollowHandoff: () => set({ pendingFollowHandoff: null }),
    pendingCoordSearch: null,
    setPendingCoordSearch: (req) => set({ pendingCoordSearch: req }),
    clearPendingCoordSearch: () => set({ pendingCoordSearch: null }),
    coordSearchArea: null,
    setCoordSearchArea: (area) => set({ coordSearchArea: area }),
    clearCoordSearchArea: () => set({ coordSearchArea: null }),
    scrubDatetime: null,
    setScrubDatetime: (d) => set({ scrubDatetime: d }),

    // ── Persistent overlay toggles (synced via settingsStore → server) ─────
    // Initial values come from DEFAULT_SETTINGS; corrected post-rehydration
    // via the onFinishHydration subscriber registered below this store.
    //
    // Setters only call set() — the auto-mirror subscription (wired up after
    // the store is created) handles the useSettingsStore.setState() write so
    // it can never be forgotten in future additions.

    zoneOverlayEnabled: s.zoneOverlayEnabled,
    setZoneOverlayEnabled: (enabled) => {
      set(enabled ? { zoneOverlayEnabled: true } : { zoneOverlayEnabled: false, zonePaintMode: false });
    },

    zonePaintMode: s.zonePaintMode,
    setZonePaintMode: (enabled) => {
      set({ zonePaintMode: enabled });
    },

    zonePaintSlot: (s.zonePaintSlot as 0 | 1 | 2 | 3) ?? 0,
    setZonePaintSlot: (slot) => {
      set({ zonePaintSlot: slot });
    },

    zonePaintBrushRadius: s.zonePaintBrushRadius,
    setZonePaintBrushRadius: (radius) => {
      const clamped = Math.max(1, Math.min(20, Math.round(radius)));
      set({ zonePaintBrushRadius: clamped });
    },

    substrateColorMode: s.substrateColorMode,
    setSubstrateColorMode: (enabled) => {
      set(enabled ? { substrateColorMode: true } : { substrateColorMode: false, selectedSubstrate: null });
    },

    hiddenSubstrateClasses: new Set<string>(s.hiddenSubstrateClasses ?? []),
    toggleSubstrateClass: (substrate) => {
      const state = get();
      const key = substrate.toLowerCase();
      const next = new Set(state.hiddenSubstrateClasses);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      const sel = state.selectedSubstrate;
      const clearSel = sel && next.has(sel.substrate.toLowerCase());
      set(clearSel
        ? { hiddenSubstrateClasses: next, selectedSubstrate: null }
        : { hiddenSubstrateClasses: next });
    },
    clearHiddenSubstrateClasses: () => {
      set({ hiddenSubstrateClasses: new Set<string>() });
    },

    intertidalHotspotsEnabled: s.intertidalHotspotsEnabled,
    setIntertidalHotspotsEnabled: (enabled) => {
      set(enabled
        ? { intertidalHotspotsEnabled: true }
        : { intertidalHotspotsEnabled: false, selectedHotspot: null });
    },

    intertidalScoreMode: s.intertidalScoreMode ?? 'tidepool',
    setIntertidalScoreMode: (mode) => {
      set({ intertidalScoreMode: mode, selectedHotspot: null });
    },

    efhOverlayEnabled: s.efhOverlayEnabled,
    setEfhOverlayEnabled: (enabled) => {
      set(enabled
        ? { efhOverlayEnabled: true }
        : { efhOverlayEnabled: false, selectedEfh: null, hiddenEfhSpecies: new Set<string>() });
    },

    // hyd93FeaturesEnabled is persisted via settingsStore so the overlay stays on
    // between sessions for power users who always work with HYD93 datasets.
    hyd93FeaturesEnabled: s.hyd93FeaturesEnabled,
    setHyd93FeaturesEnabled: (enabled) => {
      set({ hyd93FeaturesEnabled: enabled });
    },

    // hyd93ActiveFeatureCodes is persisted via settingsStore so power users'
    // filter choices survive page reloads and sync cross-device.
    hyd93ActiveFeatureCodes: new Set<number>(s.hyd93ActiveFeatureCodes ?? [89, 103, 146, 530, 988]),
    toggleHyd93FeatureCode: (code) => {
      const next = new Set(get().hyd93ActiveFeatureCodes);
      if (next.has(code)) {
        if (next.size > 1) next.delete(code);
      } else {
        next.add(code);
      }
      set({ hyd93ActiveFeatureCodes: next });
    },

    hiddenEfhSpecies: new Set<string>(s.hiddenEfhSpecies ?? []),
    toggleEfhSpecies: (commonName) => {
      const state = get();
      const next = new Set(state.hiddenEfhSpecies);
      if (next.has(commonName)) next.delete(commonName);
      else next.add(commonName);
      const sel = state.selectedEfh;
      const clearSel = sel && next.has(sel.commonName ?? "");
      set(clearSel
        ? { hiddenEfhSpecies: next, selectedEfh: null }
        : { hiddenEfhSpecies: next });
    },
    clearHiddenEfhSpecies: () => {
      set({ hiddenEfhSpecies: new Set<string>() });
    },

    weatherStationsActive: s.weatherStationsActive,
    setWeatherStationsActive: (b) => {
      set({ weatherStationsActive: b });
    },

    rawsOverlayActive: s.rawsOverlayActive,
    setRawsOverlayActive: (b) => {
      set({ rawsOverlayActive: b });
    },

    windOverlayActive: s.windOverlayActive,
    setWindOverlayActive: (b) => {
      set({ windOverlayActive: b });
    },

    tideOverlayActive: s.tideOverlayActive,
    setTideOverlayActive: (b) => {
      set({ tideOverlayActive: b });
    },

    currentOverlayActive: s.currentOverlayActive,
    setCurrentOverlayActive: (b) => {
      set({ currentOverlayActive: b });
    },

    currentDepthLayers: validDepthLayers(s.currentDepthLayers),
    setCurrentDepthLayers: (layers) => {
      const ordered = CURRENT_DEPTH_LAYERS.filter((l) => layers.includes(l));
      set({ currentDepthLayers: ordered });
    },
    toggleCurrentDepthLayer: (layer) => {
      const state = get();
      const has = state.currentDepthLayers.includes(layer);
      let next = has
        ? state.currentDepthLayers.filter((l) => l !== layer)
        : [...state.currentDepthLayers, layer];
      if (next.length === 0) next = [layer];
      const ordered = CURRENT_DEPTH_LAYERS.filter((l) => next.includes(l));
      set({ currentDepthLayers: ordered });
    },

    sidePaneCollapsed: s.sidePaneCollapsed,
    setSidePaneCollapsed: (collapsed) => {
      set({ sidePaneCollapsed: collapsed });
    },

    // ── Device-local state (stays in raw localStorage, never synced) ────────
    hasSeenOrbitTouchHint: readLocalBool("bathyscan:hasSeenOrbitTouchHint", false),
    setHasSeenOrbitTouchHint: (seen) => {
      writeLocalBool("bathyscan:hasSeenOrbitTouchHint", seen);
      set({ hasSeenOrbitTouchHint: seen });
    },

    // ── Ephemeral per-frame 3D cursor state ────────────────────────────────
    thermalCursorDepthM: null,
    setThermalCursorDepthM: (depthM) => set({ thermalCursorDepthM: depthM }),

    // ── Sidebar mode (persisted via settingsStore) ──────────────────────────
    sidebarMode: s.sidebarMode ?? 'explore',
    setSidebarMode: (mode) => {
      const prev = get().sidebarMode;
      set({ sidebarMode: mode });
      // Explicit write-through to settingsStore so the mirror always fires
      // even when mode didn't change (Zustand skips subscription callbacks
      // when the new value equals the old value, so the auto-mirror
      // subscription below would silently skip a no-op set).
      if (!_suppressMirror) {
        useSettingsStore.setState({ sidebarMode: mode });
      }
      // Live-mode orchestration: start/stop GPS follow + trail recording on
      // transitions into/out of 'live'. Runs after the local commit.
      onSidebarModeChange(prev, mode);
    },
  };
});

// ── Auto-mirror subscription ──────────────────────────────────────────────────
// Fires on every uiStore change. If any MIRRORED_UI_KEYS field changed and
// we are not in the middle of an applySettingsToUiStore pass, push the full
// mirrored-field patch to settingsStore so the debounced PUT fires.
//
// This is the mechanism that makes forgetting a useSettingsStore.setState()
// call in a setter structurally impossible: any setter that calls set({…}) on
// a mirrored field will automatically propagate here.
useUiStore.subscribe((state, prevState) => {
  if (_suppressMirror) return;
  const changed = MIRRORED_UI_KEYS.some(
    (k) =>
      (state as unknown as Record<string, unknown>)[k] !==
      (prevState as unknown as Record<string, unknown>)[k],
  );
  if (!changed) return;
  useSettingsStore.setState(computeSettingsPatch(state));
});

/**
 * Returns true when the global timeline scrubber bar is currently visible —
 * i.e. at least one time-sensitive overlay (tide, currents, wind, or weather
 * stations) is active. Each time-sensitive panel uses this to decide whether
 * to defer to the global time source or show its own local time control.
 */
export function useTimelineVisible(): boolean {
  const tide = useUiStore((s) => s.tideOverlayActive);
  const currents = useUiStore((s) => s.currentOverlayActive);
  const wind = useUiStore((s) => s.windOverlayActive);
  const weather = useUiStore((s) => s.weatherStationsActive);
  const raws = useUiStore((s) => s.rawsOverlayActive);
  return tide || currents || wind || weather || raws;
}

// ── Post-rehydration sync from settingsStore ──────────────────────────────────
// settingsStore uses Zustand's `persist` middleware with localStorage (sync).
// In practice, hydration completes before this module finishes evaluating, but
// we cannot guarantee that ordering in all bundler/lazy-import scenarios.
// Using onFinishHydration (with a hasHydrated() guard) ensures uiStore always
// gets the correct persisted values — either immediately (if already hydrated)
// or as soon as hydration completes.
if (useSettingsStore.persist.hasHydrated()) {
  applySettingsToUiStore(useSettingsStore.getState());
} else {
  useSettingsStore.persist.onFinishHydration((state) => {
    applySettingsToUiStore(state);
  });
}
