/**
 * Unit tests for getWeatherAtTime — the hourly NWS forecast interpolation
 * utility introduced in envPackInterpolation.ts.
 *
 * Each test builds a minimal EnvPack fixture with two-entry hourly arrays
 * so the cases stay fast and readable.
 */
import { describe, it, expect } from "vitest";
import {
  getWeatherAtTime,
  parseWindDirection,
  parseWindSpeedKnots,
} from "@/lib/envPackInterpolation";
import type { EnvPack } from "@/lib/envPackTypes";

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** ISO string helpers for clean fixture timestamps. */
const T0 = new Date("2024-06-01T12:00:00Z").getTime(); // base epoch
const T1 = T0 + 3_600_000; // +1 hour

function makeHourPeriod(
  startMs: number,
  {
    temperature,
    windSpeed,
    windDirection,
  }: { temperature: number; windSpeed: string; windDirection: string },
) {
  const start = new Date(startMs).toISOString();
  const end = new Date(startMs + 3_600_000).toISOString();
  return {
    startTime: start,
    endTime: end,
    temperature,
    temperatureUnit: "F",
    windSpeed,
    windDirection,
    shortForecast: "Clear",
    isDaytime: true,
  };
}

function makePack(periods: ReturnType<typeof makeHourPeriod>[]): EnvPack {
  return {
    generatedAt: new Date(T0).toISOString(),
    expiresAt: new Date(T0 + 14 * 24 * 3_600_000).toISOString(),
    centerLat: 57.0,
    centerLon: -135.0,
    coverageRadiusMiles: 50,
    tideStations: null,
    weatherStations: [
      {
        id: "PASI",
        name: "Sitka Airport",
        lat: 57.05,
        lon: -135.35,
        windSpeedKnots: null,
        windDirDeg: null,
        visibilityMiles: null,
        ceilingFt: null,
        tempC: null,
        observedAt: null,
        hourlyForecast: periods,
      },
    ],
    marineConditions: null,
    temperatureProfile: null,
    warnings: [],
  };
}

// ── parseWindDirection ────────────────────────────────────────────────────────

describe("parseWindDirection", () => {
  it("parses standard cardinal directions", () => {
    expect(parseWindDirection("N")).toBe(0);
    expect(parseWindDirection("E")).toBe(90);
    expect(parseWindDirection("S")).toBe(180);
    expect(parseWindDirection("W")).toBe(270);
  });

  it("parses inter-cardinal directions", () => {
    expect(parseWindDirection("NE")).toBe(45);
    expect(parseWindDirection("NW")).toBe(315);
    expect(parseWindDirection("SE")).toBe(135);
    expect(parseWindDirection("SW")).toBe(225);
  });

  it("parses 8-point compass directions", () => {
    expect(parseWindDirection("NNE")).toBe(22.5);
    expect(parseWindDirection("ENE")).toBe(67.5);
    expect(parseWindDirection("NNW")).toBe(337.5);
    expect(parseWindDirection("SSW")).toBe(202.5);
  });

  it("is case-insensitive", () => {
    expect(parseWindDirection("nw")).toBe(315);
    expect(parseWindDirection("Nne")).toBe(22.5);
  });

  it("parses numeric strings", () => {
    expect(parseWindDirection("180")).toBe(180);
    expect(parseWindDirection("0")).toBe(0);
    expect(parseWindDirection("370")).toBeCloseTo(10);
  });

  it("returns null for unrecognised input", () => {
    expect(parseWindDirection("CALM")).toBeNull();
    expect(parseWindDirection("")).toBeNull();
    expect(parseWindDirection("abc")).toBeNull();
  });
});

// ── parseWindSpeedKnots ───────────────────────────────────────────────────────

describe("parseWindSpeedKnots", () => {
  it("converts mph to knots", () => {
    expect(parseWindSpeedKnots("10 mph")).toBeCloseTo(10 * 0.868976);
  });

  it("converts km/h to knots", () => {
    expect(parseWindSpeedKnots("20 km/h")).toBeCloseTo(20 * 0.539957);
  });

  it("converts m/s to knots", () => {
    expect(parseWindSpeedKnots("5 m/s")).toBeCloseTo(5 * 1.94384);
  });

  it("returns knots unchanged for 'kt' unit", () => {
    expect(parseWindSpeedKnots("15 kt")).toBeCloseTo(15);
    expect(parseWindSpeedKnots("15 kts")).toBeCloseTo(15);
    expect(parseWindSpeedKnots("15 knots")).toBeCloseTo(15);
  });

  it("treats bare number as knots", () => {
    expect(parseWindSpeedKnots("8")).toBeCloseTo(8);
  });

  it("returns null for empty or non-numeric input", () => {
    expect(parseWindSpeedKnots("calm")).toBeNull();
    expect(parseWindSpeedKnots("")).toBeNull();
  });

  it("parses NWS range string 'X to Y mph' — averages and converts", () => {
    // "5 to 10 mph" → midpoint 7.5 mph → 7.5 * 0.868976 knots
    expect(parseWindSpeedKnots("5 to 10 mph")).toBeCloseTo(7.5 * 0.868976);
  });

  it("parses NWS range string 'X to Y kt' — averages, stays in knots", () => {
    expect(parseWindSpeedKnots("10 to 20 kt")).toBeCloseTo(15);
  });

  it("parses NWS range string 'X to Y km/h' — averages and converts", () => {
    expect(parseWindSpeedKnots("10 to 20 km/h")).toBeCloseTo(15 * 0.539957);
  });

  it("parses NWS range string with no unit — treats as knots", () => {
    expect(parseWindSpeedKnots("5 to 15")).toBeCloseTo(10);
  });
});

