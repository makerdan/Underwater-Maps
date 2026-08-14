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
import { useOfflineStore } from "@/lib/offlineStore";
import { useEnvOfflineStore } from "@/lib/envOfflineStore";

export interface SurfaceTemperatureResult {
  anchor: SurfaceAnchor | null;
  loading: boolean;
  error: boolean;
  /** True when data is served from the cached env pack (device is offline). */
  isCachedPack?: boolean;
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
  const isOnline = useOfflineStore((s) => s.isOnline);
  const envPack = useEnvOfflineStore((s) => s.envPack);
  const isExpired = useEnvOfflineStore((s) => s.isExpired);

  const params = { lat: lat ?? 0, lon: lon ?? 0 };

  const { data, isLoading, isError } = useGetWaterTemperature(params, {
    query: {
      queryKey: getGetWaterTemperatureQueryKey(params),
      // Disable network fetch when offline — serve from pack instead.
      enabled: enabled && lat !== null && lon !== null && isOnline,
      // SST evolves very slowly; once per session is plenty.
      staleTime: 60 * 60 * 1000,
      retry: 1,
    },
  });

  return useMemo<SurfaceTemperatureResult>(() => {
    // Offline: serve SST from the cached env pack when available and not expired.
    if (!isOnline && envPack && !isExpired()) {
      const mc = envPack.marineConditions;
      const sst = mc?.seaSurfaceTemperatureC?.[0] ?? null;
      if (typeof sst === "number") {
        return {
          anchor: {
            sstCelsius: sst,
            source: "Cached env pack",
            sourceUrl: null,
            timestamp: envPack.generatedAt,
          },
          loading: false,
          error: false,
          isCachedPack: true,
        };
      }
      return { anchor: null, loading: false, error: false, isCachedPack: true };
    }

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
  }, [data, isLoading, isError, isOnline, envPack, isExpired]);
}
