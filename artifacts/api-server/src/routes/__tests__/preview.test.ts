/**
 * preview.test.ts — tests for GET /datasets/:id/preview (task #381).
 *
 * Verifies that the preflight endpoint correctly surfaces each upstream
 * dataSource branch (ncei | gebco | synthetic | unknown) and returns 404
 * for unknown preset IDs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  },
  customDatasetsTable: {},
  userSettingsTable: {},
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

const previewDatasetMock = vi.fn();
vi.mock("../../lib/terrain.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/terrain.js")>(
    "../../lib/terrain.js",
  );
  return {
    ...actual,
    previewDataset: (id: string) => previewDatasetMock(id),
  };
});

import app from "../../app.js";

beforeEach(() => {
  previewDatasetMock.mockReset();
});

describe("GET /api/datasets/:id/preview", () => {
  it("returns ncei dataSource without syntheticReason", async () => {
    previewDatasetMock.mockResolvedValueOnce({
      datasetId: "thorne-bay",
      name: "Thorne Bay",
      bbox: { minLon: -1, minLat: 1, maxLon: -2, maxLat: 2 },
      dataSource: "ncei",
    });
    const res = await request(app).get("/api/datasets/thorne-bay/preview");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ datasetId: "thorne-bay", dataSource: "ncei" });
    expect(res.body.syntheticReason).toBeUndefined();
  });

  it("returns gebco dataSource without syntheticReason", async () => {
    previewDatasetMock.mockResolvedValueOnce({
      datasetId: "ds",
      name: "DS",
      bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
      dataSource: "gebco",
    });
    const res = await request(app).get("/api/datasets/ds/preview");
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe("gebco");
  });

  it("returns synthetic dataSource with syntheticReason", async () => {
    previewDatasetMock.mockResolvedValueOnce({
      datasetId: "ds",
      name: "DS",
      bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
      dataSource: "synthetic",
      syntheticReason: "Bathymetry data unavailable — terrain is procedurally generated",
    });
    const res = await request(app).get("/api/datasets/ds/preview");
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe("synthetic");
    expect(res.body.syntheticReason).toMatch(/Bathymetry data unavailable/);
  });

  it("returns 404 for unknown dataset ids", async () => {
    previewDatasetMock.mockResolvedValueOnce(null);
    const res = await request(app).get("/api/datasets/does-not-exist/preview");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("falls back to dataSource=unknown when preview throws for any dataset id", async () => {
    previewDatasetMock.mockRejectedValueOnce(new Error("probe blew up"));
    // The catch branch returns a graceful 200 for any id (preset registry is
    // empty in production; user-saved catalog ids must also be served here).
    const res = await request(app).get("/api/datasets/thorne-bay/preview");
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe("unknown");
    expect(res.body.syntheticReason).toMatch(/Could not verify/);
    expect(res.body.datasetId).toBe("thorne-bay");
  });
});
