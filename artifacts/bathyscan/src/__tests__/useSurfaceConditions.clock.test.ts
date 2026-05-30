/**
 * useSurfaceConditions — activeHour clock-tick unit tests.
 *
 * Verifies that the 1-minute setInterval updates `nowHour` (and therefore
 * `activeHour`) when the UTC hour rolls over, so the displayed time never
 * drifts behind real time while the app sits idle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSurfaceConditions } from "@/hooks/useSurfaceConditions";

vi.mock("@workspace/api-client-react", () => ({
  useGetSurfaceConditions: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  getGetSurfaceConditionsQueryKey: (...args: unknown[]) => ["surface-conditions", ...args],
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: null }),
}));

const DRIFT_STORE_STATE = {
  manualWindSpeedKnots: 0,
  manualWindDegrees: 0,
  manualTidalSpeedKnots: 0,
  manualTidalDegrees: 0,
  driftPlannerActive: false,
  driftHour: 0,
};

vi.mock("@/lib/driftStore", () => ({
  // useSurfaceConditions uses per-field selectors (e.g. useDriftStore((s) => s.driftPlannerActive)).
  // The mock must apply the selector so each call returns the primitive, not the whole state object.
  // Returning the whole object makes truthy checks like `driftPlannerActive ? ... : nowHour` branch
  // incorrectly and produces NaN for activeHour.
  useDriftStore: (sel: (s: typeof DRIFT_STORE_STATE) => unknown) =>
    sel(DRIFT_STORE_STATE),
}));

describe("useSurfaceConditions — activeHour clock tick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initialises activeHour to the current UTC hour", () => {
    vi.setSystemTime(new Date("2026-05-27T14:30:00.000Z"));
    const { result } = renderHook(() => useSurfaceConditions());
    expect(result.current.activeHour).toBe(14);
  });

  it("advances activeHour when the 1-minute interval fires and the UTC hour changes", () => {
    vi.setSystemTime(new Date("2026-05-27T14:59:00.000Z"));
    const { result } = renderHook(() => useSurfaceConditions());
    expect(result.current.activeHour).toBe(14);

    act(() => {
      vi.setSystemTime(new Date("2026-05-27T15:00:00.000Z"));
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.activeHour).toBe(15);
  });

  it("wraps activeHour correctly at midnight (23 → 0)", () => {
    vi.setSystemTime(new Date("2026-05-27T23:59:00.000Z"));
    const { result } = renderHook(() => useSurfaceConditions());
    expect(result.current.activeHour).toBe(23);

    act(() => {
      vi.setSystemTime(new Date("2026-05-28T00:00:00.000Z"));
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.activeHour).toBe(0);
  });

  it("does not advance activeHour if the interval fires but the UTC hour has not changed", () => {
    vi.setSystemTime(new Date("2026-05-27T10:00:00.000Z"));
    const { result } = renderHook(() => useSurfaceConditions());
    expect(result.current.activeHour).toBe(10);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.activeHour).toBe(10);
  });

  it("honours hourOverride and ignores the clock tick when override is set", () => {
    vi.setSystemTime(new Date("2026-05-27T08:00:00.000Z"));
    const { result } = renderHook(() => useSurfaceConditions(true, 3));
    expect(result.current.activeHour).toBe(3);

    act(() => {
      vi.setSystemTime(new Date("2026-05-27T09:00:00.000Z"));
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.activeHour).toBe(3);
  });
});
