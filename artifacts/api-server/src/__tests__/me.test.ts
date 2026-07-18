/**
 * me.test.ts — integration tests for PUT /api/settings validating the 17
 * new viewscreen settings fields added in settingsStore v15.
 *
 * Covers:
 *   • 401 when unauthenticated
 *   • 200 with valid payloads for all 17 new fields
 *   • 400 when each field receives an out-of-range or wrong-type value
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// vi.hoisted ensures these refs are available inside the vi.mock() factory,
// which vitest hoists above all imports. We keep them at module scope so
// beforeEach can reset their resolved values between tests.
const { selectWhereMock, fromMock, onConflictDoUpdateMock, valuesMock } =
  vi.hoisted(() => {
    const selectWhereMock = vi.fn().mockResolvedValue([]);
    const fromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
    const onConflictDoUpdateMock = vi.fn().mockResolvedValue([]);
    const valuesMock = vi.fn().mockReturnValue({
      onConflictDoUpdate: onConflictDoUpdateMock,
    });
    return { selectWhereMock, fromMock, onConflictDoUpdateMock, valuesMock };
  });

vi.mock("@workspace/db", () => {
  const stored: Record<string, unknown> = {};

  return {
    db: {
      select: vi.fn().mockReturnValue({ from: fromMock }),
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    },
    userSettingsTable: { userId: "userId", settings: "settings" },
    userCatalogSavesTable: {
      id: "id",
      userId: "userId",
      catalogId: "catalogId",
      status: "status",
      requestedAt: "requestedAt",
      readyAt: "readyAt",
      cacheKey: "cacheKey",
      errorMessage: "errorMessage",
      folderId: "folderId",
      datasetId: "datasetId",
    },
    _stored: stored,
  };
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

const AUTH = { "x-mock-clerk-user-id": "user_test123" };

// Reset DB mock state before each test so no settings row for user_test123
// bleeds from one test into the next (simulates a clean slate per-test).
beforeEach(() => {
  selectWhereMock.mockResolvedValue([]);
  onConflictDoUpdateMock.mockResolvedValue([]);
});

describe("PUT /api/settings — auth required", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).put("/api/settings").send({ windOverlayActive: true });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Unauthorized");
  });
});

describe("PUT /api/settings — boolean overlay toggles (new v15 fields)", () => {
  it("accepts valid boolean values for all seven boolean overlay fields", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        weatherStationsActive: true,
        rawsOverlayActive: true,
        windOverlayActive: false,
        tideOverlayActive: true,
        currentOverlayActive: false,
        sidePaneCollapsed: true,
        zoneOverlayEnabled: true,
        zonePaintMode: false,
        substrateColorMode: true,
        intertidalHotspotsEnabled: false,
        efhOverlayEnabled: true,
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("windOverlayActive", false);
    expect(res.body).toHaveProperty("tideOverlayActive", true);
    expect(res.body).toHaveProperty("currentOverlayActive", false);
    expect(res.body).toHaveProperty("weatherStationsActive", true);
    expect(res.body).toHaveProperty("rawsOverlayActive", true);
    expect(res.body).toHaveProperty("sidePaneCollapsed", true);
    expect(res.body).toHaveProperty("zoneOverlayEnabled", true);
    expect(res.body).toHaveProperty("substrateColorMode", true);
    expect(res.body).toHaveProperty("efhOverlayEnabled", true);
  });

  it("returns 400 when windOverlayActive is not a boolean", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ windOverlayActive: "yes" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when tideOverlayActive is not a boolean", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ tideOverlayActive: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when currentOverlayActive is not a boolean", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ currentOverlayActive: null });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — currentDepthLayers (new v15 field)", () => {
  it("accepts a valid currentDepthLayers array", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ currentDepthLayers: ["surface", "mid", "near-bottom"] });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("currentDepthLayers");
    expect(res.body.currentDepthLayers).toContain("surface");
  });

  it("accepts a single-element currentDepthLayers array", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ currentDepthLayers: ["mid"] });
    expect(res.status).toBe(200);
    expect(res.body.currentDepthLayers).toEqual(["mid"]);
  });

  it("returns 400 when currentDepthLayers contains an invalid value", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ currentDepthLayers: ["deep"] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when currentDepthLayers is not an array", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ currentDepthLayers: "mid" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — zonePaintBrushRadius (new v15 field)", () => {
  it("accepts a brush radius within 1–20", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zonePaintBrushRadius: 10 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("zonePaintBrushRadius", 10);
  });

  it("returns 400 when zonePaintBrushRadius is below minimum (0)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zonePaintBrushRadius: 0 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when zonePaintBrushRadius exceeds maximum (21)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zonePaintBrushRadius: 21 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when zonePaintBrushRadius is not a number", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zonePaintBrushRadius: "large" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — zonePaintSlot (new v15 field)", () => {
  it("accepts slot values 0–3", async () => {
    for (const slot of [0, 1, 2, 3]) {
      const res = await request(app)
        .put("/api/settings")
        .set(AUTH)
        .send({ zonePaintSlot: slot });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("zonePaintSlot", slot);
    }
  });

  it("returns 400 when zonePaintSlot is out of range (4)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zonePaintSlot: 4 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when zonePaintSlot is negative", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zonePaintSlot: -1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when zonePaintSlot is a non-integer float", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zonePaintSlot: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — hiddenSubstrateClasses (new v15 field)", () => {
  it("accepts an array of strings", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hiddenSubstrateClasses: ["sand", "gravel", "mud"] });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("hiddenSubstrateClasses");
    expect(res.body.hiddenSubstrateClasses).toContain("sand");
  });

  it("accepts an empty array", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hiddenSubstrateClasses: [] });
    expect(res.status).toBe(200);
    expect(res.body.hiddenSubstrateClasses).toEqual([]);
  });

  it("returns 400 when hiddenSubstrateClasses contains a non-string", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hiddenSubstrateClasses: [42, "sand"] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when hiddenSubstrateClasses is not an array", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hiddenSubstrateClasses: "sand" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — intertidalScoreMode (new v15 field)", () => {
  it("accepts 'tidepool'", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalScoreMode: "tidepool" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("intertidalScoreMode", "tidepool");
  });

  it("accepts 'beachcombing'", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalScoreMode: "beachcombing" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("intertidalScoreMode", "beachcombing");
  });

  it("returns 400 for an unrecognised intertidalScoreMode value", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalScoreMode: "fishing" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — hiddenEfhSpecies (new v15 field)", () => {
  it("accepts an array of species strings", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hiddenEfhSpecies: ["Pacific Cod", "Rockfish"] });
    expect(res.status).toBe(200);
    expect(res.body.hiddenEfhSpecies).toContain("Pacific Cod");
  });

  it("accepts an empty array", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hiddenEfhSpecies: [] });
    expect(res.status).toBe(200);
    expect(res.body.hiddenEfhSpecies).toEqual([]);
  });

  it("returns 400 when hiddenEfhSpecies contains a non-string element", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hiddenEfhSpecies: [null] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — globalFontSize (new v16 field)", () => {
  it("accepts all six valid FontSizeLevel values", async () => {
    const levels = ["smallest", "small", "medium", "large", "x-large", "largest"];
    for (const level of levels) {
      const res = await request(app)
        .put("/api/settings")
        .set(AUTH)
        .send({ globalFontSize: level });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("globalFontSize", level);
    }
  });

  it("returns 400 for an unrecognised globalFontSize value", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ globalFontSize: "enormous" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when globalFontSize is not a string", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ globalFontSize: 3 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("defaults to 'medium' when globalFontSize is omitted from the payload", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ fogDensity: 0.012 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("globalFontSize", "medium");
  });
});

describe("PUT /api/settings — hasSeenToolbarRelocationHint (v23 field)", () => {
  it("round-trips true and false", async () => {
    for (const value of [true, false]) {
      const res = await request(app)
        .put("/api/settings")
        .set(AUTH)
        .send({ hasSeenToolbarRelocationHint: value });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("hasSeenToolbarRelocationHint", value);
    }
  });

  it("returns 400 when hasSeenToolbarRelocationHint is not a boolean", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hasSeenToolbarRelocationHint: "yes" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("defaults to false when omitted from the payload", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ fogDensity: 0.012 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("hasSeenToolbarRelocationHint", false);
  });
});

describe("PUT /api/settings — paletteShallow", () => {
  it("accepts a valid 6-digit hex colour", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteShallow: "#ab12cd" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("paletteShallow", "#ab12cd");
  });

  it("accepts uppercase hex digits", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteShallow: "#FF00AA" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("paletteShallow", "#FF00AA");
  });

  it("returns 400 when paletteShallow is not a hex colour (plain word)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteShallow: "blue" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when paletteShallow has only 3 hex digits", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteShallow: "#abc" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when paletteShallow is missing the leading #", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteShallow: "00e5ff" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when paletteShallow is a number", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteShallow: 0x00e5ff });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — paletteDeep", () => {
  it("accepts a valid 6-digit hex colour", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteDeep: "#1a237e" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("paletteDeep", "#1a237e");
  });

  it("returns 400 when paletteDeep has 7 hex digits (too long)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteDeep: "#1234567" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when paletteDeep contains invalid characters", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteDeep: "#gg0000" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when paletteDeep is null", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ paletteDeep: null });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — customStops", () => {
  it("accepts a valid 4-stop array", async () => {
    const stops = [
      { position: 0.0, hex: "#00e5ff" },
      { position: 0.3, hex: "#0d47a1" },
      { position: 0.65, hex: "#1a237e" },
      { position: 1.0, hex: "#283593" },
    ];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ customStops: stops });
    expect(res.status).toBe(200);
    expect(res.body.customStops).toHaveLength(4);
    expect(res.body.customStops[0]).toMatchObject({ position: 0, hex: "#00e5ff" });
  });

  it("accepts the minimum 2-stop array", async () => {
    const stops = [
      { position: 0.0, hex: "#ffffff" },
      { position: 1.0, hex: "#000000" },
    ];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ customStops: stops });
    expect(res.status).toBe(200);
    expect(res.body.customStops).toHaveLength(2);
  });

  it("returns 400 when customStops has only 1 element (below min of 2)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ customStops: [{ position: 0.0, hex: "#00e5ff" }] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when customStops is an empty array", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ customStops: [] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a stop has a position above 1", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        customStops: [
          { position: 0.0, hex: "#00e5ff" },
          { position: 1.5, hex: "#283593" },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a stop has a position below 0", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        customStops: [
          { position: -0.1, hex: "#00e5ff" },
          { position: 1.0, hex: "#283593" },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a stop hex is not a valid hex colour", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        customStops: [
          { position: 0.0, hex: "red" },
          { position: 1.0, hex: "#283593" },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a stop is missing the hex field", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        customStops: [
          { position: 0.0 },
          { position: 1.0, hex: "#283593" },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when customStops is not an array", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ customStops: "gradient" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — bandColors", () => {
  const TEN_COLORS = [
    "#00e5ff", "#00c8de", "#00a8d0", "#0288d1", "#0277bd",
    "#1565c0", "#0d47a1", "#1a237e", "#283593", "#1e2b6e",
  ];

  it("accepts exactly 10 valid hex colours", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandColors: TEN_COLORS });
    expect(res.status).toBe(200);
    expect(res.body.bandColors).toHaveLength(10);
    expect(res.body.bandColors[0]).toBe("#00e5ff");
  });

  it("returns 400 when bandColors has only 9 entries (below min of 10)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandColors: TEN_COLORS.slice(0, 9) });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when bandColors has 11 entries (above max of 10)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandColors: [...TEN_COLORS, "#ffffff"] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when one of the bandColors is not a valid hex colour", async () => {
    const bad = [...TEN_COLORS];
    bad[3] = "navy";
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandColors: bad });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when one bandColor has a 3-digit hex shorthand", async () => {
    const bad = [...TEN_COLORS];
    bad[0] = "#fff";
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandColors: bad });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when bandColors is not an array", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandColors: "#00e5ff" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — bandBoundaries", () => {
  const VALID_BOUNDARIES = [0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000];

  it("accepts a valid 11-element strictly-increasing boundary array", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: VALID_BOUNDARIES });
    expect(res.status).toBe(200);
    expect(res.body.bandBoundaries).toEqual(VALID_BOUNDARIES);
  });

  it("accepts custom interior values that are still strictly increasing", async () => {
    const custom = [0, 40, 90, 140, 190, 240, 290, 340, 430, 580, 2000];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: custom });
    expect(res.status).toBe(200);
    expect(res.body.bandBoundaries).toEqual(custom);
  });

  it("returns 400 when bandBoundaries has only 10 elements (below min of 11)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: VALID_BOUNDARIES.slice(0, 10) });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when bandBoundaries has 12 elements (above max of 11)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: [...VALID_BOUNDARIES, 3000] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when the first element is not 0", async () => {
    const bad = [1, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: bad });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when the last element is not 2000", async () => {
    const bad = [0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 1999];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: bad });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when interior values are not strictly increasing (duplicate)", async () => {
    const bad = [0, 50, 100, 150, 150, 250, 300, 350, 450, 600, 2000];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: bad });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when interior values are decreasing", async () => {
    const bad = [0, 50, 100, 150, 200, 180, 300, 350, 450, 600, 2000];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: bad });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when an element is above the item max of 2000", async () => {
    const bad = [0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2001];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: bad });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when bandBoundaries is not an array", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ bandBoundaries: "0,50,100" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — zoneOverlaySlots", () => {
  const FOUR_SLOTS = [
    { color: "#f5d58a", visible: true },
    { color: "#c49a6c", visible: true },
    { color: "#8ab4d0", visible: false },
    { color: "#b06060", visible: true },
  ];

  it("accepts a valid saltwater array of 4 slots", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zoneOverlaySlots: { saltwater: FOUR_SLOTS } });
    expect(res.status).toBe(200);
    expect(res.body.zoneOverlaySlots.saltwater).toHaveLength(4);
    expect(res.body.zoneOverlaySlots.saltwater[2]).toMatchObject({ color: "#8ab4d0", visible: false });
  });

  it("accepts a valid freshwater array of 4 slots", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zoneOverlaySlots: { freshwater: FOUR_SLOTS } });
    expect(res.status).toBe(200);
    expect(res.body.zoneOverlaySlots.freshwater).toHaveLength(4);
  });

  it("accepts both saltwater and freshwater together", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zoneOverlaySlots: { saltwater: FOUR_SLOTS, freshwater: FOUR_SLOTS } });
    expect(res.status).toBe(200);
    expect(res.body.zoneOverlaySlots.saltwater).toHaveLength(4);
    expect(res.body.zoneOverlaySlots.freshwater).toHaveLength(4);
  });

  it("returns 400 when saltwater has only 3 slots (below min of 4)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zoneOverlaySlots: { saltwater: FOUR_SLOTS.slice(0, 3) } });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when saltwater has 5 slots (above max of 4)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        zoneOverlaySlots: {
          saltwater: [...FOUR_SLOTS, { color: "#ffffff", visible: true }],
        },
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when freshwater has only 3 slots (below min of 4)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zoneOverlaySlots: { freshwater: FOUR_SLOTS.slice(0, 3) } });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a slot color is not a valid hex colour", async () => {
    const bad = [...FOUR_SLOTS.slice(0, 3), { color: "goldenrod", visible: true }];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zoneOverlaySlots: { saltwater: bad } });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a slot color uses a 3-digit hex shorthand", async () => {
    const bad = [...FOUR_SLOTS.slice(0, 3), { color: "#fff", visible: false }];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zoneOverlaySlots: { saltwater: bad } });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when a slot visible field is not a boolean", async () => {
    const bad = [
      ...FOUR_SLOTS.slice(0, 3),
      { color: "#b06060", visible: "yes" },
    ];
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zoneOverlaySlots: { saltwater: bad } });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when zoneOverlaySlots is an array instead of an object", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ zoneOverlaySlots: FOUR_SLOTS });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — unknown fields round-trip via extras path", () => {
  it("stores and returns a genuinely unrecognised field verbatim", async () => {
    // A field that is not in PutSettingsBody at all must still be stored and
    // returned so that clients sending forward-compatible payloads don't lose
    // data. This exercises the extras path (keys absent from parsed.data).
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ fogDensity: 0.012, xClientExperimentalFeature: "some-value" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("xClientExperimentalFeature", "some-value");
    expect(res.body).toHaveProperty("fogDensity", 0.012);
  });

  it("does not return __updatedAt from an unknown-field payload (server owns it)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ __updatedAt: "2000-01-01T00:00:00.000Z", xClientExperimentalFeature: 42 });
    expect(res.status).toBe(200);
    // __updatedAt must be server-generated, never the client-supplied value.
    expect(res.body.__updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
    // Unknown field should still round-trip.
    expect(res.body).toHaveProperty("xClientExperimentalFeature", 42);
  });
});

describe("PUT /api/settings — hyd93ActiveFeatureCodes (v17)", () => {
  it("accepts a valid hyd93ActiveFeatureCodes array", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hyd93ActiveFeatureCodes: [89, 103] });
    expect(res.status).toBe(200);
    expect(res.body.hyd93ActiveFeatureCodes).toEqual([89, 103]);
  });

  it("accepts the full default set of all five codes", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hyd93ActiveFeatureCodes: [89, 103, 146, 530, 988] });
    expect(res.status).toBe(200);
    expect(res.body.hyd93ActiveFeatureCodes).toEqual([89, 103, 146, 530, 988]);
  });

  it("rejects a non-array value", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hyd93ActiveFeatureCodes: "89,103" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("rejects an array containing non-integer values", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hyd93ActiveFeatureCodes: [89.5, 103] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — hyd93FeaturesEnabled (v17)", () => {
  it("accepts true to show the HYD93 annotation overlay", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hyd93FeaturesEnabled: true });
    expect(res.status).toBe(200);
    expect(res.body.hyd93FeaturesEnabled).toBe(true);
  });

  it("accepts false to hide the HYD93 annotation overlay", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hyd93FeaturesEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body.hyd93FeaturesEnabled).toBe(false);
  });

  it("rejects a non-boolean value", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ hyd93FeaturesEnabled: "yes" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("PUT /api/settings — combined payload with all 17 new fields", () => {
  it("accepts a full valid payload containing all 17 new v15 fields", async () => {
    const payload = {
      weatherStationsActive: true,
      rawsOverlayActive: false,
      windOverlayActive: true,
      tideOverlayActive: false,
      currentOverlayActive: true,
      currentDepthLayers: ["surface", "near-bottom"],
      sidePaneCollapsed: false,
      zonePaintBrushRadius: 8,
      zoneOverlayEnabled: true,
      zonePaintMode: false,
      zonePaintSlot: 2,
      substrateColorMode: true,
      hiddenSubstrateClasses: ["bedrock"],
      intertidalHotspotsEnabled: true,
      intertidalScoreMode: "beachcombing",
      efhOverlayEnabled: true,
      hiddenEfhSpecies: ["Halibut"],
    };

    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send(payload);
    expect(res.status).toBe(200);

    expect(res.body.weatherStationsActive).toBe(true);
    expect(res.body.rawsOverlayActive).toBe(false);
    expect(res.body.windOverlayActive).toBe(true);
    expect(res.body.tideOverlayActive).toBe(false);
    expect(res.body.currentOverlayActive).toBe(true);
    expect(res.body.currentDepthLayers).toEqual(["surface", "near-bottom"]);
    expect(res.body.sidePaneCollapsed).toBe(false);
    expect(res.body.zonePaintBrushRadius).toBe(8);
    expect(res.body.zoneOverlayEnabled).toBe(true);
    expect(res.body.zonePaintMode).toBe(false);
    expect(res.body.zonePaintSlot).toBe(2);
    expect(res.body.substrateColorMode).toBe(true);
    expect(res.body.hiddenSubstrateClasses).toEqual(["bedrock"]);
    expect(res.body.intertidalHotspotsEnabled).toBe(true);
    expect(res.body.intertidalScoreMode).toBe("beachcombing");
    expect(res.body.efhOverlayEnabled).toBe(true);
    expect(res.body.hiddenEfhSpecies).toEqual(["Halibut"]);
  });

  it("accepts all 17 v15 fields alongside the 6 palette/zone-slot fields without any silent reset", async () => {
    const SLOTS = [
      { color: "#f5d58a", visible: true },
      { color: "#c49a6c", visible: false },
      { color: "#8ab4d0", visible: true },
      { color: "#b06060", visible: false },
    ];

    const payload = {
      // 17 original v15 fields
      weatherStationsActive: false,
      rawsOverlayActive: true,
      windOverlayActive: false,
      tideOverlayActive: true,
      currentOverlayActive: false,
      currentDepthLayers: ["mid", "near-bottom"],
      sidePaneCollapsed: true,
      zonePaintBrushRadius: 12,
      zoneOverlayEnabled: false,
      zonePaintMode: true,
      zonePaintSlot: 3,
      substrateColorMode: false,
      hiddenSubstrateClasses: ["bedrock", "sand"],
      intertidalHotspotsEnabled: false,
      intertidalScoreMode: "beachcombing",
      efhOverlayEnabled: false,
      hiddenEfhSpecies: ["Halibut", "Salmon"],
      // 6 palette / zone-slot fields
      paletteShallow: "#1a6b8a",
      paletteDeep: "#0b1f4a",
      customStops: [
        { position: 0.0, hex: "#1a6b8a" },
        { position: 0.4, hex: "#0d47a1" },
        { position: 0.75, hex: "#1a237e" },
        { position: 1.0, hex: "#0b1f4a" },
      ],
      bandColors: [
        "#1a6b8a",
        "#175f7c",
        "#13536e",
        "#0f4760",
        "#0b3b52",
        "#082f44",
        "#062436",
        "#041828",
        "#030c1a",
        "#01000c",
      ],
      bandBoundaries: [0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000],
      zoneOverlaySlots: { saltwater: SLOTS, freshwater: SLOTS },
    };

    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send(payload);
    expect(res.status).toBe(200);

    // 17 v15 fields
    expect(res.body.weatherStationsActive).toBe(false);
    expect(res.body.rawsOverlayActive).toBe(true);
    expect(res.body.windOverlayActive).toBe(false);
    expect(res.body.tideOverlayActive).toBe(true);
    expect(res.body.currentOverlayActive).toBe(false);
    expect(res.body.currentDepthLayers).toEqual(["mid", "near-bottom"]);
    expect(res.body.sidePaneCollapsed).toBe(true);
    expect(res.body.zonePaintBrushRadius).toBe(12);
    expect(res.body.zoneOverlayEnabled).toBe(false);
    expect(res.body.zonePaintMode).toBe(true);
    expect(res.body.zonePaintSlot).toBe(3);
    expect(res.body.substrateColorMode).toBe(false);
    expect(res.body.hiddenSubstrateClasses).toEqual(["bedrock", "sand"]);
    expect(res.body.intertidalHotspotsEnabled).toBe(false);
    expect(res.body.intertidalScoreMode).toBe("beachcombing");
    expect(res.body.efhOverlayEnabled).toBe(false);
    expect(res.body.hiddenEfhSpecies).toEqual(["Halibut", "Salmon"]);

    // 6 palette / zone-slot fields
    expect(res.body.paletteShallow).toBe("#1a6b8a");
    expect(res.body.paletteDeep).toBe("#0b1f4a");
    expect(res.body.customStops).toEqual([
      { position: 0.0, hex: "#1a6b8a" },
      { position: 0.4, hex: "#0d47a1" },
      { position: 0.75, hex: "#1a237e" },
      { position: 1.0, hex: "#0b1f4a" },
    ]);
    expect(res.body.bandColors).toEqual([
      "#1a6b8a",
      "#175f7c",
      "#13536e",
      "#0f4760",
      "#0b3b52",
      "#082f44",
      "#062436",
      "#041828",
      "#030c1a",
      "#01000c",
    ]);
    expect(res.body.bandBoundaries).toEqual([0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000]);
    expect(res.body.zoneOverlaySlots.saltwater).toEqual(SLOTS);
    expect(res.body.zoneOverlaySlots.freshwater).toEqual(SLOTS);
  });
});
