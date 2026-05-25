/**
 * folders.test.ts — Unit tests for the pure helpers behind /user/folders.
 *
 * Covers:
 *  - collectDescendantIds: cycle-detection helper used by move + duplicate.
 *  - siblingNameTaken: case-insensitive sibling-name uniqueness check used by
 *    create / rename / move.
 *
 * These are the algorithmic cores of the cycle-rejection and
 * sibling-name-uniqueness guards. Ownership/auth and the full request
 * lifecycle are covered separately by the dataset-folders Playwright spec
 * (which talks to the live api-server via E2E_AUTH_BYPASS).
 */
import { describe, it, expect } from "vitest";
import { collectDescendantIds, siblingNameTaken } from "../routes/folders.js";

type Row = {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

const now = new Date("2026-01-01T00:00:00Z");

function mkRow(id: string, parentId: string | null, name: string): Row {
  return { id, userId: "u1", parentId, name, createdAt: now, updatedAt: now };
}

describe("collectDescendantIds", () => {
  it("returns just the root for a leaf folder", () => {
    const rows = [mkRow("a", null, "A"), mkRow("b", null, "B")];
    const out = collectDescendantIds(rows, "a");
    expect(Array.from(out).sort()).toEqual(["a"]);
  });

  it("collects nested descendants transitively", () => {
    // a -> b -> c, a -> d
    const rows = [
      mkRow("a", null, "A"),
      mkRow("b", "a", "B"),
      mkRow("c", "b", "C"),
      mkRow("d", "a", "D"),
      mkRow("z", null, "Z"),
    ];
    const out = collectDescendantIds(rows, "a");
    expect(Array.from(out).sort()).toEqual(["a", "b", "c", "d"]);
    expect(out.has("z")).toBe(false);
  });

  it("blocks cycle detection: moving a folder into one of its descendants is rejectable", () => {
    const rows = [
      mkRow("a", null, "A"),
      mkRow("b", "a", "B"),
      mkRow("c", "b", "C"),
    ];
    const descendantsOfA = collectDescendantIds(rows, "a");
    // Attempting to move "a" under "c" would be a cycle — c is a descendant.
    expect(descendantsOfA.has("c")).toBe(true);
    // Moving "a" under unrelated root would not be (no such row, but check the set).
    expect(descendantsOfA.has("zzz")).toBe(false);
  });
});

describe("siblingNameTaken", () => {
  const rows = [
    mkRow("a", null, "Reefs"),
    mkRow("b", null, "Wrecks"),
    mkRow("c", "a", "Inner"),
    mkRow("d", "a", "Outer"),
  ];

  it("returns false when no sibling shares the name", () => {
    expect(siblingNameTaken(rows, null, "New")).toBe(false);
    expect(siblingNameTaken(rows, "a", "Deep")).toBe(false);
  });

  it("returns true for an exact-case sibling name match", () => {
    expect(siblingNameTaken(rows, null, "Reefs")).toBe(true);
    expect(siblingNameTaken(rows, "a", "Inner")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(siblingNameTaken(rows, null, "reefs")).toBe(true);
    expect(siblingNameTaken(rows, null, "REEFS")).toBe(true);
    expect(siblingNameTaken(rows, "a", "iNnEr")).toBe(true);
  });

  it("scopes by parentId — same name under different parents is allowed", () => {
    // "Inner" exists under "a", not under root or under "b".
    expect(siblingNameTaken(rows, null, "Inner")).toBe(false);
    expect(siblingNameTaken(rows, "b", "Inner")).toBe(false);
  });

  it("ignores the exceptId row (used during rename)", () => {
    // Renaming row "c" to its own name must not trigger duplicate-name.
    expect(siblingNameTaken(rows, "a", "Inner", "c")).toBe(false);
    // But renaming row "c" to "Outer" (sibling) should still collide.
    expect(siblingNameTaken(rows, "a", "Outer", "c")).toBe(true);
  });
});
