/**
 * catalog-save-delete.test.ts — DELETE /api/datasets/my-saves/:id
 *
 * Verifies:
 *  - 404 when the save row doesn't belong to the calling user (ownership).
 *  - 204 on success, deleting both the user_catalog_saves row and the
 *    linked custom_datasets row (when datasetId is set).
 *  - The custom_datasets delete is gated on userId too, so a forged
 *    datasetId can't take down someone else's dataset.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

type Row = Record<string, unknown>;

const state: {
  saves: Row[];
  datasets: Row[];
  deletedSaveIds: string[];
  deletedDatasetIds: string[];
} = {
  saves: [],
  datasets: [],
  deletedSaveIds: [],
  deletedDatasetIds: [],
};

vi.mock("@workspace/db", () => {
  type TableName = "userCatalogSaves" | "customDatasets";
  const tag = (n: TableName) => ({ __tableName: n });
  const userCatalogSavesTable = tag("userCatalogSaves");
  const customDatasetsTable = tag("customDatasets");

  // The handler builds where-clauses using drizzle's `and(eq(...), eq(...))`,
  // which the mock can't introspect. We instead read the userId from the
  // request's auth context (set in the clerk mock below) and filter manually.
  function rowsFor(t: TableName): Row[] {
    return t === "userCatalogSaves" ? state.saves : state.datasets;
  }

  const select = () => ({
    from: (table: { __tableName: TableName }) => ({
      where: () =>
        Promise.resolve(
          rowsFor(table.__tableName).filter((r) => r["userId"] === currentUserId),
        ),
    }),
  });

  const del = (table: { __tableName: TableName }) => ({
    where: () => {
      if (table.__tableName === "userCatalogSaves") {
        const remaining: Row[] = [];
        for (const r of state.saves) {
          if (r["userId"] === currentUserId) {
            state.deletedSaveIds.push(String(r["id"]));
          } else {
            remaining.push(r);
          }
        }
        state.saves = remaining;
      } else {
        const remaining: Row[] = [];
        for (const r of state.datasets) {
          if (r["userId"] === currentUserId) {
            state.deletedDatasetIds.push(String(r["id"]));
          } else {
            remaining.push(r);
          }
        }
        state.datasets = remaining;
      }
      return Promise.resolve([]);
    },
  });

  return {
    db: {
      select,
      delete: del,
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
      transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
    },
    userCatalogSavesTable,
    customDatasetsTable,
    userSettingsTable: {},
    datasetFoldersTable: {},
  };
});

let currentUserId: string | null = "user-a";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: currentUserId })),
}));
vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock("@clerk/shared/keys", () => ({ publishableKeyFromHost: vi.fn(() => "pk_test_mock") }));
vi.mock("../../lib/catalogSeeder.js", () => ({
  seedDatasetCatalog: vi.fn(async () => {}),
  getCatalogEntries: vi.fn(async () => []),
  searchCatalog: vi.fn(async () => []),
}));

const { default: app } = await import("../../app.js");

beforeEach(() => {
  state.saves = [];
  state.datasets = [];
  state.deletedSaveIds = [];
  state.deletedDatasetIds = [];
  currentUserId = "user-a";
});

describe("DELETE /api/datasets/my-saves/:id", () => {
  it("returns 404 when the save belongs to a different user", async () => {
    state.saves = [{ id: "save-1", userId: "user-b", catalogId: "preset-x", datasetId: "ds-1" }];
    state.datasets = [{ id: "ds-1", userId: "user-b" }];

    const res = await request(app).delete("/api/datasets/my-saves/save-1");

    expect(res.status).toBe(404);
    expect(state.saves).toHaveLength(1);
    expect(state.datasets).toHaveLength(1);
    expect(state.deletedSaveIds).toHaveLength(0);
    expect(state.deletedDatasetIds).toHaveLength(0);
  });

  it("returns 404 when the save id doesn't exist", async () => {
    const res = await request(app).delete("/api/datasets/my-saves/missing");
    expect(res.status).toBe(404);
  });

  it("deletes the save and the linked custom_datasets row on success", async () => {
    state.saves = [{ id: "save-1", userId: "user-a", catalogId: "preset-x", datasetId: "ds-1" }];
    state.datasets = [{ id: "ds-1", userId: "user-a" }];

    const res = await request(app).delete("/api/datasets/my-saves/save-1");

    expect(res.status).toBe(204);
    expect(state.deletedSaveIds).toContain("save-1");
    expect(state.deletedDatasetIds).toContain("ds-1");
    expect(state.saves).toHaveLength(0);
    expect(state.datasets).toHaveLength(0);
  });

  it("deletes the save even when no dataset has been materialized yet", async () => {
    state.saves = [{ id: "save-2", userId: "user-a", catalogId: "preset-y", datasetId: null }];

    const res = await request(app).delete("/api/datasets/my-saves/save-2");

    expect(res.status).toBe(204);
    expect(state.deletedSaveIds).toContain("save-2");
    expect(state.deletedDatasetIds).toHaveLength(0);
  });

  it("rejects unauthenticated callers", async () => {
    currentUserId = null;
    const res = await request(app).delete("/api/datasets/my-saves/save-1");
    expect(res.status).toBe(401);
  });
});
