import { create } from "zustand";

export interface DropInTarget {
  worldX: number;
  worldZ: number;
}

interface UiStore {
  pendingDropIn: DropInTarget | null;
  setPendingDropIn: (target: DropInTarget | null) => void;
  clearPendingDropIn: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  pendingDropIn: null,
  setPendingDropIn: (target) => set({ pendingDropIn: target }),
  clearPendingDropIn: () => set({ pendingDropIn: null }),
}));
