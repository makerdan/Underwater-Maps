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

export interface TemperatureProfileResult {
  profile: ApiTemperatureProfile | null;
  loading: boolean;
  error: boolean;
}

export function useTemperatureProfile(
  lat: number | null,
  lon: number | null,
  enabled = true,
): TemperatureProfileResult {
  const params = { lat: lat ?? 0, lon: lon ?? 0 };
  const { data, isLoading, isError } = useGetTemperatureProfile(params, {
    query: {
      queryKey: getGetTemperatureProfileQueryKey(params),
      enabled: enabled && lat !== null && lon !== null,
      // Climatology / bundled casts evolve very slowly.
      staleTime: 60 * 60 * 1000,
      retry: 1,
    },
  });
  return {
    profile: data ?? null,
    loading: isLoading,
    error: isError,
  };
}
