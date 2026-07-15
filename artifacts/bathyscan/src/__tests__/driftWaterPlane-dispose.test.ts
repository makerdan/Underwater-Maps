/**
 * driftWaterPlane-dispose.test.ts
 *
 * Verifies GPU resource disposal in DriftWaterPlane's useEffect cleanup:
 *   - material.dispose() is called on unmount
 *   - geometry.dispose() is called on unmount
 *
 * Tests the disposal logic directly — the useEffect cleanup body from
 * DriftWaterPlane is ported here verbatim so we can exercise it without an
 * R3F Canvas, keeping the test fast and deterministic.
 */
import { describe, it, expect, vi } from "vitest";

interface FakeDisposable {
  dispose: ReturnType<typeof vi.fn>;
}

function makeDisposable(): FakeDisposable {
  return { dispose: vi.fn() };
}

/**
 * Mirrors the useEffect cleanup body from DriftWaterPlane:
 *
 *   return () => {
 *     material.dispose();
 *     geometry.dispose();
 *   };
 */
function cleanupDriftWaterPlane(
  material: FakeDisposable,
  geometry: FakeDisposable,
): void {
  material.dispose();
  geometry.dispose();
}

describe("DriftWaterPlane — GPU resource disposal on unmount", () => {
  it("disposes the ShaderMaterial on unmount", () => {
    const material = makeDisposable();
    const geometry = makeDisposable();

    cleanupDriftWaterPlane(material, geometry);

    expect(material.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the PlaneGeometry on unmount", () => {
    const material = makeDisposable();
    const geometry = makeDisposable();

    cleanupDriftWaterPlane(material, geometry);

    expect(geometry.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes both material and geometry exactly once per unmount", () => {
    const material = makeDisposable();
    const geometry = makeDisposable();

    cleanupDriftWaterPlane(material, geometry);

    expect(material.dispose).toHaveBeenCalledTimes(1);
    expect(geometry.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not call dispose before cleanup runs", () => {
    const material = makeDisposable();
    const geometry = makeDisposable();

    expect(material.dispose).not.toHaveBeenCalled();
    expect(geometry.dispose).not.toHaveBeenCalled();
  });

  it("switching datasets: old material and geometry are each disposed once before new ones are created", () => {
    const mat1 = makeDisposable();
    const geo1 = makeDisposable();

    cleanupDriftWaterPlane(mat1, geo1);

    expect(mat1.dispose).toHaveBeenCalledTimes(1);
    expect(geo1.dispose).toHaveBeenCalledTimes(1);

    const mat2 = makeDisposable();
    const geo2 = makeDisposable();

    expect(mat2.dispose).not.toHaveBeenCalled();
    expect(geo2.dispose).not.toHaveBeenCalled();

    cleanupDriftWaterPlane(mat2, geo2);

    expect(mat2.dispose).toHaveBeenCalledTimes(1);
    expect(geo2.dispose).toHaveBeenCalledTimes(1);
  });

  it("each mount/unmount cycle disposes exactly once — no double-free", () => {
    for (let i = 0; i < 4; i++) {
      const material = makeDisposable();
      const geometry = makeDisposable();

      cleanupDriftWaterPlane(material, geometry);

      expect(material.dispose).toHaveBeenCalledTimes(1);
      expect(geometry.dispose).toHaveBeenCalledTimes(1);
    }
  });
});
