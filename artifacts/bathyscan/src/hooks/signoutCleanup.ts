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
import { useDriveBoatStore } from "@/lib/driveBoatStore";
import { useSpecialCollectionStore } from "@/lib/specialCollectionStore";
import { usePuzzleStore } from "@/lib/puzzleStore";
import { useUiStore } from "@/lib/uiStore";

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

  // Drive Boat session state (heading lock, route following, distance counter)
  // and UI prefs (realisticMode, boatSpeedMph). resetForSignOut() resets all
  // in-memory fields to defaults and removes the two localStorage keys so the
  // AppProvider (which now reads these from the store) reflects defaults
  // immediately — without requiring a page reload.
  useDriveBoatStore.getState().resetForSignOut();

  // Active special collection (per-account server data: reference image,
  // geo-anchors, layout revisions) and any queued puzzle-layout restore.
  useSpecialCollectionStore.getState().resetForSignOut();

  // Live puzzle layout state: wipe the puzzleStore mirror (3D marker
  // geography) and bump its signOutNonce so a MOUNTED OverviewMap clears its
  // component-local transforms/groups/selection too — otherwise the previous
  // account's layout survives in the live component until unmount. Also clear
  // the uiStore geo-transform mirror directly so it is clean even when
  // OverviewMap is not mounted.
  usePuzzleStore.getState().resetForSignOut();
  useUiStore.getState().setPuzzleGeoTransforms(new Map());

  // Overview Map puzzle layout (localStorage + its sessionStorage twin).
  safeRemove("bathyscan:puzzleTransforms");
  safeRemove("bathyscan:puzzleGroups");
  safeRemove("bathyscan:puzzleLayouts:event");
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
