/**
 * paletteStore — persisted user-customised depth colour palette.
 *
 * The depth colormap has four stops (shallow → mid1 → mid2 → deep). Users
 * can customise the shallow and deep endpoints from the Settings page; the
 * two interior stops stay fixed so the gradient keeps its characteristic
 * blue-to-indigo shape.
 *
 * Persisted to localStorage under "bathyscan:palette".
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DEFAULT_SHALLOW = "#00e5ff";
export const DEFAULT_DEEP = "#283593";

/** Fixed interior gradient stops. Not user-editable. */
export const MID1_HEX = "#0d47a1";
export const MID2_HEX = "#1a237e";

/**
 * Curated preset palettes for one-click selection. Each preset defines a
 * shallow and deep endpoint; the fixed interior stops keep the gradient
 * cohesive with the rest of the app.
 */
export interface PalettePreset {
  id: string;
  label: string;
  shallow: string;
  deep: string;
}

export const PALETTE_PRESETS: PalettePreset[] = [
  { id: "default", label: "Default Ocean", shallow: DEFAULT_SHALLOW, deep: DEFAULT_DEEP },
  { id: "high-contrast", label: "High-Contrast", shallow: "#ffeb3b", deep: "#000000" },
  { id: "warm", label: "Warm Shallows", shallow: "#ffd54f", deep: "#4a148c" },
];

interface PaletteStore {
  shallow: string;
  deep: string;
  setShallow: (hex: string) => void;
  setDeep: (hex: string) => void;
  reset: () => void;
}

export const usePaletteStore = create<PaletteStore>()(
  persist(
    (set) => ({
      shallow: DEFAULT_SHALLOW,
      deep: DEFAULT_DEEP,
      setShallow: (hex) => set({ shallow: hex }),
      setDeep: (hex) => set({ deep: hex }),
      reset: () => set({ shallow: DEFAULT_SHALLOW, deep: DEFAULT_DEEP }),
    }),
    { name: "bathyscan:palette" },
  ),
);
