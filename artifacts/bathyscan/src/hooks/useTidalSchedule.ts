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
): { schedule: TidalSchedule | null; loading: boolean } {
  const [schedule, setSchedule] = useState<TidalSchedule | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (lat === null || lon === null) return;
    let cancelled = false;

    async function run() {
      if (lat === null || lon === null) return;
      setLoading(true);
      try {
        const base = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
        const url = `${base}api/tidal/schedule?lat=${lat}&lon=${lon}&days=${days}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as TidalSchedule;
        if (!cancelled) setSchedule(json);
      } catch {
        if (!cancelled) setSchedule(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [lat, lon, days]);

  return { schedule, loading };
}
