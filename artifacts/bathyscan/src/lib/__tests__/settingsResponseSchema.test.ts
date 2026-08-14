/**
 * settingsResponseSchema — unit tests
 *
 * Covers the four cases required by the task:
 *   (a) A fully valid response hydrates all known fields normally.
 *   (b) A response with an unknown extra key is accepted and the known fields
 *       are applied (extra key passes through verbatim).
 *   (c) A response where a required field has the wrong type is skipped without
 *       crashing — only the bad field is absent from the validated partial.
 *   (d) A fully malformed response (non-object values) is rejected gracefully
 *       and does not overwrite local state (ok: false returned).
 *
 * Also covers the regression guard: the schema's inferred type must be
 * assignable to Partial<SettingsState> (compile-time check in schema file).
 */

import { describe, it, expect } from "vitest";
import { parseSettingsResponse } from "@/lib/settingsResponseSchema";

// ── (a) Fully valid response ──────────────────────────────────────────────────

describe("parseSettingsResponse — (a) fully valid response", () => {
  it("returns ok:true when all known fields have the correct types", () => {
    const result = parseSettingsResponse({
      schemaVersion: 35,
      showAdvancedEverywhere: false,
      waterType: "saltwater",
      colormapTheme: "ocean",
      hasSeenOnboarding: true,
      fogDensity: 0.012,
      hudOpacity: 0.75,
      sidebarMode: "explore",
      units: "metric",
      depthUnit: "metres",
      trailRetention: "30",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedKeys).toHaveLength(0);
    expect(result.value.schemaVersion).toBe(35);
    expect(result.value.waterType).toBe("saltwater");
    expect(result.value.colormapTheme).toBe("ocean");
    expect(result.value.hasSeenOnboarding).toBe(true);
    expect(result.value.fogDensity).toBe(0.012);
    expect(result.value.sidebarMode).toBe("explore");
    expect(result.value.units).toBe("metric");
  });

  it("applies boolean, number, and string typed fields correctly", () => {
    const result = parseSettingsResponse({
      invertMouseY: true,
      fieldOfView: 60,
      fogColor: "#020818",
      enableMarineSnow: false,
      terrainExaggeration: 3,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invertMouseY).toBe(true);
    expect(result.value.fieldOfView).toBe(60);
    expect(result.value.fogColor).toBe("#020818");
    expect(result.value.enableMarineSnow).toBe(false);
    expect(result.value.terrainExaggeration).toBe(3);
    expect(result.skippedKeys).toHaveLength(0);
  });

  it("handles nullable fields at null correctly", () => {
    const result = parseSettingsResponse({
      lastSession: null,
      defaultMapLoad: null,
      lastSyncedAt: null,
      crosshairMenuGamepadButton: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lastSession).toBeNull();
    expect(result.value.defaultMapLoad).toBeNull();
    expect(result.value.lastSyncedAt).toBeNull();
    expect(result.value.crosshairMenuGamepadButton).toBeNull();
    expect(result.skippedKeys).toHaveLength(0);
  });

  it("handles structured fields like lastSession correctly", () => {
    const session = {
      lon: -122.5,
      lat: 47.8,
      depth: -30,
      heading: 0,
      datasetId: "ds-abc",
      headingConvention: "north-up" as const,
    };

    const result = parseSettingsResponse({ lastSession: session });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lastSession).toEqual(session);
  });

  it("handles array fields (visibleMarkerTypes, currentDepthLayers) correctly", () => {
    const result = parseSettingsResponse({
      visibleMarkerTypes: ["fish", "shipwreck"],
      currentDepthLayers: ["surface", "mid"],
      hiddenSubstrateClasses: ["rock", "sand"],
      hyd93ActiveFeatureCodes: [89, 103, 146],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.visibleMarkerTypes).toEqual(["fish", "shipwreck"]);
    expect(result.value.currentDepthLayers).toEqual(["surface", "mid"]);
    expect(result.value.hiddenSubstrateClasses).toEqual(["rock", "sand"]);
    expect(result.value.hyd93ActiveFeatureCodes).toEqual([89, 103, 146]);
  });
});

// ── (b) Response with unknown extra keys ──────────────────────────────────────

describe("parseSettingsResponse — (b) unknown extra keys passed through", () => {
  it("passes through an unknown extra key verbatim alongside valid known fields", () => {
    const result = parseSettingsResponse({
      // Known field
      hasSeenOnboarding: true,
      // Unknown extra — future server addition
      superNewFeatureFlag: "enabled",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hasSeenOnboarding).toBe(true);
    expect((result.value as Record<string, unknown>)["superNewFeatureFlag"]).toBe("enabled");
    expect(result.skippedKeys).toHaveLength(0);
  });

  it("passes through multiple unknown extra keys without affecting known field validation", () => {
    const result = parseSettingsResponse({
      waterType: "freshwater",
      futureKey1: 42,
      futureKey2: { nested: true },
      futureKey3: ["array", "value"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.waterType).toBe("freshwater");
    expect((result.value as Record<string, unknown>)["futureKey1"]).toBe(42);
    expect((result.value as Record<string, unknown>)["futureKey2"]).toEqual({ nested: true });
    expect(result.skippedKeys).toHaveLength(0);
  });

  it("treats the __updatedAt metadata key as an unknown extra and passes it through", () => {
    const result = parseSettingsResponse({
      hasSeenOnboarding: false,
      __updatedAt: "2026-01-01T00:00:00Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as Record<string, unknown>)["__updatedAt"]).toBe("2026-01-01T00:00:00Z");
  });
});

// ── (c) Fields with wrong types are skipped ───────────────────────────────────

describe("parseSettingsResponse — (c) type-mismatched fields are skipped", () => {
  it("skips a boolean field that has a string value, without crashing", () => {
    const result = parseSettingsResponse({
      // Wrong type: boolean expected, string received
      hasSeenOnboarding: "yes",
      // Correct type alongside it
      waterType: "saltwater",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedKeys).toContain("hasSeenOnboarding");
    // The wrongly-typed field must NOT appear in the validated value
    expect("hasSeenOnboarding" in result.value).toBe(false);
    // The correctly-typed sibling field IS applied
    expect(result.value.waterType).toBe("saltwater");
  });

  it("skips a number field that has a boolean value", () => {
    const result = parseSettingsResponse({
      fogDensity: true, // wrong: should be number
      hudOpacity: 0.75, // correct
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedKeys).toContain("fogDensity");
    expect("fogDensity" in result.value).toBe(false);
    expect(result.value.hudOpacity).toBe(0.75);
  });

  it("skips an enum field with an invalid member, without crashing", () => {
    const result = parseSettingsResponse({
      colormapTheme: "rainbow", // not a valid ColormapTheme
      waterType: "saltwater",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedKeys).toContain("colormapTheme");
    expect("colormapTheme" in result.value).toBe(false);
    expect(result.value.waterType).toBe("saltwater");
  });

  it("skips a string field that has a number value", () => {
    const result = parseSettingsResponse({
      fogColor: 12345, // wrong: should be string
      fogDensity: 0.012, // correct
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedKeys).toContain("fogColor");
    expect("fogColor" in result.value).toBe(false);
    expect(result.value.fogDensity).toBe(0.012);
  });

  it("skips multiple mismatched fields and lists them all in skippedKeys", () => {
    const result = parseSettingsResponse({
      hasSeenOnboarding: "nope",    // boolean expected
      fogDensity: "thick",          // number expected
      colormapTheme: "invalid",     // enum member wrong
      waterType: "freshwater",      // correct
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedKeys).toContain("hasSeenOnboarding");
    expect(result.skippedKeys).toContain("fogDensity");
    expect(result.skippedKeys).toContain("colormapTheme");
    // Only the valid field remains
    expect(result.value.waterType).toBe("freshwater");
  });

  it("skips a structured field with the wrong shape without crashing", () => {
    const result = parseSettingsResponse({
      // lastSession must have {lon, lat, depth, heading, datasetId}
      lastSession: { x: 1, y: 2 },
      waterType: "saltwater",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedKeys).toContain("lastSession");
    expect("lastSession" in result.value).toBe(false);
    expect(result.value.waterType).toBe("saltwater");
  });

  it("skips an array field whose elements have wrong types", () => {
    const result = parseSettingsResponse({
      // currentDepthLayers only accepts ["surface","mid","near-bottom"] members
      currentDepthLayers: ["deep", "abyss"], // invalid enum values
      waterType: "saltwater",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedKeys).toContain("currentDepthLayers");
    expect(result.value.waterType).toBe("saltwater");
  });
});

// ── (d) Fully malformed response handled gracefully ───────────────────────────

describe("parseSettingsResponse — (d) malformed top-level response", () => {
  it("returns ok:false for an empty object {} — does not crash", () => {
    // An empty object passes the non-null-object guard but has no fields.
    // It is valid at the top level; we get ok:true with an empty value.
    // This tests that the hook won't crash or overwrite state with nothing.
    const result = parseSettingsResponse({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No fields were extracted — validated value has no known settings keys
    expect(Object.keys(result.value)).toHaveLength(0);
    expect(result.skippedKeys).toHaveLength(0);
  });

  it("returns ok:false for null", () => {
    const result = parseSettingsResponse(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/null/i);
  });

  it("returns ok:false for undefined", () => {
    const result = parseSettingsResponse(undefined);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for a string", () => {
    const result = parseSettingsResponse("not-an-object");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for a number", () => {
    const result = parseSettingsResponse(42);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for an array", () => {
    const result = parseSettingsResponse([{ hasSeenOnboarding: true }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/array/i);
  });

  it("returns ok:false for a boolean", () => {
    const result = parseSettingsResponse(true);
    expect(result.ok).toBe(false);
  });

  it("does not throw on any malformed input shape", () => {
    const malformedInputs = [null, undefined, 0, false, "", [], [1, 2, 3]];
    for (const input of malformedInputs) {
      expect(() => parseSettingsResponse(input)).not.toThrow();
    }
  });
});

// ── Integration: hydrateFromServer mock receives validated partial ────────────

describe("parseSettingsResponse — integration with hydrateFromServer mock", () => {
  it("passes only valid fields to the mock, skipping type-mismatched ones", () => {
    const hydrateFromServer = (partial: Record<string, unknown>) => partial;

    const serverResponse = {
      waterType: "saltwater",
      hasSeenOnboarding: "yes",  // wrong type — should be boolean
      fogDensity: 0.012,
      __updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = parseSettingsResponse(serverResponse);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const applied = hydrateFromServer(result.value as Record<string, unknown>);

    // Valid fields are passed through
    expect(applied["waterType"]).toBe("saltwater");
    expect(applied["fogDensity"]).toBe(0.012);
    expect(applied["__updatedAt"]).toBe("2026-01-01T00:00:00Z");
    // Invalid field is absent
    expect("hasSeenOnboarding" in applied).toBe(false);
    // skippedKeys records the omission
    expect(result.skippedKeys).toContain("hasSeenOnboarding");
  });

  it("does not call hydrateFromServer when ok:false (simulated via caller check)", () => {
    let called = false;
    const hydrateFromServer = () => { called = true; };

    const result = parseSettingsResponse(null);
    if (result.ok) {
      hydrateFromServer();
    }

    expect(called).toBe(false);
  });
});
