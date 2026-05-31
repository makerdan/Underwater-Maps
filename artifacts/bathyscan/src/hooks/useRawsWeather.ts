/**
 * useRawsWeather — fetches the latest observation for a single RAWS station
 * on-demand (when the user opens a pin popup). Results are cached in local
 * state for 10 minutes — no re-fetch unless the popup is closed and reopened
 * after the TTL expires.
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

export function useRawsWeather(
  datasetId: string | null,
  enabled: boolean,
): RawsWeatherResult {
  const [observation, setObservation] = useState<RawsObservation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !datasetId) {
      setObservation(null);
      setIsLoading(false);
      setIsError(false);
      return;
    }

    const now = Date.now();
    const cached = localCache.get(datasetId);
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

    const url = `${API_BASE}/api/raws-weather?datasetId=${encodeURIComponent(datasetId)}`;

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { available: boolean; observation?: RawsObservation };
        if (!cancelled) {
          const obs = json.available && json.observation ? json.observation : null;
          localCache.set(datasetId, { obs, fetchedAt: Date.now() });
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
  }, [datasetId, enabled]);

  return { observation, isLoading, isError };
}
