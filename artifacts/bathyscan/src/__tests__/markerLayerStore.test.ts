/**
 * markerLayerStore unit tests — verifies that setSubsampleState and clear
 * publish correct subsampling flags to the HUD badge bridge store.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useMarkerLayerStore } from "@/lib/markerLayerStore";

function resetStore() {
  useMarkerLayerStore.getState().clear();
}

describe("markerLayerStore", () => {
  beforeEach(() => resetStore());

  it("starts with all counts at zero and isSubsampled false", () => {
    const s = useMarkerLayerStore.getState();
    expect(s.totalVisible).toBe(0);
    expect(s.renderedCount).toBe(0);
    expect(s.isSubsampled).toBe(false);
  });

  it("setSubsampleState: isSubsampled is true when rendered < total", () => {
    useMarkerLayerStore.getState().setSubsampleState(200, 50);
    const s = useMarkerLayerStore.getState();
    expect(s.totalVisible).toBe(200);
    expect(s.renderedCount).toBe(50);
    expect(s.isSubsampled).toBe(true);
  });

  it("setSubsampleState: isSubsampled is false when rendered equals total", () => {
    useMarkerLayerStore.getState().setSubsampleState(80, 80);
    const s = useMarkerLayerStore.getState();
    expect(s.totalVisible).toBe(80);
    expect(s.renderedCount).toBe(80);
    expect(s.isSubsampled).toBe(false);
  });

  it("setSubsampleState: isSubsampled is false when rendered > total (edge case)", () => {
    useMarkerLayerStore.getState().setSubsampleState(10, 15);
    const s = useMarkerLayerStore.getState();
    expect(s.isSubsampled).toBe(false);
  });

  it("clear: resets all counts and isSubsampled to zero/false", () => {
    useMarkerLayerStore.getState().setSubsampleState(500, 100);
    expect(useMarkerLayerStore.getState().isSubsampled).toBe(true);

    useMarkerLayerStore.getState().clear();
    const s = useMarkerLayerStore.getState();
    expect(s.totalVisible).toBe(0);
    expect(s.renderedCount).toBe(0);
    expect(s.isSubsampled).toBe(false);
  });
});
