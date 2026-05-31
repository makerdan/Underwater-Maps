/**
 * useWeatherStations — fetches NOAA ASOS/AWOS station observations near the
 * active dataset centre whenever terrain is loaded.
 *
 * The query always runs when terrain is present so that the FAA WeatherCams
 * link-out button is always available regardless of the pin-overlay toggle.
 * Callers gate pin rendering using their own `weatherStationsActive` flag.
 *
 * When offline and a matching area pack is available, falls back to the
 * packed weather snapshot transparently.
 */
import { useEffect, useState } from "react";
import { useGetWeatherStations, getGetWeatherStationsQueryKey } from "@workspace/api-client-react";
import type { WeatherStation } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useOfflineStore } from "@/lib/offlineStore";
import { getPackForLocation, getOfflineWeatherValue } from "@/lib/offlinePackStore";

export type { WeatherStation };

/**
 * Returns true when the error is a 503 noaa_unavailable response.
 */
function detectNoaaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { status?: number; data?: unknown };
  if (err.status !== 503) return false;
  const data = err.data;
  if (!data || typeof data !== "object") return false;
  return (data as { error?: string }).error === "noaa_unavailable";
}

export interface ExtendedWeatherStation extends WeatherStation {
  isOfflinePack?: boolean;
  snapshotAt?: string;
}

export interface WeatherStationsResult {
  stations: ExtendedWeatherStation[];
  faaWeatherCamsUrl: string | null;
  stateCode: string | null;
  /** True when the API returned stale DB-cached data due to a NOAA outage. */
  stale: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  /**
   * True when NOAA is unreachable and there is no cached fallback data.
   */
  noaaUnavailable: boolean;
  centerLat: number | null;
  centerLon: number | null;
  /** True when weather data is served from an offline pack. */
  isOfflinePack: boolean;
  /** ISO timestamp of the offline pack snapshot, when isOfflinePack is true. */
  weatherSnapshotAt?: string;
}

export function useWeatherStations(): WeatherStationsResult {
  const { terrain } = useAppState();
  const isOnline = useOfflineStore((s) => s.isOnline);

  const centerLat = terrain ? (terrain.minLat + terrain.maxLat) / 2 : null;
  const centerLon = terrain ? (terrain.minLon + terrain.maxLon) / 2 : null;

  const [offlineStation, setOfflineStation] = useState<ExtendedWeatherStation | null>(null);
  const [offlineSnapshotAt, setOfflineSnapshotAt] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (isOnline || centerLat === null || centerLon === null) {
      setOfflineStation(null);
      setOfflineSnapshotAt(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      const pack = await getPackForLocation(centerLat, centerLon).catch(() => null);
      if (!cancelled) {
        const obs = pack ? getOfflineWeatherValue(pack) : null;
        setOfflineStation(obs ? { ...obs, isOfflinePack: true, snapshotAt: obs.snapshotAt } : null);
        setOfflineSnapshotAt(obs?.snapshotAt);
      }
    })();
    return () => { cancelled = true; };
  }, [isOnline, centerLat, centerLon]);

  const params = {
    lat: centerLat ?? 0,
    lon: centerLon ?? 0,
    radiusMiles: 75,
  };

  const { data, isLoading, isFetching, isError, error } = useGetWeatherStations(params, {
    query: {
      queryKey: getGetWeatherStationsQueryKey(params),
      enabled: centerLat !== null && centerLon !== null && isOnline,
      staleTime: 10 * 60 * 1000,
      retry: 1,
    },
  });

  const noaaUnavailable = isError && detectNoaaUnavailable(error);

  if (!isOnline && offlineStation) {
    return {
      stations: [offlineStation],
      faaWeatherCamsUrl: null,
      stateCode: null,
      stale: false,
      isLoading: false,
      isFetching: false,
      isError: false,
      noaaUnavailable: false,
      centerLat,
      centerLon,
      isOfflinePack: true,
      weatherSnapshotAt: offlineSnapshotAt,
    };
  }

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
    isOfflinePack: false,
    weatherSnapshotAt: undefined,
  };
}
