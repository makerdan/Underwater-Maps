/**
 * signoutManifest.ts — the sign-out isolation manifest.
 *
 * Three separate audit findings (trail/camera/live stores, realisticMode /
 * boatSpeedMph, savedDriftPlans) shared one root cause: a developer adds a
 * new Zustand store or raw localStorage key holding per-user data, but the
 * sign-out cleanup (performSignOutCleanup in ./signoutCleanup.ts) is never
 * updated. Nothing failed, and the bleed was only found in manual testing on
 * a shared device.
 *
 * This manifest is the explicit, reviewable decision record:
 *  - SIGNOUT_STORE_MANIFEST      — stores holding per-user session state; each
 *                                  must expose a sign-out reset action.
 *  - SIGNOUT_EXCLUDED_STORES     — stores explicitly judged to hold NO
 *                                  per-user data, with the reason.
 *  - SIGNOUT_LOCALSTORAGE_MANIFEST — every raw localStorage key written
 *                                  outside useSettingsStore, with whether
 *                                  sign-out clears it (and why not, if not).
 *  - SIGNOUT_DYNAMIC_WRITE_SITES — files whose localStorage.setItem key is
 *                                  not a string literal, mapped to the
 *                                  manifest keys they write.
 *
 * Enforced by src/__tests__/signout-manifest.test.ts, which fails naming the
 * offending store/key when something new appears that is not listed here.
 * When you touch performSignOutCleanup, update this file in the same commit.
 */

import { useTrailStore } from "@/lib/trailStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useLiveModeStore } from "@/lib/liveMode";
import { useDriftStore } from "@/lib/driftStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { useDriveBoatStore } from "@/lib/driveBoatStore";
import { useSpecialCollectionStore } from "@/lib/specialCollectionStore";
import { usePuzzleStore } from "@/lib/puzzleStore";

// ─── Stores that hold per-user session state ─────────────────────────────────

export interface StoreManifestEntry {
  /** Human-readable store name used in failure messages. */
  storeName: string;
  /** Module path relative to src/ (forward slashes) — used by the source scan. */
  module: string;
  /** Returns true when the store exposes its sign-out reset action. */
  hasResetAction: () => boolean;
  /**
   * Temporarily replace the store's sign-out reset action with `probe`, and
   * return a restore function. The guard test uses this to mechanically verify
   * performSignOutCleanup actually INVOKES every manifest store's reset — a
   * store that merely exposes a reset without being wired into the cleanup
   * routine fails the guard. Every included store must hold its reset action
   * in store state (reachable via getState()) so it can be swapped here.
   */
  installProbe: (probe: () => void) => () => void;
}

/** Swap a state-held action for a probe on any zustand store; returns restore. */
function swapAction<S, K extends keyof S>(
  store: {
    getState: () => S;
    setState: (partial: Partial<S>) => void;
  },
  actionKey: K,
  probe: S[K],
): () => void {
  const original = store.getState()[actionKey];
  store.setState({ [actionKey]: probe } as unknown as Partial<S>);
  return () => store.setState({ [actionKey]: original } as unknown as Partial<S>);
}

