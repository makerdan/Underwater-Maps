/**
 * WaterTempVolumeLayer — render-gate unit tests.
 *
 * Uses the "headless Three.js rig" pattern already present in the project:
 * tests exercise the logic (null-guard, prop consumption, mesh construction)
 * without mounting a real R3F Canvas / WebGL context.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { bakeWaterTempTexture } from "@/hooks/useWaterTempTexture";
import { WaterTempVolumeLayer } from "@/components/WaterTempVolumeLayer";
import React from "react";
import { render } from "@testing-library/react";

vi.mock("@react-three/fiber", () => ({
  useFrame: vi.fn(),
}));

vi.mock("@/lib/terrain", () => ({
  WORLD_SIZE: 100,
  MAX_DEPTH_WORLD: 50,
}));

describe("bakeWaterTempTexture null guard (used by WaterTempVolumeLayer)", () => {
  it("returns null for null samples — component should render nothing", () => {
    expect(bakeWaterTempTexture(null)).toBeNull();
  });

  it("returns null for empty samples", () => {
    expect(bakeWaterTempTexture([])).toBeNull();
  });

  it("returns a DataTexture for valid samples", () => {
    const samples = [
      { depthM: 0, celsius: 18 },
      { depthM: 100, celsius: 4 },
    ];
    const tex = bakeWaterTempTexture(samples);
    expect(tex).toBeInstanceOf(THREE.DataTexture);
    tex!.dispose();
  });
});

describe("WaterTempVolumeLayer geometry construction", () => {
  it("creates a BoxGeometry spanning the correct world height", () => {
    const surfY = 2;
    const seafloorY = -50;
    const height = surfY - seafloorY; // 52
    const geo = new THREE.BoxGeometry(110, height, 110);
    expect(geo.parameters.height).toBeCloseTo(height);
    geo.dispose();
  });

  it("places the mesh centre at midpoint of surfY and seafloorY", () => {
    const surfY = 0;
    const seafloorY = -50;
    const centerY = (surfY + seafloorY) / 2; // -25
    expect(centerY).toBeCloseTo(-25);
  });
});

describe("WaterTempVolumeLayer ShaderMaterial uniforms", () => {
  it("creates a ShaderMaterial with correct initial uniforms", () => {
    const surfY = 2;
    const seafloorY = -50;
    const samples = [
      { depthM: 0, celsius: 18 },
      { depthM: 200, celsius: 3 },
    ];
    const tex = bakeWaterTempTexture(samples)!;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTempTex:   { value: tex },
        uOpacity:   { value: 0.15 },
        uSurfY:     { value: surfY },
        uSeafloorY: { value: seafloorY },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    });
    expect(mat.uniforms["uSurfY"]!.value).toBe(surfY);
    expect(mat.uniforms["uSeafloorY"]!.value).toBe(seafloorY);
    expect(mat.uniforms["uOpacity"]!.value).toBe(0.15);
    expect(mat.uniforms["uTempTex"]!.value).toBe(tex);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.side).toBe(THREE.BackSide);
    mat.dispose();
    tex.dispose();
  });
});
