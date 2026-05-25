/**
 * webglContextStore — tracks WebGL context loss/restoration for the R3F Canvas.
 *
 * The browser can drop the WebGL context at any time (GPU process restart,
 * tab backgrounded too long, driver hiccup). When that happens we:
 *   - set `contextLost = true` so the scene shows a restoration overlay and
 *     can disable expensive interactions;
 *   - on restoration, bump `recoveryKey` so the scene subtree remounts and
 *     re-uploads all GPU-owned resources (geometries, materials, textures,
 *     particle buffers, drift path, water plane) from their CPU-side state
 *     without a full page reload.
 */
import { create } from "zustand";

interface WebglContextStore {
  contextLost: boolean;
  recoveryKey: number;
  markLost: () => void;
  markRestored: () => void;
}

export const useWebglContextStore = create<WebglContextStore>((set) => ({
  contextLost: false,
  recoveryKey: 0,
  markLost: () => set({ contextLost: true }),
  markRestored: () =>
    set((s) => ({ contextLost: false, recoveryKey: s.recoveryKey + 1 })),
}));
