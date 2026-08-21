/**
 * helpPackStore.ts — manages the offline help content cache.
 *
 * Derives the set of help media assets from the bundled article bodies,
 * computes a fingerprint so a changed asset set is detectable across builds,
 * then fetches each asset into the persistent `bathyscan-pack-help` cache.
 */

import { get, set, del } from "idb-keyval";
import { type HelpArticle } from "./helpContent";

const HELP_PACK_KEY = "offline-help-pack";
export const HELP_CACHE_NAME = "bathyscan-pack-help";
let helpSaveVersion = 0;
let helpMutationTail: Promise<void> = Promise.resolve();

async function withHelpMutation<T>(action: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const tail = new Promise<void>((resolve) => { release = resolve; });
  const previous = helpMutationTail;
  helpMutationTail = tail;
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

const HELP_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * @deprecated Legacy fixed asset list. New code derives the asset set from
 * article bodies via extractHelpMediaUrls(). Kept for OfflinePackModal, which
 * still offers the fixed five-asset help pack.
 */
export const HELP_ASSETS = [
  `${HELP_BASE}/help/marker-drop.gif`,
  `${HELP_BASE}/help/paint-mode.gif`,
  `${HELP_BASE}/help/upload-dropzone.png`,
  `${HELP_BASE}/help/full-screen.png`,
  `${HELP_BASE}/help/depth-profile.png`,
];

// ── Manifest derivation ───────────────────────────────────────────────────────

const IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

/**
 * Scan article bodies for markdown image references whose src starts with `/`,
 * resolve them against the given basePath, dedupe, and sort for stability.
 *
 * Accepts `basePath` as a parameter so tests can control it without mocking
 * `import.meta.env`.
 */
export function extractHelpMediaUrls(
  articles: HelpArticle[],
  basePath: string = import.meta.env.BASE_URL.replace(/\/$/, ""),
): string[] {
  const seen = new Set<string>();
  for (const article of articles) {
    IMAGE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMAGE_RE.exec(article.body)) !== null) {
      const src = match[1]!.trim();
      if (src.startsWith("/")) {
        seen.add(`${basePath}${src}`);
      }
    }
  }
  return [...seen].sort();
}

/**
 * Compute a stable hex fingerprint of the help media URL list.
 * Uses a djb2-style hash of the newline-joined sorted URL list.
 * Changes to any URL (added, removed, renamed) produce a different fingerprint.
 */
export function computeManifestFingerprint(urls: string[]): string {
  const s = urls.join("\n");
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) & 0xffffffff;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── Cache Storage availability ────────────────────────────────────────────────

/**
 * Returns true when the browser Cache Storage API is available.
 * It may be absent in insecure contexts (plain http), some private-browsing
 * modes, or dev environments running without a service worker.
 */
export function isCacheStorageAvailable(): boolean {
  try {
    return typeof caches !== "undefined" && typeof caches.open === "function";
  } catch {
    return false;
  }
}

// ── Status ────────────────────────────────────────────────────────────────────

/**
 * Five mutually-exclusive states for the help offline download feature.
 * - not-downloaded  Help media has never been cached on this device.
 * - downloading     A download is in progress.
 * - downloaded      All assets are cached; fingerprint matches current build.
 * - update-available Assets were cached in a prior build; the manifest changed.
 * - unavailable     Cache Storage API is absent (e.g. insecure context, no SW).
 */
export type HelpOfflineStatus =
  | "not-downloaded"
  | "downloading"
  | "downloaded"
  | "update-available"
  | "unavailable";

// ── IDB record ────────────────────────────────────────────────────────────────

export interface HelpAssetRecord {
  url: string;
  sizeBytes: number;
}

export interface HelpPackRecord {
  savedAt: string;
  assets: HelpAssetRecord[];
  totalBytes: number;
  /** Fingerprint of the manifest at save time — used to detect updates. */
  fingerprint: string;
}

/** @deprecated Use getHelpOfflineStatus() instead. */
export interface HelpPackStatus {
  saved: boolean;
  savedAt?: string;
  totalBytes?: number;
}

export interface HelpPackProgress {
  assetName: string;
  index: number;
  total: number;
  done: boolean;
  error?: string;
}

// ── Record API ────────────────────────────────────────────────────────────────

/**
 * Returns the persisted HelpPackRecord from IndexedDB, or null if no help
 * pack has been saved on this device.
 */
export async function getHelpPackRecord(): Promise<HelpPackRecord | null> {
  const record = await get<HelpPackRecord>(HELP_PACK_KEY);
  return record ?? null;
}
/**
 * Returns the current offline-download status for help media.
 * Pass `articles` + `basePath` from outside so the function is pure and
 * testable; callers (HelpWindow) supply `HELP_ARTICLES` and `""` or `BASE_URL`.
 */
export async function getHelpOfflineStatus(
  articles: HelpArticle[],
  basePath?: string,
): Promise<HelpOfflineStatus> {
  if (!isCacheStorageAvailable()) return "unavailable";

  const record = await get<HelpPackRecord>(HELP_PACK_KEY);
  if (!record) return "not-downloaded";

  const urls = extractHelpMediaUrls(articles, basePath);
  const currentFp = computeManifestFingerprint(urls);

  if (record.fingerprint && record.fingerprint !== currentFp) {
    return "update-available";
  }
  return "downloaded";
}

