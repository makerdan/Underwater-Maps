/**
 * Unit tests for puzzleSnap — snap-to-neighbor geometry used while dragging
 * puzzle tiles on the Overview canvas.
 *
 * Coverage:
 *   1. Edge within threshold snaps flush (both directions, both axes).
 *   2. Edge beyond threshold does not snap.
 *   3. Exact-threshold distance still snaps (inclusive comparison).
 *   4. Perpendicular gate: a neighbor far away on the other axis never snaps.
 *   5. X and Y snap independently (corner case snaps both).
 *   6. Nearest candidate wins across multiple neighbors.
 *   7. Snapped edge segments describe the touching edge (for the green flash).
 */
import { describe, it, expect } from "vitest";
import {
  computeSnapAdjustment,
  SNAP_THRESHOLD_PX,
  type SnapRect,
} from "../puzzleSnap";

const rect = (left: number, top: number, right: number, bottom: number): SnapRect => ({
  left,
  top,
  right,
  bottom,
});

describe("computeSnapAdjustment — horizontal snapping", () => {
  it("snaps moving.left onto neighbor.right when within threshold", () => {
    // Neighbor occupies x 0..50; moving tile's left edge is at 52 (2 px gap).
    const moving = rect(52, 0, 92, 40);
    const neighbor = rect(0, 0, 50, 40);
    const res = computeSnapAdjustment(moving, [neighbor]);
    expect(res.dx).toBe(-2); // slide left so 52 → 50
    expect(res.dy).toBe(0);
    expect(res.edges).toHaveLength(1);
  });

  it("snaps moving.right onto neighbor.left (approaching from the left)", () => {
    const moving = rect(0, 0, 47, 40); // right edge 47, neighbor left edge 50
    const neighbor = rect(50, 0, 100, 40);
    const res = computeSnapAdjustment(moving, [neighbor]);
    expect(res.dx).toBe(3); // slide right so 47 → 50
    expect(res.dy).toBe(0);
  });

  it("does not snap when the gap exceeds the threshold", () => {
    const moving = rect(50 + SNAP_THRESHOLD_PX + 1, 0, 100, 40);
    const neighbor = rect(0, 0, 50, 40);
    const res = computeSnapAdjustment(moving, [neighbor]);
    expect(res.dx).toBe(0);
    expect(res.edges).toHaveLength(0);
  });

  it("snaps at exactly the threshold distance (inclusive)", () => {
    const moving = rect(50 + SNAP_THRESHOLD_PX, 0, 100, 40);
    const neighbor = rect(0, 0, 50, 40);
    const res = computeSnapAdjustment(moving, [neighbor]);
    expect(res.dx).toBe(-SNAP_THRESHOLD_PX);
  });
});

describe("computeSnapAdjustment — vertical snapping", () => {
  it("snaps moving.top onto neighbor.bottom", () => {
    const moving = rect(0, 44, 40, 84); // top edge 44, neighbor bottom 40
    const neighbor = rect(0, 0, 40, 40);
    const res = computeSnapAdjustment(moving, [neighbor]);
    expect(res.dy).toBe(-4);
    expect(res.dx).toBe(0);
  });

  it("snaps moving.bottom onto neighbor.top", () => {
    const moving = rect(0, 0, 40, 37); // bottom 37, neighbor top 40
    const neighbor = rect(0, 40, 40, 80);
    const res = computeSnapAdjustment(moving, [neighbor]);
    expect(res.dy).toBe(3);
  });
});

describe("computeSnapAdjustment — perpendicular proximity gate", () => {
  it("never snaps horizontally to a neighbor far above", () => {
    // Same x alignment as a snap candidate, but 100 px above — no v overlap.
    const moving = rect(52, 200, 92, 240);
    const neighbor = rect(0, 0, 50, 40);
    const res = computeSnapAdjustment(moving, [neighbor]);
    expect(res.dx).toBe(0);
    expect(res.edges).toHaveLength(0);
  });

  it("nearly-touching perpendicular ranges (within threshold) still snap", () => {
    // Vertical ranges 0..40 and 45..85 have a 5 px gap < threshold.
    const moving = rect(52, 45, 92, 85);
    const neighbor = rect(0, 0, 50, 40);
    const res = computeSnapAdjustment(moving, [neighbor]);
    expect(res.dx).toBe(-2);
  });
});

describe("computeSnapAdjustment — combinations", () => {
  it("snaps X and Y independently at a corner", () => {
    // Neighbor at 0..50 × 0..50; moving tile offset (+3, -2) from flush corner placement.
    const moving = rect(53, 48, 93, 88);
    const neighbor = rect(0, 0, 50, 50);
    const res = computeSnapAdjustment(moving, [neighbor]);
    expect(res.dx).toBe(-3); // left 53 → 50
    expect(res.dy).toBe(2); // top 48 → 50 (bottom-of-neighbor pairing)
    expect(res.edges).toHaveLength(2);
  });

  it("picks the nearest snap among multiple neighbors", () => {
    const moving = rect(52, 0, 92, 40);
    const near = rect(0, 0, 50, 40); // 2 px away
    const far = rect(0, 0, 44, 40); // 8 px away
    const res = computeSnapAdjustment(moving, [far, near]);
    expect(res.dx).toBe(-2);
  });

  it("returns the touching edge segment for the flash", () => {
    const moving = rect(52, 10, 92, 30);
    const neighbor = rect(0, 0, 50, 40);
    const res = computeSnapAdjustment(moving, [neighbor]);
    const seg = res.edges[0]!;
    expect(seg.axis).toBe("v");
    expect(seg.pos).toBe(50); // neighbor's right edge
    // Span is the vertical overlap of the two rects.
    expect(seg.from).toBe(10);
    expect(seg.to).toBe(30);
  });

  it("honours a custom threshold", () => {
    const moving = rect(70, 0, 110, 40); // 20 px gap
    const neighbor = rect(0, 0, 50, 40);
    expect(computeSnapAdjustment(moving, [neighbor], 25).dx).toBe(-20);
    expect(computeSnapAdjustment(moving, [neighbor], 12).dx).toBe(0);
  });

  it("no neighbors → identity adjustment", () => {
    const res = computeSnapAdjustment(rect(0, 0, 10, 10), []);
    expect(res).toEqual({ dx: 0, dy: 0, edges: [] });
  });
});
