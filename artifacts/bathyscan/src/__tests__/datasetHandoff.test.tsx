/**
 * datasetHandoff — out-of-bounds follow-mode dataset suggestion.
 *
 * Covers:
 *  - distanceToBboxKm geometry (inside, outside, latitude correction)
 *  - suggestion found → "Left dataset area" toast with a Load & follow action
 *  - toast action click → uiStore.pendingFollowHandoff is set
 *  - already-visible datasets are excluded from suggestions
 *  - nothing found / request error → plain "Follow mode paused" toast
 *  - concurrent calls are deduped while a search is in flight
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";

const toastSpy = vi.hoisted(() => vi.fn());
const getDatasetsMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
}));

vi.mock("@workspace/api-client-react", () => ({
  getDatasets: (...args: unknown[]) => getDatasetsMock(...args),
}));

vi.mock("@/components/ui/toast", () => ({
  ToastAction: (props: Record<string, unknown>) =>
    React.createElement("button", props),
}));

import {
  distanceToBboxKm,
  findDatasetForPosition,
  handleFollowOutOfBounds,
  acceptFollowHandoff,
  __resetHandoffForTests,
} from "@/lib/datasetHandoff";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";

// bbox matches the API shape: { minLon, minLat, maxLon, maxLat }
const DATASETS = [
  { id: "ds-near", name: "Nearby Bay", bbox: { minLon: 142, minLat: 11, maxLon: 143, maxLat: 12 } },
  { id: "ds-far", name: "Farther Shelf", bbox: { minLon: 150, minLat: 20, maxLon: 151, maxLat: 21 } },
];

describe("distanceToBboxKm", () => {
  it("returns 0 for a point inside the bbox", () => {
    expect(distanceToBboxKm(142.5, 11.5, { minLon: 142, minLat: 11, maxLon: 143, maxLat: 12 })).toBe(0);
  });

  it("returns ~11 km for a point 0.1° of latitude south of the bbox", () => {
    const d = distanceToBboxKm(142.5, 10.9, { minLon: 142, minLat: 11, maxLon: 143, maxLat: 12 });
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(12.5);
  });

  it("shrinks longitude distance at high latitude", () => {
    const equator = distanceToBboxKm(1, 0, { minLon: 0, minLat: -1, maxLon: 0.5, maxLat: 1 });
    const arctic = distanceToBboxKm(1, 70, { minLon: 0, minLat: 69, maxLon: 0.5, maxLat: 71 });
    expect(arctic).toBeLessThan(equator);
  });
});

describe("datasetHandoff", () => {
  beforeEach(() => {
    toastSpy.mockClear();
    getDatasetsMock.mockReset();
    __resetHandoffForTests();
    useTerrainStore.setState({ visibleDatasets: [] });
    useUiStore.setState({ pendingFollowHandoff: null });
  });

  it("findDatasetForPosition returns the dataset covering the position", async () => {
    getDatasetsMock.mockResolvedValue(DATASETS);
    const hit = await findDatasetForPosition(142.5, 11.4);
    expect(hit).toEqual({ id: "ds-near", title: "Nearby Bay" });
  });

  it("returns a nearby (within 25 km) dataset when none covers the point", async () => {
    getDatasetsMock.mockResolvedValue(DATASETS);
    // ~0.1° of latitude (~11 km) south of ds-near's bbox.
    const hit = await findDatasetForPosition(142.5, 10.9);
    expect(hit).toEqual({ id: "ds-near", title: "Nearby Bay" });
  });

  it("excludes datasets that are already visible", async () => {
    getDatasetsMock.mockResolvedValue(DATASETS);
    useTerrainStore.setState({
      visibleDatasets: [{ datasetId: "ds-near" } as never],
    });
    const hit = await findDatasetForPosition(142.5, 11.4);
    expect(hit).toBeNull();
  });

  it("returns null when nothing is within the search radius", async () => {
    getDatasetsMock.mockResolvedValue(DATASETS);
    expect(await findDatasetForPosition(-120, -45)).toBeNull();
  });

  it("returns null when the request fails (offline)", async () => {
    getDatasetsMock.mockRejectedValue(new TypeError("failed to fetch"));
    expect(await findDatasetForPosition(142.5, 11.4)).toBeNull();
  });

  it("shows the suggestion toast with a Load & follow action when found", async () => {
    getDatasetsMock.mockResolvedValue(DATASETS);
    await handleFollowOutOfBounds(142.5, 11.4);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    const arg = toastSpy.mock.calls[0]![0] as {
      title: string;
      description: string;
      action: React.ReactElement;
    };
    expect(arg.title).toBe("Left dataset area");
    expect(arg.description).toContain("Nearby Bay");
    expect(arg.action).toBeTruthy();

    // Clicking the action requests the handoff via uiStore.
    const actionProps = arg.action.props as { onClick: () => void };
    actionProps.onClick();
    expect(useUiStore.getState().pendingFollowHandoff).toBe("ds-near");
  });

  it("falls back to the plain pause toast when nothing is found", async () => {
    getDatasetsMock.mockResolvedValue([]);
    await handleFollowOutOfBounds(0, 0);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Follow mode paused" }),
    );
  });

  it("falls back to the pause toast when the search errors", async () => {
    getDatasetsMock.mockRejectedValue(new Error("500"));
    await handleFollowOutOfBounds(0, 0);

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Follow mode paused" }),
    );
  });

  it("dedupes concurrent out-of-bounds calls while a search is in flight", async () => {
    let resolveQuery!: (v: unknown) => void;
    getDatasetsMock.mockReturnValue(new Promise((r) => (resolveQuery = r)));

    const first = handleFollowOutOfBounds(0, 0);
    const second = handleFollowOutOfBounds(0, 0);
    resolveQuery([]);
    await Promise.all([first, second]);

    expect(getDatasetsMock).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it("acceptFollowHandoff sets pendingFollowHandoff", () => {
    acceptFollowHandoff("ds-x");
    expect(useUiStore.getState().pendingFollowHandoff).toBe("ds-x");
  });
});
