import { create } from "zustand";
import type { DepthLayer } from "@/components/TidalCurrentArrows";

export const CURRENT_DEPTH_LAYERS: DepthLayer[] = ["surface", "mid", "near-bottom"];

export interface DropInTarget {
  worldX: number;
  worldZ: number;
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
  /** Show EFH zone polygon outlines in the 3D scene. */
  efhOverlayEnabled: boolean;
  setEfhOverlayEnabled: (enabled: boolean) => void;
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
  setMarkerFormOpen: (open) => set({ markerFormOpen: open }),
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
  efhOverlayEnabled: false,
  setEfhOverlayEnabled: (enabled) => set({ efhOverlayEnabled: enabled }),
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
