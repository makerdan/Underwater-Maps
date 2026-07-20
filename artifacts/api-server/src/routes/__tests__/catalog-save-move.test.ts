/**
 * catalog-save-move.test.ts — PATCH /api/datasets/my-saves/:id/move
 *
 * Verifies:
 *  - 200 + updated folderId on success (null → folder, folder → null, folder → folder)
 *  - 404 when the save doesn't exist or belongs to another user
 *  - 400 for a non-UUID path param
 *  - 400 for an invalid body (folderId must be string | null)
 *  - 404 when the target folder doesn't exist
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

type Row = Record<string, unknown>;

const state: {
  saves: Row[];
  folders: Row[];
} = { saves: [], folders: [] };

vi.mock("@workspace/db", () => {
  type TableName = "userCatalogSaves" | "customDatasets" | "datasetFolders";
  const tag = (n: TableName) => ({ __tableName: n });
  const userCatalogSavesTable = tag("userCatalogSaves");
  const customDatasetsTable = tag("customDatasets");
  const datasetFoldersTable = tag("datasetFolders");

  const select = () => ({
    from: (table: { __tableName: TableName }) => ({
      where: () => {
        if (table.__tableName === "userCatalogSaves") {
          return Promise.resolve(
            state.saves.filter((r) => r["userId"] === currentUserId),
          );
        }
        if (table.__tableName === "datasetFolders") {
          return Promise.resolve(
            state.folders.filter((f) => f["userId"] === currentUserId),
          );
        }
        return Promise.resolve([]);
      },
    }),
  });

  const update = (_table: unknown) => ({
    set: (values: Row) => ({
      where: () => ({
        returning: () => {
          const idx = state.saves.findIndex(
            (r) => r["userId"] === currentUserId,
          );
          if (idx === -1) return Promise.resolve([]);
          state.saves[idx] = { ...state.saves[idx]!, ...values };
          return Promise.resolve([state.saves[idx]!]);
        },
      }),
    }),
  });

  return {
    db: {
      select,
      update,
      delete: () => ({ where: () => Promise.resolve([]) }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
    },
    userCatalogSavesTable,
    customDatasetsTable,
    datasetFoldersTable,
    userSettingsTable: {},
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
vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    PatchDatasetsMySavesIdMoveResponse: { parse: (x: unknown) => x },
    PatchDatasetsMySavesIdRenameResponse: { parse: (x: unknown) => x },
    GetDatasetsMySavesResponse: { parse: (x: unknown) => x },
    GetDatasetsMySavesResponseItem: { parse: (x: unknown) => x },
    GetDatasetsMySavesIdStatusResponse: { parse: (x: unknown) => x },
    PostDatasetsMySavesIdRetryResponse: { parse: (x: unknown) => x },
    GetDatasetsCatalogResponse: { parse: (x: unknown) => x },
    GetDatasetsCatalogSearchResponse: { parse: (x: unknown) => x },
    PostDatasetsBboxQueryResponse: { parse: (x: unknown) => x },
    PostDatasetsPointRadiusQueryResponse: { parse: (x: unknown) => x },
  };
});
vi.mock("../../lib/catalogSeeder.js", () => ({
  seedDatasetCatalog: vi.fn(async () => {}),
  getCatalogEntries: vi.fn(async () => []),
  searchCatalog: vi.fn(async () => []),
}));

const { default: app } = await import("../../app.js");

const SAVE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOLDER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_FOLDER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  state.saves = [];
  state.folders = [];
  currentUserId = "user-a";
});

afterAll(() => {
  state.saves = [];
  state.folders = [];
});

describe("PATCH /api/datasets/my-saves/:id/move", () => {
  it("returns 401 when unauthenticated", async () => {
    currentUserId = null;
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/move`)
      .send({ folderId: FOLDER_ID });
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-UUID path param", async () => {
    const res = await request(app)
      .patch("/api/datasets/my-saves/not-a-uuid/move")
      .send({ folderId: null });
    expect(res.status).toBe(400);
  });

  it("returns 400 when folderId key is absent", async () => {
    state.saves = [{ id: SAVE_ID, userId: "user-a", catalogId: "c-1", folderId: null }];
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/move`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when folderId is a non-string/non-null value", async () => {
    state.saves = [{ id: SAVE_ID, userId: "user-a", catalogId: "c-1", folderId: null }];
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/move`)
      .send({ folderId: 42 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when folderId is not a valid UUID string", async () => {
    state.saves = [{ id: SAVE_ID, userId: "user-a", catalogId: "c-1", folderId: null }];
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/move`)
      .send({ folderId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the save belongs to a different user", async () => {
    state.saves = [{ id: SAVE_ID, userId: "user-b", catalogId: "c-1", folderId: null }];
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/move`)
      .send({ folderId: null });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the target folder is not found", async () => {
    // folder not seeded in state.folders → select returns [] → 404
    state.saves = [{ id: SAVE_ID, userId: "user-a", catalogId: "c-1", folderId: null, status: "ready" }];
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/move`)
      .send({ folderId: FOLDER_ID });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 200 and updated folderId when moving to a valid folder", async () => {
    state.saves = [{ id: SAVE_ID, userId: "user-a", catalogId: "c-1", folderId: null, status: "ready", requestedAt: new Date("2024-01-01T00:00:00Z") }];
    state.folders = [{ id: FOLDER_ID, userId: "user-a", name: "Test Folder" }];
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/move`)
      .send({ folderId: FOLDER_ID });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ folderId: FOLDER_ID });
  });

  it("returns 200 and folderId: null when moving to root", async () => {
    state.saves = [{ id: SAVE_ID, userId: "user-a", catalogId: "c-1", folderId: FOLDER_ID, status: "ready", requestedAt: new Date("2024-01-01T00:00:00Z") }];
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/move`)
      .send({ folderId: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ folderId: null });
  });

  it("returns 200 when moving from one folder to another", async () => {
    state.saves = [{ id: SAVE_ID, userId: "user-a", catalogId: "c-1", folderId: FOLDER_ID, status: "ready", requestedAt: new Date("2024-01-01T00:00:00Z") }];
    state.folders = [
      { id: FOLDER_ID, userId: "user-a", name: "Folder A" },
      { id: OTHER_FOLDER, userId: "user-a", name: "Folder B" },
    ];
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/move`)
      .send({ folderId: OTHER_FOLDER });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ folderId: OTHER_FOLDER });
  });
});
