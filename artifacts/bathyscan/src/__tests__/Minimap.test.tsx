import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Minimap } from "@/components/Minimap";
import { useUiStore } from "@/lib/uiStore";
import { WORLD_SIZE } from "@/lib/terrain";

const mockTerrain = {
  datasetId: "test-ds",
  resolution: 4,
  width: 4,
  height: 4,
  depths: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160],
  minDepth: 10,
  maxDepth: 160,
  minLon: -120,
  maxLon: -119,
  minLat: 47,
  maxLat: 48,
  waterType: "saltwater" as const,
};

let terrain: typeof mockTerrain | null = mockTerrain;

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMarkers: () => ({ data: [] }),
  getGetMarkersQueryKey: (p: unknown) => ["markers", p],
}));

describe("Minimap", () => {
  beforeEach(() => {
    terrain = mockTerrain;
    useUiStore.setState({ pendingDropIn: null, overviewOpen: false });
  });

  it("renders nothing when terrain is null", () => {
    terrain = null;
    const { container } = render(<Minimap />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a canvas when terrain is loaded", () => {
    const { container } = render(<Minimap />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.width).toBe(180);
    expect(canvas?.height).toBe(180);
  });

  it("click on minimap canvas fires setPendingDropIn with world coords", () => {
    const { container } = render(<Minimap />);
    const canvas = container.querySelector("canvas")!;

    // Mock getBoundingClientRect → 180x180 at origin
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 180, bottom: 180, width: 180, height: 180, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    fireEvent.click(canvas, { clientX: 90, clientY: 90 });

    const pending = useUiStore.getState().pendingDropIn;
    expect(pending).not.toBeNull();
    // Centre click → (0, 0) in world coords (worldX = 90/180 * WORLD_SIZE - WORLD_SIZE/2)
    expect(pending!.worldX).toBeCloseTo(0, 5);
    expect(pending!.worldZ).toBeCloseTo(0, 5);

    // Click at (0,0) corner → -WORLD_SIZE/2, -WORLD_SIZE/2
    fireEvent.click(canvas, { clientX: 0, clientY: 0 });
    expect(useUiStore.getState().pendingDropIn!.worldX).toBeCloseTo(-WORLD_SIZE / 2, 5);
    expect(useUiStore.getState().pendingDropIn!.worldZ).toBeCloseTo(-WORLD_SIZE / 2, 5);
  });

  it("OVERVIEW button opens overview", () => {
    const { getByText } = render(<Minimap />);
    fireEvent.click(getByText(/OVERVIEW/));
    expect(useUiStore.getState().overviewOpen).toBe(true);
  });
});
