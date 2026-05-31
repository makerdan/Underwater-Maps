import { create } from "zustand";

interface OfflineState {
  isOnline: boolean;
  setOnline: (v: boolean) => void;
}

export const useOfflineStore = create<OfflineState>((set) => ({
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  setOnline: (v) => set({ isOnline: v }),
}));

if (typeof window !== "undefined") {
  window.addEventListener("online", () => useOfflineStore.getState().setOnline(true));
  window.addEventListener("offline", () => useOfflineStore.getState().setOnline(false));
}
