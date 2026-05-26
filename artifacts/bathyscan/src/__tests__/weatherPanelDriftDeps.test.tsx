/**
 * Tests that WeatherPanel's drift-recompute reacts to every input that
 * feeds computeDrift — specifically the previously-missing dependencies:
 * driftStartLat, driftStartLon, and lineLengthM. Before the fix these were
 * referenced inside the effect but omitted from its dependency list, so
 * the timeline and "bottom in reach" readout could trail the inputs.
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

vi.mock("@/hooks/useSurfaceConditions", () => ({
  useSurfaceConditions: () => ({
    data: { tidalDataSource: "estimated" },
    hours,
    loading: false,
    error: false,
    estimated: false,
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

describe("WeatherPanel drift recompute dependencies", () => {
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
      estimatedConditions: false,
      driftMode: "drift",
      boatHeadingDeg: 0,
      boatSpeedKnots: 0,
      driftWaypoints: [],
    });
  });

  it("re-runs computeDrift when driftStartLat / driftStartLon change", () => {
    render(<WeatherPanel onClose={() => {}} />);
    const initialCalls = computeDriftSpy.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);

    act(() => {
      useDriftStore.getState().setDriftStart(0.7, 0.8);
    });

    const after = computeDriftSpy.mock.calls.length;
    expect(after).toBeGreaterThan(initialCalls);
    const lastArgs = computeDriftSpy.mock.calls[after - 1]![0];
    expect(lastArgs.startLat).toBeCloseTo(0.7);
    expect(lastArgs.startLon).toBeCloseTo(0.8);
  });

  it("re-runs computeDrift when lineLengthM changes", () => {
    render(<WeatherPanel onClose={() => {}} />);
    const initialCalls = computeDriftSpy.mock.calls.length;

    act(() => {
      useDriftStore.getState().setLineLengthM(450);
    });

    const after = computeDriftSpy.mock.calls.length;
    expect(after).toBeGreaterThan(initialCalls);
    const lastArgs = computeDriftSpy.mock.calls[after - 1]![0];
    expect(lastArgs.lineLengthM).toBe(450);
  });
});
