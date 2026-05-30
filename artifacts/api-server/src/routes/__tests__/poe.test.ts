import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// vi.hoisted lets us share the fake Poe client `create` mock with the
// vi.mock factory (which is itself hoisted above all imports).
const { fakeCreate, fakeChatCreate } = vi.hoisted(() => ({
  fakeCreate: vi.fn(),
  fakeChatCreate: vi.fn(),
}));

// Partially mock @workspace/poe — keep real cache / retry / hashing helpers
// but stub out getPoeClient so no network call is made.
vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>(
    "@workspace/poe",
  );
  return {
    ...actual,
    getPoeClient: vi.fn(() => ({
      responses: { create: fakeCreate },
      chat: { completions: { create: fakeChatCreate } },
    })),
  };
});

// Mock the DB so usage logging is a no-op.
vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
  },
  pool: { query: vi.fn() },
  poeUsageLogTable: {},
}));

// Mock Clerk + proxy middlewares so the app boots without a live tenant.
// Auth in tests goes through the shared `requireAuth` middleware
// (`src/middlewares/requireAuth.ts`), which honors `x-e2e-user-id` when
// `E2E_AUTH_BYPASS=1` is set in the environment (see beforeEach below).
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

import app from "../../app.js";
import { globalPoeCache } from "@workspace/poe";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";
import { __resetPoeBreaker } from "../poe.js";

const GRID_BASE64 = Buffer.from("fake-grid-bytes-for-testing").toString(
  "base64",
);

function buildOkResponse() {
  return {
    id: "resp_test_123",
    output_text: JSON.stringify({
      zones: Array(1024).fill("sandy_shelf"),
    }),
    usage: { input_tokens: 100, output_tokens: 200 },
  };
}

beforeEach(() => {
  // Turn on the env-gated e2e bypass so requests carrying `x-e2e-user-id`
  // authenticate as that user without contacting Clerk. The bypass is
  // hard-gated on this env var and is never honored in production.
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  // Use the in-memory rate-limit backend so tests don't need a live Postgres
  // pool. The default backend is Postgres; see middlewares/rateLimit.ts.
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  __resetRateLimitMemory();
  globalPoeCache.clear();
  __resetPoeBreaker();
  fakeCreate.mockReset();
  fakeCreate.mockResolvedValue(buildOkResponse());
});

