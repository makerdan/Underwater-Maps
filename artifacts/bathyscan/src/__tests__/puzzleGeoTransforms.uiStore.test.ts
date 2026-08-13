/**
 * puzzleGeoTransforms.uiStore.test.ts
 *
 * Unit tests for the puzzleGeoTransforms field added to uiStore:
 * set → read → clear round-trip.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "@/lib/uiStore";

describe("uiStore — puzzleGeoTransforms field", () => {
  beforeEach(() => {
    // Reset to empty map before each test.
    useUiStore.getState().clearPuzzleGeoTransforms();
  });

  it("starts as an empty Map", () => {
    const transforms = useUiStore.getState().puzzleGeoTransforms;
    expect(transforms).toBeInstanceOf(Map);
    expect(transforms.size).toBe(0);
  });

  it("setPuzzleGeoTransforms stores the provided map and reads it back", () => {
    const input = new Map([
      ["ds-1", { dLon: 0.1, dLat: -0.05, angleDeg: 15 }],
      ["ds-2", { dLon: -0.2, dLat: 0.3, angleDeg: 0 }],
    ]);
    useUiStore.getState().setPuzzleGeoTransforms(input);

    const result = useUiStore.getState().puzzleGeoTransforms;
    expect(result.size).toBe(2);
    expect(result.get("ds-1")).toEqual({ dLon: 0.1, dLat: -0.05, angleDeg: 15 });
    expect(result.get("ds-2")).toEqual({ dLon: -0.2, dLat: 0.3, angleDeg: 0 });
  });

  it("clearPuzzleGeoTransforms resets the map to empty", () => {
    useUiStore.getState().setPuzzleGeoTransforms(
      new Map([["ds-1", { dLon: 0.5, dLat: 0.1, angleDeg: 30 }]]),
    );
    expect(useUiStore.getState().puzzleGeoTransforms.size).toBe(1);

    useUiStore.getState().clearPuzzleGeoTransforms();
    expect(useUiStore.getState().puzzleGeoTransforms.size).toBe(0);
  });

  it("calling setPuzzleGeoTransforms with an empty map leaves the store with an empty map", () => {
    useUiStore.getState().setPuzzleGeoTransforms(new Map());
    expect(useUiStore.getState().puzzleGeoTransforms.size).toBe(0);
  });

  it("subsequent setPuzzleGeoTransforms calls replace the previous map entirely", () => {
    useUiStore.getState().setPuzzleGeoTransforms(
      new Map([["old-ds", { dLon: 1, dLat: 1, angleDeg: 45 }]]),
    );
    useUiStore.getState().setPuzzleGeoTransforms(
      new Map([["new-ds", { dLon: 0, dLat: 0, angleDeg: 0 }]]),
    );

    const result = useUiStore.getState().puzzleGeoTransforms;
    expect(result.size).toBe(1);
    expect(result.has("old-ds")).toBe(false);
    expect(result.has("new-ds")).toBe(true);
  });
});
