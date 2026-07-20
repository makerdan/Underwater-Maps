import { describe, it, expect } from "vitest";
import { formatFreshness } from "../freshnessUtils";

describe("formatFreshness", () => {
  it("returns null for null input", () => {
    expect(formatFreshness(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(formatFreshness(undefined)).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    expect(formatFreshness("not-a-date")).toBeNull();
  });

  it("formats a bare date (midnight UTC) without time component", () => {
    const d = new Date("2026-07-18T00:00:00.000Z");
    expect(formatFreshness(d)).toBe("Jul 18, 2026");
  });

  it("formats a Date with a time component", () => {
    const d = new Date("2026-07-18T14:32:00.000Z");
    expect(formatFreshness(d)).toBe("Jul 18 · 14:32 UTC");
  });

  it("accepts an ISO string", () => {
    expect(formatFreshness("2026-07-18T00:00:00.000Z")).toBe("Jul 18, 2026");
  });

  it("accepts an ISO string with time", () => {
    expect(formatFreshness("2026-07-18T09:05:00.000Z")).toBe("Jul 18 · 09:05 UTC");
  });

  it("accepts a numeric timestamp (ms since epoch)", () => {
    const ts = new Date("2026-07-18T14:32:00.000Z").getTime();
    expect(formatFreshness(ts)).toBe("Jul 18 · 14:32 UTC");
  });

  it("handles a far-future date without throwing", () => {
    expect(() => formatFreshness("2999-12-31T23:59:59.000Z")).not.toThrow();
    expect(formatFreshness("2999-12-31T23:59:59.000Z")).toBe("Dec 31 · 23:59 UTC");
  });

  it("handles the first day of the year", () => {
    expect(formatFreshness("2026-01-01T00:00:00.000Z")).toBe("Jan 1, 2026");
  });

  it("pads single-digit hours and minutes with zeroes", () => {
    expect(formatFreshness("2026-03-05T08:07:00.000Z")).toBe("Mar 5 · 08:07 UTC");
  });
});

// ---------------------------------------------------------------------------
// Focused: weather fetchedAt must come from backend fetch time, not activeHour
// ---------------------------------------------------------------------------
// useSurfaceConditions derives fetchedAt as:
//   dataUpdatedAt > 0 ? new Date(dataUpdatedAt).toISOString() : null
// where dataUpdatedAt is React Query's fetch-completion timestamp.
// It must NOT be the synthetic top-of-hour string built from activeHour.
// ---------------------------------------------------------------------------
describe("weather fetchedAt derivation (dataUpdatedAt, not activeHour)", () => {
  function deriveFetchedAt(dataUpdatedAt: number): string | null {
    return dataUpdatedAt > 0 ? new Date(dataUpdatedAt).toISOString() : null;
  }

  it("returns null before the first successful fetch (dataUpdatedAt = 0)", () => {
    expect(deriveFetchedAt(0)).toBeNull();
    expect(formatFreshness(deriveFetchedAt(0))).toBeNull();
  });

  it("reflects the backend fetch time, not the active display hour", () => {
    // Backend returned conditions data at 14:32 UTC
    const dataUpdatedAt = new Date("2026-07-18T14:32:00.000Z").getTime();
    const fetchedAt = deriveFetchedAt(dataUpdatedAt);

    // User has scrubbed the timeline to 20:00 UTC — this is the synthetic activeHour timestamp
    const syntheticActiveHourTs = "2026-07-18T20:00:00.000Z";

    expect(formatFreshness(fetchedAt)).toBe("Jul 18 · 14:32 UTC");
    expect(formatFreshness(syntheticActiveHourTs)).toBe("Jul 18 · 20:00 UTC");
    // The two values are different — weather label shows fetch time, not display hour
    expect(formatFreshness(fetchedAt)).not.toBe(formatFreshness(syntheticActiveHourTs));
  });

  it("formats the fetch timestamp as a time string, not date-only", () => {
    const dataUpdatedAt = new Date("2026-07-20T09:05:00.000Z").getTime();
    const fetchedAt = deriveFetchedAt(dataUpdatedAt);
    // Must include the time component (09:05 UTC), not just the date
    expect(formatFreshness(fetchedAt)).toBe("Jul 20 · 09:05 UTC");
  });
});
