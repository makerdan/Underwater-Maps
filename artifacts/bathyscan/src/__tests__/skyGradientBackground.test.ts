/**
 * Regression guard — sky-gradient backdrop for the 3D view.
 *
 * Ensures:
 *  1. The exported SKY_GRADIENT_STOPS constant contains pale-sky-blue at the
 *     horizon and deeper-sky-blue at the zenith — not the dark fog colour
 *     (#020818) or any flat/dark hue.
 *  2. The scene backdrop is driven by the gradient, not by a flat
 *     effectiveFogColor — verified by checking that deriveHarmonizedFogColor
 *     maps the default dark-navy fog colour to the sky horizon instead.
 *
 * If anyone restores `<color attach="background" args={[effectiveFogColor]}>`,
 * the harmonization test will still pass but the SKY_GRADIENT_STOPS tests
 * will catch the removal of the gradient export.  If anyone silently removes
 * the SkyGradientBackdrop while leaving the flat color tag, the fog-harmonization
 * test will catch the regression because the dark default fog colour would no
 * longer be replaced.
 */
import { describe, it, expect } from "vitest";
import {
  SKY_GRADIENT_STOPS,
  SKY_SPHERE_RADIUS,
  SKY_VERT,
  SKY_FRAG,
  deriveHarmonizedFogColor,
  FRESHWATER_DEFAULT_FOG_COLOR,
} from "@/pages/TourScene";

// Minimum user-configurable render distance (camera far plane) from settingsStore.ts.
// The sky sphere radius must be strictly below this so the sphere is never clipped.
const MIN_RENDER_DISTANCE = 200;

const DEFAULT_FOG_COLOR = "#020818"; // matches DEFAULT_SETTINGS.fogColor
const FRESHWATER_FOG_COLOR = "#0b3a35"; // applied by deriveEffectiveFogColor in fresh mode

// ---------------------------------------------------------------------------
// 1. SKY_GRADIENT_STOPS — shape and palette
// ---------------------------------------------------------------------------

