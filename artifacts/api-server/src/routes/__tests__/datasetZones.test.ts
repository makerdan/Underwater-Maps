import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  },
  pool: { query: vi.fn() },
  poeUsageLogTable: {},
  customDatasetsTable: {},
  userSettingsTable: {},
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  // Always return an authenticated user — the upload-id test path requires
  // auth (non-preset id), and the preset-id tests don't consult auth at all.
  getAuth: vi.fn(() => ({ userId: "test-user" })),
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
import { datasetZonesCache, zoneCacheKey } from "../poe.js";
import { substrateFingerprintForDataset } from "../../lib/substrateGrid.js";

const ALL_SANDY = Array(1024).fill("sandy_shelf");

beforeEach(() => {
  datasetZonesCache.clear();
});

describe("GET /api/datasets/:id/zones — substrate cache key gating", () => {
  it("serves a cached entry for an uncovered dataset (fp=00000000)", async () => {
    // "upload" has no bundled substrate coverage → fp "00000000". An entry
    // planted under the namespaced key for that (gridHash, waterType, fp)
    // tuple is authoritative and must be served back.
    const gridHash = "deadbeef";
    expect(substrateFingerprintForDataset("upload")).toBe("00000000");

    const key = zoneCacheKey(gridHash, "saltwater", "00000000");
    datasetZonesCache.set(key, {
      zones: ALL_SANDY,
      waterType: "saltwater",
      classifiedAt: Date.now(),
      source: "ai",
    });

    const res = await request(app).get(
      `/api/datasets/upload/zones?h=${gridHash}&w=saltwater`,
    );
    expect(res.status).toBe(200);
    expect(res.body.zones).toHaveLength(1024);
    expect(res.body.substrateFp).toBe("00000000");
  });

  it("refuses an entry keyed with a stale substrate fp for a covered dataset", async () => {
    // glacier-bay has real ShoreZone substrate coverage. An entry planted
    // under fp "00000000" (i.e. ungrounded / legacy) must NOT be served for
    // a covered dataset whose current fp differs — otherwise stale labels
    // could survive indefinitely. The covered-dataset path forces a 404 so
    // the AI path recomputes against the up-to-date substrate.
    const gridHash = "cafef00d";
    const fp = substrateFingerprintForDataset("glacier-bay");
    expect(fp).not.toBe("00000000");

    const staleKey = zoneCacheKey(gridHash, "saltwater", "00000000");
    datasetZonesCache.set(staleKey, {
      zones: ALL_SANDY,
      waterType: "saltwater",
      classifiedAt: Date.now(),
      source: "ai",
    });

    const res = await request(app).get(
      `/api/datasets/glacier-bay/zones?h=${gridHash}&w=saltwater`,
    );
    expect(res.status).toBe(404);
  });

  it("serves the namespaced entry for a covered dataset under its current fp", async () => {
    const gridHash = "12345678";
    const fp = substrateFingerprintForDataset("glacier-bay");
    expect(fp).not.toBe("00000000");

    const key = zoneCacheKey(gridHash, "saltwater", fp);
    datasetZonesCache.set(key, {
      zones: ALL_SANDY,
      waterType: "saltwater",
      classifiedAt: Date.now(),
      source: "ai",
    });

    const res = await request(app).get(
      `/api/datasets/glacier-bay/zones?h=${gridHash}&w=saltwater`,
    );
    expect(res.status).toBe(200);
    expect(res.body.substrateFp).toBe(fp);
  });
});
