import { describe, it, expect } from "vitest";
import {
  buildLibraryTree,
  isDescendantOf,
  descendantFolderIds,
  suggestUniqueName,
} from "../datasetLibrary";
import type { DatasetFolder, UserDatasetMeta } from "@workspace/api-client-react";

const folder = (id: string, name: string, parentId: string | null = null): DatasetFolder => ({
  id,
  name,
  parentId,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
});

const ds = (id: string, name: string, folderId: string | null = null): UserDatasetMeta => ({
  id,
  name,
  minDepth: 0,
  maxDepth: 100,
  folderId,
  createdAt: "2024-01-01T00:00:00Z",
});

describe("buildLibraryTree", () => {
  it("nests folders by parentId and places datasets in folders or root", () => {
    const tree = buildLibraryTree(
      [folder("a", "A"), folder("b", "B", "a"), folder("c", "C")],
      [ds("d1", "ds1", "b"), ds("d2", "ds2", null), ds("d3", "ds3", "a")],
    );

    expect(tree.roots.map((r) => r.folder.name)).toEqual(["A", "C"]);
    const a = tree.byId.get("a")!;
    expect(a.children.map((c) => c.folder.name)).toEqual(["B"]);
    expect(a.datasets.map((d) => d.id)).toEqual(["d3"]);
    expect(tree.byId.get("b")!.datasets.map((d) => d.id)).toEqual(["d1"]);
    expect(tree.rootDatasets.map((d) => d.id)).toEqual(["d2"]);
  });

  it("treats unknown folderId as root", () => {
    const tree = buildLibraryTree([], [ds("d1", "n", "ghost")]);
    expect(tree.rootDatasets.map((d) => d.id)).toEqual(["d1"]);
  });

  it("does not throw when a folder or dataset is missing a name", () => {
    const badFolder = { ...folder("a", "A"), name: undefined as unknown as string };
    const badDataset = { ...ds("d1", "d1"), name: undefined as unknown as string };
    expect(() =>
      buildLibraryTree(
        [badFolder, folder("b", "B")],
        [badDataset, ds("d2", "d2")],
      ),
    ).not.toThrow();
  });

  it("assigns increasing depth", () => {
    const tree = buildLibraryTree(
      [folder("a", "A"), folder("b", "B", "a"), folder("c", "C", "b")],
      [],
    );
    expect(tree.byId.get("a")!.depth).toBe(0);
    expect(tree.byId.get("b")!.depth).toBe(1);
    expect(tree.byId.get("c")!.depth).toBe(2);
  });
});

describe("isDescendantOf (cycle prevention)", () => {
  const tree = buildLibraryTree(
    [folder("a", "A"), folder("b", "B", "a"), folder("c", "C", "b")],
    [],
  );

  it("flags a folder being moved into itself", () => {
    expect(isDescendantOf(tree.byId, "a", "a")).toBe(true);
  });

  it("flags a folder being moved into a descendant", () => {
    expect(isDescendantOf(tree.byId, "a", "c")).toBe(true);
  });

  it("permits unrelated targets", () => {
    const t2 = buildLibraryTree(
      [folder("a", "A"), folder("x", "X"), folder("b", "B", "a")],
      [],
    );
    expect(isDescendantOf(t2.byId, "a", "x")).toBe(false);
  });
});

describe("descendantFolderIds", () => {
  it("includes the root and all descendants", () => {
    const tree = buildLibraryTree(
      [folder("a", "A"), folder("b", "B", "a"), folder("c", "C", "b")],
      [],
    );
    expect([...descendantFolderIds(tree.byId, "a")].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("suggestUniqueName", () => {
  it("returns base when unused", () => {
    expect(suggestUniqueName([], "New folder")).toBe("New folder");
  });
  it("appends 2, 3 ... when collisions exist (case-insensitive)", () => {
    expect(
      suggestUniqueName([{ name: "new folder" }, { name: "New Folder 2" }], "New folder"),
    ).toBe("New folder 3");
  });
});