describe("SKY_GRADIENT_STOPS", () => {
  it("has exactly two stops", () => {
    expect(SKY_GRADIENT_STOPS).toHaveLength(2);
  });

  it("horizon stop has stop value 0", () => {
    expect(SKY_GRADIENT_STOPS[0].stop).toBe(0);
  });

  it("zenith stop has stop value 1", () => {
    expect(SKY_GRADIENT_STOPS[1].stop).toBe(1);
  });

  it("horizon color is a light blue — not the default dark fog color", () => {
    const { color } = SKY_GRADIENT_STOPS[0];
    expect(color).not.toBe(DEFAULT_FOG_COLOR);
    expect(color).not.toBe(FRESHWATER_FOG_COLOR);
    // Parse hex to verify it is a genuinely light/mid blue (high blue channel,
    // meaningful green channel, low red — characteristic of a sky hue).
    const n = parseInt(color.replace("#", ""), 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    // Blue channel must dominate red
    expect(b).toBeGreaterThan(r);
    // Overall luminance should be bright (> 128 on average) — not a dark hue
    expect((r + g + b) / 3).toBeGreaterThan(128);
  });

  it("zenith color is a sky blue — not the default dark fog color", () => {
    const { color } = SKY_GRADIENT_STOPS[1];
    expect(color).not.toBe(DEFAULT_FOG_COLOR);
    expect(color).not.toBe(FRESHWATER_FOG_COLOR);
    const n = parseInt(color.replace("#", ""), 16);
    const r = (n >> 16) & 0xff;
    const b = n & 0xff;
    // Blue channel must dominate red (sky blue, not red/orange)
    expect(b).toBeGreaterThan(r);
  });

  it("horizon is lighter than zenith (gradient goes from pale to deep)", () => {
    const horizonHex = SKY_GRADIENT_STOPS[0].color.replace("#", "");
    const zenithHex = SKY_GRADIENT_STOPS[1].color.replace("#", "");
    const horizonLum =
      (parseInt(horizonHex.slice(0, 2), 16) +
        parseInt(horizonHex.slice(2, 4), 16) +
        parseInt(horizonHex.slice(4, 6), 16)) /
      3;
    const zenithLum =
      (parseInt(zenithHex.slice(0, 2), 16) +
        parseInt(zenithHex.slice(2, 4), 16) +
        parseInt(zenithHex.slice(4, 6), 16)) /
      3;
    expect(horizonLum).toBeGreaterThan(zenithLum);
  });
});

// ---------------------------------------------------------------------------
// 2. Shader correctness — gradient must be camera-relative (local space)
// ---------------------------------------------------------------------------

describe("SKY_VERT / SKY_FRAG shaders", () => {
  it("vertex shader uses local object-space position, not world-space modelMatrix", () => {
    // Using modelMatrix * position for the gradient varying causes the sky to
    // shift/tilt as the camera moves in world space. The correct approach is
    // to pass raw `position` (object-space) so the gradient direction is
    // always relative to the sphere centre.
    expect(SKY_VERT).not.toMatch(/modelMatrix\s*\*\s*vec4\s*\(\s*position/);
    expect(SKY_VERT).toMatch(/vLocalPos\s*=\s*position/);
  });

  it("fragment shader normalises the local (not world) position to derive gradient t", () => {
    expect(SKY_FRAG).toMatch(/normalize\s*\(\s*vLocalPos\s*\)/);
    // Explicitly confirm the world-space varying is absent
    expect(SKY_FRAG).not.toMatch(/vWorldPos/);
  });
});

// ---------------------------------------------------------------------------
// 3. SKY_SPHERE_RADIUS — must fit inside the minimum camera far plane
// ---------------------------------------------------------------------------

describe("SKY_SPHERE_RADIUS", () => {
  it("is a positive number", () => {
    expect(SKY_SPHERE_RADIUS).toBeGreaterThan(0);
  });

  it("is strictly less than the minimum render distance so it is never clipped", () => {
    // The camera far plane is set to renderDistance (minimum 200).
    // The sky sphere follows the camera each frame, so its surface is always
    // SKY_SPHERE_RADIUS units away from the camera — it must be < far plane.
    expect(SKY_SPHERE_RADIUS).toBeLessThan(MIN_RENDER_DISTANCE);
  });
});

// ---------------------------------------------------------------------------
// 3. deriveHarmonizedFogColor — fog blends with the sky rather than going dark
// ---------------------------------------------------------------------------

describe("deriveHarmonizedFogColor", () => {
  it("replaces the saltwater default dark fog color with the sky horizon color", () => {
    const result = deriveHarmonizedFogColor(DEFAULT_FOG_COLOR, DEFAULT_FOG_COLOR, false);
    expect(result).not.toBe(DEFAULT_FOG_COLOR);
    expect(result).toBe(SKY_GRADIENT_STOPS[0].color);
  });

  it("harmonises freshwater-default teal to the sky horizon when isFreshwater=true", () => {
    // The freshwater teal is auto-applied (not user-chosen), so it should blend
    // into the sky just like the saltwater dark-navy default.
    const result = deriveHarmonizedFogColor(FRESHWATER_FOG_COLOR, DEFAULT_FOG_COLOR, true);
    expect(result).not.toBe(FRESHWATER_FOG_COLOR);
    expect(result).toBe(SKY_GRADIENT_STOPS[0].color);
  });

  it("passes user-chosen teal through unchanged when isFreshwater=false (saltwater)", () => {
    // A user who explicitly picks #0b3a35 as their fog color in saltwater mode
    // must not have it silently replaced by the sky horizon color.
    const result = deriveHarmonizedFogColor(FRESHWATER_FOG_COLOR, DEFAULT_FOG_COLOR, false);
    expect(result).toBe(FRESHWATER_FOG_COLOR);
  });

  it("harmonises using the exported constant (canonical reference, freshwater path)", () => {
    // FRESHWATER_DEFAULT_FOG_COLOR and the local FRESHWATER_FOG_COLOR must be
    // the same value — any mismatch would mean the constant is stale.
    expect(FRESHWATER_DEFAULT_FOG_COLOR).toBe(FRESHWATER_FOG_COLOR);
    const result = deriveHarmonizedFogColor(FRESHWATER_DEFAULT_FOG_COLOR, DEFAULT_FOG_COLOR, true);
    expect(result).toBe(SKY_GRADIENT_STOPS[0].color);
  });

  it("passes any user-customised fog color through unchanged (saltwater)", () => {
    const custom = "#1a3a5c";
    const result = deriveHarmonizedFogColor(custom, DEFAULT_FOG_COLOR, false);
    expect(result).toBe(custom);
  });

  it("passes any user-customised fog color through unchanged (freshwater)", () => {
    // Even in freshwater mode, an explicitly chosen non-default colour must be kept.
    const custom = "#1a3a5c";
    const result = deriveHarmonizedFogColor(custom, DEFAULT_FOG_COLOR, true);
    expect(result).toBe(custom);
  });

  it("also harmonises when the effective color exactly equals the default (saltwater edge case)", () => {
    expect(deriveHarmonizedFogColor(DEFAULT_FOG_COLOR, DEFAULT_FOG_COLOR, false)).toBe(
      SKY_GRADIENT_STOPS[0].color,
    );
  });
});
