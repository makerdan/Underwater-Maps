/**
 * collections.test.ts (routes) — integration tests for /api/user/collections.
 *
 * Covers:
 *  - Auth scoping: users only ever see / mutate their own collections; a
 *    request naming another user's collection or dataset id gets 404.
 *  - Name validation: empty / too-long → invalid_name; case-insensitive
 *    duplicate → duplicate_name.
 *  - Dual-kind membership: uploaded datasets (kind=dataset) and catalog
 *    saves (kind=catalogSave) resolve display names correctly.
 *  - Exactly-one-reference enforcement on add-member (both / neither → 400).
 *  - Idempotent add: re-adding an existing member returns the existing row.
 *  - Removal: removing a member never deletes the dataset; deleting a
 *    collection removes its members but never the datasets (regression
 *    guard — DB-level cascade is covered by lib/db constraint tests).
 *
 * Mock strategy: the @workspace/db mock interprets the real drizzle-orm
 * eq/and/inArray expression trees against in-memory row arrays. Table stubs
 * use "table.field"-prefixed column strings so join/projection lookups can
 * tell identically-named columns apart (e.g. custom_datasets.name vs
 * dataset_catalog.name).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import os from "os";

// Background images land in a per-run temp dir (the route resolves
// COLLECTION_BG_DIR lazily on each request, so setting it here is enough).
const bgDir = fs.mkdtempSync(path.join(os.tmpdir(), "collections-bg-test-"));
process.env["COLLECTION_BG_DIR"] = bgDir;

type Row = Record<string, unknown>;

const state: {
  collections: Row[];
  members: Row[];
  datasets: Row[];
  saves: Row[];
  catalog: Row[];
} = { collections: [], members: [], datasets: [], saves: [], catalog: [] };

let nextId = 0;
function uid(): string {
  nextId += 1;
  return `00000000-0000-0000-0000-${String(nextId).padStart(12, "0")}`;
}

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
    and: (...conds: unknown[]) => ({ __op: "and", conds }),
    inArray: (col: unknown, vals: unknown[]) => ({ __op: "in", col, vals }),
  };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("../../__tests__/helpers/db-mock.js");
  const base = createDbMock();

  const TABLE_NAMES = [
    "dataset_collections",
    "dataset_collection_members",
    "custom_datasets",
    "user_catalog_saves",
    "dataset_catalog",
  ] as const;
  type TableName = (typeof TABLE_NAMES)[number];

  const mkTable = (name: TableName, fields: string[]) => {
    const t: Record<string, string> = { __tableName: name };
    for (const f of fields) t[f] = `${name}.${f}`;
    return t;
  };

  const datasetCollectionsTable = mkTable("dataset_collections", [
    "id", "userId", "name", "collectionKind", "specialMeta", "defaultMemberId", "createdAt", "updatedAt",
  ]);
  const datasetCollectionMembersTable = mkTable("dataset_collection_members", [
    "id", "collectionId", "datasetId", "catalogSaveId", "createdAt",
  ]);
  const customDatasetsTable = mkTable("custom_datasets", [
    "id", "userId", "name", "folderId", "createdAt",
  ]);
  const userCatalogSavesTable = mkTable("user_catalog_saves", [
    "id", "userId", "catalogId", "displayLabel", "folderId", "datasetId",
  ]);
  const datasetCatalogTable = mkTable("dataset_catalog", ["id", "name"]);

  const rowsFor = (name: TableName): Row[] => {
    if (name === "dataset_collections") return state.collections;
    if (name === "dataset_collection_members") return state.members;
    if (name === "custom_datasets") return state.datasets;
    if (name === "user_catalog_saves") return state.saves;
    return state.catalog;
  };

  type Bundle = Partial<Record<TableName, Row | null>>;

  const isColRef = (v: unknown): v is string =>
    typeof v === "string" && TABLE_NAMES.some((n) => v.startsWith(`${n}.`));

  const lookup = (bundle: Bundle, colStr: string): unknown => {
    const dot = colStr.indexOf(".");
    const table = colStr.slice(0, dot) as TableName;
    const field = colStr.slice(dot + 1);
    const row = bundle[table];
    return row ? row[field] : null;
  };

  const match = (bundle: Bundle, cond: unknown): boolean => {
    if (cond === undefined || cond === null) return true;
    const c = cond as { __op?: string; col?: string; val?: unknown; vals?: unknown[]; conds?: unknown[] };
    if (c.__op === "and") return (c.conds ?? []).every((sub) => match(bundle, sub));
    if (c.__op === "eq") {
      const left = lookup(bundle, c.col as string);
      const right = isColRef(c.val) ? lookup(bundle, c.val) : c.val;
      return left === right;
    }
    if (c.__op === "in") {
      const left = lookup(bundle, c.col as string);
      return (c.vals ?? []).includes(left);
    }
    throw new Error(`collections.test db mock: unsupported condition ${JSON.stringify(cond)}`);
  };

  const project = (bundle: Bundle, table: TableName, projection?: Record<string, string>): Row => {
    if (!projection) return { ...(bundle[table] as Row) };
    const out: Row = {};
    for (const [key, colStr] of Object.entries(projection)) {
      out[key] = lookup(bundle, colStr);
    }
    return out;
  };

  const select = (projection?: Record<string, string>) => ({
    from: (tableStub: { __tableName: TableName }) => {
      const table = tableStub.__tableName;
      const baseBundles = (): Bundle[] => rowsFor(table).map((r) => ({ [table]: r }));
      return {
        where: (cond: unknown) =>
          Promise.resolve(
            baseBundles().filter((b) => match(b, cond)).map((b) => project(b, table, projection)),
          ),
        leftJoin: (joinStub: { __tableName: TableName }, onCond: unknown) => ({
          where: (cond: unknown) => {
            const joinTable = joinStub.__tableName;
            const joined: Bundle[] = baseBundles().map((b) => {
              const matchRow = rowsFor(joinTable).find((jr) => match({ ...b, [joinTable]: jr }, onCond));
              return { ...b, [joinTable]: matchRow ?? null };
            });
            return Promise.resolve(
              joined.filter((b) => match(b, cond)).map((b) => project(b, table, projection)),
            );
          },
        }),
      };
    },
  });

  const insert = (tableStub: { __tableName: TableName }) => ({
    values: (row: Row) => {
      const doInsert = (skipConflict: boolean): Row[] => {
        if (tableStub.__tableName === "dataset_collection_members") {
          const dup = state.members.some(
            (m) =>
              m["collectionId"] === row["collectionId"] &&
              ((row["datasetId"] != null && m["datasetId"] === row["datasetId"]) ||
                (row["catalogSaveId"] != null && m["catalogSaveId"] === row["catalogSaveId"])),
          );
          if (dup) {
            if (skipConflict) return [];
            throw new Error("unique violation: dataset_collection_members");
          }
          const persisted = {
            id: uid(),
            collectionId: row["collectionId"],
            datasetId: row["datasetId"] ?? null,
            catalogSaveId: row["catalogSaveId"] ?? null,
            createdAt: new Date(),
          };
          state.members.push(persisted);
          return [persisted];
        }
        if (tableStub.__tableName === "dataset_collections") {
          const persisted = { id: uid(), createdAt: new Date(), updatedAt: new Date(), ...row };
          state.collections.push(persisted);
          return [persisted];
        }
        throw new Error(`collections.test db mock: insert into ${tableStub.__tableName} unsupported`);
      };
      return {
        returning: async () => doInsert(false),
        onConflictDoNothing: () => ({ returning: async () => doInsert(true) }),
      };
    },
  });

  const update = (tableStub: { __tableName: TableName }) => ({
    set: (vals: Row) => ({
      where: (cond: unknown) => ({
        returning: async () => {
          const rows = rowsFor(tableStub.__tableName).filter((r) =>
            match({ [tableStub.__tableName]: r }, cond),
          );
          for (const r of rows) Object.assign(r, vals);
          return rows.map((r) => ({ ...r }));
        },
      }),
    }),
  });

  const del = (tableStub: { __tableName: TableName }) => ({
    where: (cond: unknown) => ({
      returning: async (projection?: Record<string, string>) => {
        const table = tableStub.__tableName;
        const all = rowsFor(table);
        const matched = all.filter((r) => match({ [table]: r }, cond));
        for (const r of matched) all.splice(all.indexOf(r), 1);
        // Emulate the DB-level ON DELETE CASCADE from collections → members.
        if (table === "dataset_collections") {
          for (const c of matched) {
            for (let i = state.members.length - 1; i >= 0; i--) {
              if (state.members[i]!["collectionId"] === c["id"]) {
                if (state.members[i]!["id"] === c["defaultMemberId"]) c["defaultMemberId"] = null;
                state.members.splice(i, 1);
              }
            }
          }
        }
        return matched.map((r) => project({ [table]: r }, table, projection));
      },
    }),
  });

  return {
    ...base,
    db: {
      select,
      insert,
      update,
      delete: del,
      transaction: async <T>(cb: (tx: unknown) => Promise<T>) =>
        cb({ select, insert, update, delete: del }),
    },
    datasetCollectionsTable,
    datasetCollectionMembersTable,
    customDatasetsTable,
    userCatalogSavesTable,
    datasetCatalogTable,
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn((req: { headers: Record<string, unknown> }) => ({
    userId: (req.headers["x-test-user"] as string | undefined) ?? "user-a",
  })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

function seedCollection(userId: string, name: string): string {
  const id = uid();
  state.collections.push({
    id,
    userId,
    name,
    collectionKind: "standard",
    specialMeta: null,
    defaultMemberId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

type MetaShape = {
  bgImageKey: string | null;
  bgOpacity: number;
  bgGeoAnchors: Array<{ lon: number; lat: number; imgX: number; imgY: number }> | null;
  layoutRevisions: Array<{
    id: string;
    name: string;
    savedAt: string;
    tiles: Array<{ datasetId: string; tx: number; ty: number; angleDeg: number; locked: boolean; annotation?: string | null }>;
    groups: Array<{ id: string; name: string; datasetIds: string[] }>;
    pixelDensity?: number;
  }>;
  activeRevisionId: string | null;
};

function emptyMeta(): MetaShape {
  return { bgImageKey: null, bgOpacity: 0.5, bgGeoAnchors: null, layoutRevisions: [], activeRevisionId: null };
}

function seedSpecialCollection(userId: string, name: string, meta?: Partial<MetaShape>): string {
  const id = uid();
  state.collections.push({
    id,
    userId,
    name,
    collectionKind: "special",
    specialMeta: { ...emptyMeta(), ...meta },
    defaultMemberId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

function seedDataset(userId: string, name: string): string {
  const id = uid();
  state.datasets.push({ id, userId, name, folderId: null, createdAt: new Date() });
  return id;
}

function seedSave(userId: string, opts: { displayLabel?: string | null; catalogId?: string } = {}): string {
  const id = uid();
  state.saves.push({
    id,
    userId,
    catalogId: opts.catalogId ?? "cat-noaa",
    displayLabel: opts.displayLabel ?? null,
    folderId: null,
    datasetId: null,
  });
  return id;
}

function seedMember(collectionId: string, ref: { datasetId?: string; catalogSaveId?: string }): string {
  const id = uid();
  state.members.push({
    id,
    collectionId,
    datasetId: ref.datasetId ?? null,
    catalogSaveId: ref.catalogSaveId ?? null,
    createdAt: new Date(),
  });
  return id;
}

beforeEach(() => {
  __resetRateLimitMemory();
  state.collections = [];
  state.members = [];
  state.datasets = [];
  state.saves = [];
  state.catalog = [{ id: "cat-noaa", name: "NOAA Coastal DEM" }];
});

describe("GET /api/user/collections", () => {
  it("returns an empty array when the user has no collections", async () => {
    const res = await request(app).get("/api/user/collections");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns only the requesting user's collections (auth scoping)", async () => {
    seedCollection("user-a", "Mine");
    seedCollection("user-b", "Theirs");

    const res = await request(app).get("/api/user/collections");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Mine");
  });

  it("lists members of both kinds with resolved names", async () => {
    const cid = seedCollection("user-a", "Trip");
    const dsId = seedDataset("user-a", "Lake Upload");
    const labeledSaveId = seedSave("user-a", { displayLabel: "My Bay Save" });
    const unlabeledSaveId = seedSave("user-a"); // falls back to catalog name
    seedMember(cid, { datasetId: dsId });
    seedMember(cid, { catalogSaveId: labeledSaveId });
    seedMember(cid, { catalogSaveId: unlabeledSaveId });

    const res = await request(app).get("/api/user/collections");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const members = res.body[0].members as Array<{ kind: string; refId: string; name: string }>;
    expect(members).toHaveLength(3);
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "dataset", refId: dsId, name: "Lake Upload" }),
        expect.objectContaining({ kind: "catalogSave", refId: labeledSaveId, name: "My Bay Save" }),
        expect.objectContaining({ kind: "catalogSave", refId: unlabeledSaveId, name: "NOAA Coastal DEM" }),
      ]),
    );
  });
});

describe("POST /api/user/collections", () => {
  it("creates a collection and returns it with empty members", async () => {
    const res = await request(app).post("/api/user/collections").send({ name: "Trip Prep" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Trip Prep", members: [] });
    expect(state.collections).toHaveLength(1);
    expect(state.collections[0]).toMatchObject({ userId: "user-a", name: "Trip Prep" });
  });

  it("rejects a case-insensitive duplicate name for the same user", async () => {
    seedCollection("user-a", "Trip Prep");
    const res = await request(app).post("/api/user/collections").send({ name: "TRIP PREP" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("duplicate_name");
  });

  it("allows the same name for a different user", async () => {
    seedCollection("user-b", "Trip Prep");
    const res = await request(app).post("/api/user/collections").send({ name: "Trip Prep" });
    expect(res.status).toBe(201);
  });

  it("rejects an empty / whitespace-only name", async () => {
    const res = await request(app).post("/api/user/collections").send({ name: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_name");
  });

  it("rejects a name longer than 120 characters", async () => {
    const res = await request(app).post("/api/user/collections").send({ name: "x".repeat(121) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_name");
  });
});

describe("PATCH /api/user/collections/:id/rename", () => {
  it("renames the collection", async () => {
    const cid = seedCollection("user-a", "Old Name");
    const res = await request(app).patch(`/api/user/collections/${cid}/rename`).send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");
    expect(state.collections[0]!["name"]).toBe("New Name");
  });

  it("rejects renaming to another collection's name (case-insensitive)", async () => {
    seedCollection("user-a", "Keeper");
    const cid = seedCollection("user-a", "Renamed");
    const res = await request(app).patch(`/api/user/collections/${cid}/rename`).send({ name: "keeper" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("duplicate_name");
  });

  it("allows a case-only rename of the same collection", async () => {
    const cid = seedCollection("user-a", "trip prep");
    const res = await request(app).patch(`/api/user/collections/${cid}/rename`).send({ name: "Trip Prep" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Trip Prep");
  });

  it("404s when the collection belongs to another user", async () => {
    const cid = seedCollection("user-b", "Not Yours");
    const res = await request(app).patch(`/api/user/collections/${cid}/rename`).send({ name: "Stolen" });
    expect(res.status).toBe(404);
    expect(state.collections[0]!["name"]).toBe("Not Yours");
  });

  it("400s on a non-UUID id", async () => {
    const res = await request(app).patch("/api/user/collections/not-a-uuid/rename").send({ name: "X" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });
});

describe("DELETE /api/user/collections/:id", () => {
  it("deletes the collection and its members but never the datasets", async () => {
    const cid = seedCollection("user-a", "Doomed");
    const dsId = seedDataset("user-a", "Survivor");
    const saveId = seedSave("user-a");
    seedMember(cid, { datasetId: dsId });
    seedMember(cid, { catalogSaveId: saveId });

    const res = await request(app).delete(`/api/user/collections/${cid}`);
    expect(res.status).toBe(204);
    expect(state.collections).toHaveLength(0);
    expect(state.members).toHaveLength(0);
    // Regression guard: member cleanup must never delete the library items.
    expect(state.datasets).toHaveLength(1);
    expect(state.saves).toHaveLength(1);
  });

  it("404s when the collection belongs to another user", async () => {
    const cid = seedCollection("user-b", "Not Yours");
    const res = await request(app).delete(`/api/user/collections/${cid}`);
    expect(res.status).toBe(404);
    expect(state.collections).toHaveLength(1);
  });
});

describe("POST /api/user/collections/:id/members", () => {
  it("adds an uploaded dataset as a member (kind=dataset)", async () => {
    const cid = seedCollection("user-a", "Trip");
    const dsId = seedDataset("user-a", "Lake Upload");

    const res = await request(app)
      .post(`/api/user/collections/${cid}/members`)
      .send({ datasetId: dsId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: "dataset", refId: dsId, name: "Lake Upload" });
    expect(state.members).toHaveLength(1);
  });

  it("adds a catalog save as a member (kind=catalogSave)", async () => {
    const cid = seedCollection("user-a", "Trip");
    const saveId = seedSave("user-a", { displayLabel: "My Bay" });

    const res = await request(app)
      .post(`/api/user/collections/${cid}/members`)
      .send({ catalogSaveId: saveId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: "catalogSave", refId: saveId, name: "My Bay" });
  });

  it("rejects a body providing both references", async () => {
    const cid = seedCollection("user-a", "Trip");
    const dsId = seedDataset("user-a", "DS");
    const saveId = seedSave("user-a");
    const res = await request(app)
      .post(`/api/user/collections/${cid}/members`)
      .send({ datasetId: dsId, catalogSaveId: saveId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_member_ref");
    expect(state.members).toHaveLength(0);
  });

  it("rejects a body providing neither reference", async () => {
    const cid = seedCollection("user-a", "Trip");
    const res = await request(app).post(`/api/user/collections/${cid}/members`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_member_ref");
  });

  it("is idempotent — re-adding an existing member returns the existing row", async () => {
    const cid = seedCollection("user-a", "Trip");
    const dsId = seedDataset("user-a", "DS");

    const first = await request(app).post(`/api/user/collections/${cid}/members`).send({ datasetId: dsId });
    const second = await request(app).post(`/api/user/collections/${cid}/members`).send({ datasetId: dsId });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(state.members).toHaveLength(1);
  });

  it("404s when the dataset belongs to another user (no cross-user references)", async () => {
    const cid = seedCollection("user-a", "Trip");
    const foreignDs = seedDataset("user-b", "Foreign");
    const res = await request(app)
      .post(`/api/user/collections/${cid}/members`)
      .send({ datasetId: foreignDs });
    expect(res.status).toBe(404);
    expect(state.members).toHaveLength(0);
  });

  it("404s when the catalog save belongs to another user", async () => {
    const cid = seedCollection("user-a", "Trip");
    const foreignSave = seedSave("user-b");
    const res = await request(app)
      .post(`/api/user/collections/${cid}/members`)
      .send({ catalogSaveId: foreignSave });
    expect(res.status).toBe(404);
  });

  it("404s when the collection belongs to another user", async () => {
    const cid = seedCollection("user-b", "Not Yours");
    const dsId = seedDataset("user-a", "DS");
    const res = await request(app)
      .post(`/api/user/collections/${cid}/members`)
      .send({ datasetId: dsId });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/user/collections/:id/members/:memberId", () => {
  it("removes the member but never the underlying dataset", async () => {
    const cid = seedCollection("user-a", "Trip");
    const dsId = seedDataset("user-a", "Keeper");
    const memberId = seedMember(cid, { datasetId: dsId });

    const res = await request(app).delete(`/api/user/collections/${cid}/members/${memberId}`);
    expect(res.status).toBe(204);
    expect(state.members).toHaveLength(0);
    expect(state.datasets).toHaveLength(1);
  });

  it("clears the collection default when the selected member is removed", async () => {
    const cid = seedCollection("user-a", "Trip");
    const dsId = seedDataset("user-a", "Preferred");
    const memberId = seedMember(cid, { datasetId: dsId });
    state.collections.find((collection) => collection["id"] === cid)!["defaultMemberId"] = memberId;

    const res = await request(app).delete(`/api/user/collections/${cid}/members/${memberId}`);

    expect(res.status).toBe(204);
    expect(state.collections.find((collection) => collection["id"] === cid)!["defaultMemberId"]).toBeNull();
  });

  it("404s for a member id that belongs to a different collection", async () => {
    const cid1 = seedCollection("user-a", "A");
    const cid2 = seedCollection("user-a", "B");
    const dsId = seedDataset("user-a", "DS");
    const memberId = seedMember(cid1, { datasetId: dsId });

    const res = await request(app).delete(`/api/user/collections/${cid2}/members/${memberId}`);
    expect(res.status).toBe(404);
    expect(state.members).toHaveLength(1);
  });

  it("404s when the collection belongs to another user", async () => {
    const cid = seedCollection("user-b", "Not Yours");
    const dsId = seedDataset("user-b", "DS");
    const memberId = seedMember(cid, { datasetId: dsId });

    const res = await request(app).delete(`/api/user/collections/${cid}/members/${memberId}`);
    expect(res.status).toBe(404);
    expect(state.members).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Special collections — kind, meta, layout revisions, background image
// ─────────────────────────────────────────────────────────────────────────────

function seedRevision(n: number): MetaShape["layoutRevisions"][number] {
  return {
    id: uid(),
    name: `Rev ${n}`,
    savedAt: new Date(2026, 0, n + 1).toISOString(),
    tiles: [{ datasetId: `ds-${n}`, tx: n, ty: n, angleDeg: 0, locked: false }],
    groups: [],
  };
}

describe("collection kind (create / read round-trip)", () => {
  it("creates a special collection with empty meta and round-trips it through GET", async () => {
    const created = await request(app)
      .post("/api/user/collections")
      .send({ name: "Alaska 01", collectionKind: "special" });
    expect(created.status).toBe(201);
    expect(created.body.collectionKind).toBe("special");
    expect(created.body.specialMeta).toEqual(emptyMeta());

    const res = await request(app).get("/api/user/collections");
    expect(res.status).toBe(200);
    expect(res.body[0].collectionKind).toBe("special");
    expect(res.body[0].specialMeta).toMatchObject({ bgOpacity: 0.5, layoutRevisions: [] });
  });

  it("defaults to standard kind and omits specialMeta from responses", async () => {
    const created = await request(app).post("/api/user/collections").send({ name: "Plain" });
    expect(created.status).toBe(201);
    expect(created.body.collectionKind).toBe("standard");
    expect(created.body).not.toHaveProperty("specialMeta");
    expect(state.collections[0]).toMatchObject({ collectionKind: "standard", specialMeta: null });
  });

  it("rejects an unknown collectionKind value", async () => {
    const res = await request(app)
      .post("/api/user/collections")
      .send({ name: "Bad", collectionKind: "weird" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/user/collections/:id/meta", () => {
  it("updates bgOpacity and bgGeoAnchors", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const anchors = [
      { lon: -150.1, lat: 61.2, imgX: 10, imgY: 20 },
      { lon: -149.5, lat: 60.9, imgX: 800, imgY: 600 },
    ];
    const res = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({ bgOpacity: 0.8, bgGeoAnchors: anchors });
    expect(res.status).toBe(200);
    expect(res.body.specialMeta.bgOpacity).toBe(0.8);
    expect(res.body.specialMeta.bgGeoAnchors).toEqual(anchors);
  });

  it("rejects an out-of-range opacity", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const res = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({ bgOpacity: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("rejects anchors with out-of-bounds coordinates", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const res = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({
        bgGeoAnchors: [
          { lon: 200, lat: 61, imgX: 0, imgY: 0 },
          { lon: -149, lat: 61, imgX: 1, imgY: 1 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("allows standard collections to set and clear a member-row default", async () => {
    const cid = seedCollection("user-a", "Plain");
    const dsId = seedDataset("user-a", "Lake");
    const memberId = seedMember(cid, { datasetId: dsId });

    const saved = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({ defaultMemberId: memberId });
    expect(saved.status).toBe(200);
    expect(saved.body.defaultMemberId).toBe(memberId);
    expect(state.collections[0]).toMatchObject({ defaultMemberId: memberId });

    const cleared = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({ defaultMemberId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.defaultMemberId).toBeNull();
  });

  it("rejects a default member that belongs to another collection without disclosing it", async () => {
    const first = seedCollection("user-a", "First");
    const second = seedCollection("user-a", "Second");
    const dsId = seedDataset("user-a", "Lake");
    const memberId = seedMember(first, { datasetId: dsId });

    const res = await request(app)
      .patch(`/api/user/collections/${second}/meta`)
      .send({ defaultMemberId: memberId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_default_member");
    expect(res.body.details).not.toContain(memberId);
  });

  it("rejects an anchor list that is not exactly two points", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const res = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({ bgGeoAnchors: [{ lon: -150, lat: 61, imgX: 0, imgY: 0 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("rejects duplicate image points or duplicate GPS coordinates", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const duplicateImage = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({
        bgGeoAnchors: [
          { lon: -150, lat: 61, imgX: 10, imgY: 20 },
          { lon: -149, lat: 62, imgX: 10, imgY: 20 },
        ],
      });
    expect(duplicateImage.status).toBe(400);
    expect(duplicateImage.body.error).toBe("invalid_geo_anchors");

    const duplicateGps = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({
        bgGeoAnchors: [
          { lon: 180, lat: 61, imgX: 10, imgY: 20 },
          { lon: -180, lat: 61, imgX: 30, imgY: 40 },
        ],
      });
    expect(duplicateGps.status).toBe(400);
    expect(duplicateGps.body.error).toBe("invalid_geo_anchors");
  });

  it("rejects an activeRevisionId that references no saved revision", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const res = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({ activeRevisionId: uid() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unknown_revision");
  });

  it("accepts activeRevisionId null and an existing revision id", async () => {
    const rev = seedRevision(1);
    const cid = seedSpecialCollection("user-a", "Alaska 01", {
      layoutRevisions: [rev],
      activeRevisionId: null,
    });
    const set = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({ activeRevisionId: rev.id });
    expect(set.status).toBe(200);
    expect(set.body.specialMeta.activeRevisionId).toBe(rev.id);

    const clear = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({ activeRevisionId: null });
    expect(clear.status).toBe(200);
    expect(clear.body.specialMeta.activeRevisionId).toBeNull();
  });

  it("rejects an empty patch body", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const res = await request(app).patch(`/api/user/collections/${cid}/meta`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("empty_patch");
  });

  it("400s not_special on a standard collection", async () => {
    const cid = seedCollection("user-a", "Plain");
    const res = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({ bgOpacity: 0.3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("not_special");
  });

  it("404s when the collection belongs to another user", async () => {
    const cid = seedSpecialCollection("user-b", "Not Yours");
    const res = await request(app)
      .patch(`/api/user/collections/${cid}/meta`)
      .send({ bgOpacity: 0.3 });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/user/collections/:id/layout", () => {
  it("saves a named revision, sets it active, and round-trips through GET", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const body = {
      name: "First pass",
      tiles: [{ datasetId: "ds-1", tx: 1.5, ty: -2, angleDeg: 45, locked: true, annotation: "NW corner" }],
      groups: [{ id: "g1", name: "North", datasetIds: ["ds-1"] }],
      pixelDensity: 240,
    };
    const res = await request(app).post(`/api/user/collections/${cid}/layout`).send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "First pass", tiles: body.tiles, groups: body.groups, pixelDensity: 240 });
    expect(typeof res.body.id).toBe("string");

    const list = await request(app).get("/api/user/collections");
    const meta = list.body[0].specialMeta;
    expect(meta.layoutRevisions).toHaveLength(1);
    expect(meta.activeRevisionId).toBe(res.body.id);
  });

  it("keeps legacy revisions without pixel-density metadata readable", async () => {
    const rev = seedRevision(1);
    const cid = seedSpecialCollection("user-a", "Legacy", { layoutRevisions: [rev] });
    const res = await request(app).get("/api/user/collections");
    expect(res.status).toBe(200);
    expect(res.body.find((c: { id: string }) => c.id === cid).specialMeta.layoutRevisions[0])
      .not.toHaveProperty("pixelDensity");
  });

  it("replaces a same-named revision in place, keeping its id", async () => {
    const rev = seedRevision(1);
    const cid = seedSpecialCollection("user-a", "Alaska 01", { layoutRevisions: [rev] });
    const res = await request(app)
      .post(`/api/user/collections/${cid}/layout`)
      .send({ name: rev.name.toUpperCase(), tiles: [], groups: [] });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(rev.id);
    const meta = (state.collections[0]!["specialMeta"]) as MetaShape;
    expect(meta.layoutRevisions).toHaveLength(1);
    expect(meta.layoutRevisions[0]!.tiles).toEqual([]);
    expect(meta.activeRevisionId).toBe(rev.id);
  });

  it("caps revisions at 20, dropping the oldest", async () => {
    const revs = Array.from({ length: 20 }, (_, i) => seedRevision(i));
    const cid = seedSpecialCollection("user-a", "Alaska 01", { layoutRevisions: revs });
    const res = await request(app)
      .post(`/api/user/collections/${cid}/layout`)
      .send({ name: "Rev 21", tiles: [], groups: [] });
    expect(res.status).toBe(201);
    const meta = (state.collections[0]!["specialMeta"]) as MetaShape;
    expect(meta.layoutRevisions).toHaveLength(20);
    expect(meta.layoutRevisions.some((r) => r.id === revs[0]!.id)).toBe(false); // oldest dropped
    expect(meta.layoutRevisions[19]!.name).toBe("Rev 21");
  });

  it("400s not_special on a standard collection", async () => {
    const cid = seedCollection("user-a", "Plain");
    const res = await request(app)
      .post(`/api/user/collections/${cid}/layout`)
      .send({ name: "X", tiles: [], groups: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("not_special");
  });

  it("rejects a tiles entry missing required fields", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const res = await request(app)
      .post(`/api/user/collections/${cid}/layout`)
      .send({ name: "X", tiles: [{ datasetId: "ds-1" }], groups: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});

describe("DELETE /api/user/collections/:id/layout/:revisionId", () => {
  it("removes the revision and falls the active pointer back to the newest remaining", async () => {
    const [a, b] = [seedRevision(1), seedRevision(2)];
    const cid = seedSpecialCollection("user-a", "Alaska 01", {
      layoutRevisions: [a, b],
      activeRevisionId: b.id,
    });
    const res = await request(app).delete(`/api/user/collections/${cid}/layout/${b.id}`);
    expect(res.status).toBe(204);
    const meta = (state.collections[0]!["specialMeta"]) as MetaShape;
    expect(meta.layoutRevisions).toHaveLength(1);
    expect(meta.activeRevisionId).toBe(a.id);
  });

  it("clears activeRevisionId when the last revision is deleted", async () => {
    const rev = seedRevision(1);
    const cid = seedSpecialCollection("user-a", "Alaska 01", {
      layoutRevisions: [rev],
      activeRevisionId: rev.id,
    });
    const res = await request(app).delete(`/api/user/collections/${cid}/layout/${rev.id}`);
    expect(res.status).toBe(204);
    const meta = (state.collections[0]!["specialMeta"]) as MetaShape;
    expect(meta.layoutRevisions).toHaveLength(0);
    expect(meta.activeRevisionId).toBeNull();
  });

  it("404s for an unknown revision id", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const res = await request(app).delete(`/api/user/collections/${cid}/layout/${uid()}`);
    expect(res.status).toBe(404);
  });
});

describe("background image upload / serve / delete", () => {
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"); // PNG magic + IHDR start

  it("uploads a PNG, stores the file, sets bgImageKey, and serves it back", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const up = await request(app)
      .post(`/api/user/collections/${cid}/background`)
      .attach("file", PNG, { filename: "chart.png", contentType: "image/png" });
    expect(up.status).toBe(200);
    expect(up.body.url).toBe(`/api/user/collections/${cid}/background`);
    const meta = (state.collections[0]!["specialMeta"]) as MetaShape;
    expect(meta.bgImageKey).toBe(`collection-bg/${cid}.png`);
    expect(fs.existsSync(path.join(bgDir, `${cid}.png`))).toBe(true);

    const got = await request(app).get(`/api/user/collections/${cid}/background`);
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toContain("image/png");
    expect(Buffer.compare(got.body as Buffer, PNG)).toBe(0);
  });

  it("re-upload with a different type replaces the old file and key", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    await request(app)
      .post(`/api/user/collections/${cid}/background`)
      .attach("file", PNG, { filename: "chart.png", contentType: "image/png" });
    const up2 = await request(app)
      .post(`/api/user/collections/${cid}/background`)
      .attach("file", Buffer.from("fake-jpeg"), { filename: "chart.jpg", contentType: "image/jpeg" });
    expect(up2.status).toBe(200);
    const meta = (state.collections[0]!["specialMeta"]) as MetaShape;
    expect(meta.bgImageKey).toBe(`collection-bg/${cid}.jpg`);
    expect(fs.existsSync(path.join(bgDir, `${cid}.png`))).toBe(false);
    expect(fs.existsSync(path.join(bgDir, `${cid}.jpg`))).toBe(true);
  });

  it("415s on an unsupported image type", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const res = await request(app)
      .post(`/api/user/collections/${cid}/background`)
      .attach("file", Buffer.from("GIF89a"), { filename: "anim.gif", contentType: "image/gif" });
    expect(res.status).toBe(415);
    expect(res.body.error).toBe("unsupported_media_type");
  });

  it("413s on a file over 10 MB", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const res = await request(app)
      .post(`/api/user/collections/${cid}/background`)
      .attach("file", big, { filename: "huge.png", contentType: "image/png" });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("file_too_large");
  });

  it("400s when no file field is attached", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const res = await request(app).post(`/api/user/collections/${cid}/background`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_file");
  });

  it("400s not_special when uploading to a standard collection", async () => {
    const cid = seedCollection("user-a", "Plain");
    const res = await request(app)
      .post(`/api/user/collections/${cid}/background`)
      .attach("file", PNG, { filename: "chart.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("not_special");
  });

  it("404s on GET when no background is set", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    const res = await request(app).get(`/api/user/collections/${cid}/background`);
    expect(res.status).toBe(404);
  });

  it("DELETE removes the file and clears bgImageKey (idempotent on empty)", async () => {
    const cid = seedSpecialCollection("user-a", "Alaska 01");
    await request(app)
      .post(`/api/user/collections/${cid}/background`)
      .attach("file", PNG, { filename: "chart.png", contentType: "image/png" });
    const del = await request(app).delete(`/api/user/collections/${cid}/background`);
    expect(del.status).toBe(204);
    const meta = (state.collections[0]!["specialMeta"]) as MetaShape;
    expect(meta.bgImageKey).toBeNull();
    expect(fs.existsSync(path.join(bgDir, `${cid}.png`))).toBe(false);

    // Deleting again is a no-op 204.
    const again = await request(app).delete(`/api/user/collections/${cid}/background`);
    expect(again.status).toBe(204);
  });
});
