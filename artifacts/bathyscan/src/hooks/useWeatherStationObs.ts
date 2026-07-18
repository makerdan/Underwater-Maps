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
): WeatherStationObsResult {
  const [observation, setObservation] = useState<WeatherStationObs | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  // 15-minute bucket: effect fires only when the scrubber crosses a
  // quarter-hour boundary, avoiding a fetch on every single tick while still
  // recomputing nearest-obs at meaningful granularity within the hour.
  const targetTime15MinKey =
    targetTime instanceof Date && !isNaN(targetTime.getTime())
      ? quarterKey(targetTime)
      : null;

  // Ref holds the precise ISO string for the API request URL so we can send
  // the exact time to the server without `targetTimeIso` in the dep array.
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
      return;
    }

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
  }, [stationId, targetTime15MinKey, enabled]);

  return { observation, isLoading, isError };
}
