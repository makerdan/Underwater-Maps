import { Router } from "express";
import { logger } from "../lib/logger.js";
import {
  buildSyntheticEvents,
  computeSlackSample,
  SLACK_THRESHOLD_DEFAULT,
  type SlackBlock,
  type TideEvent,
} from "../lib/slack.js";

const router = Router();

const NOAA_BASE = "https://api.tidesandcurrents.noaa.gov";

interface NoaaStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface StationRef {
  id: string;
  name: string;
}

interface TidalResponse {
  available: boolean;
  tideHeight?: number;
  currentDirection?: number;
  currentSpeed?: number;
  nextEvent?: { type: "high" | "low"; time: string; height: number };
  /** Legacy: name of the station that supplied tide heights (or estimate label). */
  stationName?: string;
  /** Legacy: id of the station that supplied tide heights. */
  stationId?: string;
  isPredicted?: boolean;
  /** Overall source — "noaa" if either heights or currents came from NOAA. */
  source?: "noaa" | "estimated";
  /** Source of the tide-height series (drives slack timing). */
  heightsSource?: "noaa" | "estimated";
  /** Source of the peak current speed + flood bearing. */
  currentsSource?: "noaa" | "estimated";
  /** NOAA station that supplied tide heights, if any. */
  heightsStation?: StationRef;
  /** NOAA currents-prediction station that supplied peak speed + flood bearing, if any. */
  currentsStation?: StationRef;
  slack?: SlackBlock;
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

let heightsStationsCache: { data: NoaaStation[]; ts: number } | null = null;
let currentsStationsCache: { data: NoaaStation[]; ts: number } | null = null;

async function loadStations(
  type: "waterlevels" | "currentpredictions",
): Promise<NoaaStation[] | null> {
  try {
    const resp = await fetchJson<{
      stations: Array<{ id: string; name: string; lat: number; lng: number }>;
    }>(`${NOAA_BASE}/mdapi/prod/webapi/stations.json?type=${type}&units=metric`);
    return resp.stations.map((s) => ({
      id: s.id,
      name: s.name,
      lat: Number(s.lat),
      lng: Number(s.lng),
    }));
  } catch (err) {
    logger.warn({ err, type }, "Failed to fetch NOAA station list");
    return null;
  }
}

function pickNearest(
  stations: NoaaStation[],
  lat: number,
  lon: number,
  maxKm: number,
): NoaaStation | null {
  let nearest: NoaaStation | null = null;
  let nearestDist = Infinity;
  for (const s of stations) {
    const dist = haversineKm(lat, lon, s.lat, s.lng);
    if (dist < nearestDist && dist <= maxKm) {
      nearestDist = dist;
      nearest = s;
    }
  }
  return nearest;
}

async function getNearestHeightsStation(lat: number, lon: number): Promise<NoaaStation | null> {
  const now = Date.now();
  if (!heightsStationsCache || now - heightsStationsCache.ts > 24 * 60 * 60 * 1000) {
    const data = await loadStations("waterlevels");
    if (!data) return null;
    heightsStationsCache = { data, ts: now };
  }
  return pickNearest(heightsStationsCache.data, lat, lon, 100);
}

async function getNearestCurrentsStation(lat: number, lon: number): Promise<NoaaStation | null> {
  const now = Date.now();
  if (!currentsStationsCache || now - currentsStationsCache.ts > 24 * 60 * 60 * 1000) {
    const data = await loadStations("currentpredictions");
    if (!data) return null;
    currentsStationsCache = { data, ts: now };
  }
  // Currents fields are much more localized than heights, so restrict to 50 km.
  return pickNearest(currentsStationsCache.data, lat, lon, 50);
}

function toNoaaDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/**
 * Fetch high/low tide events covering [refTime - beforeDays, refTime + afterDays].
 */
async function getHighLowEvents(
  stationId: string,
  refTime: Date,
  beforeDays = 1,
  afterDays = 2,
): Promise<TideEvent[] | null> {
  try {
    const start = new Date(refTime.getTime() - beforeDays * 24 * 3600 * 1000);
    const end = new Date(refTime.getTime() + afterDays * 24 * 3600 * 1000);
    const url =
      `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=predictions` +
      `&datum=MLLW&time_zone=GMT&units=metric&format=json&interval=hilo` +
      `&begin_date=${toNoaaDateStr(start)}&end_date=${toNoaaDateStr(end)}`;
    const resp = await fetchJson<{
      predictions?: Array<{ t: string; v: string; type: "H" | "L" }>;
    }>(url);
    const events: TideEvent[] = (resp.predictions ?? []).map((p) => ({
      type: p.type === "H" ? "high" : "low",
      time: new Date(p.t.replace(" ", "T") + "Z").getTime(),
      height: parseFloat(p.v),
    }));
    events.sort((a, b) => a.time - b.time);
    return events.length > 0 ? events : null;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch tidal hi/lo predictions");
    return null;
  }
}

/**
 * Fetch max-flood / max-ebb / slack predictions from a NOAA currents station
 * and derive peak current speed (knots) and the mean flood bearing.
 *
 * Returns null on any failure or if the response contains no usable flood
 * direction — callers should fall back to the heuristic estimator in that case.
 */
async function getCurrentsPeak(
  stationId: string,
  refTime: Date,
): Promise<{ peakSpeedKnots: number; floodBearingDeg: number } | null> {
  try {
    const start = new Date(refTime.getTime() - 24 * 3600 * 1000);
    const end = new Date(refTime.getTime() + 48 * 3600 * 1000);
    // vel_type=speed_dir asks NOAA for unsigned Speed (knots) + Direction (deg).
    const url =
      `${NOAA_BASE}/api/prod/datagetter?station=${stationId}&product=currents_predictions` +
      `&time_zone=GMT&interval=MAX_SLACK&units=english&format=json&vel_type=speed_dir` +
      `&begin_date=${toNoaaDateStr(start)}&end_date=${toNoaaDateStr(end)}`;
    const resp = await fetchJson<{
      current_predictions?: {
        cp?: Array<{
          Time?: string;
          Type?: string;
          Speed?: string | number;
          Direction?: string | number;
          Velocity_Major?: string | number;
          meanFloodDir?: string | number;
        }>;
      };
    }>(url);
    const cps = resp.current_predictions?.cp ?? [];
    if (cps.length === 0) return null;

    let maxSpeed = 0;
    let floodDir: number | null = null;
    for (const cp of cps) {
      const rawSpeed =
        cp.Speed != null ? cp.Speed : cp.Velocity_Major != null ? cp.Velocity_Major : null;
      if (rawSpeed != null) {
        const sp = Math.abs(parseFloat(String(rawSpeed)));
        if (Number.isFinite(sp) && sp > maxSpeed) maxSpeed = sp;
      }
      if (floodDir == null) {
        const meanFd = cp.meanFloodDir != null ? parseFloat(String(cp.meanFloodDir)) : NaN;
        if (Number.isFinite(meanFd)) {
          floodDir = meanFd;
        } else if (
          String(cp.Type ?? "").toLowerCase() === "flood" &&
          cp.Direction != null
        ) {
          const d = parseFloat(String(cp.Direction));
          if (Number.isFinite(d)) floodDir = d;
        }
      }
    }

    if (maxSpeed <= 0 || floodDir == null) return null;
    return {
      peakSpeedKnots: Math.max(0.1, Math.min(8.0, maxSpeed)),
      floodBearingDeg: ((floodDir % 360) + 360) % 360,
    };
  } catch (err) {
    logger.warn({ err, stationId }, "Failed to fetch NOAA currents predictions");
    return null;
  }
}

/**
 * Estimate water level at refTime by interpolating between surrounding
 * hi/lo events with a cosine curve.
 */
function interpolateHeight(events: TideEvent[], refMs: number): number {
  let prev: TideEvent | null = null;
  let next: TideEvent | null = null;
  for (const e of events) {
    if (e.time <= refMs) prev = e;
    else if (!next) { next = e; break; }
  }
  if (!prev && !next) return 0;
  if (!prev && next) return next.height;
  if (prev && !next) return prev.height;
  if (!prev || !next) return 0;
  const span = next.time - prev.time;
  if (span <= 0) return prev.height;
  const t = (refMs - prev.time) / span;
  // smooth cosine interpolation (1 → 0 over the half-cycle)
  const c = (1 - Math.cos(Math.PI * t)) / 2;
  return prev.height + (next.height - prev.height) * c;
}

/**
 * Fallback peak-speed heuristic used when no nearby NOAA currents station
 * publishes predictions. Larger tide swings ⇒ stronger currents.
 * Clamps to [0.2, 3.0] kt.
 */
function estimatePeakSpeed(events: TideEvent[], refMs: number): number {
  let prev: TideEvent | null = null;
  let next: TideEvent | null = null;
  for (const e of events) {
    if (e.time <= refMs) prev = e;
    else if (!next) { next = e; break; }
  }
  if (!prev || !next) return 1.0;
  const range = Math.abs(next.height - prev.height);
  return Math.max(0.2, Math.min(3.0, range * 0.6));
}

function nextEventFrom(events: TideEvent[], refMs: number):
  | { type: "high" | "low"; time: string; height: number }
  | undefined {
  for (const e of events) {
    if (e.time > refMs) {
      return {
        type: e.type,
        time: new Date(e.time).toISOString(),
        height: e.height,
      };
    }
  }
  return undefined;
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

  const refTime = datetime ?? new Date();
  const refMs = refTime.getTime();

  // Look up both station networks in parallel — they're independent.
  const [heightsStation, currentsStation] = await Promise.all([
    getNearestHeightsStation(lat, lon),
    getNearestCurrentsStation(lat, lon),
  ]);

  // And fetch each station's predictions in parallel as well.
  const [heightsEvents, currentsPeak] = await Promise.all([
    heightsStation ? getHighLowEvents(heightsStation.id, refTime) : Promise.resolve(null),
    currentsStation ? getCurrentsPeak(currentsStation.id, refTime) : Promise.resolve(null),
  ]);

  let events: TideEvent[];
  let heightsSource: "noaa" | "estimated";
  let heightsStationRef: StationRef | undefined;

  if (heightsStation && heightsEvents && heightsEvents.length > 0) {
    events = heightsEvents;
    heightsSource = "noaa";
    heightsStationRef = { id: heightsStation.id, name: heightsStation.name };
  } else {
    events = buildSyntheticEvents(refMs, lon);
    heightsSource = "estimated";
  }

  let peakSpeedKnots: number;
  let floodBearing: number;
  let currentsSource: "noaa" | "estimated";
  let currentsStationRef: StationRef | undefined;

  if (currentsStation && currentsPeak) {
    peakSpeedKnots = currentsPeak.peakSpeedKnots;
    floodBearing = currentsPeak.floodBearingDeg;
    currentsSource = "noaa";
    currentsStationRef = { id: currentsStation.id, name: currentsStation.name };
  } else {
    peakSpeedKnots = estimatePeakSpeed(events, refMs);
    floodBearing = heightsStation
      ? bearingDeg(heightsStation.lat, heightsStation.lng, lat, lon)
      : ((lat + lon) * 73.1 + 360) % 360;
    currentsSource = "estimated";
  }

  const sample = computeSlackSample({
    events,
    refTime: refMs,
    peakSpeedKnots,
    floodBearingDeg: floodBearing,
    slackThresholdKnots: SLACK_THRESHOLD_DEFAULT,
  });

  const tideHeight = interpolateHeight(events, refMs);
  const overallSource: "noaa" | "estimated" =
    heightsSource === "noaa" || currentsSource === "noaa" ? "noaa" : "estimated";

  const legacyStationName =
    heightsStationRef?.name ??
    currentsStationRef?.name ??
    (overallSource === "estimated" ? "Estimated (no nearby station)" : undefined);
  const legacyStationId = heightsStationRef?.id ?? currentsStationRef?.id;

  const body: TidalResponse = {
    available: true,
    tideHeight,
    currentDirection: sample.directionDeg,
    currentSpeed: sample.speedKnots,
    nextEvent: nextEventFrom(events, refMs),
    stationName: legacyStationName,
    stationId: legacyStationId,
    isPredicted: overallSource === "estimated" || !!datetime,
    source: overallSource,
    heightsSource,
    currentsSource,
    ...(heightsStationRef ? { heightsStation: heightsStationRef } : {}),
    ...(currentsStationRef ? { currentsStation: currentsStationRef } : {}),
    slack: sample.slack,
  };
  res.json(body);
});

