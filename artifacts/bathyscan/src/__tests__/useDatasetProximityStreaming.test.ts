import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import { renderHook, act } from "@testing-library/react";
import { useTerrainStore } from "@/lib/terrainStore";
import { useCameraStore } from "@/lib/cameraStore";
import {
  LOAD_THRESHOLD_M,
  UNLOAD_THRESHOLD_M,
  useDatasetProximityStreaming,
} from "@/hooks/useDatasetProximityStreaming";
import type { DatasetBbox, ProximityStreamingOptions } from "@/hooks/useDatasetProximityStreaming";

/**
 * Unit tests for proximity-streaming eviction logic.
 *
 * Rather than mounting the React hook (which requires a canvas + R3F context),
 * these tests exercise the store primitives that the hook drives — verifying
 * the invariants the hook is designed to maintain.
 *
 * The critical scenario is the "pinned-active" case: a dataset that became
 * active via a non-streaming path (e.g. setGrids / setSinglePrimary) must
 * not block streaming capacity — it must be evictable even when absent from
 * selectedIds.
 */

function makeGrid(datasetId: string): TerrainData {
  return {
    datasetId,
    minLat: 0,
    maxLat: 1,
    minLon: 0,
    maxLon: 1,
    minDepth: 0,
    maxDepth: 10,
    width: 2,
    height: 2,
    resolution: 2,
    depths: [0, 5, 5, 10],
  } as unknown as TerrainData;
}

beforeEach(() => {
  useTerrainStore.getState().clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LOAD_THRESHOLD_M / UNLOAD_THRESHOLD_M constants", () => {
  it("LOAD_THRESHOLD_M is 500 metres", () => {
    expect(LOAD_THRESHOLD_M).toBe(500);
  });
  it("UNLOAD_THRESHOLD_M is 3000 metres", () => {
    expect(UNLOAD_THRESHOLD_M).toBe(3_000);
  });
});

describe("Pinned-active dataset eviction (store primitive validation)", () => {
  it("autoEvict removes a dataset that was loaded via setGrids (not via selectedIds)", () => {
    // Simulate a dataset that became active via setGrids — not via the
    // streaming path — so it's not in selectedIds.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("pinned") });
    expect(useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId)).toContain("pinned");
    expect(useTerrainStore.getState().selectedIds).not.toContain("pinned");

    // The proximity hook calls autoEvict when the pinned dataset drifts far.
    useTerrainStore.getState().autoEvict("pinned");
    const s = useTerrainStore.getState();
    expect(s.visibleDatasets.map((v) => v.datasetId)).not.toContain("pinned");
    expect(s.autoEvictedId).toBe("pinned");
  });

  it("autoEvict + autoActivate frees a slot and admits a queued selected dataset", () => {
    // Fill active slots to cap using setGrids (pinned) + toggleVisible.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("pinned") });
    useTerrainStore.getState().toggleVisible({ datasetId: "near-a", source: "preset" });
    useTerrainStore.getState().toggleVisible({ datasetId: "near-b", source: "preset" });
    // "far-c" is selected but queued (cap reached).
    useTerrainStore.getState().toggleVisible({ datasetId: "far-c", source: "preset" });

    const before = useTerrainStore.getState();
    expect(before.visibleDatasets).toHaveLength(3); // at MAX_ACTIVE_DATASETS
    expect(before.selectedIds).toContain("far-c");
    expect(before.visibleDatasets.map((v) => v.datasetId)).not.toContain("far-c");

    // Hook determines "pinned" is farthest active and evicts it.
    useTerrainStore.getState().autoEvict("pinned");
    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(2);

    // Hook then activates the queued nearby selected dataset.
    useTerrainStore.getState().autoActivate("far-c", "preset");
    const after = useTerrainStore.getState();
    expect(after.visibleDatasets.map((v) => v.datasetId)).toContain("far-c");
    expect(after.visibleDatasets.map((v) => v.datasetId)).not.toContain("pinned");
    expect(after.visibleDatasets).toHaveLength(3);
  });

  it("active-but-not-selected dataset does NOT prevent autoEvict", () => {
    // Ensure autoEvict works regardless of selectedIds membership.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("beta") });
    // Neither "alpha" nor the old "alpha" (evicted by cap) is in selectedIds.
    // But whatever IS active can still be evicted.
    const active = useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId);
    expect(active.length).toBeGreaterThan(0);
    const target = active[active.length - 1]!;
    expect(useTerrainStore.getState().selectedIds).not.toContain(target);

    useTerrainStore.getState().autoEvict(target);
    expect(
      useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId),
    ).not.toContain(target);
  });

  it("clearAutoEviction resets autoEvictedId without affecting visibleDatasets", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("alpha") });
    useTerrainStore.getState().toggleVisible({ datasetId: "beta", source: "preset" });
    useTerrainStore.getState().autoEvict("beta");
    expect(useTerrainStore.getState().autoEvictedId).toBe("beta");

    const visLen = useTerrainStore.getState().visibleDatasets.length;
    useTerrainStore.getState().clearAutoEviction();
    const s = useTerrainStore.getState();
    expect(s.autoEvictedId).toBeNull();
    expect(s.visibleDatasets).toHaveLength(visLen);
  });
});

