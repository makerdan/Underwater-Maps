/**
 * offlinePackStore.ts — manages deliberate offline area packs in IndexedDB.
 *
 * Each pack bundles terrain cache references, tide predictions, and a weather
 * snapshot for a single dataset so the app works without a network connection.
 */

import { get, set, del, keys } from "idb-keyval";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PACK_KEY_PREFIX = "offline-pack-";

export interface TideHeightPrediction {
  t: string;
  v: number;
}

export interface TideCurrentPrediction {
  t: string;
  speed: number;
  dir: number;
}

export interface TidePack {
  station: string | null;
  heightPredictions: TideHeightPrediction[];
  currentPredictions: TideCurrentPrediction[];
  tidalExpiresAt: string;
  generatedAt: string;
}

export interface WeatherStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  windSpeedKnots: number | null;
  windDirDeg: number | null;
  visibilityMiles: number | null;
  ceilingFt: number | null;
  tempC: number | null;
  observedAt: string | null;
}

export interface WeatherPack {
  station: string | null;
  observation: WeatherStation | null;
  snapshotAt: string;
}

export interface OfflinePack {
  id: string;
  datasetId: string;
  datasetName: string;
  bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  centerLat: number;
  centerLon: number;
  savedAt: string;
  terrainUrl: string;
  overviewUrl: string;
  tidePack: TidePack;
  weatherPack: WeatherPack;
  storageBytesEstimate: number;
}

export interface PackProgress {
  step: "terrain" | "tide" | "weather" | "saving";
  label: string;
  done: boolean;
  error?: string;
}

// ─── Haversine distance ───────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── UUID helper ──────────────────────────────────────────────────────────────

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─── Tell the SW to cache terrain into the persistent pack cache ──────────────

async function cacheTerrain(terrainUrl: string, overviewUrl: string): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  if (!reg.active) return;
  return new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e: MessageEvent<{ ok: boolean; error?: string }>) => {
      if (e.data.ok) resolve();
      else reject(new Error(e.data.error ?? "SW CACHE_PACK failed"));
    };
    reg.active!.postMessage(
      { type: "CACHE_PACK", terrainUrl, overviewUrl },
      [channel.port2],
    );
    setTimeout(() => resolve(), 10000);
  });
}

// ─── saveOfflinePack ──────────────────────────────────────────────────────────

