/**
 * puzzleSnap.ts — pure snap-to-neighbor geometry for puzzle mode.
 *
 * While dragging a tile, if one of its (axis-aligned) edges comes within
 * `threshold` canvas pixels of a facing neighbor edge, the drag delta is
 * adjusted so the edges sit flush. X and Y axes snap independently.
 *
 * Only unrotated tiles participate (a rotated tile's bbox edges are no longer
 * axis-aligned, so "flush" is ill-defined); callers filter those out.
 */

export interface SnapRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A snapped edge segment, used to draw the green confirmation flash. */
export interface SnapEdgeSeg {
  /** "v" = vertical edge (fixed x), "h" = horizontal edge (fixed y). */
  axis: "v" | "h";
  /** Canvas position of the edge (x for "v", y for "h"). */
  pos: number;
  /** Span of the segment along the other axis. */
  from: number;
  to: number;
}

export interface SnapResult {
  /** Additional translation to apply on top of the candidate position. */
  dx: number;
  dy: number;
  /** Edge segments that snapped (empty = no snap). */
  edges: SnapEdgeSeg[];
}

/** Default snap threshold in canvas pixels (per task spec). */
export const SNAP_THRESHOLD_PX = 12;

/** 1-D interval overlap length between [a0,a1] and [b0,b1]. */
function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

/**
 * Compute the snap adjustment for a moving rect against neighbor rects.
 *
 * Facing-edge pairs considered per neighbor:
 *   moving.left  ↔ neighbor.right   (tile slides right to touch)
 *   moving.right ↔ neighbor.left
 *   moving.top   ↔ neighbor.bottom
 *   moving.bottom↔ neighbor.top
 *
 * An edge pair is only eligible when the rects overlap (or nearly overlap,
 * within `threshold`) on the perpendicular axis — this prevents a tile far
 * above a neighbor from snapping to its horizontal position.
 */
export function computeSnapAdjustment(
  moving: SnapRect,
  neighbors: readonly SnapRect[],
  threshold: number = SNAP_THRESHOLD_PX,
): SnapResult {
  let bestDx: number | null = null;
  let bestDy: number | null = null;
  let bestDxSeg: SnapEdgeSeg | null = null;
  let bestDySeg: SnapEdgeSeg | null = null;

  for (const n of neighbors) {
    // Perpendicular proximity gates.
    const vOverlap = overlap1d(moving.top, moving.bottom, n.top, n.bottom);
    const hOverlap = overlap1d(moving.left, moving.right, n.left, n.right);

    if (vOverlap > -threshold) {
      // Horizontal snap candidates (vertical edges).
      const candidates: Array<{ delta: number; x: number }> = [
        { delta: n.right - moving.left, x: n.right }, // moving.left → n.right
        { delta: n.left - moving.right, x: n.left },  // moving.right → n.left
      ];
      for (const c of candidates) {
        if (Math.abs(c.delta) <= threshold && (bestDx === null || Math.abs(c.delta) < Math.abs(bestDx))) {
          bestDx = c.delta;
          bestDxSeg = {
            axis: "v",
            pos: c.x,
            from: Math.max(moving.top, n.top),
            to: Math.min(moving.bottom, n.bottom),
          };
        }
      }
    }

    if (hOverlap > -threshold) {
      // Vertical snap candidates (horizontal edges).
      const candidates: Array<{ delta: number; y: number }> = [
        { delta: n.bottom - moving.top, y: n.bottom }, // moving.top → n.bottom
        { delta: n.top - moving.bottom, y: n.top },    // moving.bottom → n.top
      ];
      for (const c of candidates) {
        if (Math.abs(c.delta) <= threshold && (bestDy === null || Math.abs(c.delta) < Math.abs(bestDy))) {
          bestDy = c.delta;
          bestDySeg = {
            axis: "h",
            pos: c.y,
            from: Math.max(moving.left, n.left),
            to: Math.min(moving.right, n.right),
          };
        }
      }
    }
  }

  const edges: SnapEdgeSeg[] = [];
  if (bestDxSeg) {
    // Recompute span with the snapped position applied on the other axis.
    edges.push(bestDxSeg);
  }
  if (bestDySeg) edges.push(bestDySeg);

  return { dx: bestDx ?? 0, dy: bestDy ?? 0, edges };
}
