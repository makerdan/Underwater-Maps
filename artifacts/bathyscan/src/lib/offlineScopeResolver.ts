/**
 * offlineScopeResolver — pure helpers that turn an offline-download *scope*
 * (entire library / folder subtree / multi-selection / collection) into the
 * concrete, deduplicated dataset list the bulk offline engine consumes.
 *
 * Kept side-effect-free (no queries, no stores) for easy unit testing.
 *
 * Non-downloadable items (catalog saves still queued/processing/failed, or
 * ready saves that never materialized a dataset row) are classified as
 * `skipped` with a human-readable reason instead of failing the run.
 */
import type {
  DatasetCollection,
  DatasetFolder,
  UserCatalogSave,
  UserDatasetMeta,
} from "@workspace/api-client-react";
import type { BulkDataset } from "@/hooks/useBulkOfflinePack";
import { buildMergedTree, type MergedEntry, type MergedFolderNode } from "./datasetLibrary";

// ─── Scope types ─────────────────────────────────────────────────────────────

export type OfflineScope =
  | { kind: "library" }
  | { kind: "folder"; folderId: string }
  /** Mixed multi-selection from the folder tree — ids may be folder ids,
   *  catalog-save ids, or dataset (upload) ids. */
  | { kind: "selection"; ids: string[] }
  | { kind: "collection"; collectionId: string };

export interface SkippedScopeItem {
  /** Library id of the skipped item (save id / dataset id / member ref). */
  id: string;
  name: string;
  reason: string;
}

export interface ResolvedOfflineScope {
  /** Human label for the scope, e.g. "Entire library" or a folder name. */
  label: string;
  /** Deduplicated downloadable datasets, in stable scope order. */
  datasets: BulkDataset[];
  /** Items in scope that cannot be downloaded, with reasons. */
  skipped: SkippedScopeItem[];
}

export interface OfflineScopeInputs {
  folders: DatasetFolder[];
  /** Uploaded datasets (userDatasets query). */
  datasets: UserDatasetMeta[];
  /** All catalog saves (unfiltered useGetDatasetsMySaves). */
  saves: UserCatalogSave[];
  collections?: DatasetCollection[];
}

// ─── Skip reasons ────────────────────────────────────────────────────────────

function saveSkipReason(save: UserCatalogSave): string | null {
  if (save.status === "queued") return "Waiting to process — not downloadable yet";
  if (save.status === "processing") return "Still processing — not downloadable yet";
  if (save.status === "failed") return "Processing failed — retry before downloading";
  if (save.status === "ready" && !save.datasetId)
    return "Not materialized — no downloadable dataset yet";
  return null;
}

function saveDisplayName(save: UserCatalogSave): string {
  return save.displayLabel ?? save.catalog?.name ?? save.catalogId;
}

// ─── Collector (dedupe across scope members) ─────────────────────────────────

class ScopeCollector {
  readonly datasets: BulkDataset[] = [];
  readonly skipped: SkippedScopeItem[] = [];
  private seenDatasetIds = new Set<string>();
  private seenSkipIds = new Set<string>();

  addUpload(d: UserDatasetMeta): void {
    if (this.seenDatasetIds.has(d.id)) return;
    this.seenDatasetIds.add(d.id);
    this.datasets.push({
      id: d.id,
      name: d.name,
      bbox: d.bbox ?? undefined,
      ...(d.resolutionM != null ? { resolutionM: d.resolutionM } : {}),
    });
  }

  /**
   * Add a catalog save, preferring the linked upload row's metadata when it
   * is available (richer: measured bbox + resolution), falling back to the
   * catalog coverage bbox — the same fallback the legacy "⬇ All" list used.
   */
  addSave(save: UserCatalogSave, linkedDataset: UserDatasetMeta | null): void {
    const reason = saveSkipReason(save);
    if (reason) {
      this.addSkip(save.id, saveDisplayName(save), reason);
      return;
    }
    // status === "ready" && datasetId — downloadable.
    const dsId = save.datasetId!;
    if (this.seenDatasetIds.has(dsId)) return;
    if (linkedDataset) {
      this.seenDatasetIds.add(dsId);
      this.datasets.push({
        id: linkedDataset.id,
        name: linkedDataset.name,
        bbox: linkedDataset.bbox ?? save.catalog?.coverageBbox ?? undefined,
        ...(linkedDataset.resolutionM != null ? { resolutionM: linkedDataset.resolutionM } : {}),
      });
    } else {
      this.seenDatasetIds.add(dsId);
      this.datasets.push({
        id: dsId,
        name: saveDisplayName(save),
        bbox: save.catalog?.coverageBbox ?? undefined,
      });
    }
  }

  addSkip(id: string, name: string, reason: string): void {
    if (this.seenSkipIds.has(id)) return;
    this.seenSkipIds.add(id);
    this.skipped.push({ id, name, reason });
  }
}

