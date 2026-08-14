/**
 * envPackTypes.ts — Client-side mirror of the server's EnvPack type family.
 *
 * These types match the shape returned by GET /api/env-pack exactly so
 * the bathyscan client can consume env-pack responses without importing
 * server-only code.
 *
 * Keep in sync with artifacts/api-server/src/lib/envPack.ts.
 */

// ── Tide sub-types ────────────────────────────────────────────────────────────

export interface TidePredictionSample {
  t: string;
  v: number;
}

export interface TideStationDatums {
  stationId: string;
  mhwFt: number | null;
  mhhwFt: number | null;
  datum: "MLLW";
  units: "feet";
}

export interface TideStationPack {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
  windowStart: string;
  windowEnd: string;
  datum: "MLLW";
  units: "feet";
  predictions: TidePredictionSample[];
  datums: TideStationDatums | null;
}

// ── Weather sub-types ─────────────────────────────────────────────────────────

export interface WeatherHourlyForecastPeriod {
  startTime: string;
  endTime: string;
  temperature: number;
  temperatureUnit: string;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  isDaytime: boolean;
}

export interface WeatherStationPack {
  id: string;
  name: string;
  lat: number;
  lon: number;
  windSpeedKnots: number | null;
  windDirDeg: number | null;
  visibilityMiles: number | null;
  ceilingFt: number | null;
  tempC: number | null;
  observedAt: string | null;
  hourlyForecast: WeatherHourlyForecastPeriod[] | null;
}

// ── Marine conditions sub-type ────────────────────────────────────────────────

export interface MarineConditionsPack {
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

export interface TemperatureProfilePack {
  available: boolean;
  samples: TemperatureProfileSample[];
  source: string;
  sourceUrl: string | null;
  timestamp: string | null;
  provider: string;
}

// ── Top-level pack ────────────────────────────────────────────────────────────

export interface EnvPack {
  generatedAt: string;
  expiresAt: string;
  centerLat: number;
  centerLon: number;
  coverageRadiusMiles: number;
  tideStations: TideStationPack[] | null;
  weatherStations: WeatherStationPack[] | null;
  marineConditions: MarineConditionsPack | null;
  temperatureProfile: TemperatureProfilePack | null;
  warnings: string[];
}
