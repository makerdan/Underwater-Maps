/**
 * puzzleRestore.ts — pure builder that converts a server layout revision
 * (tiles + groups) into the full puzzle state OverviewMap needs.
 *
 * The whole restored state is built as ONE object so callers can commit every
 * piece (canvas transform Map, group Map, and the puzzleStore mirror record)
 * in a single batch — a partial apply (canvas updated but store stale, or
 * vice versa) is impossible because both views are derived from the same
 * objects here.
 *
 * Note on flips: the server LayoutTile schema intentionally carries no
 * flipH/flipV — flips are session-local visual aids. Restored tiles always
 * come back unflipped.
 */
import type { PuzzleTransform } from "./puzzleStore";

export interface RestoreTile {
  datasetId: string;
  tx: number;
  ty: number;
  angleDeg: number;
  locked?: boolean;
  annotation?: string | null;
}

export interface RestorePayload {
  tiles: RestoreTile[];
  /** Each inner array is a set of datasetIds that move together. */
  groups: string[][];
  /** Effective canvas pixels per geographic degree when the layout was saved. */
  pixelDensity?: number;
}

export interface RestoredPuzzleState {
  /** Canvas-side transform map (OverviewMap internal state). */
  transforms: Map<string, PuzzleTransform>;
  /** Group map keyed by generated `group-N` ids. */
  groups: Map<string, Set<string>>;
  /** Value the group counter must be advanced to after applying. */
  groupCounterEnd: number;
  /**
   * puzzleStore mirror record — same transform objects as `transforms`, so
   * the two views can never disagree.
   */
  storeRecord: Record<string, PuzzleTransform>;
}

/**
 * Build restored puzzle state from a revision payload.
 *
 * Tiles whose dataset is not currently loaded (`aliveIds`) are skipped, and
 * groups keep only alive members (dropped entirely below 2 members).
 */
export function buildRestoredPuzzleState(
  payload: RestorePayload,
  aliveIds: ReadonlySet<string>,
  groupCounterStart: number,
): RestoredPuzzleState {
  const transforms = new Map<string, PuzzleTransform>();
  const storeRecord: Record<string, PuzzleTransform> = {};

  for (const tile of payload.tiles) {
    if (!aliveIds.has(tile.datasetId)) continue;
    const xf: PuzzleTransform = {
      tx: tile.tx,
      ty: tile.ty,
      angleDeg: tile.angleDeg,
      flipH: false,
      flipV: false,
      ...(tile.locked ? { locked: true } : {}),
      ...(tile.annotation ? { annotation: tile.annotation.slice(0, 40) } : {}),
    };
    transforms.set(tile.datasetId, xf);
    storeRecord[tile.datasetId] = xf;
  }

  const groups = new Map<string, Set<string>>();
  let counter = groupCounterStart;
  for (const memberIds of payload.groups) {
    const alive = memberIds.filter((id) => aliveIds.has(id));
    if (alive.length >= 2) {
      groups.set(`group-${++counter}`, new Set(alive));
    }
  }

  return { transforms, groups, groupCounterEnd: counter, storeRecord };
}

/**
 * Apply a drag translation to every selected tile, skipping locked tiles.
 * Pure so the lock-blocks-drag rule is unit-testable.
 */
export function applyDragTranslation(
  prev: Map<string, PuzzleTransform>,
  startTransforms: Map<string, PuzzleTransform>,
  dx: number,
  dy: number,
): Map<string, PuzzleTransform> {
  const next = new Map(prev);
  for (const [id, startXf] of startTransforms) {
    if (startXf.locked) continue; // locked tiles never move
    const existing = prev.get(id);
    next.set(id, {
      ...(existing ?? { tx: 0, ty: 0, angleDeg: startXf.angleDeg, flipH: false, flipV: false }),
      tx: startXf.tx + dx,
      ty: startXf.ty + dy,
    });
  }
  return next;
}