// ─── Merged-tree traversal ───────────────────────────────────────────────────

function collectEntry(entry: MergedEntry, out: ScopeCollector): void {
  if (entry.kind === "save") out.addSave(entry.save, entry.dataset);
  else out.addUpload(entry.dataset);
}

function collectFolderSubtree(node: MergedFolderNode, out: ScopeCollector): void {
  for (const item of node.items) collectEntry(item, out);
  for (const child of node.children) collectFolderSubtree(child, out);
}

// ─── Public resolver ─────────────────────────────────────────────────────────

/**
 * Resolve a scope into a deduplicated downloadable dataset list plus skips.
 *
 * Library-scope ordering intentionally reproduces the legacy "⬇ All" inline
 * computation (uploads first, then ready catalog saves whose datasetId is not
 * already covered by an upload row) — the scopes regression test pins this.
 */
export function resolveOfflineScope(
  scope: OfflineScope,
  inputs: OfflineScopeInputs,
): ResolvedOfflineScope {
  const { folders, datasets, saves, collections = [] } = inputs;
  const out = new ScopeCollector();

  switch (scope.kind) {
    case "library": {
      // Legacy order: uploads first, then ready saves not already seen.
      for (const d of datasets) out.addUpload(d);
      for (const s of saves) {
        // A ready save whose dataset row is in the uploads list is already
        // covered above (dedupe) — never double-list or double-skip it.
        out.addSave(s, s.datasetId ? (datasets.find((d) => d.id === s.datasetId) ?? null) : null);
      }
      return { label: "Entire library", datasets: out.datasets, skipped: out.skipped };
    }

    case "folder": {
      const tree = buildMergedTree(folders, saves, datasets);
      const node = tree.byId.get(scope.folderId);
      if (!node) {
        return { label: "Folder", datasets: [], skipped: [] };
      }
      collectFolderSubtree(node, out);
      return { label: node.folder.name, datasets: out.datasets, skipped: out.skipped };
    }

    case "selection": {
      const tree = buildMergedTree(folders, saves, datasets);
      const saveById = new Map(saves.map((s) => [s.id, s]));
      const datasetById = new Map(datasets.map((d) => [d.id, d]));
      // A materialized save's dataset id may be passed instead of the save id
      // (folder-tree rows expose dataset ids) — map it back to its save.
      const saveByDatasetId = new Map<string, UserCatalogSave>();
      for (const s of saves) if (s.datasetId) saveByDatasetId.set(s.datasetId, s);

      for (const id of scope.ids) {
        const folderNode = tree.byId.get(id);
        if (folderNode) {
          collectFolderSubtree(folderNode, out);
          continue;
        }
        const save = saveById.get(id);
        if (save) {
          out.addSave(save, save.datasetId ? (datasetById.get(save.datasetId) ?? null) : null);
          continue;
        }
        const ds = datasetById.get(id);
        if (ds) {
          const backingSave = saveByDatasetId.get(id);
          if (backingSave) out.addSave(backingSave, ds);
          else out.addUpload(ds);
          continue;
        }
        const dsSave = saveByDatasetId.get(id);
        if (dsSave) {
          out.addSave(dsSave, null);
          continue;
        }
        out.addSkip(id, id, "Not found in your library");
      }
      const n = scope.ids.length;
      return {
        label: `${n} selected item${n === 1 ? "" : "s"}`,
        datasets: out.datasets,
        skipped: out.skipped,
      };
    }

    case "collection": {
      const collection = collections.find((c) => c.id === scope.collectionId);
      if (!collection) {
        return { label: "Collection", datasets: [], skipped: [] };
      }
      const saveById = new Map(saves.map((s) => [s.id, s]));
      const datasetById = new Map(datasets.map((d) => [d.id, d]));
      const saveByDatasetId = new Map<string, UserCatalogSave>();
      for (const s of saves) if (s.datasetId) saveByDatasetId.set(s.datasetId, s);

      for (const m of collection.members) {
        if (m.kind === "catalogSave") {
          const save = saveById.get(m.refId);
          if (!save) {
            out.addSkip(m.refId, m.name, "No longer in your library");
            continue;
          }
          out.addSave(save, save.datasetId ? (datasetById.get(save.datasetId) ?? null) : null);
        } else {
          // kind === "dataset" — refId is a custom_datasets id.
          const ds = datasetById.get(m.refId);
          if (ds) {
            const backingSave = saveByDatasetId.get(ds.id);
            if (backingSave) out.addSave(backingSave, ds);
            else out.addUpload(ds);
            continue;
          }
          const backingSave = saveByDatasetId.get(m.refId);
          if (backingSave) {
            out.addSave(backingSave, null);
            continue;
          }
          out.addSkip(m.refId, m.name, "No longer in your library");
        }
      }
      return { label: collection.name, datasets: out.datasets, skipped: out.skipped };
    }
  }
}
