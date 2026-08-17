/**
 * offlineScopeStore — tiny zustand store carrying a *pending* offline-download
 * scope request from any library entry point (folder row, collection row,
 * folder-tree multi-select, "⬇ All") to the single BulkOfflinePanel host in
 * DatasetPanel.
 *
 * Entry-point components call `useOfflineScopeStore.getState().requestScopeDownload(...)`
 * imperatively — no prop drilling through MySavesSection/CollectionsSection —
 * and DatasetPanel subscribes to `pendingScope` to open the panel.
 */
import { create } from "zustand";
import type { OfflineScope } from "./offlineScopeResolver";

interface OfflineScopeState {
  /** Scope the user asked to download, or null when no panel is open. */
  pendingScope: OfflineScope | null;
  requestScopeDownload: (scope: OfflineScope) => void;
  clearScope: () => void;
}

export const useOfflineScopeStore = create<OfflineScopeState>((set) => ({
  pendingScope: null,
  requestScopeDownload: (scope) => set({ pendingScope: scope }),
  clearScope: () => set({ pendingScope: null }),
}));
