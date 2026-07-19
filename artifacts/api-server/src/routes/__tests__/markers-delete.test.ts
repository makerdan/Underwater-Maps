/**
 * markers-delete.test.ts — unit tests for DELETE /api/markers/:id
 *
 * Covers:
 *  - 400 for malformed marker id
 *  - 401 for unauthenticated callers
 *  - 404 when the marker is not owned by the caller
 *  - 204 happy path with no catch entries (no photo cleanup)
 *  - 204 happy path with catch entries that have photos — verifies all photo
 *    objects are passed to deleteObjectEntity (best-effort cleanup)
 *  - photo cleanup is still best-effort: a storage error does not affect the 204
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const VALID_UUID = "00000000-0000-0000-0000-000000000001";

const state = {
  catchEntryRows: [] as Array<{ photos: string[] }>,
  deletedMarkerRows: [] as Array<{ id: string }>,
};

vi.mock("@workspace/db", () => {
  const markersTable = { __tableName: "markers" as const, id: "id", userId: "userId" };
  const catchEntriesTable = {
    __tableName: "catch_entries" as const,
    markerId: "markerId",
    photos: "photos",
  };
  const catchCountersTable = { __tableName: "catch_counters" as const, userId: "userId", lastSeq: "lastSeq" };

  const select = () => ({
    from: (table: { __tableName: string }) => ({
      where: () => {
        if (table.__tableName === "catch_entries") {
          return Promise.resolve(state.catchEntryRows);
        }
        return Promise.resolve([]);
      },
    }),
  });

  const del = () => ({
    where: () => ({
      returning: () => Promise.resolve(state.deletedMarkerRows),
    }),
  });

  return {
    db: { select, delete: del },
    markersTable,
    catchEntriesTable,
    catchCountersTable,
  };
});

vi.mock("@workspace/api-zod", () => {
  const uuidParse = (key: string) => ({
    safeParse: (p: Record<string, unknown>) => {
      const v = p[key];
      return typeof v === "string" && /^[0-9a-f-]{36}$/.test(v)
        ? { success: true, data: { [key]: v } }
        : { success: false, error: { issues: [] } };
    },
  });

  return {
    GetMarkersQueryParams: { safeParse: () => ({ success: false }) },
    PostMarkersBody: { safeParse: () => ({ success: false, error: { message: "noop" } }) },
    PatchMarkersIdParams: uuidParse("id"),
    PatchMarkersIdBody: { safeParse: () => ({ success: false, error: { message: "noop" } }) },
    DeleteMarkersIdParams: uuidParse("id"),
    GetCatchesQueryParams: { safeParse: () => ({ success: false }) },
    GetMarkersMarkerIdCatchesParams: { safeParse: () => ({ success: false }) },
    PostMarkersMarkerIdCatchesParams: { safeParse: () => ({ success: false }) },
    PostMarkersMarkerIdCatchesBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchCatchesIdParams: { safeParse: () => ({ success: false }) },
    PatchCatchesIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    DeleteCatchesIdParams: { safeParse: () => ({ success: false }) },
    GetUserDatasetsResponse: { parse: (x: unknown) => x },
    GetUserDatasetsIdTerrainResponse: { parse: (x: unknown) => x },
    GetUserDatasetsIdOverviewResponse: { parse: (x: unknown) => x },
    PatchUserDatasetsIdMoveBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchUserDatasetsIdMoveResponse: { parse: (x: unknown) => x },
    PatchUserDatasetsIdRenameBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchUserDatasetsIdRenameResponse: { parse: (x: unknown) => x },
    PostRouteBodySchema: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchRouteBodySchema: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetRoutesQuerySchema: { safeParse: () => ({ success: false }) },
    RouteIdParamSchema: { safeParse: () => ({ success: false }) },
    PostTrollingPresetsBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchTrollingPresetsIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    DeleteTrollingPresetsIdParams: { safeParse: () => ({ success: false }) },
    PostTrollingPresetFoldersBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchTrollingPresetFoldersIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetUserFoldersResponse: { parse: (x: unknown) => x },
    PostUserFoldersBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchUserFoldersIdRenameBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchUserFoldersIdRenameResponse: { parse: (x: unknown) => x },
    PatchUserFoldersIdMoveBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    PatchUserFoldersIdMoveResponse: { parse: (x: unknown) => x },
    DeleteUserFoldersIdBody: { safeParse: () => ({ success: false, error: { issues: [], message: "noop" } }) },
    GetDatasetsResponse: { parse: (x: unknown) => x },
    GetDatasetsIdTerrainResponse: { parse: (x: unknown) => x },
    GetDatasetsIdOverviewResponse: { parse: (x: unknown) => x },
    PostDatasetsUploadResponse: { parse: (x: unknown) => x },
  };
});

const deletedObjectPaths: string[] = [];
const storageErrors = new Set<string>();

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async deleteObjectEntity(path: string): Promise<void> {
      if (storageErrors.has(path)) throw new Error(`Simulated storage failure for ${path}`);
      deletedObjectPaths.push(path);
    }
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
  state.catchEntryRows = [];
  state.deletedMarkerRows = [];
  deletedObjectPaths.length = 0;
  storageErrors.clear();
});

describe("DELETE /api/markers/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.unstubAllEnvs();
    const res = await request(app).delete(`/api/markers/${VALID_UUID}`);
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed (non-UUID) marker id", async () => {
    const res = await request(app)
      .delete("/api/markers/not-a-uuid")
      .set("x-e2e-user-id", "user-del");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 404 when the marker does not belong to the caller", async () => {
    state.deletedMarkerRows = [];
    const res = await request(app)
      .delete(`/api/markers/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-del");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 204 and skips photo cleanup when marker has no catch entries", async () => {
    state.catchEntryRows = [];
    state.deletedMarkerRows = [{ id: VALID_UUID }];

    const res = await request(app)
      .delete(`/api/markers/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-del");

    expect(res.status).toBe(204);
    expect(deletedObjectPaths).toHaveLength(0);
  });

  it("deletes all photo objects from catch entries on marker delete", async () => {
    state.catchEntryRows = [
      { photos: ["/objects/uploads/photo-a", "/objects/uploads/photo-b"] },
      { photos: ["/objects/uploads/photo-c"] },
    ];
    state.deletedMarkerRows = [{ id: VALID_UUID }];

    const res = await request(app)
      .delete(`/api/markers/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-del");

    expect(res.status).toBe(204);

    // Give the void Promise.allSettled() microtasks a chance to flush
    await new Promise((r) => setImmediate(r));

    expect(deletedObjectPaths.sort()).toEqual([
      "/objects/uploads/photo-a",
      "/objects/uploads/photo-b",
      "/objects/uploads/photo-c",
    ]);
  });

  it("returns 204 even when some photo object deletions fail (best-effort)", async () => {
    state.catchEntryRows = [
      { photos: ["/objects/uploads/photo-ok", "/objects/uploads/photo-fail"] },
    ];
    state.deletedMarkerRows = [{ id: VALID_UUID }];
    storageErrors.add("/objects/uploads/photo-fail");

    const res = await request(app)
      .delete(`/api/markers/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-del");

    expect(res.status).toBe(204);

    await new Promise((r) => setImmediate(r));

    // Only the successful deletion is recorded; the failed one did not crash the request
    expect(deletedObjectPaths).toEqual(["/objects/uploads/photo-ok"]);
  });

  it("deletes photos from catch entries with empty photos arrays without error", async () => {
    state.catchEntryRows = [
      { photos: [] },
      { photos: ["/objects/uploads/photo-x"] },
    ];
    state.deletedMarkerRows = [{ id: VALID_UUID }];

    const res = await request(app)
      .delete(`/api/markers/${VALID_UUID}`)
      .set("x-e2e-user-id", "user-del");

    expect(res.status).toBe(204);

    await new Promise((r) => setImmediate(r));

    expect(deletedObjectPaths).toEqual(["/objects/uploads/photo-x"]);
  });
});
