/**
 * settings-palette.test.ts — integration tests for the PUT /api/settings
 * palette and colour-related fields (paletteShallow, paletteDeep,
 * customStops, bandColors, bandBoundaries, colormapTheme).
 *
 * These tests verify the existing colour schema validation that was present
 * before the v15 viewscreen settings additions, ensuring the 400/500 paths
 * are exercised end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const settingsPaletteMocks = vi.hoisted(() => {
  const selectWhereMock = vi.fn().mockResolvedValue([]);
  const fromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue([]);
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
  return { selectWhereMock, fromMock, onConflictDoUpdateMock, valuesMock };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({
    db: {
      select: vi.fn().mockReturnValue({ from: settingsPaletteMocks.fromMock }),
      insert: vi.fn().mockReturnValue({ values: settingsPaletteMocks.valuesMock }),
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  lt: vi.fn(() => "lt-condition"),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => ({
    userId: req.headers["x-mock-clerk-user-id"] || null,
  })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../app.js";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";

beforeEach(() => {
  __resetRateLimitMemory();
});

const AUTH = { "x-mock-clerk-user-id": "user_palette123" };

describe("PUT /api/settings — paletteShallow / paletteDeep", () => {
  it("accepts valid hex colours for paletteShallow and paletteDeep", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteShallow: "#aabbcc", paletteDeep: "#001122" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("paletteShallow", "#aabbcc");
    expect(res.body).toHaveProperty("paletteDeep", "#001122");
  });

  it("returns 400 when paletteShallow is not a valid hex colour", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteShallow: "not-a-hex" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when paletteDeep is a 3-char shorthand (only 6-char hex accepted)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteDeep: "#abc" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — colormapTheme", () => {
  it("accepts each valid colormapTheme value", async () => {
    const themes = ["ocean", "thermal", "grayscale", "viridis", "freshwater", "custom"] as const;
    for (const theme of themes) {
      const res = await request(app)
        .put("/api/settings")
        .set(AUTH)
        .send({ colormapTheme: theme });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("colormapTheme", theme);
    }
  });

  it("returns 400 for an unrecognised colormapTheme", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ colormapTheme: "rainbow" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — bandColors", () => {
  const validBandColors = [
    "#00e5ff", "#00c8de", "#00a8d0", "#0288d1", "#0277bd",
    "#1565c0", "#0d47a1", "#1a237e", "#283593", "#1e2b6e",
  ];

  it("accepts exactly 10 valid hex band colours", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandColors: validBandColors });
    expect(res.status).toBe(200);
    expect(res.body.bandColors).toHaveLength(10);
  });

  it("returns 400 when fewer than 10 band colours are supplied", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandColors: validBandColors.slice(0, 9) });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when more than 10 band colours are supplied", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandColors: [...validBandColors, "#ffffff"] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a band colour is not a valid hex string", async () => {
    const bad = [...validBandColors];
    bad[3] = "blue";
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandColors: bad });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — bandBoundaries", () => {
  const validBoundaries = [0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000];

  it("accepts valid strictly-increasing boundaries starting at 0 and ending at 2000", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: validBoundaries });
    expect(res.status).toBe(200);
    expect(res.body.bandBoundaries).toEqual(validBoundaries);
  });

  it("returns 400 when bandBoundaries does not start with 0", async () => {
    const bad = [10, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: bad });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when bandBoundaries does not end with 2000", async () => {
    const bad = [0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 1999];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: bad });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when bandBoundaries has a non-strictly-increasing entry", async () => {
    const bad = [0, 50, 100, 100, 200, 250, 300, 350, 450, 600, 2000];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: bad });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when bandBoundaries has fewer than 11 entries", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: [0, 50, 100, 200, 300, 400, 500, 600, 700, 2000] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — customStops", () => {
  it("accepts valid custom stops with at least 2 entries", async () => {
    const stops = [
      { position: 0, hex: "#00e5ff" },
      { position: 1, hex: "#283593" },
    ];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ customStops: stops });
    expect(res.status).toBe(200);
    expect(res.body.customStops).toHaveLength(2);
  });

  it("returns 400 when customStops has fewer than 2 entries", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ customStops: [{ position: 0, hex: "#00e5ff" }] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a customStop hex is not a valid colour", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        customStops: [
          { position: 0, hex: "cyan" },
          { position: 1, hex: "#283593" },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a customStop position is outside [0, 1]", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        customStops: [
          { position: -0.1, hex: "#00e5ff" },
          { position: 1, hex: "#283593" },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — fogDensity range guard", () => {
  it("accepts fogDensity within 0.004–0.03", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ fogDensity: 0.015 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("fogDensity", 0.015);
  });

  it("returns 400 when fogDensity is below 0.004", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ fogDensity: 0.001 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when fogDensity exceeds 0.03", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ fogDensity: 0.1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — hudOpacity range guard", () => {
  it("accepts hudOpacity within 0.3–1", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hudOpacity: 0.6 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("hudOpacity", 0.6);
  });

  it("returns 400 when hudOpacity is below 0.3", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hudOpacity: 0.1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when hudOpacity exceeds 1", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hudOpacity: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});
