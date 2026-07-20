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
 *
 * After MAX_RECOVERY_ATTEMPTS consecutive losses the store stops trying to
 * remount the scene (no more recoveryKey bumps) and sets
 * `contextPermanentlyLost` so the overlay can show a hard "reload" prompt.
 */
import { create } from "zustand";

const MAX_RECOVERY_ATTEMPTS = 3;

interface WebglContextStore {
  contextLost: boolean;
  recoveryKey: number;
  recoveryAttempts: number;
  contextPermanentlyLost: boolean;
  /**
   * True when the GPU supports linear filtering of float textures
   * (WebGL2 natively, or WebGL1 + OES_texture_float_linear extension).
   * Set once during scene initialisation via setFloatTextureLinear().
   * Defaults to true so behaviour is unchanged until the probe runs.
   */
  floatTextureLinear: boolean;
  markLost: () => void;
  markRestored: () => void;
  setFloatTextureLinear: (supported: boolean) => void;
}

export const useWebglContextStore = create<WebglContextStore>((set) => ({
  contextLost: false,
  recoveryKey: 0,
  recoveryAttempts: 0,
  contextPermanentlyLost: false,
  floatTextureLinear: true,
  setFloatTextureLinear: (supported: boolean) =>
    set({ floatTextureLinear: supported }),
  markLost: () =>
    set((s) => {
      const nextAttempts = s.recoveryAttempts + 1;
      if (nextAttempts > MAX_RECOVERY_ATTEMPTS) {
        return { contextLost: true, contextPermanentlyLost: true };
      }
      return { contextLost: true, recoveryAttempts: nextAttempts };
    }),
  markRestored: () =>
    set((s) => {
      if (s.contextPermanentlyLost) return {};
      // Reset recoveryAttempts so a successfully-recovered context does not
      // carry forward a stale attempt count. Without this, three losses each
      // followed by recovery would leave recoveryAttempts=3, causing the very
      // next loss to exceed MAX_RECOVERY_ATTEMPTS and incorrectly show the
      // hard "reload required" overlay even though all prior losses recovered.
      return { contextLost: false, recoveryKey: s.recoveryKey + 1, recoveryAttempts: 0 };
    }),
}));
