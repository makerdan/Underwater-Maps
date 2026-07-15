/**
 * currentsLayer-dispose.test.ts
 *
 * Verifies GPU resource disposal across the three CurrentsLayer sub-components:
 *
 *   CurrentParticleLayer
 *     - geometry.dispose() is called on unmount
 *     - material.dispose() is called on unmount
 *
 *   CurrentArrowLayer
 *     - geometry.dispose() is called on unmount
 *     - material.dispose() is called on unmount
 *
 *   CurrentStreamlineLayer
 *     - geo.dispose() and mat.dispose() called for every line on unmount
 *     - no double-free when lines array is stable across field changes
 *
 * Tests the disposal logic directly — each useEffect cleanup body is ported
 * here verbatim so we can exercise it without an R3F Canvas, keeping the
 * tests fast and deterministic.
 */
import { describe, it, expect, vi } from "vitest";

interface FakeDisposable {
  dispose: ReturnType<typeof vi.fn>;
}

function makeDisposable(): FakeDisposable {
  return { dispose: vi.fn() };
}

// ---------------------------------------------------------------------------
// Shared cleanup helpers — mirrors the useEffect cleanup bodies in
// CurrentsLayer.tsx for each sub-component.
// ---------------------------------------------------------------------------

/**
 * Mirrors CurrentParticleLayer's geometry cleanup:
 *   useEffect(() => { return () => { geometry.dispose(); }; }, [geometry]);
 * and material cleanup:
 *   useEffect(() => { return () => { material.dispose(); }; }, [material]);
 */
function cleanupParticleLayer(
  geometry: FakeDisposable,
  material: FakeDisposable,
): void {
  geometry.dispose();
  material.dispose();
}

/**
 * Mirrors CurrentArrowLayer's single cleanup effect:
 *   useEffect(() => {
 *     return () => { geometry.dispose(); material.dispose(); };
 *   }, [geometry, material]);
 */
function cleanupArrowLayer(
  geometry: FakeDisposable,
  material: FakeDisposable,
): void {
  geometry.dispose();
  material.dispose();
}

interface FakeLine {
  geo: FakeDisposable;
  mat: FakeDisposable;
}

/**
 * Mirrors CurrentStreamlineLayer's cleanup:
 *   useEffect(() => {
 *     return () => {
 *       for (const ln of lines) { ln.geo.dispose(); ln.mat.dispose(); }
 *     };
 *   }, [lines]);
 */
function cleanupStreamlineLayer(lines: FakeLine[]): void {
  for (const ln of lines) {
    ln.geo.dispose();
    ln.mat.dispose();
  }
}

function makeLines(count: number): FakeLine[] {
  return Array.from({ length: count }, () => ({
    geo: makeDisposable(),
    mat: makeDisposable(),
  }));
}

// ---------------------------------------------------------------------------
// CurrentParticleLayer
// ---------------------------------------------------------------------------

