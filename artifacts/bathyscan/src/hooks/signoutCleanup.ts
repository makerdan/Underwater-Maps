/**
 * signoutCleanup.ts — the single sign-out isolation routine.
 *
 * `performSignOutCleanup()` is called by useServerSettingsSync when the Clerk
 * session transitions signed-in → signed-out. It resets every Zustand store
 * that holds ephemeral per-user session state and removes every raw
 * localStorage key that contains user-specific data, so a different user
 * signing in on the same device starts from a clean slate.
 *
 * ── MANIFEST CONVENTION ──────────────────────────────────────────────────────
 * When adding a store reset or localStorage removal here, also update
 * signoutManifest.ts. The guard test (src/__tests__/signout-manifest.test.ts)
 * mechanically enforces that this routine and the manifest stay in sync:
 *  - every `cleared: true` key in SIGNOUT_LOCALSTORAGE_MANIFEST must actually
 *    be removed by this function, and
 *  - every store in SIGNOUT_STORE_MANIFEST must expose its reset action.
 *
 * It lives in its own module (not inside useServerSettingsSync.ts) so the
 * guard test can invoke it directly against the real stores without mocking
 * the Clerk/api-client machinery the hook needs.
 */

import { useSettingsStore } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import {
  usePanelCollapseStore,
  DEFAULTS as PANEL_DEFAULTS,
} from "@/lib/panelCollapseStore";
import { useDriftStore } from "@/lib/driftStore";
import { useTrailStore } from "@/lib/trailStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useLiveModeStore } from "@/lib/liveMode";

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore — storage may be unavailable in some environments */
  }
}

function safeRemoveByPrefix(prefix: string): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keysToRemove.push(key);
    }
    for (const key of keysToRemove) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Reset all per-user client state at sign-out. Synchronous; safe to call in
 * any environment with a (possibly stubbed) localStorage.
 */
export function performSignOutCleanup(): void {
  // Live mode first: exits the live orchestration (cancels GPS retry timers,
  // unsubscribes listeners, pauses a live-started trail recording, disables
  // Follow Me) before the stores it touches are hard-reset below.
  useLiveModeStore.getState().resetForSignOut();

  // settingsStore — clearForSignOut() also removes "bathyscan:settings".
  useSettingsStore.getState().clearForSignOut();

  // Colour palette. The caller (useServerSettingsSync) realigns its acked
  // palette rev immediately after this function returns.
  usePaletteStore.getState().reset();
  safeRemove("bathyscan:palette");

  // Panel collapse layout.
  usePanelCollapseStore.setState({ collapsed: { ...PANEL_DEFAULTS } });
  safeRemove("bathyscan:panel-collapse");

  // Zone-overlay colour slots (both water types + the legacy pre-split key).
  safeRemove("bathyscan:zoneOverlaySlots:saltwater");
  safeRemove("bathyscan:zoneOverlaySlots:freshwater");
  safeRemove("bathyscan:zoneOverlaySlots");

  // Drift planner: saved plans, positional session state, and per-user prefs.
  useDriftStore.getState().resetForSignOut();
  safeRemove("bathyscan:savedDriftPlans");
  safeRemove("bathyscan:driftPlannerActive");
  safeRemove("bathyscan:boatProfileId");

  // GPS trail recording + camera/follow position traces (audit F-001).
  useTrailStore.getState().resetForSignOut();
  useCameraStore.getState().resetForSignOut();

  // AppProvider-held prefs (audit F-004). The in-memory values live in React
  // state inside AppProvider (src/lib/context.tsx) which stays mounted across
  // sign-out; clearing the persisted copies guarantees the next session that
  // hydrates from storage gets defaults instead of the previous user's prefs.
  safeRemove("bathyscan:realisticMode");
  safeRemove("bathyscan:boatSpeedMph");

  // Overview Map puzzle layout (localStorage + its sessionStorage twin).
  safeRemove("bathyscan:puzzleTransforms");
  safeRemove("bathyscan:puzzleGroups");
  try {
    sessionStorage.removeItem("bathyscan:puzzleTransforms");
    sessionStorage.removeItem("bathyscan:puzzleGroups");
  } catch {
    /* ignore */
  }

  // AI query history + cached offline identity banner data.
  safeRemove("bsquery-history");
  safeRemove("bathyscan-offline-identity-v1");

  // GPS column-mapping fingerprints (bathyscan:colmap:*).
  safeRemoveByPrefix("bathyscan:colmap:");
}
