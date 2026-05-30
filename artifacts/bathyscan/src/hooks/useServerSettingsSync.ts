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

import { useEffect, useRef, useCallback } from "react";
import { useUser } from "@/lib/clerkCompat";
import {
  useGetSettings,
  usePutSettings,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { useSettingsStore, getDataSnapshot } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { usePanelCollapseStore, type PanelId } from "@/lib/panelCollapseStore";

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
  dataOnly.panelCollapse = usePanelCollapseStore.getState().collapsed;
  return dataOnly;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useServerSettingsSync(): void {
  const { isSignedIn } = useUser();
  const hydrateFromServer = useSettingsStore((s) => s.hydrateFromServer);
  const markAllSaved = useSettingsStore((s) => s.markAllSaved);
  const { mutateAsync: saveSettingsAsync } = usePutSettings();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── GET hydration ──────────────────────────────────────────────────────────
  const { data: serverSettings } = useGetSettings({
    query: {
      enabled: !!isSignedIn,
      queryKey: getGetSettingsQueryKey(),
      refetchOnMount: "always",
      staleTime: 0,
      retry: false,
    },
  });

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

    if (serverIsNewer) {
      usePaletteStore.getState().hydrateFromServer({
        paletteShallow: serverRec.paletteShallow,
        paletteDeep: serverRec.paletteDeep,
        customStops: serverRec.customStops,
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
    }
  }, [serverSettings, hydrateFromServer]);

  // ── Immediate flush ────────────────────────────────────────────────────────
  const flush = useCallback(async (): Promise<void> => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!isSignedIn) {
      markAllSaved(null);
      return;
    }
    const data = buildPayload();
    const resp = await saveSettingsAsync({
      data: data as Parameters<typeof saveSettingsAsync>[0]["data"],
    });
    const serverStamp = (resp as Record<string, unknown> | undefined)
      ?.__updatedAt;
    markAllSaved(typeof serverStamp === "string" ? serverStamp : undefined);
  }, [isSignedIn, saveSettingsAsync, markAllSaved]);

  // ── Debounced PUT subscription ─────────────────────────────────────────────
  const scheduleSync = useCallback(() => {
    if (!isSignedIn) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void flush().catch(() => {
        /* keep dirty so the section Save button stays active */
      });
    }, 300);
  }, [isSignedIn, flush]);

  useEffect(() => {
    const palSnap = () => {
      const p = usePaletteStore.getState();
      return JSON.stringify({ s: p.shallow, d: p.deep, c: p.customStops });
    };
    const panelSnap = () =>
      JSON.stringify(usePanelCollapseStore.getState().collapsed);

    let lastSettings = JSON.stringify(getDataSnapshot());
    let lastPalette = palSnap();
    let lastPanel = panelSnap();

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

    return () => {
      unsubSettings();
      unsubPalette();
      unsubPanel();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [scheduleSync]);

  // Publish the current flush function so Settings can call it synchronously.
  _flush = flush;
}
