import { create } from "zustand";
import type { Marker } from "@workspace/api-client-react";

interface MarkerEditStore {
  marker: Marker | null;
  open: (marker: Marker) => void;
  close: () => void;
}

export const useMarkerEditStore = create<MarkerEditStore>((set) => ({
  marker: null,
  open: (marker) => set({ marker }),
  close: () => set({ marker: null }),
}));
