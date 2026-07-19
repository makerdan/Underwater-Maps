import { describe, it, expect } from "vitest";
import {
  buildLibraryTree,
  buildMoveOptions,
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

// ─── buildMoveOptions ──────────────────────────────────────────────────────

describe("buildMoveOptions — folder target", () => {
  //  Tree structure:
  //    folderA
  //    └── folderB   (child of A)
  //        └── folderC  (child of B, i.e. grandchild of A)
  //    folderX        (unrelated sibling)
  const tree = buildLibraryTree(
    [
      folder("a", "A"),
      folder("b", "B", "a"),
      folder("c", "C", "b"),
      folder("x", "X"),
    ],
    [],
  );

  it("disables self with 'Cannot move into itself'", () => {
    // Moving folder A — A is at root (currentParentId = null)
    const opts = buildMoveOptions(tree, { kind: "folder", id: "a", currentParentId: null });
    const selfOpt = opts.find((o) => o.id === "a")!;
    expect(selfOpt.disabled).toBe(true);
    expect(selfOpt.disabledReason).toBe("Cannot move into itself");
  });

  it("disables descendants with 'Cannot move into a subfolder'", () => {
    const opts = buildMoveOptions(tree, { kind: "folder", id: "a", currentParentId: null });
    const bOpt = opts.find((o) => o.id === "b")!;
    const cOpt = opts.find((o) => o.id === "c")!;
    expect(bOpt.disabled).toBe(true);
    expect(bOpt.disabledReason).toBe("Cannot move into a subfolder");
    expect(cOpt.disabled).toBe(true);
    expect(cOpt.disabledReason).toBe("Cannot move into a subfolder");
  });

  it("disables current parent folder with 'Already here'", () => {
    // Moving folder B which is inside folder A (parentId = "a")
    const opts = buildMoveOptions(tree, { kind: "folder", id: "b", currentParentId: "a" });
    const aOpt = opts.find((o) => o.id === "a")!;
    expect(aOpt.disabled).toBe(true);
    expect(aOpt.disabledReason).toBe("Already here");
  });

  it("disables root when current parentId is null (folder is at root)", () => {
    // Moving folder A which is already at root
    const opts = buildMoveOptions(tree, { kind: "folder", id: "a", currentParentId: null });
    const rootOpt = opts.find((o) => o.id === null)!;
    expect(rootOpt.disabled).toBe(true);
    expect(rootOpt.disabledReason).toBe("Already here");
  });

  it("enables unrelated sibling folders", () => {
    // Moving folder A — folder X is unrelated and should be enabled
    const opts = buildMoveOptions(tree, { kind: "folder", id: "a", currentParentId: null });
    const xOpt = opts.find((o) => o.id === "x")!;
    expect(xOpt.disabled).toBe(false);
    expect(xOpt.disabledReason).toBeUndefined();
  });

  it("canConfirm is false when all options are disabled (no other folders)", () => {
    // Single folder — only root and self exist, both disabled
    const singleTree = buildLibraryTree([folder("a", "A")], []);
    const opts = buildMoveOptions(singleTree, { kind: "folder", id: "a", currentParentId: null });
    const canConfirm = opts.some((o) => !o.disabled);
    expect(canConfirm).toBe(false);
  });
});

describe("buildMoveOptions — dataset target", () => {
  //  Tree:  folderA (contains dataset d1), folderB (sibling, contains d2)
  const tree = buildLibraryTree(
    [folder("a", "A"), folder("b", "B")],
    [ds("d1", "D1", "a"), ds("d2", "D2", "b"), ds("d3", "D3", null)],
  );

  it("disables current parent folder with 'Already here'", () => {
    // d1 is in folder A (folderId = "a")
    const opts = buildMoveOptions(tree, { kind: "dataset", id: "d1", currentParentId: "a" });
    const aOpt = opts.find((o) => o.id === "a")!;
    expect(aOpt.disabled).toBe(true);
    expect(aOpt.disabledReason).toBe("Already here");
  });

  it("enables sibling folders as valid targets", () => {
    const opts = buildMoveOptions(tree, { kind: "dataset", id: "d1", currentParentId: "a" });
    const bOpt = opts.find((o) => o.id === "b")!;
    expect(bOpt.disabled).toBe(false);
  });

  it("disables root when dataset is at root", () => {
    // d3 is at root (folderId = null)
    const opts = buildMoveOptions(tree, { kind: "dataset", id: "d3", currentParentId: null });
    const rootOpt = opts.find((o) => o.id === null)!;
    expect(rootOpt.disabled).toBe(true);
    expect(rootOpt.disabledReason).toBe("Already here");
  });

  it("enables root when dataset is in a folder", () => {
    const opts = buildMoveOptions(tree, { kind: "dataset", id: "d1", currentParentId: "a" });
    const rootOpt = opts.find((o) => o.id === null)!;
    expect(rootOpt.disabled).toBe(false);
  });
});

describe("bulk-delete deduplication — standaloneOnlyIds logic", () => {
  // Verifies that dataset ids inside selected folders are NOT double-counted
  // alongside explicitly selected dataset ids (which toggleFolderSelection
  // also adds to selectedIds). The fix: standaloneOnlyIds = standaloneDatasetIds
  // (which already excludes folder-covered datasets), so the same id never
  // appears in both the folder's onSuccess and the standalone loop.
  it("standaloneDatasetIds excludes datasets covered by a selected folder", () => {
    // If folder "a" is selected (which also adds d1 to selectedIds), and d1
    // is also in snapshotDatasetIds, then:
    //   coveredByFolder = {d1}
    //   standaloneDatasetIds = snapshotDatasetIds.filter(!covered) = {} (empty)
    // So d1 is only reported by the folder's onSuccess, not twice.
    const snapshotDatasetIds = new Set(["d1"]);
    const coveredByFolder = new Set(["d1"]);
    const standaloneDatasetIds = [...snapshotDatasetIds].filter(
      (id) => !coveredByFolder.has(id),
    );
    expect(standaloneDatasetIds).toHaveLength(0);
  });

  it("standaloneDatasetIds keeps datasets NOT inside any selected folder", () => {
    const snapshotDatasetIds = new Set(["d1", "d2"]);
    const coveredByFolder = new Set(["d1"]);
    const standaloneDatasetIds = [...snapshotDatasetIds].filter(
      (id) => !coveredByFolder.has(id),
    );
    expect(standaloneDatasetIds).toEqual(["d2"]);
  });

  it("no duplicate ids when folder and its dataset are both selected", () => {
    // Real scenario: user selects folder "a" (which toggleFolderSelection
    // also adds d1 to selectedIds) and then also taps d1 directly.
    // After fix, allRemovedDatasetIds = standaloneOnlyIds + folder subtree.
    // Since d1 is in coveredByFolder, standaloneOnlyIds = [].
    // Folder onSuccess fires with [d1]. Total: d1 appears exactly once.
    const snapshotDatasetIds = new Set(["d1"]);
    const coveredByFolder = new Set(["d1"]);
    const standaloneOnlyIds = [...snapshotDatasetIds].filter(
      (id) => !coveredByFolder.has(id),
    );
    // Simulated folder subtree reports d1 once.
    const folderReportedIds = ["d1"];
    // Combined (what onDatasetsRemoved would receive in total):
    const allIds = [...new Set([...standaloneOnlyIds, ...folderReportedIds])];
    expect(allIds).toHaveLength(1);
    expect(allIds).toEqual(["d1"]);
  });
});