describe("POST /api/poe/classify", () => {
  it("returns 400 when gridBase64 is missing", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-missing-grid")
      .send({ waterType: "saltwater" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "missing_field" });
    expect(fakeCreate).not.toHaveBeenCalled();
  });

  it("returns a 1024-element zones array on a valid request", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-valid")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-valid",
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.zones)).toBe(true);
    expect(res.body.zones).toHaveLength(1024);
    expect(res.body.fromCache).toBe(false);
    expect(fakeCreate).toHaveBeenCalledTimes(1);
  });

  it("sends a concrete output_format.schema (not empty {}) so Poe does not return 400", async () => {
    await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-schema-pin")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-schema-pin",
      });

    expect(fakeCreate).toHaveBeenCalledTimes(1);
    const body = fakeCreate.mock.calls[0]![0] as Record<string, unknown>;

    expect(body).not.toHaveProperty("text");
    expect(body).toHaveProperty("output_format");
    const outputFormat = body["output_format"] as Record<string, unknown>;
    expect(outputFormat["type"]).toBe("json_schema");
    const schema = outputFormat["schema"] as Record<string, unknown>;
    expect(schema).toBeTruthy();
    expect(schema["type"]).toBe("object");
    expect(schema).toHaveProperty("properties");
    expect(schema).toHaveProperty("required");
    expect(Object.keys(schema).length).toBeGreaterThan(0);
  });

  it("sends a concrete freshwater output_format.schema on freshwater classify", async () => {
    fakeCreate.mockReset();
    fakeCreate.mockResolvedValue({
      id: "resp_fresh",
      output_text: JSON.stringify({ zones: Array(1024).fill("aquatic_vegetation") }),
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-schema-fresh")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "freshwater",
        datasetId: "ds-schema-fresh",
      });

    expect(fakeCreate).toHaveBeenCalledTimes(1);
    const body = fakeCreate.mock.calls[0]![0] as Record<string, unknown>;
    const outputFormat = body["output_format"] as Record<string, unknown>;
    const schema = outputFormat["schema"] as Record<string, unknown>;
    const props = schema["properties"] as Record<string, { items?: { enum?: string[] } }>;
    const freshwaterZones = props["zones"]?.items?.enum ?? [];
    expect(freshwaterZones).toContain("aquatic_vegetation");
    expect(freshwaterZones).not.toContain("sandy_shelf");
  });

  it("returns fromCache=true on a repeated request with the same payload", async () => {
    const body = {
      gridBase64: GRID_BASE64,
      waterType: "saltwater" as const,
      datasetId: "ds-cache",
    };

    const first = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cache")
      .send(body);
    expect(first.status).toBe(200);
    expect(first.body.fromCache).toBe(false);

    const second = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cache")
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body.fromCache).toBe(true);
    expect(second.body.zones).toHaveLength(1024);
    // The Poe client should only have been called once — second was cached.
    expect(fakeCreate).toHaveBeenCalledTimes(1);
  });

  it("falls back to depth-based heuristic when AI throws and depths32 is supplied", async () => {
    fakeCreate.mockReset();
    fakeCreate.mockRejectedValue(new Error("POE_API_KEY environment variable is not set"));

    const depths32 = Array.from({ length: 1024 }, (_, i) => i);
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-heuristic")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-heur",
        depths32,
      });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("heuristic");
    expect(res.body.fromCache).toBe(false);
    expect(res.body.zones).toHaveLength(1024);
    // The heuristic must use the canonical four-band saltwater labels.
    const unique = new Set(res.body.zones as string[]);
    expect(unique.size).toBeGreaterThan(1);
    for (const z of unique) {
      expect([
        "sandy_shelf",
        "coarse_sediment",
        "silt_plain",
        "basalt_rock",
      ]).toContain(z);
    }
  });

  it("does not cache heuristic results — a later AI success can still be cached", async () => {
    const body = {
      gridBase64: GRID_BASE64,
      waterType: "saltwater" as const,
      datasetId: "ds-heur-then-ai",
      depths32: Array.from({ length: 1024 }, (_, i) => i),
    };

    // First call: AI fails → heuristic.
    fakeCreate.mockReset();
    fakeCreate.mockRejectedValue(new Error("transient AI outage"));
    const first = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-heur-cache")
      .send(body);
    expect(first.status).toBe(200);
    expect(first.body.source).toBe("heuristic");

    // Second call: AI succeeds → should NOT be served from cache (heuristic
    // was not persisted) and should report source="ai".
    fakeCreate.mockReset();
    fakeCreate.mockResolvedValue(buildOkResponse());
    const second = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-heur-cache")
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body.fromCache).toBe(false);
    expect(second.body.source).toBe("ai");
    expect(fakeCreate).toHaveBeenCalledTimes(1);
  });

  it("does not return a saltwater cache entry for a freshwater request with the same gridHash", async () => {
    // Same datasetId + same gridHash but different waterType. The
    // namespaced cache key (sha256 of gridHash + waterType) must keep the
    // two entries fully separate so a saltwater hit cannot satisfy a
    // freshwater lookup. The content of the responses is what proves
    // isolation: if the freshwater call returned the saltwater zones we'd
    // see "sandy_shelf" instead of "aquatic_vegetation".
    fakeCreate.mockReset();
    fakeCreate.mockImplementation(async (body: Record<string, unknown>) => {
      const wt =
        (body["metadata"] as { waterType?: string } | undefined)?.waterType ??
        "saltwater";
      const label = wt === "freshwater" ? "aquatic_vegetation" : "sandy_shelf";
      return {
        id: `resp_${wt}`,
        output_text: JSON.stringify({ zones: Array(1024).fill(label) }),
        usage: { input_tokens: 10, output_tokens: 20 },
      };
    });

    // Use a uniquely-named base64 + dataset id to ensure no prior test's
    // cache entry contaminates this scenario.
    const uniqueGrid = Buffer.from("wt-isolation-test-grid").toString("base64");
    const uniqueDsId = "ds-wt-isolation";
    const uniqueHash = "f00dface";

    const saltRes = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-wt-collision")
      .send({
        gridBase64: uniqueGrid,
        waterType: "saltwater",
        datasetId: uniqueDsId,
        gridHash: uniqueHash,
      });
    expect(saltRes.status).toBe(200);
    expect(saltRes.body.zones[0]).toBe("sandy_shelf");

    const freshRes = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-wt-collision")
      .send({
        gridBase64: uniqueGrid,
        waterType: "freshwater",
        datasetId: uniqueDsId,
        gridHash: uniqueHash,
      });
    expect(freshRes.status).toBe(200);
    // Critical assertion: the freshwater lookup must not be served from the
    // saltwater cache entry, even though gridHash and gridBase64 are identical.
    expect(freshRes.body.zones[0]).toBe("aquatic_vegetation");
  });

  it.skip("reconciles AI output against surveyed substrate for covered datasets (skipped: preset datasets retired in Task #403)", async () => {
    // thorne-bay is bundled with real ShoreZone substrate coverage. The AI
    // mock returns the freshwater label "aquatic_vegetation" everywhere — a
    // value that's not even in the saltwater enum — so any cell that comes
    // back as a valid saltwater substrate label MUST have been overwritten by
    // server-side reconciliation against the surveyed substrate polygons.
    fakeCreate.mockReset();
    fakeCreate.mockResolvedValue({
      id: "resp_reconcile",
      output_text: JSON.stringify({ zones: Array(1024).fill("aquatic_vegetation") }),
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-reconcile")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "thorne-bay",
      });

    expect(res.status).toBe(200);
    expect(res.body.zones).toHaveLength(1024);
    expect(typeof res.body.substrateFp).toBe("string");
    expect(res.body.substrateFp).not.toBe("00000000");

    const saltwaterLabels = new Set([
      "sandy_shelf", "coarse_sediment", "silt_plain", "basalt_rock",
      "volcanic_vent_field", "trench_wall", "seamount_flank", "coral_reef_potential",
    ]);
    const reconciledCount = (res.body.zones as string[])
      .filter((z) => saltwaterLabels.has(z)).length;
    // Covered cells must have been overwritten with surveyed labels — at
    // least one such cell is expected for the glacier-bay preset.
    expect(reconciledCount).toBeGreaterThan(0);
  });

  it("leaves AI output untouched for datasets with no substrate coverage", async () => {
    // Uploads (and datasets outside the bundled ShoreZone/ENC footprint) have
    // fingerprint "00000000" and must NOT be reconciled — the AI response
    // passes through unchanged.
    fakeCreate.mockReset();
    fakeCreate.mockResolvedValue({
      id: "resp_no_cov",
      output_text: JSON.stringify({ zones: Array(1024).fill("volcanic_vent_field") }),
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-no-cov")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "upload",
      });

    expect(res.status).toBe(200);
    expect(res.body.substrateFp).toBe("00000000");
    expect(new Set(res.body.zones as string[])).toEqual(new Set(["volcanic_vent_field"]));
  });

  it("uses the tiled path when depthsFull is supplied for a high-res dataset", async () => {
    // 128×128 grid → planTiles picks K=2 → 4 LLM calls.
    const W = 128;
    const H = 128;
    const depthsFull = Array.from({ length: W * H }, (_, i) => i);

    // Each tile gets a distinct label so we can spot which tile owned which
    // quadrant after stitching.
    let callIdx = 0;
    fakeCreate.mockReset();
    fakeCreate.mockImplementation(async () => {
      const label = `sandy_shelf`; // any valid label works
      callIdx++;
      return {
        id: `resp_tile_${callIdx}`,
        output_text: JSON.stringify({ zones: Array(1024).fill(label) }),
        usage: { input_tokens: 50, output_tokens: 100 },
      };
    });

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-tiled")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-tiled",
        depthsFull,
        widthFull: W,
        heightFull: H,
      });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("ai");
    expect(res.body.coarseWidth).toBe(64);
    expect(res.body.coarseHeight).toBe(64);
    expect(res.body.tilesTotal).toBe(4);
    expect(res.body.tilesAi).toBe(4);
    expect(res.body.tilesHeuristic).toBe(0);
    expect(res.body.zones).toHaveLength(64 * 64);
    expect(fakeCreate).toHaveBeenCalledTimes(4);
  });

  it("falls back to per-tile heuristic when AI is unavailable, marking source=partial", async () => {
    const W = 128;
    const H = 128;
    // Use a depth ramp so the heuristic produces a mix of zone labels rather
    // than a single flat value (lets us verify the heuristic actually ran).
    const depthsFull = Array.from({ length: W * H }, (_, i) => (i % 50));

    // Every per-tile AI call fails (including all retries), so every tile
    // should fall through to the heuristic. The whole-grid result is still
    // returned with source="partial" (mixed AI=0, heuristic=N).
    fakeCreate.mockReset();
    fakeCreate.mockRejectedValue(new Error("simulated AI outage"));

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-partial")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-partial",
        depthsFull,
        widthFull: W,
        heightFull: H,
      });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("partial");
    expect(res.body.tilesTotal).toBe(4);
    expect(res.body.tilesHeuristic).toBe(4);
    expect(res.body.tilesAi).toBe(0);
    expect(res.body.zones).toHaveLength(64 * 64);
    // Heuristic produces multiple zone labels for a non-flat depth grid.
    const unique = new Set(res.body.zones as string[]);
    expect(unique.size).toBeGreaterThan(1);
  });

  it("accepts a large depthsFull payload (>100 KB) and saturates the 16-tile cap", async () => {
    // A 256×256 grid serialises to ~130 KB of JSON — comfortably over the
    // default 100 KB Express body limit. This guards against future
    // regressions of the limit raise in `app.ts` and exercises the full
    // 4×4=16-tile cap end-to-end.
    const W = 256;
    const H = 256;
    const depthsFull = new Array(W * H).fill(0);

    fakeCreate.mockReset();
    fakeCreate.mockResolvedValue({
      id: "resp_big",
      output_text: JSON.stringify({ zones: Array(1024).fill("silt_plain") }),
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-big")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-big",
        depthsFull,
        widthFull: W,
        heightFull: H,
      });

    expect(res.status).toBe(200);
    expect(res.body.tilesTotal).toBeLessThanOrEqual(16);
    expect(res.body.tilesTotal).toBeGreaterThan(1);
    expect(res.body.coarseWidth).toBeGreaterThanOrEqual(64);
    expect(fakeCreate.mock.calls.length).toBeLessThanOrEqual(16);
  });

  it("single-tile: empty output_text (content-filtered) falls back to heuristic", async () => {
    fakeCreate.mockReset();
    fakeCreate.mockResolvedValue({
      id: "resp_cf_empty",
      output_text: "",
      usage: { input_tokens: 10, output_tokens: 0 },
    });

    const depths32 = Array.from({ length: 1024 }, (_, i) => i % 50);
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cf-empty")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-cf-empty",
        depths32,
      });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("heuristic");
    expect(res.body.zones).toHaveLength(1024);
  });

  it("single-tile: refusal string output_text falls back to heuristic", async () => {
    fakeCreate.mockReset();
    fakeCreate.mockResolvedValue({
      id: "resp_cf_refusal",
      output_text: "Sorry, I cannot classify this image as requested.",
      usage: { input_tokens: 10, output_tokens: 0 },
    });

    const depths32 = Array.from({ length: 1024 }, (_, i) => i % 50);
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cf-refusal")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-cf-refusal",
        depths32,
      });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("heuristic");
    expect(res.body.zones).toHaveLength(1024);
  });

  it("tiled: all tiles return empty output_text → source=partial, all tiles heuristic", async () => {
    const W = 128;
    const H = 128;
    const depthsFull = Array.from({ length: W * H }, (_, i) => i % 50);

    fakeCreate.mockReset();
    fakeCreate.mockResolvedValue({
      id: "resp_cf_tiled",
      output_text: "",
      usage: { input_tokens: 10, output_tokens: 0 },
    });

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cf-tiled")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-cf-tiled",
        depthsFull,
        widthFull: W,
        heightFull: H,
      });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("partial");
    expect(res.body.tilesHeuristic).toBe(res.body.tilesTotal);
    expect(res.body.tilesAi).toBe(0);
    expect(res.body.zones).toHaveLength(64 * 64);
  });

  it("falls through to the single-tile path when depthsFull resolves to K=1", async () => {
    const W = 32;
    const H = 32;
    const depthsFull = new Array(W * H).fill(0);

    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-small")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-small",
        depthsFull,
        widthFull: W,
        heightFull: H,
      });

    expect(res.status).toBe(200);
    expect(res.body.tilesTotal).toBe(1);
    expect(res.body.coarseWidth).toBe(32);
    expect(res.body.coarseHeight).toBe(32);
    expect(res.body.zones).toHaveLength(1024);
    expect(fakeCreate).toHaveBeenCalledTimes(1);
  });
});
