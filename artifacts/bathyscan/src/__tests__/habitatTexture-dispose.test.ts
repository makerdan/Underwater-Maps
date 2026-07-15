/**
 * habitatTexture-dispose.test.ts
 *
 * Verifies the DataTexture lifecycle in TerrainMesh:
 *   - A new DataTexture is created when habitat scores are set.
 *   - The superseded DataTexture is disposed exactly once, AFTER the uniform
 *     has been rebound to its replacement (new texture or placeholder), so
 *     the shader can never sample a disposed texture. Sampling a disposed
 *     texture makes three.js silently re-upload it — a GPU allocation nothing
 *     ever disposes again.
 *   - When scores are cleared or mismatched, the uniform is rebound to the
 *     shared placeholder before the old texture is disposed.
 *   - The DataTexture is disposed on component unmount, with the uniform
 *     rebound to the placeholder.
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

/** Stands in for the module-level shared placeholder in terrainShader.ts. */
const PLACEHOLDER = makeDataTexture();

type HabitatTexRef = { current: FakeDataTexture | null };

/**
 * Mirrors the DataTexture management logic from TerrainMesh's upload useEffect.
 * Returns the newly created DataTexture (or null if scores are absent).
 */
function applyHabitatScores(
  scores: Float32Array | null,
  resolution: number,
  habitatTexRef: HabitatTexRef,
  materialUniforms: Record<string, { value: unknown }>,
  createTexture: () => FakeDataTexture,
): FakeDataTexture | null {
  const prevTex = habitatTexRef.current;
  let created: FakeDataTexture | null = null;

  if (scores && scores.length === resolution * resolution) {
    const tex = createTexture();
    tex.needsUpdate = true;
    materialUniforms["uHabitatTex"]!.value = tex;
    habitatTexRef.current = tex;
    created = tex;
  } else {
    materialUniforms["uHabitatTex"]!.value = PLACEHOLDER;
    habitatTexRef.current = null;
  }

  if (prevTex && prevTex !== habitatTexRef.current) {
    prevTex.dispose();
  }

  return created;
}

/**
 * Mirrors the unmount cleanup from TerrainMesh.
 */
function cleanupHabitatTexture(
  habitatTexRef: HabitatTexRef,
  materialUniforms: Record<string, { value: unknown }>,
): void {
  if (habitatTexRef.current) {
    materialUniforms["uHabitatTex"]!.value = PLACEHOLDER;
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
    materialUniforms = { uHabitatTex: { value: PLACEHOLDER } };
  });

  it("creates a DataTexture when scores are provided", () => {
    const scores = new Float32Array(N * N).fill(0.5);
    const tex = applyHabitatScores(scores, N, habitatTexRef, materialUniforms, makeDataTexture);
    expect(tex).not.toBeNull();
    expect(habitatTexRef.current).toBe(tex);
    expect(materialUniforms["uHabitatTex"]!.value).toBe(tex);
  });

  it("disposes the superseded DataTexture exactly once on species switch, after the uniform is rebound", () => {
    const scores1 = new Float32Array(N * N).fill(0.3);
    const tex1 = applyHabitatScores(scores1, N, habitatTexRef, materialUniforms, makeDataTexture)!;
    expect(tex1.dispose).not.toHaveBeenCalled();

    const scores2 = new Float32Array(N * N).fill(0.7);
    let uniformAtDisposeTime: unknown = null;
    tex1.dispose.mockImplementation(() => {
      uniformAtDisposeTime = materialUniforms["uHabitatTex"]!.value;
    });
    const tex2 = applyHabitatScores(scores2, N, habitatTexRef, materialUniforms, makeDataTexture)!;

    expect(tex1.dispose).toHaveBeenCalledTimes(1);
    // At the moment tex1 was disposed, the uniform already pointed at tex2 —
    // there is no window where a disposed texture is bound to the shader.
    expect(uniformAtDisposeTime).toBe(tex2);
    expect(tex2.dispose).not.toHaveBeenCalled();
    expect(habitatTexRef.current).toBe(tex2);
    expect(materialUniforms["uHabitatTex"]!.value).toBe(tex2);
  });

  it("rebinds the placeholder and disposes when scores are cleared (species deselected)", () => {
    const scores = new Float32Array(N * N).fill(0.5);
    const tex = applyHabitatScores(scores, N, habitatTexRef, materialUniforms, makeDataTexture)!;

    applyHabitatScores(null, N, habitatTexRef, materialUniforms, makeDataTexture);

    expect(tex.dispose).toHaveBeenCalledTimes(1);
    expect(habitatTexRef.current).toBeNull();
    // The uniform must NOT keep referencing the disposed texture — three.js
    // would re-upload it if sampled (e.g. while activeSpecies is set but new
    // scores are still computing), leaking GPU memory permanently.
    expect(materialUniforms["uHabitatTex"]!.value).toBe(PLACEHOLDER);
  });

  it("rebinds the placeholder and disposes on grid-size mismatch (grid changed before scores recomputed)", () => {
    const scores = new Float32Array(N * N).fill(0.5);
    const tex = applyHabitatScores(scores, N, habitatTexRef, materialUniforms, makeDataTexture)!;

    // Same scores array, but the grid resolution changed underneath it.
    const created = applyHabitatScores(scores, N * 2, habitatTexRef, materialUniforms, makeDataTexture);

    expect(created).toBeNull();
    expect(tex.dispose).toHaveBeenCalledTimes(1);
    expect(habitatTexRef.current).toBeNull();
    expect(materialUniforms["uHabitatTex"]!.value).toBe(PLACEHOLDER);
  });

  it("disposes the current DataTexture on unmount and rebinds the placeholder", () => {
    const scores = new Float32Array(N * N).fill(0.5);
    const tex = applyHabitatScores(scores, N, habitatTexRef, materialUniforms, makeDataTexture)!;
    expect(tex.dispose).not.toHaveBeenCalled();

    cleanupHabitatTexture(habitatTexRef, materialUniforms);

    expect(tex.dispose).toHaveBeenCalledTimes(1);
    expect(habitatTexRef.current).toBeNull();
    expect(materialUniforms["uHabitatTex"]!.value).toBe(PLACEHOLDER);
  });

  it("unmount cleanup is a no-op when no texture was ever created", () => {
    expect(() => cleanupHabitatTexture(habitatTexRef, materialUniforms)).not.toThrow();
    expect(habitatTexRef.current).toBeNull();
  });

  it("does not create a texture when scores length mismatches resolution", () => {
    const wrongLengthScores = new Float32Array(10).fill(0.5);
    const tex = applyHabitatScores(wrongLengthScores, N, habitatTexRef, materialUniforms, makeDataTexture);
    expect(tex).toBeNull();
    expect(habitatTexRef.current).toBeNull();
    expect(materialUniforms["uHabitatTex"]!.value).toBe(PLACEHOLDER);
  });

  it("dispose is called exactly once per switch across multiple rapid score changes", () => {
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
    expect(PLACEHOLDER.dispose).not.toHaveBeenCalled();
  });
});
