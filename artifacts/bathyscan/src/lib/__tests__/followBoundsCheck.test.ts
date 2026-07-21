/**
 * Unit tests for lib/followBoundsCheck.ts — the shared GPS-follow
 * bounds/health check used by both the per-frame R3F hook and the headless
 * stub-canvas watcher.
 *
 * Covers:
 * - No-op (returns false, resets toastFired) when follow is off.
 * - Disables follow when GPS is lost or no grid is loaded.
 * - Stays in follow while the position is inside the active grid.
 * - Walking out of bounds disables follow and fires the dataset-handoff
 *   search (which ends in the "Follow mode paused" toast when nothing is
 *   nearby) exactly ONCE per follow session.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../datasetHandoff", () => ({
  handleFollowOutOfBounds: vi.fn().mockResolvedValue(undefined),
}));

import { runFollowBoundsCheck, type FollowCheckState } from "../followBoundsCheck";
import { handleFollowOutOfBounds } from "../datasetHandoff";
import { useGpsStore } from "../gpsStore";
import { useCameraStore } from "../cameraStore";
import { useTerrainStore } from "../terrainStore";

const GRID = {
  minLon: -97.15,
  maxLon: -96.92,
  minLat: 33.3,
  maxLat: 33.52,
} as never;

const INSIDE = { longitude: -97.03, latitude: 33.41, accuracy: 8, timestamp: 0 };
const OUTSIDE = { longitude: -126.71, latitude: -47.25, accuracy: 8, timestamp: 0 };

function freshState(): FollowCheckState {
  return { toastFired: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  useGpsStore.setState({ active: true, position: INSIDE, error: null, watchId: 1 });
  useCameraStore.setState({ gpsFollowState: "following" });
  useTerrainStore.setState({ activeGrid: GRID, visibleDatasets: [] } as never);
});

describe("runFollowBoundsCheck", () => {
  it("returns false and resets toastFired when follow is off", () => {
    useCameraStore.setState({ gpsFollowState: "off" });
    const state = { toastFired: true };
    expect(runFollowBoundsCheck(state)).toBe(false);
    expect(state.toastFired).toBe(false);
    expect(handleFollowOutOfBounds).not.toHaveBeenCalled();
  });

  it("disables follow when GPS is not active", () => {
    useGpsStore.setState({ active: false });
    expect(runFollowBoundsCheck(freshState())).toBe(false);
    expect(useCameraStore.getState().gpsFollowState).toBe("off");
    expect(handleFollowOutOfBounds).not.toHaveBeenCalled();
  });

  it("disables follow when no terrain grid is loaded", () => {
    useTerrainStore.setState({ activeGrid: null } as never);
    expect(runFollowBoundsCheck(freshState())).toBe(false);
    expect(useCameraStore.getState().gpsFollowState).toBe("off");
    expect(handleFollowOutOfBounds).not.toHaveBeenCalled();
  });

  it("stays in follow while the position is inside the grid", () => {
    const state = freshState();
    expect(runFollowBoundsCheck(state)).toBe(true);
    expect(useCameraStore.getState().gpsFollowState).toBe("following");
    expect(state.toastFired).toBe(false);
    expect(handleFollowOutOfBounds).not.toHaveBeenCalled();
  });

  it("walking out of bounds disables follow and fires the handoff search once", () => {
    const state = freshState();
    useGpsStore.setState({ position: OUTSIDE });

    expect(runFollowBoundsCheck(state)).toBe(false);
    expect(useCameraStore.getState().gpsFollowState).toBe("off");
    expect(state.toastFired).toBe(true);
    expect(handleFollowOutOfBounds).toHaveBeenCalledTimes(1);
    expect(handleFollowOutOfBounds).toHaveBeenCalledWith(
      OUTSIDE.longitude,
      OUTSIDE.latitude,
    );

    // Re-engage follow while still out of bounds: follow drops again but
    // the toast/search does NOT re-fire in the same state session.
    useCameraStore.setState({ gpsFollowState: "following" });
    expect(runFollowBoundsCheck(state)).toBe(false);
    expect(handleFollowOutOfBounds).toHaveBeenCalledTimes(1);
  });

  it("coming back in bounds re-arms the out-of-bounds toast", () => {
    const state = freshState();
    useGpsStore.setState({ position: OUTSIDE });
    runFollowBoundsCheck(state);
    expect(handleFollowOutOfBounds).toHaveBeenCalledTimes(1);

    // Back inside — follow re-engaged, toastFired resets.
    useGpsStore.setState({ position: INSIDE });
    useCameraStore.setState({ gpsFollowState: "following" });
    expect(runFollowBoundsCheck(state)).toBe(true);
    expect(state.toastFired).toBe(false);

    // Out again — the toast fires a second time for the new excursion.
    useGpsStore.setState({ position: OUTSIDE });
    runFollowBoundsCheck(state);
    expect(handleFollowOutOfBounds).toHaveBeenCalledTimes(2);
  });

  it("multi-dataset: stays in follow when inside ANY visible dataset grid", () => {
    const otherGrid = {
      minLon: -130, maxLon: -120, minLat: -50, maxLat: -40,
    } as never;
    useTerrainStore.setState({
      activeGrid: GRID,
      visibleDatasets: [
        { activeGrid: GRID },
        { activeGrid: otherGrid },
      ],
    } as never);
    useGpsStore.setState({ position: OUTSIDE }); // inside otherGrid
    expect(runFollowBoundsCheck(freshState())).toBe(true);
    expect(useCameraStore.getState().gpsFollowState).toBe("following");
  });
});
