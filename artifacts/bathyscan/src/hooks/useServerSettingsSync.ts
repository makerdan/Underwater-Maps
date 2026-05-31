/**
 * useServerSettingsSync — app-root hook for two-way settings synchronisation.
 *
 * Mounts once at the app root (inside the signed-in guard) so that:
 *
 *   GET:  On sign-in (or initial mount) the server's stored settings are
 *         fetched and applied via hydrateFromServer. panelCollapse and palette
 *         state are hydrated from the same payload so the layout is restored
 *         on every device without requiring the user to open Settings.
 *
 *   PUT:  Any change to settingsStore, paletteStore, or panelCollapseStore
 *         triggers a 300 ms debounced PUT /api/settings so the server stays
 *         in sync even when the Settings page is never opened.
 *
 * A module-level `flushServerSync` function is exported so the Settings page
 * can call an immediate (non-debounced) PUT when the user clicks a section
 * Save button, without requiring prop-drilling or a separate React context.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useUser } from "@/lib/clerkCompat";
import {
  useGetSettings,
  usePutSettings,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { useSettingsStore, getDataSnapshot } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { usePanelCollapseStore, type PanelId } from "@/lib/panelCollapseStore";
import { useZoneOverlayStore } from "@/lib/zoneOverlayStore";

// ─── Module-level flush ref ───────────────────────────────────────────────────
// Populated by the hook on every render so Settings can always call the most
// recent flush function, even after re-renders.
let _flush: (() => Promise<void>) | null = null;

/**
 * Immediately flush any pending debounced PUT and wait for it to complete.
 * Resolves once the server acknowledges the save (or immediately when the
 * user is signed out — localStorage persistence is synchronous).
 * Returns a no-op promise if the hook has not been mounted yet.
 */
export function flushServerSync(): Promise<void> {
  return _flush ? _flush() : Promise.resolve();
}

// ─── Module-level pending / in-flight tracking ───────────────────────────────
// These flags let E2E test helpers determine whether a sync is currently
// outstanding without coupling to React internals.
//
//  _pendingDebounce — true once scheduleSync arms a debounce timer; cleared
//                     when the timer fires and flush() takes over.
//  _flushInFlight   — true while flush()'s async PUT is in progress; cleared
//                     in the finally block so it resets even on error.
//
// Reading either flag from window.__bathyTest.waitForServerSettingsSync lets
// the helper resolve immediately when nothing is pending (no mutation happened,
// or the server already acknowledged the write before the helper was called)
// rather than timing out after 5 s.
let _pendingDebounce = false;
let _flushInFlight = false;

/** True when a debounce timer is armed OR a PUT is currently in flight. */
export function hasPendingOrInFlightSettingsSync(): boolean {
  return _pendingDebounce || _flushInFlight;
}

// ─── Payload builder (pure function of store state) ───────────────────────────
function buildPayload(): Record<string, unknown> {
  const {
    hydrateFromServer: _h,
    resetSection: _rs,
    resetAll: _ra,
    markAllSaved: _mas,
    setDatasetHome: _sd,
    clearDatasetHome: _cd,
    datasetHomePositions: _dhp,
    syncedSnapshot: _ss,
    ...rest
  } = useSettingsStore.getState();
  const dataOnly: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v !== "function") dataOnly[k] = v;
  }
  const palette = usePaletteStore.getState();
  dataOnly.paletteShallow = palette.shallow;
  dataOnly.paletteDeep = palette.deep;
  dataOnly.customStops = palette.customStops;
  dataOnly.bandColors = palette.bandColors;
  dataOnly.bandBoundaries = palette.bandBoundaries;
  dataOnly.panelCollapse = usePanelCollapseStore.getState().collapsed;
  const zoneState = useZoneOverlayStore.getState();
  dataOnly.zoneOverlaySlots = {
    saltwater: zoneState.saltwater,
    freshwater: zoneState.freshwater,
  };
  return dataOnly;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
/**
 * Returns `{ settingsReady }` which is `true` once server settings have been
 * fetched and hydrated (or immediately when the user is not signed in). The
 * App.tsx startup auto-select effect waits for this before committing to a
 * dataset so the user's saved default preference is always respected.
 */
