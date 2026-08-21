/**
 * envPackWeather.ts — Fetches NOAA ASOS/AWOS weather stations within a radius
 * along with the 7-day NWS hourly forecast for the area.
 *
 * Strategy:
 *   1. Call fetchWeatherStations() (existing fetcher, incl. in-memory + DB cache).
 *   2. Resolve the NWS grid cell for the center point via /points/{lat},{lon}.
 *   3. Fetch the hourly forecast from the resolved gridpoints URL.
 *   4. Attach the same hourly forecast to every station in the result (all
 *      nearby stations share the same NWS grid cell area).
 */

import { environmentalObservations } from "../domains/environmental/service.js";
import { logger } from "./logger.js";
import type { WeatherStationPack, WeatherHourlyForecastPeriod } from "./envPack.js";

const NOAA_API_BASE = "https://api.weather.gov";
const FETCH_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "BathyScan/1.0 (bathyscan@example.com)" },
    });
  } finally {
    clearTimeout(id);
  }
}

interface NwsPointsResponse {
  properties?: {
    forecastHourly?: string;
  };
}

interface NwsForecastPeriod {
  startTime?: string;
  endTime?: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
  isDaytime?: boolean;
}

interface NwsForecastResponse {
  properties?: {
    periods?: NwsForecastPeriod[];
  };
}

/**
 * Resolve the NWS /points endpoint for a lat/lon and fetch the hourly forecast.
 * Returns null when the point is outside NWS coverage or any network error
 * occurs.
 */
async function fetchHourlyForecast(
  lat: number,
  lon: number,
): Promise<WeatherHourlyForecastPeriod[] | null> {
  try {
    const pointsRes = await fetchWithTimeout(
      `${NOAA_API_BASE}/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      FETCH_TIMEOUT_MS,
    );
    if (!pointsRes.ok) return null;
    const pointsJson = (await pointsRes.json()) as NwsPointsResponse;
    const forecastHourlyUrl = pointsJson.properties?.forecastHourly;
    if (!forecastHourlyUrl) return null;

    const forecastRes = await fetchWithTimeout(forecastHourlyUrl, FETCH_TIMEOUT_MS);
    if (!forecastRes.ok) return null;
    const forecastJson = (await forecastRes.json()) as NwsForecastResponse;
    const periods = forecastJson.properties?.periods ?? [];

    const result: WeatherHourlyForecastPeriod[] = periods
      .filter(
        (p): p is Required<NwsForecastPeriod> =>
          typeof p.startTime === "string" &&
          typeof p.endTime === "string" &&
          typeof p.temperature === "number" &&
          typeof p.temperatureUnit === "string",
      )
      .map((p) => ({
        startTime: p.startTime,
        endTime: p.endTime,
        temperature: p.temperature,
        temperatureUnit: p.temperatureUnit,
        windSpeed: p.windSpeed ?? "",
        windDirection: p.windDirection ?? "",
        shortForecast: p.shortForecast ?? "",
        isDaytime: p.isDaytime ?? true,
      }));

    return result.length > 0 ? result : null;
  } catch (err) {
    logger.warn({ err, lat, lon }, "[envPackWeather] Failed to fetch NWS hourly forecast");
    return null;
  }
}

/**
 * Fetch all NOAA weather stations within `radiusMiles` of the center point,
 * each with its current observation and the 7-day NWS hourly forecast for the
 * grid area.
 *
 * Returns null when the underlying weather-station fetch fails entirely (e.g.
 * NOAA is unreachable and there is no DB-cached data).
 */
export async function fetchWeatherStationPacks(
  lat: number,
  lon: number,
  radiusMiles: number,
): Promise<WeatherStationPack[] | null> {
  let stationsResult: Awaited<ReturnType<typeof environmentalObservations.weather.stations>>;
  try {
    stationsResult = await environmentalObservations.weather.stations(lat, lon, radiusMiles);
  } catch {
    // NoaaUnavailableError or any other error — treat as unavailable.
    logger.warn({ lat, lon, radiusMiles }, "[envPackWeather] fetchWeatherStations failed");
    return null;
  }

  // Fetch the hourly forecast for the center point once (all nearby stations
  // share the same NWS grid cell so one call covers the whole area).
  const hourlyForecast = await fetchHourlyForecast(lat, lon);

  const packs: WeatherStationPack[] = stationsResult.stations.map((station) => ({
    id: station.id,
    name: station.name,
    lat: station.lat,
    lon: station.lon,
    windSpeedKnots: station.windSpeedKnots,
    windDirDeg: station.windDirDeg,
    visibilityMiles: station.visibilityMiles,
    ceilingFt: station.ceilingFt,
    tempC: station.tempC,
    observedAt: station.observedAt,
    hourlyForecast,
  }));

  return packs;
}
