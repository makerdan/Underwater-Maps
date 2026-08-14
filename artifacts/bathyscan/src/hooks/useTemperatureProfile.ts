/**
 * useTemperatureProfile — fetches a real depth-resolved temperature
 * profile for a lat/lon via /api/temperature-profile.
 *
 * Returns the upstream payload directly. When the server reports
 * `available: false` (no bundled CTD / Argo / reanalysis match), callers
 * are expected to fall back to the surface-anchored thermocline model in
 * `sampleTemperatureProfile` (see lib/waterTemp.ts).
 */
import {
  useGetTemperatureProfile,
  getGetTemperatureProfileQueryKey,
  type TemperatureProfile as ApiTemperatureProfile,
} from "@workspace/api-client-react";
import { useOfflineStore } from "@/lib/offlineStore";
import { useEnvOfflineStore } from "@/lib/envOfflineStore";

export interface TemperatureProfileResult {
  profile: ApiTemperatureProfile | null;
  loading: boolean;
  error: boolean;
  /** True when data is served from the cached env pack (device is offline). */
  isCachedPack?: boolean;
}

export function useTemperatureProfile(
  lat: number | null,
  lon: number | null,
  enabled = true,
  datasetId?: string | null,
): TemperatureProfileResult {
  const isOnline = useOfflineStore((s) => s.isOnline);
  const envPack = useEnvOfflineStore((s) => s.envPack);
  const isExpired = useEnvOfflineStore((s) => s.isExpired);

  const params = {
    lat: lat ?? 0,
    lon: lon ?? 0,
    ...(datasetId ? { datasetId } : {}),
  };
  const { data, isLoading, isError } = useGetTemperatureProfile(params, {
    query: {
      queryKey: getGetTemperatureProfileQueryKey(params),
      // Disable network fetch when offline — serve from pack instead.
      enabled: enabled && lat !== null && lon !== null && isOnline,
      // Climatology / bundled casts evolve very slowly.
      staleTime: 60 * 60 * 1000,
      retry: 1,
    },
  });

  // Offline: serve profile from the cached env pack when available and not expired.
  if (!isOnline && envPack && !isExpired()) {
    const tp = envPack.temperatureProfile;
    if (tp?.available && tp.samples.length > 0) {
      const syntheticProfile: ApiTemperatureProfile = {
        available: true,
        lat: lat ?? 0,
        lon: lon ?? 0,
        samples: tp.samples,
        source: tp.source,
        sourceUrl: tp.sourceUrl ?? undefined,
        timestamp: tp.timestamp ?? undefined,
        provider: tp.provider,
      };
      return { profile: syntheticProfile, loading: false, error: false, isCachedPack: true };
    }
    return { profile: null, loading: false, error: false, isCachedPack: true };
  }

  return {
    profile: data ?? null,
    loading: isLoading,
    error: isError,
  };
}
