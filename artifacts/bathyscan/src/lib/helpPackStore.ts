/**
 * helpPackStore.ts — manages the offline help content cache.
 *
 * Caches the five help media assets (GIFs + PNGs) into a persistent
 * Workbox-excluded browser cache called `bathyscan-pack-help` so they're
 * available when the device has no connectivity.
 */

import { get, set, del } from "idb-keyval";

const HELP_PACK_KEY = "offline-help-pack";
const CACHE_NAME = "bathyscan-pack-help";

const HELP_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const HELP_ASSETS = [
  `${HELP_BASE}/help/marker-drop.gif`,
  `${HELP_BASE}/help/paint-mode.gif`,
  `${HELP_BASE}/help/upload-dropzone.png`,
  `${HELP_BASE}/help/full-screen.png`,
  `${HELP_BASE}/help/depth-profile.png`,
];

export interface HelpAssetRecord {
  url: string;
  sizeBytes: number;
}

export interface HelpPackRecord {
  savedAt: string;
  assets: HelpAssetRecord[];
  totalBytes: number;
}

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

export async function getHelpPackStatus(): Promise<HelpPackStatus> {
  const record = await get<HelpPackRecord>(HELP_PACK_KEY);
  if (!record) return { saved: false };
  return {
    saved: true,
    savedAt: record.savedAt,
    totalBytes: record.totalBytes,
  };
}

export async function saveHelpPack(
  onProgress: (p: HelpPackProgress) => void,
): Promise<HelpPackRecord> {
  const cache = await caches.open(CACHE_NAME);
  const assets: HelpAssetRecord[] = [];
  const total = HELP_ASSETS.length;

  for (let i = 0; i < total; i++) {
    const url = HELP_ASSETS[i]!;
    const assetName = url.split("/").pop() ?? url;
    onProgress({ assetName, index: i + 1, total, done: false });
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const clone = response.clone();
      const buf = await clone.arrayBuffer();
      const sizeBytes = buf.byteLength;
      await cache.put(url, response);
      assets.push({ url, sizeBytes });
      onProgress({ assetName, index: i + 1, total, done: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Download failed";
      onProgress({ assetName, index: i + 1, total, done: true, error: msg });
    }
  }

  const record: HelpPackRecord = {
    savedAt: new Date().toISOString(),
    assets,
    totalBytes: assets.reduce((sum, a) => sum + a.sizeBytes, 0),
  };
  await set(HELP_PACK_KEY, record);
  return record;
}

export async function deleteHelpPack(): Promise<void> {
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // Cache may not exist
  }
  await del(HELP_PACK_KEY);
}
