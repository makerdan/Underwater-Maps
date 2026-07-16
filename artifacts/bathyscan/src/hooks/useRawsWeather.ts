/**
 * useRawsWeather — fetches the observation for a single RAWS station
 * on-demand (when the user opens a pin popup).
 *
 * When `targetTime` is provided the hook hits the time-parameterised API
 * endpoint and returns the observation nearest to that moment; when omitted
 * it fetches the latest observation as before.
 *
 * Results are cached client-side by "datasetId|hour" for 10 minutes.
 */
import { useState, useEffect, useRef } from "react";
import type { RawsObservation } from "@workspace/api-client-react";

export type { RawsObservation };

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const CACHE_TTL_MS = 10 * 60_000;

export interface RawsWeatherResult {
  observation: RawsObservation | null;
  isLoading: boolean;
  isError: boolean;
}

interface CacheEntry {
  obs: RawsObservation | null;
  fetchedAt: number;
}

const localCache = new Map<string, CacheEntry>();

/**
 * Snap a Date to the start of its UTC 15-minute slot.
 * Using 15-minute buckets (rather than hourly) ensures nearest-observation
 * selection is re-evaluated at every quarter-hour boundary — important for
 * higher-cadence RAWS stations that report more than once per hour.
 */
function quarterKey(d: Date): string {
  return new Date(Math.floor(d.getTime() / 900_000) * 900_000).toISOString();
}

export function useRawsWeather(
  datasetId: string | null,
  enabled: boolean,
  targetTime?: Date | null,
): RawsWeatherResult {
  const [observation, setObservation] = useState<RawsObservation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  // 15-minute-bucketed key — controls WHEN the effect re-fires so nearest-obs
  // is re-evaluated at each quarter-hour boundary, not just hourly crossings.
  const targetTimeQuarterKey =
    targetTime instanceof Date && !isNaN(targetTime.getTime())
      ? quarterKey(targetTime)
      : null;

  // Ref holds the precise ISO string so the effect always sends the exact time
  // to the API without `targetTimeExact` appearing in the dep array (which would
  // cause a re-fetch on every tick rather than only on hour changes).
  const targetTimeExactRef = useRef<string | null>(null);
  targetTimeExactRef.current =
    targetTime instanceof Date && !isNaN(targetTime.getTime())
      ? targetTime.toISOString()
      : null;

  useEffect(() => {
    if (!enabled || !datasetId) {
      setObservation(null);
      setIsLoading(false);
      setIsError(false);
      return;
    }

    const cacheKey = targetTimeQuarterKey ? `${datasetId}|${targetTimeQuarterKey}` : datasetId;
    const now = Date.now();
    const cached = localCache.get(cacheKey);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      setObservation(cached.obs);
      setIsLoading(false);
      setIsError(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoading(true);
    setIsError(false);

    const exactTime = targetTimeExactRef.current;
    let url = `${API_BASE}/api/raws-weather?datasetId=${encodeURIComponent(datasetId)}`;
    if (exactTime) {
      // Pass exact time to server; server performs nearest-observation selection
      url += `&time=${encodeURIComponent(exactTime)}`;
    }

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { available: boolean; observation?: RawsObservation };
        if (!cancelled) {
          const obs = json.available && json.observation ? json.observation : null;
          localCache.set(cacheKey, { obs, fetchedAt: Date.now() });
          setObservation(obs);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        if (!cancelled) {
          setIsError(true);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [datasetId, enabled, targetTimeQuarterKey]);

  return { observation, isLoading, isError };
}
