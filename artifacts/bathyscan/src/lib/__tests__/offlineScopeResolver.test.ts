/**
 * offlineScopeResolver — unit tests
 *
 * Covers:
 *   - Library scope reproduces the legacy "⬇ All" order (uploads first, then
 *     ready saves not already covered by an upload row)
 *   - Folder scope recurses the subtree and skips non-ready saves
 *   - Selection scope handles folder ids, save ids, dataset ids, and unknowns
 *   - Collection scope maps members (dataset / catalogSave) with skips for
 *     removed items
 *   - Deduplication across overlapping scope members
 *   - Skip classification per save status
 */
import { describe, it, expect } from "vitest";
import { resolveOfflineScope, type OfflineScopeInputs } from "../offlineScopeResolver";
import type {
  DatasetCollection,
  DatasetFolder,
  UserCatalogSave,
  UserDatasetMeta,
} from "@workspace/api-client-react";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const folder = (id: string, name: string, parentId: string | null = null): DatasetFolder => ({
  id,
  name,
  parentId,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
});

const upload = (
  id: string,
  name: string,
  folderId: string | null = null,
  extra: Partial<UserDatasetMeta> = {},
): UserDatasetMeta => ({
  id,
  name,
  minDepth: 0,
  maxDepth: 100,
  folderId,
  createdAt: "2024-01-01T00:00:00Z",
  ...extra,
});

const save = (
  id: string,
  status: UserCatalogSave["status"],
  extra: Partial<UserCatalogSave> = {},
): UserCatalogSave => ({
  id,
  catalogId: `cat-${id}`,
  status,
  requestedAt: "2024-01-01T00:00:00Z",
  ...extra,
});

const collection = (
  id: string,
  name: string,
  members: DatasetCollection["members"],
): DatasetCollection => ({
  id,
  name,
  members,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
});

const member = (
  id: string,
  kind: "dataset" | "catalogSave",
  refId: string,
  name: string,
): DatasetCollection["members"][number] => ({
  id,
  kind,
  refId,
  name,
  createdAt: "2024-01-01T00:00:00Z",
});

const BBOX = { minLon: -70, maxLon: -69, minLat: 43, maxLat: 44 };

function inputs(partial: Partial<OfflineScopeInputs> = {}): OfflineScopeInputs {
  return { folders: [], datasets: [], saves: [], collections: [], ...partial };
}

// ── Library scope ────────────────────────────────────────────────────────────

describe("resolveOfflineScope — library", () => {
  it("lists all uploads first, then ready saves not already covered", () => {
    const dsU = upload("u1", "Upload One", null, { bbox: BBOX, resolutionM: 5 });
    // Materialized save whose dataset row IS in the uploads list
    const dsM = upload("m1", "Materialized One");
    const sReady = save("s1", "ready", { datasetId: "m1" });
    // Materialized save whose dataset row is NOT in the uploads list
    const sOrphanReady = save("s2", "ready", {
      datasetId: "m2",
      displayLabel: "Orphan Ready",
    });

    const res = resolveOfflineScope(
      { kind: "library" },
      inputs({ datasets: [dsU, dsM], saves: [sReady, sOrphanReady] }),
    );

    expect(res.label).toBe("Entire library");
    expect(res.datasets.map((d) => d.id)).toEqual(["u1", "m1", "m2"]);
    // Upload metadata carried through
    expect(res.datasets[0]).toMatchObject({ id: "u1", name: "Upload One", bbox: BBOX, resolutionM: 5 });
    // Save without a dataset row falls back to save-derived metadata
    expect(res.datasets[2]).toMatchObject({ id: "m2", name: "Orphan Ready" });
    expect(res.skipped).toEqual([]);
  });

  it("classifies non-downloadable saves as skips with status reasons", () => {
    const saves = [
      save("q", "queued", { displayLabel: "Queued Save" }),
      save("p", "processing", { displayLabel: "Processing Save" }),
      save("f", "failed", { displayLabel: "Failed Save" }),
      save("nm", "ready", { displayLabel: "Never Materialized" }), // ready, no datasetId
    ];

    const res = resolveOfflineScope({ kind: "library" }, inputs({ saves }));

    expect(res.datasets).toEqual([]);
    expect(res.skipped).toHaveLength(4);
    const byId = new Map(res.skipped.map((s) => [s.id, s]));
    expect(byId.get("q")?.reason).toMatch(/Waiting to process/);
    expect(byId.get("p")?.reason).toMatch(/Still processing/);
    expect(byId.get("f")?.reason).toMatch(/failed — retry/i);
    expect(byId.get("nm")?.reason).toMatch(/Not materialized/);
    expect(byId.get("q")?.name).toBe("Queued Save");
  });

  it("never double-lists a materialized save whose dataset is in the uploads list", () => {
    const ds = upload("d1", "Shared");
    const s = save("s1", "ready", { datasetId: "d1" });
    const res = resolveOfflineScope(
      { kind: "library" },
      inputs({ datasets: [ds], saves: [s] }),
    );
    expect(res.datasets.map((d) => d.id)).toEqual(["d1"]);
    expect(res.skipped).toEqual([]);
  });
});

