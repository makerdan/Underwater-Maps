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
import { useAppState } from "@/lib/context";
import type { SurfaceAnchor } from "@/lib/waterTemp";

export interface SurfaceTemperatureResult {
  anchor: SurfaceAnchor | null;
  loading: boolean;
  error: boolean;
}

export function useSurfaceTemperature(enabled = true): SurfaceTemperatureResult {
  const { terrain } = useAppState();
  const centerLat = terrain ? (terrain.minLat + terrain.maxLat) / 2 : null;
  const centerLon = terrain ? (terrain.minLon + terrain.maxLon) / 2 : null;

  const params = { lat: centerLat ?? 0, lon: centerLon ?? 0 };

  const { data, isLoading, isError } = useGetWaterTemperature(params, {
    query: {
      queryKey: getGetWaterTemperatureQueryKey(params),
      enabled: enabled && centerLat !== null && centerLon !== null,
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
