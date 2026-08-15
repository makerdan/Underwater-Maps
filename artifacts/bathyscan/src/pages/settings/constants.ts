import { keys as idbKeys } from "idb-keyval";
import type { MarkerType } from "@/lib/settingsStore";
import { getSelectableMarkerTypes } from "@/lib/markerConstants";

export const UNDO_DELETE_WINDOW_MS = 5000;

/**
 * IndexedDB key used by envOfflineStore to persist the global env pack.
 * Listed here so the storage-usage summary can account for it.
 */
export const ENV_PACK_IDB_KEY = "env-pack-v1";

export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export const FIXED_SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "Click", desc: "Lock mouse / enter fly mode" },
  { keys: "Mouse drag", desc: "Look around" },
  { keys: "Scroll", desc: "Zoom in / out" },
  { keys: "R-drag / Ctrl-drag", desc: "Orbit around point" },
  { keys: "R-click", desc: "Context menu" },
  { keys: "Esc", desc: "Close panels / release pointer" },
];

export type Tab =
  | "general" | "visuals" | "navigation" | "display-overlays"
  | "map-layers" | "marker-symbols" | "data-storage" | "accessibility" | "account";

export const NAV_TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "GENERAL" },
  { id: "visuals", label: "VISUALS & PERF" },
  { id: "navigation", label: "NAVIGATION" },
  { id: "display-overlays", label: "DISPLAY & OVERLAYS" },
  { id: "map-layers", label: "MAP LAYERS" },
  { id: "marker-symbols", label: "MARKER SYMBOLS" },
  { id: "data-storage", label: "DATA & STORAGE" },
  { id: "accessibility", label: "ACCESSIBILITY" },
  { id: "account", label: "ACCOUNT & PRIVACY" },
];

// Derived from the marker symbol library so Settings always matches the
// picker (species section + always-on Natural World / Mariner / Special).
export const SALTWATER_MARKER_TYPE_OPTIONS: { value: MarkerType; label: string }[] =
  getSelectableMarkerTypes("saltwater").map((t) => ({ value: t.value as MarkerType, label: t.label }));

export const FRESHWATER_MARKER_TYPE_OPTIONS: { value: MarkerType; label: string }[] =
  getSelectableMarkerTypes("freshwater").map((t) => ({ value: t.value as MarkerType, label: t.label }));

export function formatLastSynced(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 10) return "JUST NOW";
  if (diffSec < 60) return `${diffSec}S AGO`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} MIN AGO`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}H AGO`;
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).toUpperCase();
}

export function formatCacheSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function defaultContourInterval(units: "metric" | "imperial" | "nautical"): number {
  if (units === "nautical") return 10;
  if (units === "imperial") return 50;
  return 10;
}

export interface CachedDataset { url: string; label: string; sizeKb: number | null }

export async function listCachedDatasets(): Promise<CachedDataset[]> {
  if (!("caches" in window)) return [];
  const cacheNames = await caches.keys();
  const entries: CachedDataset[] = [];
  for (const name of cacheNames.filter((n) => n === "api-terrain" || n === "api-overview" || n.includes("terrain"))) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const resp = await cache.match(req);
      let sizeKb: number | null = null;
      if (resp) {
        try { sizeKb = Math.round((await resp.clone().arrayBuffer()).byteLength / 1024); } catch { /* ignore */ }
      }
      const match = /\/datasets\/([^/]+)\/(terrain|overview)/.exec(req.url);
      entries.push({
        url: req.url,
        label: match ? `${match[1]} (${match[2]})` : req.url.split("/").slice(-3).join("/"),
        sizeKb,
      });
    }
  }
  return entries;
}

export async function clearCacheEntry(url: string) {
  if (!("caches" in window)) return;
  for (const n of await caches.keys()) await (await caches.open(n)).delete(url);
}

// ── "Clear all cache" scope ──────────────────────────────────────────────────
// The Data & Storage "clear all" action must only touch caches owned by the
// terrain-data feature. It must NEVER delete user-saved stores: offline packs
// ("bathyscan-pack-terrain", idb "offline-pack-*"), help content
// ("bathyscan-pack-help", idb "offline-help-pack"), the env pack
// (idb "env-pack-v1"), or the enhanced-image cache (its own IDB database).

export const PENDING_MARKER_KEY_PREFIX = "pending-marker-";
export const PENDING_TRAIL_KEY_PREFIX = "pending-trail-";

/** Unversioned Cache Storage buckets owned by the terrain-cache feature. */
export const CLEAR_ALL_EXACT_CACHE_NAMES: readonly string[] = [
  "api-terrain",
  "api-overview",
  "bathyscan-terrain-tiles",
  "bathyscan-satellite-tiles",
];

// Build-versioned SW runtime caches ("bathyscan-v<hash>-api-terrain", …).
// Deliberately excludes the version-independent pack caches
// ("bathyscan-pack-terrain" / "bathyscan-pack-help"), which do not carry the
// "bathyscan-v" prefix.
const CLEAR_ALL_VERSIONED_CACHE_RE =
  /^bathyscan-v.+-(api-terrain|api-overview|api-datasets)$/;

/** User-saved stores that "clear all" must never touch, whatever else matches. */
const PROTECTED_CACHE_PREFIX = "bathyscan-pack-";

export function isClearAllTargetCache(name: string): boolean {
  if (name.startsWith(PROTECTED_CACHE_PREFIX)) return false;
  return (
    CLEAR_ALL_EXACT_CACHE_NAMES.includes(name) ||
    CLEAR_ALL_VERSIONED_CACHE_RE.test(name) ||
    // Parity with the listCachedDatasets card filter, so every cache whose
    // entries are shown in the card is actually covered by "clear all".
    name.includes("terrain")
  );
}

/**
 * Delete only the Cache Storage buckets owned by the terrain-cache feature.
 * Returns false (without touching anything) when Cache Storage is unavailable
 * so callers can still clear the independent IDB/localStorage stores.
 */
export async function clearTerrainCaches(): Promise<boolean> {
  if (!("caches" in window)) return false;
  const names = await caches.keys();
  await Promise.all(
    names.filter(isClearAllTargetCache).map((n) => caches.delete(n)),
  );
  return true;
}

/**
 * Clear the pending-sync queue: targeted deletes of "pending-marker-*" IDB
 * keys and "pending-trail-*" localStorage keys. Never clears the whole
 * idb-keyval store.
 */
export async function clearPendingSyncQueue(): Promise<void> {
  // Dynamic import so test files that wholesale-mock idb-keyval without a
  // `del` export don't break at module-init time (same pattern as offlineFlush).
  const { keys, del } = await import("idb-keyval");
  const allKeys = await keys();
  await Promise.all(
    allKeys
      .filter(
        (k): k is string =>
          typeof k === "string" && k.startsWith(PENDING_MARKER_KEY_PREFIX),
      )
      .map((k) => del(k)),
  );
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith(PENDING_TRAIL_KEY_PREFIX)) localStorage.removeItem(k);
  }
}

export async function countPendingItems() {
  let markers = 0, trails = 0;
  try {
    const keys = await idbKeys();
    markers = keys.filter((k) => typeof k === "string" && k.startsWith("pending-marker-")).length;
  } catch { /* ignore */ }
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("pending-trail-")) trails++;
  }
  return { markers, trails };
}
