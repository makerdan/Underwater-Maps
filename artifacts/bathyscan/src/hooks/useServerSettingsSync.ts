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

import { useEffect, useRef, useCallback, useState, createElement, type ElementType } from "react";
import { useUser } from "@/lib/clerkCompat";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import {
  useGetSettings,
  usePutSettings,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { useSettingsStore, getDataSnapshot } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { usePanelCollapseStore, type PanelId, DEFAULTS as PANEL_DEFAULTS } from "@/lib/panelCollapseStore";
import { useZoneOverlayStore } from "@/lib/zoneOverlayStore";
import { useUiStore, CURRENT_DEPTH_LAYERS } from "@/lib/uiStore";
import type { DepthLayer } from "@/components/TidalCurrentArrows";

// ─── Singleton mount guard ────────────────────────────────────────────────────
// useServerSettingsSync must be mounted exactly once in the app tree. Multiple
// active instances would each maintain independent debounce timers, revision
// counters, and flush callbacks — the module-level vars (_flush, _scheduleSync,
// revision counters) are shared and last-writer-wins, so the second instance
// silently clobbers the first's flush ref, creating a TOCTOU race on every PUT.
let _hookMountCount = 0;

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

// ─── Module-level scheduleSync ref ────────────────────────────────────────────
// Populated by the hook so external callers (e.g. useLastSessionServerSync) can
// enqueue a debounced settings PUT through the *same* writer path, eliminating
// TOCTOU races that arise when two independent PUT requests write concurrently.
let _scheduleSync: (() => void) | null = null;

/**
 * Enqueue a debounced settings PUT through the canonical sync path.
 * Call this whenever a settings field changes outside the hook's own
 * subscriber (e.g. lastSession from useLastSessionServerSync) so all
 * writes are serialised through a single debounced flush, preventing
 * concurrent PUT races that can cause last-writer-wins data loss.
 *
 * No-op if the hook has not been mounted yet or the user is signed out.
 */
export function requestSettingsSync(): void {
  _scheduleSync?.();
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

// ─── Consecutive flush failure tracking ──────────────────────────────────────
// Counts how many debounce-triggered flush() calls have failed back-to-back.
// Reset to 0 on any successful PUT. When it reaches the threshold the sync
// loop backs off and a toast is shown so the user knows their settings are not
// being persisted. The counter is also reset whenever back-off is entered so
// the threshold check stays accurate across the retry cycle.
let _consecutiveFlushFailures = 0;
const FLUSH_FAILURE_TOAST_THRESHOLD = 3;

// ─── Back-off state ───────────────────────────────────────────────────────────
// After FLUSH_FAILURE_TOAST_THRESHOLD consecutive failures the sync loop enters
// back-off: scheduleSync() becomes a no-op and a retry is scheduled after an
// exponential delay (30 s → 60 s → 120 s, then capped). The user can bypass
// the timer at any time with the "Retry now" toast action.
let _inBackOff = false;
let _backOffStep = 0;
let _backOffTimerId: ReturnType<typeof setTimeout> | null = null;
const BACK_OFF_DELAYS = [30_000, 60_000, 120_000] as const;

// Forward declaration — implemented below after _flush is declared.
function _retryNow(): void {
  _inBackOff = false;
  if (_backOffTimerId) {
    clearTimeout(_backOffTimerId);
    _backOffTimerId = null;
  }
  if (!_flush) return;
  void _flush().catch(() => {
    _enterBackOff();
  });
}

function _enterBackOff(): void {
  _inBackOff = true;
  _consecutiveFlushFailures = 0;

  const delay = BACK_OFF_DELAYS[Math.min(_backOffStep, BACK_OFF_DELAYS.length - 1)]!;
  _backOffStep = Math.min(_backOffStep + 1, BACK_OFF_DELAYS.length - 1);

  // Build the action element imperatively so this .ts file stays JSX-free.
  // The dismiss ref trick lets the click handler close the toast it belongs to.
  // Cast ToastAction to React.ElementType to avoid the TS forwardRef prop-shape
  // mismatch that arises when createElement's overloads are resolved against a
  // ForwardRefExoticComponent — the runtime behaviour is identical.
  let toastDismiss: (() => void) | null = null;
  const handleRetry = () => {
    toastDismiss?.();
    _retryNow();
  };
  const { dismiss } = toast({
    title: "Settings not saving",
    description:
      "Your settings could not be saved to the server. " +
      "Retrying automatically — or tap 'Retry now' to try immediately.",
    variant: "destructive",
    duration: 10_000,
    action: createElement(
      ToastAction as ElementType,
      { altText: "Retry now", onClick: handleRetry },
      "Retry now",
    ),
  });
  toastDismiss = dismiss;

  if (_backOffTimerId) clearTimeout(_backOffTimerId);
  _backOffTimerId = setTimeout(() => {
    _backOffTimerId = null;
    _retryNow();
  }, delay);
}

// ─── Hydration / ordering guards ─────────────────────────────────────────────
//  _hydrating        — true while the GET effect is applying server values to
//                      the local stores. The store subscriptions below check
//                      it so hydration never echoes a spurious PUT (which
//                      could carry pre-edit values and clobber the server or
//                      be captured by tests as "the" save).
//  _serverSettled    — true once the initial server state is known (first GET
//                      applied, GET errored, or user signed out). flush()
//                      waits for this so a full-state PUT can never send
//                      un-hydrated local defaults over newer server values.
//  _ackedPaletteRev  — the paletteStore.rev last acknowledged by the server
//                      (via a successful PUT) or observed at hydration time.
//                      When the live rev is ahead of this, the palette has
//                      unflushed local edits and GET responses must NOT
//                      hydrate (clobber) the palette.
let _hydrating = false;
let _serverSettled = false;
let _ackedPaletteRev = 0;

// Per-store local-edit revision counters (same idea as paletteStore.rev but
// tracked here because those stores have no built-in counter). The store
// subscriptions below bump the edit rev on every genuine local change
// (hydration is excluded via _hydrating). flush() acknowledges the revs it
// captured once the server accepts the PUT. While an edit rev is ahead of
// its acked rev, GET responses must NOT hydrate (clobber) that store.
let _settingsEditRev = 0;
let _ackedSettingsRev = 0;
let _panelEditRev = 0;
let _ackedPanelRev = 0;
let _zoneEditRev = 0;
let _ackedZoneRev = 0;

/** True when a debounce timer is armed OR a PUT is currently in flight. */
export function hasPendingOrInFlightSettingsSync(): boolean {
  return _pendingDebounce || _flushInFlight;
}

// ─── Singleton guard ──────────────────────────────────────────────────────────
// These module-level mutable variables are shared across all invocations of the
// hook. Mounting the hook more than once (e.g. during hot-reload, Strict Mode
// double-invoke, or a test that forgets to unmount) produces incorrect
// concurrency behaviour: two flush paths can race, and edit-rev tracking
// de-syncs. Detect this early in DEV mode.
let _hookMounted = false;

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
  const { isSignedIn, isLoaded } = useUser();
  const hydrateFromServer = useSettingsStore((s) => s.hydrateFromServer);
  const markAllSaved = useSettingsStore((s) => s.markAllSaved);
  const { mutateAsync: saveSettingsAsync } = usePutSettings();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Singleton invariant ──────────────────────────────────────────────────
  // Detect accidental double-mount (Strict Mode, duplicate tree placement, etc.)
  // early so the root cause is obvious rather than manifesting as silent data
  // loss from the TOCTOU race described at _hookMountCount above.
  useEffect(() => {
    _hookMountCount++;
    if (import.meta.env.DEV && _hookMountCount > 1) {
      console.error(
        `[useServerSettingsSync] mounted twice — ${_hookMountCount} active instances detected. ` +
        "This hook must be placed exactly once in the app tree (inside the signed-in guard). " +
        "Multiple instances share module-level revision counters and will race on every PUT.",
      );
    }
    return () => {
      _hookMountCount--;
      _consecutiveFlushFailures = 0;
      _inBackOff = false;
      _backOffStep = 0;
      if (_backOffTimerId) {
        clearTimeout(_backOffTimerId);
        _backOffTimerId = null;
      }
    };
  }, []);

  // Tracks whether the server-side settings have been received at least once.
  // Signed-out users don't fetch settings, so they are immediately ready.
  const [settingsReady, setSettingsReady] = useState<boolean>(() => isSignedIn === false);

  // Track the previous isSignedIn value so we can detect a sign-out transition
  // (true → false) without firing on the initial undefined → false load.
  const prevIsSignedInRef = useRef<boolean | null | undefined>(undefined);

  // When auth state resolves to "not signed in", mark ready immediately.
  useEffect(() => {
    if (isSignedIn === false) {
      setSettingsReady(true);
      _serverSettled = true;
    }
  }, [isSignedIn]);

  // ── Sign-out cleanup ───────────────────────────────────────────────────────
  // When the user signs out, clear all persisted local settings so a different
  // user logging in on the same device starts from a clean slate.
  useEffect(() => {
    if (!isLoaded) return;
    const prev = prevIsSignedInRef.current;
    prevIsSignedInRef.current = isSignedIn;

    // Only act on an explicit true → false transition (not the initial load).
    if (prev !== true || isSignedIn !== false) return;

    // Clear settingsStore and its localStorage entry.
    useSettingsStore.getState().clearForSignOut();

    // Reset the colour palette and remove its localStorage entry. The reset
    // bumps `rev`; realign the acked rev so the next sign-in's hydration
    // isn't blocked by a phantom "dirty palette".
    usePaletteStore.getState().reset();
    _ackedPaletteRev = usePaletteStore.getState().rev;
    // The clears above fire the store subscriptions and bump the edit revs;
    // realign the acked revs so the next sign-in's hydration isn't blocked
    // by phantom "dirty" state.
    queueMicrotask(() => {
      _ackedSettingsRev = _settingsEditRev;
      _ackedPanelRev = _panelEditRev;
      _ackedZoneRev = _zoneEditRev;
    });
    try { localStorage.removeItem("bathyscan:palette"); } catch { /* ignore */ }

    // Reset panel collapse state and remove its localStorage entry.
    usePanelCollapseStore.setState({ collapsed: { ...PANEL_DEFAULTS } });
    try { localStorage.removeItem("bathyscan:panel-collapse"); } catch { /* ignore */ }

    // Clear the zone-overlay colour slots (both water types).
    try {
      localStorage.removeItem("bathyscan:zoneOverlaySlots:saltwater");
      localStorage.removeItem("bathyscan:zoneOverlaySlots:freshwater");
    } catch { /* ignore */ }
  }, [isSignedIn, isLoaded]);

  // ── GET hydration ──────────────────────────────────────────────────────────
  const { data: serverSettings, isError: settingsFetchError } = useGetSettings({
    query: {
      enabled: isLoaded && isSignedIn === true,
      queryKey: getGetSettingsQueryKey(),
      refetchOnMount: "always",
      staleTime: 0,
      retry: false,
    },
  });

  // If the settings fetch fails (e.g. network error), mark ready so the app
  // doesn't wait forever — it will fall back to local defaults.
  useEffect(() => {
    if (settingsFetchError) {
      setSettingsReady(true);
      _serverSettled = true;
    }
  }, [settingsFetchError]);

  useEffect(() => {
    if (!serverSettings) return;

    // Always mark settings as ready once we have a server response — even if
    // we skip field hydration below.  Blocking settingsReady on pending state
    // would leave the startup auto-select effect stuck when the first GET
    // arrives while the user already has a change queued to flush.
    setSettingsReady(true);
    _serverSettled = true;

    const serverRec = serverSettings as Record<string, unknown>;
    const serverUpdatedAt =
      typeof serverRec.__updatedAt === "string"
        ? (serverRec.__updatedAt as string)
        : undefined;
    const lastSyncedAt = useSettingsStore.getState().lastSyncedAt;
    const serverIsNewer =
      !lastSyncedAt ||
      (serverUpdatedAt !== undefined && serverUpdatedAt > lastSyncedAt);

    if (serverIsNewer) {
      // Suppress the store subscriptions below for the duration of hydration
      // (zustand notifies synchronously) so applying server values can never
      // echo a spurious PUT back at the server.
      _hydrating = true;
      try {
      // Only hydrate settingsStore when it has no unflushed local edits —
      // a GET must never clobber a newer local change (e.g. the onboarding
      // Skip flag or a slider nudge made before the first GET settled).
      const settingsClean = _settingsEditRev === _ackedSettingsRev;
      if (settingsClean) {
        hydrateFromServer(serverSettings as Parameters<typeof hydrateFromServer>[0]);
      }

      // Only hydrate the palette when it has no unflushed local edits —
      // a GET response must never clobber a newer local palette change
      // (e.g. one made just before/while a PUT was in flight).
      const paletteRev = usePaletteStore.getState().rev;
      if (paletteRev === _ackedPaletteRev) {
        usePaletteStore.getState().hydrateFromServer({
          paletteShallow: serverRec.paletteShallow,
          paletteDeep: serverRec.paletteDeep,
          customStops: serverRec.customStops,
          bandColors: serverRec.bandColors,
          bandBoundaries: serverRec.bandBoundaries,
        });
      }

      // Restore panel collapse layout from the server (skip when local
      // panel edits are unflushed).
      if (
        _panelEditRev === _ackedPanelRev &&
        serverRec.panelCollapse &&
        typeof serverRec.panelCollapse === "object"
      ) {
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
      if (_zoneEditRev === _ackedZoneRev && serverRec.zoneOverlaySlots != null) {
        useZoneOverlayStore.getState().hydrateFromServer(serverRec.zoneOverlaySlots);
      }

      // Restore overlay toggles and UI state into uiStore from the freshly
      // hydrated settingsStore values. These fields are now persisted server-side
      // (settingsStore v15) and must be pushed into uiStore so the 3D scene and
      // overlay controls reflect the server's state immediately.
      // Reading from settingsStore.getState() (after hydrateFromServer has run)
      // gives us the fully merged server values. Skipped when settingsStore
      // hydration was skipped — patching uiStore from un-hydrated local
      // defaults would wipe the user's live overlay state.
      if (settingsClean) {
      const ss = useSettingsStore.getState();

      // Helper: validate depth layers array from the server payload.
      const toDepthLayers = (raw: unknown): DepthLayer[] => {
        if (!Array.isArray(raw)) return ["mid"];
        const valid = (raw as unknown[]).filter(
          (v): v is DepthLayer => CURRENT_DEPTH_LAYERS.includes(v as DepthLayer),
        );
        return valid.length ? valid : ["mid"];
      };

      // Patch uiStore with the server-authoritative values. We use setState
      // directly (not the setters) to avoid re-writing the values back into
      // settingsStore and re-triggering the debounced PUT.
      useUiStore.setState({
        weatherStationsActive: ss.weatherStationsActive,
        rawsOverlayActive: ss.rawsOverlayActive,
        windOverlayActive: ss.windOverlayActive,
        tideOverlayActive: ss.tideOverlayActive,
        currentOverlayActive: ss.currentOverlayActive,
        currentDepthLayers: toDepthLayers(ss.currentDepthLayers),
        sidePaneCollapsed: ss.sidePaneCollapsed,
        zonePaintBrushRadius: ss.zonePaintBrushRadius,
        // When zoneOverlay is off, ensure paint mode is also off.
        zoneOverlayEnabled: ss.zoneOverlayEnabled,
        zonePaintMode: ss.zoneOverlayEnabled ? ss.zonePaintMode : false,
        zonePaintSlot: (ss.zonePaintSlot as 0 | 1 | 2 | 3),
        substrateColorMode: ss.substrateColorMode,
        hiddenSubstrateClasses: new Set<string>(ss.hiddenSubstrateClasses ?? []),
        intertidalHotspotsEnabled: ss.intertidalHotspotsEnabled,
        intertidalScoreMode: ss.intertidalScoreMode ?? 'tidepool',
        efhOverlayEnabled: ss.efhOverlayEnabled,
        hiddenEfhSpecies: new Set<string>(ss.hiddenEfhSpecies ?? []),
        sidebarMode: ss.sidebarMode ?? 'explore',
      });
      }
      } finally {
        _hydrating = false;
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
      // Never send a full-state PUT before the initial server state is known
      // (first GET applied or errored). Doing so would overwrite newer server
      // values with un-hydrated local defaults. Wait briefly for settle; on
      // timeout proceed anyway rather than dropping the user's edit.
      if (!_serverSettled) {
        const deadline = Date.now() + 10_000;
        while (!_serverSettled && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      // Capture the edit revisions *before* reading store state so any
      // edit included in this payload is acknowledged below.
      const paletteRevAtFlush = usePaletteStore.getState().rev;
      const settingsRevAtFlush = _settingsEditRev;
      const panelRevAtFlush = _panelEditRev;
      const zoneRevAtFlush = _zoneEditRev;
      const data = buildPayload();
      const resp = await saveSettingsAsync({
        data: data as Parameters<typeof saveSettingsAsync>[0]["data"],
      });
      const serverStamp = (resp as Record<string, unknown> | undefined)
        ?.__updatedAt;
      markAllSaved(typeof serverStamp === "string" ? serverStamp : undefined);
      if (paletteRevAtFlush > _ackedPaletteRev) _ackedPaletteRev = paletteRevAtFlush;
      if (settingsRevAtFlush > _ackedSettingsRev) _ackedSettingsRev = settingsRevAtFlush;
      if (panelRevAtFlush > _ackedPanelRev) _ackedPanelRev = panelRevAtFlush;
      if (zoneRevAtFlush > _ackedZoneRev) _ackedZoneRev = zoneRevAtFlush;
      // Successful flush — reset failure counter and back-off step so the next
      // failure streak starts fresh at the shortest delay (30 s), not the last
      // escalated one.
      _consecutiveFlushFailures = 0;
      _backOffStep = 0;
    } finally {
      _flushInFlight = false;
    }
  }, [isSignedIn, saveSettingsAsync, markAllSaved]);

  // ── Debounced PUT subscription ─────────────────────────────────────────────
  const scheduleSync = useCallback(() => {
    if (!isSignedIn) return;
    // While in back-off mode, the debounce timer is suspended. A retry is
    // already scheduled by _enterBackOff(); arming another debounce here
    // would cause the two timers to race and could prematurely exit back-off.
    if (_inBackOff) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Signal that a write is outstanding so waitForServerSettingsSync knows
    // to poll rather than resolve immediately.
    _pendingDebounce = true;
    debounceRef.current = setTimeout(() => {
      _pendingDebounce = false; // flush() takes over from here
      void flush().catch((err) => {
        /* keep dirty so the section Save button stays active */
        if (import.meta.env.DEV) {
          console.error("[useServerSettingsSync] PUT /api/settings failed:", err);
        }
        _consecutiveFlushFailures++;
        // After several consecutive failures, enter exponential back-off and
        // surface a non-blocking toast with a "Retry now" action so the user
        // can recover without reloading. Back-off pauses the sync loop; the
        // back-off timer attempts one retry per interval on its own.
        if (_consecutiveFlushFailures >= FLUSH_FAILURE_TOAST_THRESHOLD) {
          _enterBackOff();
        }
      });
    }, 300);
  }, [isSignedIn, flush]);

  useEffect(() => {
    // Palette change detection uses the store's monotonic `rev` counter
    // rather than a JSON value snapshot: `rev` bumps on every user edit even
    // when normalization (e.g. hex lowercasing) leaves the values identical,
    // and it does NOT bump on hydrateFromServer, so server hydration can't
    // echo a spurious PUT.
    const palRev = () => usePaletteStore.getState().rev;
    const panelSnap = () =>
      JSON.stringify(usePanelCollapseStore.getState().collapsed);
    const zoneSnap = () => {
      const s = useZoneOverlayStore.getState();
      return JSON.stringify({ sw: s.saltwater, fw: s.freshwater });
    };

    let lastSettings = JSON.stringify(getDataSnapshot());
    let lastPaletteRev = palRev();
    let lastPanel = panelSnap();
    let lastZone = zoneSnap();

    const unsubSettings = useSettingsStore.subscribe(() => {
      const cur = JSON.stringify(getDataSnapshot());
      if (cur !== lastSettings) {
        lastSettings = cur;
        // Server hydration mutates the store too (zustand notifies
        // synchronously); refresh the snapshot but never echo a PUT.
        if (!_hydrating) {
          _settingsEditRev++;
          scheduleSync();
        }
      }
    });
    const unsubPalette = usePaletteStore.subscribe(() => {
      const cur = palRev();
      if (cur !== lastPaletteRev) {
        lastPaletteRev = cur;
        scheduleSync();
      }
    });
    const unsubPanel = usePanelCollapseStore.subscribe(() => {
      const cur = panelSnap();
      if (cur !== lastPanel) {
        lastPanel = cur;
        if (!_hydrating) {
          _panelEditRev++;
          scheduleSync();
        }
      }
    });
    const unsubZone = useZoneOverlayStore.subscribe(() => {
      const cur = zoneSnap();
      if (cur !== lastZone) {
        lastZone = cur;
        if (!_hydrating) {
          _zoneEditRev++;
          scheduleSync();
        }
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

  // Publish the current flush + scheduleSync functions so external callers
  // can drive the sync path without creating independent PUT writers.
  // Done in an effect so the module-level variables are only updated after the
  // render has committed — assigning them during render is unsafe in Concurrent Mode.
  useEffect(() => {
    _flush = flush;
    _scheduleSync = scheduleSync;
  }, [flush, scheduleSync]);

  return { settingsReady };
}
