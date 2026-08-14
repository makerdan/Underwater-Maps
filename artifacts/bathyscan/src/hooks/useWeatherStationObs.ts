/**
 * useWeatherStationObs — fetch the NOAA observation nearest to a specific
 * target time for a single weather station.
 *
 * Used by WeatherStationPopover when the global timeline is active to replace
 * the live station snapshot with the archived observation closest to
 * `targetTime`.  Successful results are cached client-side keyed by
 * "stationId|hour" so the popover doesn't re-fetch on every scrubber tick.
 */
import { useState, useEffect, useRef } from "react";
import { useOfflineStore } from "@/lib/offlineStore";
import {
  useEnvOfflineStore,
  getEnvPackWeatherStationById,
} from "@/lib/envOfflineStore";
import { getWeatherAtTime } from "@/lib/envPackInterpolation";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const CACHE_TTL_MS = 10 * 60_000;

/** Observation fields returned by the /api/weather-station-obs endpoint. */
export interface WeatherStationObs {
  windSpeedKnots: number | null;
  windDirDeg: number | null;
  visibilityMiles: number | null;
  ceilingFt: number | null;
  tempC: number | null;
  observedAt: string | null;
}

export interface WeatherStationObsResult {
  observation: WeatherStationObs | null;
  isLoading: boolean;
  isError: boolean;
}

interface CacheEntry {
  obs: WeatherStationObs | null;
  fetchedAt: number;
}

const localCache = new Map<string, CacheEntry>();

interface PendingEntry {
  promise: Promise<WeatherStationObs | null>;
  controller: AbortController;
  refCount: number;
}

// In-flight requests keyed by cache key so concurrent callers share one
// network request.  Entries are removed when the fetch settles, or aborted
// and removed when the last subscriber unmounts.
const pendingCache = new Map<string, PendingEntry>();

/**
 * Snap a Date to the start of its UTC 15-minute slot.
 * NOAA METAR observations are typically hourly, but the nearest-obs crossover
 * happens at :30 of each hour.  A 15-minute bucket re-evaluates nearest obs
 * at each quarter-hour boundary — enough granularity for any ASOS/AWOS station.
 */
function quarterKey(d: Date): string {
  return new Date(Math.floor(d.getTime() / 900_000) * 900_000).toISOString();
}

