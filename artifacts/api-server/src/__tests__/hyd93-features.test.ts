/**
 * hyd93-features.test.ts
 *
 * Proves that HYD93 annotation points survive the full pipeline:
 *   parse (.a93.gz) → routeTarEntries → hyd93Features → GET endpoint
 *
 * Fixture: inline HYD93 text (same 42-char fixed-width format as
 * parser-hyd93-a93.test.ts) with one row for each of the five annotation
 * feature codes called out in the task: 89, 103, 146, 530, 988.
 * Two fc=711 sounding rows are included so routeTarEntries does not throw
 * NO_PARSEABLE_DATA (it requires at least one depth sounding).
 *
 * Two test suites:
 *
 *  1. routeTarEntries integration — writes the fixture .a93.gz to a real
 *     temp directory, calls routeTarEntries directly, and asserts that all
 *     five feature codes are returned with correct lat/lon.
 *
 *  2. GET /api/user/datasets/:id/hyd93-features HTTP unit tests — mocks
 *     the DB and asserts the 404 path, the null-JSON empty-array fallback,
 *     and the happy-path 200 with stored features.
 *
 * Column layout (42 chars per line, excluding newline):
 *   [0,  8)  survey_id      — "H09084  "
 *   [8, 19)  lat_millionths — 11-char right-justified integer (lat × 1e6)
 *  [19, 31)  lon_millionths — 12-char right-justified signed integer
 *  [31, 38)  depth_cm       — 7-char integer; 9999999 = null sentinel
 *  [38, 39)  type_of_obs    — '6' = deeper-than (excluded)
 *  [39, 42)  feature_code   — 3-char right-justified; 711 = sounding
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import * as zlib from "zlib";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import request from "supertest";

// ---------------------------------------------------------------------------
// Fixture — 7 lines, exactly 42 chars each
// ---------------------------------------------------------------------------
//
// Encoding: lat/lon as millionths of a degree.
//   55680000 → 55.680000 °N    -132500000 → -132.500000 °W
//   55681000 → 55.681000 °N    -132501000 → -132.501000 °W   (fc 89  rocks)
//   55682000 → 55.682000 °N    -132502000 → -132.502000 °W   (fc 103 kelp)
//   55683000 → 55.683000 °N    -132503000 → -132.503000 °W   (fc 146 reef)
//   55684000 → 55.684000 °N    -132504000 → -132.504000 °W   (fc 530 rocky reef)
//   55685000 → 55.685000 °N    -132505000 → -132.505000 °W   (fc 988 obstruction)
//   55686000 → 55.686000 °N    -132506000 → -132.506000 °W   (fc 711 sounding)

const FIXTURE_LINES_5FC = [
  // sounding 1 (fc=711): depth=500cm=5.0m — needed so routeTarEntries has ≥1 point
  "H09084     55680000  -132500000    5000711",
  // fc=89  rocks
  "H09084     55681000  -132501000      00 89",
  // fc=103 kelp
  "H09084     55682000  -132502000      00103",
  // fc=146 ledges / reef
  "H09084     55683000  -132503000      00146",
  // fc=530 rocky reef
  "H09084     55684000  -132504000      00530",
  // fc=988 obstruction
  "H09084     55685000  -132505000      00988",
  // sounding 2 (fc=711): depth=600cm=6.0m
  "H09084     55686000  -132506000    6000711",
].join("\n");

// ---------------------------------------------------------------------------
// Mocks (must be declared before any imports that trigger module loading)
// ---------------------------------------------------------------------------

// Shared state that lets each HTTP test control what db.select returns.
const dbState = vi.hoisted(() => ({
  // Default: no row found (→ 404).
  selectResult: [] as unknown[],
}));

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const whereMock = vi.fn(() => Promise.resolve(dbState.selectResult));
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  return createDbMock({
    db: {
      select: vi.fn().mockReturnValue({ from: fromMock }),
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  desc: vi.fn(() => "desc-condition"),
  sql: vi.fn(() => "sql-condition"),
  lt: vi.fn(() => "lt-condition"),
  inArray: vi.fn(() => "in-condition"),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => {
    const header = req.headers["x-mock-clerk-user-id"];
    return { userId: header ?? null };
  }),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks so Vitest hoisting applies)
// ---------------------------------------------------------------------------

import { routeTarEntries } from "../lib/noaaTarRouter.js";
import app from "../app.js";

const AUTHED_HEADER = { "x-mock-clerk-user-id": "user_hyd93_test" };
const DATASET_ID = "hyd93-test-dataset-id";

// ===========================================================================
// Suite 1 — routeTarEntries pipeline integration
// ===========================================================================

describe("routeTarEntries — HYD93 .a93.gz annotation extraction", () => {
  let tmpDir: string;

  beforeAll(async () => {
    // Write a real .a93.gz under GEODAS/ so the tar router finds and parses it.
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hyd93-int-"));
    const geodasDir = path.join(tmpDir, "GEODAS");
    await fs.promises.mkdir(geodasDir, { recursive: true });
    const compressed = zlib.gzipSync(Buffer.from(FIXTURE_LINES_5FC, "ascii"));
    await fs.promises.writeFile(path.join(geodasDir, "H09084.a93.gz"), compressed);
  });

  afterAll(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns all five annotation feature codes (89, 103, 146, 530, 988)", async () => {
    const result = await routeTarEntries(
      tmpDir,
      ["GEODAS/H09084.a93.gz"],
      "H09084.tar.gz",
    );
    const codes = result.hyd93Features.map((f) => f.featureCode).sort((a, b) => a - b);
    expect(codes).toEqual([89, 103, 146, 530, 988]);
  });

  it("carries correct lat/lon for feature code 89 (rocks)", async () => {
    const result = await routeTarEntries(
      tmpDir,
      ["GEODAS/H09084.a93.gz"],
      "H09084.tar.gz",
    );
    const fc89 = result.hyd93Features.find((f) => f.featureCode === 89)!;
    expect(fc89).toBeDefined();
    expect(fc89.lat).toBeCloseTo(55.681, 3);
    expect(fc89.lon).toBeCloseTo(-132.501, 3);
  });

  it("carries correct lat/lon for feature code 103 (kelp)", async () => {
    const result = await routeTarEntries(
      tmpDir,
      ["GEODAS/H09084.a93.gz"],
      "H09084.tar.gz",
    );
    const fc103 = result.hyd93Features.find((f) => f.featureCode === 103)!;
    expect(fc103).toBeDefined();
    expect(fc103.lat).toBeCloseTo(55.682, 3);
    expect(fc103.lon).toBeCloseTo(-132.502, 3);
  });

  it("carries correct lat/lon for feature code 146 (ledges/reef)", async () => {
    const result = await routeTarEntries(
      tmpDir,
      ["GEODAS/H09084.a93.gz"],
      "H09084.tar.gz",
    );
    const fc146 = result.hyd93Features.find((f) => f.featureCode === 146)!;
    expect(fc146).toBeDefined();
    expect(fc146.lat).toBeCloseTo(55.683, 3);
    expect(fc146.lon).toBeCloseTo(-132.503, 3);
  });

  it("carries correct lat/lon for feature code 530 (rocky reef)", async () => {
    const result = await routeTarEntries(
      tmpDir,
      ["GEODAS/H09084.a93.gz"],
      "H09084.tar.gz",
    );
    const fc530 = result.hyd93Features.find((f) => f.featureCode === 530)!;
    expect(fc530).toBeDefined();
    expect(fc530.lat).toBeCloseTo(55.684, 3);
    expect(fc530.lon).toBeCloseTo(-132.504, 3);
  });

  it("carries correct lat/lon for feature code 988 (obstruction)", async () => {
    const result = await routeTarEntries(
      tmpDir,
      ["GEODAS/H09084.a93.gz"],
      "H09084.tar.gz",
    );
    const fc988 = result.hyd93Features.find((f) => f.featureCode === 988)!;
    expect(fc988).toBeDefined();
    expect(fc988.lat).toBeCloseTo(55.685, 3);
    expect(fc988.lon).toBeCloseTo(-132.505, 3);
  });

  it("also extracts depth soundings from the same file", async () => {
    const result = await routeTarEntries(
      tmpDir,
      ["GEODAS/H09084.a93.gz"],
      "H09084.tar.gz",
    );
    // Two fc=711 sounding rows in fixture → two points
    expect(result.points.length).toBe(2);
    expect(result.points[0]!.depth).toBeCloseTo(5.0, 6);
    expect(result.points[1]!.depth).toBeCloseTo(6.0, 6);
  });

  it("annotation features are disjoint from depth soundings", async () => {
    const result = await routeTarEntries(
      tmpDir,
      ["GEODAS/H09084.a93.gz"],
      "H09084.tar.gz",
    );
    const soundingLats = new Set(result.points.map((p) => p.lat));
    const overlap = result.hyd93Features.some((f) => soundingLats.has(f.lat));
    expect(overlap).toBe(false);
  });
});

// ===========================================================================
// Suite 2 — GET /api/user/datasets/:id/hyd93-features HTTP unit tests
// ===========================================================================

describe("GET /api/user/datasets/:id/hyd93-features", () => {
  beforeEach(() => {
    // Reset to "no row found" between tests so each test controls its own result.
    dbState.selectResult = [];
  });

  it("returns 401 when no authentication header is present", async () => {
    const res = await request(app).get(
      `/api/user/datasets/${DATASET_ID}/hyd93-features`,
    );
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when the dataset does not exist for this user", async () => {
    dbState.selectResult = []; // no row → not found
    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/hyd93-features`)
      .set(AUTHED_HEADER);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      error: "not_found",
    });
  });

  it("returns 200 with an empty array when hyd93FeaturesJson is null", async () => {
    dbState.selectResult = [{ hyd93FeaturesJson: null }];
    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/hyd93-features`)
      .set(AUTHED_HEADER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with the stored features array when hyd93FeaturesJson is populated", async () => {
    const storedFeatures = [
      { lon: -132.501, lat: 55.681, featureCode: 89 },
      { lon: -132.502, lat: 55.682, featureCode: 103 },
      { lon: -132.503, lat: 55.683, featureCode: 146 },
      { lon: -132.504, lat: 55.684, featureCode: 530 },
      { lon: -132.505, lat: 55.685, featureCode: 988 },
    ];
    dbState.selectResult = [{ hyd93FeaturesJson: storedFeatures }];

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/hyd93-features`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(5);

    const codes = (res.body as Array<{ featureCode: number }>)
      .map((f) => f.featureCode)
      .sort((a, b) => a - b);
    expect(codes).toEqual([89, 103, 146, 530, 988]);
  });

  it("round-trips lat/lon values without precision loss", async () => {
    const storedFeatures = [
      { lon: -132.501, lat: 55.681, featureCode: 89 },
    ];
    dbState.selectResult = [{ hyd93FeaturesJson: storedFeatures }];

    const res = await request(app)
      .get(`/api/user/datasets/${DATASET_ID}/hyd93-features`)
      .set(AUTHED_HEADER);

    expect(res.status).toBe(200);
    const feature = (res.body as Array<{ lat: number; lon: number; featureCode: number }>)[0]!;
    expect(feature.lat).toBeCloseTo(55.681, 3);
    expect(feature.lon).toBeCloseTo(-132.501, 3);
    expect(feature.featureCode).toBe(89);
  });
});
