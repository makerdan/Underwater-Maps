/**
 * terrainShader-palette-dominance.test.ts
 *
 * Regression tests for the palette-dominance color combination in the
 * terrain fragment shader (terrainShader.ts).
 *
 * Background: the shader previously computed
 *   finalColor = texColor * vColor * 1.6
 * then multiplied by Blinn-Phong lighting (ambient 0.30 + diffuse + lamp).
 * The four substrate textures are dark (~0.2-0.4 luminance), so the multiply
 * chain crushed every palette into dark khaki/green — switching palettes was
 * barely visible on the terrain.
 *
 * New combination (mirrored here in TypeScript, since full GLSL execution is
 * not feasible in a Node unit test):
 *   float texLum  = dot(texColor, vec3(0.299, 0.587, 0.114));
 *   float detail  = clamp(0.85 + (texLum - 0.35) * 0.9, 0.7, 1.15);
 *   vec3 finalColor = vColor * detail;
 *   float lighting  = min(0.55 + diffuse*0.45 + lampDiff, 1.2);
 *   finalColor *= lighting;
 *
 * The palette color is the base hue; texture only modulates luminance in a
 * narrow band around 1.0, and the ambient floor is high enough that hue and
 * channel ratios are always preserved (detail and lighting are scalars).
 *
 * A source-guard section additionally asserts the shader source still uses
 * the luminance-detail formulation and has not regressed to a raw
 * texColor * vColor multiply.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Vec3 = [number, number, number];

const AMBIENT = 0.55;
const DIFFUSE_SCALE = 0.45;
const LIGHTING_CAP = 1.2;

function texLuminance(tex: Vec3): number {
  return tex[0] * 0.299 + tex[1] * 0.587 + tex[2] * 0.114;
}

function detailFactor(tex: Vec3): number {
  const d = 0.85 + (texLuminance(tex) - 0.35) * 0.9;
  return Math.max(0.7, Math.min(1.15, d));
}

/** New shader base color + lighting (TS mirror of the GLSL). */
function shadeNew(palette: Vec3, tex: Vec3, diffuse = 0, lampDiff = 0): Vec3 {
  const detail = detailFactor(tex);
  const lighting = Math.min(
    AMBIENT + diffuse * DIFFUSE_SCALE + lampDiff,
    LIGHTING_CAP,
  );
  return palette.map((c) => c * detail * lighting) as Vec3;
}

/** Old (regression) formula for comparison: texColor * vColor * 1.6 * light. */
function shadeOld(palette: Vec3, tex: Vec3, diffuse = 0, lampDiff = 0): Vec3 {
  const lighting = 0.3 + diffuse * 0.65 + lampDiff;
  return palette.map((c, i) => c * tex[i] * 1.6 * lighting) as Vec3;
}

function luminance(c: Vec3): number {
  return texLuminance(c);
}

// Representative dark substrate texel (sand/silt textures are dark khaki).
const DARK_TEX: Vec3 = [0.32, 0.3, 0.22];
// Contrasting palette colors: viridis mid-green vs thermal orange.
const VIRIDIS_GREEN: Vec3 = [0.13, 0.57, 0.55];
const THERMAL_ORANGE: Vec3 = [0.94, 0.49, 0.08];

describe("terrainShader — palette dominance (TS mirror of GLSL)", () => {
  it("palette hue is preserved exactly: channel ratios of output equal palette's", () => {
    for (const palette of [VIRIDIS_GREEN, THERMAL_ORANGE]) {
      const out = shadeNew(palette, DARK_TEX, 0.5, 0.1);
      // detail and lighting are scalars, so out = k * palette for some k > 0
      const k = out[0] / palette[0];
      expect(out[1] / palette[1]).toBeCloseTo(k, 6);
      expect(out[2] / palette[2]).toBeCloseTo(k, 6);
      expect(k).toBeGreaterThan(0);
    }
  });

  it("contrasting palettes remain clearly distinct over dark textures", () => {
    const a = shadeNew(VIRIDIS_GREEN, DARK_TEX);
    const b = shadeNew(THERMAL_ORANGE, DARK_TEX);
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(dist).toBeGreaterThan(0.3);
  });

  it("ambient-only output retains at least ~35% of palette brightness (no crush)", () => {
    const out = shadeNew(VIRIDIS_GREEN, DARK_TEX);
    expect(luminance(out) / luminance(VIRIDIS_GREEN)).toBeGreaterThan(0.35);
  });

  it("is dramatically brighter than the old multiply chain on dark textures", () => {
    const neu = shadeNew(VIRIDIS_GREEN, DARK_TEX);
    const old = shadeOld(VIRIDIS_GREEN, DARK_TEX);
    expect(luminance(neu)).toBeGreaterThan(luminance(old) * 2);
  });

  it("texture detail modulation stays within the gentle [0.7, 1.15] band", () => {
    expect(detailFactor([0, 0, 0])).toBeCloseTo(0.7, 6); // clamp low
    expect(detailFactor([1, 1, 1])).toBeCloseTo(1.15, 6); // clamp high
    expect(detailFactor([0.35, 0.35, 0.35])).toBeCloseTo(0.85, 6); // mid-lum
    // Detail spread across the whole texture range is small vs palette spread
    expect(detailFactor([1, 1, 1]) / detailFactor([0, 0, 0])).toBeLessThan(1.7);
  });

  it("lighting is capped so sun+lamp cannot wash the hue toward white", () => {
    const out = shadeNew([1, 1, 1], [1, 1, 1], 1.0, 1.0);
    // lighting capped at 1.2, detail capped at 1.15
    expect(Math.max(...out)).toBeLessThanOrEqual(1.2 * 1.15 + 1e-9);
  });
});

describe("terrainShader source guard — no regression to multiplicative texture color", () => {
  const src = readFileSync(
    join(__dirname, "..", "lib", "terrainShader.ts"),
    "utf8",
  );

  it("uses texture luminance detail modulation", () => {
    expect(src).toContain("dot(texColor, vec3(0.299, 0.587, 0.114))");
    expect(src).toContain("clamp(0.85 + (texLum - 0.35) * 0.9, 0.7, 1.15)");
    expect(src).toContain("vec3 finalColor = vColor * detail;");
  });

  it("does not multiply palette color by raw texel RGB", () => {
    expect(src).not.toMatch(/finalColor\s*=\s*texColor\s*\*\s*vColor/);
  });

  it("keeps the high ambient floor and lighting cap", () => {
    expect(src).toContain("float ambient = 0.55;");
    expect(src).toContain("min(ambient + diffuse + lampDiff, 1.2)");
  });
});
