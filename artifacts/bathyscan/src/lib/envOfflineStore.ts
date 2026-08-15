/**
 * envOfflineStore.ts — persists a single EnvPack to IndexedDB and exposes
 * Zustand selectors + actions for the "Download All for Offline Use" feature.
 *
 * Mirrors the pattern in offlinePackStore.ts but manages a single global
 * weather/tidal/temperature pack rather than per-dataset packs.
 */

import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import { create } from "zustand";
import type { EnvPack } from "./envPackTypes";

export const ENV_PACK_IDB_KEY = "env-pack-v1";

// Default centre when the user has no active dataset (SE Alaska).
export const ENV_PACK_DEFAULT_LAT = 57.05;
export const ENV_PACK_DEFAULT_LON = -135.33;

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── State ────────────────────────────────────────────────────────────────────

export interface EnvOfflineState {
  /** The cached env pack, or null if none has been downloaded. */
  envPack: EnvPack | null;
  /** True while the download is in progress. */
  isDownloading: boolean;
  /** Non-null when the last download attempt failed. */
  downloadError: string | null;
  /**
   * True when IDB hydration failed on startup (e.g. private-browsing quota
   * exceeded or storage corrupted).  EnvOfflineSection shows a degraded-state
   * warning when this is set so the user knows cached data may be unavailable.
   */
  idbHydrationError: boolean;
  /**
   * True while the initial IndexedDB hydration is in flight.  EnvOfflineSection
   * shows a loading state instead of the "No data downloaded" empty state so
   * users with a saved pack never see a false empty-state flash.
   */
  isHydrating: boolean;
  /** Non-null when the last clearEnvPack() attempt failed to delete from IDB. */
  deleteError: string | null;

  // ── Selectors ──────────────────────────────────────────────────────────────
  /** True when a pack is cached and its expiresAt has passed. */
  isExpired: () => boolean;

  // ── Actions ────────────────────────────────────────────────────────────────
  /**
   * Download a fresh env pack from the server and persist it to IndexedDB.
   * Resolves after the pack is saved (or throws on fetch/parse failure).
   */
  downloadEnvPack: (
    lat: number,
    lon: number,
    radiusMiles: number,
    days: number,
  ) => Promise<void>;

  /** Remove the cached pack from memory and IndexedDB. */
  clearEnvPack: () => Promise<void>;

  /** Hydrate the in-memory state from IndexedDB (called once on startup). */
  loadFromIdb: () => Promise<void>;
}

// ─── Runtime validation ───────────────────────────────────────────────────────

/**
 * Lightweight structural check applied to every env-pack payload before it is
 * persisted (server responses) or hydrated into memory (IDB payloads).  This
 * guards rendering code (`envPack.warnings.map`, `.toFixed`, `new Date(...)`)
 * against malformed or truncated JSON and corrupted IDB data.
 */
