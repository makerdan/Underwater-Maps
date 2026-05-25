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
