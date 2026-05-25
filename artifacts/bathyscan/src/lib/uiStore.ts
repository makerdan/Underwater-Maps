import { create } from "zustand";

export interface DropInTarget {
  worldX: number;
  worldZ: number;
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
  /** Show CMECS substrate colour mode on the terrain mesh (overrides depth colormap). */
  substrateColorMode: boolean;
  setSubstrateColorMode: (enabled: boolean) => void;
  /** Show EFH zone polygon outlines in the 3D scene. */
  efhOverlayEnabled: boolean;
  setEfhOverlayEnabled: (enabled: boolean) => void;
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
  setSubstrateColorMode: (enabled) => set({ substrateColorMode: enabled }),
  efhOverlayEnabled: false,
  setEfhOverlayEnabled: (enabled) => set({ efhOverlayEnabled: enabled }),
}));
