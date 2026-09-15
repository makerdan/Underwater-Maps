import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state: {
  rows: Record<string, { terrainJson: unknown }>;
} = { rows: {} };

const PUBLIC_ID = "public-fixture";
const USER_A_ID = "11111111-2222-4333-8444-555555555555";
const USER_B_ID = "22222222-3333-4444-8555-666666666666";

function healthy(datasetId: string): Record<string, unknown> {
  return {
    datasetId,
    width: 2,
    height: 2,
    depths: [1, 2, 3, 4],
    minDepth: 1,
    maxDepth: 4,
    minLon: -123,
    maxLon: -122,
    minLat: 47,
    maxLat: 48,
    centerLon: -122.5,
    centerLat: 47.5,
    dataSource: "ncei",
  };
}

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn((req: { clerkUserId?: string }) => ({ userId: req.clerkUserId ?? null })),
}));

vi.mock("@workspace/db", () => ({
  customDatasetsTable: { id: "id", userId: "userId", terrainJson: "terrainJson" },
  db: {
    select: () => ({
      from: () => ({
        where: (conditions: Array<{ column: string; value: string }>) => {
          const id = conditions.find((condition) => condition.column === "id")?.value;
          const userId = conditions.find((condition) => condition.column === "userId")?.value;
          const owner = id === USER_A_ID ? "user-a" : id === USER_B_ID ? "user-b" : null;
          return Promise.resolve(
            id && state.rows[id] && owner === userId ? [state.rows[id]] : [],
          );
        },
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (column: string, value: string) => ({ column, value }),
}));

vi.mock("../../lib/terrain.js", () => ({
  ALL_PRESET_DATASETS: [{ id: "public-fixture" }],
  buildTerrainGrid: vi.fn(async (id: string) => healthy(id)),
  NoDataError: class NoDataError extends Error {},
}));

vi.mock("../../middlewares/requireAuth.js", () => ({
  requireAuth: (
    req: { headers: Record<string, string | string[] | undefined>; clerkUserId?: string },
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const userId = req.headers["x-test-user-id"];
    if (typeof userId !== "string" || userId.length === 0) {
      res.status(401).json({ error: "unauthenticated", details: "Authentication required" });
      return;
    }
    req.clerkUserId = userId;
    next();
  },
}));

import { publicDatasetAuditRouter, userDatasetAuditRouter } from "../dataset-audit.js";

const app = express();
app.use(publicDatasetAuditRouter);
app.use(userDatasetAuditRouter);

beforeEach(() => {
  state.rows = {
    [USER_A_ID]: { terrainJson: healthy(USER_A_ID) },
    [USER_B_ID]: {
      terrainJson: {
        datasetId: USER_B_ID,
        width: 2,
        height: 2,
        depths: [-1, "private-object-path", null, null],
        minLon: 10,
        maxLon: 9,
        minLat: 48,
        maxLat: 47,
        centerLon: 9.5,
        centerLat: 47.5,
        dataSource: "ncei",
        endpointUrl: "https://user:password@example.invalid/private-object",
      },
    },
  };
});

describe("dataset audit publication", () => {
  it("publishes a report for a public built-in dataset", async () => {
    const response = await request(app).get(`/datasets/${PUBLIC_ID}/audit`);

    expect(response.status).toBe(200);
    expect(response.body.datasetId).toBe(PUBLIC_ID);
    expect(response.body.gpsPlacementReady).toBe(true);
  });

  it("keeps public unknown and malformed ids on established error paths", async () => {
    await expect(request(app).get("/datasets/not-known/audit")).resolves.toMatchObject({
      status: 404,
      body: { error: "not_found" },
    });
    await expect(request(app).get("/datasets/bad.id/audit")).resolves.toMatchObject({
      status: 400,
      body: { error: "invalid_param" },
    });
  });

  it("requires authentication and hides another user's dataset", async () => {
    const unauthenticated = await request(app).get(`/user/datasets/${USER_A_ID}/audit`);
    expect(unauthenticated.status).toBe(401);

    const unauthorized = await request(app)
      .get(`/user/datasets/${USER_A_ID}/audit`)
      .set("x-test-user-id", "different-user");
    expect(unauthorized.status).toBe(404);
    expect(unauthorized.body.error).toBe("not_found");
  });

  it("preserves dataset identity, severity, and failure details without cross-report mixing", async () => {
    const ready = await request(app)
      .get(`/user/datasets/${USER_A_ID}/audit`)
      .set("x-test-user-id", "user-a");
    const blocked = await request(app)
      .get(`/user/datasets/${USER_B_ID}/audit`)
      .set("x-test-user-id", "user-b");

    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({
      datasetId: USER_A_ID,
      status: "pass",
      gpsPlacementReady: true,
    });
    expect(ready.body.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "grid_values_non_finite", severity: "blocked" }),
    ]));

    expect(blocked.status).toBe(200);
    expect(blocked.body).toMatchObject({
      datasetId: USER_B_ID,
      status: "blocked",
      gpsPlacementReady: false,
    });
    expect(blocked.body.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "blocked",
        reason: "grid_values_non_finite",
      }),
      expect.objectContaining({
        severity: "blocked",
        reason: "depth_semantics_invalid",
      }),
      expect.objectContaining({
        severity: "blocked",
        reason: "bbox_invalid",
      }),
    ]));
    expect(JSON.stringify(blocked.body)).not.toContain("private-object");
    expect(JSON.stringify(blocked.body)).not.toContain("password");
  });

  it("returns a blocked report for malformed owned terrain instead of exposing raw storage", async () => {
    state.rows[USER_A_ID] = { terrainJson: { datasetId: USER_A_ID, depths: "not-a-grid" } };

    const response = await request(app)
      .get(`/user/datasets/${USER_A_ID}/audit`)
      .set("x-test-user-id", "user-a");

    expect(response.status).toBe(200);
    expect(response.body.datasetId).toBe(USER_A_ID);
    expect(response.body.status).toBe("blocked");
    expect(response.body.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "grid_dimensions_invalid" }),
      expect.objectContaining({ reason: "grid_cardinality_mismatch" }),
    ]));
  });
});