export function useServerSettingsSync(): { settingsReady: boolean } {
  const { isSignedIn } = useUser();
  const hydrateFromServer = useSettingsStore((s) => s.hydrateFromServer);
  const markAllSaved = useSettingsStore((s) => s.markAllSaved);
  const { mutateAsync: saveSettingsAsync } = usePutSettings();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracks whether the server-side settings have been received at least once.
  // Signed-out users don't fetch settings, so they are immediately ready.
  const [settingsReady, setSettingsReady] = useState<boolean>(() => isSignedIn === false);

  // When auth state resolves to "not signed in", mark ready immediately.
  useEffect(() => {
    if (isSignedIn === false) setSettingsReady(true);
  }, [isSignedIn]);

  // ── GET hydration ──────────────────────────────────────────────────────────
  const { data: serverSettings, isError: settingsFetchError } = useGetSettings({
    query: {
      enabled: !!isSignedIn,
      queryKey: getGetSettingsQueryKey(),
      refetchOnMount: "always",
      staleTime: 0,
      retry: false,
    },
  });

  // If the settings fetch fails (e.g. network error), mark ready so the app
  // doesn't wait forever — it will fall back to local defaults.
  useEffect(() => {
    if (settingsFetchError) setSettingsReady(true);
  }, [settingsFetchError]);

  useEffect(() => {
    if (!serverSettings) return;

    const serverRec = serverSettings as Record<string, unknown>;
    const serverUpdatedAt =
      typeof serverRec.__updatedAt === "string"
        ? (serverRec.__updatedAt as string)
        : undefined;
    const lastSyncedAt = useSettingsStore.getState().lastSyncedAt;
    const serverIsNewer =
      !lastSyncedAt ||
      (serverUpdatedAt !== undefined && serverUpdatedAt > lastSyncedAt);

    hydrateFromServer(serverSettings as Parameters<typeof hydrateFromServer>[0]);
    // Mark settings as ready after the first successful hydration so the
    // startup auto-select effect can proceed with the correct default dataset.
    setSettingsReady(true);

    if (serverIsNewer) {
      usePaletteStore.getState().hydrateFromServer({
        paletteShallow: serverRec.paletteShallow,
        paletteDeep: serverRec.paletteDeep,
        customStops: serverRec.customStops,
        bandColors: serverRec.bandColors,
        bandBoundaries: serverRec.bandBoundaries,
      });

      // Restore panel collapse layout from the server.
      if (serverRec.panelCollapse && typeof serverRec.panelCollapse === "object") {
        const { setCollapsed } = usePanelCollapseStore.getState();
        for (const [id, val] of Object.entries(
          serverRec.panelCollapse as Record<string, unknown>,
        )) {
          if (typeof val === "boolean") {
            setCollapsed(id as PanelId, val);
          }
        }
      }

      // Restore zone overlay colours and visibility from the server.
      // Accepts both the new { saltwater, freshwater } object and the
      // legacy flat array (treated as saltwater) for backward compatibility.
      if (serverRec.zoneOverlaySlots != null) {
        useZoneOverlayStore.getState().hydrateFromServer(serverRec.zoneOverlaySlots);
      }
    }
  }, [serverSettings, hydrateFromServer]);

  // ── Immediate flush ────────────────────────────────────────────────────────
  const flush = useCallback(async (): Promise<void> => {
    // Cancel any pending debounce — we're flushing now.
    _pendingDebounce = false;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!isSignedIn) {
      markAllSaved(null);
      return;
    }
    _flushInFlight = true;
    try {
      const data = buildPayload();
      const resp = await saveSettingsAsync({
        data: data as Parameters<typeof saveSettingsAsync>[0]["data"],
      });
      const serverStamp = (resp as Record<string, unknown> | undefined)
        ?.__updatedAt;
      markAllSaved(typeof serverStamp === "string" ? serverStamp : undefined);
    } finally {
      _flushInFlight = false;
    }
  }, [isSignedIn, saveSettingsAsync, markAllSaved]);

  // ── Debounced PUT subscription ─────────────────────────────────────────────
  const scheduleSync = useCallback(() => {
    if (!isSignedIn) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Signal that a write is outstanding so waitForServerSettingsSync knows
    // to poll rather than resolve immediately.
    _pendingDebounce = true;
    debounceRef.current = setTimeout(() => {
      _pendingDebounce = false; // flush() takes over from here
      void flush().catch(() => {
        /* keep dirty so the section Save button stays active */
      });
    }, 300);
  }, [isSignedIn, flush]);

  useEffect(() => {
    const palSnap = () => {
      const p = usePaletteStore.getState();
      return JSON.stringify({ s: p.shallow, d: p.deep, c: p.customStops, b: p.bandColors, bb: p.bandBoundaries });
    };
    const panelSnap = () =>
      JSON.stringify(usePanelCollapseStore.getState().collapsed);
    const zoneSnap = () => {
      const s = useZoneOverlayStore.getState();
      return JSON.stringify({ sw: s.saltwater, fw: s.freshwater });
    };

    let lastSettings = JSON.stringify(getDataSnapshot());
    let lastPalette = palSnap();
    let lastPanel = panelSnap();
    let lastZone = zoneSnap();

    const unsubSettings = useSettingsStore.subscribe(() => {
      const cur = JSON.stringify(getDataSnapshot());
      if (cur !== lastSettings) {
        lastSettings = cur;
        scheduleSync();
      }
    });
    const unsubPalette = usePaletteStore.subscribe(() => {
      const cur = palSnap();
      if (cur !== lastPalette) {
        lastPalette = cur;
        scheduleSync();
      }
    });
    const unsubPanel = usePanelCollapseStore.subscribe(() => {
      const cur = panelSnap();
      if (cur !== lastPanel) {
        lastPanel = cur;
        scheduleSync();
      }
    });
    const unsubZone = useZoneOverlayStore.subscribe(() => {
      const cur = zoneSnap();
      if (cur !== lastZone) {
        lastZone = cur;
        scheduleSync();
      }
    });

    return () => {
      unsubSettings();
      unsubPalette();
      unsubPanel();
      unsubZone();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [scheduleSync]);

  // Publish the current flush function so Settings can call it synchronously.
  // Done in an effect so the module-level variable is only updated after the
  // render has committed — assigning it during render is unsafe in Concurrent Mode.
  useEffect(() => {
    _flush = flush;
  }, [flush]);

  return { settingsReady };
}
