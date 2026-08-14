/**
 * useCrossTabSync — passive cross-tab storage synchronisation.
 *
 * Listens for the browser `storage` event (fired only in OTHER tabs, never in
 * the one that wrote the value) and re-hydrates each affected Zustand store so
 * that a change made in Tab A is reflected in Tab B within one browser event
 * loop tick.
 *
 * ## Covered stores
 *
 * | Key                                       | Store                   | Mechanism                    |
 * |-------------------------------------------|-------------------------|------------------------------|
 * | bathyscan:settings                        | useSettingsStore        | persist.rehydrate()          |
 * | bathyscan:palette                         | usePaletteStore         | persist.rehydrate()          |
 * | bathyscan:panel-collapse                  | usePanelCollapseStore   | persist.rehydrate()          |
 * | bathyscan-help-window                     | useHelpStore            | persist.rehydrate()          |
 * | bathyscan:savedDriftPlans                 | useDriftStore           | reloadSavedPlans()           |
 * | bathyscan:zoneOverlaySlots:saltwater      | useZoneOverlayStore     | reloadFromStorage()          |
 * | bathyscan:zoneOverlaySlots:freshwater     | useZoneOverlayStore     | reloadFromStorage()          |
 *
 * ## Loop-safety
 *
 * Zustand's `persist.rehydrate()` reads from storage and updates in-memory
 * state without writing back to localStorage. The browser's `storage` event
 * is ONLY dispatched in other tabs (not the one that called setItem), so there
 * is no feedback loop: the originating tab never re-fires its own event.
 *
 * ## Server-hydration guard
 *
 * Writes that come from `applySettingsToUiStore` / the `_suppressMirror` path
 * originate from a GET /api/settings response, not from user interaction in
 * another tab. They write to the same localStorage keys, so this hook will
 * re-hydrate the OTHER tab on that event — which is the correct behaviour:
 * if the server just told Tab A to update, Tab B should also pick it up.
 *
 * ## Key removal (sign-out)
 *
 * When a tab clears localStorage on sign-out (e.key exists, e.newValue === null)
 * we intentionally skip re-hydration so the receiving tab is not force-reset
 * to defaults mid-session.
 *
 * ## Mount point
 *
 * This hook is mounted once inside the `Main` component in App.tsx so that
 * it is active for the full authenticated session lifetime.
 */
import { useEffect } from "react";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import { useHelpStore } from "@/lib/helpStore";
import { useDriftStore } from "@/lib/driftStore";
import { useZoneOverlayStore } from "@/lib/zoneOverlayStore";

/** Keys whose changes trigger a full zoneOverlayStore reload from localStorage. */
const ZONE_OVERLAY_KEYS = new Set([
  "bathyscan:zoneOverlaySlots:saltwater",
  "bathyscan:zoneOverlaySlots:freshwater",
]);

export function useCrossTabSync(): void {
  useEffect(() => {
    function handleStorage(e: StorageEvent): void {
      // A null newValue means the key was removed (e.g. on sign-out).
      // Skip re-hydration so the receiving tab is not force-reset to defaults.
      if (e.newValue === null) return;

      const key = e.key;
      if (!key) return;

      switch (key) {
        case "bathyscan:settings":
          useSettingsStore.persist.rehydrate();
          break;

        case "bathyscan:palette":
          usePaletteStore.persist.rehydrate();
          break;

        case "bathyscan:panel-collapse":
          usePanelCollapseStore.persist.rehydrate();
          break;

        case "bathyscan-help-window":
          useHelpStore.persist.rehydrate();
          break;

        case "bathyscan:savedDriftPlans":
          useDriftStore.getState().reloadSavedPlans();
          break;

        case "bathyscan:driftPlannerActive":
          // newValue is "true" | "false" — parse to boolean before applying.
          useDriftStore.getState().setDriftPlannerActive(e.newValue === "true");
          break;

        case "bathyscan:boatProfileId":
          // newValue is a raw string id; pass through directly.
          useDriftStore.getState().setBoatProfileId(e.newValue);
          break;

        default:
          if (ZONE_OVERLAY_KEYS.has(key)) {
            useZoneOverlayStore.getState().reloadFromStorage();
          }
          break;
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
}
