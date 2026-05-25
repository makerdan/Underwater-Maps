/**
 * Task #66 — End-to-end coverage for the smooth-terrain toggle.
 *
 * This file exercises the API half of the toggle chain that is otherwise
 * uncovered:
 *
 *   1. PUT  /api/settings { smoothTerrainSpikes }  → persists per-user pref
 *   2. GET  /api/datasets/:id/terrain              → reads the pref via
 *                                                    getSmoothingPreference,
 *                                                    passes options.smoothing
 *                                                    into buildTerrainGrid,
 *                                                    which keys the cache on
 *                                                    `${id}-${res}{-raw?}` so
 *                                                    raw vs smoothed grids
 *                                                    cannot share a slot.
 *
 * What is mocked and why:
 *   - `@workspace/db` — replaced with an in-memory `Map<userId, settings>`
 *     so PUT /settings → GET /settings → GET /terrain all see the same
 *     row without booting Postgres.
 *   - `global.fetch` — replaced with a spiky AAIGRID response so the
 *     smoothing pass measurably narrows the depth range (otherwise the test
 *     would depend on whatever GEBCO happens to return today).
 *   - `/tmp/gebco-cache/<dataset>-<res>{-raw}.json` is removed before each
 *     test so the disk cache from earlier runs cannot serve a stale grid.
 *
 * The Playwright spec `tests/e2e/smooth-terrain.spec.ts` covers the UI half
 * (toggle click → store update → reload persistence).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { promises as fs } from "fs";
import path from "path";

// ─── hoisted shared state for the db mock ────────────────────────────────────
const mocks = vi.hoisted(() => {
  return {
    settingsByUser: new Map<string, Record<string, unknown>>(),
  };
});

// Drizzle helper mocks — eq() carries the userId out to where().
vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: unknown) => ({ __eq: val }),
  and: (...args: unknown[]) => ({ __and: args }),
}));

vi.mock("@workspace/db", () => {
  const settingsByUser = mocks.settingsByUser;

  function resolveUserId(cond: unknown): string | undefined {
    if (!cond || typeof cond !== "object") return undefined;
    const c = cond as { __eq?: unknown; __and?: unknown[] };
    if (typeof c.__eq === "string") return c.__eq;
    if (Array.isArray(c.__and)) {
      for (const part of c.__and) {
        const v = resolveUserId(part);
        if (v) return v;
      }
    }
    return undefined;
  }

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async (cond: unknown) => {
            const userId = resolveUserId(cond);
            if (!userId) return [];
            const rec = settingsByUser.get(userId);
            return rec ? [{ userId, settings: rec }] : [];
          }),
        })),
      })),
      insert: vi.fn(() => {
        let captured: { userId: string; settings: Record<string, unknown> } | null = null;
        return {
          values: vi.fn((vals: { userId: string; settings: Record<string, unknown> }) => {
            captured = vals;
            return {
              onConflictDoUpdate: vi.fn(
                async ({ set }: { set: { settings: Record<string, unknown> } }) => {
                  if (captured) settingsByUser.set(captured.userId, set.settings);
                  return undefined;
                },
              ),
              returning: vi.fn(async () => []),
            };
          }),
        };
      }),
    },
    userSettingsTable: { userId: "userId", settings: "settings" },
    customDatasetsTable: {
      id: "id",
      userId: "userId",
      name: "name",
      minDepth: "minDepth",
      maxDepth: "maxDepth",
      terrainJson: "terrainJson",
      overviewJson: "overviewJson",
      createdAt: "createdAt",
    },
    markersTable: { datasetId: "datasetId", createdAt: "createdAt", id: "id" },
  };
});

// Clerk + proxy mocks — same shape as markers.test.ts.
vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => {
    const header = req.headers["x-mock-clerk-user-id"];
    return { userId: header || null };
  }),
}));
vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

// Import app AFTER mocks register.
import app from "../app.js";

const DISK_CACHE_DIR = "/tmp/gebco-cache";
const DATASET_ID = "mariana-trench"; // does not use NCEI → straight to GEBCO
const TEST_USER = "user_smooth_test";
const AUTH_HEADER = { "x-mock-clerk-user-id": TEST_USER };

// Build a spiky 8×8 AAIGRID body so the smoothing pass has something to do.
function spikyAsciiGrid(): string {
  const N = 8;
  const header =
    `ncols ${N}\n` +
    `nrows ${N}\n` +
    `xllcorner 141.0\n` +
    `yllcorner 10.5\n` +
    `cellsize 0.3\n` +
    `nodata_value -9999\n`;
  const rows: string[] = [];
  for (let r = 0; r < N; r++) {
    const cells: string[] = [];
    for (let c = 0; c < N; c++) {
      // alternate shallow / deep → adjacent cells differ by ~5000 m
      cells.push(String((r + c) % 2 === 0 ? -500 : -5500));
    }
    rows.push(cells.join(" "));
  }
  return header + rows.join("\n") + "\n";
}

async function clearDiskCache(): Promise<void> {
  try {
    const files = await fs.readdir(DISK_CACHE_DIR);
    await Promise.all(
      files
        .filter((f) => f.startsWith(`${DATASET_ID}-`))
        .map((f) => fs.unlink(path.join(DISK_CACHE_DIR, f)).catch(() => {})),
    );
  } catch {
    // dir might not exist — that's fine
  }
}

beforeEach(async () => {
  mocks.settingsByUser.clear();
  await clearDiskCache();
  // Return a fresh Response per call — Response bodies are one-shot streams,
  // so reusing a single instance would cause "Body has already been read" on
  // the second fetch and silently fall back to the synthetic grid.
  vi.spyOn(global, "fetch").mockImplementation(async () => {
    return new Response(spikyAsciiGrid(), {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Task #66 — PUT /settings → GET /datasets/:id/terrain", () => {
  it("flipping smoothTerrainSpikes changes the served terrain grid", async () => {
    // 1. User explicitly enables smoothing (the default).
    const putOn = await request(app)
      .put("/api/settings")
      .set(AUTH_HEADER)
      .send({ smoothTerrainSpikes: true });
    expect(putOn.status).toBe(200);
    expect(mocks.settingsByUser.get(TEST_USER)?.["smoothTerrainSpikes"]).toBe(true);

    // Use an uncommon resolution so we land in a fresh memory-cache slot
    // even when other tests in the suite have already populated 64/256.
    const RES = 37;
    const smoothedRes = await request(app)
      .get(`/api/datasets/${DATASET_ID}/terrain?resolution=${RES}`)
      .set(AUTH_HEADER);
    expect(smoothedRes.status).toBe(200);
    const smoothed = smoothedRes.body as { depths: number[]; minDepth: number; maxDepth: number };

    // 2. User flips smoothing OFF.
    const putOff = await request(app)
      .put("/api/settings")
      .set(AUTH_HEADER)
      .send({ smoothTerrainSpikes: false });
    expect(putOff.status).toBe(200);
    expect(mocks.settingsByUser.get(TEST_USER)?.["smoothTerrainSpikes"]).toBe(false);

    const rawRes = await request(app)
      .get(`/api/datasets/${DATASET_ID}/terrain?resolution=${RES}`)
      .set(AUTH_HEADER);
    expect(rawRes.status).toBe(200);
    const raw = rawRes.body as { depths: number[]; minDepth: number; maxDepth: number };

    // The raw grid must preserve the spikes, giving it a wider depth range.
    const smoothedRange = smoothed.maxDepth - smoothed.minDepth;
    const rawRange = raw.maxDepth - raw.minDepth;
    expect(rawRange).toBeGreaterThan(smoothedRange);

    // And the raw vs smoothed depths arrays must actually differ — proves
    // the cache key really did change (otherwise we'd be served the cached
    // smoothed payload again).
    expect(raw.depths).not.toEqual(smoothed.depths);
  });

  it("calling /terrain twice with the same preference hits the cache (one upstream fetch)", async () => {
    await request(app)
      .put("/api/settings")
      .set(AUTH_HEADER)
      .send({ smoothTerrainSpikes: false });

    const RES = 41;
    const a = await request(app)
      .get(`/api/datasets/${DATASET_ID}/terrain?resolution=${RES}`)
      .set(AUTH_HEADER);
    const b = await request(app)
      .get(`/api/datasets/${DATASET_ID}/terrain?resolution=${RES}`)
      .set(AUTH_HEADER);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.depths).toEqual(a.body.depths);
    // Exactly one upstream GEBCO fetch — the second call must be cached.
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("flipping the preference forces a fresh upstream fetch (distinct cache slot)", async () => {
    const RES = 43;
    await request(app)
      .put("/api/settings")
      .set(AUTH_HEADER)
      .send({ smoothTerrainSpikes: true });
    await request(app)
      .get(`/api/datasets/${DATASET_ID}/terrain?resolution=${RES}`)
      .set(AUTH_HEADER);
    await request(app)
      .put("/api/settings")
      .set(AUTH_HEADER)
      .send({ smoothTerrainSpikes: false });
    await request(app)
      .get(`/api/datasets/${DATASET_ID}/terrain?resolution=${RES}`)
      .set(AUTH_HEADER);

    // Two upstream fetches — raw and smoothed must not share a cache slot.
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });
});
