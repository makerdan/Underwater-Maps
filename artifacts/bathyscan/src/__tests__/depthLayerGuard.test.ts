/**
 * Unit tests for depthLayerGuard.ts — the runtime guard that prevents an
 * unrecognised stored value from propagating as a DepthLayer in App.tsx.
 */

import { describe, it, expect } from "vitest";
import { toValidDepthLayer } from "@/lib/depthLayerGuard";

describe("toValidDepthLayer", () => {
  it('returns "surface" for the value "surface"', () => {
    expect(toValidDepthLayer("surface")).toBe("surface");
  });

  it('returns "mid" for the value "mid"', () => {
    expect(toValidDepthLayer("mid")).toBe("mid");
  });

  it('returns "near-bottom" for the value "near-bottom"', () => {
    expect(toValidDepthLayer("near-bottom")).toBe("near-bottom");
  });

  it('returns "surface" fallback for an unrecognised string', () => {
    expect(toValidDepthLayer("bogus")).toBe("surface");
  });

  it('returns "surface" fallback for an empty string', () => {
    expect(toValidDepthLayer("")).toBe("surface");
  });

  it('returns "surface" fallback for null', () => {
    expect(toValidDepthLayer(null)).toBe("surface");
  });

  it('returns "surface" fallback for undefined', () => {
    expect(toValidDepthLayer(undefined)).toBe("surface");
  });

  it('returns "surface" fallback for a number', () => {
    expect(toValidDepthLayer(0)).toBe("surface");
    expect(toValidDepthLayer(1)).toBe("surface");
  });

  it('returns "surface" fallback for an object', () => {
    expect(toValidDepthLayer({ layer: "surface" })).toBe("surface");
  });

  it('returns "surface" fallback for an array', () => {
    expect(toValidDepthLayer(["surface"])).toBe("surface");
  });
});
