/**
 * useSurfaceConditions — shared hook fetching /api/surface-conditions for the
 * active dataset centre. React Query dedupes by query key, so Drift Planner
 * (WeatherPanel) and the always-on Wind/Tide/Current overlays consume one
 * network call and stay in sync.
 *
 * Sampling time:
 *   - When Drift Planner is active, the snapshot follows `driftHour` so the
 *     planner visuals and always-on overlays agree.
 *   - Otherwise the snapshot tracks the current UTC hour.
 *   - Callers can pin a specific hour via the `hourOverride` argument.
 */
import { useMemo } from "react";
import {
  useGetSurfaceConditions,
  getGetSurfaceConditionsQueryKey,
  type SurfaceConditions,
} from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useDriftStore } from "@/lib/driftStore";

export interface SurfaceSnapshot {
  hour: number;
  windSpeedKnots: number;
  windDegrees: number;
  tidalSpeedKnots: number;
  tidalDegrees: number;
  waveHeightM: number;
  /** Best-effort flood/ebb classification from neighbouring hours (speed slope). */
  tideRising: boolean;
}

export interface SurfaceConditionsResult {
  /** Raw API response (passthrough for fields like tidalStationName, tidalDataSource). */
  data: SurfaceConditions | undefined;
  snapshot: SurfaceSnapshot | null;
  hours: SurfaceSnapshot[];
  centerLat: number | null;
  centerLon: number | null;
  loading: boolean;
  error: boolean;
  estimated: boolean;
  /** UTC ISO timestamp of the active sample (top-of-hour). */
  timestamp: string | null;
  /** Hour-of-day the snapshot represents (0–23, UTC). */
  activeHour: number;
  refetch: () => void;
  /** Manual fallback values from drift store (used when estimated=true). */
  fallback: {
    windSpeedKnots: number;
    windDegrees: number;
    tidalSpeedKnots: number;
    tidalDegrees: number;
  };
}

export function useSurfaceConditions(
  enabled = true,
  hourOverride?: number,
): SurfaceConditionsResult {
  const { terrain } = useAppState();
  const {
    manualWindSpeedKnots,
    manualWindDegrees,
    manualTidalSpeedKnots,
    manualTidalDegrees,
    driftPlannerActive,
    driftHour,
  } = useDriftStore();

  const centerLat = terrain ? (terrain.minLat + terrain.maxLat) / 2 : null;
  const centerLon = terrain ? (terrain.minLon + terrain.maxLon) / 2 : null;

  const params = { lat: centerLat ?? 0, lon: centerLon ?? 0 };

  const { data, isLoading, isError, refetch } = useGetSurfaceConditions(params, {
    query: {
      queryKey: getGetSurfaceConditionsQueryKey(params),
      enabled: enabled && centerLat !== null && centerLon !== null,
      staleTime: 30 * 60 * 1000,
      retry: 1,
    },
  });

  return useMemo(() => {
    const fallback = {
      windSpeedKnots: manualWindSpeedKnots,
      windDegrees: manualWindDegrees,
      tidalSpeedKnots: manualTidalSpeedKnots,
      tidalDegrees: manualTidalDegrees,
    };

    const estimated = !!data?.estimatedConditions || isError || !data;
    const hoursRaw = data?.hours ?? [];

    const hours: SurfaceSnapshot[] = hoursRaw.map((h, i) => {
      const next = hoursRaw[i + 1];
      const rising = next ? next.tidalSpeedKnots >= h.tidalSpeedKnots : true;
      return {
        hour: h.hour,
        windSpeedKnots: h.windSpeedKnots,
        windDegrees: h.windDegrees,
        tidalSpeedKnots: h.tidalSpeedKnots,
        tidalDegrees: h.tidalDegrees,
        waveHeightM: h.waveHeightM,
        tideRising: rising,
      };
    });

    // Sample hour priority: explicit override > Drift Planner scrubber > now.
    const nowHour = new Date().getUTCHours();
    const activeHour =
      hourOverride !== undefined
        ? ((hourOverride % 24) + 24) % 24
        : driftPlannerActive
          ? ((driftHour % 24) + 24) % 24
          : nowHour;

    const snapshot = hours.find((h) => h.hour === activeHour) ?? hours[0] ?? null;

    const ts = (() => {
      const d = new Date();
      d.setUTCMinutes(0, 0, 0);
      d.setUTCHours(activeHour);
      return d.toISOString();
    })();

    return {
      data,
      snapshot,
      hours,
      centerLat,
      centerLon,
      loading: isLoading,
      error: isError,
      estimated,
      timestamp: snapshot ? ts : null,
      activeHour,
      refetch: () => { void refetch(); },
      fallback,
    };
  }, [data, isLoading, isError, refetch, centerLat, centerLon,
      manualWindSpeedKnots, manualWindDegrees,
      manualTidalSpeedKnots, manualTidalDegrees,
      driftPlannerActive, driftHour, hourOverride]);
}