// ── getWeatherAtTime — interpolation cases ────────────────────────────────────

describe("getWeatherAtTime", () => {
  const periodA = makeHourPeriod(T0, {
    temperature: 60,
    windSpeed: "10 mph",
    windDirection: "N",
  });
  const periodB = makeHourPeriod(T1, {
    temperature: 70,
    windSpeed: "20 mph",
    windDirection: "E",
  });
  const pack = makePack([periodA, periodB]);

  it("midpoint between two readings interpolates linearly", () => {
    const mid = T0 + 1_800_000; // 30 min into the bracket
    const result = getWeatherAtTime(pack, mid);
    expect(result).not.toBeNull();
    // temperature: 60 + (70 - 60) * 0.5 = 65
    expect(result!.temperatureF).toBeCloseTo(65);
    // windSpeed: ~10*0.868976 + (20-10)*0.868976 * 0.5
    const wsA = 10 * 0.868976;
    const wsB = 20 * 0.868976;
    expect(result!.windSpeedKnots).toBeCloseTo(wsA + (wsB - wsA) * 0.5);
    // windDirection: circular mean of 0° and 90° at t=0.5 → 45°
    expect(result!.windDirDeg).toBeCloseTo(45, 0);
  });

  it("exact hour boundary (timestamp = startTime of period A) returns period A values", () => {
    const result = getWeatherAtTime(pack, T0);
    expect(result).not.toBeNull();
    expect(result!.temperatureF).toBeCloseTo(60);
    expect(result!.windSpeedKnots).toBeCloseTo(10 * 0.868976);
    expect(result!.windDirDeg).toBeCloseTo(0);
  });

  it("first hour of window (timestamp = startTime of first period) succeeds", () => {
    const result = getWeatherAtTime(pack, T0);
    expect(result).not.toBeNull();
  });

  it("last hour of window (timestamp within last period endTime) returns last period values", () => {
    // T1 is the start of the last period; T1 + 3599999 ms is 1 ms before endTime
    const result = getWeatherAtTime(pack, T1 + 3_599_999);
    expect(result).not.toBeNull();
    expect(result!.temperatureF).toBeCloseTo(70);
  });

  it("one millisecond outside window (after last endTime) returns null", () => {
    const afterEnd = T1 + 3_600_000 + 1; // 1 ms past last period endTime
    const result = getWeatherAtTime(pack, afterEnd);
    expect(result).toBeNull();
  });

  it("one millisecond before window start returns null", () => {
    const beforeStart = T0 - 1;
    const result = getWeatherAtTime(pack, beforeStart);
    expect(result).toBeNull();
  });

  it("wind direction wraps correctly at 0°/360° boundary (350°→10°)", () => {
    const pA = makeHourPeriod(T0, { temperature: 50, windSpeed: "5 mph", windDirection: "NNW" }); // 337.5°
    const pB = makeHourPeriod(T1, { temperature: 50, windSpeed: "5 mph", windDirection: "NNE" }); // 22.5°
    const wrapPack = makePack([pA, pB]);
    const mid = T0 + 1_800_000;
    const result = getWeatherAtTime(wrapPack, mid);
    expect(result).not.toBeNull();
    // Circular mean of 337.5° and 22.5° should be close to 0° / 360° (north)
    // Allow 5° tolerance around 0°/360°
    const deg = result!.windDirDeg ?? -1;
    const normalised = ((deg % 360) + 360) % 360;
    const diff = Math.min(Math.abs(normalised - 0), Math.abs(normalised - 360));
    expect(diff).toBeLessThan(5);
  });

  it("handles null-equivalent fields gracefully (missing wind data)", () => {
    // windSpeed is an empty string — parseWindSpeedKnots returns null
    const pA = makeHourPeriod(T0, { temperature: 50, windSpeed: "", windDirection: "" });
    const pB = makeHourPeriod(T1, { temperature: 60, windSpeed: "", windDirection: "" });
    const emptyPack = makePack([pA, pB]);
    const result = getWeatherAtTime(emptyPack, T0 + 1_800_000);
    expect(result).not.toBeNull();
    expect(result!.windSpeedKnots).toBeNull();
    expect(result!.windDirDeg).toBeNull();
    // Temperature should still interpolate
    expect(result!.temperatureF).toBeCloseTo(55);
  });

  it("returns null when envPack has no weatherStations", () => {
    const emptyPack: EnvPack = { ...pack, weatherStations: null };
    expect(getWeatherAtTime(emptyPack, T0 + 1_800_000)).toBeNull();
  });

  it("returns null when hourlyForecast is empty", () => {
    const noPack = makePack([]);
    expect(getWeatherAtTime(noPack, T0 + 1_800_000)).toBeNull();
  });

  it("handles single-entry forecast: inside period returns values, outside returns null", () => {
    const singlePack = makePack([periodA]);
    // Inside the period (T0 to T0+1h)
    expect(getWeatherAtTime(singlePack, T0 + 1_000)).not.toBeNull();
    // After period endTime
    expect(getWeatherAtTime(singlePack, T0 + 3_600_001)).toBeNull();
  });
});
