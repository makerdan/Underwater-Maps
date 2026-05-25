import { create } from "zustand";

interface OfflineState {
  isOnline: boolean;
  setOnline: (v: boolean) => void;
}

export const useOfflineStore = create<OfflineState>((set) => ({
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  setOnline: (v) => set({ isOnline: v }),
}));
