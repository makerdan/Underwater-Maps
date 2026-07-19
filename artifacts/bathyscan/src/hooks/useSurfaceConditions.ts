/**
 * useSurfaceConditions — shared hook fetching /api/surface-conditions for the
 * active dataset centre. React Query dedupes by query key, so Drift Planner
 * (WeatherPanel) and the always-on Wind/Tide/Current overlays consume one
 * network call and stay in sync.
 *
 * Sampling time:
 *   - When Drift Planner is active, the snapshot follows `driftHour` so the
 *     planner visuals and always-on overlays agree.
 *   - Otherwise the snapshot tracks the current UTC hour, updated on a
 *     1-minute interval so the displayed time never drifts behind real time.
 *   - Callers can pin a specific hour via the `hourOverride` argument.
 *
 * Interval deduplication:
 *   A module-level singleton drives `nowHour` updates. The first consumer
 *   starts the interval; subsequent mounts only increment a reference count.
 *   The interval is cleared only when the last consumer unmounts, so exactly
 *   one timer is ever active regardless of how many components use this hook.
 */
import { useState, useEffect, useMemo } from "react";
import {
  useGetSurfaceConditions,
  getGetSurfaceConditionsQueryKey,
  type SurfaceConditions,
  type ForecastHour,
} from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useDriftStore } from "@/lib/driftStore";

export type { ForecastHour };

export interface SurfaceSnapshot {
  hour: number;
  windSpeedKnots: number;
  windDegrees: number;
  tidalSpeedKnots: number;
  tidalDegrees: number;
  waveHeightM: number;
  /** Swell/wave direction in degrees (0–359); only present when Open-Meteo Marine data is available. */
  waveDirectionDeg?: number;
  /** Best-effort flood/ebb classification from neighbouring hours (speed slope). */
  tideRising: boolean;
}

