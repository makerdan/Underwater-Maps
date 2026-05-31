/**
 * useRawsStations — fetches AOOS RAWS weather station list near the active
 * dataset centre. Fetches once on mount (station list is stable, cached 24h).
 */
import { useGetRawsStations, getGetRawsStationsQueryKey } from "@workspace/api-client-react";
import type { RawsStationItem } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";

export type { RawsStationItem };

export interface RawsStationsResult {
  stations: RawsStationItem[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  centerLat: number | null;
  centerLon: number | null;
}

const DEFAULT_RADIUS_KM = 150;

export function useRawsStations(): RawsStationsResult {
  const { terrain } = useAppState();

  const centerLat = terrain ? (terrain.minLat + terrain.maxLat) / 2 : null;
  const centerLon = terrain ? (terrain.minLon + terrain.maxLon) / 2 : null;

  const params = {
    lat: centerLat ?? 0,
    lon: centerLon ?? 0,
    radiusKm: DEFAULT_RADIUS_KM,
  };

  const { data, isLoading, isFetching, isError } = useGetRawsStations(params, {
    query: {
      queryKey: getGetRawsStationsQueryKey(params),
      enabled: centerLat !== null && centerLon !== null,
      staleTime: 24 * 60 * 60 * 1000,
      retry: 1,
    },
  });

  return {
    stations: data?.available ? (data.stations ?? []) : [],
    isLoading,
    isFetching,
    isError,
    centerLat,
    centerLon,
  };
}
