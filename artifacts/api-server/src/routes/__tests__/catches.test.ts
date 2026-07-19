/**
 * catches.test.ts — unit tests for the catch-journal routes.
 *
 * Covers:
 *  - 401 for unauthenticated callers on every endpoint
 *  - 400 for missing datasetId on GET /catches
 *  - 404 when creating a catch on a marker the caller does not own
 *  - 400 for photo paths not under /objects/ and for exceeding MAX_PHOTOS
 *  - 201 create happy path (with ACLs applied via mocked ObjectStorageService)
 *  - 404 on PATCH/DELETE of a non-existent catch entry
 *  - 204 delete happy path
 *  - photo deletion on entry delete and on PATCH photo removal
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const state = {
  markerRows: [] as Array<{ id: string }>,
  catchRows: [] as Array<Record<string, unknown>>,
  /** Rows to return when SELECT before-update is run (for photo diff). */
  beforeRow: null as { photos: string[] } | null,
  updatedRows: [] as Array<Record<string, unknown>>,
  deletedRows: [] as Array<{ id: string; photos: string[] }>,
};

vi.mock("@workspace/db", () => {
  const markersTable = { __tableName: "markers" as const, id: "id", datasetId: "datasetId", userId: "userId" };
  const catchEntriesTable = {
    __tableName: "catch_entries" as const,
    id: "id", markerId: "markerId", userId: "userId", createdAt: "createdAt", photos: "photos",
  };

  // The PATCH handler does a SELECT before UPDATE (to diff photos).
  // The GET handlers append .orderBy() to the chain.
  // We distinguish them: a bare .where() result (no .orderBy called) uses
  // `state.beforeRow` when set; an .orderBy() call uses `state.catchRows`.
  // Markers selects always use state.markerRows.
  const select = () => ({
    from: (table: { __tableName: string }) => ({
      where: () => {
        if (table.__tableName === "markers") {
          return Object.assign(Promise.resolve(state.markerRows), {
            orderBy: () => Promise.resolve(state.markerRows),
          });
        }
        // catch_entries: bare where() (before-select in PATCH) vs orderBy (GET)
        const beforeResult = state.beforeRow !== null ? [state.beforeRow] : [];
        return Object.assign(Promise.resolve(beforeResult), {
          orderBy: () => Promise.resolve(state.catchRows),
        });
      },
    }),
  });

  const insert = () => ({
    values: (v: Record<string, unknown>) => ({
      returning: () => Promise.resolve([{ id: "catch-1", ...v }]),
    }),
  });

  const update = () => ({
    set: (v: Record<string, unknown>) => ({
      where: () => ({
        returning: () => Promise.resolve(
          state.updatedRows.map((r) => ({ ...r, ...v })),
        ),
      }),
    }),
  });

  const del = () => ({
    where: () => ({
      returning: () => Promise.resolve(state.deletedRows),
    }),
  });

  return {
    db: { select, insert, update, delete: del },
    markersTable,
    catchEntriesTable,
  };
});

const VALID_UUID = "00000000-0000-0000-0000-000000000001";

vi.mock("@workspace/api-zod", () => {
  const uuidParse = (key: string) => ({
    safeParse: (p: Record<string, unknown>) => {
      const v = p[key];
      return typeof v === "string" && /^[0-9a-f-]{36}$/.test(v)
        ? { success: true, data: { [key]: v } }
        : { success: false };
    },
  });
  return {
    GetCatchesQueryParams: {
      safeParse: (q: Record<string, unknown>) =>
        q["datasetId"]
          ? { success: true, data: { datasetId: q["datasetId"] } }
          : { success: false },
    },
    GetMarkersMarkerIdCatchesParams: uuidParse("markerId"),
    PostMarkersMarkerIdCatchesParams: uuidParse("markerId"),
    PostMarkersMarkerIdCatchesBody: {
      safeParse: (b: Record<string, unknown>) =>
        typeof b["symbol"] === "string" && (b["symbol"] as string).length > 0
          ? { success: true, data: b }
          : { success: false, error: { message: "symbol required", issues: [] } },
    },
    PatchCatchesIdParams: uuidParse("id"),
    PatchCatchesIdBody: {
      safeParse: (b: Record<string, unknown>) => ({ success: true, data: { ...b } }),
    },
    DeleteCatchesIdParams: uuidParse("id"),
    // Referenced by other routes mounted in app.ts:
    GetMarkersQueryParams: { safeParse: () => ({ success: false }) },
    PostMarkersBody: { safeParse: () => ({ success: false, error: { message: "noop" } }) },
    DeleteMarkersIdParams: { safeParse: () => ({ success: false }) },
    PatchMarkersIdParams: { safeParse: () => ({ success: false }) },
    PatchMarkersIdBody: { safeParse: () => ({ success: false, error: { message: "noop" } }) },
  };
});

