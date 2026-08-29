import type {
  DatasetCatalogSearchResult,
  UserCatalogSave,
  UserDatasetMeta,
} from "@workspace/api-client-react";
import { bboxIntersects, type Bounds } from "@/lib/gpsImport";

export type OverviewBboxResult = DatasetCatalogSearchResult & {
  resultKind: "catalog" | "library";
  loadDatasetId: string;
  catalogSaveId?: string;
  collectionMember: boolean;
};

type Bbox = {
  north: number;
  south: number;
  east: number;
  west: number;
};

type ResultCandidate = {
  result: OverviewBboxResult;
  identityKeys: string[];
  priority: number;
};

const toBounds = (bbox: Bbox | UserDatasetMeta["bbox"]): Bounds | null => {
  if (!bbox) return null;
  const bounds = "north" in bbox
    ? { minLon: bbox.west, maxLon: bbox.east, minLat: bbox.south, maxLat: bbox.north }
    : bbox;
  return Object.values(bounds).every(Number.isFinite) ? bounds : null;
};

const saveName = (save: UserCatalogSave): string =>
  save.displayLabel ?? save.catalog?.name ?? save.catalogId;

const catalogResult = (
  entry: DatasetCatalogSearchResult,
  collectionMember: boolean,
): OverviewBboxResult => ({
  ...entry,
  resultKind: "catalog",
  loadDatasetId: entry.id,
  collectionMember,
});

const saveResult = (
  save: UserCatalogSave,
  collectionMember: boolean,
): OverviewBboxResult | null => {
  if (save.status !== "ready" || !save.datasetId || !save.catalog) return null;
  const coverageBbox = save.terrainBbox ?? save.catalog.coverageBbox;
  return {
    ...save.catalog,
    id: save.catalogId,
    name: saveName(save),
    coverageBbox: coverageBbox ?? save.catalog.coverageBbox,
    resultKind: "library",
    loadDatasetId: save.datasetId,
    catalogSaveId: save.id,
    collectionMember,
    relevanceScore: 1,
  };
};

const uploadResult = (
  dataset: UserDatasetMeta,
  collectionMember: boolean,
): OverviewBboxResult => ({
  id: `user-${dataset.id}`,
  name: dataset.name,
  sourceAgency: "My Library",
  dataType: "bathymetry",
  coverageBbox: dataset.bbox!,
  waterType: dataset.waterType ?? "saltwater",
  createdAt: dataset.createdAt,
  lastUpdated: dataset.createdAt,
  relevanceScore: 1,
  resultKind: "library",
  loadDatasetId: dataset.id,
  collectionMember,
});

/**
 * Merge public catalog matches with the ready library rows visible in the
 * selected area. Identity is based on catalog identity and materialized
 * dataset target, never on display name, so two same-named surveys remain
 * distinct while saved/uploaded copies collapse.
 */
export function buildOverviewBboxResults(
  bbox: Bbox,
  catalogResults: DatasetCatalogSearchResult[],
  userDatasets: UserDatasetMeta[],
  saves: UserCatalogSave[],
  collectionScopeIds: string[] | null,
): OverviewBboxResult[] {
  const queryBounds = toBounds(bbox);
  if (!queryBounds) return [];
  const scopeIds = new Set(collectionScopeIds ?? []);
  const savedDatasetIds = new Set(
    saves.filter((save) => save.status === "ready" && save.datasetId).map((save) => save.datasetId!),
  );
  const candidates: ResultCandidate[] = [];

  for (const save of saves) {
    const result = saveResult(save, Boolean(save.datasetId && scopeIds.has(save.datasetId)));
    const coverage = result?.coverageBbox;
    if (!result || !coverage || !bboxIntersects(queryBounds, coverage)) continue;
    candidates.push({
      result,
      identityKeys: [`catalog:${save.catalogId}`, `dataset:${save.datasetId}`],
      priority: result.collectionMember ? 0 : 1,
    });
  }

  for (const dataset of userDatasets) {
    if (savedDatasetIds.has(dataset.id) || !dataset.bbox) continue;
    if (!bboxIntersects(queryBounds, dataset.bbox)) continue;
    candidates.push({
      result: uploadResult(dataset, scopeIds.has(dataset.id)),
      identityKeys: [`dataset:${dataset.id}`],
      priority: scopeIds.has(dataset.id) ? 0 : 1,
    });
  }

  for (const entry of catalogResults) {
    if (!bboxIntersects(queryBounds, entry.coverageBbox)) continue;
    candidates.push({
      result: catalogResult(entry, false),
      identityKeys: [`catalog:${entry.id}`, `dataset:${entry.id}`],
      priority: 2,
    });
  }

  candidates.sort((a, b) => a.priority - b.priority);
  const seen = new Set<string>();
  const output: OverviewBboxResult[] = [];
  for (const candidate of candidates) {
    if (candidate.identityKeys.some((key) => seen.has(key))) continue;
    candidate.identityKeys.forEach((key) => seen.add(key));
    output.push(candidate.result);
  }
  return output;
}