/**
 * Unit tests for useDatasetProximityStreaming.
 *
 * The hook fires a 500 ms setInterval that reads camera position from
 * useCameraStore and the selected/visible dataset state from useTerrainStore.
 * Tests use fake timers and advance by SAMPLE_INTERVAL_MS to trigger ticks.
 *
 * Covered:
 *   - No action when cameraLon/cameraLat are null
 *   - onActivate fires when camera is within LOAD_THRESHOLD_M of a bbox
 *   - onActivate does NOT fire when camera is beyond LOAD_THRESHOLD_M
 *   - onActivate fires for a dataset with no bbox (user upload) when a slot is free
 *   - onActivate does NOT fire for a no-bbox dataset when slots are full
 *   - autoEvict fires when an active dataset is beyond UNLOAD_THRESHOLD_M
 *   - autoEvict does NOT fire when an active dataset is within UNLOAD_THRESHOLD_M
 *   - Two nearby datasets both activate in the same tick (simultaneous activation)
 *   - When at cap, the farthest active dataset is evicted to make room for a closer one
 *   - Evict-then-re-activate cycle: after eviction the dataset re-activates when
 *     the camera returns within threshold
 *   - Already-active datasets are not re-activated by onActivate
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useDatasetProximityStreaming,
  type DatasetBbox,
} from "@/hooks/useDatasetProximityStreaming";
import { useCameraStore } from "@/lib/cameraStore";
import { useTerrainStore, MAX_ACTIVE_DATASETS } from "@/lib/terrainStore";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TICK_MS = 500; // SAMPLE_INTERVAL_MS from the hook

/**
 * A bbox centred roughly near the origin (0°,0°).
 * Any camera position INSIDE the bbox has dist = 0 < LOAD_THRESHOLD_M.
 */
const BBOX_ORIGIN: DatasetBbox = {
  minLon: -0.01,
  maxLon: 0.01,
  minLat: -0.01,
  maxLat: 0.01,
};

/**
 * A bbox ~1 000 km from the origin — far enough to always exceed
 * UNLOAD_THRESHOLD_M (3 000 m) when the camera is at the origin.
 */
const BBOX_FAR: DatasetBbox = {
  minLon: 10.0,
  maxLon: 10.1,
  minLat: 10.0,
  maxLat: 10.1,
};

/**
 * A camera position strictly inside BBOX_ORIGIN — distance is 0, well within
 * LOAD_THRESHOLD_M (500 m).
 */
const CAM_INSIDE_ORIGIN = { lon: 0.0, lat: 0.0 };

/**
 * A camera position inside BBOX_FAR — distance 0 from that bbox.
 */
const CAM_INSIDE_FAR = { lon: 10.05, lat: 10.05 };

/**
 * A camera position far from every bbox defined in these tests.
 * Used to test "beyond threshold" conditions. 5° longitude ~= 555 km.
 */
