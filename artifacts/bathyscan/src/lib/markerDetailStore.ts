import { create } from "zustand";
import type { Marker } from "@workspace/api-client-react";

interface MarkerDetailStore {
  marker: Marker | null;
  show: (marker: Marker) => void;
  hide: () => void;
}

export const useMarkerDetailStore = create<MarkerDetailStore>((set) => ({
  marker: null,
  show: (marker) => set({ marker }),
  hide: () => set({ marker: null }),
}));
