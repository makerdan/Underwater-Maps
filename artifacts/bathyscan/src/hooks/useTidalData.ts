import { useState, useEffect, useRef, useCallback } from "react";
import { useOfflineStore } from "@/lib/offlineStore";
import {
  getPackForLocation,
  getOfflineTideValue,
} from "@/lib/offlinePackStore";

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

export interface StationRef {
  id: string;
  name: string;
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
      /**
       * Overall source of this tidal observation.
       * - "noaa"     : real NOAA CO-OPS tide/currents station (saltwater)
       * - "usgs"     : real USGS NWIS gauge (freshwater)
       * - "glerl"    : real NOAA GLERL Great-Lakes model (freshwater)
       * - "estimated": sinusoidal synthetic fallback (no real station in range)
       */
      source?: "noaa" | "usgs" | "glerl" | "estimated";
      /** Source of the peak-current data (drives whether currents are real). */
      currentsSource?: "noaa" | "usgs" | "glerl" | "estimated";
      /** Source of the tide-height series. */
      heightsSource?: "noaa" | "usgs" | "glerl" | "estimated";
      /** Approximate distance to the data station, km. */
      distanceKm?: number;
      /** NOAA currents-predictions station, when one was in range. */
      currentsStation?: StationRef;
      /** NOAA water-levels station, when one was in range. */
      heightsStation?: StationRef;
      slack?: SlackBlock;
      /** True when data is served from an offline pack rather than the network. */
      isOfflinePack?: boolean;
      /** ISO timestamp of the offline pack snapshot, when isOfflinePack is true. */
      packSnapshotAt?: string;
    };

export function useTidalData(
  lat: number | null,
  lon: number | null,
  scrubDatetime?: Date | null,
  waterType?: "saltwater" | "freshwater",
): { data: TidalDataResult | null; loading: boolean; retry: () => void; isOfflinePack: boolean; packSnapshotAt?: string } {
  const [data, setData] = useState<TidalDataResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOnline = useOfflineStore((s) => s.isOnline);

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  // Keep a ref to the latest lat/lon so the interval callback always uses
  // the current coordinates even when they change between ticks.
  const latRef = useRef(lat);
  const lonRef = useRef(lon);
  useEffect(() => { latRef.current = lat; }, [lat]);
  useEffect(() => { lonRef.current = lon; }, [lon]);

  useEffect(() => {
    if (lat === null || lon === null) return;

    let cancelled = false;
    let activeController: AbortController | null = null;

    async function fetchTidal() {
      const currentLat = latRef.current;
      const currentLon = lonRef.current;
      if (currentLat === null || currentLon === null) return;
      if (activeController) activeController.abort();
      const controller = new AbortController();
      activeController = controller;
      setLoading(true);
      try {
        const base = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
        let url = `${base}api/tidal?lat=${currentLat}&lon=${currentLon}`;
        if (scrubDatetime) {
          url += `&datetime=${encodeURIComponent(scrubDatetime.toISOString())}`;
        }
        if (waterType) {
          url += `&waterType=${encodeURIComponent(waterType)}`;
        }
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as TidalDataResult;
        if (!cancelled && !controller.signal.aborted) setData(json);
      } catch (err) {
        if (controller.signal.aborted) return;
        // On network failure, try the offline pack
        if (!cancelled) {
          const pack = await getPackForLocation(currentLat, currentLon).catch(() => null);
          if (pack) {
            const dt = scrubDatetime ?? new Date();
            const packVal = getOfflineTideValue(pack, dt);
            setData({
              available: true,
              tideHeight: packVal.tideHeight,
              currentDirection: packVal.currentDirection,
              currentSpeed: packVal.currentSpeed,
              stationName: pack.tidePack.station ?? "Offline Pack",
              isPredicted: true,
              source: "noaa",
              isOfflinePack: true,
              packSnapshotAt: pack.savedAt,
            });
          } else {
            setData({ available: false });
          }
        }
        if (import.meta.env.DEV) {
          console.error("[useTidalData] tidal fetch failed (falling back to offline pack):", err);
        }
      } finally {
        if (!cancelled && !controller.signal.aborted) setLoading(false);
      }
    }

    // If offline, immediately try the pack without a network call
    if (!isOnline) {
      void (async () => {
        setLoading(true);
        const pack = await getPackForLocation(lat, lon).catch(() => null);
        if (!cancelled) {
          if (pack) {
            const dt = scrubDatetime ?? new Date();
            const packVal = getOfflineTideValue(pack, dt);
            setData({
              available: true,
              tideHeight: packVal.tideHeight,
              currentDirection: packVal.currentDirection,
              currentSpeed: packVal.currentSpeed,
              stationName: pack.tidePack.station ?? "Offline Pack",
              isPredicted: true,
              source: "noaa",
              isOfflinePack: true,
              packSnapshotAt: pack.savedAt,
            });
          } else {
            setData({ available: false });
          }
          setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }

    void fetchTidal();

    if (!scrubDatetime) {
      timerRef.current = setInterval(() => void fetchTidal(), POLL_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      if (activeController) activeController.abort();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [lat, lon, scrubDatetime, retryCount, isOnline, waterType]);

  const isOfflinePack =
    data !== null &&
    "available" in data &&
    data.available === true &&
    (data as { isOfflinePack?: boolean }).isOfflinePack === true;

  const packSnapshotAt =
    isOfflinePack && data && "packSnapshotAt" in data
      ? (data as { packSnapshotAt?: string }).packSnapshotAt
      : undefined;

  return { data, loading, retry, isOfflinePack, packSnapshotAt };
}