describe("selectedIds correctness for streaming candidates", () => {
  it("selected-but-not-active datasets appear in selectedIds when at cap", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("a") });
    useTerrainStore.getState().toggleVisible({ datasetId: "b", source: "preset" });
    useTerrainStore.getState().toggleVisible({ datasetId: "c", source: "preset" });
    // Now at MAX_ACTIVE_DATASETS (3). Next toggleVisible should queue.
    useTerrainStore.getState().toggleVisible({ datasetId: "d", source: "preset" });
    useTerrainStore.getState().toggleVisible({ datasetId: "e", source: "preset" });

    const s = useTerrainStore.getState();
    expect(s.visibleDatasets).toHaveLength(3);
    expect(s.selectedIds).toContain("d");
    expect(s.selectedIds).toContain("e");
    expect(s.visibleDatasets.map((v) => v.datasetId)).not.toContain("d");
    expect(s.visibleDatasets.map((v) => v.datasetId)).not.toContain("e");
  });

  it("activating a queued dataset via autoActivate adds it to visibleDatasets", () => {
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("a") });
    useTerrainStore.getState().toggleVisible({ datasetId: "b", source: "preset" });
    useTerrainStore.getState().toggleVisible({ datasetId: "c", source: "preset" });
    useTerrainStore.getState().toggleVisible({ datasetId: "d", source: "preset" });
    // Evict one to make room.
    useTerrainStore.getState().autoEvict("c");
    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(2);
    // Now autoActivate admits "d" from the queue.
    useTerrainStore.getState().autoActivate("d", "preset");
    const s = useTerrainStore.getState();
    expect(s.visibleDatasets.map((v) => v.datasetId)).toContain("d");
    expect(s.visibleDatasets).toHaveLength(3);
  });
});