const CAM_FAR_FROM_ALL = { lon: 5.0, lat: 5.0 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setCameraAt(lon: number, lat: number) {
  useCameraStore.setState({ cameraPosition: { known: true, lon, lat } });
}

function resetStores() {
  useCameraStore.setState({ cameraPosition: { known: false }, cameraDepth: 0, heading: 0 });
  useTerrainStore.setState({
    visibleDatasets: [],
    primaryDatasetIds: [],
    primaryDatasetId: null,
    activeGrid: null,
    overviewGrid: null,
    evictedId: null,
    autoEvictedId: null,
    selectedIds: [],
    selectedSources: {},
    multiDatasetMode: false,
  });
}

/**
 * Populate terrainStore with a dataset that is selected but NOT yet active
 * (simulates queued state when slots are full, or just selected before streaming).
 */
function addSelectedOnly(datasetId: string, source: "preset" | "user" = "preset") {
  useTerrainStore.setState((prev) => ({
    ...prev,
    selectedIds: prev.selectedIds.includes(datasetId)
      ? prev.selectedIds
      : [...prev.selectedIds, datasetId],
    selectedSources: { ...prev.selectedSources, [datasetId]: source },
  }));
}

/**
 * Populate terrainStore with a dataset that is BOTH selected AND active
 * (simulates a dataset already in the rendered scene).
 */
function addVisible(datasetId: string, source: "preset" | "user" = "preset") {
  useTerrainStore.setState((prev) => {
    const alreadyVisible = prev.visibleDatasets.some((v) => v.datasetId === datasetId);
    return {
      ...prev,
      selectedIds: prev.selectedIds.includes(datasetId)
        ? prev.selectedIds
        : [...prev.selectedIds, datasetId],
      selectedSources: { ...prev.selectedSources, [datasetId]: source },
      visibleDatasets: alreadyVisible
        ? prev.visibleDatasets
        : [
            ...prev.visibleDatasets,
            { datasetId, source, activeGrid: null, overviewGrid: null },
          ],
      primaryDatasetIds: alreadyVisible
        ? prev.primaryDatasetIds
        : [...prev.primaryDatasetIds, datasetId],
      primaryDatasetId: prev.primaryDatasetId ?? datasetId,
    };
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStores();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers that render the hook and advance one tick
// ---------------------------------------------------------------------------

function renderStreamingHook(
  bboxMap: Record<string, DatasetBbox>,
  onActivate: ReturnType<typeof vi.fn>,
) {
  return renderHook(() =>
    useDatasetProximityStreaming({ bboxMap, onActivate }),
  );
}

// ---------------------------------------------------------------------------
// Tests — camera null-guard
// ---------------------------------------------------------------------------

describe("useDatasetProximityStreaming — null camera guard", () => {
  it("does nothing when cameraLon and cameraLat are null", () => {
    addSelectedOnly("ds-a");
    const onActivate = vi.fn();
    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(onActivate).not.toHaveBeenCalled();
  });

  it("does nothing when there are no selected or visible datasets", () => {
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);
    const onActivate = vi.fn();
    renderStreamingHook({}, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(onActivate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — activation within LOAD_THRESHOLD_M
// ---------------------------------------------------------------------------

describe("useDatasetProximityStreaming — activation within LOAD_THRESHOLD_M", () => {
  it("calls onActivate when camera is inside the dataset bbox (dist = 0)", () => {
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);
    addSelectedOnly("ds-a");

    const onActivate = vi.fn();
    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith("ds-a", "preset");
  });

  it("does NOT call onActivate when camera is far beyond LOAD_THRESHOLD_M", () => {
    setCameraAt(CAM_FAR_FROM_ALL.lon, CAM_FAR_FROM_ALL.lat);
    addSelectedOnly("ds-a");

    const onActivate = vi.fn();
    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(onActivate).not.toHaveBeenCalled();
  });

  it("does NOT call onActivate for a dataset that is already active", () => {
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);
    addVisible("ds-a"); // already in visibleDatasets

    const onActivate = vi.fn();
    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(onActivate).not.toHaveBeenCalled();
  });

  it("passes the correct source to onActivate", () => {
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);
    addSelectedOnly("ds-upload", "user");

    const onActivate = vi.fn();
    renderStreamingHook({ "ds-upload": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(onActivate).toHaveBeenCalledWith("ds-upload", "user");
  });
});

// ---------------------------------------------------------------------------
// Tests — no-bbox datasets (user uploads)
// ---------------------------------------------------------------------------

describe("useDatasetProximityStreaming — no-bbox datasets", () => {
  it("activates a no-bbox selected dataset when a slot is available", () => {
    setCameraAt(CAM_FAR_FROM_ALL.lon, CAM_FAR_FROM_ALL.lat);
    addSelectedOnly("ds-upload", "user");
    // No bbox entry — hook treats this as 'always nearby'

    const onActivate = vi.fn();
    renderStreamingHook({}, onActivate); // empty bboxMap

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(onActivate).toHaveBeenCalledWith("ds-upload", "user");
  });

  it("does NOT activate a no-bbox dataset when already in visibleDatasets", () => {
    setCameraAt(CAM_FAR_FROM_ALL.lon, CAM_FAR_FROM_ALL.lat);
    addVisible("ds-upload", "user");

    const onActivate = vi.fn();
    renderStreamingHook({}, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(onActivate).not.toHaveBeenCalled();
  });

  it("does NOT activate a no-bbox dataset when slots are full", () => {
    setCameraAt(CAM_FAR_FROM_ALL.lon, CAM_FAR_FROM_ALL.lat);
    // Fill cap with visible datasets that have no bbox
    for (let i = 0; i < MAX_ACTIVE_DATASETS; i++) {
      addVisible(`ds-fill-${i}`, "preset");
    }
    // Add one no-bbox queued dataset
    addSelectedOnly("ds-upload", "user");

    const onActivate = vi.fn();
    renderStreamingHook({}, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(onActivate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — eviction beyond UNLOAD_THRESHOLD_M
// ---------------------------------------------------------------------------

describe("useDatasetProximityStreaming — eviction beyond UNLOAD_THRESHOLD_M", () => {
  it("calls autoEvict when an active dataset is beyond UNLOAD_THRESHOLD_M", () => {
    // Camera is inside BBOX_FAR; ds-a's bbox (BBOX_ORIGIN) is ~1 000 km away
    setCameraAt(CAM_INSIDE_FAR.lon, CAM_INSIDE_FAR.lat);
    addVisible("ds-a"); // active but far from camera

    const autoEvictSpy = vi.spyOn(useTerrainStore.getState(), "autoEvict");
    const onActivate = vi.fn();
    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(autoEvictSpy).toHaveBeenCalledWith("ds-a");
  });

  it("does NOT call autoEvict when an active dataset is within UNLOAD_THRESHOLD_M", () => {
    // Camera inside BBOX_ORIGIN — dist to ds-a = 0
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);
    addVisible("ds-a");

    const autoEvictSpy = vi.spyOn(useTerrainStore.getState(), "autoEvict");
    const onActivate = vi.fn();
    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(autoEvictSpy).not.toHaveBeenCalled();
  });

  it("only evicts the far dataset, not nearby active ones", () => {
    // Camera at origin: ds-near is inside BBOX_ORIGIN (dist=0), ds-far is ~1000 km away
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);
    addVisible("ds-near");
    addVisible("ds-far");

    const autoEvictSpy = vi.spyOn(useTerrainStore.getState(), "autoEvict");
    const onActivate = vi.fn();
    renderStreamingHook(
      { "ds-near": BBOX_ORIGIN, "ds-far": BBOX_FAR },
      onActivate,
    );

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(autoEvictSpy).toHaveBeenCalledWith("ds-far");
    expect(autoEvictSpy).not.toHaveBeenCalledWith("ds-near");
  });
});

// ---------------------------------------------------------------------------
// Tests — simultaneous activation of multiple datasets
// ---------------------------------------------------------------------------

describe("useDatasetProximityStreaming — simultaneous activation", () => {
  it("activates both datasets in the same tick when both are within threshold", () => {
    // Camera inside BBOX_ORIGIN; both datasets share the same bbox to guarantee dist=0
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);
    addSelectedOnly("ds-a");
    addSelectedOnly("ds-b");

    const onActivate = vi.fn();
    renderStreamingHook(
      { "ds-a": BBOX_ORIGIN, "ds-b": BBOX_ORIGIN },
      onActivate,
    );

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    expect(onActivate).toHaveBeenCalledTimes(2);
    const calledIds = onActivate.mock.calls.map((c) => c[0] as string);
    expect(calledIds).toContain("ds-a");
    expect(calledIds).toContain("ds-b");
  });
});

// ---------------------------------------------------------------------------
// Tests — evict-farthest when at cap
// ---------------------------------------------------------------------------

describe("useDatasetProximityStreaming — evict-farthest when at cap", () => {
  it("evicts the farthest active dataset to make room for a nearby queued one", () => {
    // Camera at origin.
    // ds-near-1, ds-near-2 are active and close (dist 0).
    // ds-far is active but ~1000 km away.
    // ds-candidate is selected-but-not-active and close.
    // Cap is MAX_ACTIVE_DATASETS = 3: all three active datasets fill the slots.
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);
    addVisible("ds-near-1");
    addVisible("ds-near-2");
    addVisible("ds-far");
    addSelectedOnly("ds-candidate");

    const autoEvictSpy = vi.spyOn(useTerrainStore.getState(), "autoEvict");
    const onActivate = vi.fn();
    renderStreamingHook(
      {
        "ds-near-1": BBOX_ORIGIN,
        "ds-near-2": BBOX_ORIGIN,
        "ds-far": BBOX_FAR,
        "ds-candidate": BBOX_ORIGIN,
      },
      onActivate,
    );

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    // Step 1 evicts ds-far (beyond UNLOAD_THRESHOLD_M). Then step 2 activates ds-candidate.
    expect(autoEvictSpy).toHaveBeenCalledWith("ds-far");
    expect(onActivate).toHaveBeenCalledWith("ds-candidate", "preset");
  });
});

// ---------------------------------------------------------------------------
// Tests — evict-then-re-activate cycle
// ---------------------------------------------------------------------------

describe("useDatasetProximityStreaming — evict-then-re-activate cycle", () => {
  it("re-activates an evicted dataset when camera returns within threshold", () => {
    // Tick 1: camera far from ds-a → ds-a gets evicted.
    setCameraAt(CAM_INSIDE_FAR.lon, CAM_INSIDE_FAR.lat);
    addVisible("ds-a"); // active, far from camera

    const autoEvictSpy = vi.spyOn(useTerrainStore.getState(), "autoEvict");
    const onActivate = vi.fn();
    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });
    expect(autoEvictSpy).toHaveBeenCalledWith("ds-a");

    // Simulate the effect of autoEvict: ds-a leaves visibleDatasets but stays in selectedIds.
    useTerrainStore.getState().autoEvict("ds-a"); // ensure store state reflects eviction
    // ds-a is now selected-but-not-active.

    // Tick 2: camera moves back to inside BBOX_ORIGIN.
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);

    act(() => { vi.advanceTimersByTime(TICK_MS); });
    expect(onActivate).toHaveBeenCalledWith("ds-a", "preset");
  });
});

// ---------------------------------------------------------------------------
// Tests — pool-cap stress: 20 datasets, MAX_ACTIVE_DATASETS cap
// ---------------------------------------------------------------------------

describe("useDatasetProximityStreaming — pool-cap stress: 20 datasets", () => {
  it("never holds more than MAX_ACTIVE_DATASETS active at any sample tick across 5 ticks", () => {
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);

    const bboxMap: Record<string, DatasetBbox> = {};
    for (let i = 0; i < 20; i++) {
      const id = `ds-stress-${i}`;
      addSelectedOnly(id);
      bboxMap[id] = BBOX_ORIGIN; // all within LOAD_THRESHOLD_M
    }

    // Realistic onActivate: drives autoActivate so the store updates between loop iterations.
    const onActivate = vi.fn((id: string) => {
      useTerrainStore.getState().autoActivate(id);
    });

    renderStreamingHook(bboxMap, onActivate);

    for (let tick = 0; tick < 5; tick++) {
      act(() => { vi.advanceTimersByTime(TICK_MS); });
      const active = useTerrainStore.getState().visibleDatasets;
      expect(
        active.length,
        `Tick ${tick + 1}: expected ≤ ${MAX_ACTIVE_DATASETS} active, got ${active.length}`,
      ).toBeLessThanOrEqual(MAX_ACTIVE_DATASETS);
    }
  });

  it("does not double-activate any single dataset within one tick", () => {
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);

    const bboxMap: Record<string, DatasetBbox> = {};
    for (let i = 0; i < 20; i++) {
      const id = `ds-stress-${i}`;
      addSelectedOnly(id);
      bboxMap[id] = BBOX_ORIGIN;
    }

    const activatedIds: string[] = [];
    const onActivate = vi.fn((id: string) => {
      activatedIds.push(id);
      useTerrainStore.getState().autoActivate(id);
    });

    renderStreamingHook(bboxMap, onActivate);
    act(() => { vi.advanceTimersByTime(TICK_MS); }); // one tick only

    const counts = new Map<string, number>();
    for (const id of activatedIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, count] of counts.entries()) {
      expect(count, `Dataset ${id} was activated ${count} times in one tick`).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — hysteresis: inside vs outside UNLOAD_THRESHOLD_M
//
// BBOX_ORIGIN has maxLat = 0.01°.  Camera at (0, lat) with lat > 0.01:
//   dist ≈ (lat − 0.01) × 111 195 m/°
//   lat = 0.036 → dist ≈ 2 891 m  (inside UNLOAD_THRESHOLD_M = 3 000 m)
//   lat = 0.038 → dist ≈ 3 113 m  (outside UNLOAD_THRESHOLD_M)
// ---------------------------------------------------------------------------

describe("useDatasetProximityStreaming — hysteresis boundary", () => {
  const CAM_NEAR_UNLOAD = { lon: 0, lat: 0.036 }; // ~2891 m from BBOX_ORIGIN — within threshold
  const CAM_FAR_UNLOAD  = { lon: 0, lat: 0.038 }; // ~3113 m from BBOX_ORIGIN — beyond threshold

  it("retains an active dataset when camera is ~2891 m from its bbox (inside UNLOAD_THRESHOLD_M)", () => {
    addVisible("ds-a");
    setCameraAt(CAM_NEAR_UNLOAD.lon, CAM_NEAR_UNLOAD.lat);

    const autoEvictSpy = vi.spyOn(useTerrainStore.getState(), "autoEvict");
    const onActivate = vi.fn();
    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    // ~2891 m < UNLOAD_THRESHOLD_M (3000 m) — must NOT be evicted.
    expect(autoEvictSpy).not.toHaveBeenCalledWith("ds-a");
    expect(
      useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId),
    ).toContain("ds-a");
  });

  it("evicts an active dataset when camera retreats to ~3113 m from its bbox (beyond UNLOAD_THRESHOLD_M)", () => {
    addVisible("ds-a");
    setCameraAt(CAM_FAR_UNLOAD.lon, CAM_FAR_UNLOAD.lat);

    const autoEvictSpy = vi.spyOn(useTerrainStore.getState(), "autoEvict");
    const onActivate = vi.fn();
    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    // ~3113 m > UNLOAD_THRESHOLD_M (3000 m) — must be evicted.
    expect(autoEvictSpy).toHaveBeenCalledWith("ds-a");
  });

  it("dataset remains in selectedIds after hysteresis eviction so it can re-activate on approach", () => {
    addVisible("ds-a");
    setCameraAt(CAM_FAR_UNLOAD.lon, CAM_FAR_UNLOAD.lat);

    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, vi.fn());
    act(() => { vi.advanceTimersByTime(TICK_MS); });

    // autoEvict removes from visibleDatasets but keeps in selectedIds.
    expect(useTerrainStore.getState().selectedIds).toContain("ds-a");
    expect(
      useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId),
    ).not.toContain("ds-a");
  });
});

// ---------------------------------------------------------------------------
// Tests — no-bbox slot fairness
// ---------------------------------------------------------------------------

describe("useDatasetProximityStreaming — no-bbox slot fairness", () => {
  it("fills an open slot with a no-bbox dataset while far bbox-valid ones stay inactive", () => {
    // Camera at origin.  FAR_AWAY bbox is ~555 km away — well beyond LOAD_THRESHOLD_M.
    const BBOX_FAR_AWAY: DatasetBbox = { minLon: 5.0, maxLon: 5.1, minLat: 5.0, maxLat: 5.1 };
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);

    addSelectedOnly("ds-far-1");
    addSelectedOnly("ds-far-2");
    addSelectedOnly("ds-no-bbox", "user"); // no bbox entry → always-nearby fallback

    const activatedIds: string[] = [];
    const onActivate = vi.fn((id: string) => {
      activatedIds.push(id);
      useTerrainStore.getState().autoActivate(id);
    });

    renderStreamingHook(
      {
        "ds-far-1": BBOX_FAR_AWAY,
        "ds-far-2": BBOX_FAR_AWAY,
        // ds-no-bbox intentionally absent from bboxMap → no-bbox path
      },
      onActivate,
    );

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    // No-bbox dataset must fill a slot (always-nearby slot fill, Step 3 of hook).
    expect(activatedIds).toContain("ds-no-bbox");
    // Far bbox-valid datasets must NOT be activated (beyond LOAD_THRESHOLD_M).
    expect(activatedIds).not.toContain("ds-far-1");
    expect(activatedIds).not.toContain("ds-far-2");
  });

  it("does not evict a bbox-valid active dataset to admit a no-bbox queued one when no eviction candidate exists", () => {
    // All active slots occupied by bbox-valid nearby datasets.
    // A no-bbox queued dataset arrives — hook must NOT evict to make room for it
    // (the evict-farthest path covers bbox candidates only; no-bbox activation goes
    // through Step 3 which only fires when slots are free).
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);

    for (let i = 0; i < MAX_ACTIVE_DATASETS; i++) {
      addVisible(`ds-fill-${i}`); // fills all active slots
    }
    addSelectedOnly("ds-no-bbox-queued", "user");

    const onActivate = vi.fn();
    renderStreamingHook(
      // All active fill datasets have BBOX_ORIGIN bbox (inside UNLOAD_THRESHOLD — not evicted).
      Object.fromEntries(
        Array.from({ length: MAX_ACTIVE_DATASETS }, (_, i) => [`ds-fill-${i}`, BBOX_ORIGIN]),
      ),
      onActivate,
    );

    act(() => { vi.advanceTimersByTime(TICK_MS); });

    // Slots full, no eviction candidate via bbox distance — no-bbox dataset stays queued.
    expect(onActivate).not.toHaveBeenCalled();
    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(MAX_ACTIVE_DATASETS);
  });
});

// ---------------------------------------------------------------------------
// Tests — multiple ticks
// ---------------------------------------------------------------------------

describe("useDatasetProximityStreaming — multiple ticks", () => {
  it("fires onActivate on every tick while the dataset is still queued and nearby", () => {
    // The hook does not mark a dataset as 'pending activation' — it calls
    // onActivate as long as the conditions hold. The onActivate callback is
    // responsible for actually activating via autoActivate (which would remove
    // the dataset from the inactive list). With a no-op onActivate, the hook
    // will call it on every tick.
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);
    addSelectedOnly("ds-a");

    const onActivate = vi.fn();
    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS * 3); });

    // Called once per tick — 3 ticks = 3 calls (because the store state was
    // never updated by the no-op onActivate).
    expect(onActivate.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("stops firing onActivate once the dataset is activated in the store", () => {
    setCameraAt(CAM_INSIDE_ORIGIN.lon, CAM_INSIDE_ORIGIN.lat);
    addSelectedOnly("ds-a");

    // onActivate actually activates via the store (realistic behaviour)
    const onActivate = vi.fn((id: string) => {
      useTerrainStore.getState().autoActivate(id);
    });
    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS * 3); });

    // After the first tick activates ds-a, subsequent ticks should see it in
    // visibleDatasets and not call onActivate again.
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("stops firing autoEvict once the dataset leaves visibleDatasets", () => {
    setCameraAt(CAM_INSIDE_FAR.lon, CAM_INSIDE_FAR.lat);
    addVisible("ds-a");

    const autoEvictSpy = vi.spyOn(useTerrainStore.getState(), "autoEvict").mockImplementation(
      (id) => { useTerrainStore.getState().autoEvict.call(useTerrainStore.getState(), id); }
    );
    const onActivate = vi.fn();

    // Use the real autoEvict so the store state changes after the first call.
    autoEvictSpy.mockRestore();
    const realAutoEvictSpy = vi.spyOn(useTerrainStore.getState(), "autoEvict");

    renderStreamingHook({ "ds-a": BBOX_ORIGIN }, onActivate);

    act(() => { vi.advanceTimersByTime(TICK_MS * 3); });

    // The hook's first tick evicts ds-a. Subsequent ticks see it as inactive
    // (not in visibleDatasets) and do not call autoEvict again.
    expect(realAutoEvictSpy).toHaveBeenCalledTimes(1);
  });
});
