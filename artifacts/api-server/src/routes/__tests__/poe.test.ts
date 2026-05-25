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

  it("returns 429 once the per-user rate limit (30 req/min) is exceeded", async () => {
    const userId = "user-ratelimit";

    // Burn through the 30-request window. Vary datasetId so the cache
    // doesn't short-circuit each call before logUsage runs.
    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .post("/api/poe/classify")
        .set("x-e2e-user-id", userId)
        .send({
          gridBase64: GRID_BASE64,
          waterType: "saltwater",
          datasetId: `ds-rl-${i}`,
        });
      expect(res.status).toBe(200);
    }

    const limited = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", userId)
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-rl-overflow",
      });

    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: "rate_limit" });
  });
});

describe("POST /api/poe/describe — client disconnect", () => {
  it("aborts the upstream stream when the client closes the connection mid-stream", async () => {
    // Capture the AbortSignal the route passes to the streaming SDK call.
    let receivedSignal: AbortSignal | undefined;
    let upstreamAborted = false;

    fakeChatCreate.mockReset();
    fakeChatCreate.mockImplementation(
      async (
        _body: unknown,
        opts?: { signal?: AbortSignal },
      ): Promise<AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>> => {
        receivedSignal = opts?.signal;
        receivedSignal?.addEventListener("abort", () => {
          upstreamAborted = true;
        });
        async function* gen() {
          // Stream indefinitely until aborted.
          for (let i = 0; i < 1000; i++) {
            if (receivedSignal?.aborted) {
              throw Object.assign(new Error("aborted"), { name: "AbortError" });
            }
            yield { choices: [{ delta: { content: "x" } }] };
            await new Promise((r) => setTimeout(r, 20));
          }
        }
        return gen();
      },
    );

    const server = app.listen(0);
    try {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no address");
      const port = addr.port;

      // Fire a request with the http module so we can destroy mid-flight.
      const http = await import("node:http");
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/poe/describe",
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-e2e-user-id": "user-describe-abort",
            },
          },
          (res) => {
            let received = 0;
            res.on("data", () => {
              received++;
              // Tear down after we've seen a couple of chunks so we know the
              // stream is genuinely flowing.
              if (received >= 2) req.destroy();
            });
            res.on("close", () => resolve());
            res.on("error", () => resolve());
          },
        );
        req.on("error", () => resolve());
        req.write(
          JSON.stringify({
            lon: 0,
            lat: 0,
            depth: 100,
            zoneName: "sandy_shelf",
            datasetName: "ds",
            waterType: "saltwater",
          }),
        );
        req.end();

        setTimeout(() => reject(new Error("test timed out")), 8000);
      });

      // Give the server a moment to wire the close → abort propagation.
      await new Promise((r) => setTimeout(r, 100));
      expect(receivedSignal).toBeDefined();
      expect(receivedSignal?.aborted).toBe(true);
      expect(upstreamAborted).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
