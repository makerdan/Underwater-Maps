/**
 * catchJournalStore — controls the Catch Journal panel.
 *
 * Opened from a marker's context menu ("Catch journal"), from the marker
 * edit form, or from the seafloor right-click "Log a catch here" flow (which
 * first creates a marker via the marker form, then auto-opens the journal
 * for the newly created marker via `pendingOpenForNewMarker`).
 * Holds the marker whose catches are being viewed/edited.
 */
import { create } from "zustand";
import type { Marker } from "@workspace/api-client-react";

interface CatchJournalStore {
  marker: Marker | null;
  /**
   * Set by the terrain context menu's "Log a catch here" action before the
   * marker form opens. When the marker is created, the form opens the catch
   * journal for it and clears this flag. Cancelling the form also clears it.
   */
  pendingOpenForNewMarker: boolean;
  open: (marker: Marker) => void;
  close: () => void;
  setPendingOpenForNewMarker: (pending: boolean) => void;
}

export const useCatchJournalStore = create<CatchJournalStore>((set) => ({
  marker: null,
  pendingOpenForNewMarker: false,
  open: (marker) => set({ marker, pendingOpenForNewMarker: false }),
  close: () => set({ marker: null }),
  setPendingOpenForNewMarker: (pending) =>
    set({ pendingOpenForNewMarker: pending }),
}));
