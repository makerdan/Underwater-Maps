/**
 * useWeatherStations — fetches NOAA ASOS/AWOS station observations near the
 * active dataset centre whenever terrain is loaded.
 *
 * The query always runs when terrain is present so that the FAA WeatherCams
 * link-out button is always available regardless of the pin-overlay toggle.
 * Callers gate pin rendering using their own `weatherStationsActive` flag.
 */
import { useGetWeatherStations, getGetWeatherStationsQueryKey } from "@workspace/api-client-react";
import type { WeatherStation } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";

export type { WeatherStation };

/**
 * Returns true when the error is a 503 noaa_unavailable response.
 *
 * Errors from customFetch are `ApiError` instances with:
 *   - `error.status`  — the HTTP status code
 *   - `error.data`    — the parsed JSON body (e.g. { error: "noaa_unavailable" })
 * The native `Response` object lives at `error.response` but carries no `.data`.
 */
function detectNoaaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { status?: number; data?: unknown };
  if (err.status !== 503) return false;
  const data = err.data;
  if (!data || typeof data !== "object") return false;
  return (data as { error?: string }).error === "noaa_unavailable";
}

export interface WeatherStationsResult {
  stations: WeatherStation[];
  faaWeatherCamsUrl: string | null;
  stateCode: string | null;
  /** True when the API returned stale DB-cached data due to a NOAA outage. */
  stale: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  /**
   * True when NOAA is unreachable and there is no cached fallback data.
   * The API returns 503 with error:"noaa_unavailable" in this case.
   * This is a known, recoverable condition distinct from unexpected errors.
   */
  noaaUnavailable: boolean;
  centerLat: number | null;
  centerLon: number | null;
}

export function useWeatherStations(): WeatherStationsResult {
  const { terrain } = useAppState();

  const centerLat = terrain ? (terrain.minLat + terrain.maxLat) / 2 : null;
  const centerLon = terrain ? (terrain.minLon + terrain.maxLon) / 2 : null;

  const params = {
    lat: centerLat ?? 0,
    lon: centerLon ?? 0,
    radiusMiles: 75,
  };

  const { data, isLoading, isFetching, isError, error } = useGetWeatherStations(params, {
    query: {
      queryKey: getGetWeatherStationsQueryKey(params),
      // Always fetch when terrain is loaded — FAA button works independently of the pin toggle
      enabled: centerLat !== null && centerLon !== null,
      staleTime: 10 * 60 * 1000,
      retry: 1,
    },
  });

  const noaaUnavailable = isError && detectNoaaUnavailable(error);

  return {
    stations: data?.stations ?? [],
    faaWeatherCamsUrl: data?.faaWeatherCamsUrl ?? null,
    stateCode: data?.stateCode ?? null,
    stale: data?.stale ?? false,
    isLoading,
    isFetching,
    isError,
    noaaUnavailable,
    centerLat,
    centerLon,
  };
}
