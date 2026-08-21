import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearHighLowEventsCacheForTests,
  __clearStationListCachesForTests,
  __clearTidesDatumsCacheForTests,
  __clearTidesPredictionsCacheForTests,
  getCurrentPredictionWindow,
  getCurrentsPeak,
  getHighLowEvents,
  getPredictionWindow,
  getStationDatums,
  getStationList,
  getTidePredictions,
  refreshStationLists,
  TIDES_DATUMS_TTL_MS,
  TIDES_PREDICTIONS_TTL_MS,
  TIDES_WINDOW_DAYS,
} from "../noaaTides.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const STATION = { id: "9450460", name: "Ketchikan", lat: 55.3319, lng: -131.6261 };
const NOW = new Date("2026-08-13T10:30:00Z");

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch") as unknown as ReturnType<typeof vi.spyOn>;
  __clearStationListCachesForTests();
  __clearHighLowEventsCacheForTests();
  __clearTidesPredictionsCacheForTests();
  __clearTidesDatumsCacheForTests();
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.useRealTimers();
});

describe("station lists", () => {
  it("caches a successful list and refreshStationLists forces the next fetch", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ stations: [STATION] }))
      .mockResolvedValueOnce(jsonResponse({ stations: [] }));

    expect(await getStationList("waterlevels")).toEqual([STATION]);
    expect(await getStationList("waterlevels")).toEqual([STATION]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(refreshStationLists()).toBe(1);
    expect(await getStationList("waterlevels")).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous list during a failed refresh and suppresses retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fetchSpy.mockResolvedValueOnce(jsonResponse({ stations: [STATION] }))
      .mockRejectedValue(new Error("NOAA down"));

    await getStationList("waterlevels");
    vi.setSystemTime(NOW.getTime() + 25 * 60 * 60 * 1000);
    expect(await getStationList("waterlevels")).toEqual([STATION]);
    expect(await getStationList("waterlevels")).toEqual([STATION]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("tide predictions", () => {
  it("normalizes the 31-day MLLW/feet window and refreshes after its TTL", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      predictions: [
        { t: "2026-08-13 00:00", v: "1.5" },
        { t: "2026-08-13 06:00", v: "not-a-number" },
      ],
    }));
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const first = await getTidePredictions(STATION.id, NOW);
    expect(first).toMatchObject({
      stationId: STATION.id,
      windowStart: "2026-08-13T00:00:00.000Z",
      datum: "MLLW",
      units: "feet",
    });
    expect(first?.windowEnd).toBe("2026-09-13T00:00:00.000Z");
    expect(first?.predictions).toEqual([{ t: "2026-08-13T00:00:00.000Z", v: 1.5 }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await getTidePredictions(STATION.id, NOW);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW.getTime() + TIDES_PREDICTIONS_TTL_MS + 1);
    await getTidePredictions(STATION.id, NOW);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("end_date=20260913");
    expect(TIDES_WINDOW_DAYS).toBe(31);
  });

  it("coalesces concurrent requests for one station and window", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((res) => { resolve = res; });
    fetchSpy.mockReturnValue(pending);

    const first = getTidePredictions(STATION.id, NOW);
    const second = getTidePredictions(STATION.id, NOW);
    resolve(jsonResponse({ predictions: [{ t: "2026-08-13 00:00", v: "2" }] }));

    const [a, b] = await Promise.all([first, second]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });
});

describe("station datums", () => {
  it("coalesces requests, caches the result, and refreshes after the datum TTL", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      datums: [{ name: "MHW", value: 14.53 }, { name: "MHHW", value: 15.42 }],
    }));
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const [a, b] = await Promise.all([getStationDatums(STATION.id), getStationDatums(STATION.id)]);
    expect(a).toEqual({
      stationId: STATION.id, mhwFt: 14.53, mhhwFt: 15.42, datum: "MLLW", units: "feet",
    });
    expect(b).toEqual(a);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await getStationDatums(STATION.id);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW.getTime() + TIDES_DATUMS_TTL_MS + 1);
    await getStationDatums(STATION.id);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("schedule and pack adapters", () => {
  it("filters invalid hi/lo heights and sorts events chronologically", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      predictions: [
        { t: "2026-08-13 12:00", v: "1.2", type: "H" },
        { t: "2026-08-13 00:00", v: "-0.4", type: "L" },
        { t: "2026-08-13 06:00", v: "101", type: "H" },
        { t: "2026-08-13 18:00", v: "bad", type: "L" },
      ],
    }));

    await expect(getHighLowEvents(STATION.id, NOW, 1, 2)).resolves.toEqual([
      { type: "low", time: Date.parse("2026-08-13T00:00:00Z"), height: -0.4 },
      { type: "high", time: Date.parse("2026-08-13T12:00:00Z"), height: 1.2 },
    ]);
  });

  it("uses the flood direction fallback and clamps peak current speed", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      current_predictions: { cp: [
        { Type: "ebb", Speed: "-2.5", Direction: "450" },
        { Type: "flood", Velocity_Major: "12", Direction: "450" },
      ] },
    }));

    await expect(getCurrentsPeak(STATION.id, NOW)).resolves.toEqual({
      peakSpeedKnots: 8,
      floodBearingDeg: 90,
    });
  });

  it("builds metric prediction/current pack windows with normalized samples", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({
        predictions: [{ t: "2026-08-13 10:00", v: "1.25" }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        current_predictions: { cp: [{ Time: "2026-08-13 11:00", Speed: "-2.5", Direction: "270" }] },
      }));

    await expect(getPredictionWindow(STATION.id, NOW, 3)).resolves.toEqual([
      { t: "2026-08-13T10:00:00.000Z", v: 1.25 },
    ]);
    await expect(getCurrentPredictionWindow(STATION.id, NOW, 3)).resolves.toEqual([
      { t: "2026-08-13T11:00:00.000Z", speed: 2.5, dir: 270 },
    ]);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("units=metric");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("begin_date=20260813");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("end_date=20260816");
    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain("product=currents_predictions");
  });
});