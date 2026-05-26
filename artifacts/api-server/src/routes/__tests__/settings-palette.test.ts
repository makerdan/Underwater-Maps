/**
 * Tests for /api/settings palette round-tripping (Task #368).
 *
 * Locks in the contract that the depth-palette fields (paletteShallow,
 * paletteDeep, customStops) survive a PUT → GET cycle untouched, and that
 * the server's zod validation enforces the documented bounds — hex format
 * on shallow / deep and per-stop hex + [0, 1] position bounds on
 * customStops. Without this, a future settings refactor could silently
 * drop the palette fields and the only signal would be users losing their
 * customised colours on the next cross-device sync.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

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
});

describe("PUT /api/settings — palette round-trip", () => {
  it("persists paletteShallow, paletteDeep, and customStops verbatim and returns them on GET", async () => {
    const customStops = [
      { position: 0, hex: "#abcdef" },
      { position: 0.25, hex: "#112233" },
      { position: 0.75, hex: "#445566" },
      { position: 1, hex: "#fedcba" },
    ];
    const putRes = await request(app)
      .put("/api/settings")
      .send({
        paletteShallow: "#abcdef",
        paletteDeep: "#fedcba",
        customStops,
      });
    expect(putRes.status).toBe(200);

    // Persisted server-side exactly as sent.
    const persisted = state.lastInsertedSettings?.["settings"] as Record<string, unknown>;
    expect(persisted.paletteShallow).toBe("#abcdef");
    expect(persisted.paletteDeep).toBe("#fedcba");
    expect(persisted.customStops).toEqual(customStops);

    const getRes = await request(app).get("/api/settings");
    expect(getRes.status).toBe(200);
    expect(getRes.body.paletteShallow).toBe("#abcdef");
    expect(getRes.body.paletteDeep).toBe("#fedcba");
    expect(getRes.body.customStops).toEqual(customStops);
  });

  it("preserves the position-0 and position-1 boundary stops through the round-trip", async () => {
    const stops = [
      { position: 0, hex: "#000000" },
      { position: 1, hex: "#ffffff" },
    ];
    const putRes = await request(app).put("/api/settings").send({ customStops: stops });
    expect(putRes.status).toBe(200);

    const getRes = await request(app).get("/api/settings");
    expect(getRes.status).toBe(200);
    expect(getRes.body.customStops).toEqual(stops);
  });

  it("rejects an out-of-range stop position (>1) with 400", async () => {
    const res = await request(app)
      .put("/api/settings")
      .send({
        customStops: [
          { position: 0, hex: "#000000" },
          { position: 1.5, hex: "#ffffff" },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("rejects a negative stop position with 400", async () => {
    const res = await request(app)
      .put("/api/settings")
      .send({
        customStops: [
          { position: -0.1, hex: "#000000" },
          { position: 1, hex: "#ffffff" },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed shallow / deep hex with 400", async () => {
    const r1 = await request(app)
      .put("/api/settings")
      .send({ paletteShallow: "not-a-hex" });
    expect(r1.status).toBe(400);

    const r2 = await request(app)
      .put("/api/settings")
      .send({ paletteDeep: "#zzzzzz" });
    expect(r2.status).toBe(400);
  });

  it("rejects a malformed customStops hex with 400", async () => {
    const res = await request(app)
      .put("/api/settings")
      .send({
        customStops: [
          { position: 0, hex: "#000000" },
          { position: 1, hex: "red" },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("rejects fewer than 2 customStops with 400", async () => {
    const res = await request(app)
      .put("/api/settings")
      .send({ customStops: [{ position: 0, hex: "#000000" }] });
    expect(res.status).toBe(400);
  });

  it("partial PUT of just palette fields preserves previously stored non-palette settings", async () => {
    state.userSettings = [
      {
        userId: "user-test",
        settings: {
          units: "imperial",
          depthUnit: "feet",
          fogDensity: 0.02,
          paletteShallow: "#00e5ff",
          paletteDeep: "#283593",
        },
      },
    ];

    const newDeep = "#ff00aa";
    const res = await request(app)
      .put("/api/settings")
      .send({ paletteDeep: newDeep });
    expect(res.status).toBe(200);

    const persisted = state.lastInsertedSettings?.["settings"] as Record<string, unknown>;
    expect(persisted.paletteDeep).toBe(newDeep);
    // Non-palette settings the client didn't send must survive.
    expect(persisted.units).toBe("imperial");
    expect(persisted.depthUnit).toBe("feet");
    expect(persisted.fogDensity).toBe(0.02);
    // Previously stored palette shallow must also survive a deep-only PUT.
    expect(persisted.paletteShallow).toBe("#00e5ff");
  });
});
