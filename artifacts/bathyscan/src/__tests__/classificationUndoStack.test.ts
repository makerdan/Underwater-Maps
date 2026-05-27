/**
 * Unit tests for the paint-undo logic in classificationStore.
 *
 * Covers:
 *   - single undo
 *   - multiple consecutive undos
 *   - undo at empty stack (no-op)
 *   - stack cap at 50 strokes
 *   - hasEdits correctly false after undoing back to the AI baseline
 *   - resetToAi clears the undo stack
 *   - clearPaintUndoStack (Paint Mode toggle-off) clears the stack
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useClassificationStore } from "@/lib/classificationStore";

// Resolution for test grids — small enough to keep tests fast.
const RES = 4; // 4×4 = 16 cells

/** Build a Uint8Array of length RES² filled with a single value. */
function filledMap(value: number): Uint8Array {
  return new Uint8Array(RES * RES).fill(value);
}

/**
 * Seed the store with a known zoneMap and AI baseline so paint actions work.
 * Both zoneMap and aiZoneMap are filled with `baseValue`.
 */
function seedStore(baseValue = 0): void {
  const zoneMap = filledMap(baseValue);
  const aiZoneMap = new Uint8Array(zoneMap);
  useClassificationStore.setState({
    zoneMap,
    aiZoneMap,
    hasEdits: false,
    paintUndoStack: [],
    currentGridHash: "testhash",
    currentSubstrateFp: "00000000",
    loading: false,
    error: null,
    source: "ai",
  });
}

/**
 * Paint a single pixel at (row=0, col=col) with radius 0 using slot 1 (zone 1
 * in saltwater). With radius 0 only cell (0, col) is touched.
 */
function paintCell(col: number): void {
  useClassificationStore.getState().paintSlot(0, col, 0, 1, "saltwater", RES);
}

beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    // jsdom may not have sessionStorage — ignore
  }
  // Reset to a clean baseline state before each test.
  seedStore(0);
});

// ---------------------------------------------------------------------------
// Single undo
// ---------------------------------------------------------------------------