// GET /tidal/schedule?lat=&lon=&days=N&start=ISO
// Returns the next N days of predicted high/low events plus derived
// slack windows (when current speed crosses below the slack threshold).
router.get("/tidal/schedule", async (req, res): Promise<void> => {
  const lat = parseFloat(String(req.query["lat"] ?? ""));
  const lon = parseFloat(String(req.query["lon"] ?? ""));
  const days = Math.min(14, Math.max(1, parseInt(String(req.query["days"] ?? "7"), 10) || 7));
  const startStr = String(req.query["start"] ?? "");

  if (isNaN(lat) || isNaN(lon)) {
    res.status(400).json({ error: "lat and lon are required numeric parameters" });
    return;
  }

  let startTime: Date;
  if (startStr) {
    startTime = new Date(startStr);
    if (isNaN(startTime.getTime())) {
      res.status(400).json({ error: "Invalid start parameter" });
      return;
    }
  } else {
    startTime = new Date();
  }
  const endMs = startTime.getTime() + days * 24 * 3600 * 1000;

  const station = await getNearestStation(lat, lon);
  let events: TideEvent[] | null = null;
  let source: "noaa" | "estimated" = "estimated";
  let floodBearing: number;
  let stationName: string | undefined;
  let stationId: string | undefined;

  if (station) {
    // Fetch enough margin on either side so slack-window detection at
    // the edges still has a bracket.
    events = await getHighLowEvents(station.id, startTime, 1, days + 1);
    if (events && events.length > 0) {
      source = "noaa";
      stationName = station.name;
      stationId = station.id;
    }
    floodBearing = bearingDeg(station.lat, station.lng, lat, lon);
  } else {
    floodBearing = ((lat + lon) * 73.1 + 360) % 360;
  }

  if (!events) {
    events = buildSyntheticEvents(startTime.getTime(), lon, days + 2);
    source = "estimated";
  }

  // Each high/low IS a slack point. Estimate a soft window around it
  // (~35 min half-width) using the bracketing events: speed crosses
  // below threshold when |sin(π t)| < threshold/peak.
  const SLACK_HALF_WINDOW_MS_DEFAULT = 35 * 60 * 1000;

  type ScheduleEvent = {
    type: "high" | "low";
    time: string;
    height: number;
    /** Direction the current flips TO after this event */
    nextDirectionDeg: number;
    /** ISO start/end of the slack window (~30-45 min around the event) */
    windowStart: string;
    windowEnd: string;
  };

  const ebbBearing = (floodBearing + 180) % 360;
  const scheduleEvents: ScheduleEvent[] = [];
  const startMs = startTime.getTime();

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.time < startMs || e.time > endMs) continue;

    const prev = events[i - 1];
    const next = events[i + 1];
    // After a HIGH the current ebbs (away from shore); after a LOW it floods.
    const nextDirectionDeg = e.type === "high" ? ebbBearing : floodBearing;

    // Compute half-window from the slack-threshold crossing within each
    // bracket: when |sin(π t)| = threshold / peakSpeed.
    let halfBefore = SLACK_HALF_WINDOW_MS_DEFAULT;
    let halfAfter = SLACK_HALF_WINDOW_MS_DEFAULT;
    if (prev) {
      const peak = estimatePeakSpeed(events, (prev.time + e.time) / 2);
      const ratio = Math.min(0.95, SLACK_THRESHOLD_DEFAULT / Math.max(peak, 0.05));
      const span = e.time - prev.time;
      halfBefore = Math.min(span / 2, (Math.asin(ratio) / Math.PI) * span);
    }
    if (next) {
      const peak = estimatePeakSpeed(events, (e.time + next.time) / 2);
      const ratio = Math.min(0.95, SLACK_THRESHOLD_DEFAULT / Math.max(peak, 0.05));
      const span = next.time - e.time;
      halfAfter = Math.min(span / 2, (Math.asin(ratio) / Math.PI) * span);
    }
    // Clamp to a sensible UX range (10–60 min).
    halfBefore = Math.max(10 * 60 * 1000, Math.min(60 * 60 * 1000, halfBefore));
    halfAfter = Math.max(10 * 60 * 1000, Math.min(60 * 60 * 1000, halfAfter));

    scheduleEvents.push({
      type: e.type,
      time: new Date(e.time).toISOString(),
      height: e.height,
      nextDirectionDeg: Math.round(nextDirectionDeg),
      windowStart: new Date(e.time - halfBefore).toISOString(),
      windowEnd: new Date(e.time + halfAfter).toISOString(),
    });
  }

  res.json({
    available: true,
    source,
    stationId,
    stationName: stationName ?? (source === "estimated" ? "Estimated (no nearby station)" : undefined),
    rangeStart: startTime.toISOString(),
    rangeEnd: new Date(endMs).toISOString(),
    events: scheduleEvents,
  });
});

export default router;