export interface SurfaceConditionsResult {
  /** Raw API response (passthrough for fields like tidalStationName, tidalDataSource). */
  data: SurfaceConditions | undefined;
  snapshot: SurfaceSnapshot | null;
  hours: SurfaceSnapshot[];
  /** 48-hour forecast strip. Empty array when data is not yet loaded. */
  forecast48h: ForecastHour[];
  centerLat: number | null;
  centerLon: number | null;
  loading: boolean;
  /** True whenever a background or foreground fetch is in-flight (superset of loading). */
  isFetching: boolean;
  error: boolean;
  estimated: boolean;
  /**
   * True when a real currents data source (noaa-coops, usgs, glerl) was
   * found for this location. False when data came from the sinusoidal
   * synthetic fallback. Always true when loading or before first fetch.
   *
   * Components should suppress currents arrows / panels when this is false
   * AND the user is in freshwater mode.
   */
  currentsAvailable: boolean;
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

// ---------------------------------------------------------------------------
// Module-level singleton interval for nowHour
// ---------------------------------------------------------------------------
// All consumers share a single interval. A listener set lets each hook
// instance subscribe to tick updates without spawning its own timer.
//
// Each hook instance still initialises its own `nowHour` state from
// Date.now() at render time (so Vitest fake-timers are respected in tests);
// the singleton only propagates subsequent ticks.
type NowHourListener = (hour: number) => void;

let _intervalId: ReturnType<typeof setInterval> | null = null;
let _refCount = 0;
const _listeners = new Set<NowHourListener>();

function _subscribeNowHour(listener: NowHourListener): () => void {
  _listeners.add(listener);
  _refCount++;

  if (_intervalId === null) {
    _intervalId = setInterval(() => {
      const h = new Date(Date.now()).getUTCHours();
      _listeners.forEach((fn) => fn(h));
    }, 60_000);
  }

  return () => {
    _listeners.delete(listener);
    _refCount--;
    if (_refCount === 0 && _intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
  };
}

// ---------------------------------------------------------------------------

export function useSurfaceConditions(
  enabled = true,
  hourOverride?: number,
  waterType?: "saltwater" | "freshwater",
): SurfaceConditionsResult {
  const { terrain } = useAppState();
  const manualWindSpeedKnots = useDriftStore((s) => s.manualWindSpeedKnots);
  const manualWindDegrees = useDriftStore((s) => s.manualWindDegrees);
  const manualTidalSpeedKnots = useDriftStore((s) => s.manualTidalSpeedKnots);
  const manualTidalDegrees = useDriftStore((s) => s.manualTidalDegrees);
  const driftPlannerActive = useDriftStore((s) => s.driftPlannerActive);
  const driftHour = useDriftStore((s) => s.driftHour);

  const centerLat = terrain ? (terrain.minLat + terrain.maxLat) / 2 : null;
  const centerLon = terrain ? (terrain.minLon + terrain.maxLon) / 2 : null;

  const params = {
    lat: centerLat ?? 0,
    lon: centerLon ?? 0,
    ...(waterType ? { waterType } : {}),
  };

  const { data, isLoading, isFetching, isError, refetch } = useGetSurfaceConditions(params, {
    query: {
      queryKey: getGetSurfaceConditionsQueryKey(params),
      enabled: enabled && centerLat !== null && centerLon !== null,
      staleTime: 30 * 60 * 1000,
      retry: 1,
    },
  });

  // Each instance initialises from Date.now() at render time so Vitest
  // fake-timers are respected. The shared singleton interval then pushes
  // subsequent ticks to all subscribers without running multiple timers.
  // Use Date.now() rather than new Date() so Vitest fake-timers always
  // produce a valid timestamp — new Date() can return an invalid Date
  // during a fake-timer–driven React render/re-render.
  const [nowHour, setNowHour] = useState<number>(() => new Date(Date.now()).getUTCHours());
  useEffect(() => {
    // Re-read on mount in case the system time changed between render and effect.
    setNowHour(new Date(Date.now()).getUTCHours());
    return _subscribeNowHour(setNowHour);
  }, []);

  return useMemo(() => {
    const fallback = {
      windSpeedKnots: manualWindSpeedKnots,
      windDegrees: manualWindDegrees,
      tidalSpeedKnots: manualTidalSpeedKnots,
      tidalDegrees: manualTidalDegrees,
    };

    const estimated = !!data?.estimatedConditions || isError || !data;
    // currentsAvailable: true when a real station was resolved (noaa-coops, usgs, glerl).
    // false only when sinusoidal synthetic fallback was used (no real station in range).
    // When loading or no data yet, optimistically return true so UI doesn't flash "unavailable".
    const tidalSrc = (data as (typeof data & { tidalDataSource?: string }) | undefined)?.tidalDataSource;
    const currentsAvailable = !data || isLoading || tidalSrc !== "sinusoidal";
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
        ...(h.waveDirectionDeg !== undefined ? { waveDirectionDeg: h.waveDirectionDeg } : {}),
        tideRising: rising,
      };
    });

    // Sample hour priority: explicit override > Drift Planner scrubber > now.
    const activeHour =
      hourOverride !== undefined
        ? ((hourOverride % 24) + 24) % 24
        : driftPlannerActive
          ? ((driftHour % 24) + 24) % 24
          : nowHour;

    const snapshot = hours.find((h) => h.hour === activeHour) ?? hours[0] ?? null;

    const ts = (() => {
      try {
        // Use Date.now() rather than new Date() so Vitest fake-timers always
        // produce a valid timestamp — new Date() can return an invalid Date
        // during a fake-timer–driven React re-render.
        const d = new Date(Date.now());
        d.setUTCMinutes(0, 0, 0);
        d.setUTCHours(activeHour);
        return d.toISOString();
      } catch {
        return null;
      }
    })();

    const forecast48h: ForecastHour[] = data?.forecast48h ?? [];

    return {
      data,
      snapshot,
      hours,
      forecast48h,
      centerLat,
      centerLon,
      loading: isLoading,
      isFetching,
      error: isError,
      estimated,
      currentsAvailable,
      timestamp: snapshot ? ts : null,
      activeHour,
      refetch: () => { void refetch(); },
      fallback,
    };
  }, [data, isLoading, isFetching, isError, refetch, centerLat, centerLon,
      manualWindSpeedKnots, manualWindDegrees,
      manualTidalSpeedKnots, manualTidalDegrees,
      driftPlannerActive, driftHour, hourOverride, nowHour]);
}