export function useWeatherStationObs(
  stationId: string | null,
  targetTime: Date | null,
  enabled: boolean,
): WeatherStationObsResult & { isCachedPack?: boolean } {
  const [observation, setObservation] = useState<WeatherStationObs | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isCachedPack, setIsCachedPack] = useState(false);
  const isOnline = useOfflineStore((s) => s.isOnline);
  const envPack = useEnvOfflineStore((s) => s.envPack);

  // 15-minute bucket: used as the online fetch-cache key so network requests
  // are throttled to at most one per quarter-hour boundary.
  const targetTime15MinKey =
    targetTime instanceof Date && !isNaN(targetTime.getTime())
      ? quarterKey(targetTime)
      : null;

  // Exact ms timestamp — kept outside the 15-min bucket so the offline
  // interpolation re-runs on every targetTime change (not just at bucket
  // boundaries), enabling smooth scrubbing of the offline timeline.
  const targetTimeMs =
    targetTime instanceof Date && !isNaN(targetTime.getTime())
      ? targetTime.getTime()
      : null;

  // Ref holds the precise ISO string for the online API request URL so we can
  // send the exact time to the server without `targetTimeIso` in the dep array.
  const targetTimeExactRef = useRef<string | null>(null);
  targetTimeExactRef.current =
    targetTime instanceof Date && !isNaN(targetTime.getTime())
      ? targetTime.toISOString()
      : null;

  useEffect(() => {
    if (!enabled || !stationId || !targetTime15MinKey) {
      setObservation(null);
      setIsLoading(false);
      setIsError(false);
      setIsCachedPack(false);
      return;
    }

    // When offline, serve from the cached env pack when available,
    // not expired, and the requested station ID is in the pack.
    if (!isOnline) {
      const isExpired = envPack
        ? new Date(envPack.expiresAt).getTime() < Date.now()
        : true;
      const station =
        envPack && !isExpired
          ? getEnvPackWeatherStationById(envPack, stationId)
          : null;
      if (station && envPack) {
        // Use smooth interpolation from the hourly forecast rather than the
        // static observation snapshot so wind / temperature don't jump at
        // whole-hour boundaries.
        // Use the exact targetTime ms (from the dep array, not a ref) so the
        // effect recomputes whenever the scrubber moves, even within a 15-min
        // bucket where the online fetch would be cached.
        const interpolated = getWeatherAtTime(
          envPack,
          targetTimeMs ?? Date.now(),
          stationId,
        );
        // Convert interpolated temperatureF → tempC for the WeatherStationObs
        // interface (NWS hourly forecast temps are always in °F).
        const tempC =
          interpolated?.temperatureF != null
            ? (interpolated.temperatureF - 32) * (5 / 9)
            : station.tempC; // fall back to snapshot value

        const obs: WeatherStationObs = {
          windSpeedKnots: interpolated?.windSpeedKnots ?? station.windSpeedKnots,
          windDirDeg: interpolated?.windDirDeg ?? station.windDirDeg,
          visibilityMiles: station.visibilityMiles,
          ceilingFt: station.ceilingFt,
          tempC,
          observedAt: station.observedAt,
        };
        setObservation(obs);
        setIsCachedPack(true);
        setIsLoading(false);
        setIsError(false);
      } else if (!station && envPack && !isExpired) {
        // Pack available but station not found — interpolation not possible.
        setObservation(null);
        setIsCachedPack(false);
        setIsLoading(false);
        setIsError(false);
      } else {
        // No pack, or pack is expired and interpolation result would be null.
        setObservation(null);
        setIsCachedPack(false);
        setIsLoading(false);
        setIsError(false);
      }
      return;
    }

    setIsCachedPack(false);

    const cacheKey = `${stationId}|${targetTime15MinKey}`;
    const now = Date.now();
    const cached = localCache.get(cacheKey);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      setObservation(cached.obs);
      setIsLoading(false);
      setIsError(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setIsError(false);

    let pending = pendingCache.get(cacheKey);
    if (!pending) {
      const controller = new AbortController();
      const exactTime = targetTimeExactRef.current ?? targetTime15MinKey;
      const url =
        `${API_BASE}/api/weather-station-obs` +
        `?stationId=${encodeURIComponent(stationId)}` +
        `&time=${encodeURIComponent(exactTime)}`;

      const promise = fetch(url, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as {
            available: boolean;
            observation?: WeatherStationObs;
          };
          const obs = json.available && json.observation ? json.observation : null;
          localCache.set(cacheKey, { obs, fetchedAt: Date.now() });
          return obs;
        })
        .finally(() => {
          if (pendingCache.get(cacheKey) === entry) {
            pendingCache.delete(cacheKey);
          }
        });

      const entry: PendingEntry = { promise, controller, refCount: 0 };
      pendingCache.set(cacheKey, entry);
      pending = entry;
    }

    const subscribed = pending;
    subscribed.refCount += 1;

    subscribed.promise
      .then((obs) => {
        if (!cancelled) {
          setObservation(obs);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        if (!cancelled) {
          setIsError(true);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      subscribed.refCount -= 1;
      if (subscribed.refCount <= 0 && pendingCache.get(cacheKey) === subscribed) {
        subscribed.controller.abort();
        pendingCache.delete(cacheKey);
      }
    };
  // targetTimeMs is included so the offline interpolation recomputes on every
  // exact timestamp change (smooth scrubbing). The online fetch path is still
  // throttled by the cache key (stationId|targetTime15MinKey), so no extra
  // network requests are made when targetTimeMs changes within a bucket.
  }, [stationId, targetTime15MinKey, targetTimeMs, enabled, isOnline, envPack]);

  return { observation, isLoading, isError, isCachedPack };
}
