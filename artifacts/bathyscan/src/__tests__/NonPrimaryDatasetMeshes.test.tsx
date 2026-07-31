/**
 * NonPrimaryDatasetMeshes — render-level regression tests.
 *
 * Guards the fix from Task 3144: the component derives `primaryId` from the
 * `primary` prop (primary.datasetId) rather than reading store.primaryDatasetId
 * separately.  The two sources update in different React renders during a
 * primary switch, creating a one-frame window where the new primary could
 * incorrectly appear as a secondary mesh.
 *
 * Strategy
 * --------
 * • Render NonPrimaryDatasetMeshes with React DOM (jsdom) outside an R3F
 *   Canvas.  React treats unknown elements like <group> as custom HTML
 *   elements, so they appear in the jsdom DOM and are queryable.
 * • Each rendered <group> carries `name={v.datasetId}` so tests can locate
 *   groups by dataset identity without relying on React's internal key system.
 * • TerrainMesh and LandmassMesh are mocked so their R3F/WebGL imports do not
 *   crash the jsdom environment.
 * • The store's primaryDatasetId is intentionally left un-updated in the
 *   regression test to simulate the inconsistent-state window the fix
 *   guards against.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, act } from "@testing-library/react";
import type { TerrainData } from "@workspace/api-client-react";

// Mock heavy R3F/WebGL dependencies before importing the component under test.
vi.mock("@/components/TerrainMesh", () => ({
  TerrainMesh: () => null,
}));
vi.mock("@/components/LandmassMesh", () => ({
  LandmassMesh: () => null,
}));

import { NonPrimaryDatasetMeshes } from "@/components/NonPrimaryDatasetMeshes";
import { useTerrainStore } from "@/lib/terrainStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Return all <group> elements whose `name` attribute matches datasetId. */
function groupsFor(container: HTMLElement, datasetId: string): NodeListOf<Element> {
  return container.querySelectorAll(`[name="${datasetId}"]`);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  useTerrainStore.getState().clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NonPrimaryDatasetMeshes — primary-switch regression", () => {
  it("excludes the current primary from secondary groups on initial render", () => {
    const gridA = makeGrid("dataset-a");
    const gridB = makeGrid("dataset-b");
    const gridC = makeGrid("dataset-c");

    useTerrainStore.getState().setGrids({ activeGrid: gridA });
    useTerrainStore.getState().toggleVisible({ datasetId: "dataset-b", source: "preset" });
    useTerrainStore.getState().setDatasetGrids("dataset-b", { activeGrid: gridB });
    useTerrainStore.getState().toggleVisible({ datasetId: "dataset-c", source: "preset" });
    useTerrainStore.getState().setDatasetGrids("dataset-c", { activeGrid: gridC });

    const { container } = render(
      <NonPrimaryDatasetMeshes primary={gridA} showLandmass={false} />,
    );

    // B and C are secondaries — must be rendered.
    expect(groupsFor(container, "dataset-b").length).toBeGreaterThan(0);
    expect(groupsFor(container, "dataset-c").length).toBeGreaterThan(0);

    // A is the primary — must NOT appear as a secondary group.
    expect(groupsFor(container, "dataset-a").length).toBe(0);
  });

  it(
    "excludes the NEW primary from secondaries when the primary prop changes," +
    " even if store.primaryDatasetId still holds the old value",
    () => {
      // This is the core regression guard.
      //
      // If the component had used store.primaryDatasetId instead of
      // primary.datasetId from the prop, the inconsistent-state window during a
      // primary switch would allow the new primary to appear as a secondary mesh
      // for one render frame.  We reproduce that window by leaving the store's
      // primaryDatasetId pointing at "dataset-a" while rerendering with
      // primary={gridB}.
      const gridA = makeGrid("dataset-a");
      const gridB = makeGrid("dataset-b");
      const gridC = makeGrid("dataset-c");

      useTerrainStore.getState().setGrids({ activeGrid: gridA });
      useTerrainStore.getState().toggleVisible({ datasetId: "dataset-b", source: "preset" });
      useTerrainStore.getState().setDatasetGrids("dataset-b", { activeGrid: gridB });
      useTerrainStore.getState().toggleVisible({ datasetId: "dataset-c", source: "preset" });
      useTerrainStore.getState().setDatasetGrids("dataset-c", { activeGrid: gridC });

      // Verify the store still considers "dataset-a" as primary before rerender.
      expect(useTerrainStore.getState().primaryDatasetId).toBe("dataset-a");

      const { container, rerender } = render(
        <NonPrimaryDatasetMeshes primary={gridA} showLandmass={false} />,
      );

      // Switch the primary prop to B in one act() WITHOUT updating the store.
      // This simulates the render that fires as primaryDatasetId propagates
      // through the component tree before the store has committed its own update.
      act(() => {
        rerender(<NonPrimaryDatasetMeshes primary={gridB} showLandmass={false} />);
      });

      // Store still says "dataset-a" is primary — confirms the inconsistent state.
      expect(useTerrainStore.getState().primaryDatasetId).toBe("dataset-a");

      // B is now the primary prop — it must be absent from secondary groups.
      expect(groupsFor(container, "dataset-b").length).toBe(0);

      // A and C should still be rendered as secondaries.
      expect(groupsFor(container, "dataset-a").length).toBeGreaterThan(0);
      expect(groupsFor(container, "dataset-c").length).toBeGreaterThan(0);
    },
  );

  it("renders no secondary groups when only one dataset is visible", () => {
    const gridA = makeGrid("dataset-a");
    useTerrainStore.getState().setGrids({ activeGrid: gridA });

    const { container } = render(
      <NonPrimaryDatasetMeshes primary={gridA} showLandmass={false} />,
    );

    expect(container.querySelector("group")).toBeNull();
  });

  it("skips visible datasets that have no loaded grid (activeGrid is null)", () => {
    const gridA = makeGrid("dataset-a");
    useTerrainStore.getState().setGrids({ activeGrid: gridA });
    // Add B to visible but give it no grid (activeGrid stays null after toggleVisible).
    useTerrainStore.getState().toggleVisible({ datasetId: "dataset-b", source: "preset" });

    const { container } = render(
      <NonPrimaryDatasetMeshes primary={gridA} showLandmass={false} />,
    );

    // B has no loaded grid — its group must not appear.
    expect(groupsFor(container, "dataset-b").length).toBe(0);
  });

  it("renders all non-primary secondaries and excludes only the primary after a second switch", () => {
    // Verify that the fix holds across multiple successive primary changes.
    const gridA = makeGrid("dataset-a");
    const gridB = makeGrid("dataset-b");
    const gridC = makeGrid("dataset-c");

    useTerrainStore.getState().setGrids({ activeGrid: gridA });
    useTerrainStore.getState().toggleVisible({ datasetId: "dataset-b", source: "preset" });
    useTerrainStore.getState().setDatasetGrids("dataset-b", { activeGrid: gridB });
    useTerrainStore.getState().toggleVisible({ datasetId: "dataset-c", source: "preset" });
    useTerrainStore.getState().setDatasetGrids("dataset-c", { activeGrid: gridC });

    const { container, rerender } = render(
      <NonPrimaryDatasetMeshes primary={gridA} showLandmass={false} />,
    );

    // First switch: A → B
    act(() => {
      rerender(<NonPrimaryDatasetMeshes primary={gridB} showLandmass={false} />);
    });
    expect(groupsFor(container, "dataset-b").length).toBe(0);
    expect(groupsFor(container, "dataset-a").length).toBeGreaterThan(0);
    expect(groupsFor(container, "dataset-c").length).toBeGreaterThan(0);

    // Second switch: B → C
    act(() => {
      rerender(<NonPrimaryDatasetMeshes primary={gridC} showLandmass={false} />);
    });
    expect(groupsFor(container, "dataset-c").length).toBe(0);
    expect(groupsFor(container, "dataset-a").length).toBeGreaterThan(0);
    expect(groupsFor(container, "dataset-b").length).toBeGreaterThan(0);
  });
});