export function isValidEnvPack(value: unknown): value is EnvPack {
  if (value === null || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;

  if (
    typeof p.generatedAt !== "string" ||
    Number.isNaN(new Date(p.generatedAt).getTime())
  ) {
    return false;
  }
  if (
    typeof p.expiresAt !== "string" ||
    Number.isNaN(new Date(p.expiresAt).getTime())
  ) {
    return false;
  }
  if (
    typeof p.centerLat !== "number" ||
    typeof p.centerLon !== "number" ||
    typeof p.coverageRadiusMiles !== "number"
  ) {
    return false;
  }
  if (!Array.isArray(p.warnings)) return false;
  if (p.tideStations !== null && !Array.isArray(p.tideStations)) return false;
  if (p.weatherStations !== null && !Array.isArray(p.weatherStations)) {
    return false;
  }
  if (p.marineConditions !== null) {
    const mc = p.marineConditions as Record<string, unknown> | undefined;
    if (
      mc === undefined ||
      typeof mc !== "object" ||
      !Array.isArray(mc.times)
    ) {
      return false;
    }
  }
  if (p.temperatureProfile !== null) {
    const tp = p.temperatureProfile as Record<string, unknown> | undefined;
    if (
      tp === undefined ||
      typeof tp !== "object" ||
      !Array.isArray(tp.samples)
    ) {
      return false;
    }
  }
  return true;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useEnvOfflineStore = create<EnvOfflineState>((set, get) => ({
  envPack: null,
  isDownloading: false,
  downloadError: null,
  idbHydrationError: false,
  isHydrating: false,
  deleteError: null,

  isExpired: () => {
    const pack = get().envPack;
    if (!pack) return false;
    return new Date(pack.expiresAt).getTime() < Date.now();
  },

  downloadEnvPack: async (lat, lon, radiusMiles, days) => {
    // Concurrent-download guard: a second call while a download is already in
    // flight is a no-op so double-clicks or programmatic races cannot corrupt
    // the loading/error state or issue duplicate network requests.
    if (get().isDownloading) return;

    set({ isDownloading: true, downloadError: null });
    try {
      const url =
        `${API_BASE}/api/env-pack` +
        `?lat=${lat}&lon=${lon}&radiusMiles=${radiusMiles}&days=${days}`;
      const res = await fetch(url);
      if (res.status === 503) {
        // Structured "complete failure" response from the server — every
        // upstream source failed or returned nothing for this location.
        throw new Error(
          "No data available for this location — try a different area",
        );
      }
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const raw: unknown = await res.json();

      // Runtime-validate before persisting so malformed or truncated server
      // JSON can never crash rendering (warnings.map, .toFixed, invalid Date).
      if (!isValidEnvPack(raw)) {
        throw new Error("Server returned malformed data — please try again");
      }
      const pack = raw;

      // Fail loudly only when ALL FOUR sources returned nothing — a pack with
      // marine conditions or a temperature profile is still useful offline
      // even when no tide/weather stations are in range.
      const hasTides =
        pack.tideStations !== null && pack.tideStations.length > 0;
      const hasWeather =
        pack.weatherStations !== null && pack.weatherStations.length > 0;
      const hasMarine =
        pack.marineConditions !== null && pack.marineConditions.times.length > 0;
      const hasProfile =
        pack.temperatureProfile !== null &&
        pack.temperatureProfile.available &&
        pack.temperatureProfile.samples.length > 0;
      if (!hasTides && !hasWeather && !hasMarine && !hasProfile) {
        throw new Error(
          "No data available for this location — try a different area",
        );
      }

      await idbSet(ENV_PACK_IDB_KEY, pack);
      set({ envPack: pack, isDownloading: false, downloadError: null });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Download failed";
      set({ isDownloading: false, downloadError: msg });
      throw err;
    }
  },

  clearEnvPack: async () => {
    try {
      await idbDel(ENV_PACK_IDB_KEY);
    } catch (err) {
      // Keep the in-memory pack intact — the IDB copy still exists, so
      // pretending it was deleted would leave the UI lying about state.
      const msg =
        err instanceof Error ? err.message : "Delete failed — please try again";
      set({ deleteError: msg });
      throw err;
    }
    set({ envPack: null, downloadError: null, deleteError: null });
  },

  loadFromIdb: async () => {
    set({ isHydrating: true });
    try {
      const raw = (await idbGet(ENV_PACK_IDB_KEY)) as unknown;
      if (raw === undefined || raw === null) return;

      if (!isValidEnvPack(raw)) {
        // Corrupted IDB payload — surface a hydration error and wipe the bad
        // key so the next hydration starts clean.
        set({ idbHydrationError: true });
        try {
          await idbDel(ENV_PACK_IDB_KEY);
        } catch {
          // Best effort — the hydration error flag is already set.
        }
        return;
      }

      // Don't overwrite a fresher pack that arrived mid-hydration (e.g. a
      // download finished while the IDB read was in flight).
      const { isDownloading, envPack: current } = get();
      if (isDownloading) return;
      if (
        current !== null &&
        new Date(current.generatedAt).getTime() >=
          new Date(raw.generatedAt).getTime()
      ) {
        return;
      }

      set({ envPack: raw });
    } catch {
      // IDB unavailable (e.g. private-browsing in some browsers, storage
      // quota exceeded, or corrupted store).  Surface as a degraded-state
      // flag so EnvOfflineSection can show a visible warning instead of
      // silently acting as if no pack exists.
      set({ idbHydrationError: true });
    } finally {
      set({ isHydrating: false });
    }
  },
}));

// Hydrate from IDB on module load (browser only).
if (typeof window !== "undefined") {
  void useEnvOfflineStore.getState().loadFromIdb();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Haversine great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

const KM_PER_MILE = 1.60934;

/**
 * True when (lat, lon) falls within the pack's stated coverage radius.
 * Uses a 10 % margin to account for edge cases near the boundary.
 */
export function isEnvPackInRange(pack: EnvPack, lat: number, lon: number): boolean {
  const distKm = haversineKm(lat, lon, pack.centerLat, pack.centerLon);
  return distKm <= pack.coverageRadiusMiles * KM_PER_MILE * 1.1;
}

/**
 * Return the nearest tide station from an env pack, or null.
 * Stations are already sorted by distance by the server.
 */
export function getEnvPackTideStation(pack: EnvPack) {
  return pack.tideStations?.[0] ?? null;
}

/**
 * Return the nearest weather station from an env pack, or null.
 */
export function getEnvPackWeatherStation(pack: EnvPack) {
  return pack.weatherStations?.[0] ?? null;
}

/**
 * Find the weather station in the pack whose `id` matches `stationId`, or null.
 * Falls back to the nearest station when `stationId` is omitted (null).
 */
export function getEnvPackWeatherStationById(
  pack: EnvPack,
  stationId: string | null,
): NonNullable<EnvPack["weatherStations"]>[number] | null {
  const stations = pack.weatherStations;
  if (!stations || stations.length === 0) return null;
  if (!stationId) return stations[0] ?? null;
  const found = stations.find((s) => s.id === stationId);
  return found !== undefined ? found : null;
}

/** Minimal schedule event shape (mirrors TidalScheduleEvent in useTidalSchedule). */
export interface PackScheduleEvent {
  type: "high" | "low";
  time: string;
  height: number;
  nextDirectionDeg: number;
  windowStart: string;
  windowEnd: string;
}

/**
 * Derive high/low tide events from a prediction series by detecting direction
 * reversals.  A local maximum (rising→falling) is a "high" event; a local
 * minimum (falling→rising) is a "low" event.
 *
 * The `windowStart`/`windowEnd` on every event is taken from the station's
 * outer time window.  `nextDirectionDeg` defaults to 0 (current direction is
 * not available from the cached pack).
 */
export function deriveScheduleEvents(
  predictions: { t: string; v: number }[],
  windowStart: string,
  windowEnd: string,
): PackScheduleEvent[] {
  if (predictions.length < 3) return [];
  const events: PackScheduleEvent[] = [];
  for (let i = 1; i < predictions.length - 1; i++) {
    const prevP = predictions[i - 1];
    const currP = predictions[i];
    const nextP = predictions[i + 1];
    if (!prevP || !currP || !nextP) continue;
    const prev = prevP.v;
    const curr = currP.v;
    const next = nextP.v;
    if (curr >= prev && curr >= next && curr > prev) {
      events.push({
        type: "high",
        time: currP.t,
        height: curr,
        nextDirectionDeg: 0,
        windowStart,
        windowEnd,
      });
    } else if (curr <= prev && curr <= next && curr < prev) {
      events.push({
        type: "low",
        time: currP.t,
        height: curr,
        nextDirectionDeg: 0,
        windowStart,
        windowEnd,
      });
    }
  }
  return events;
}

/**
 * Interpolate the tide height at `datetime` from an env pack's nearest station.
 * Falls back to 0 when no predictions are available.
 */
export function getEnvPackTideHeight(pack: EnvPack, datetime: Date): number {
  const station = getEnvPackTideStation(pack);
  if (!station || station.predictions.length === 0) return 0;
  return interpolateHeightPredictions(station.predictions, datetime.getTime());
}

function interpolateHeightPredictions(
  preds: { t: string; v: number }[],
  refMs: number,
): number {
  if (preds.length === 0) return 0;
  let prev: { t: string; v: number } | null = null;
  let next: { t: string; v: number } | null = null;
  for (const p of preds) {
    const t = new Date(p.t).getTime();
    if (t <= refMs) prev = p;
    else if (!next) {
      next = p;
      break;
    }
  }
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