export const SIGNOUT_STORE_MANIFEST: readonly StoreManifestEntry[] = [
  {
    storeName: "trailStore",
    module: "lib/trailStore.ts",
    hasResetAction: () =>
      typeof useTrailStore.getState().resetForSignOut === "function",
    installProbe: (probe) => swapAction(useTrailStore, "resetForSignOut", probe),
  },
  {
    storeName: "cameraStore",
    module: "lib/cameraStore.ts",
    hasResetAction: () =>
      typeof useCameraStore.getState().resetForSignOut === "function",
    installProbe: (probe) => swapAction(useCameraStore, "resetForSignOut", probe),
  },
  {
    storeName: "useLiveModeStore",
    module: "lib/liveMode.ts",
    // The store holds resetForSignOut in state (delegating to the module-level
    // resetLiveModeForSignOut, where the timers/subscriptions live) so the
    // wiring can be probe-verified like every other manifest store.
    hasResetAction: () =>
      typeof useLiveModeStore.getState().resetForSignOut === "function",
    installProbe: (probe) =>
      swapAction(useLiveModeStore, "resetForSignOut", probe),
  },
  {
    storeName: "driftStore",
    module: "lib/driftStore.ts",
    hasResetAction: () =>
      typeof useDriftStore.getState().resetForSignOut === "function",
    installProbe: (probe) => swapAction(useDriftStore, "resetForSignOut", probe),
  },
  {
    storeName: "settingsStore",
    module: "lib/settingsStore.ts",
    hasResetAction: () =>
      typeof useSettingsStore.getState().clearForSignOut === "function",
    installProbe: (probe) =>
      swapAction(useSettingsStore, "clearForSignOut", probe),
  },
  {
    storeName: "paletteStore",
    module: "lib/paletteStore.ts",
    hasResetAction: () =>
      typeof usePaletteStore.getState().reset === "function",
    installProbe: (probe) => swapAction(usePaletteStore, "reset", probe),
  },
  {
    storeName: "driveBoatStore",
    module: "lib/driveBoatStore.ts",
    hasResetAction: () =>
      typeof useDriveBoatStore.getState().resetForSignOut === "function",
    installProbe: (probe) =>
      swapAction(useDriveBoatStore, "resetForSignOut", probe),
  },
  {
    storeName: "specialCollectionStore",
    module: "lib/specialCollectionStore.ts",
    hasResetAction: () =>
      typeof useSpecialCollectionStore.getState().resetForSignOut === "function",
    installProbe: (probe) =>
      swapAction(useSpecialCollectionStore, "resetForSignOut", probe),
  },
  {
    storeName: "puzzleStore",
    module: "lib/puzzleStore.ts",
    // Holds the per-user puzzle layout mirror (3D marker geography). Its
    // resetForSignOut also bumps signOutNonce so a mounted OverviewMap clears
    // its component-local transforms/groups in the live instance.
    hasResetAction: () =>
      typeof usePuzzleStore.getState().resetForSignOut === "function",
    installProbe: (probe) => swapAction(usePuzzleStore, "resetForSignOut", probe),
  },
];

// ─── Stores explicitly excluded from sign-out reset ──────────────────────────
//
// Each entry is a deliberate decision that the store holds no per-user data
// worth isolating. If a store gains per-user state, move it to
// SIGNOUT_STORE_MANIFEST and wire its reset into performSignOutCleanup.

export interface ExcludedStoreEntry {
  storeName: string;
  module: string;
  reason: string;
}