// ── Folder scope ─────────────────────────────────────────────────────────────

describe("resolveOfflineScope — folder subtree", () => {
  const folders = [folder("root", "Root"), folder("child", "Child", "root"), folder("grand", "Grand", "child"), folder("other", "Other")];
  const datasets = [
    upload("dRoot", "In Root", "root"),
    upload("dChild", "In Child", "child"),
    upload("dGrand", "In Grand", "grand"),
    upload("dOther", "In Other", "other"),
  ];
  const saves = [
    save("sChild", "ready", { datasetId: "mChild", folderId: "child", displayLabel: "Save In Child" }),
    save("sProc", "processing", { folderId: "grand", displayLabel: "Processing In Grand" }),
  ];

  it("collects the folder's datasets plus its entire subtree, with skips", () => {
    const res = resolveOfflineScope(
      { kind: "folder", folderId: "root" },
      inputs({ folders, datasets, saves }),
    );
    expect(res.label).toBe("Root");
    expect(res.datasets.map((d) => d.id).sort()).toEqual(["dChild", "dGrand", "dRoot", "mChild"]);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]).toMatchObject({ id: "sProc", reason: expect.stringMatching(/Still processing/) });
    // "Other" folder content excluded
    expect(res.datasets.some((d) => d.id === "dOther")).toBe(false);
  });

  it("resolves a mid-tree folder to only its own subtree", () => {
    const res = resolveOfflineScope(
      { kind: "folder", folderId: "child" },
      inputs({ folders, datasets, saves }),
    );
    expect(res.label).toBe("Child");
    expect(res.datasets.map((d) => d.id).sort()).toEqual(["dChild", "dGrand", "mChild"]);
  });

  it("returns an empty result for an unknown folder id", () => {
    const res = resolveOfflineScope(
      { kind: "folder", folderId: "ghost" },
      inputs({ folders, datasets, saves }),
    );
    expect(res.datasets).toEqual([]);
    expect(res.skipped).toEqual([]);
  });
});

// ── Selection scope ──────────────────────────────────────────────────────────

describe("resolveOfflineScope — selection", () => {
  const folders = [folder("f1", "Folder One")];
  const datasets = [upload("d1", "Upload One", "f1"), upload("d2", "Upload Two"), upload("m1", "Materialized")];
  const saves = [save("s1", "ready", { datasetId: "m1" }), save("s2", "queued", { displayLabel: "Queued" })];

  it("resolves folder ids, save ids, and dataset ids", () => {
    const res = resolveOfflineScope(
      { kind: "selection", ids: ["f1", "s1", "d2"] },
      inputs({ folders, datasets, saves }),
    );
    expect(res.label).toBe("3 selected items");
    expect(res.datasets.map((d) => d.id).sort()).toEqual(["d1", "d2", "m1"]);
    expect(res.skipped).toEqual([]);
  });

  it("maps a materialized dataset id back to its backing save", () => {
    const res = resolveOfflineScope(
      { kind: "selection", ids: ["m1"] },
      inputs({ folders, datasets, saves }),
    );
    expect(res.datasets.map((d) => d.id)).toEqual(["m1"]);
  });

  it("classifies unknown ids and non-ready saves as skips", () => {
    const res = resolveOfflineScope(
      { kind: "selection", ids: ["ghost", "s2"] },
      inputs({ folders, datasets, saves }),
    );
    expect(res.datasets).toEqual([]);
    expect(res.skipped).toHaveLength(2);
    const reasons = res.skipped.map((s) => s.reason);
    expect(reasons.join(" ")).toMatch(/Not found in your library/);
    expect(reasons.join(" ")).toMatch(/Waiting to process/);
  });

  it("uses singular label for one id", () => {
    const res = resolveOfflineScope(
      { kind: "selection", ids: ["d2"] },
      inputs({ folders, datasets, saves }),
    );
    expect(res.label).toBe("1 selected item");
  });
});

