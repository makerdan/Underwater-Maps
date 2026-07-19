/**
 * rateLimit-ip-spoofing.test.ts
 *
 * Verifies that the IP-based rate limiter cannot be bypassed via a forged
 * X-Forwarded-For header.
 *
 * Security context
 * ----------------
 * `app.set("trust proxy", 1)` instructs Express to trust exactly ONE proxy
 * hop. In production, Replit's mTLS reverse proxy sits in front of the API
 * server and appends the real client IP to the X-Forwarded-For chain. Because
 * trust proxy = 1, Express reads `req.ip` from the rightmost *untrusted*
 * entry in XFF — the one the trusted proxy recorded — rather than the raw
 * leftmost header value that the client itself could have forged.
 *
 * The `clientIp()` helper in middlewares/rateLimit.ts uses `req.ip`, so the
 * bucket key is always derived from the Express-resolved IP, not from an
 * arbitrary string the client injects.
 *
 * Test suites
 * -----------
 * 1. Rate-limit bucket is keyed on req.ip (XFF-resolved by Express).
 * 2. A multi-hop forged XFF chain: when the client prepends extra fake IPs,
 *    Express with trust proxy = 1 resolves `req.ip` to the second-to-last hop
 *    (the one the trusted proxy recorded), NOT the attacker-injected outermost
 *    value — preventing the attacker from rotating into a fresh bucket by
 *    prepending arbitrary IPs.
 * 3. Per-IP isolation: exhausting one IP's quota does not affect a different IP.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  customDatasetsTable: {},
  userSettingsTable: {},
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
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

import app from "../../app.js";
import {
  __resetRateLimitMemory,
  __prefillRateLimitMemory,
} from "../../middlewares/rateLimit.js";

const UPLOAD_ROUTE = "dataset-upload";
const WINDOW_MS = 60_000;
const IP_MAX = 10;

const MINIMAL_CSV = "lon,lat,depth\n-136.0,58.5,50\n-136.1,58.6,55\n";
const E2E_USER = "user_spoofing_test";

beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Suite 1: Rate-limit bucket is keyed on req.ip
// With trust proxy = 1 and supertest (socket = 127.0.0.1), Express uses the
// X-Forwarded-For value as req.ip when the header is present. The bucket key
// must match `i:<route>:<req.ip>` — prefilling that key must block the request.
// ---------------------------------------------------------------------------

describe("IP rate-limit — bucket key matches req.ip", () => {
  it("blocks a request whose req.ip bucket is already exhausted", async () => {
    const clientIp = "203.0.113.55";
    __prefillRateLimitMemory(`i:${UPLOAD_ROUTE}:${clientIp}`, IP_MAX, WINDOW_MS);

    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", clientIp)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("allows a request from an IP whose bucket is not exhausted", async () => {
    const freshIp = "203.0.113.99";

    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", freshIp)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    expect(res.status).not.toBe(429);
    expect(Number(res.headers["x-ratelimit-remaining"])).toBeGreaterThan(0);
  });

  it("counts consecutive requests against the same IP bucket", async () => {
    const ip = "203.0.113.77";
    __prefillRateLimitMemory(`i:${UPLOAD_ROUTE}:${ip}`, IP_MAX - 1, WINDOW_MS);

    const penultimate = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", ip)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");
    expect(penultimate.status).not.toBe(429);
    expect(penultimate.headers["x-ratelimit-remaining"]).toBe("0");

    const blocked = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", ip)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");
    expect(blocked.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Multi-hop XFF spoofing prevention
//
// An attacker behind a real proxy might try to prepend extra IPs to XFF to
// rotate into a fresh bucket:
//   X-Forwarded-For: attacker-forged, real-client-ip, trusted-proxy-ip
//
// With `trust proxy = 1`, Express strips ONE hop from the right (the trusted
// proxy IP recorded by the socket). The next entry — `real-client-ip` — becomes
// req.ip. The attacker-forged leftmost entry is IGNORED.
//
// Concretely: the rate-limit bucket is keyed on `real-client-ip`, not on
// `attacker-forged`. Prepending extra IPs to XFF cannot move the attacker
// into a fresh bucket; the trusted proxy's recorded IP is always what counts.
// ---------------------------------------------------------------------------

describe("IP rate-limit — multi-hop XFF: forged outer IPs are NOT used as the bucket key", () => {
  it("bucket is keyed on the first untrusted hop, not the attacker-prepended outer IP", async () => {
    // Simulate: attacker prepends a fake outer IP, real-client-ip is second,
    // 127.0.0.1 is the trusted proxy (the test socket).
    // With trust proxy = 1, Express resolves req.ip = real-client-ip (second entry).
    const realClientIp = "198.51.100.10";
    const forgedOuterIp = "10.0.0.1";

    // Pre-exhaust the bucket for the real client IP.
    __prefillRateLimitMemory(`i:${UPLOAD_ROUTE}:${realClientIp}`, IP_MAX, WINDOW_MS);

    // Request with a multi-hop XFF: forged outer + real client + trusted proxy.
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", `${forgedOuterIp}, ${realClientIp}`)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    // The request must be blocked — proving the bucket key resolved to
    // `realClientIp` (not `forgedOuterIp`, which has an empty bucket).
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
  });

  it("the forged outer IP does NOT have its own quota consumed", async () => {
    const realClientIp = "198.51.100.20";
    const forgedOuterIp = "192.0.2.1";

    // Exhaust only the forged IP's bucket (simulating attacker's old trick
    // of targeting someone else's quota via single-value XFF).
    __prefillRateLimitMemory(`i:${UPLOAD_ROUTE}:${forgedOuterIp}`, IP_MAX, WINDOW_MS);

    // Now send with multi-hop XFF. The trusted proxy records realClientIp,
    // so req.ip = realClientIp (fresh bucket) → request must be allowed.
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", `${forgedOuterIp}, ${realClientIp}`)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");

    expect(res.status).not.toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Per-IP isolation
// ---------------------------------------------------------------------------

describe("IP rate-limit — per-IP isolation", () => {
  it("exhausting one IP's quota does not affect a different IP", async () => {
    const exhaustedIp = "203.0.113.100";
    const unaffectedIp = "203.0.113.101";
    __prefillRateLimitMemory(`i:${UPLOAD_ROUTE}:${exhaustedIp}`, IP_MAX, WINDOW_MS);

    const exhaustedRes = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", exhaustedIp)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");
    expect(exhaustedRes.status).toBe(429);

    const freshRes = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .set("x-forwarded-for", unaffectedIp)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(MINIMAL_CSV), "test.csv");
    expect(freshRes.status).not.toBe(429);
  });
});