export const SIGNOUT_EXCLUDED_STORES: readonly ExcludedStoreEntry[] = [
  { storeName: "activeLoadStore", module: "lib/activeLoadStore.ts", reason: "Transient dataset-download progress/ETA; gone on unmount, no persistence." },
  { storeName: "catchJournalStore", module: "lib/catchJournalStore.ts", reason: "Panel open/close UI state only; journal entries are server-persisted per account and fetched per sign-in." },
  { storeName: "classificationStore", module: "lib/classificationStore.ts", reason: "AI zone classification of the loaded dataset (server-derived, dataset-keyed); sessionStorage cache is per-tab and dataset-scoped, not account-scoped." },
  { storeName: "contextMenuStore", module: "lib/contextMenuStore.ts", reason: "Transient context-menu open state." },
  { storeName: "currentsStore", module: "lib/currentsStore.ts", reason: "Runtime current-simulation flow field derived from public environmental data." },
  { storeName: "depthProfileStore", module: "lib/depthProfileStore.ts", reason: "Transient right-click depth-profile UI state; cleared on dataset change." },
  { storeName: "envOfflineStore", module: "lib/envOfflineStore.ts", reason: "Device-local offline environment pack index (IndexedDB); offline packs are deliberately device-scoped, not account-scoped." },
  { storeName: "flyRouteStore", module: "lib/flyRouteStore.ts", reason: "Transient fly-through camera waypoints for the current viewing session; routes are server-persisted per account." },
  { storeName: "gpsStore", module: "lib/gpsStore.ts", reason: "Device GPS watch plumbing (hardware/device-local, not account data); live-mode sign-out reset unsubscribes its consumers." },
  { storeName: "habitatStore", module: "lib/habitatStore.ts", reason: "Habitat suitability scores derived from the loaded dataset; species selection is settings-synced and cleared via settingsStore." },
  { storeName: "helpStore", module: "lib/helpStore.ts", reason: "Help window open/position/search UI geometry (persist key 'bathyscan-help-window'); device-local, no user data." },
  { storeName: "highlightStore", module: "lib/highlightStore.ts", reason: "Transient terrain highlight overlay mode." },
  { storeName: "landTerrainStore", module: "lib/landTerrainStore.ts", reason: "Fetched public land-elevation grid for the loaded dataset." },
  { storeName: "markerDetailStore", module: "lib/markerDetailStore.ts", reason: "Transient marker-detail dialog state; markers themselves are server-persisted per account." },
  { storeName: "markerEditStore", module: "lib/markerEditStore.ts", reason: "Transient marker-edit dialog state." },
  { storeName: "markerLayerStore", module: "lib/markerLayerStore.ts", reason: "R3F→DOM bridge for marker subsampling HUD state; derived, transient." },
  { storeName: "measureStore", module: "lib/measureStore.ts", reason: "Transient measurement-tool points/results." },
  { storeName: "offlineScopeStore", module: "lib/offlineScopeStore.ts", reason: "Transient pending offline-download scope request (library/folder/selection/collection) consumed by DatasetPanel; no persistence, no per-user data." },
  { storeName: "offlineStore", module: "lib/offlineStore.ts", reason: "Connectivity/session-expiry flags describing the device's current network state." },
  { storeName: "panelCollapseStore", module: "lib/panelCollapseStore.ts", reason: "Reset directly by performSignOutCleanup (setState to defaults) and its 'bathyscan:panel-collapse' key is in the localStorage manifest; no named reset action needed." },
  { storeName: "proximityStreamingStore", module: "lib/proximityStreamingStore.ts", reason: "Transient proximity-streaming HUD state." },
  { storeName: "satelliteTileStore", module: "lib/satelliteTileStore.ts", reason: "Blob object-URL for the loaded dataset's satellite texture." },
  { storeName: "simulatedDataStore", module: "lib/simulatedDataStore.ts", reason: "Simulated-data warning dialog state (per dataset-switch, not per user)." },
  { storeName: "terrainStore", module: "lib/terrainStore.ts", reason: "Loaded terrain grids/datasets (server data, auth-guarded per account at fetch time); reloaded per sign-in, heavy to wipe eagerly." },
  { storeName: "terrainTileStore", module: "lib/terrainTileStore.ts", reason: "Blob object-URL for the loaded dataset's hillshade texture." },
  { storeName: "tidalStore", module: "lib/tidalStore.ts", reason: "Public NOAA tide-prediction data for the active dataset." },
  { storeName: "timelineStore", module: "lib/timelineStore.ts", reason: "Transient timeline scrubber position." },
  { storeName: "uiStore", module: "lib/uiStore.ts", reason: "View/layout state; account-synced fields are hydrated from settingsStore (cleared via clearForSignOut). Its only raw localStorage key is the device-local orbit-touch hint (in the localStorage manifest, cleared:false)." },
  { storeName: "webglContextStore", module: "lib/webglContextStore.ts", reason: "WebGL context-loss bookkeeping." },
  { storeName: "zoneOverlayStore", module: "lib/zoneOverlayStore.ts", reason: "Zone colour slots; the persisted slot keys are removed via the localStorage manifest and in-memory slots re-hydrate per sign-in." },
  { storeName: "useJoystickStore", module: "components/VirtualJoystick.tsx", reason: "Transient on-screen joystick input vector." },
  { storeName: "usePaletteSuggestionStore", module: "hooks/usePaletteSuggestion.ts", reason: "Transient AI palette-suggestion request state." },
  { storeName: "useShallowSuggestionStore", module: "hooks/useShallowSuggestion.ts", reason: "Transient shallow-water suggestion state." },
];

// ─── Raw localStorage keys written outside useSettingsStore ──────────────────

export interface LocalStorageManifestEntry {
  /** Exact key, or a prefix pattern ending in `*`. */
  key: string;
  /** Whether performSignOutCleanup removes this key at sign-out. */
  cleared: boolean;
  /** Why it is (or deliberately is not) cleared. */
  note: string;
}

