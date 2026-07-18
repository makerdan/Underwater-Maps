/**
 * tripWindow.test.ts — unit tests for the Trip Window finder's pure logic.
 */
import { describe, it, expect } from "vitest";
import {
  classifyHour,
  computeTripWindows,
  meetsMinDuration,
  findBestTripWindow,
  formatTripRange,
  type TripForecastHour,
} from "../tripWindow";

const BASE_MS = Date.UTC(2026, 6, 18, 6, 0, 0);

function hour(
  relHour: number,
  windSpeedKnots: number,
  waveHeightM: number,
): TripForecastHour {
  return {
    relHour,
    isoTime: new Date(BASE_MS + relHour * 3_600_000).toISOString(),
    windSpeedKnots,
    waveHeightM,
  };
}

describe("classifyHour", () => {
  it("classifies calm conditions as go", () => {
    expect(classifyHour(hour(0, 8, 0.4))).toBe("go");
  });

  it("classifies boundary values out of go (wind = 12, wave = 0.8)", () => {
    expect(classifyHour(hour(0, 12, 0.4))).toBe("marginal");
    expect(classifyHour(hour(0, 8, 0.8))).toBe("marginal");
  });

  it("classifies rough conditions as no-go (wind ≥ 22 or wave ≥ 1.5)", () => {
    expect(classifyHour(hour(0, 22, 0.4))).toBe("no-go");
    expect(classifyHour(hour(0, 5, 1.5))).toBe("no-go");
  });
});

describe("computeTripWindows", () => {
  it("returns an empty array for no hours", () => {
    expect(computeTripWindows([])).toEqual([]);
  });

  it("merges contiguous same-verdict hours into one window", () => {
    const windows = computeTripWindows([
      hour(0, 8, 0.3),
      hour(1, 9, 0.4),
      hour(2, 10, 0.5),
    ]);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      verdict: "go",
      startRelHour: 0,
      durationH: 3,
      maxWindKt: 10,
      maxWaveM: 0.5,
    });
    expect(windows[0]!.startIso).toBe(new Date(BASE_MS).toISOString());
    expect(windows[0]!.endIso).toBe(new Date(BASE_MS + 3 * 3_600_000).toISOString());
  });

  it("splits windows when the verdict changes", () => {
    const windows = computeTripWindows([
      hour(0, 8, 0.3),   // go
      hour(1, 15, 0.9),  // marginal
      hour(2, 25, 2.0),  // no-go
      hour(3, 8, 0.3),   // go
    ]);
    expect(windows.map((w) => w.verdict)).toEqual(["go", "marginal", "no-go", "go"]);
    expect(windows.map((w) => w.durationH)).toEqual([1, 1, 1, 1]);
  });

  it("breaks a stretch on a relHour gap even if the verdict matches", () => {
    const windows = computeTripWindows([
      hour(0, 8, 0.3),
      hour(1, 8, 0.3),
      hour(3, 8, 0.3), // gap: hour 2 missing
    ]);
    expect(windows).toHaveLength(2);
    expect(windows[0]!.durationH).toBe(2);
    expect(windows[1]!.durationH).toBe(1);
  });

  it("skips hours with non-finite values and breaks the stretch", () => {
    const windows = computeTripWindows([
      hour(0, 8, 0.3),
      hour(1, Number.NaN, 0.3),
      hour(2, 8, 0.3),
    ]);
    expect(windows).toHaveLength(2);
    expect(windows.every((w) => w.durationH === 1)).toBe(true);
  });
});

describe("meetsMinDuration", () => {
  const w = computeTripWindows([hour(0, 8, 0.3), hour(1, 8, 0.3)])[0]!;

  it("passes when duration ≥ minimum", () => {
    expect(meetsMinDuration(w, 2)).toBe(true);
    expect(meetsMinDuration(w, 0)).toBe(true);
  });

  it("fails when duration < minimum", () => {
    expect(meetsMinDuration(w, 4)).toBe(false);
  });
});

describe("findBestTripWindow", () => {
  it("returns null when nothing qualifies", () => {
    const windows = computeTripWindows([
      hour(0, 25, 2.0), // no-go
      hour(1, 8, 0.3),  // go, but only 1 h
    ]);
    expect(findBestTripWindow(windows, 2)).toBeNull();
  });

  it("prefers go over a longer marginal window", () => {
    const windows = computeTripWindows([
      hour(0, 15, 0.9), // marginal ×4
      hour(1, 15, 0.9),
      hour(2, 15, 0.9),
      hour(3, 15, 0.9),
      hour(4, 25, 2.0), // no-go separator
      hour(5, 8, 0.3),  // go ×2
      hour(6, 8, 0.3),
    ]);
    const best = findBestTripWindow(windows, 2);
    expect(best?.verdict).toBe("go");
    expect(best?.startRelHour).toBe(5);
  });

  it("prefers the longer window among equal verdicts, earlier on tie", () => {
    const windows = computeTripWindows([
      hour(0, 8, 0.3),  // go ×2
      hour(1, 8, 0.3),
      hour(2, 25, 2.0), // no-go separator
      hour(3, 8, 0.3),  // go ×3
      hour(4, 8, 0.3),
      hour(5, 8, 0.3),
      hour(6, 25, 2.0), // no-go separator
      hour(7, 8, 0.3),  // go ×3 (tie with previous — earlier wins)
      hour(8, 8, 0.3),
      hour(9, 8, 0.3),
    ]);
    const best = findBestTripWindow(windows, 2);
    expect(best?.startRelHour).toBe(3);
    expect(best?.durationH).toBe(3);
  });

  it("never selects a no-go window even if it is the only long one", () => {
    const windows = computeTripWindows([
      hour(0, 25, 2.0),
      hour(1, 25, 2.0),
      hour(2, 25, 2.0),
      hour(3, 25, 2.0),
    ]);
    expect(findBestTripWindow(windows, 2)).toBeNull();
  });
});

describe("formatTripRange", () => {
  it("formats the window span in UTC", () => {
    const w = computeTripWindows([hour(0, 8, 0.3), hour(1, 8, 0.3)])[0]!;
    expect(formatTripRange(w)).toBe("06:00 – 08:00 UTC");
  });
});