// ── Collection scope ─────────────────────────────────────────────────────────

describe("resolveOfflineScope — collection", () => {
  const datasets = [upload("d1", "Upload One"), upload("m1", "Materialized")];
  const saves = [
    save("s1", "ready", { datasetId: "m1" }),
    save("s2", "processing", { displayLabel: "Still Cooking" }),
  ];
  const collections = [
    collection("c1", "Trip North", [
      member("mm1", "dataset", "d1", "Upload One"),
      member("mm2", "catalogSave", "s1", "Materialized"),
      member("mm3", "catalogSave", "s2", "Still Cooking"),
      member("mm4", "dataset", "gone", "Deleted Upload"),
      member("mm5", "catalogSave", "gone-save", "Deleted Save"),
    ]),
  ];

  it("maps members to datasets, skipping processing and removed items", () => {
    const res = resolveOfflineScope(
      { kind: "collection", collectionId: "c1" },
      inputs({ datasets, saves, collections }),
    );
    expect(res.label).toBe("Trip North");
    expect(res.datasets.map((d) => d.id).sort()).toEqual(["d1", "m1"]);
    expect(res.skipped).toHaveLength(3);
    const byId = new Map(res.skipped.map((s) => [s.id, s]));
    expect(byId.get("s2")?.reason).toMatch(/Still processing/);
    expect(byId.get("gone")?.reason).toMatch(/No longer in your library/);
    expect(byId.get("gone-save")?.reason).toMatch(/No longer in your library/);
  });

  it("returns an empty result for an unknown collection id", () => {
    const res = resolveOfflineScope(
      { kind: "collection", collectionId: "ghost" },
      inputs({ datasets, saves, collections }),
    );
    expect(res.datasets).toEqual([]);
    expect(res.skipped).toEqual([]);
  });
});

// ── Dedupe across overlapping members ────────────────────────────────────────

describe("resolveOfflineScope — dedupe", () => {
  it("selection containing a folder AND datasets inside it lists each dataset once", () => {
    const folders = [folder("f1", "F1")];
    const datasets = [upload("d1", "One", "f1"), upload("d2", "Two", "f1")];
    const res = resolveOfflineScope(
      { kind: "selection", ids: ["f1", "d1", "d2"] },
      inputs({ folders, datasets }),
    );
    expect(res.datasets.map((d) => d.id).sort()).toEqual(["d1", "d2"]);
  });

  it("a materialized save selected by both save id and dataset id is listed once", () => {
    const datasets = [upload("m1", "Materialized")];
    const saves = [save("s1", "ready", { datasetId: "m1" })];
    const res = resolveOfflineScope(
      { kind: "selection", ids: ["s1", "m1"] },
      inputs({ datasets, saves }),
    );
    expect(res.datasets.map((d) => d.id)).toEqual(["m1"]);
  });

  it("skips are deduped by id too", () => {
    const folders = [folder("f1", "F1")];
    const saves = [save("sq", "queued", { folderId: "f1", displayLabel: "Q" })];
    const res = resolveOfflineScope(
      { kind: "selection", ids: ["f1", "sq"] },
      inputs({ folders, saves }),
    );
    expect(res.skipped).toHaveLength(1);
  });
});