/**
 * @deprecated Use getHelpOfflineStatus() instead. Legacy saved/size summary
 * consumed by OfflinePackModal and DataStorageSection.
 */
export async function getHelpPackStatus(): Promise<HelpPackStatus> {
  const record = await get<HelpPackRecord>(HELP_PACK_KEY);
  if (!record) return { saved: false };
  return {
    saved: true,
    savedAt: record.savedAt,
    totalBytes: record.totalBytes,
  };
}

// ── Download engine ───────────────────────────────────────────────────────────

/**
 * Fetch each help media asset into the persistent cache and persist the record
 * to IndexedDB.  Reports per-asset progress via `onProgress`.
 *
 * Partial failures (individual asset download errors) are reported through
 * `onProgress` but do not throw — the record is written with whatever assets
 * succeeded.  This mirrors the "best-effort" policy in offlinePackStore.ts.
 */
export async function saveHelpPack(
  articles: HelpArticle[],
  onProgress: (p: HelpPackProgress) => void,
  basePath?: string,
): Promise<HelpPackRecord>;
/**
 * @deprecated Legacy signature — downloads the fixed HELP_ASSETS list.
 * Still used by OfflinePackModal's help section.
 */
export async function saveHelpPack(
  onProgress: (p: HelpPackProgress) => void,
  signal?: AbortSignal,
): Promise<HelpPackRecord>;
export async function saveHelpPack(
  articlesOrOnProgress: HelpArticle[] | ((p: HelpPackProgress) => void),
  onProgressArg?: ((p: HelpPackProgress) => void) | AbortSignal,
  basePath?: string,
  signalArg?: AbortSignal,
): Promise<HelpPackRecord> {
  const saveVersion = ++helpSaveVersion;
  const legacy = typeof articlesOrOnProgress === "function";
  const onProgress = legacy ? articlesOrOnProgress : onProgressArg as (p: HelpPackProgress) => void;
  const signal = legacy ? onProgressArg as AbortSignal | undefined : signalArg;
  const urls = legacy
    ? [...HELP_ASSETS]
    : extractHelpMediaUrls(articlesOrOnProgress, basePath);
  const fingerprint = computeManifestFingerprint(urls);
  const cache = await caches.open(HELP_CACHE_NAME);
  const previousRecord = await get<HelpPackRecord>(HELP_PACK_KEY);
  const assetRecords: HelpAssetRecord[] = [];
  const previousEntries = new Map<string, Response | undefined>();
  const total = urls.length;

  const throwIfAborted = () => {
    if (!signal?.aborted && saveVersion === helpSaveVersion) return;
    const error = new Error("Help download cancelled");
    error.name = "AbortError";
    throw error;
  };
  try {
    for (let i = 0; i < total; i++) {
      throwIfAborted();
      const url = urls[i]!;
      const assetName = url.split("/").pop() ?? url;
      onProgress({ assetName, index: i + 1, total, done: false });
      try {
        const response = await fetch(url, { cache: "no-store", signal });
        throwIfAborted();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const clone = response.clone();
        const buf = await clone.arrayBuffer();
        throwIfAborted();
        if (!previousEntries.has(url)) {
          previousEntries.set(url, await cache.match(url));
        }
        await withHelpMutation(async () => {
          throwIfAborted();
          await cache.put(url, response);
        });
        throwIfAborted();
        assetRecords.push({ url, sizeBytes: buf.byteLength });
        onProgress({ assetName, index: i + 1, total, done: true });
      } catch (err) {
        if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
        const msg = err instanceof Error ? err.message : "Download failed";
        onProgress({ assetName, index: i + 1, total, done: true, error: msg });
      }
    }

    throwIfAborted();
    const record: HelpPackRecord = {
      savedAt: new Date().toISOString(),
      assets: assetRecords,
      totalBytes: assetRecords.reduce((sum, a) => sum + a.sizeBytes, 0),
      fingerprint,
    };
    await withHelpMutation(async () => {
      throwIfAborted();
      await set(HELP_PACK_KEY, record);
    });
    throwIfAborted();
    return record;
  } catch (error) {
    if (signal?.aborted) {
      await withHelpMutation(async () => {
        // A new save owns all cache and IDB state as soon as it starts.
        if (saveVersion !== helpSaveVersion) return;
        await Promise.all([...previousEntries].map(async ([url, previous]) => {
          if (previous) await cache.put(url, previous);
          else await cache.delete(url);
        }));
        if (previousRecord) await set(HELP_PACK_KEY, previousRecord);
        else await del(HELP_PACK_KEY);
      });
    }
    throw error;
  }
}

export async function deleteHelpPack(): Promise<void> {
  try {
    await caches.delete(HELP_CACHE_NAME);
  } catch {
    // Cache may not exist
  }
  await del(HELP_PACK_KEY);
}