export async function saveOfflinePack(
  dataset: {
    id: string;
    name: string;
    bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null;
  },
  days: number,
  onProgress: (p: PackProgress) => void,
): Promise<OfflinePack> {
  const centerLat = dataset.bbox
    ? (dataset.bbox.minLat + dataset.bbox.maxLat) / 2
    : 0;
  const centerLon = dataset.bbox
    ? (dataset.bbox.minLon + dataset.bbox.maxLon) / 2
    : 0;

  const terrainUrl = `${API_BASE}/api/datasets/${dataset.id}/terrain`;
  const overviewUrl = `${API_BASE}/api/datasets/${dataset.id}/overview`;

  // Step 1: cache terrain
  onProgress({ step: "terrain", label: "Fetching terrain…", done: false });
  try {
    await cacheTerrain(terrainUrl, overviewUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "SW CACHE_PACK failed";
    onProgress({ step: "terrain", label: msg, done: true, error: msg });
    throw err;
  }
  onProgress({ step: "terrain", label: "Terrain cached", done: true });

  // Step 2: fetch tide pack
  onProgress({ step: "tide", label: "Fetching tide predictions…", done: false });
  let tidePack: TidePack;
  try {
    const tideRes = await fetch(
      `${API_BASE}/api/tidal/pack?lat=${centerLat}&lon=${centerLon}&days=${days}`,
    );
    if (!tideRes.ok) throw new Error(`HTTP ${tideRes.status}`);
    tidePack = (await tideRes.json()) as TidePack;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch tide predictions";
    onProgress({ step: "tide", label: msg, done: true, error: msg });
    throw err;
  }
  onProgress({ step: "tide", label: "Tide predictions saved", done: true });

  // Step 3: fetch weather pack
  onProgress({ step: "weather", label: "Fetching weather snapshot…", done: false });
  let weatherPack: WeatherPack;
  try {
    const weatherRes = await fetch(
      `${API_BASE}/api/weather/pack?lat=${centerLat}&lon=${centerLon}`,
    );
    if (!weatherRes.ok) throw new Error(`HTTP ${weatherRes.status}`);
    weatherPack = (await weatherRes.json()) as WeatherPack;
  } catch {
    // Weather is best-effort — create a minimal pack if it fails
    weatherPack = { station: null, observation: null, snapshotAt: new Date().toISOString() };
  }
  onProgress({ step: "weather", label: "Weather snapshot saved", done: true });

  // Step 4: save to IndexedDB
  onProgress({ step: "saving", label: "Writing to storage…", done: false });
  const id = newId();
  const pack: OfflinePack = {
    id,
    datasetId: dataset.id,
    datasetName: dataset.name,
    bbox: dataset.bbox ?? { minLon: 0, maxLon: 0, minLat: 0, maxLat: 0 },
    centerLat,
    centerLon,
    savedAt: new Date().toISOString(),
    terrainUrl,
    overviewUrl,
    tidePack,
    weatherPack,
    storageBytesEstimate: estimateFromPredictions(tidePack),
  };
  await set(`${PACK_KEY_PREFIX}${id}`, pack);
  onProgress({ step: "saving", label: "Saved to device", done: true });
  return pack;
}

function estimateFromPredictions(tidePack: TidePack): number {
  const tideBytesEst =
    (tidePack.heightPredictions.length + tidePack.currentPredictions.length) * 40;
  return tideBytesEst + 2 * 1024 * 1024;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listOfflinePacks(): Promise<OfflinePack[]> {
  const allKeys = await keys();
  const packKeys = allKeys.filter(
    (k): k is string => typeof k === "string" && k.startsWith(PACK_KEY_PREFIX),
  );
  const packs = await Promise.all(packKeys.map((k) => get<OfflinePack>(k)));
  return packs.filter((p): p is OfflinePack => p !== undefined);
}

export async function deleteOfflinePack(id: string): Promise<void> {
  await del(`${PACK_KEY_PREFIX}${id}`);
}

// ─── Location lookup ──────────────────────────────────────────────────────────

export async function getPackForLocation(
  lat: number,
  lon: number,
): Promise<OfflinePack | null> {
  const packs = await listOfflinePacks();
  let nearest: OfflinePack | null = null;
  let nearestDist = 200; // km threshold
  for (const p of packs) {
    const dist = haversineKm(lat, lon, p.centerLat, p.centerLon);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = p;
    }
  }
  return nearest;
}

// ─── Tide value interpolation ─────────────────────────────────────────────────

export interface OfflineTideValue {
  tideHeight: number;
  currentSpeed: number;
  currentDirection: number;
  source: "pack";
}

export function getOfflineTideValue(
  pack: OfflinePack,
  datetime: Date,
): OfflineTideValue {
  const refMs = datetime.getTime();
  const height = interpolateHeightPredictions(pack.tidePack.heightPredictions, refMs);
  const current = interpolateCurrentPredictions(pack.tidePack.currentPredictions, refMs);
  return {
    tideHeight: height,
    currentSpeed: current.speed,
    currentDirection: current.dir,
    source: "pack",
  };
}

function interpolateHeightPredictions(
  preds: TideHeightPrediction[],
  refMs: number,
): number {
  if (preds.length === 0) return 0;
  let prev: TideHeightPrediction | null = null;
  let next: TideHeightPrediction | null = null;
  for (const p of preds) {
    const t = new Date(p.t).getTime();
    if (t <= refMs) prev = p;
    else if (!next) { next = p; break; }
  }
  if (!prev && !next) return 0;
  if (!prev && next) return next.v;
  if (prev && !next) return prev.v;
  if (!prev || !next) return 0;
  const prevT = new Date(prev.t).getTime();
  const nextT = new Date(next.t).getTime();
  const span = nextT - prevT;
  if (span <= 0) return prev.v;
  const t = (refMs - prevT) / span;
  const c = (1 - Math.cos(Math.PI * t)) / 2;
  return prev.v + (next.v - prev.v) * c;
}

function interpolateCurrentPredictions(
  preds: TideCurrentPrediction[],
  refMs: number,
): { speed: number; dir: number } {
  if (preds.length === 0) return { speed: 0, dir: 0 };
  let prev: TideCurrentPrediction | null = null;
  let next: TideCurrentPrediction | null = null;
  for (const p of preds) {
    const t = new Date(p.t).getTime();
    if (t <= refMs) prev = p;
    else if (!next) { next = p; break; }
  }
  if (!prev && !next) return { speed: 0, dir: 0 };
  if (!prev && next) return { speed: next.speed, dir: next.dir };
  if (prev && !next) return { speed: prev.speed, dir: prev.dir };
  if (!prev || !next) return { speed: 0, dir: 0 };
  const prevT = new Date(prev.t).getTime();
  const nextT = new Date(next.t).getTime();
  const span = nextT - prevT;
  if (span <= 0) return { speed: prev.speed, dir: prev.dir };
  const t = (refMs - prevT) / span;
  return {
    speed: prev.speed + (next.speed - prev.speed) * t,
    dir: prev.dir + (next.dir - prev.dir) * t,
  };
}

// ─── Weather value ────────────────────────────────────────────────────────────

export interface OfflineWeatherValue extends WeatherStation {
  isStale: true;
  snapshotAt: string;
}

export function getOfflineWeatherValue(pack: OfflinePack): OfflineWeatherValue | null {
  if (!pack.weatherPack.observation) return null;
  return {
    ...pack.weatherPack.observation,
    isStale: true,
    snapshotAt: pack.weatherPack.snapshotAt,
  };
}

// ─── Storage estimate ─────────────────────────────────────────────────────────

export async function estimatePackStorageBytes(
  _datasetId: string,
): Promise<number> {
  return 2.5 * 1024 * 1024;
}

// ─── Expiry detection ─────────────────────────────────────────────────────────

export async function getExpiringPacks(withinHours: number): Promise<OfflinePack[]> {
  const packs = await listOfflinePacks();
  const now = Date.now();
  const threshold = withinHours * 60 * 60 * 1000;
  return packs.filter((p) => {
    const expiresAt = new Date(p.tidePack.tidalExpiresAt).getTime();
    return expiresAt - now <= threshold && expiresAt > now;
  });
}

export function isPackExpired(pack: OfflinePack): boolean {
  return new Date(pack.tidePack.tidalExpiresAt).getTime() < Date.now();
}
