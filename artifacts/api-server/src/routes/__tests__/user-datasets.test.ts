/**
 * user-datasets.test.ts — integration tests for the user-datasets routes.
 *
 * Covers:
 *  1. Terrain size-pre-check (413, 404, 200, 401)
 *  2. GET  /api/user/datasets           — list datasets (empty, with data, 401)
 *  3. PATCH /api/user/datasets/:id/move   — move (valid, invalid folder, not found)
 *  4. PATCH /api/user/datasets/:id/rename — rename (valid, empty name, not found)
 *  5. DELETE /api/user/datasets/:id       — delete (204, 404, 401)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ─── Stateful mock control ─────────────────────────────────────────────────────
const state: {
  selectCalls: number;
  // terrain size pre-check
  sizeBytes: number | undefined;
  // list of datasets returned by orderBy() in GET /user/datasets
  datasets: {
    id: string;
    name: string;
    minDepth: number;
    maxDepth: number;
    folderId: string | null;
    createdAt: Date;
  }[];
  // folders returned by folder-check select (used by PATCH /move)
  folders: { id: string }[];
  // what PATCH update returns
  updateRow: {
    id: string;
    name: string;
    minDepth: number;
    maxDepth: number;
    folderId: string | null;
    createdAt: Date;
  } | null;
  // what DELETE returns
  deleteRow: { id: string } | null;
} = {
  selectCalls: 0,
  sizeBytes: 1000,
  datasets: [],
  folders: [],
  updateRow: null,
  deleteRow: null,
};

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (tbl: Record<string, unknown>) => {
        const name = String(
          tbl._tableName ?? tbl.tableName ?? Object.keys(tbl)[0] ?? "",
        );
        const isFolder = name.toLowerCase().includes("folder");
        return {
          where: (..._args: unknown[]) => {
            const call = ++state.selectCalls;
            // Determine what a direct await returns (terrain calls don't use orderBy)
            let directResult: unknown[];
            if (isFolder) {
              directResult = state.folders;
            } else if (call === 1) {
              // First select: size pre-check for terrain
              if (state.sizeBytes === undefined) {
                directResult = [];
              } else {
                directResult = [{ size: state.sizeBytes }];
              }
            } else {
              // Second select: full terrain fetch
              directResult = [{ terrainJson: { type: "grid", datasetId: "ds-1" } }];
            }
            return {
              // orderBy: called by GET /user/datasets — returns the datasets list
              orderBy: () => Promise.resolve(state.datasets),
              // Thenable: used by terrain route selects (called without orderBy)
              then: (
                resolve: (v: unknown[]) => unknown,
                reject: (e: unknown) => unknown,
              ) => Promise.resolve(directResult).then(resolve, reject),
            };
          },
        };
      },
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () =>
            state.updateRow != null
              ? Promise.resolve([state.updateRow])
              : Promise.resolve([]),
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () =>
          state.deleteRow != null
            ? Promise.resolve([state.deleteRow])
            : Promise.resolve([]),
      }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  customDatasetsTable: { _tableName: "customDatasets" },
  datasetFoldersTable: { _tableName: "datasetFolders" },
  userSettingsTable: {},
  uploadJobsTable: {},
  datasetCatalogTable: {},
  userCatalogSavesTable: {},
  markersTable: {},
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
  ...actual,
  GetUserDatasetsResponse: { parse: (x: unknown) => x },
  GetUserDatasetsIdTerrainResponse: { parse: (x: unknown) => x },
  GetUserDatasetsIdOverviewResponse: { parse: (x: unknown) => x },
  PatchUserDatasetsIdMoveBody: {
    safeParse: (b: unknown) => {
      if (typeof b !== "object" || b === null)
        return { success: false, error: { issues: [], message: "invalid" } };
      const body = b as Record<string, unknown>;
      if (!("folderId" in body))
        return { success: false, error: { issues: [], message: "folderId required" } };
      return { success: true, data: { folderId: body["folderId"] ?? null } };
    },
  },
  PatchUserDatasetsIdMoveResponse: { parse: (x: unknown) => x },
  PatchUserDatasetsIdRenameBody: {
    safeParse: (b: unknown) => {
      if (typeof b !== "object" || b === null)
        return { success: false, error: { issues: [], message: "invalid" } };
      const body = b as Record<string, unknown>;
      if (typeof body["name"] !== "string")
        return { success: false, error: { issues: [], message: "name is required" } };
      return { success: true, data: { name: body["name"] } };
    },
  },
  PatchUserDatasetsIdRenameResponse: { parse: (x: unknown) => x },
  GetDatasetsResponse: { parse: (x: unknown) => x },
  GetDatasetsIdTerrainResponse: { parse: (x: unknown) => x },
  GetDatasetsIdOverviewResponse: { parse: (x: unknown) => x },
  PostDatasetsUploadResponse: { parse: (x: unknown) => x },
  GetMarkersQueryParams: { safeParse: () => ({ success: false }) },
  PostMarkersBody: {
    safeParse: () => ({ success: false, error: { message: "noop" } }),
  },
  DeleteMarkersIdParams: { safeParse: () => ({ success: false }) },
  PatchMarkersIdParams: { safeParse: () => ({ success: false }) },
  PatchMarkersIdBody: {
    safeParse: () => ({ success: false, error: { message: "noop" } }),
  },
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@workspace/poe", async () => {
  const actual =
    await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return { ...actual, getPoeClient: vi.fn(() => ({})) };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import app from "../../app.js";

const E2E_USER = "user_e2e_terrain_test";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  state.selectCalls = 0;
  state.sizeBytes = 1000;
  state.datasets = [];
  state.folders = [];
  state.updateRow = null;
  state.deleteRow = null;
});

// ─── Terrain size pre-check ────────────────────────────────────────────────────
describe("GET /api/user/datasets/:id/terrain — size pre-check", () => {
  it("returns 413 when pg_column_size exceeds MAX_TERRAIN_JSON_BYTES", async () => {
    state.sizeBytes = 41_000_000;

    const selectCallsBeforeRequest = state.selectCalls;

    const res = await request(app)
      .get("/api/user/datasets/ds-oversized/terrain")
      .set("x-e2e-user-id", E2E_USER);

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      error: "payload_too_large",
      details: "Dataset is too large to load in the browser. Please contact support.",
    });

    // Only the size pre-check SELECT should have been issued — the full
    // terrain SELECT must NOT be issued when the limit is exceeded.
    expect(state.selectCalls - selectCallsBeforeRequest).toBe(1);
  });

  it("returns 404 when no row matches the id/userId pair", async () => {
    state.sizeBytes = undefined; // mock returns []

    const res = await request(app)
      .get("/api/user/datasets/ds-missing/terrain")
      .set("x-e2e-user-id", E2E_USER);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 200 with terrain payload when blob is within the size limit", async () => {
    state.sizeBytes = 1_000_000; // 1 MB — well within the 40 MB limit

    const res = await request(app)
      .get("/api/user/datasets/ds-normal/terrain")
      .set("x-e2e-user-id", E2E_USER);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: "grid", datasetId: "ds-1" });

    // Both the pre-check and the full SELECT should have been issued.
    expect(state.selectCalls).toBe(2);
  });

  it("returns 401 when no auth header is present", async () => {
    vi.unstubAllEnvs();

    const res = await request(app).get("/api/user/datasets/ds-any/terrain");

    expect(res.status).toBe(401);
  });
});

// ─── GET /api/user/datasets — list ───────────────────────────────────────────
describe("GET /api/user/datasets — list datasets", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.unstubAllEnvs();
    const res = await request(app).get("/api/user/datasets");
    expect(res.status).toBe(401);
  });

  it("returns an empty array when user has no datasets", async () => {
    state.datasets = [];
    const res = await request(app)
      .get("/api/user/datasets")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it("returns the user's datasets as a list", async () => {
    state.datasets = [
      {
        id: "ds-abc",
        name: "Survey 1",
        minDepth: 10,
        maxDepth: 200,
        folderId: null,
        createdAt: new Date("2026-01-01"),
      },
    ];
    const res = await request(app)
      .get("/api/user/datasets")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("ds-abc");
    expect(res.body[0].name).toBe("Survey 1");
  });
});

// ─── PATCH /api/user/datasets/:id/move ───────────────────────────────────────
describe("PATCH /api/user/datasets/:id/move — move to folder", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.unstubAllEnvs();
    const res = await request(app)
      .patch("/api/user/datasets/ds-1/move")
      .send({ folderId: null });
    expect(res.status).toBe(401);
  });

  it("returns 400 when folderId is not present in body", async () => {
    const res = await request(app)
      .patch("/api/user/datasets/ds-1/move")
      .set("x-e2e-user-id", E2E_USER)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when folderId references a non-existent folder", async () => {
    state.folders = [];
    const res = await request(app)
      .patch("/api/user/datasets/ds-1/move")
      .set("x-e2e-user-id", E2E_USER)
      .send({ folderId: "nonexistent-folder-id" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_parent");
  });

  it("returns 404 when the dataset does not exist", async () => {
    state.updateRow = null;
    const res = await request(app)
      .patch("/api/user/datasets/nonexistent/move")
      .set("x-e2e-user-id", E2E_USER)
      .send({ folderId: null });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 200 when moved to root (null folderId) successfully", async () => {
    state.updateRow = {
      id: "ds-1",
      name: "Survey 1",
      minDepth: 10,
      maxDepth: 200,
      folderId: null,
      createdAt: new Date("2026-01-01"),
    };
    const res = await request(app)
      .patch("/api/user/datasets/ds-1/move")
      .set("x-e2e-user-id", E2E_USER)
      .send({ folderId: null });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("ds-1");
    expect(res.body.folderId).toBeNull();
  });
});

// ─── PATCH /api/user/datasets/:id/rename ─────────────────────────────────────
describe("PATCH /api/user/datasets/:id/rename — rename dataset", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.unstubAllEnvs();
    const res = await request(app)
      .patch("/api/user/datasets/ds-1/rename")
      .send({ name: "New Name" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing from body", async () => {
    const res = await request(app)
      .patch("/api/user/datasets/ds-1/rename")
      .set("x-e2e-user-id", E2E_USER)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when name is blank (whitespace-only)", async () => {
    const res = await request(app)
      .patch("/api/user/datasets/ds-1/rename")
      .set("x-e2e-user-id", E2E_USER)
      .send({ name: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_name");
  });

  it("returns 404 when the dataset does not exist", async () => {
    state.updateRow = null;
    const res = await request(app)
      .patch("/api/user/datasets/nonexistent/rename")
      .set("x-e2e-user-id", E2E_USER)
      .send({ name: "New Name" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 200 with the renamed dataset on success", async () => {
    state.updateRow = {
      id: "ds-1",
      name: "New Name",
      minDepth: 5,
      maxDepth: 100,
      folderId: null,
      createdAt: new Date("2026-01-01"),
    };
    const res = await request(app)
      .patch("/api/user/datasets/ds-1/rename")
      .set("x-e2e-user-id", E2E_USER)
      .send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("ds-1");
    expect(res.body.name).toBe("New Name");
  });
});

// ─── DELETE /api/user/datasets/:id ───────────────────────────────────────────
describe("DELETE /api/user/datasets/:id — delete dataset", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.unstubAllEnvs();
    const res = await request(app).delete("/api/user/datasets/ds-1");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the dataset does not exist", async () => {
    state.deleteRow = null;
    const res = await request(app)
      .delete("/api/user/datasets/nonexistent")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 204 when the dataset is deleted successfully", async () => {
    state.deleteRow = { id: "ds-1" };
    const res = await request(app)
      .delete("/api/user/datasets/ds-1")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(204);
  });
});