const aclCalls: Array<{ path: string; owner: string }> = [];
// Per-path fixture state for the ACL-authorization flow:
//  - paths in `existingPolicies` already have an ACL policy (owner recorded);
//  - paths in `missingObjects` do not exist in storage at all;
//  - all other /objects/ paths exist and are unclaimed (no policy yet).
const aclState = {
  existingPolicies: new Map<string, { owner: string; visibility: "private" | "public" }>(),
  missingObjects: new Set<string>(),
};

const MockObjectNotFoundError = vi.hoisted(() => class MockObjectNotFoundError extends Error {});

const deletedObjectPaths: string[] = [];

vi.mock("../../lib/objectStorage", () => ({
  ObjectNotFoundError: MockObjectNotFoundError,
  ObjectStorageService: class {
    async getObjectEntityFile(path: string) {
      if (aclState.missingObjects.has(path)) throw new MockObjectNotFoundError();
      return { __path: path };
    }
    async getObjectEntityUploadURL() {
      return "https://storage.example.com/signed-upload";
    }
    normalizeObjectEntityPath(url: string) {
      return url.startsWith("/objects/")
        ? url
        : `/objects/uploads/${url.split("/").pop()}`;
    }
    async deleteObjectEntity(path: string) {
      deletedObjectPaths.push(path);
    }
  },
}));

vi.mock("../../lib/objectAcl", () => ({
  getObjectAclPolicy: async (file: { __path: string }) =>
    aclState.existingPolicies.get(file.__path) ?? null,
  setObjectAclPolicy: async (file: { __path: string }, policy: { owner: string; visibility: "private" | "public" }) => {
    aclCalls.push({ path: file.__path, owner: policy.owner });
    aclState.existingPolicies.set(file.__path, policy);
  },
}));

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
  const actual = await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return { ...actual, getPoeClient: vi.fn(() => ({})) };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import app from "../../app.js";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  state.markerRows = [];
  state.catchRows = [];
  state.beforeRow = null;
  state.updatedRows = [];
  state.deletedRows = [];
  deletedObjectPaths.length = 0;
  aclCalls.length = 0;
  aclState.existingPolicies.clear();
  aclState.missingObjects.clear();
});

describe("GET /api/catches", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.unstubAllEnvs();
    const res = await request(app).get("/api/catches?datasetId=abc");
    expect(res.status).toBe(401);
  });

  it("returns 400 when datasetId is missing", async () => {
    const res = await request(app)
      .get("/api/catches")
      .set("x-e2e-user-id", "user-c");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns [] when the user has no markers in the dataset", async () => {
    const res = await request(app)
      .get("/api/catches?datasetId=ds-1")
      .set("x-e2e-user-id", "user-c");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns catch rows when markers exist", async () => {
    state.markerRows = [{ id: VALID_UUID }];
    state.catchRows = [{ id: "c1", markerId: VALID_UUID, symbol: "🐟" }];
    const res = await request(app)
      .get("/api/catches?datasetId=ds-1")
      .set("x-e2e-user-id", "user-c");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ symbol: "🐟" });
  });
});

