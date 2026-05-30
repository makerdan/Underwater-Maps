import { create } from "zustand";
import type { Marker } from "@workspace/api-client-react";

interface MarkerEditStore {
  marker: Marker | null;
  /** Returns true if it is safe to close (no unsaved changes, or user confirmed). */
  _beforeClose: (() => boolean) | null;
  open: (marker: Marker) => void;
  close: () => void;
  /** Respects the registered beforeClose guard. Use this for user-initiated closes. */
  requestClose: () => void;
  setBeforeClose: (fn: (() => boolean) | null) => void;
}

export const useMarkerEditStore = create<MarkerEditStore>((set, get) => ({
  marker: null,
  _beforeClose: null,

  open: (marker) => set({ marker }),

  close: () => set({ marker: null }),

  requestClose: () => {
    const guard = get()._beforeClose;
    if (guard && !guard()) return;
    set({ marker: null });
  },

  setBeforeClose: (fn) => set({ _beforeClose: fn }),
}));
