import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PanelId =
  | "datasets"
  | "zoneOverlay"
  | "habitat"
  | "cameraCoords"
  | "keyboardShortcuts"
  | "tide"
  | "overlaysTools"
  | "mapData"
  | "conditions"
  | "driftRoute"
  | "forecast"
  | "seafloorClassification"
  | "markersAccordion"
  | "uploadTerrainAccordion"
  | "routes"
  | "myLibrary"
  // ── Per-panel Advanced section collapse keys (default: collapsed) ──────────
  | "overlaysToolsAdvanced"
  | "tidePanelAdvanced"
  | "currentsPanelAdvanced"
  | "habitatAdvanced"
  | "seafloorAdvanced";

interface PanelCollapseStore {
  collapsed: Record<PanelId, boolean>;
  toggle: (id: PanelId) => void;
  setCollapsed: (id: PanelId, value: boolean) => void;
}

export const DEFAULTS: Record<PanelId, boolean> = {
  datasets: false,
  zoneOverlay: false,
  habitat: false,
  cameraCoords: false,
  keyboardShortcuts: true,
  tide: false,
  overlaysTools: false,
  mapData: false,
  conditions: false,
  driftRoute: false,
  forecast: false,
  seafloorClassification: false,
  markersAccordion: true,
  uploadTerrainAccordion: true,
  routes: false,
  myLibrary: false,
  // Advanced sub-sections — collapsed by default on first use
  overlaysToolsAdvanced: true,
  tidePanelAdvanced: true,
  currentsPanelAdvanced: true,
  habitatAdvanced: true,
  seafloorAdvanced: true,
};

export const PANEL_IDS = Object.keys(DEFAULTS) as PanelId[];

export const usePanelCollapseStore = create<PanelCollapseStore>()(
  persist(
    (set) => ({
      collapsed: { ...DEFAULTS },
      toggle: (id) =>
        set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),
      setCollapsed: (id, value) =>
        set((s) => ({ collapsed: { ...s.collapsed, [id]: value } })),
    }),
    {
      name: "bathyscan:panel-collapse",
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PanelCollapseStore>;
        return {
          ...current,
          ...p,
          collapsed: { ...DEFAULTS, ...(p.collapsed ?? {}) },
        };
      },
    },
  ),
);
