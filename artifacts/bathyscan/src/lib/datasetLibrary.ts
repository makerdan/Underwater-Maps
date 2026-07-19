/**
 * datasetLibrary — pure helpers for building and validating the user's
 * dataset folder tree. Kept side-effect-free for easy unit testing.
 */
import type { DatasetFolder, UserDatasetMeta } from "@workspace/api-client-react";

export interface FolderNode {
  folder: DatasetFolder;
  children: FolderNode[];
  datasets: UserDatasetMeta[];
  depth: number;
}

export interface LibraryTree {
  /** Top-level folders (those with parentId === null). */
  roots: FolderNode[];
  /** Datasets that sit at the library root (folderId === null). */
  rootDatasets: UserDatasetMeta[];
  /** Flat lookup by folder id. */
  byId: Map<string, FolderNode>;
}

/** Build a folder tree from flat lists of folders + datasets. */
export function buildLibraryTree(
  folders: DatasetFolder[],
  datasets: UserDatasetMeta[],
): LibraryTree {
  // Make node skeletons keyed by id
  const byId = new Map<string, FolderNode>();
  for (const f of folders) {
    byId.set(f.id, { folder: f, children: [], datasets: [], depth: 0 });
  }

  const roots: FolderNode[] = [];
  for (const f of folders) {
    const node = byId.get(f.id)!;
    if (f.parentId && byId.has(f.parentId)) {
      byId.get(f.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Place datasets
  const rootDatasets: UserDatasetMeta[] = [];
  for (const d of datasets) {
    if (d.folderId && byId.has(d.folderId)) {
      byId.get(d.folderId)!.datasets.push(d);
    } else {
      rootDatasets.push(d);
    }
  }

  // Sort folders by name; assign depth via BFS.
  // Names may legitimately be missing in dev/test data (and would otherwise
  // throw inside localeCompare), so coerce to an empty string defensively
  // and warn once so the bad record is still surfaced to developers.
  const safeName = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (v == null) {
      if (typeof console !== "undefined") {
        console.warn("[datasetLibrary] record missing name; sorting as empty string");
      }
      return "";
    }
    return String(v);
  };
  const sortNodes = (arr: FolderNode[]) =>
    arr.sort((a, b) =>
      safeName(a.folder.name).localeCompare(safeName(b.folder.name), undefined, { sensitivity: "base" }),
    );
  sortNodes(roots);
  const stack: { node: FolderNode; depth: number }[] = roots.map((n) => ({ node: n, depth: 0 }));
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    node.depth = depth;
    sortNodes(node.children);
    node.datasets.sort((a, b) =>
      safeName(a.name).localeCompare(safeName(b.name), undefined, { sensitivity: "base" }),
    );
    for (const c of node.children) stack.push({ node: c, depth: depth + 1 });
  }
  rootDatasets.sort((a, b) =>
    safeName(a.name).localeCompare(safeName(b.name), undefined, { sensitivity: "base" }),
  );

  return { roots, rootDatasets, byId };
}

/**
 * Returns true if `candidateParent` is `folderId` or one of its descendants.
 * Used to prevent moving a folder into its own subtree (cycles).
 */
export function isDescendantOf(
  byId: Map<string, FolderNode>,
  folderId: string,
  candidateParent: string,
): boolean {
  if (candidateParent === folderId) return true;
  const start = byId.get(folderId);
  if (!start) return false;
  const stack: FolderNode[] = [start];
  while (stack.length) {
    const n = stack.pop()!;
    for (const c of n.children) {
      if (c.folder.id === candidateParent) return true;
      stack.push(c);
    }
  }
  return false;
}

/** Walk to all descendant folder ids of `rootId` (inclusive). */
export function descendantFolderIds(
  byId: Map<string, FolderNode>,
  rootId: string,
): Set<string> {
  const out = new Set<string>();
  const start = byId.get(rootId);
  if (!start) return out;
  const stack: FolderNode[] = [start];
  while (stack.length) {
    const n = stack.pop()!;
    out.add(n.folder.id);
    for (const c of n.children) stack.push(c);
  }
  return out;
}

// ─── Move-to dialog helpers ────────────────────────────────────────────────

export interface MoveOption {
  /** null = library root */
  id: string | null;
  label: string;
  depth: number;
  disabled: boolean;
  disabledReason?: string;
}

/**
 * Build the flat option list for the Move-to dialog. Folders that cannot be
 * a legal move target (self, descendants, current parent) are disabled.
 */
export function buildMoveOptions(
  tree: LibraryTree,
  target: { kind: "folder" | "dataset"; id: string; currentParentId: string | null },
): MoveOption[] {
  const blocked =
    target.kind === "folder"
      ? descendantFolderIds(tree.byId, target.id)
      : new Set<string>();
  const opts: MoveOption[] = [];
  opts.push({
    id: null,
    label: "Library root",
    depth: 0,
    disabled: target.currentParentId === null,
    disabledReason:
      target.currentParentId === null ? "Already here" : undefined,
  });
  const walk = (nodes: FolderNode[], depth: number) => {
    for (const n of nodes) {
      const isSelf = target.kind === "folder" && n.folder.id === target.id;
      const isDescendant = blocked.has(n.folder.id);
      const isCurrent = n.folder.id === target.currentParentId;
      const disabled = isSelf || isDescendant || isCurrent;
      let reason: string | undefined;
      if (isCurrent) reason = "Already here";
      else if (isSelf) reason = "Cannot move into itself";
      else if (isDescendant) reason = "Cannot move into a subfolder";
      opts.push({
        id: n.folder.id,
        label: n.folder.name,
        depth: depth + 1,
        disabled,
        disabledReason: reason,
      });
      walk(n.children, depth + 1);
    }
  };
  walk(tree.roots, 0);
  return opts;
}

/** Suggest a non-colliding name in a parent: "New folder", "New folder 2", ... */
export function suggestUniqueName(
  siblings: { name: string }[],
  base: string,
): string {
  const taken = new Set(siblings.map((s) => s.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}
