/**
 * Unit tests for the proximity-streaming store actions in terrainStore:
 *   addSelected, removeSelected, autoActivate, autoEvict
 *
 * These actions are the contract between the UI and the streaming engine.
 * Covered:
 *   - addSelected activates immediately when slots remain
 *   - addSelected queues (selected-only) when at MAX_ACTIVE_DATASETS cap
 *   - addSelected is idempotent for already-selected datasets (updates source)
 *   - removeSelected removes from both selectedIds and visibleDatasets
 *   - removeSelected is a no-op for unknown ids
 *   - autoActivate moves a selected-but-not-active dataset into visibleDatasets
 *   - autoActivate is a no-op when the id is not in selectedIds
 *   - autoActivate is a no-op when the dataset is already visible
 *   - autoEvict removes from visibleDatasets and keeps in selectedIds
 *   - autoEvict sets autoEvictedId (no evictedId — silent path)
 *   - autoEvict is a no-op when the dataset is not currently visible
 *   - Edge: simultaneous activation of 2 datasets (both fit when cap allows)
 *   - Edge: evict-then-re-activate cycle restores to visibleDatasets
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useTerrainStore, MAX_ACTIVE_DATASETS } from "@/lib/terrainStore";

function resetStore() {
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

beforeEach(() => {
  resetStore();
});

// ---------------------------------------------------------------------------
// addSelected
// ---------------------------------------------------------------------------

describe("terrainStore — addSelected", () => {
  it("activates immediately when there is room (slots < cap)", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    const { visibleDatasets, selectedIds } = useTerrainStore.getState();
    expect(selectedIds).toContain("ds-a");
    expect(visibleDatasets.some((v) => v.datasetId === "ds-a")).toBe(true);
  });

  it("stores the correct source on the new visible entry", () => {
    useTerrainStore.getState().addSelected("ds-user", "user");
    const entry = useTerrainStore
      .getState()
      .visibleDatasets.find((v) => v.datasetId === "ds-user");
    expect(entry?.source).toBe("user");
  });

  it("initialises activeGrid and overviewGrid to null on a fresh activation", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    const entry = useTerrainStore
      .getState()
      .visibleDatasets.find((v) => v.datasetId === "ds-a");
    expect(entry?.activeGrid).toBeNull();
    expect(entry?.overviewGrid).toBeNull();
  });

  it("queues selected-but-not-active when the cap is reached", () => {
    // Fill up to MAX_ACTIVE_DATASETS
    for (let i = 0; i < MAX_ACTIVE_DATASETS; i++) {
      useTerrainStore.getState().addSelected(`ds-fill-${i}`, "preset");
    }
    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(MAX_ACTIVE_DATASETS);

    // One more — should be queued, not immediately activated.
    useTerrainStore.getState().addSelected("ds-overflow", "preset");
    const state = useTerrainStore.getState();
    expect(state.selectedIds).toContain("ds-overflow");
    expect(state.visibleDatasets.some((v) => v.datasetId === "ds-overflow")).toBe(false);
    expect(state.visibleDatasets).toHaveLength(MAX_ACTIVE_DATASETS);
  });

  it("updates selectedSources even when the dataset is already selected", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().addSelected("ds-a", "user");
    expect(useTerrainStore.getState().selectedSources["ds-a"]).toBe("user");
  });

  it("does not add a duplicate entry to selectedIds on repeat call", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().addSelected("ds-a", "preset");
    const count = useTerrainStore
      .getState()
      .selectedIds.filter((id) => id === "ds-a").length;
    expect(count).toBe(1);
  });

  it("does not add a second visible entry when dataset is already visible", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().addSelected("ds-a", "preset");
    const count = useTerrainStore
      .getState()
      .visibleDatasets.filter((v) => v.datasetId === "ds-a").length;
    expect(count).toBe(1);
  });

  it("sets multiDatasetMode=true", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    expect(useTerrainStore.getState().multiDatasetMode).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeSelected
// ---------------------------------------------------------------------------

describe("terrainStore — removeSelected", () => {
  it("removes the id from selectedIds", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().removeSelected("ds-a");
    expect(useTerrainStore.getState().selectedIds).not.toContain("ds-a");
  });

  it("removes the entry from visibleDatasets when it was active", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    expect(
      useTerrainStore.getState().visibleDatasets.some((v) => v.datasetId === "ds-a"),
    ).toBe(true);
    useTerrainStore.getState().removeSelected("ds-a");
    expect(
      useTerrainStore.getState().visibleDatasets.some((v) => v.datasetId === "ds-a"),
    ).toBe(false);
  });

  it("removes the source from selectedSources", () => {
    useTerrainStore.getState().addSelected("ds-a", "user");
    useTerrainStore.getState().removeSelected("ds-a");
    expect(useTerrainStore.getState().selectedSources["ds-a"]).toBeUndefined();
  });

  it("removes from selectedIds even when the dataset was not active (queued)", () => {
    // Fill to cap first
    for (let i = 0; i < MAX_ACTIVE_DATASETS; i++) {
      useTerrainStore.getState().addSelected(`ds-fill-${i}`, "preset");
    }
    // Add one more to the queue
    useTerrainStore.getState().addSelected("ds-queued", "preset");
    expect(useTerrainStore.getState().selectedIds).toContain("ds-queued");

    useTerrainStore.getState().removeSelected("ds-queued");
    expect(useTerrainStore.getState().selectedIds).not.toContain("ds-queued");
    expect(
      useTerrainStore.getState().visibleDatasets.some((v) => v.datasetId === "ds-queued"),
    ).toBe(false);
  });

  it("is a no-op for an unknown id (does not throw, does not alter other ids)", () => {
    useTerrainStore.getState().addSelected("ds-keep", "preset");
    useTerrainStore.getState().removeSelected("ds-unknown");
    expect(useTerrainStore.getState().selectedIds).toContain("ds-keep");
  });

  it("does not affect sibling datasets when one is removed", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().addSelected("ds-b", "preset");
    useTerrainStore.getState().removeSelected("ds-a");
    expect(useTerrainStore.getState().selectedIds).toContain("ds-b");
    expect(
      useTerrainStore.getState().visibleDatasets.some((v) => v.datasetId === "ds-b"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// autoActivate
// ---------------------------------------------------------------------------

describe("terrainStore — autoActivate", () => {
  it("moves a selected-but-not-active dataset into visibleDatasets", () => {
    // Add to selected pool only (fill cap first so it stays queued)
    for (let i = 0; i < MAX_ACTIVE_DATASETS; i++) {
      useTerrainStore.getState().addSelected(`ds-fill-${i}`, "preset");
    }
    useTerrainStore.getState().addSelected("ds-q", "preset");
    expect(
      useTerrainStore.getState().visibleDatasets.some((v) => v.datasetId === "ds-q"),
    ).toBe(false);

    // Manually free one slot, then autoActivate the queued one
    useTerrainStore.getState().autoEvict("ds-fill-0");
    useTerrainStore.getState().autoActivate("ds-q");

    expect(
      useTerrainStore.getState().visibleDatasets.some((v) => v.datasetId === "ds-q"),
    ).toBe(true);
  });

  it("keeps the dataset in selectedIds after activation", () => {
    // Set up: add to selected and keep queued
    for (let i = 0; i < MAX_ACTIVE_DATASETS; i++) {
      useTerrainStore.getState().addSelected(`ds-fill-${i}`, "preset");
    }
    useTerrainStore.getState().addSelected("ds-q", "preset");
    useTerrainStore.getState().autoEvict("ds-fill-0");
    useTerrainStore.getState().autoActivate("ds-q");
    expect(useTerrainStore.getState().selectedIds).toContain("ds-q");
  });

  it("uses the source from selectedSources on the new visible entry", () => {
    for (let i = 0; i < MAX_ACTIVE_DATASETS; i++) {
      useTerrainStore.getState().addSelected(`ds-fill-${i}`, "preset");
    }
    useTerrainStore.getState().addSelected("ds-upload", "user");
    useTerrainStore.getState().autoEvict("ds-fill-0");
    useTerrainStore.getState().autoActivate("ds-upload");

    const entry = useTerrainStore
      .getState()
      .visibleDatasets.find((v) => v.datasetId === "ds-upload");
    expect(entry?.source).toBe("user");
  });

  it("is a no-op when the id is not in selectedIds", () => {
    const before = useTerrainStore.getState().visibleDatasets.length;
    useTerrainStore.getState().autoActivate("ds-unknown");
    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(before);
  });

  it("is a no-op when the dataset is already in visibleDatasets", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    const before = useTerrainStore.getState().visibleDatasets.length;
    useTerrainStore.getState().autoActivate("ds-a");
    expect(useTerrainStore.getState().visibleDatasets).toHaveLength(before);
  });
});

// ---------------------------------------------------------------------------
// autoEvict
// ---------------------------------------------------------------------------

describe("terrainStore — autoEvict", () => {
  it("removes the dataset from visibleDatasets", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().autoEvict("ds-a");
    expect(
      useTerrainStore.getState().visibleDatasets.some((v) => v.datasetId === "ds-a"),
    ).toBe(false);
  });

  it("keeps the dataset in selectedIds (eviction is not deselection)", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().autoEvict("ds-a");
    expect(useTerrainStore.getState().selectedIds).toContain("ds-a");
  });

  it("sets autoEvictedId to the evicted id", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().autoEvict("ds-a");
    expect(useTerrainStore.getState().autoEvictedId).toBe("ds-a");
  });

  it("does NOT set evictedId (silent path — no toast)", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().autoEvict("ds-a");
    expect(useTerrainStore.getState().evictedId).toBeNull();
  });

  it("is a no-op when the dataset is not in visibleDatasets", () => {
    // ds-a is selected but not visible (fill cap first)
    for (let i = 0; i < MAX_ACTIVE_DATASETS; i++) {
      useTerrainStore.getState().addSelected(`ds-fill-${i}`, "preset");
    }
    useTerrainStore.getState().addSelected("ds-a", "preset");
    const before = [...useTerrainStore.getState().visibleDatasets];
    useTerrainStore.getState().autoEvict("ds-a");
    expect(useTerrainStore.getState().visibleDatasets).toEqual(before);
  });

  it("does not affect sibling entries", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().addSelected("ds-b", "preset");
    useTerrainStore.getState().autoEvict("ds-a");
    expect(
      useTerrainStore.getState().visibleDatasets.some((v) => v.datasetId === "ds-b"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("terrainStore — proximity edge cases", () => {
  it("two datasets activate simultaneously when both fit within the cap", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().addSelected("ds-b", "preset");
    const { visibleDatasets } = useTerrainStore.getState();
    expect(visibleDatasets.some((v) => v.datasetId === "ds-a")).toBe(true);
    expect(visibleDatasets.some((v) => v.datasetId === "ds-b")).toBe(true);
  });

  it("evict-then-re-activate cycle restores the dataset to visibleDatasets", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    expect(
      useTerrainStore.getState().visibleDatasets.some((v) => v.datasetId === "ds-a"),
    ).toBe(true);

    // Proximity streaming evicts it
    useTerrainStore.getState().autoEvict("ds-a");
    expect(
      useTerrainStore.getState().visibleDatasets.some((v) => v.datasetId === "ds-a"),
    ).toBe(false);
    expect(useTerrainStore.getState().selectedIds).toContain("ds-a");

    // Camera comes back — streaming re-activates via autoActivate
    useTerrainStore.getState().autoActivate("ds-a");
    expect(
      useTerrainStore.getState().visibleDatasets.some((v) => v.datasetId === "ds-a"),
    ).toBe(true);
  });

  it("autoEvictedId is updated on each successive eviction", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().addSelected("ds-b", "preset");
    useTerrainStore.getState().autoEvict("ds-a");
    expect(useTerrainStore.getState().autoEvictedId).toBe("ds-a");
    useTerrainStore.getState().autoActivate("ds-a"); // re-activate
    useTerrainStore.getState().autoEvict("ds-b");
    expect(useTerrainStore.getState().autoEvictedId).toBe("ds-b");
  });

  it("clearAutoEviction resets autoEvictedId to null", () => {
    useTerrainStore.getState().addSelected("ds-a", "preset");
    useTerrainStore.getState().autoEvict("ds-a");
    useTerrainStore.getState().clearAutoEviction();
    expect(useTerrainStore.getState().autoEvictedId).toBeNull();
  });
});
