/**
 * useTidalData — lat/lon ref-stabilisation unit tests.
 *
 * The hook stores lat/lon in refs so the poller interval always reads the
 * *current* coordinates even when React's closure over the effect deps still
 * holds the old values.  Without refs the interval would silently re-fetch
 * stale coordinates every time it ticks.
 *
 * These tests:
 *   1. Verify the initial fetch uses the coordinates passed at mount.
 *   2. Advance the interval after changing lat/lon and assert the new tick
 *      uses the updated coordinates, not the originals.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTidalData } from "@/hooks/useTidalData";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: true }),
}));

vi.mock("@/lib/offlinePackStore", () => ({
  getPackForLocation: vi.fn().mockResolvedValue(null),
  getOfflineTideValue: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POLL_MS = 10 * 60 * 1000; // must match POLL_INTERVAL_MS in the hook

/** Flush pending promises/microtasks without advancing the fake clock. */
async function flushPromises() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function makeFetchResponse(lat: number, lon: number) {
  return {
    ok: true,
    json: async () => ({
      available: true,
      tideHeight: lat + lon,
      currentDirection: 0,
      currentSpeed: 0,
      stationName: `mock@${lat},${lon}`,
      isPredicted: false,
    }),
  } as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTidalData — lat/lon ref stabilisation", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("initial fetch uses the coordinates provided at mount", async () => {
    fetchSpy.mockResolvedValue(makeFetchResponse(47.5, -122.3));

    const { result } = renderHook(() => useTidalData(47.5, -122.3));

    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("lat=47.5");
    expect(url).toContain("lon=-122.3");
    expect(result.current.loading).toBe(false);
  });

  it("interval tick after lat/lon change fetches the new coordinates, not the originals", async () => {
    fetchSpy.mockResolvedValue(makeFetchResponse(47.5, -122.3));

    const { rerender } = renderHook(
      ({ lat, lon }: { lat: number; lon: number }) => useTidalData(lat, lon),
      { initialProps: { lat: 47.5, lon: -122.3 } },
    );

    // Flush the initial fetch
    await flushPromises();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Change the coordinates — the hook effect restarts the interval with the
    // new deps.  The key behaviour under test is that the *ref* is updated so
    // the poller callback reads the new values when the interval fires.
    fetchSpy.mockResolvedValue(makeFetchResponse(34.0, -118.5));
    rerender({ lat: 34.0, lon: -118.5 });

    // Flush the immediate fetch triggered by the dep change
    await flushPromises();

    const callsAfterCoordChange = fetchSpy.mock.calls.length;

    // Advance past one full poll interval so the setInterval callback fires
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    });

    // At least one more call should have happened after the interval fired
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterCoordChange);

    // Every call after the coordinate change must use the new coordinates
    const laterCalls = fetchSpy.mock.calls.slice(callsAfterCoordChange);
    for (const [url] of laterCalls) {
      expect(url).toContain("lat=34");
      expect(url).toContain("lon=-118");
      expect(url).not.toContain("lat=47.5");
      expect(url).not.toContain("lon=-122.3");
    }
  });

  it("does not fetch when lat or lon is null", async () => {
    renderHook(() => useTidalData(null, null));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
