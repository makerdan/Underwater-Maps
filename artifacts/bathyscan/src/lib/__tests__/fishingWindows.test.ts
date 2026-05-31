import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  computeFishingWindows,
  formatWindowTime,
  formatWindowRange,
} from "../fishingWindows";
import type { TidalSchedule, TidalScheduleEvent } from "@/hooks/useTidalSchedule";
import type { TidalPreference } from "@/lib/habitat";

// Pin clock to 2025-06-15T12:00:00Z so "today" is always 2025-06-15 UTC.
const FIXED_NOW = new Date("2025-06-15T12:00:00Z");

beforeAll(() => vi.useFakeTimers({ now: FIXED_NOW }));
afterAll(() => vi.useRealTimers());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  type: "high" | "low",
  time: string,
  windowStart: string,
  windowEnd: string,
): TidalScheduleEvent {
  return { type, time, height: 1.0, nextDirectionDeg: 0, windowStart, windowEnd };
}

function makeSchedule(
  events: TidalScheduleEvent[],
  available = true,
): TidalSchedule {
  return {
    available,
    events,
    rangeStart: "2025-06-15T00:00:00Z",
    rangeEnd: "2025-06-16T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Early-return / null guards
// ---------------------------------------------------------------------------

describe("computeFishingWindows — early returns", () => {
  it('returns [] when schedule is null', () => {
    expect(computeFishingWindows(null, "slack")).toEqual([]);
  });

  it('returns [] when schedule.available is false', () => {
    const schedule = makeSchedule(
      [makeEvent("high", "2025-06-15T06:00:00Z", "2025-06-15T05:15:00Z", "2025-06-15T06:45:00Z")],
      false,
    );
    expect(computeFishingWindows(schedule, "slack")).toEqual([]);
  });

  it('returns [] when preference is "any"', () => {
    const schedule = makeSchedule([
      makeEvent("high", "2025-06-15T06:00:00Z", "2025-06-15T05:15:00Z", "2025-06-15T06:45:00Z"),
    ]);
    expect(computeFishingWindows(schedule, "any")).toEqual([]);
  });

  it('returns [] when events array is empty', () => {
    expect(computeFishingWindows(makeSchedule([]), "slack")).toEqual([]);
  });

  it('returns [] when no events fall within today UTC', () => {
    // All events are yesterday
    const yesterday = [
      makeEvent("high", "2025-06-14T06:00:00Z", "2025-06-14T05:15:00Z", "2025-06-14T06:45:00Z"),
      makeEvent("low",  "2025-06-14T12:00:00Z", "2025-06-14T11:15:00Z", "2025-06-14T12:45:00Z"),
    ];
    expect(computeFishingWindows(makeSchedule(yesterday), "slack")).toEqual([]);
    expect(computeFishingWindows(makeSchedule(yesterday), "ebb")).toEqual([]);
    expect(computeFishingWindows(makeSchedule(yesterday), "flood")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Slack preference
// ---------------------------------------------------------------------------

describe('computeFishingWindows — "slack" preference', () => {
  it('gives high-slack events 3 stars and the correct phaseLabel', () => {
    const events = [
      makeEvent("high", "2025-06-15T06:00:00Z", "2025-06-15T05:15:00Z", "2025-06-15T06:45:00Z"),
    ];
    const [win] = computeFishingWindows(makeSchedule(events), "slack");
    expect(win.stars).toBe(3);
    expect(win.phaseLabel).toBe("High-water slack");
  });

  it('gives low-slack events 2 stars and the correct phaseLabel', () => {
    const events = [
      makeEvent("low", "2025-06-15T12:30:00Z", "2025-06-15T11:45:00Z", "2025-06-15T13:15:00Z"),
    ];
    const [win] = computeFishingWindows(makeSchedule(events), "slack");
    expect(win.stars).toBe(2);
    expect(win.phaseLabel).toBe("Low-water slack");
  });

  it('preserves the event windowStart and windowEnd as start/end', () => {
    const ws = "2025-06-15T05:15:00Z";
    const we = "2025-06-15T06:45:00Z";
    const events = [makeEvent("high", "2025-06-15T06:00:00Z", ws, we)];
    const [win] = computeFishingWindows(makeSchedule(events), "slack");
    expect(win.start).toBe(ws);
    expect(win.end).toBe(we);
  });

  it('sets scrubTarget to the exact event time', () => {
    const time = "2025-06-15T06:00:00Z";
    const events = [makeEvent("high", time, "2025-06-15T05:15:00Z", "2025-06-15T06:45:00Z")];
    const [win] = computeFishingWindows(makeSchedule(events), "slack");
    expect(win.scrubTarget.toISOString()).toBe(new Date(time).toISOString());
  });

  it('filters out events whose window ends before today UTC midnight', () => {
    const events = [
      // windowEnd is yesterday
      makeEvent("high", "2025-06-14T23:30:00Z", "2025-06-14T22:45:00Z", "2025-06-14T23:59:00Z"),
    ];
    expect(computeFishingWindows(makeSchedule(events), "slack")).toEqual([]);
  });

  it('filters out events whose windowStart is at or after tomorrow UTC midnight', () => {
    const events = [
      makeEvent("high", "2025-06-16T06:00:00Z", "2025-06-16T00:00:00Z", "2025-06-16T06:45:00Z"),
    ];
    expect(computeFishingWindows(makeSchedule(events), "slack")).toEqual([]);
  });

  it('includes an event whose window straddles today UTC midnight (spans midnight)', () => {
    // windowStart is late yesterday, windowEnd is early today
    const events = [
      makeEvent("high", "2025-06-15T00:10:00Z", "2025-06-14T23:30:00Z", "2025-06-15T00:50:00Z"),
    ];
    const result = computeFishingWindows(makeSchedule(events), "slack");
    expect(result).toHaveLength(1);
  });

  it('returns at most 3 windows even when more events qualify', () => {
    const events = [
      makeEvent("high", "2025-06-15T02:00:00Z", "2025-06-15T01:15:00Z", "2025-06-15T02:45:00Z"),
      makeEvent("low",  "2025-06-15T08:00:00Z", "2025-06-15T07:15:00Z", "2025-06-15T08:45:00Z"),
      makeEvent("high", "2025-06-15T14:00:00Z", "2025-06-15T13:15:00Z", "2025-06-15T14:45:00Z"),
      makeEvent("low",  "2025-06-15T20:00:00Z", "2025-06-15T19:15:00Z", "2025-06-15T20:45:00Z"),
    ];
    expect(computeFishingWindows(makeSchedule(events), "slack")).toHaveLength(3);
  });

  it('sorts unsorted events by time before processing', () => {
    const events = [
      makeEvent("low",  "2025-06-15T14:00:00Z", "2025-06-15T13:15:00Z", "2025-06-15T14:45:00Z"),
      makeEvent("high", "2025-06-15T06:00:00Z", "2025-06-15T05:15:00Z", "2025-06-15T06:45:00Z"),
    ];
    const result = computeFishingWindows(makeSchedule(events), "slack");
    expect(result[0].phaseLabel).toBe("High-water slack");
    expect(result[1].phaseLabel).toBe("Low-water slack");
  });
});

// ---------------------------------------------------------------------------
// Ebb preference
// ---------------------------------------------------------------------------

describe('computeFishingWindows — "ebb" preference', () => {
  // High at 06:00, low at 12:00 → mid-ebb at 09:00 → window 08:15–09:45
  const HIGH_TIME = "2025-06-15T06:00:00Z";
  const LOW_TIME  = "2025-06-15T12:00:00Z";

  const ebbs = [
    makeEvent("high", HIGH_TIME, "2025-06-15T05:15:00Z", "2025-06-15T06:45:00Z"),
    makeEvent("low",  LOW_TIME,  "2025-06-15T11:15:00Z", "2025-06-15T12:45:00Z"),
  ];

  it('computes midpoint of high→low pair as the window centre', () => {
    const [win] = computeFishingWindows(makeSchedule(ebbs), "ebb");
    const midMs = (new Date(HIGH_TIME).getTime() + new Date(LOW_TIME).getTime()) / 2;
    expect(new Date(win.start).getTime()).toBe(midMs - 45 * 60 * 1000);
    expect(new Date(win.end).getTime()).toBe(midMs + 45 * 60 * 1000);
  });

  it('produces a 90-minute window (±45 min around midpoint)', () => {
    const [win] = computeFishingWindows(makeSchedule(ebbs), "ebb");
    const durationMs = new Date(win.end).getTime() - new Date(win.start).getTime();
    expect(durationMs).toBe(90 * 60 * 1000);
  });

  it('gives ebb windows 3 stars', () => {
    const [win] = computeFishingWindows(makeSchedule(ebbs), "ebb");
    expect(win.stars).toBe(3);
  });

  it('labels the window with phase and UTC time', () => {
    const [win] = computeFishingWindows(makeSchedule(ebbs), "ebb");
    expect(win.phaseLabel).toMatch(/^Ebb mid-tide/);
    expect(win.phaseLabel).toContain("09:00 UTC");
  });

  it('sets scrubTarget to the midpoint', () => {
    const [win] = computeFishingWindows(makeSchedule(ebbs), "ebb");
    const midMs = (new Date(HIGH_TIME).getTime() + new Date(LOW_TIME).getTime()) / 2;
    expect(win.scrubTarget.getTime()).toBe(midMs);
  });

  it('ignores low→high pairs (wrong direction for ebb)', () => {
    const flood = [
      makeEvent("low",  "2025-06-15T06:00:00Z", "2025-06-15T05:15:00Z", "2025-06-15T06:45:00Z"),
      makeEvent("high", "2025-06-15T12:00:00Z", "2025-06-15T11:15:00Z", "2025-06-15T12:45:00Z"),
    ];
    expect(computeFishingWindows(makeSchedule(flood), "ebb")).toEqual([]);
  });

  it('skips ebb windows whose 90-min span falls entirely outside today', () => {
    // High yesterday, low early yesterday → midpoint is yesterday
    const events = [
      makeEvent("high", "2025-06-14T06:00:00Z", "2025-06-14T05:15:00Z", "2025-06-14T06:45:00Z"),
      makeEvent("low",  "2025-06-14T12:00:00Z", "2025-06-14T11:15:00Z", "2025-06-14T12:45:00Z"),
    ];
    expect(computeFishingWindows(makeSchedule(events), "ebb")).toEqual([]);
  });

  it('returns at most 3 ebb windows', () => {
    const events = [
      makeEvent("high", "2025-06-15T01:00:00Z", "2025-06-15T00:15:00Z", "2025-06-15T01:45:00Z"),
      makeEvent("low",  "2025-06-15T04:00:00Z", "2025-06-15T03:15:00Z", "2025-06-15T04:45:00Z"),
      makeEvent("high", "2025-06-15T07:00:00Z", "2025-06-15T06:15:00Z", "2025-06-15T07:45:00Z"),
      makeEvent("low",  "2025-06-15T10:00:00Z", "2025-06-15T09:15:00Z", "2025-06-15T10:45:00Z"),
      makeEvent("high", "2025-06-15T13:00:00Z", "2025-06-15T12:15:00Z", "2025-06-15T13:45:00Z"),
      makeEvent("low",  "2025-06-15T16:00:00Z", "2025-06-15T15:15:00Z", "2025-06-15T16:45:00Z"),
      makeEvent("high", "2025-06-15T19:00:00Z", "2025-06-15T18:15:00Z", "2025-06-15T19:45:00Z"),
      makeEvent("low",  "2025-06-15T22:00:00Z", "2025-06-15T21:15:00Z", "2025-06-15T22:45:00Z"),
    ];
    expect(computeFishingWindows(makeSchedule(events), "ebb")).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Flood preference
// ---------------------------------------------------------------------------

describe('computeFishingWindows — "flood" preference', () => {
  // Low at 06:00, high at 12:00 → mid-flood at 09:00 → window 08:15–09:45
  const LOW_TIME  = "2025-06-15T06:00:00Z";
  const HIGH_TIME = "2025-06-15T12:00:00Z";

  const floods = [
    makeEvent("low",  LOW_TIME,  "2025-06-15T05:15:00Z", "2025-06-15T06:45:00Z"),
    makeEvent("high", HIGH_TIME, "2025-06-15T11:15:00Z", "2025-06-15T12:45:00Z"),
  ];

  it('computes midpoint of low→high pair as the window centre', () => {
    const [win] = computeFishingWindows(makeSchedule(floods), "flood");
    const midMs = (new Date(LOW_TIME).getTime() + new Date(HIGH_TIME).getTime()) / 2;
    expect(new Date(win.start).getTime()).toBe(midMs - 45 * 60 * 1000);
    expect(new Date(win.end).getTime()).toBe(midMs + 45 * 60 * 1000);
  });

  it('gives flood windows 3 stars', () => {
    const [win] = computeFishingWindows(makeSchedule(floods), "flood");
    expect(win.stars).toBe(3);
  });

  it('labels the window with flood phase and UTC time', () => {
    const [win] = computeFishingWindows(makeSchedule(floods), "flood");
    expect(win.phaseLabel).toMatch(/^Flood mid-tide/);
    expect(win.phaseLabel).toContain("09:00 UTC");
  });

  it('ignores high→low pairs (wrong direction for flood)', () => {
    const ebb = [
      makeEvent("high", "2025-06-15T06:00:00Z", "2025-06-15T05:15:00Z", "2025-06-15T06:45:00Z"),
      makeEvent("low",  "2025-06-15T12:00:00Z", "2025-06-15T11:15:00Z", "2025-06-15T12:45:00Z"),
    ];
    expect(computeFishingWindows(makeSchedule(ebb), "flood")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("computeFishingWindows — edge cases", () => {
  it('handles a schedule whose events span midnight UTC (window straddles day boundary)', () => {
    // High at 23:00 today, low at 01:00 tomorrow → mid-ebb at 00:00 tomorrow
    // The window is 23:15 today – 00:45 tomorrow — midpoint falls outside today, so excluded
    const crossMidnight = [
      makeEvent("high", "2025-06-15T23:00:00Z", "2025-06-15T22:15:00Z", "2025-06-15T23:45:00Z"),
      makeEvent("low",  "2025-06-16T01:00:00Z", "2025-06-16T00:15:00Z", "2025-06-16T01:45:00Z"),
    ];
    // mid-ebb midMs = (23:00 + 25:00)/2 = 24:00 = 2025-06-16T00:00:00Z
    // midMs - 45min = 23:15 today; midMs + 45min = 00:45 tomorrow
    // midMs (00:00) is exactly tomorrowUtcMs → condition `midMs - HALF >= dayEnd` is false since
    // midMs - HALF = 23:15 which is < dayEnd. So it should be included.
    const result = computeFishingWindows(makeSchedule(crossMidnight), "ebb");
    expect(result).toHaveLength(1);
    expect(result[0].stars).toBe(3);
  });

  it('handles a schedule whose slack window straddles today UTC midnight (starts yesterday)', () => {
    // windowStart is yesterday 23:30, windowEnd is today 00:30
    const events = [
      makeEvent("high", "2025-06-15T00:00:00Z", "2025-06-14T23:15:00Z", "2025-06-15T00:45:00Z"),
    ];
    // weMs = today 00:45 > todayUtcMs, wsMs = yesterday 23:15 < tomorrowUtcMs → included
    const result = computeFishingWindows(makeSchedule(events), "slack");
    expect(result).toHaveLength(1);
  });

  it('handles all four tidalPreference values without throwing', () => {
    const prefs: TidalPreference[] = ["slack", "ebb", "flood", "any"];
    const schedule = makeSchedule([
      makeEvent("high", "2025-06-15T06:00:00Z", "2025-06-15T05:15:00Z", "2025-06-15T06:45:00Z"),
      makeEvent("low",  "2025-06-15T12:00:00Z", "2025-06-15T11:15:00Z", "2025-06-15T12:45:00Z"),
    ]);
    for (const pref of prefs) {
      expect(() => computeFishingWindows(schedule, pref)).not.toThrow();
    }
  });

  it('"any" always returns [] regardless of schedule contents', () => {
    const richSchedule = makeSchedule([
      makeEvent("high", "2025-06-15T06:00:00Z", "2025-06-15T05:15:00Z", "2025-06-15T06:45:00Z"),
      makeEvent("low",  "2025-06-15T12:00:00Z", "2025-06-15T11:15:00Z", "2025-06-15T12:45:00Z"),
      makeEvent("high", "2025-06-15T18:00:00Z", "2025-06-15T17:15:00Z", "2025-06-15T18:45:00Z"),
    ]);
    expect(computeFishingWindows(richSchedule, "any")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatWindowTime / formatWindowRange
// ---------------------------------------------------------------------------

describe("formatWindowTime", () => {
  it('formats a valid ISO string as HH:MM in UTC', () => {
    expect(formatWindowTime("2025-06-15T09:30:00Z")).toBe("09:30");
  });

  it('zero-pads hours and minutes', () => {
    expect(formatWindowTime("2025-06-15T03:05:00Z")).toBe("03:05");
  });

  it('returns "--:--" for an invalid ISO string', () => {
    expect(formatWindowTime("not-a-date")).toBe("--:--");
  });
});

describe("formatWindowRange", () => {
  it('returns "HH:MM – HH:MM UTC" format', () => {
    expect(formatWindowRange("2025-06-15T08:15:00Z", "2025-06-15T09:45:00Z")).toBe(
      "08:15 – 09:45 UTC",
    );
  });
});
