import { Router } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

const NOAA_BASE = "https://api.tidesandcurrents.noaa.gov";

interface NoaaStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface TidalResponse {
  available: boolean;
  tideHeight?: number;
  currentDirection?: number;
  currentSpeed?: number;
  nextEvent?: { type: "high" | "low"; time: string; height: number };
  stationName?: string;
  stationId?: string;
  isPredicted?: boolean;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const dLon = ((toLon - fromLon) * Math.PI) / 180;
  const lat1 = (fromLat * Math.PI) / 180;
  const lat2 = (toLat * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json() as Promise<T>;
}

let stationsCache: { data: NoaaStation[]; ts: number } | null = null;

async function getNearestStation(
  lat: number,
  lon: number,
): Promise<NoaaStation | null> {
  const now = Date.now();
  if (!stationsCache || now - stationsCache.ts > 24 * 60 * 60 * 1000) {
    try {
      const resp = await fetchJson<{ stations: Array<{ id: string; name: string; lat: number; lng: number }> }>(
        `${NOAA_BASE}/mdapi/prod/webapi/stations.json?type=waterlevels&units=metric`,
      );
      stationsCache = {
        data: resp.stations.map((s) => ({ id: s.id, name: s.name, lat: Number(s.lat), lng: Number(s.lng) })),
        ts: now,
      };
    } catch (err) {
      logger.warn({ err }, "Failed to fetch NOAA station list");
      return null;
    }
  }

  const MAX_KM = 100;
  let nearest: NoaaStation | null = null;
  let nearestDist = Infinity;

  for (const s of stationsCache.data) {
    const dist = haversineKm(lat, lon, s.lat, s.lng);
    if (dist < nearestDist && dist <= MAX_KM) {
      nearestDist = dist;
      nearest = s;
    }
  }

  return nearest;
}

function toNoaaDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

interface WaterLevelResult {
  height: number;
  prevHeight: number | null;
  nextHeight: number | null;
}

async function getWaterLevelWithSlope(
  stationId: string,
  datetime?: Date,
): Promise<WaterLevelResult | null> {
  try {
    const refTime = datetime ?? new Date();

    const windowStart = new Date(refTime.getTime() - 2 * 60 * 60 * 1000);
    const windowEnd = new Date(refTime.getTime() + 2 * 60 * 60 * 1000);

    if (datetime) {
      const url =
        `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=predictions` +
        `&datum=MLLW&time_zone=GMT&units=metric&format=json` +
        `&begin_date=${toNoaaDateStr(windowStart)}&end_date=${toNoaaDateStr(windowEnd)}&interval=h`;
      const resp = await fetchJson<{ predictions?: Array<{ t: string; v: string }> }>(url);
      const pts = (resp.predictions ?? []).map((p) => ({
        time: new Date(p.t.replace(" ", "T") + "Z").getTime(),
        v: parseFloat(p.v),
      }));
      if (!pts.length) return null;
      const refMs = refTime.getTime();
      const sorted = pts.sort((a, b) => Math.abs(a.time - refMs) - Math.abs(b.time - refMs));
      const closest = sorted[0]!;
      const idx = pts.sort((a, b) => a.time - b.time).findIndex((p) => p.time === closest.time);
      const ordered = pts.sort((a, b) => a.time - b.time);
      return {
        height: closest.v,
        prevHeight: ordered[idx - 1]?.v ?? null,
        nextHeight: ordered[idx + 1]?.v ?? null,
      };
    } else {
      const url =
        `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=water_level` +
        `&datum=MLLW&time_zone=GMT&units=metric&format=json` +
        `&begin_date=${toNoaaDateStr(windowStart)}&end_date=${toNoaaDateStr(windowEnd)}`;
      const resp = await fetchJson<{ data?: Array<{ t: string; v: string }> }>(url);
      const pts = (resp.data ?? []).filter((p) => p.v && !isNaN(parseFloat(p.v))).map((p) => ({
        time: new Date(p.t.replace(" ", "T") + "Z").getTime(),
        v: parseFloat(p.v),
      }));
      if (!pts.length) return null;
      const refMs = refTime.getTime();
      const closest = pts.reduce((a, b) =>
        Math.abs(a.time - refMs) < Math.abs(b.time - refMs) ? a : b,
      );
      const idx = pts.findIndex((p) => p.time === closest.time);
      return {
        height: closest.v,
        prevHeight: pts[idx - 1]?.v ?? null,
        nextHeight: pts[idx + 1]?.v ?? null,
      };
    }
  } catch (err) {
    logger.warn({ err }, "Failed to fetch water level");
    return null;
  }
}

async function getNextTidalEvent(
  stationId: string,
  datetime?: Date,
): Promise<{ type: "high" | "low"; time: string; height: number } | null> {
  try {
    const now = datetime ?? new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const url =
      `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=predictions` +
      `&datum=MLLW&time_zone=GMT&units=metric&format=json&interval=hilo` +
      `&begin_date=${toNoaaDateStr(now)}&end_date=${toNoaaDateStr(tomorrow)}`;
    const resp = await fetchJson<{
      predictions?: Array<{ t: string; v: string; type: "H" | "L" }>;
    }>(url);
    const predictions = resp.predictions ?? [];
    const future = predictions.filter(
      (p) => new Date(p.t.replace(" ", "T") + "Z") > now,
    );
    if (!future.length) return null;
    const next = future[0]!;
    return {
      type: next.type === "H" ? "high" : "low",
      time: next.t,
      height: parseFloat(next.v),
    };
  } catch (err) {
    logger.warn({ err }, "Failed to fetch tidal predictions");
    return null;
  }
}

function deriveTidalCurrent(
  result: WaterLevelResult,
  station: NoaaStation,
  areaLat: number,
  areaLon: number,
): { direction: number; speed: number } {
  const prev = result.prevHeight;
  const next = result.nextHeight;
  const curr = result.height;

  const slope =
    prev !== null && next !== null
      ? (next - prev) / 2
      : prev !== null
        ? curr - prev
        : next !== null
          ? next - curr
          : 0;

  const rising = slope >= 0;
  const absSlope = Math.abs(slope);
  const speed = Math.min(3.0, absSlope * 8);

  const floodBearing = bearingDeg(station.lat, station.lng, areaLat, areaLon);
  const ebbBearing = (floodBearing + 180) % 360;
  const direction = rising ? floodBearing : ebbBearing;

  return { direction, speed };
}

// GET /tidal?lat=&lon=&datetime=
router.get("/tidal", async (req, res): Promise<void> => {
  const lat = parseFloat(String(req.query["lat"] ?? ""));
  const lon = parseFloat(String(req.query["lon"] ?? ""));
  const datetimeStr = String(req.query["datetime"] ?? "");

  if (isNaN(lat) || isNaN(lon)) {
    res.status(400).json({ error: "lat and lon are required numeric parameters" });
    return;
  }

  let datetime: Date | undefined;
  if (datetimeStr) {
    datetime = new Date(datetimeStr);
    if (isNaN(datetime.getTime())) {
      res.status(400).json({ error: "Invalid datetime parameter" });
      return;
    }
  }

  const station = await getNearestStation(lat, lon);
  if (!station) {
    const body: TidalResponse = { available: false };
    res.json(body);
    return;
  }

  const [waterLevel, nextEvent] = await Promise.all([
    getWaterLevelWithSlope(station.id, datetime),
    getNextTidalEvent(station.id, datetime),
  ]);

  if (waterLevel === null) {
    const body: TidalResponse = { available: false };
    res.json(body);
    return;
  }

  const { direction, speed } = deriveTidalCurrent(waterLevel, station, lat, lon);

  const body: TidalResponse = {
    available: true,
    tideHeight: waterLevel.height,
    currentDirection: direction,
    currentSpeed: speed,
    nextEvent: nextEvent ?? undefined,
    stationName: station.name,
    stationId: station.id,
    isPredicted: !!datetime,
  };
  res.json(body);
});

export default router;
