/**
 * Unit tests for deriveEffectiveFogColor — the pure helper that controls
 * whether freshwater mode overrides the user's fog colour.
 *
 * Bug: the original code always used "#0b3a35" (green-teal) in freshwater
 * mode, ignoring any custom fog colour the user had set. The fix checks
 * whether fogColor still matches the factory default before overriding.
 */
import { describe, it, expect } from "vitest";
import { deriveEffectiveFogColor } from "@/pages/TourScene";

const DEFAULT_FOG = "#020818"; // matches DEFAULT_SETTINGS.fogColor in settingsStore
const FRESHWATER_FOG = "#0b3a35"; // applied when fresh + no custom colour

describe("deriveEffectiveFogColor", () => {
  describe("saltwater mode", () => {
    it("returns the user fog color unchanged", () => {
      expect(deriveEffectiveFogColor(false, DEFAULT_FOG, DEFAULT_FOG)).toBe(DEFAULT_FOG);
    });

    it("returns a custom fog color unchanged", () => {
      expect(deriveEffectiveFogColor(false, "#ff0000", DEFAULT_FOG)).toBe("#ff0000");
    });
  });

  describe("freshwater mode — default fog colour", () => {
    it("returns the freshwater green-teal hue when fogColor is the factory default", () => {
      const result = deriveEffectiveFogColor(true, DEFAULT_FOG, DEFAULT_FOG);
      expect(result).toBe(FRESHWATER_FOG);
    });
  });

  describe("freshwater mode — user-customised fog colour", () => {
    it("returns the user custom color and does NOT override with green-teal", () => {
      const customColor = "#1a3a5c";
      const result = deriveEffectiveFogColor(true, customColor, DEFAULT_FOG);
      expect(result).toBe(customColor);
      expect(result).not.toBe(FRESHWATER_FOG);
    });

    it("returns any custom color (red) even in freshwater mode", () => {
      const result = deriveEffectiveFogColor(true, "#ff0000", DEFAULT_FOG);
      expect(result).toBe("#ff0000");
    });
  });
});
