import { keys as idbKeys } from "idb-keyval";
import type { MarkerType } from "@/lib/settingsStore";
import { getSelectableMarkerTypes } from "@/lib/markerConstants";

export const UNDO_DELETE_WINDOW_MS = 5000;

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