describe("GET /api/markers/:markerId/catches", () => {
  it("returns 400 for a malformed marker id", async () => {
    const res = await request(app)
      .get("/api/markers/not-a-uuid/catches")
      .set("x-e2e-user-id", "user-c");
    expect(res.status).toBe(400);
  });

  it("returns 404 when the marker is not owned by the caller", async () => {
    const res = await request(app)
      .get(`/api/markers/${VALID_UUID}/catches`)
      .set("x-e2e-user-id", "user-c");
    expect(res.status).toBe(404);
  });

  it("returns the marker's catches when owned", async () => {
    state.markerRows = [{ id: VALID_UUID }];
    state.catchRows = [{ id: "c1", markerId: VALID_UUID, symbol: "🦀" }];
    const res = await request(app)
      .get(`/api/markers/${VALID_UUID}/catches`)
      .set("x-e2e-user-id", "user-c");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ symbol: "🦀" });
  });
});

describe("POST /api/markers/:markerId/catches", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.unstubAllEnvs();
    const res = await request(app)
      .post(`/api/markers/${VALID_UUID}/catches`)
      .send({ symbol: "🐟" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when symbol is missing", async () => {
    state.markerRows = [{ id: VALID_UUID }];
    const res = await request(app)
      .post(`/api/markers/${VALID_UUID}/catches`)
      .set("x-e2e-user-id", "user-c")
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for a photo path not under /objects/", async () => {
    state.markerRows = [{ id: VALID_UUID }];
    const res = await request(app)
      .post(`/api/markers/${VALID_UUID}/catches`)
      .set("x-e2e-user-id", "user-c")
      .send({ symbol: "🐟", photos: ["https://evil.example.com/x.png"] });
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("/objects/");
  });

  it("returns 400 when more than 6 photos are supplied", async () => {
    state.markerRows = [{ id: VALID_UUID }];
    const photos = Array.from({ length: 7 }, (_, i) => `/objects/uploads/p${i}`);
    const res = await request(app)
      .post(`/api/markers/${VALID_UUID}/catches`)
      .set("x-e2e-user-id", "user-c")
      .send({ symbol: "🐟", photos });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the marker is not owned by the caller", async () => {
    const res = await request(app)
      .post(`/api/markers/${VALID_UUID}/catches`)
      .set("x-e2e-user-id", "user-c")
      .send({ symbol: "🐟" });
    expect(res.status).toBe(404);
  });

  it("creates the entry (201) and applies per-user ACLs to photos", async () => {
    state.markerRows = [{ id: VALID_UUID }];
    const res = await request(app)
      .post(`/api/markers/${VALID_UUID}/catches`)
      .set("x-e2e-user-id", "user-c")
      .send({ symbol: "🐟", symbolName: "Fish", notes: "Nice one", photos: ["/objects/uploads/a"] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ symbol: "🐟", notes: "Nice one" });
    expect(aclCalls).toEqual([{ path: "/objects/uploads/a", owner: "user-c" }]);
  });

  it("returns 403 when a photo object is already owned by another user (no ACL takeover)", async () => {
    state.markerRows = [{ id: VALID_UUID }];
    aclState.existingPolicies.set("/objects/uploads/theirs", { owner: "user-other", visibility: "private" });
    const res = await request(app)
      .post(`/api/markers/${VALID_UUID}/catches`)
      .set("x-e2e-user-id", "user-c")
      .send({ symbol: "🐟", photos: ["/objects/uploads/theirs"] });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "forbidden" });
    // Ownership must NOT be reassigned:
    expect(aclCalls).toEqual([]);
    expect(aclState.existingPolicies.get("/objects/uploads/theirs")?.owner).toBe("user-other");
  });

  it("accepts a photo object the caller already owns without rewriting the ACL", async () => {
    state.markerRows = [{ id: VALID_UUID }];
    aclState.existingPolicies.set("/objects/uploads/mine", { owner: "user-c", visibility: "private" });
    const res = await request(app)
      .post(`/api/markers/${VALID_UUID}/catches`)
      .set("x-e2e-user-id", "user-c")
      .send({ symbol: "🐟", photos: ["/objects/uploads/mine"] });
    expect(res.status).toBe(201);
    expect(aclCalls).toEqual([]);
  });

  it("returns 400 when a photo object does not exist in storage", async () => {
    state.markerRows = [{ id: VALID_UUID }];
    aclState.missingObjects.add("/objects/uploads/ghost");
    const res = await request(app)
      .post(`/api/markers/${VALID_UUID}/catches`)
      .set("x-e2e-user-id", "user-c")
      .send({ symbol: "🐟", photos: ["/objects/uploads/ghost"] });
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("does not exist");
  });
});

