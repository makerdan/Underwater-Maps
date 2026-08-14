import { create } from "zustand";

interface OfflineState {
  isOnline: boolean;
  setOnline: (v: boolean) => void;
  /** True when the Clerk session token expired while the device was offline.
   *  In this state the app renders cached data read-only and shows the
   *  OfflineReadOnlyBanner instead of the SessionExpiredBanner.
   *  Cleared automatically when the device reconnects and a token is obtained.
   */
  isOfflineReadOnly: boolean;
  setOfflineReadOnly: (v: boolean) => void;
}

export const useOfflineStore = create<OfflineState>((set) => ({
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  setOnline: (v) => set({ isOnline: v }),
  isOfflineReadOnly: false,
  setOfflineReadOnly: (v) => set({ isOfflineReadOnly: v }),
}));

if (typeof window !== "undefined") {
  window.addEventListener("online", () => useOfflineStore.getState().setOnline(true));
  window.addEventListener("offline", () => useOfflineStore.getState().setOnline(false));
}