describe("useDatasetProximityStreaming hook — timer integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useTerrainStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    useTerrainStore.getState().clear();
  });

  /** Small bbox centred at (0,0) — camera at (0,0) is inside (0 m distance). */
  const NEAR_BBOX: DatasetBbox = { minLon: -0.001, maxLon: 0.001, minLat: -0.001, maxLat: 0.001 };
  /** Bbox far from (0,0) — camera at (0,0) is ~111 km away (>> UNLOAD_THRESHOLD_M). */
  const FAR_BBOX: DatasetBbox = { minLon: 1, maxLon: 2, minLat: 0, maxLat: 1 };

  it("activates a selected nearby dataset after evicting far active datasets", () => {
    // Camera at (0,0) — inside NEAR_BBOX, ~111 km from FAR_BBOX.
    useCameraStore.setState({ cameraLon: 0, cameraLat: 0 });

    // Fill to cap (3): seed (setGrids, not in selectedIds) + far-1 + far-2 (toggleVisible).
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("seed") });
    useTerrainStore.getState().toggleVisible({ datasetId: "far-1", source: "preset" });
    useTerrainStore.getState().toggleVisible({ datasetId: "far-2", source: "preset" });
    // toggleVisible at cap queues "nearby-a" in selectedIds without activating.
    useTerrainStore.getState().toggleVisible({ datasetId: "nearby-a", source: "preset" });

    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(3);
    expect(useTerrainStore.getState().selectedIds).toContain("nearby-a");
    expect(
      useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId),
    ).not.toContain("nearby-a");

    const onActivate = vi.fn((id: string, source) => {
      useTerrainStore.getState().autoActivate(id, source);
    });

    renderHook(() => useDatasetProximityStreaming({
      bboxMap: {
        seed: NEAR_BBOX,
        "far-1": FAR_BBOX,
        "far-2": FAR_BBOX,
        "nearby-a": NEAR_BBOX,
      },
      onActivate,
    }));

    // Advance past one sample interval — hook evicts far-1/far-2, activates nearby-a.
    act(() => { vi.advanceTimersByTime(600); });

    expect(onActivate).toHaveBeenCalledWith("nearby-a", "preset");
    expect(
      useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId),
    ).toContain("nearby-a");
  });

  it("evicts a far active dataset on the next tick", () => {
    // Camera at (0,0) — FAR_BBOX is ~111 km away.
    useCameraStore.setState({ cameraLon: 0, cameraLat: 0 });

    // "far-a" is active AND selected.
    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("far-a") });
    useTerrainStore.getState().addSelected("far-a", "preset");

    const onActivate = vi.fn();
    const opts: ProximityStreamingOptions = {
      bboxMap: { "far-a": FAR_BBOX },
      onActivate,
    };

    renderHook(() => useDatasetProximityStreaming(opts));

    act(() => { vi.advanceTimersByTime(600); });

    // "far-a" should have been auto-evicted.
    expect(
      useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId),
    ).not.toContain("far-a");
    expect(useTerrainStore.getState().autoEvictedId).toBe("far-a");
  });

  it("evicts farthest active (including pinned non-selected) to admit nearby queued", () => {
    // Camera at (0,0). "pinned" loaded via setGrids — not in selectedIds.
    // "near-queued" is selected but at cap, so queued.
    useCameraStore.setState({ cameraLon: 0, cameraLat: 0 });

    useTerrainStore.getState().setGrids({ activeGrid: makeGrid("pinned") });
    useTerrainStore.getState().toggleVisible({ datasetId: "active-2", source: "preset" });
    useTerrainStore.getState().toggleVisible({ datasetId: "active-3", source: "preset" });
    // At cap. Select "near-queued" — should queue.
    useTerrainStore.getState().addSelected("near-queued", "preset");

    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(3);
    expect(useTerrainStore.getState().selectedIds).toContain("near-queued");

    const onActivate = vi.fn((id: string, source) => {
      useTerrainStore.getState().autoActivate(id, source);
    });

    const opts: ProximityStreamingOptions = {
      bboxMap: {
        // "pinned" is far; "active-2" and "active-3" have no bbox (treated as
        // always nearby); "near-queued" is inside bbox.
        pinned: FAR_BBOX,
        "near-queued": NEAR_BBOX,
      },
      onActivate,
    };

    renderHook(() => useDatasetProximityStreaming(opts));

    act(() => { vi.advanceTimersByTime(600); });

    // "pinned" (farthest active with bbox, even though not in selectedIds)
    // should have been evicted to make room for "near-queued".
    const ids = useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId);
    expect(ids).toContain("near-queued");
    expect(ids).not.toContain("pinned");
    expect(ids).toHaveLength(3);
  });
});