describe("PATCH /api/catches/:id", () => {
  it("returns 400 for an empty patch body", async () => {
    const res = await request(app)
      .patch(`/api/catches/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-c")
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 when the entry does not exist / is not owned", async () => {
    const res = await request(app)
      .patch(`/api/catches/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-c")
      .send({ notes: "updated" });
    expect(res.status).toBe(404);
  });

  it("returns 403 when patching in a photo object owned by another user", async () => {
    state.updatedRows = [{ id: VALID_UUID, symbol: "🐟" }];
    aclState.existingPolicies.set("/objects/uploads/theirs", { owner: "user-other", visibility: "private" });
    const res = await request(app)
      .patch(`/api/catches/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-c")
      .send({ photos: ["/objects/uploads/theirs"] });
    expect(res.status).toBe(403);
    expect(aclState.existingPolicies.get("/objects/uploads/theirs")?.owner).toBe("user-other");
  });

  it("updates and returns the entry when owned", async () => {
    state.updatedRows = [{ id: VALID_UUID, symbol: "🐟" }];
    const res = await request(app)
      .patch(`/api/catches/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-c")
      .send({ notes: "updated" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ notes: "updated" });
  });

  it("deletes removed photo objects when photos list is replaced", async () => {
    state.beforeRow = { photos: ["/objects/uploads/old1", "/objects/uploads/old2"] };
    state.updatedRows = [{ id: VALID_UUID, symbol: "🐟", photos: ["/objects/uploads/new1"] }];
    const res = await request(app)
      .patch(`/api/catches/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-c")
      .send({ photos: ["/objects/uploads/new1"] });
    expect(res.status).toBe(200);
    // Allow fire-and-forget to settle.
    await new Promise((r) => setImmediate(r));
    expect(deletedObjectPaths).toContain("/objects/uploads/old1");
    expect(deletedObjectPaths).toContain("/objects/uploads/old2");
    expect(deletedObjectPaths).not.toContain("/objects/uploads/new1");
  });

  it("does not delete photos when the photos field is not in the patch body", async () => {
    state.beforeRow = { photos: ["/objects/uploads/keep"] };
    state.updatedRows = [{ id: VALID_UUID, symbol: "🐟" }];
    const res = await request(app)
      .patch(`/api/catches/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-c")
      .send({ notes: "note only" });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(deletedObjectPaths).toHaveLength(0);
  });
});

describe("DELETE /api/catches/:id", () => {
  it("returns 404 when the entry does not exist / is not owned", async () => {
    const res = await request(app)
      .delete(`/api/catches/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-c");
    expect(res.status).toBe(404);
  });

  it("returns 204 on successful delete", async () => {
    state.deletedRows = [{ id: VALID_UUID, photos: [] }];
    const res = await request(app)
      .delete(`/api/catches/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-c");
    expect(res.status).toBe(204);
  });

  it("deletes photo objects from storage when the entry has photos", async () => {
    state.deletedRows = [{ id: VALID_UUID, photos: ["/objects/uploads/p1", "/objects/uploads/p2"] }];
    const res = await request(app)
      .delete(`/api/catches/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-c");
    expect(res.status).toBe(204);
    // Allow Promise.allSettled fire-and-forget to resolve before asserting.
    await new Promise((r) => setImmediate(r));
    expect(deletedObjectPaths).toContain("/objects/uploads/p1");
    expect(deletedObjectPaths).toContain("/objects/uploads/p2");
  });
});

describe("POST /api/catch-photos/upload-url", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.unstubAllEnvs();
    const res = await request(app).post("/api/catch-photos/upload-url");
    expect(res.status).toBe(401);
  });

  it("returns a signed uploadURL and normalized objectPath", async () => {
    const res = await request(app)
      .post("/api/catch-photos/upload-url")
      .set("x-e2e-user-id", "user-c");
    expect(res.status).toBe(200);
    expect(res.body.uploadURL).toContain("https://");
    expect(res.body.objectPath).toMatch(/^\/objects\//);
  });
});
