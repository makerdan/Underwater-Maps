/**
 * Simulated-terrain rainbow treatment — regression guards.
 *
 * Covers:
 *  1. isSyntheticGrid — the single predicate that decides whether the rainbow
 *     treatment activates. Must be true only for synthetic data sources.
 *  2. terrainShader — the uSynthetic/uTime uniforms exist, default OFF, and
 *     the fragment shader gates the rainbow on uSynthetic so real data is
 *     never affected.
 *  3. renderSyntheticHatch — the Overview Map hatch draws over a synthetic
 *     bbox and is a no-op for degenerate (zero-area) rects.
 */
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { isSyntheticGrid } from "../lib/terrain";
import { createTerrainShaderMaterial } from "../lib/terrainShader";
import type { TerrainTextures } from "../lib/textures";
import {
  renderSyntheticHatch,
  SYNTHETIC_HATCH_COLORS,
  type OverviewTransform,
} from "../lib/overviewRenderer";

// ---------------------------------------------------------------------------
// 1. isSyntheticGrid
// ---------------------------------------------------------------------------

describe("isSyntheticGrid", () => {
  it("returns true when grid.synthetic is true", () => {
    expect(isSyntheticGrid({ synthetic: true })).toBe(true);
  });

  it("returns true when dataSource is 'synthetic'", () => {
    expect(
      isSyntheticGrid({ dataSource: "synthetic" as TerrainData["dataSource"] }),
    ).toBe(true);
  });

  it("returns false for real data sources", () => {
    expect(isSyntheticGrid({})).toBe(false);
    expect(isSyntheticGrid({ synthetic: false })).toBe(false);
    expect(
      isSyntheticGrid({
        synthetic: false,
        dataSource: "ncei" as TerrainData["dataSource"],
      }),
    ).toBe(false);
    expect(
      isSyntheticGrid({ dataSource: "gebco" as TerrainData["dataSource"] }),
    ).toBe(false);
  });

  it("returns false for 'unknown' dataSource (badge/dialog handle that case)", () => {
    expect(
      isSyntheticGrid({ dataSource: "unknown" as TerrainData["dataSource"] }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Shader material — synthetic uniforms + gated rainbow path
// ---------------------------------------------------------------------------

function makeFakeTextures(): TerrainTextures {
  const tex = () => new THREE.Texture() as unknown as THREE.CanvasTexture;
  return {
    colorTextures: [tex(), tex(), tex(), tex()],
    normalMaps: [tex(), tex(), tex(), tex()],
  } as TerrainTextures;
}

describe("terrainShader synthetic uniforms", () => {
  it("defaults uSynthetic to 0 (rainbow OFF for real data)", () => {
    const mat = createTerrainShaderMaterial(makeFakeTextures(), 10);
    expect(mat.uniforms["uSynthetic"]!.value).toBe(0);
    expect(mat.uniforms["uTime"]!.value).toBe(0);
    mat.dispose();
  });

  it("fragment shader gates the rainbow on uSynthetic > 0.5", () => {
    const mat = createTerrainShaderMaterial(makeFakeTextures(), 10);
    expect(mat.fragmentShader).toContain("uniform float uSynthetic");
    expect(mat.fragmentShader).toContain("uniform float uTime");
    expect(mat.fragmentShader).toMatch(/if\s*\(\s*uSynthetic\s*>\s*0\.5\s*\)/);
    mat.dispose();
  });
});

// ---------------------------------------------------------------------------
// 3. Overview Map hatch
// ---------------------------------------------------------------------------

function makeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 80 })),
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: "",
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

const worldGrid = {
  minLon: -134,
  maxLon: -132,
  minLat: 55,
  maxLat: 56.5,
  minDepth: 0,
  maxDepth: 100,
  depths: [],
  width: 2,
  height: 2,
  datasetId: "w",
} as unknown as TerrainData;

const transform: OverviewTransform = {
  pxPerDeg: 100,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

describe("renderSyntheticHatch", () => {
  it("draws rainbow stripes, a warning border, and a caption over the bbox", () => {
    const ctx = makeCtx();
    renderSyntheticHatch(
      ctx,
      { minLon: -134, maxLon: -132, minLat: 55, maxLat: 56.5 },
      worldGrid,
      transform,
    );
    expect(ctx.clip).toHaveBeenCalled();
    expect((ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      SYNTHETIC_HATCH_COLORS.length,
    );
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith(
      "⚠ SIMULATED",
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("is a no-op for a degenerate (zero-area) bbox", () => {
    const ctx = makeCtx();
    renderSyntheticHatch(
      ctx,
      { minLon: -133, maxLon: -133, minLat: 55.5, maxLat: 55.5 },
      worldGrid,
      transform,
    );
    expect(ctx.clip).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});
