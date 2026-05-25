import { describe, it, expect, vi } from "vitest";
import request from "supertest";

// vi.mock is hoisted above all imports/variable declarations,
// so all data used inside the factory must be defined inline here.
vi.mock("@workspace/db", () => {
  const row = {
    id: "11111111-1111-1111-1111-111111111111",
    datasetId: "mariana-trench",
    lon: 142.2,
    lat: 11.35,
    depth: 5000,
    type: "custom",
    label: "Test Marker",
    notes: null,
    createdAt: new Date().toISOString(),
  };

  // Chains: db.select().from().where().orderBy() → rows
  const orderByMock = vi.fn().mockResolvedValue([row]);
  const selectWhereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
  const fromMock = vi.fn().mockReturnValue({ where: selectWhereMock });

  // Chains: db.insert().values().returning() → [row]
  const insertReturningMock = vi.fn().mockResolvedValue([row]);
  const valuesMock = vi.fn().mockReturnValue({ returning: insertReturningMock });

  // Chains: db.delete().where().returning() → [{ id }]
  const deleteReturningMock = vi.fn().mockResolvedValue([{ id: row.id }]);
  const deleteWhereMock = vi.fn().mockReturnValue({ returning: deleteReturningMock });

  return {
    db: {
      select: vi.fn().mockReturnValue({ from: fromMock }),
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
      delete: vi.fn().mockReturnValue({ where: deleteWhereMock }),
    },
    markersTable: {
      datasetId: "datasetId",
      createdAt: "createdAt",
      id: "id",
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
}));

import app from "../app.js";

describe("GET /api/markers", () => {
  it("returns 200 with an array when datasetId is provided", async () => {
    const res = await request(app).get("/api/markers?datasetId=mariana-trench");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // Note: GetMarkersQueryParams uses zod.coerce.string() so missing datasetId
  // becomes the string "undefined" rather than failing validation.
  it("returns 200 even without datasetId due to zod.coerce.string() schema", async () => {
    const res = await request(app).get("/api/markers");
    expect(res.status).toBe(200);
  });
});

describe("POST /api/markers", () => {
  // PostMarkersBody requires: datasetId, lon, lat, depth, label
  it("returns 201 and the created marker on valid body", async () => {
    const res = await request(app)
      .post("/api/markers")
      .send({ datasetId: "mariana-trench", lon: 142.2, lat: 11.35, depth: 5000, label: "Test" });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("datasetId", "mariana-trench");
  });

  it("returns 400 when required body fields are missing", async () => {
    const res = await request(app).post("/api/markers").send({ lon: 142.2 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("DELETE /api/markers/:id", () => {
  it("returns 204 when a known marker id is deleted", async () => {
    const res = await request(app).delete("/api/markers/11111111-1111-1111-1111-111111111111");
    expect(res.status).toBe(204);
  });

  it("returns 404 when the mocked DB returns empty (marker not found)", async () => {
    // Override delete mock to return empty array for this test
    const { db } = await import("@workspace/db");
    (db.delete as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    const res = await request(app).delete("/api/markers/22222222-2222-2222-2222-222222222222");
    expect(res.status).toBe(404);
  });
});