describe("undoPaint — single undo", () => {
  it("restores zoneMap to its pre-paint state after one stroke", () => {
    const before = new Uint8Array(useClassificationStore.getState().zoneMap!);

    paintCell(0);
    expect(useClassificationStore.getState().zoneMap![0]).not.toBe(before[0]);

    useClassificationStore.getState().undoPaint();

    const after = useClassificationStore.getState().zoneMap!;
    expect(Array.from(after)).toEqual(Array.from(before));
  });

  it("empties the stack after undoing the only stroke", () => {
    paintCell(0);
    expect(useClassificationStore.getState().paintUndoStack).toHaveLength(1);

    useClassificationStore.getState().undoPaint();
    expect(useClassificationStore.getState().paintUndoStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple consecutive undos
// ---------------------------------------------------------------------------

describe("undoPaint — multiple consecutive undos", () => {
  it("steps back through each stroke in LIFO order", () => {
    // Paint three distinct cells so each stroke changes a different pixel.
    paintCell(0);
    const afterFirst = new Uint8Array(useClassificationStore.getState().zoneMap!);

    paintCell(1);
    const afterSecond = new Uint8Array(useClassificationStore.getState().zoneMap!);

    paintCell(2);

    expect(useClassificationStore.getState().paintUndoStack).toHaveLength(3);

    // Undo third → back to after-second state
    useClassificationStore.getState().undoPaint();
    expect(Array.from(useClassificationStore.getState().zoneMap!)).toEqual(
      Array.from(afterSecond),
    );

    // Undo second → back to after-first state
    useClassificationStore.getState().undoPaint();
    expect(Array.from(useClassificationStore.getState().zoneMap!)).toEqual(
      Array.from(afterFirst),
    );

    // Undo first → back to original (all zeros)
    useClassificationStore.getState().undoPaint();
    expect(Array.from(useClassificationStore.getState().zoneMap!)).toEqual(
      Array.from(filledMap(0)),
    );

    expect(useClassificationStore.getState().paintUndoStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Undo at empty stack — no-op
// ---------------------------------------------------------------------------

describe("undoPaint — empty stack", () => {
  it("is a no-op when there are no snapshots to restore", () => {
    const mapBefore = new Uint8Array(useClassificationStore.getState().zoneMap!);

    // Stack is empty — calling undoPaint must not change zoneMap or throw.
    expect(() => useClassificationStore.getState().undoPaint()).not.toThrow();

    expect(Array.from(useClassificationStore.getState().zoneMap!)).toEqual(
      Array.from(mapBefore),
    );
    expect(useClassificationStore.getState().paintUndoStack).toHaveLength(0);
  });

  it("does not crash when called multiple times on an empty stack", () => {
    useClassificationStore.getState().undoPaint();
    useClassificationStore.getState().undoPaint();
    expect(useClassificationStore.getState().paintUndoStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stack cap at 50
// ---------------------------------------------------------------------------

describe("undoPaint — stack cap at 50", () => {
  it("never exceeds 50 snapshots regardless of stroke count", () => {
    // Paint 60 strokes — each at col 0 so they all flip the same pixel,
    // which means we need to alternate values. We paint in a pattern that
    // ensures `changed = true` every time: toggle between col 0 (slot 1)
    // and undo to baseline then repaint. Instead just do 60 paints at
    // different RES positions cycling through cols. We use slot 1 every
    // stroke so every even stroke is a no-op for that specific cell once
    // it's already set. To guarantee `changed` each time, reseed zoneMap
    // to all-zeros before each stroke.
    for (let i = 0; i < 60; i++) {
      // Force the map back to zeros so the paint always produces a change.
      const fresh = filledMap(0);
      useClassificationStore.setState({ zoneMap: fresh });
      paintCell(0);
    }

    const { paintUndoStack } = useClassificationStore.getState();
    expect(paintUndoStack.length).toBeLessThanOrEqual(50);
    expect(paintUndoStack.length).toBe(50);
  });

  it("drops the oldest snapshot when the cap is hit, retaining the 50 most-recent ones", () => {
    // Paint 51 strokes. Before each stroke i, stamp cell[1] = i so the
    // snapshot captured for that stroke is uniquely identifiable.
    // After 51 strokes the stack should have exactly 50 entries and the
    // evicted entry (stamp=0) must not appear anywhere in the stack.
    for (let i = 0; i < 51; i++) {
      const fresh = filledMap(0);
      fresh[1] = i; // stamp the pre-stroke map with the stroke index
      useClassificationStore.setState({ zoneMap: fresh });
      paintCell(0); // triggers a snapshot of fresh before changing cell[0]
    }

    const { paintUndoStack } = useClassificationStore.getState();
    expect(paintUndoStack).toHaveLength(50);

    // The snapshot stamped with 0 (the very first one) must have been evicted.
    const hasStamp0 = paintUndoStack.some((snap) => snap[1] === 0);
    expect(hasStamp0).toBe(false);

    // The snapshot stamped with 1 (the second, now oldest retained) must be present.
    const hasStamp1 = paintUndoStack.some((snap) => snap[1] === 1);
    expect(hasStamp1).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasEdits correctly false after undoing to the AI baseline
// ---------------------------------------------------------------------------

describe("undoPaint — hasEdits after undoing to AI baseline", () => {
  it("sets hasEdits to false when the restored map equals aiZoneMap", () => {
    // After seedStore, zoneMap === aiZoneMap (both all-zeros), hasEdits=false.
    paintCell(0);
    expect(useClassificationStore.getState().hasEdits).toBe(true);

    useClassificationStore.getState().undoPaint();

    expect(useClassificationStore.getState().hasEdits).toBe(false);
  });

  it("keeps hasEdits true when the restored map still differs from aiZoneMap", () => {
    // Paint two strokes: after undoing the second, we are back to the
    // state after the first stroke — which still differs from the AI map.
    paintCell(0); // stroke 1
    paintCell(1); // stroke 2

    useClassificationStore.getState().undoPaint(); // undo stroke 2

    // After undoing stroke 2, current map == state after stroke 1 (cell 0
    // is painted, cell 1 is not). aiZoneMap is all-zeros, so hasEdits should
    // still be true.
    expect(useClassificationStore.getState().hasEdits).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resetToAi — clears the undo stack
// ---------------------------------------------------------------------------

describe("resetToAi", () => {
  it("clears the paint undo stack", () => {
    paintCell(0);
    paintCell(1);
    expect(useClassificationStore.getState().paintUndoStack.length).toBeGreaterThan(0);

    useClassificationStore.getState().resetToAi();

    expect(useClassificationStore.getState().paintUndoStack).toHaveLength(0);
  });

  it("restores zoneMap to the AI baseline and sets hasEdits to false", () => {
    const aiBaseline = new Uint8Array(useClassificationStore.getState().aiZoneMap!);

    paintCell(0);
    expect(useClassificationStore.getState().hasEdits).toBe(true);

    useClassificationStore.getState().resetToAi();

    expect(Array.from(useClassificationStore.getState().zoneMap!)).toEqual(
      Array.from(aiBaseline),
    );
    expect(useClassificationStore.getState().hasEdits).toBe(false);
  });

  it("is a no-op when aiZoneMap is null", () => {
    useClassificationStore.setState({ aiZoneMap: null });
    const mapBefore = new Uint8Array(useClassificationStore.getState().zoneMap!);

    expect(() => useClassificationStore.getState().resetToAi()).not.toThrow();

    expect(Array.from(useClassificationStore.getState().zoneMap!)).toEqual(
      Array.from(mapBefore),
    );
  });
});

// ---------------------------------------------------------------------------
// clearPaintUndoStack (Paint Mode toggle-off)
// ---------------------------------------------------------------------------

describe("clearPaintUndoStack", () => {
  it("empties the stack when Paint Mode is toggled off", () => {
    paintCell(0);
    paintCell(1);
    expect(useClassificationStore.getState().paintUndoStack.length).toBeGreaterThan(0);

    useClassificationStore.getState().clearPaintUndoStack();

    expect(useClassificationStore.getState().paintUndoStack).toHaveLength(0);
  });

  it("leaves zoneMap and hasEdits unchanged", () => {
    paintCell(0);
    const mapAfterPaint = new Uint8Array(useClassificationStore.getState().zoneMap!);

    useClassificationStore.getState().clearPaintUndoStack();

    expect(Array.from(useClassificationStore.getState().zoneMap!)).toEqual(
      Array.from(mapAfterPaint),
    );
    expect(useClassificationStore.getState().hasEdits).toBe(true);
  });

  it("is a no-op when the stack is already empty", () => {
    expect(useClassificationStore.getState().paintUndoStack).toHaveLength(0);
    expect(() => useClassificationStore.getState().clearPaintUndoStack()).not.toThrow();
    expect(useClassificationStore.getState().paintUndoStack).toHaveLength(0);
  });
});
