/**
 * me.test.ts — integration tests for PUT /api/settings validating the 17
 * new viewscreen settings fields added in settingsStore v15.
 *
 * Covers:
 *   • 401 when unauthenticated
 *   • 200 with valid payloads for all 17 new fields
 *   • 400 when each field receives an out-of-range or wrong-type value
 */

import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => {
  const stored: Record<string, unknown> = {};

  const selectWhereMock = vi.fn().mockResolvedValue([]);
  const fromMock = vi.fn().mockReturnValue({ where: selectWhereMock });

  const onConflictDoUpdateMock = vi.fn().mockResolvedValue([]);
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });

  return {
    db: {
      select: vi.fn().mockReturnValue({ from: fromMock }),
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
    },
    userSettingsTable: { userId: "userId", settings: "settings" },
    _stored: stored,
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
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
});