export const SIGNOUT_LOCALSTORAGE_MANIFEST: readonly LocalStorageManifestEntry[] =
  [
    { key: "bathyscan:settings", cleared: true, note: "settingsStore persist entry; removed by settingsStore.clearForSignOut()." },
    { key: "bathyscan:palette", cleared: true, note: "Colour palette persist entry." },
    { key: "bathyscan:panel-collapse", cleared: true, note: "Panel collapse layout persist entry." },
    { key: "bathyscan:zoneOverlaySlots:saltwater", cleared: true, note: "Saltwater zone colour slots." },
    { key: "bathyscan:zoneOverlaySlots:freshwater", cleared: true, note: "Freshwater zone colour slots." },
    { key: "bathyscan:zoneOverlaySlots", cleared: true, note: "Legacy pre-split zone slot key (still written back by old clients; migration reads it)." },
    { key: "bathyscan:savedDriftPlans", cleared: true, note: "Saved drift plans (prior-audit SEED-B)." },
    { key: "bathyscan:driftPlannerActive", cleared: true, note: "Per-user drift planner toggle." },
    { key: "bathyscan:boatProfileId", cleared: true, note: "Per-user boat profile selection." },
    { key: "bathyscan:realisticMode", cleared: true, note: "Per-user Drive Boat/realistic mode pref (audit F-004); in-memory copy lives in AppProvider React state — storage is cleared so the next hydration gets defaults." },
    { key: "bathyscan:boatSpeedMph", cleared: true, note: "Per-user boat speed pref (audit F-004); same AppProvider caveat as realisticMode." },
    { key: "bathyscan:puzzleTransforms", cleared: true, note: "Overview Map puzzle tile layout (user's dataset arrangement); sessionStorage twin cleared too." },
    { key: "bathyscan:puzzleGroups", cleared: true, note: "Overview Map puzzle grouping." },
    { key: "bsquery-history", cleared: true, note: "AI query panel history — user's past questions." },
    { key: "bathyscan-offline-identity-v1", cleared: true, note: "Cached identity (name/userId) for the offline read-only banner — literally the previous user's identity." },
    { key: "bathyscan:colmap:*", cleared: true, note: "GPS-import column-mapping fingerprints." },
    { key: "pending-trail-*", cleared: false, note: "Pending offline trail uploads. Deliberately NOT cleared: removing them would destroy unsynced recordings. Risk: they would flush under the next signed-in account — fixing that needs per-user keying (tracked separately, out of scope here)." },
    { key: "bathyscan:hasSeenOrbitTouchHint", cleared: false, note: "One-time device-local touch hint; intentionally not per-user (uiStore writeLocalBool)." },
    { key: "bathyscan-help-window", cleared: false, note: "Help window position/UI geometry (helpStore persist); device-local, no user data." },
  ];

/**
 * Files whose `localStorage.setItem` call passes a non-literal key (a const,
 * template literal, or helper wrapper). The scan cannot read the key from the
 * call site, so each file is mapped to the manifest key(s) it writes. Adding
 * a dynamic setItem call in a file not listed here fails the guard test.
 */
export const SIGNOUT_DYNAMIC_WRITE_SITES: readonly {
  module: string;
  keys: readonly string[];
}[] = [
  { module: "components/ColumnMappingStep.tsx", keys: ["bathyscan:colmap:*"] },
  { module: "components/TrailRecorder.tsx", keys: ["pending-trail-*"] },
  { module: "components/OfflineReadOnlyBanner.tsx", keys: ["bathyscan-offline-identity-v1"] },
  { module: "components/QueryPanel.tsx", keys: ["bsquery-history"] },
  { module: "lib/uiStore.ts", keys: ["bathyscan:hasSeenOrbitTouchHint"] },
  { module: "lib/driftStore.ts", keys: ["bathyscan:savedDriftPlans"] },
  { module: "lib/zoneOverlayStore.ts", keys: ["bathyscan:zoneOverlaySlots:saltwater", "bathyscan:zoneOverlaySlots:freshwater"] },
];

/** True when `key` matches a manifest entry (exact, or `prefix*` pattern). */
export function manifestCoversKey(key: string): boolean {
  return SIGNOUT_LOCALSTORAGE_MANIFEST.some((entry) =>
    entry.key.endsWith("*")
      ? key.startsWith(entry.key.slice(0, -1))
      : key === entry.key,
  );
}
