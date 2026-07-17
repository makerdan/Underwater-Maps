import { describe, it, expect } from "vitest";
import {
  toValidJoystickMode,
  toValidColormapTheme,
  toValidWaterType,
  toValidDefaultSpeedTier,
} from "@/lib/settingsGuards";

// ─── toValidJoystickMode ─────────────────────────────────────────────────────

describe("toValidJoystickMode", () => {
  it.each(["auto", "always", "off"] as const)(
    'accepts valid value "%s" unchanged',
    (v) => {
      expect(toValidJoystickMode(v)).toBe(v);
    },
  );

  it('returns "auto" for an unknown string', () => {
    expect(toValidJoystickMode("gamepad")).toBe("auto");
  });

  it('returns "auto" for an empty string', () => {
    expect(toValidJoystickMode("")).toBe("auto");
  });

  it('returns "auto" for null', () => {
    expect(toValidJoystickMode(null)).toBe("auto");
  });

  it('returns "auto" for undefined', () => {
    expect(toValidJoystickMode(undefined)).toBe("auto");
  });

  it('returns "auto" for a number', () => {
    expect(toValidJoystickMode(1)).toBe("auto");
  });

  it('returns "auto" for a boolean', () => {
    expect(toValidJoystickMode(true)).toBe("auto");
  });
});

// ─── toValidColormapTheme ────────────────────────────────────────────────────

describe("toValidColormapTheme", () => {
  it.each(["ocean", "thermal", "grayscale", "viridis", "freshwater", "custom"] as const)(
    'accepts valid value "%s" unchanged',
    (v) => {
      expect(toValidColormapTheme(v)).toBe(v);
    },
  );

  it('returns "ocean" for an unknown string', () => {
    expect(toValidColormapTheme("rainbow")).toBe("ocean");
  });

  it('returns "ocean" for an empty string', () => {
    expect(toValidColormapTheme("")).toBe("ocean");
  });

  it('returns "ocean" for null', () => {
    expect(toValidColormapTheme(null)).toBe("ocean");
  });

  it('returns "ocean" for undefined', () => {
    expect(toValidColormapTheme(undefined)).toBe("ocean");
  });

  it('returns "ocean" for a number', () => {
    expect(toValidColormapTheme(42)).toBe("ocean");
  });

  it('returns "ocean" for an object', () => {
    expect(toValidColormapTheme({ theme: "ocean" })).toBe("ocean");
  });
});

// ─── toValidWaterType ────────────────────────────────────────────────────────

describe("toValidWaterType", () => {
  it.each(["saltwater", "freshwater"] as const)(
    'accepts valid value "%s" unchanged',
    (v) => {
      expect(toValidWaterType(v)).toBe(v);
    },
  );

  it('returns "saltwater" for an unknown string', () => {
    expect(toValidWaterType("brackish")).toBe("saltwater");
  });

  it('returns "saltwater" for an empty string', () => {
    expect(toValidWaterType("")).toBe("saltwater");
  });

  it('returns "saltwater" for null', () => {
    expect(toValidWaterType(null)).toBe("saltwater");
  });

  it('returns "saltwater" for undefined', () => {
    expect(toValidWaterType(undefined)).toBe("saltwater");
  });

  it('returns "saltwater" for a boolean', () => {
    expect(toValidWaterType(false)).toBe("saltwater");
  });
});

// ─── toValidDefaultSpeedTier ─────────────────────────────────────────────────

describe("toValidDefaultSpeedTier", () => {
  it.each([0, 1, 2, 3, 4])(
    "accepts valid integer %d unchanged",
    (v) => {
      expect(toValidDefaultSpeedTier(v)).toBe(v);
    },
  );

  it("returns 2 for a value below the minimum (−1)", () => {
    expect(toValidDefaultSpeedTier(-1)).toBe(2);
  });

  it("returns 2 for a value above the maximum (5)", () => {
    expect(toValidDefaultSpeedTier(5)).toBe(2);
  });

  it("returns 2 for a non-integer number (1.5)", () => {
    expect(toValidDefaultSpeedTier(1.5)).toBe(2);
  });

  it("returns 2 for NaN", () => {
    expect(toValidDefaultSpeedTier(NaN)).toBe(2);
  });

  it("returns 2 for Infinity", () => {
    expect(toValidDefaultSpeedTier(Infinity)).toBe(2);
  });

  it('returns 2 for a numeric string ("2")', () => {
    expect(toValidDefaultSpeedTier("2")).toBe(2);
  });

  it("returns 2 for null", () => {
    expect(toValidDefaultSpeedTier(null)).toBe(2);
  });

  it("returns 2 for undefined", () => {
    expect(toValidDefaultSpeedTier(undefined)).toBe(2);
  });

  it("returns 2 for an object", () => {
    expect(toValidDefaultSpeedTier({ tier: 2 })).toBe(2);
  });
});
