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

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    getGetSurfaceConditionsQueryKey: (...args: unknown[]) => ["surface-conditions", ...args],
  }),
);

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
