import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PanelId =
  | "datasets"
  | "zoneOverlay"
  | "habitat"
  | "cameraCoords"
  | "keyboardShortcuts"
  | "tide"
  | "overlaysTools";

interface PanelCollapseStore {
  collapsed: Record<PanelId, boolean>;
  toggle: (id: PanelId) => void;
  setCollapsed: (id: PanelId, value: boolean) => void;
}

const DEFAULTS: Record<PanelId, boolean> = {
  datasets: false,
  zoneOverlay: false,
  habitat: false,
  cameraCoords: false,
  keyboardShortcuts: true,
  tide: false,
  overlaysTools: false,
};

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
