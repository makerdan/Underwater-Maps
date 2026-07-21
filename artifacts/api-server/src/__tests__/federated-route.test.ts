/**
 * federated-route.test.ts — HTTP-level tests for the federated search routes:
 *
 *   GET  /api/search/federated          — validation, fan-out plumbing,
 *                                         per-source filtering, 5-min cache
 *   GET  /api/search/federated/sources  — static connector registry
 *   POST /api/search/federated/save     — generic save for importable
 *                                         results (auth-gated, server-side
 *                                         importability re-derivation)
 *
 * The DB layer and materializeSave are mocked; auth uses the shared
 * E2E_AUTH_BYPASS + x-e2e-user-id header path in requireAuth.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import type { FederatedSearchResponse } from "../lib/federatedSearch/types.js";

const runFederatedSearchMock = vi.fn();

vi.mock("../lib/federatedSearch/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/federatedSearch/index.js")>();
  return {
    ...actual,
    runFederatedSearch: (...args: unknown[]) => runFederatedSearchMock(...args),
  };
});

// In-memory DB stub — only the query shapes used by /search/federated/save.
const DB = vi.hoisted(() => {
  const state: {
    catalog: Record<string, unknown>[];
    saves: Record<string, unknown>[];
  } = { catalog: [], saves: [] };
  let saveIdCounter = 1;

  const dbMock = {
    insert: (table: { __name?: string }) => ({
      values: (vals: Record<string, unknown>) => {
        const isCatalog = table.__name === "catalog";
        const chain = {
          onConflictDoUpdate: async () => {
            const arr = state.catalog;
            const idx = arr.findIndex((r) => r["id"] === vals["id"]);
            if (idx >= 0) arr[idx] = { ...arr[idx], ...vals };
            else arr.push({ ...vals });
            return [];
          },
          returning: async () => {
            const row = {
              id: `save-${saveIdCounter++}`,
              requestedAt: new Date(),
              readyAt: null,
              errorMessage: null,
              folderId: null,
              datasetId: null,
              ...vals,
            };
            state.saves.push(row);
            return [row];
          },
          then: (resolve: (v: unknown[]) => void) => {
            if (isCatalog) {
              const arr = state.catalog;
              const idx = arr.findIndex((r) => r["id"] === vals["id"]);
              if (idx >= 0) arr[idx] = { ...arr[idx], ...vals };
              else arr.push({ ...vals });
            }
            resolve([]);
          },
        };
        return chain;
      },
    }),
    select: () => ({
      from: () => ({
        // The only .where() in this route filters saves by userId+catalogId;
        // conditions are opaque drizzle objects, so filter via last insert
        // context: return all saves and let the route's idempotency check
        // operate on the full array match below.
        where: async () => state.saves.filter((s) => s["__match"] === true),
      }),
    }),
  };
  return { state, dbMock, resetIds: () => { saveIdCounter = 1; } };
});

vi.mock("@workspace/db", () => ({
  db: DB.dbMock,
  datasetCatalogTable: { __name: "catalog", id: { name: "id" } },
  userCatalogSavesTable: { __name: "saves", userId: {}, catalogId: {} },
}));

const materializeSaveMock = vi.hoisted(() => vi.fn());
vi.mock("../routes/catalog-saves.js", () => ({
  materializeSave: materializeSaveMock,
  formatSaveRow: (row: Record<string, unknown>, entry: { id: string; name: string }) => ({
    id: row["id"],
    catalogId: entry.id,
    name: entry.name,
    status: row["status"],
  }),
}));

// requireAuth falls through to Clerk's getAuth() when the bypass header is
// absent; without clerkMiddleware in the chain getAuth throws, so stub it
// to return an unauthenticated session for the 401 test.
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: null }),
}));

const invalidateCatalogCacheMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/catalogSeeder.js", () => ({
  invalidateCatalogCache: invalidateCatalogCacheMock,
}));

const { default: searchFederatedRouter } = await import("../routes/search-federated.js");
const { clearAllCaches } = await import("../lib/cacheRegistry.js");

const prevBypass = process.env["E2E_AUTH_BYPASS"];
afterAll(() => {
  if (prevBypass === undefined) delete process.env["E2E_AUTH_BYPASS"];
  else process.env["E2E_AUTH_BYPASS"] = prevBypass;
});

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api", searchFederatedRouter);
  return app;
}

function fakeResponse(): FederatedSearchResponse {
  return {
    results: [
      {
        id: "ncei-geoportal:abc",
        sourceId: "ncei-geoportal",
        sourceLabel: "NOAA NCEI Geoportal",
        name: "Sitka Sound Survey",
        description: null,
        url: "https://example.org/meta",
        endpointUrl: null,
        coverageBbox: { minLon: -136, minLat: 56, maxLon: -135, maxLat: 57 },
        resolutionMMin: null,
        resolutionMMax: null,
        importable: false,
        importKind: null,
      },
    ],
    sources: [
      {
        sourceId: "ncei-geoportal",
        label: "NOAA NCEI Geoportal",
        status: "ok",
        resultCount: 1,
        tookMs: 42,
        error: null,
      },
    ],
  };
}

beforeEach(() => {
  clearAllCaches();
  runFederatedSearchMock.mockReset();
  runFederatedSearchMock.mockResolvedValue(fakeResponse());
  materializeSaveMock.mockReset();
  invalidateCatalogCacheMock.mockClear();
  DB.state.catalog.length = 0;
  DB.state.saves.length = 0;
  DB.resetIds();
  process.env["E2E_AUTH_BYPASS"] = "1";
});

describe("GET /api/search/federated", () => {
  it("400s when neither q nor bbox is provided", async () => {
    const res = await request(makeApp()).get("/api/search/federated");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
    expect(runFederatedSearchMock).not.toHaveBeenCalled();
  });

  it("400s on a malformed bbox", async () => {
    const res = await request(makeApp()).get("/api/search/federated?bbox=1,2,three");
    expect(res.status).toBe(400);
    expect(res.body.details).toMatch(/bbox/);
  });

  it("runs the fan-out with q only and returns results + sources", async () => {
    const res = await request(makeApp()).get("/api/search/federated?q=sitka");
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.sources[0]).toMatchObject({ sourceId: "ncei-geoportal", status: "ok" });
    expect(runFederatedSearchMock).toHaveBeenCalledWith("sitka", null, { sourceIds: [] });
  });

  it("parses bbox into a structured object", async () => {
    const res = await request(makeApp()).get(
      "/api/search/federated?bbox=-136.5,56.2,-135.1,57.3",
    );
    expect(res.status).toBe(200);
    expect(runFederatedSearchMock).toHaveBeenCalledWith(
      "",
      { minLon: -136.5, minLat: 56.2, maxLon: -135.1, maxLat: 57.3 },
      { sourceIds: [] },
    );
  });

  it("passes the sources filter through to the runner", async () => {
    const res = await request(makeApp()).get(
      "/api/search/federated?q=sitka&sources=ncei-geoportal,usgs-sciencebase",
    );
    expect(res.status).toBe(200);
    expect(runFederatedSearchMock).toHaveBeenCalledWith("sitka", null, {
      sourceIds: ["ncei-geoportal", "usgs-sciencebase"],
    });
  });

  it("serves the second identical request from cache", async () => {
    const app = makeApp();
    await request(app).get("/api/search/federated?q=sitka");
    const res2 = await request(app).get("/api/search/federated?q=sitka");
    expect(res2.status).toBe(200);
    expect(res2.body.results).toHaveLength(1);
    expect(runFederatedSearchMock).toHaveBeenCalledTimes(1);
  });

  it("different queries miss the cache", async () => {
    const app = makeApp();
    await request(app).get("/api/search/federated?q=sitka");
    await request(app).get("/api/search/federated?q=tahoe");
    expect(runFederatedSearchMock).toHaveBeenCalledTimes(2);
  });

  it("different source filters for the same query miss the cache", async () => {
    const app = makeApp();
    await request(app).get("/api/search/federated?q=sitka&sources=ncei-geoportal");
    await request(app).get("/api/search/federated?q=sitka&sources=usgs-sciencebase");
    expect(runFederatedSearchMock).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/search/federated/sources", () => {
  it("returns the connector registry with local-catalog and externals", async () => {
    const res = await request(makeApp()).get("/api/search/federated/sources");
    expect(res.status).toBe(200);
    const ids = (res.body.sources as { id: string; label: string }[]).map((s) => s.id);
    expect(ids).toContain("local-catalog");
    expect(ids).toContain("ncei-geoportal");
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const s of res.body.sources as { id: string; label: string }[]) {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
    }
  });
});

describe("POST /api/search/federated/save", () => {
  const importableResult = {
    id: "portal-mndnr:lake-vermilion",
    sourceId: "portal-mndnr",
    sourceLabel: "Minnesota DNR",
    name: "Lake Vermilion Bathymetry",
    description: "MN DNR lake bathymetry",
    url: "https://gisdata.mn.gov/dataset/lake-vermilion",
    endpointUrl:
      "https://arcgis.dnr.state.mn.us/arcgis/rest/services/lakes/FeatureServer/0",
    coverageBbox: { minLon: -92.6, minLat: 47.8, maxLon: -92.2, maxLat: 47.95 },
    resolutionMMin: null,
    resolutionMMax: null,
  };

  it("401s without auth", async () => {
    process.env["E2E_AUTH_BYPASS"] = "0";
    const res = await request(makeApp())
      .post("/api/search/federated/save")
      .send({ result: importableResult });
    expect(res.status).toBe(401);
  });

  it("400s on a malformed body", async () => {
    const res = await request(makeApp())
      .post("/api/search/federated/save")
      .set("x-e2e-user-id", "user-1")
      .send({ result: { id: "x" } });
    expect(res.status).toBe(400);
  });

  it("400s (not_importable) when the endpoint has no fetch strategy", async () => {
    const res = await request(makeApp())
      .post("/api/search/federated/save")
      .set("x-e2e-user-id", "user-1")
      .send({
        result: {
          ...importableResult,
          id: "github-allowlist:some/repo",
          endpointUrl: null,
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("not_importable");
    expect(materializeSaveMock).not.toHaveBeenCalled();
  });

  it("400s (not_importable) when coverageBbox is missing", async () => {
    const res = await request(makeApp())
      .post("/api/search/federated/save")
      .set("x-e2e-user-id", "user-1")
      .send({ result: { ...importableResult, coverageBbox: null } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("not_importable");
  });

  it("201s on an importable result: upserts catalog, creates save, kicks off materialize", async () => {
    const res = await request(makeApp())
      .post("/api/search/federated/save")
      .set("x-e2e-user-id", "user-1")
      .send({ result: importableResult });
    expect(res.status).toBe(201);
    expect(res.body.catalogId).toBe("fed-portal-mndnr:lake-vermilion");
    expect(res.body.status).toBe("processing");

    // dataset_catalog upsert happened with the derived entry
    expect(DB.state.catalog).toHaveLength(1);
    expect(DB.state.catalog[0]).toMatchObject({
      id: "fed-portal-mndnr:lake-vermilion",
      name: "Lake Vermilion Bathymetry",
      sourceAgency: "Minnesota DNR",
      waterType: "freshwater",
    });
    expect(invalidateCatalogCacheMock).toHaveBeenCalled();
    expect(materializeSaveMock).toHaveBeenCalledTimes(1);
    const entryArg = materializeSaveMock.mock.calls[0]?.[2] as { id: string };
    expect(entryArg.id).toBe("fed-portal-mndnr:lake-vermilion");
  });

  it("derives saltwater for NCEI WCS results", async () => {
    const res = await request(makeApp())
      .post("/api/search/federated/save")
      .set("x-e2e-user-id", "user-1")
      .send({
        result: {
          ...importableResult,
          id: "ncei-geoportal:gov.noaa:sitka",
          sourceId: "ncei-geoportal",
          sourceLabel: "NOAA NCEI Geoportal",
          endpointUrl:
            "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/DEM_global_mosaic/ImageServer/WCSServer",
        },
      });
    expect(res.status).toBe(201);
    expect(DB.state.catalog[0]).toMatchObject({ waterType: "saltwater" });
  });
});
