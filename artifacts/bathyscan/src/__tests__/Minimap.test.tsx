import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders as render } from "./setup";
import { Minimap, drawArrow } from "@/components/Minimap";
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

    // Click at (0,0) corner → top-left is now North-West in North-up orientation.
    // worldX = -WORLD_SIZE/2 (west edge, unchanged), worldZ = +WORLD_SIZE/2 (north edge, flipped).
    fireEvent.click(canvas, { clientX: 0, clientY: 0 });
    expect(useUiStore.getState().pendingDropIn!.worldX).toBeCloseTo(-WORLD_SIZE / 2, 5);
    expect(useUiStore.getState().pendingDropIn!.worldZ).toBeCloseTo(WORLD_SIZE / 2, 5);
  });

  it("OVERVIEW button opens overview", () => {
    const { getByText } = render(<Minimap />);
    fireEvent.click(getByText(/OVERVIEW/));
    expect(useUiStore.getState().overviewOpen).toBe(true);
  });

  it("renders N, S, E, and W direction labels", () => {
    const { getByText, getByTestId } = render(<Minimap />);
    expect(getByText("N")).toBeTruthy();
    expect(getByText("S")).toBeTruthy();
    expect(getByTestId("minimap-east").textContent).toBe("E");
    expect(getByTestId("minimap-west").textContent).toBe("W");
  });
});

describe("drawArrow cardinal directions", () => {
  function makeCtx() {
    return {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      shadowColor: "",
      shadowBlur: 0,
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;
  }

  // North-up convention: cameraStore heading 180° = North = top of canvas.
  // Arrow rotation formula: (180 - heading) * π/180
  // heading 180 (North) → rotate(0) → arrow points up ✓
  // heading 0  (South) → rotate(π) → arrow points down ✓
  // heading 90 (East)  → rotate(π/2) → arrow points right ✓
  // heading 270 (West) → rotate(-π/2) → arrow points left ✓
  const cases: [string, number][] = [
    ["South (heading 0)", 0],
    ["East (heading 90)", 90],
    ["North (heading 180)", 180],
    ["West (heading 270)", 270],
  ];

  it.each(cases)("rotate is called with (180 - heading) * π/180 for %s", (_label, heading) => {
    const ctx = makeCtx();
    drawArrow(ctx, 0, 0, heading);
    const expected = (180 - heading) * (Math.PI / 180);
    expect(ctx.rotate).toHaveBeenCalledWith(expected);
  });
});