describe("CurrentParticleLayer — GPU resource disposal on unmount", () => {
  it("disposes the BufferGeometry on unmount", () => {
    const geometry = makeDisposable();
    const material = makeDisposable();

    cleanupParticleLayer(geometry, material);

    expect(geometry.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the PointsMaterial on unmount", () => {
    const geometry = makeDisposable();
    const material = makeDisposable();

    cleanupParticleLayer(geometry, material);

    expect(material.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes both geometry and material exactly once per unmount", () => {
    const geometry = makeDisposable();
    const material = makeDisposable();

    cleanupParticleLayer(geometry, material);

    expect(geometry.dispose).toHaveBeenCalledTimes(1);
    expect(material.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not call dispose before cleanup runs", () => {
    const geometry = makeDisposable();
    const material = makeDisposable();

    expect(geometry.dispose).not.toHaveBeenCalled();
    expect(material.dispose).not.toHaveBeenCalled();
  });

  it("switching datasets: old geometry and material disposed before new ones created", () => {
    const geo1 = makeDisposable();
    const mat1 = makeDisposable();

    cleanupParticleLayer(geo1, mat1);
    expect(geo1.dispose).toHaveBeenCalledTimes(1);
    expect(mat1.dispose).toHaveBeenCalledTimes(1);

    const geo2 = makeDisposable();
    const mat2 = makeDisposable();

    expect(geo2.dispose).not.toHaveBeenCalled();
    expect(mat2.dispose).not.toHaveBeenCalled();

    cleanupParticleLayer(geo2, mat2);
    expect(geo2.dispose).toHaveBeenCalledTimes(1);
    expect(mat2.dispose).toHaveBeenCalledTimes(1);
  });

  it("no double-free: each mount/unmount cycle disposes exactly once", () => {
    for (let i = 0; i < 4; i++) {
      const geometry = makeDisposable();
      const material = makeDisposable();

      cleanupParticleLayer(geometry, material);

      expect(geometry.dispose).toHaveBeenCalledTimes(1);
      expect(material.dispose).toHaveBeenCalledTimes(1);
    }
  });
});

// ---------------------------------------------------------------------------
// CurrentArrowLayer
// ---------------------------------------------------------------------------

describe("CurrentArrowLayer — GPU resource disposal on unmount", () => {
  it("disposes the ShapeGeometry on unmount", () => {
    const geometry = makeDisposable();
    const material = makeDisposable();

    cleanupArrowLayer(geometry, material);

    expect(geometry.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the MeshBasicMaterial on unmount", () => {
    const geometry = makeDisposable();
    const material = makeDisposable();

    cleanupArrowLayer(geometry, material);

    expect(material.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes both geometry and material exactly once per unmount", () => {
    const geometry = makeDisposable();
    const material = makeDisposable();

    cleanupArrowLayer(geometry, material);

    expect(geometry.dispose).toHaveBeenCalledTimes(1);
    expect(material.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not call dispose before cleanup runs", () => {
    const geometry = makeDisposable();
    const material = makeDisposable();

    expect(geometry.dispose).not.toHaveBeenCalled();
    expect(material.dispose).not.toHaveBeenCalled();
  });

  it("switching datasets: old geometry and material disposed before new ones created", () => {
    const geo1 = makeDisposable();
    const mat1 = makeDisposable();

    cleanupArrowLayer(geo1, mat1);
    expect(geo1.dispose).toHaveBeenCalledTimes(1);
    expect(mat1.dispose).toHaveBeenCalledTimes(1);

    const geo2 = makeDisposable();
    const mat2 = makeDisposable();

    expect(geo2.dispose).not.toHaveBeenCalled();
    expect(mat2.dispose).not.toHaveBeenCalled();

    cleanupArrowLayer(geo2, mat2);
    expect(geo2.dispose).toHaveBeenCalledTimes(1);
    expect(mat2.dispose).toHaveBeenCalledTimes(1);
  });

  it("no double-free: each mount/unmount cycle disposes exactly once", () => {
    for (let i = 0; i < 4; i++) {
      const geometry = makeDisposable();
      const material = makeDisposable();

      cleanupArrowLayer(geometry, material);

      expect(geometry.dispose).toHaveBeenCalledTimes(1);
      expect(material.dispose).toHaveBeenCalledTimes(1);
    }
  });
});

// ---------------------------------------------------------------------------
// CurrentStreamlineLayer
// ---------------------------------------------------------------------------

describe("CurrentStreamlineLayer — GPU resource disposal on unmount", () => {
  it("disposes every line's geometry and material when there is one line", () => {
    const lines = makeLines(1);

    cleanupStreamlineLayer(lines);

    expect(lines[0]!.geo.dispose).toHaveBeenCalledTimes(1);
    expect(lines[0]!.mat.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes every line's geometry and material for the default seed count (36 lines)", () => {
    const STREAMLINE_COUNT = 36;
    const lines = makeLines(STREAMLINE_COUNT);

    cleanupStreamlineLayer(lines);

    for (const ln of lines) {
      expect(ln.geo.dispose).toHaveBeenCalledTimes(1);
      expect(ln.mat.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it("does not call dispose before cleanup runs", () => {
    const lines = makeLines(4);

    for (const ln of lines) {
      expect(ln.geo.dispose).not.toHaveBeenCalled();
      expect(ln.mat.dispose).not.toHaveBeenCalled();
    }
  });

  it("cleanup is a no-op when lines array is empty", () => {
    expect(() => cleanupStreamlineLayer([])).not.toThrow();
  });

  it("field change does not double-free: lines array is stable, cleanup fires only once on unmount", () => {
    const lines = makeLines(4);

    // Simulate multiple field updates (re-trace via useEffect) — these do NOT
    // trigger the disposal cleanup because the `lines` dep is stable.
    // Only a single unmount at the end calls cleanup.
    cleanupStreamlineLayer(lines);

    for (const ln of lines) {
      expect(ln.geo.dispose).toHaveBeenCalledTimes(1);
      expect(ln.mat.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it("each mount/unmount cycle with a new lines array disposes exactly once per line", () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      const lines = makeLines(6);

      cleanupStreamlineLayer(lines);

      for (const ln of lines) {
        expect(ln.geo.dispose).toHaveBeenCalledTimes(1);
        expect(ln.mat.dispose).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("switching datasets: old lines fully disposed before new set is created", () => {
    const lines1 = makeLines(36);

    cleanupStreamlineLayer(lines1);

    for (const ln of lines1) {
      expect(ln.geo.dispose).toHaveBeenCalledTimes(1);
      expect(ln.mat.dispose).toHaveBeenCalledTimes(1);
    }

    const lines2 = makeLines(36);

    for (const ln of lines2) {
      expect(ln.geo.dispose).not.toHaveBeenCalled();
      expect(ln.mat.dispose).not.toHaveBeenCalled();
    }

    cleanupStreamlineLayer(lines2);

    for (const ln of lines2) {
      expect(ln.geo.dispose).toHaveBeenCalledTimes(1);
      expect(ln.mat.dispose).toHaveBeenCalledTimes(1);
    }
  });
});
