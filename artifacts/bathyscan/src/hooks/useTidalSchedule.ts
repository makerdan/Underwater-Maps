import { useEffect, useState } from "react";

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
): { schedule: TidalSchedule | null; loading: boolean; isError: boolean } {
  const [schedule, setSchedule] = useState<TidalSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (lat === null || lon === null) return;
    let cancelled = false;
    const controller = new AbortController();

    async function run() {
      if (lat === null || lon === null) return;
      setLoading(true);
      try {
        const base = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
        const url = `${base}api/tidal/schedule?lat=${lat}&lon=${lon}&days=${days}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as TidalSchedule;
        if (!cancelled && !controller.signal.aborted) {
          setSchedule(json);
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
  }, [lat, lon, days]);

  return { schedule, loading, isError };
}
