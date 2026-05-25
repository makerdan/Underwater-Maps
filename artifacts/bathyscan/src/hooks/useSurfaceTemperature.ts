/**
 * useSurfaceTemperature — fetches the live sea-surface temperature for the
 * active dataset centre via /api/water-temperature, returning a
 * `SurfaceAnchor` that components feed into `estimateWaterTemperature`.
 *
 * React Query dedupes by query key so the HUD readout and marker detail
 * card share a single network call.
 */
import { useMemo } from "react";
import {
  useGetWaterTemperature,
  getGetWaterTemperatureQueryKey,
} from "@workspace/api-client-react";
import type { SurfaceAnchor } from "@/lib/waterTemp";

export interface SurfaceTemperatureResult {
  anchor: SurfaceAnchor | null;
  loading: boolean;
  error: boolean;
}

/**
 * @param lat  Latitude to sample (null disables the fetch).
 * @param lon  Longitude to sample.
 * @param enabled Caller-controlled gate (e.g. only fetch when a marker is open).
 *
 * The caller passes coordinates explicitly so the hook can be used outside
 * of `AppProvider` (e.g. by `MarkerDetailCard`, which is mounted globally so
 * it works on the signed-out landing page and in e2e tests).
 */
export function useSurfaceTemperature(
  lat: number | null,
  lon: number | null,
  enabled = true,
): SurfaceTemperatureResult {
  const params = { lat: lat ?? 0, lon: lon ?? 0 };

  const { data, isLoading, isError } = useGetWaterTemperature(params, {
    query: {
      queryKey: getGetWaterTemperatureQueryKey(params),
      enabled: enabled && lat !== null && lon !== null,
      // SST evolves very slowly; once per session is plenty.
      staleTime: 60 * 60 * 1000,
      retry: 1,
    },
  });

  return useMemo<SurfaceTemperatureResult>(() => {
    if (!data || !data.available || typeof data.sstCelsius !== "number") {
      return { anchor: null, loading: isLoading, error: isError };
    }
    return {
      anchor: {
        sstCelsius: data.sstCelsius,
        source: data.source ?? "Open-Meteo Marine API",
        sourceUrl: data.sourceUrl ?? null,
        timestamp: data.timestamp ?? null,
      },
      loading: isLoading,
      error: isError,
    };
  }, [data, isLoading, isError]);
}
