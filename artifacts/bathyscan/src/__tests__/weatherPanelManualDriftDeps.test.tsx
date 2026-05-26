/**
 * Manual-path counterpart to weatherPanelDriftDeps.test.tsx. Verifies that
 * WeatherPanel's manual-override recompute reacts to every input that feeds
 * computeDrift — specifically the previously-missing dependencies
 * (manualSlackNow plus the manual wind/tide values) so manual planning
 * doesn't trail the sliders.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";

const computeDriftSpy = vi.fn();
vi.mock("@/lib/computeDrift", () => ({
  computeDrift: (...args: unknown[]) => {
    computeDriftSpy(...args);
    return [];
  },
}));

const terrain = {
  datasetId: "ds-1",
  minLat: 0, maxLat: 1, minLon: 0, maxLon: 1, resolution: 2,
  depths: new Float32Array([10, 10, 10, 10]),
};

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain }),
}));

const hours = Array.from({ length: 24 }, (_, h) => ({
  hour: h, windSpeedKnots: 5, windDegrees: 180,
  tidalSpeedKnots: 0.5, tidalDegrees: 90,
  waveHeightM: 0.3, tideRising: false,
}));

// Force the manual-override UI to be the active path by reporting an error
// from the surface-conditions hook — matches the production gate
// (isError || estimatedConditions) that shows the manual sliders.
vi.mock("@/hooks/useSurfaceConditions", () => ({
  useSurfaceConditions: () => ({
    data: { tidalDataSource: "estimated" },
    hours,
    loading: false,
    error: true,
    estimated: true,
    refetch: vi.fn(),
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetTrollingPresets: () => ({ data: [] }),
  usePostTrollingPresets: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePatchTrollingPresetsId: () => ({ mutateAsync: vi.fn() }),
  useDeleteTrollingPresetsId: () => ({ mutateAsync: vi.fn() }),
  getGetTrollingPresetsQueryKey: () => ["trolling-presets"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { WeatherPanel } from "@/components/WeatherPanel";
import { useDriftStore } from "@/lib/driftStore";

describe("WeatherPanel manual drift recompute dependencies", () => {
  beforeEach(() => {
    computeDriftSpy.mockClear();
    useDriftStore.setState({
      driftConditions: null,
      driftPath: null,
      driftHour: 0,
      driftStartLat: 0.5,
      driftStartLon: 0.5,
      lineLengthM: 200,
      lineWeightG: 500,
      estimatedConditions: true,
      driftMode: "drift",
      boatHeadingDeg: 0,
      boatSpeedKnots: 0,
      driftWaypoints: [],
      manualWindSpeedKnots: 8,
      manualWindDegrees: 180,
      manualTidalSpeedKnots: 1.0,
      manualTidalDegrees: 90,
      manualSlackNow: false,
    });
  });

  it("re-runs computeDrift when manual wind speed changes", () => {
    render(<WeatherPanel onClose={() => {}} />);
    const initialCalls = computeDriftSpy.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);

    act(() => {
      useDriftStore.getState().setManualWindSpeedKnots(22);
    });

    const after = computeDriftSpy.mock.calls.length;
    expect(after).toBeGreaterThan(initialCalls);
    const lastArgs = computeDriftSpy.mock.calls[after - 1]![0];
    expect(lastArgs.conditions[0].windSpeedKnots).toBe(22);
  });

  it("re-runs computeDrift and forces tide to 0 when 'slack now' toggles on", () => {
    render(<WeatherPanel onClose={() => {}} />);
    const initialCalls = computeDriftSpy.mock.calls.length;

    act(() => {
      useDriftStore.getState().setManualSlackNow(true);
    });

    const after = computeDriftSpy.mock.calls.length;
    expect(after).toBeGreaterThan(initialCalls);
    const lastArgs = computeDriftSpy.mock.calls[after - 1]![0];
    expect(lastArgs.conditions[0].tidalSpeedKnots).toBe(0);
    expect(lastArgs.conditions[0].isSlack).toBe(true);
  });

  it("re-runs computeDrift when manual tidal direction changes", () => {
    render(<WeatherPanel onClose={() => {}} />);
    const initialCalls = computeDriftSpy.mock.calls.length;

    act(() => {
      useDriftStore.getState().setManualTidalDegrees(270);
    });

    const after = computeDriftSpy.mock.calls.length;
    expect(after).toBeGreaterThan(initialCalls);
    const lastArgs = computeDriftSpy.mock.calls[after - 1]![0];
    expect(lastArgs.conditions[0].tidalDegrees).toBe(270);
  });
});
