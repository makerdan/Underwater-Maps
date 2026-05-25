import { useState, useEffect, useRef } from "react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const POLL_INTERVAL_MS = 10 * 60 * 1000;

export type TidePhase = "flooding" | "ebbing" | "slack-high" | "slack-low";

export interface SlackBlock {
  isSlack: boolean;
  phase: TidePhase;
  minutesToSlack: number;
  minutesSinceSlack: number;
  nextReversalAt: string;
}

export type TidalDataResult =
  | { available: false }
  | {
      available: true;
      tideHeight: number;
      currentDirection: number;
      currentSpeed: number;
      nextEvent?: { type: "high" | "low"; time: string; height: number };
      stationName: string;
      stationId?: string;
      isPredicted: boolean;
      source?: "noaa" | "estimated";
      slack?: SlackBlock;
    };

export function useTidalData(
  lat: number | null,
  lon: number | null,
  scrubDatetime?: Date | null,
): { data: TidalDataResult | null; loading: boolean } {
  const [data, setData] = useState<TidalDataResult | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lat === null || lon === null) return;

    let cancelled = false;

    async function fetchTidal() {
      if (lat === null || lon === null) return;
      setLoading(true);
      try {
        const base = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
        let url = `${base}api/tidal?lat=${lat}&lon=${lon}`;
        if (scrubDatetime) {
          url += `&datetime=${encodeURIComponent(scrubDatetime.toISOString())}`;
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as TidalDataResult;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData({ available: false });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchTidal();

    if (!scrubDatetime) {
      timerRef.current = setInterval(() => void fetchTidal(), POLL_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [lat, lon, scrubDatetime]);

  return { data, loading };
}
