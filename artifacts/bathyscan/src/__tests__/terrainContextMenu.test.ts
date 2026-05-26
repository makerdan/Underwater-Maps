import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import { useCameraStore } from "@/lib/cameraStore";
import { useContextMenuStore } from "@/lib/contextMenuStore";
import { useMeasureStore } from "@/lib/measureStore";
import { useDepthProfileStore } from "@/lib/depthProfileStore";
import {
  buildTerrainMenuItems,
  openCrosshairContextMenu,
} from "@/lib/terrainContextMenu";

function fakeGrid(): TerrainData {
  return {
    datasetId: "ds-1",
    resolution: 2,
    depths: [0, 0, 0, 0],
    minDepth: 0,
    maxDepth: 10,
    minLon: -1,
    maxLon: 1,
    minLat: -1,
    maxLat: 1,
    waterType: "saltwater",
  } as unknown as TerrainData;
}

describe("openCrosshairContextMenu", () => {
  beforeEach(() => {
    useCameraStore.setState({ crosshairGps: null, lastClickedGps: null });
    useContextMenuStore.setState({ open: false, x: 0, y: 0, items: [] });
    useMeasureStore.setState({ anchorGps: null, result: null });
    useDepthProfileStore.setState({
      anchor: null,
      profile: null,
      hoverIndex: null,
    });
  });

  it("opens the terrain action menu at the crosshair when locked in fly mode", () => {
    const grid = fakeGrid();
    useCameraStore
      .getState()
      .setCrosshairGps({ lon: -122.5, lat: 47.6, depth: 42 });
    const exitPointerLock = vi.fn();

    const opened = openCrosshairContextMenu({
      centerX: 640,
      centerY: 360,
      getTerrainGrid: () => grid,
      exitPointerLock,
    });

    expect(opened).toBe(true);
    expect(exitPointerLock).toHaveBeenCalledTimes(1);
    const menu = useContextMenuStore.getState();
    expect(menu.open).toBe(true);
    expect(menu.x).toBe(640);
    expect(menu.y).toBe(360);
    const labels = menu.items.map((i) => i.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Drop GPS pin here",
        "Measure from here",
        "Set as home position",
        "Start depth profile here",
        "Copy coordinates",
      ]),
    );
  });

  it("is a no-op when the crosshair has no terrain target", () => {
    const exitPointerLock = vi.fn();
    const opened = openCrosshairContextMenu({
      centerX: 640,
      centerY: 360,
      getTerrainGrid: () => fakeGrid(),
      exitPointerLock,
    });

    expect(opened).toBe(false);
    expect(exitPointerLock).not.toHaveBeenCalled();
    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it("is a no-op when no terrain dataset is loaded", () => {
    useCameraStore
      .getState()
      .setCrosshairGps({ lon: -122.5, lat: 47.6, depth: 42 });

    const opened = openCrosshairContextMenu({
      centerX: 0,
      centerY: 0,
      getTerrainGrid: () => null,
    });

    expect(opened).toBe(false);
    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it("Drop GPS pin item pre-fills the marker form with the crosshair coords", () => {
    const items = buildTerrainMenuItems(
      -122.5,
      47.6,
      42,
      "ds-1",
      () => fakeGrid(),
    );
    const drop = items.find((i) => i.label === "Drop GPS pin here");
    expect(drop).toBeDefined();
    drop!.onClick();
    expect(useCameraStore.getState().lastClickedGps).toEqual({
      lon: -122.5,
      lat: 47.6,
      depth: 42,
    });
  });
});
