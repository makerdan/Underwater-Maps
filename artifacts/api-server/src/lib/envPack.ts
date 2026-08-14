/**
 * envPack.ts — Shared TypeScript types for the Environmental Data Pack API.
 *
 * These types define the shape of GET /api/env-pack responses.  They are
 * intentionally kept as plain interfaces (no runtime code) so they can be
 * imported by both the route handler and any consuming packages without
 * pulling in heavy dependencies.
 */

// ── Tide sub-types ────────────────────────────────────────────────────────────

/** A single 6-minute tide-height prediction sample. */
export interface TidePredictionSample {
  /** ISO 8601 UTC timestamp of the prediction. */
  t: string;
  /** Predicted water level in feet above MLLW. */
  v: number;
}

/** MHW / MHHW tidal datum values for a station. */
export interface TideStationDatums {
  stationId: string;
  /** Mean High Water, feet above MLLW, or null when NOAA has no value. */
  mhwFt: number | null;
  /** Mean Higher High Water, feet above MLLW, or null when NOAA has no value. */
  mhhwFt: number | null;
  datum: "MLLW";
  units: "feet";
}

/** A NOAA CO-OPS tide station with its prediction window and datums. */
export interface TideStationPack {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
  /** UTC anchor of the prediction window (midnight of today). */
  windowStart: string;
  /** UTC end of the prediction window (windowStart + days). */
  windowEnd: string;
  datum: "MLLW";
  units: "feet";
  predictions: TidePredictionSample[];
  datums: TideStationDatums | null;
}

// ── Weather sub-types ─────────────────────────────────────────────────────────

/** A single period from an NWS hourly forecast grid. */
export interface WeatherHourlyForecastPeriod {
  startTime: string;
  endTime: string;
  /** Temperature value (unit given by temperatureUnit). */
  temperature: number;
  temperatureUnit: string;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  isDaytime: boolean;
}

/** A NOAA ASOS/AWOS weather station with its latest observation and hourly forecast. */
export interface WeatherStationPack {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Latest surface observation fields. */
  windSpeedKnots: number | null;
  windDirDeg: number | null;
  visibilityMiles: number | null;
  ceilingFt: number | null;
  tempC: number | null;
  observedAt: string | null;
  /**
   * 7-day hourly NWS forecast for the grid cell containing this station.
   * null when the forecast endpoint was unreachable.
   */
  hourlyForecast: WeatherHourlyForecastPeriod[] | null;
}

// ── Marine conditions sub-type ────────────────────────────────────────────────

/**
 * Open-Meteo Marine API — 14-day hourly marine forecast at the center point.
 * All three arrays are parallel to `times`.  Individual entries may be null
 * when Open-Meteo has no value for that hour.
 */
export interface MarineConditionsPack {
  /** ISO 8601 UTC timestamps, one per hour. */
  times: string[];
  seaSurfaceTemperatureC: (number | null)[];
  waveHeightM: (number | null)[];
  waveDirectionDeg: (number | null)[];
}

// ── Temperature profile sub-type ──────────────────────────────────────────────

export interface TemperatureProfileSample {
  depthM: number;
  temperatureC: number;
}

/** WOA 2023 / Argo depth-resolved temperature profile at the center point. */
export interface TemperatureProfilePack {
  available: boolean;
  samples: TemperatureProfileSample[];
  source: string;
  sourceUrl: string | null;
  timestamp: string | null;
  provider: string;
}

// ── Top-level pack ────────────────────────────────────────────────────────────

/**
 * The full Environmental Data Pack.
 *
 * Any data source that is unreachable contributes null to its field and a
 * human-readable message to `warnings`.  The endpoint never returns a non-200
 * status due to partial upstream failures.
 */
export interface EnvPack {
  generatedAt: string;
  /** generatedAt + 14 days — callers use this to detect stale packs. */
  expiresAt: string;
  centerLat: number;
  centerLon: number;
  coverageRadiusMiles: number;
  /** NOAA CO-OPS tide stations within the radius with predictions + datums. */
  tideStations: TideStationPack[] | null;
  /** NOAA ASOS/AWOS weather stations within the radius with observations + forecast. */
  weatherStations: WeatherStationPack[] | null;
  /** Open-Meteo Marine 14-day hourly forecast at the center point. */
  marineConditions: MarineConditionsPack | null;
  /** WOA 2023 / Argo depth-resolved temperature profile at the center point. */
  temperatureProfile: TemperatureProfilePack | null;
  /** Human-readable messages for any data sources that failed or were skipped. */
  warnings: string[];
}
