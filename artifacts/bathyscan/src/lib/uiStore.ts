import { create } from "zustand";
import type { DepthLayer } from "@/components/TidalCurrentArrows";
import type { EfhSpeciesProperties } from "@workspace/api-client-react";

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

interface UiStore {
  pendingDropIn: DropInTarget | null;
  setPendingDropIn: (target: DropInTarget | null) => void;
  clearPendingDropIn: () => void;
  overviewOpen: boolean;
  setOverviewOpen: (open: boolean) => void;
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
  /** Show EFH zone polygon outlines in the 3D scene. */
  efhOverlayEnabled: boolean;
  setEfhOverlayEnabled: (enabled: boolean) => void;
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
}

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

const CURRENT_DEPTH_LAYERS_KEY = "bathyscan:currentDepthLayers";

function readDepthLayers(fallback: DepthLayer[]): DepthLayer[] {
  try {
    const raw = localStorage.getItem(CURRENT_DEPTH_LAYERS_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const valid = parsed.filter(
      (v): v is DepthLayer => CURRENT_DEPTH_LAYERS.includes(v as DepthLayer),
    );
    return valid.length ? valid : fallback;
  } catch {
    return fallback;
  }
}

function writeDepthLayers(layers: DepthLayer[]): void {
  try { localStorage.setItem(CURRENT_DEPTH_LAYERS_KEY, JSON.stringify(layers)); } catch {}
}

export const useUiStore = create<UiStore>((set) => ({
  pendingDropIn: null,
  setPendingDropIn: (target) => set({ pendingDropIn: target }),
  clearPendingDropIn: () => set({ pendingDropIn: null }),
  overviewOpen: false,
  setOverviewOpen: (open) => set({ overviewOpen: open }),
  markerFormOpen: false,
  setMarkerFormOpen: (open) =>
    set(open ? { markerFormOpen: true } : { markerFormOpen: false, markerFormPrefill: null }),
  markerFormPrefill: null,
  setMarkerFormPrefill: (p) => set({ markerFormPrefill: p }),
  zoneOverlayEnabled: false,
  setZoneOverlayEnabled: (enabled) =>
    set(enabled ? { zoneOverlayEnabled: true } : { zoneOverlayEnabled: false, zonePaintMode: false }),
  zonePaintMode: false,
  setZonePaintMode: (enabled) => set({ zonePaintMode: enabled }),
  zonePaintSlot: 0,
  setZonePaintSlot: (slot) => set({ zonePaintSlot: slot }),
  substrateColorMode: false,
  setSubstrateColorMode: (enabled) =>
    set(enabled ? { substrateColorMode: true } : { substrateColorMode: false, selectedSubstrate: null }),
  selectedSubstrate: null,
  setSelectedSubstrate: (s) => set({ selectedSubstrate: s }),
  hiddenSubstrateClasses: new Set<string>(),
  toggleSubstrateClass: (substrate) => set((state) => {
    const key = substrate.toLowerCase();
    const next = new Set(state.hiddenSubstrateClasses);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // If the currently-selected polygon belongs to a class we just hid,
    // close its info card — leaving it open would point at geometry the
    // user can no longer see.
    const sel = state.selectedSubstrate;
    const clearSel = sel && next.has(sel.substrate.toLowerCase());
    return clearSel
      ? { hiddenSubstrateClasses: next, selectedSubstrate: null }
      : { hiddenSubstrateClasses: next };
  }),
  clearHiddenSubstrateClasses: () => set({ hiddenSubstrateClasses: new Set<string>() }),
  efhOverlayEnabled: false,
  setEfhOverlayEnabled: (enabled) =>
    set(enabled ? { efhOverlayEnabled: true } : { efhOverlayEnabled: false, selectedEfh: null }),
  selectedEfh: null,
  setSelectedEfh: (p) => set({ selectedEfh: p }),
  hiddenEfhSpecies: new Set<string>(),
  toggleEfhSpecies: (commonName) => set((state) => {
    const next = new Set(state.hiddenEfhSpecies);
    if (next.has(commonName)) next.delete(commonName);
    else next.add(commonName);
    const sel = state.selectedEfh;
    const clearSel = sel && next.has(sel.commonName ?? "");
    return clearSel
      ? { hiddenEfhSpecies: next, selectedEfh: null }
      : { hiddenEfhSpecies: next };
  }),
  clearHiddenEfhSpecies: () => set({ hiddenEfhSpecies: new Set<string>() }),
  findDataPanelOpen: false,
  setFindDataPanelOpen: (open) => set({ findDataPanelOpen: open }),
  windOverlayActive: readLocalBool("bathyscan:windOverlayActive", false),
  setWindOverlayActive: (b) => {
    writeLocalBool("bathyscan:windOverlayActive", b);
    set({ windOverlayActive: b });
  },
  tideOverlayActive: readLocalBool("bathyscan:tideOverlayActive", false),
  setTideOverlayActive: (b) => {
    writeLocalBool("bathyscan:tideOverlayActive", b);
    set({ tideOverlayActive: b });
  },
  currentOverlayActive: readLocalBool("bathyscan:currentOverlayActive", false),
  setCurrentOverlayActive: (b) => {
    writeLocalBool("bathyscan:currentOverlayActive", b);
    set({ currentOverlayActive: b });
  },
  currentDepthLayers: readDepthLayers(["mid"]),
  setCurrentDepthLayers: (layers) => {
    const ordered = CURRENT_DEPTH_LAYERS.filter((l) => layers.includes(l));
    writeDepthLayers(ordered);
    set({ currentDepthLayers: ordered });
  },
  sidePaneCollapsed: readLocalBool("bathyscan:sidePaneCollapsed", false),
  setSidePaneCollapsed: (collapsed) => {
    writeLocalBool("bathyscan:sidePaneCollapsed", collapsed);
    set({ sidePaneCollapsed: collapsed });
  },
  toggleCurrentDepthLayer: (layer) => set((state) => {
    const has = state.currentDepthLayers.includes(layer);
    let next = has
      ? state.currentDepthLayers.filter((l) => l !== layer)
      : [...state.currentDepthLayers, layer];
    // Keep at least one layer selected so the overlay still has something to render.
    if (next.length === 0) next = [layer];
    const ordered = CURRENT_DEPTH_LAYERS.filter((l) => next.includes(l));
    writeDepthLayers(ordered);
    return { currentDepthLayers: ordered };
  }),
}));
