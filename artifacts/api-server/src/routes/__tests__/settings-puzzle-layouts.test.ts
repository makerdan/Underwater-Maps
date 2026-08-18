/**
 * Tests for /api/settings puzzleLayouts round-tripping (Task #3544).
 *
 * Locks in the contract that puzzle layout presets (named tile arrangements)
 * survive a PUT → GET cycle untouched, and that the server's Zod validation
 * enforces the documented shape — id, name, tiles array, and groups array.
 * Without this, a future settings refactor could silently drop the field and
 * the only signal would be users losing all their saved layouts on the next
 * cross-device sync.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

type Row = Record<string, unknown>;
const state: { userSettings: Row[]; lastInsertedSettings: Row | null } = {
  userSettings: [],
  lastInsertedSettings: null,
};

vi.mock("@workspace/db", () => {
  type TableName =
    | "userSettings" | "markers" | "customDatasets"
    | "gpsTrails" | "gpsTrailPoints" | "poeUsageLog";
  const tag = (name: TableName) => ({ __tableName: name });

  const userSettingsTable = tag("userSettings");
  const markersTable = tag("markers");
  const customDatasetsTable = tag("customDatasets");
  const gpsTrailsTable = tag("gpsTrails");
  const gpsTrailPointsTable = tag("gpsTrailPoints");
  const poeUsageLogTable = tag("poeUsageLog");

  const select = () => ({
    from: (table: { __tableName: TableName }) => ({
      where: () =>
        Promise.resolve(table.__tableName === "userSettings" ? state.userSettings : []),
    }),
  });

  const insert = (table: { __tableName: TableName }) => ({
    values: (row: Row) => {
      const chain = {
        onConflictDoUpdate: ({ set }: { set: Row }) => {
          if (table.__tableName === "userSettings") {
            state.userSettings = [{ ...row, ...set }];
            state.lastInsertedSettings = { ...row, ...set };
          }
          return Promise.resolve([]);
        },
        then: (resolve: (v: unknown) => void) => { resolve([]); },
      };
      return chain;
    },
  });

  const del = (_table: { __tableName: TableName }) => ({
    where: () => Promise.resolve([]),
  });

  return {
    db: { select, insert, delete: del },
    userSettingsTable,
    markersTable,
    customDatasetsTable,
    gpsTrailsTable,
    gpsTrailPointsTable,
    poeUsageLogTable,
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  };
});

vi.mock("@workspace/db/schema", () => ({ poeUsageLogTable: { __tableName: "poeUsageLog" } }));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: "user-test" })),
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

beforeEach(() => {
  state.userSettings = [];
  state.lastInsertedSettings = null;
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const SAMPLE_LAYOUT = {
  id: "pl_abc123_def4",
  name: "Gulf coast comparison",
  tiles: [
    { datasetId: "dataset-a", tx: 12.5, ty: -8.0, angleDeg: 15 },
    { datasetId: "dataset-b", tx: 0, ty: 0, angleDeg: 0 },
  ],
  groups: [["dataset-a", "dataset-b"]],
};

describe("PUT /api/settings — puzzleLayouts round-trip", () => {
  it("persists a single layout and returns it on GET", async () => {
    const putRes = await request(app)
      .put("/api/settings")
      .send({ puzzleLayouts: [SAMPLE_LAYOUT] });
    expect(putRes.status).toBe(200);

    // Persisted server-side exactly as sent.
    const persisted = state.lastInsertedSettings?.["settings"] as Record<string, unknown>;
    expect(Array.isArray(persisted.puzzleLayouts)).toBe(true);
    expect((persisted.puzzleLayouts as unknown[])[0]).toMatchObject({
      id: "pl_abc123_def4",
      name: "Gulf coast comparison",
    });

    const getRes = await request(app).get("/api/settings");
    expect(getRes.status).toBe(200);
    expect(getRes.body.puzzleLayouts).toEqual([SAMPLE_LAYOUT]);
  });

  it("preserves all tile fields through the round-trip", async () => {
    const putRes = await request(app)
      .put("/api/settings")
      .send({ puzzleLayouts: [SAMPLE_LAYOUT] });
    expect(putRes.status).toBe(200);

    const getRes = await request(app).get("/api/settings");
    const [layout] = getRes.body.puzzleLayouts as typeof SAMPLE_LAYOUT[];
    expect(layout!.tiles).toEqual(SAMPLE_LAYOUT.tiles);
    expect(layout!.groups).toEqual(SAMPLE_LAYOUT.groups);
  });

  it("defaults to an empty array when no layouts have been saved", async () => {
    const getRes = await request(app).get("/api/settings");
    expect(getRes.status).toBe(200);
    expect(getRes.body.puzzleLayouts).toEqual([]);
  });

  it("preserves multiple layouts in order", async () => {
    const layouts = [
      { ...SAMPLE_LAYOUT, id: "pl_1", name: "Before/after" },
      { ...SAMPLE_LAYOUT, id: "pl_2", name: "Gulf coast" },
      { ...SAMPLE_LAYOUT, id: "pl_3", name: "Trench comparison" },
    ];
    await request(app).put("/api/settings").send({ puzzleLayouts: layouts });
    const getRes = await request(app).get("/api/settings");
    expect(getRes.body.puzzleLayouts).toHaveLength(3);
    expect(getRes.body.puzzleLayouts[0].id).toBe("pl_1");
    expect(getRes.body.puzzleLayouts[1].id).toBe("pl_2");
    expect(getRes.body.puzzleLayouts[2].id).toBe("pl_3");
  });

  it("accepts a layout with empty tiles and groups", async () => {
    const layout = { id: "pl_empty", name: "Empty layout", tiles: [], groups: [] };
    const res = await request(app).put("/api/settings").send({ puzzleLayouts: [layout] });
    expect(res.status).toBe(200);
    const getRes = await request(app).get("/api/settings");
    expect(getRes.body.puzzleLayouts[0]).toMatchObject(layout);
  });

  it("rejects a layout with a name that exceeds 80 chars", async () => {
    const layout = { ...SAMPLE_LAYOUT, name: "x".repeat(81) };
    const res = await request(app).put("/api/settings").send({ puzzleLayouts: [layout] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("rejects a layout with a name shorter than 1 char", async () => {
    const layout = { ...SAMPLE_LAYOUT, name: "" };
    const res = await request(app).put("/api/settings").send({ puzzleLayouts: [layout] });
    expect(res.status).toBe(400);
  });

  it("rejects a layout whose id exceeds 64 chars", async () => {
    const layout = { ...SAMPLE_LAYOUT, id: "x".repeat(65) };
    const res = await request(app).put("/api/settings").send({ puzzleLayouts: [layout] });
    expect(res.status).toBe(400);
  });

  it("rejects a tile whose datasetId exceeds 128 chars", async () => {
    const layout = {
      ...SAMPLE_LAYOUT,
      tiles: [{ datasetId: "d".repeat(129), tx: 0, ty: 0, angleDeg: 0 }],
    };
    const res = await request(app).put("/api/settings").send({ puzzleLayouts: [layout] });
    expect(res.status).toBe(400);
  });

  it("rejects a group with a single member (min 2 required)", async () => {
    const layout = { ...SAMPLE_LAYOUT, groups: [["only-one"]] };
    const res = await request(app).put("/api/settings").send({ puzzleLayouts: [layout] });
    expect(res.status).toBe(400);
  });

  it("partial PUT without puzzleLayouts does not overwrite existing layouts", async () => {
    // First save layouts.
    await request(app)
      .put("/api/settings")
      .send({ puzzleLayouts: [SAMPLE_LAYOUT] });

    // Now send a partial PUT with an unrelated key.
    await request(app)
      .put("/api/settings")
      .send({ overviewShowGrid: false });

    const getRes = await request(app).get("/api/settings");
    expect(getRes.body.puzzleLayouts).toEqual([SAMPLE_LAYOUT]);
  });

  it("preserves flipH and flipV through the round-trip", async () => {
    const layoutWithFlip = {
      ...SAMPLE_LAYOUT,
      id: "pl_flip_test",
      name: "Flip test layout",
      tiles: [
        { datasetId: "dataset-a", tx: 0, ty: 0, angleDeg: 0, flipH: true, flipV: false },
        { datasetId: "dataset-b", tx: 5, ty: -3, angleDeg: 45, flipH: false, flipV: true },
      ],
    };
    const putRes = await request(app)
      .put("/api/settings")
      .send({ puzzleLayouts: [layoutWithFlip] });
    expect(putRes.status).toBe(200);

    const getRes = await request(app).get("/api/settings");
    expect(getRes.status).toBe(200);
    const [layout] = getRes.body.puzzleLayouts as typeof layoutWithFlip[];
    expect(layout!.tiles[0]).toMatchObject({ datasetId: "dataset-a", flipH: true, flipV: false });
    expect(layout!.tiles[1]).toMatchObject({ datasetId: "dataset-b", flipH: false, flipV: true });
  });

  it("accepts deletion of all layouts by sending an empty array", async () => {
    await request(app)
      .put("/api/settings")
      .send({ puzzleLayouts: [SAMPLE_LAYOUT] });

    await request(app)
      .put("/api/settings")
      .send({ puzzleLayouts: [] });

    const getRes = await request(app).get("/api/settings");
    expect(getRes.body.puzzleLayouts).toEqual([]);
  });
});
