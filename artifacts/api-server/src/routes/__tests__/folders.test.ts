/**
 * folders.test.ts (routes) — integration test for transactional folder ops.
 *
 * Covers the atomicity guarantee added in task #307: when the duplicate-tree
 * walk fails mid-flight, the entire transaction must roll back so no partial
 * folder tree or orphaned dataset rows are left behind.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

type Row = Record<string, unknown>;

const state: {
  folders: Row[];
  datasets: Row[];
  catalogSaves: Row[];
  committedFolders: Row[];
  committedDatasets: Row[];
  failOnChildInsert: boolean;
} = {
  folders: [],
  datasets: [],
  catalogSaves: [],
  committedFolders: [],
  committedDatasets: [],
  failOnChildInsert: false,
};

vi.mock("@workspace/db", () => {
  type TableName = "datasetFolders" | "customDatasets" | "userCatalogSaves";
  const tag = (n: TableName) => ({ __tableName: n });
  const datasetFoldersTable = tag("datasetFolders");
  const customDatasetsTable = tag("customDatasets");
  const userCatalogSavesTable = tag("userCatalogSaves");

  const rowsFor = (t: TableName): Row[] => {
    if (t === "datasetFolders") return state.folders;
    if (t === "customDatasets") return state.datasets;
    return state.catalogSaves;
  };

  // Build a transaction-aware "executor" that holds pending writes in
  // staging arrays. When the transaction callback resolves, staged rows are
  // promoted to the committed* arrays. When it throws, staged rows are
  // discarded (rollback). The non-transactional db proxy commits immediately.
  function makeExecutor(staging?: {
    folders: Row[];
    datasets: Row[];
    childInsertCount: number;
  }) {
    const select = () => ({
      from: (table: { __tableName: TableName }) => ({
        where: () => Promise.resolve(rowsFor(table.__tableName)),
      }),
    });

    const insert = (table: { __tableName: TableName }) => ({
      values: (row: Row) => ({
        returning: async () => {
          if (table.__tableName === "datasetFolders") {
            // Optional fault injection — the first root insert succeeds and the
            // second (child) insert throws. Lets us simulate a mid-walk failure.
            if (staging && staging.folders.length > 0 && state.failOnChildInsert) {
              throw new Error("simulated child insert failure");
            }
            const persisted = {
              ...row,
              id: row["id"] ?? `f${Math.random().toString(36).slice(2, 8)}`,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            if (staging) {
              staging.folders.push(persisted);
              staging.childInsertCount++;
            } else {
              state.committedFolders.push(persisted);
            }
            return [persisted];
          }
          if (table.__tableName === "customDatasets") {
            const persisted = { ...row, id: `d${Math.random().toString(36).slice(2, 8)}` };
            if (staging) {
              staging.datasets.push(persisted);
            } else {
              state.committedDatasets.push(persisted);
            }
            return [persisted];
          }
          return [];
        },
      }),
    });

    const update = () => ({
      set: () => ({ where: () => Promise.resolve([]) }),
    });

    const del = () => ({ where: () => Promise.resolve([]) });

    return { select, insert, update, delete: del };
  }

  const baseExecutor = makeExecutor();

  return {
    db: {
      ...baseExecutor,
      transaction: async <T>(cb: (tx: ReturnType<typeof makeExecutor>) => Promise<T>) => {
        const staging = { folders: [] as Row[], datasets: [] as Row[], childInsertCount: 0 };
        const txExec = makeExecutor(staging);
        try {
          const result = await cb(txExec);
          // Commit staged writes
          state.committedFolders.push(...staging.folders);
          state.committedDatasets.push(...staging.datasets);
          return result;
        } catch (err) {
          // Discard staged writes — this is the rollback semantics under test.
          throw err;
        }
      },
    },
    datasetFoldersTable,
    customDatasetsTable,
    userCatalogSavesTable,
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: "user-tx" })),
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

beforeEach(() => {
  __resetRateLimitMemory();
  state.folders = [];
  state.datasets = [];
  state.catalogSaves = [];
  state.committedFolders = [];
  state.committedDatasets = [];
  state.failOnChildInsert = false;
});

describe("POST /api/user/folders/:id/duplicate — transactional rollback", () => {
  it("rolls back all inserts when a mid-walk insert fails", async () => {
    // Source tree: root → child
    state.folders = [
      { id: "root", userId: "user-tx", parentId: null, name: "Source", createdAt: new Date(), updatedAt: new Date() },
      { id: "child", userId: "user-tx", parentId: "root", name: "Child", createdAt: new Date(), updatedAt: new Date() },
    ];
    state.failOnChildInsert = true;

    const res = await request(app).post("/api/user/folders/root/duplicate").send({});

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "db_error" });
    // The transaction must have rolled back — no folder rows were committed.
    expect(state.committedFolders).toHaveLength(0);
    expect(state.committedDatasets).toHaveLength(0);
  });

  it("commits the full tree when no insert fails", async () => {
    state.folders = [
      { id: "root", userId: "user-tx", parentId: null, name: "Source", createdAt: new Date(), updatedAt: new Date() },
      { id: "child", userId: "user-tx", parentId: "root", name: "Child", createdAt: new Date(), updatedAt: new Date() },
    ];

    const res = await request(app).post("/api/user/folders/root/duplicate").send({});

    expect(res.status).toBe(201);
    // Root + child both committed in a single transaction.
    expect(state.committedFolders).toHaveLength(2);
  });
});
