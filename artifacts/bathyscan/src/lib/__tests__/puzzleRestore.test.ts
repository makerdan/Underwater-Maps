/**
 * Unit tests for puzzleRestore — the pure builder that converts a server
 * layout revision into full puzzle state, plus the lock-aware drag helper.
 *
 * Coverage:
 *   1. buildRestoredPuzzleState maps tiles → transforms with locked/annotation.
 *   2. Atomicity contract: the canvas Map and the puzzleStore mirror record
 *      share the SAME transform objects (partial divergence unrepresentable).
 *   3. Dead datasets are skipped; groups drop dead members / dissolve < 2.
 *   4. Annotation is clamped to 40 chars; flips always restore to false.
 *   5. Group counter advances past generated ids.
 *   6. applyDragTranslation moves unlocked tiles and skips locked ones.
 */
import { describe, it, expect } from "vitest";
import {
  buildRestoredPuzzleState,
  applyDragTranslation,
  type RestorePayload,
} from "../puzzleRestore";
import type { PuzzleTransform } from "../puzzleStore";

const alive = (...ids: string[]) => new Set(ids);

describe("buildRestoredPuzzleState", () => {
  const payload: RestorePayload = {
    tiles: [
      { datasetId: "ds-a", tx: 10, ty: -5, angleDeg: 90, locked: true, annotation: "north shelf" },
      { datasetId: "ds-b", tx: -3, ty: 7, angleDeg: 0 },
    ],
    groups: [["ds-a", "ds-b"]],
  };

  it("restores transforms with locked and annotation fields", () => {
    const res = buildRestoredPuzzleState(payload, alive("ds-a", "ds-b"), 0);
    expect(res.transforms.get("ds-a")).toMatchObject({
      tx: 10,
      ty: -5,
      angleDeg: 90,
      locked: true,
      annotation: "north shelf",
    });
    expect(res.transforms.get("ds-b")).toMatchObject({ tx: -3, ty: 7, angleDeg: 0 });
    expect(res.transforms.get("ds-b")?.locked).toBeUndefined();
  });

  it("REGRESSION GUARD: Map and storeRecord share the same objects — a partial apply cannot diverge", () => {
    const res = buildRestoredPuzzleState(payload, alive("ds-a", "ds-b"), 0);
    // Same object identity: any consumer committing one view has, by
    // construction, committed the other's data too.
    expect(res.storeRecord["ds-a"]).toBe(res.transforms.get("ds-a"));
    expect(res.storeRecord["ds-b"]).toBe(res.transforms.get("ds-b"));
    expect(Object.keys(res.storeRecord).sort()).toEqual([...res.transforms.keys()].sort());
  });

  it("always restores flips as false (server schema carries no flip fields)", () => {
    const res = buildRestoredPuzzleState(payload, alive("ds-a", "ds-b"), 0);
    for (const xf of res.transforms.values()) {
      expect(xf.flipH).toBe(false);
      expect(xf.flipV).toBe(false);
    }
  });

  it("skips tiles whose dataset is no longer loaded", () => {
    const res = buildRestoredPuzzleState(payload, alive("ds-b"), 0);
    expect(res.transforms.has("ds-a")).toBe(false);
    expect(res.transforms.has("ds-b")).toBe(true);
    expect(res.storeRecord["ds-a"]).toBeUndefined();
  });

  it("drops groups that fall below 2 alive members", () => {
    const res = buildRestoredPuzzleState(payload, alive("ds-b"), 0);
    expect(res.groups.size).toBe(0);
  });

  it("keeps groups with ≥ 2 alive members, filtering dead ids", () => {
    const p: RestorePayload = {
      tiles: [
        { datasetId: "a", tx: 0, ty: 0, angleDeg: 0 },
        { datasetId: "b", tx: 0, ty: 0, angleDeg: 0 },
      ],
      groups: [["a", "b", "dead"]],
    };
    const res = buildRestoredPuzzleState(p, alive("a", "b"), 5);
    expect(res.groups.size).toBe(1);
    const members = [...res.groups.values()][0]!;
    expect([...members].sort()).toEqual(["a", "b"]);
    // Counter advanced past the start value; key derived from it.
    expect(res.groupCounterEnd).toBe(6);
    expect([...res.groups.keys()][0]).toBe("group-6");
  });

  it("clamps annotations to 40 characters", () => {
    const long = "x".repeat(80);
    const res = buildRestoredPuzzleState(
      { tiles: [{ datasetId: "a", tx: 0, ty: 0, angleDeg: 0, annotation: long }], groups: [] },
      alive("a"),
      0,
    );
    expect(res.transforms.get("a")?.annotation).toHaveLength(40);
  });

  it("empty payload → empty state, counter unchanged", () => {
    const res = buildRestoredPuzzleState({ tiles: [], groups: [] }, alive(), 3);
    expect(res.transforms.size).toBe(0);
    expect(res.groups.size).toBe(0);
    expect(res.groupCounterEnd).toBe(3);
  });
});

describe("applyDragTranslation — lock blocks drag", () => {
  const xf = (tx: number, ty: number, extra: Partial<PuzzleTransform> = {}): PuzzleTransform => ({
    tx,
    ty,
    angleDeg: 0,
    flipH: false,
    flipV: false,
    ...extra,
  });

  it("moves unlocked tiles by the drag delta", () => {
    const start = new Map([["a", xf(10, 20)]]);
    const next = applyDragTranslation(new Map(start), start, 5, -3);
    expect(next.get("a")).toMatchObject({ tx: 15, ty: 17 });
  });

  it("locked tiles never move", () => {
    const start = new Map([
      ["a", xf(10, 20, { locked: true })],
      ["b", xf(0, 0)],
    ]);
    const next = applyDragTranslation(new Map(start), start, 100, 100);
    expect(next.get("a")).toMatchObject({ tx: 10, ty: 20 }); // unchanged
    expect(next.get("b")).toMatchObject({ tx: 100, ty: 100 });
  });

  it("preserves rotation, flips, and annotation while translating", () => {
    const start = new Map([
      ["a", xf(1, 2, { angleDeg: 270, flipH: true, annotation: "note" })],
    ]);
    const next = applyDragTranslation(new Map(start), start, 4, 4);
    expect(next.get("a")).toMatchObject({
      tx: 5,
      ty: 6,
      angleDeg: 270,
      flipH: true,
      annotation: "note",
    });
  });

  it("does not mutate the previous map", () => {
    const start = new Map([["a", xf(0, 0)]]);
    const prev = new Map(start);
    applyDragTranslation(prev, start, 9, 9);
    expect(prev.get("a")).toMatchObject({ tx: 0, ty: 0 });
  });
});
