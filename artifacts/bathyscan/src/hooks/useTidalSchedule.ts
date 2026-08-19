import { useEffect, useState } from "react";
import { useOfflineStore } from "@/lib/offlineStore";
import {
  useEnvOfflineStore,
  getEnvPackTideStation,
  isEnvPackInRange,
  deriveScheduleEvents,
} from "@/lib/envOfflineStore";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface TidalScheduleEvent {
  type: "high" | "low";
  time: string;
  height: number;
  nextDirectionDeg: number;
  windowStart: string;
  windowEnd: string;
}

export interface TidalSchedule {
  available: boolean;
  source?: "noaa" | "estimated";
  stationId?: string;
  stationName?: string;
  rangeStart: string;
  rangeEnd: string;
  events: TidalScheduleEvent[];
}

export function useTidalSchedule(
  lat: number | null,
  lon: number | null,
  days = 7,
  waterType?: "saltwater" | "freshwater",
): { schedule: TidalSchedule | null; loading: boolean; isError: boolean; isCachedPack?: boolean } {
  const [schedule, setSchedule] = useState<TidalSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isCachedPack, setIsCachedPack] = useState(false);
  const isOnline = useOfflineStore((s) => s.isOnline);
  const envPack = useEnvOfflineStore((s) => s.envPack);

  useEffect(() => {
    if (lat === null || lon === null) return;
    // Do not let a previous water type's forecast remain visible while the
    // new request is resolving.
    setSchedule(null);
    setIsError(false);

    // When offline, serve from the cached env pack when available,
    // not expired, and covering the requested location.
    if (!isOnline) {
      // Environmental packs contain marine NOAA predictions. Never present
      // those predictions as freshwater tidal availability.
      if (waterType === "freshwater") {
        setSchedule(null);
        setIsCachedPack(false);
        setIsError(false);
        setLoading(false);
        return;
      }
      const isExpired = envPack
        ? new Date(envPack.expiresAt).getTime() < Date.now()
        : true;
      const inRange = envPack && !isExpired ? isEnvPackInRange(envPack, lat, lon) : false;
      const station = inRange && envPack ? getEnvPackTideStation(envPack) : null;
      if (station && station.predictions.length > 0) {
        const events = deriveScheduleEvents(
          station.predictions,
          station.windowStart,
          station.windowEnd,
        );
        const synth: TidalSchedule = {
          available: true,
          source: "noaa",
          stationId: station.stationId,
          stationName: station.name,
          rangeStart: station.windowStart,
          rangeEnd: station.windowEnd,
          events,
        };
        setSchedule(synth);
        setIsCachedPack(true);
        setIsError(false);
        setLoading(false);
      } else {
        setSchedule(null);
        setIsCachedPack(false);
        setIsError(false);
        setLoading(false);
      }
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setIsCachedPack(false);

    async function run() {
      if (lat === null || lon === null) return;
      setLoading(true);
      try {
        const base = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
        const params = new URLSearchParams({
          lat: String(lat),
          lon: String(lon),
          days: String(days),
        });
        if (waterType) params.set("waterType", waterType);
        const url = `${base}api/tidal/schedule?${params.toString()}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as TidalSchedule;
        // An unavailable response is authoritative. Clear any stale events
        // rather than allowing a backend fallback payload to look usable.
        const normalized: TidalSchedule = json.available
          ? json
          : { ...json, available: false, source: undefined, events: [] };
        if (!cancelled && !controller.signal.aborted) {
          setSchedule(normalized);
          setIsError(false);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (!cancelled) {
          setSchedule(null);
          setIsError(true);
        }
        if (import.meta.env.DEV) {
          console.error("[useTidalSchedule] schedule fetch failed:", err);
        }
      } finally {
        if (!cancelled && !controller.signal.aborted) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [lat, lon, days, waterType, isOnline, envPack]);

  return { schedule, loading, isError, isCachedPack };
}
