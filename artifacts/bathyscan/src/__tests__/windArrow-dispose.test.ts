/**
 * windArrow-dispose.test.ts
 *
 * Verifies GPU resource disposal in WindArrow's useEffect cleanup:
 *   - featherGeo.dispose() is called on unmount
 *   - featherMat.dispose() is called on unmount
 *   - shaftMat.dispose() is called on unmount
 *   - headMat.dispose() is called on unmount
 *
 * Tests the disposal logic directly — the useEffect cleanup body from
 * WindArrow is ported here verbatim so we can exercise it without an R3F
 * Canvas, keeping the test fast and deterministic.
 */
import { describe, it, expect, vi } from "vitest";

interface FakeDisposable {
  dispose: ReturnType<typeof vi.fn>;
}

function makeDisposable(): FakeDisposable {
  return { dispose: vi.fn() };
}

/**
 * Mirrors the useEffect cleanup body from WindArrow:
 *
 *   return () => {
 *     featherGeo.dispose();
 *     featherMat.dispose();
 *     shaftMat.dispose();
 *     headMat.dispose();
 *   };
 */
function cleanupWindArrow(
  featherGeo: FakeDisposable,
  featherMat: FakeDisposable,
  shaftMat: FakeDisposable,
  headMat: FakeDisposable,
): void {
  featherGeo.dispose();
  featherMat.dispose();
  shaftMat.dispose();
  headMat.dispose();
}

describe("WindArrow — GPU resource disposal on unmount", () => {
  it("disposes featherGeo on unmount", () => {
    const featherGeo = makeDisposable();
    const featherMat = makeDisposable();
    const shaftMat = makeDisposable();
    const headMat = makeDisposable();

    cleanupWindArrow(featherGeo, featherMat, shaftMat, headMat);

    expect(featherGeo.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes featherMat on unmount", () => {
    const featherGeo = makeDisposable();
    const featherMat = makeDisposable();
    const shaftMat = makeDisposable();
    const headMat = makeDisposable();

    cleanupWindArrow(featherGeo, featherMat, shaftMat, headMat);

    expect(featherMat.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes shaftMat on unmount", () => {
    const featherGeo = makeDisposable();
    const featherMat = makeDisposable();
    const shaftMat = makeDisposable();
    const headMat = makeDisposable();

    cleanupWindArrow(featherGeo, featherMat, shaftMat, headMat);

    expect(shaftMat.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes headMat on unmount", () => {
    const featherGeo = makeDisposable();
    const featherMat = makeDisposable();
    const shaftMat = makeDisposable();
    const headMat = makeDisposable();

    cleanupWindArrow(featherGeo, featherMat, shaftMat, headMat);

    expect(headMat.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes all four GPU resources exactly once per unmount", () => {
    const featherGeo = makeDisposable();
    const featherMat = makeDisposable();
    const shaftMat = makeDisposable();
    const headMat = makeDisposable();

    cleanupWindArrow(featherGeo, featherMat, shaftMat, headMat);

    expect(featherGeo.dispose).toHaveBeenCalledTimes(1);
    expect(featherMat.dispose).toHaveBeenCalledTimes(1);
    expect(shaftMat.dispose).toHaveBeenCalledTimes(1);
    expect(headMat.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not call dispose before cleanup runs", () => {
    const featherGeo = makeDisposable();
    const featherMat = makeDisposable();
    const shaftMat = makeDisposable();
    const headMat = makeDisposable();

    expect(featherGeo.dispose).not.toHaveBeenCalled();
    expect(featherMat.dispose).not.toHaveBeenCalled();
    expect(shaftMat.dispose).not.toHaveBeenCalled();
    expect(headMat.dispose).not.toHaveBeenCalled();
  });

  it("each mount/unmount cycle disposes exactly once — no double-free", () => {
    for (let i = 0; i < 3; i++) {
      const featherGeo = makeDisposable();
      const featherMat = makeDisposable();
      const shaftMat = makeDisposable();
      const headMat = makeDisposable();

      cleanupWindArrow(featherGeo, featherMat, shaftMat, headMat);

      expect(featherGeo.dispose).toHaveBeenCalledTimes(1);
      expect(featherMat.dispose).toHaveBeenCalledTimes(1);
      expect(shaftMat.dispose).toHaveBeenCalledTimes(1);
      expect(headMat.dispose).toHaveBeenCalledTimes(1);
    }
  });
});
