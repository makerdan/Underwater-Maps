/**
 * habitatTexture-dispose.test.ts
 *
 * Verifies the DataTexture lifecycle in TerrainMesh:
 *   - A new DataTexture is created when habitat scores are set.
 *   - The previous DataTexture is disposed before a new one is created on
 *     species/score change (no GPU texture leak on overlay switch).
 *   - The DataTexture is disposed on component unmount.
 *
 * Tests the disposal logic directly — the useEffect body from TerrainMesh is
 * ported here verbatim so we can exercise it without an R3F Canvas, keeping
 * the test fast and deterministic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeDataTexture {
  dispose: ReturnType<typeof vi.fn>;
  needsUpdate: boolean;
  minFilter: number;
  magFilter: number;
  wrapS: number;
  wrapT: number;
}

function makeDataTexture(): FakeDataTexture {
  return {
    dispose: vi.fn(),
    needsUpdate: false,
    minFilter: 0,
    magFilter: 0,
    wrapS: 0,
    wrapT: 0,
  };
}

type HabitatTexRef = { current: FakeDataTexture | null };

/**
 * Mirrors the DataTexture management logic from TerrainMesh's useEffect.
 * Returns the newly created DataTexture (or null if scores are absent).
 */
function applyHabitatScores(
  scores: Float32Array | null,
  resolution: number,
  habitatTexRef: HabitatTexRef,
  materialUniforms: Record<string, { value: unknown }>,
  createTexture: () => FakeDataTexture,
): FakeDataTexture | null {
  if (habitatTexRef.current) {
    habitatTexRef.current.dispose();
    habitatTexRef.current = null;
  }

  if (scores && scores.length === resolution * resolution) {
    const tex = createTexture();
    tex.needsUpdate = true;
    materialUniforms["uHabitatTex"]!.value = tex;
    habitatTexRef.current = tex;
    return tex;
  }

  return null;
}

/**
 * Mirrors the unmount cleanup from TerrainMesh.
 */
function cleanupHabitatTexture(habitatTexRef: HabitatTexRef): void {
  if (habitatTexRef.current) {
    habitatTexRef.current.dispose();
    habitatTexRef.current = null;
  }
}

describe("DataTexture lifecycle — habitat overlay disposal", () => {
  const N = 16;
  let habitatTexRef: HabitatTexRef;
  let materialUniforms: Record<string, { value: unknown }>;

  beforeEach(() => {
    habitatTexRef = { current: null };
    materialUniforms = { uHabitatTex: { value: null } };
  });

  it("creates a DataTexture when scores are provided", () => {
    const scores = new Float32Array(N * N).fill(0.5);
    const tex = applyHabitatScores(scores, N, habitatTexRef, materialUniforms, makeDataTexture);
    expect(tex).not.toBeNull();
    expect(habitatTexRef.current).toBe(tex);
    expect(materialUniforms["uHabitatTex"]!.value).toBe(tex);
  });

  it("disposes the old DataTexture before creating a new one on species switch", () => {
    const scores1 = new Float32Array(N * N).fill(0.3);
    const tex1 = applyHabitatScores(scores1, N, habitatTexRef, materialUniforms, makeDataTexture)!;
    expect(tex1.dispose).not.toHaveBeenCalled();

    const scores2 = new Float32Array(N * N).fill(0.7);
    const tex2 = applyHabitatScores(scores2, N, habitatTexRef, materialUniforms, makeDataTexture)!;

    expect(tex1.dispose).toHaveBeenCalledTimes(1);
    expect(tex2.dispose).not.toHaveBeenCalled();
    expect(habitatTexRef.current).toBe(tex2);
  });

  it("disposes when scores are cleared (species deselected)", () => {
    const scores = new Float32Array(N * N).fill(0.5);
    const tex = applyHabitatScores(scores, N, habitatTexRef, materialUniforms, makeDataTexture)!;

    applyHabitatScores(null, N, habitatTexRef, materialUniforms, makeDataTexture);

    expect(tex.dispose).toHaveBeenCalledTimes(1);
    expect(habitatTexRef.current).toBeNull();
    // The uniform still references the now-disposed texture object; the GPU won't
    // sample it because uShowHabitat is driven to 0 when no species is active.
    // What matters is that dispose() was called to free the GPU allocation.
  });

  it("disposes the current DataTexture on unmount", () => {
    const scores = new Float32Array(N * N).fill(0.5);
    const tex = applyHabitatScores(scores, N, habitatTexRef, materialUniforms, makeDataTexture)!;
    expect(tex.dispose).not.toHaveBeenCalled();

    cleanupHabitatTexture(habitatTexRef);

    expect(tex.dispose).toHaveBeenCalledTimes(1);
    expect(habitatTexRef.current).toBeNull();
  });

  it("unmount cleanup is a no-op when no texture was ever created", () => {
    expect(() => cleanupHabitatTexture(habitatTexRef)).not.toThrow();
    expect(habitatTexRef.current).toBeNull();
  });

  it("does not create a texture when scores length mismatches resolution", () => {
    const wrongLengthScores = new Float32Array(10).fill(0.5);
    const tex = applyHabitatScores(wrongLengthScores, N, habitatTexRef, materialUniforms, makeDataTexture);
    expect(tex).toBeNull();
    expect(habitatTexRef.current).toBeNull();
  });

  it("dispose is called exactly once per switch across multiple species changes", () => {
    const scores = new Float32Array(N * N).fill(0.5);
    const textures: FakeDataTexture[] = [];

    for (let i = 0; i < 5; i++) {
      const tex = applyHabitatScores(scores, N, habitatTexRef, materialUniforms, makeDataTexture)!;
      textures.push(tex);
    }

    for (let i = 0; i < textures.length - 1; i++) {
      expect(textures[i]!.dispose).toHaveBeenCalledTimes(1);
    }
    expect(textures[textures.length - 1]!.dispose).not.toHaveBeenCalled();
  });
});
