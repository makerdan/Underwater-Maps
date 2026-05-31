/**
 * Tests that the float-texture capability probe correctly updates
 * webglContextStore, and that the fallback branch is taken without
 * throwing when the OES_texture_float_linear extension is absent.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "@testing-library/react";
import { useWebglContextStore } from "@/lib/webglContextStore";

function makeRenderer(opts: {
  isWebGL2: boolean;
  hasFloatLinear: boolean;
}): { capabilities: { isWebGL2: boolean }; extensions: { get: (name: string) => object | null } } {
  return {
    capabilities: { isWebGL2: opts.isWebGL2 },
    extensions: {
      get: (name: string) =>
        name === "OES_texture_float_linear" && opts.hasFloatLinear
          ? ({} as object)
          : null,
    },
  };
}

/**
 * Mirrors the capability probe logic from TourScene's handleCanvasCreated so
 * this test exercises exactly the same decision branch without needing R3F.
 */
function runCapabilityProbe(renderer: ReturnType<typeof makeRenderer>): void {
  const supported =
    renderer.capabilities.isWebGL2 ||
    !!renderer.extensions.get("OES_texture_float_linear");
  useWebglContextStore.getState().setFloatTextureLinear(supported);
}

describe("float-texture capability probe", () => {
  beforeEach(() => {
    act(() => {
      useWebglContextStore.setState({ floatTextureLinear: true });
    });
  });

  it("sets floatTextureLinear=true on a WebGL2 renderer (no extension needed)", () => {
    const renderer = makeRenderer({ isWebGL2: true, hasFloatLinear: false });
    act(() => {
      runCapabilityProbe(renderer);
    });
    expect(useWebglContextStore.getState().floatTextureLinear).toBe(true);
  });

  it("sets floatTextureLinear=true on WebGL1 with OES_texture_float_linear present", () => {
    const renderer = makeRenderer({ isWebGL2: false, hasFloatLinear: true });
    act(() => {
      runCapabilityProbe(renderer);
    });
    expect(useWebglContextStore.getState().floatTextureLinear).toBe(true);
  });

  it("sets floatTextureLinear=false on WebGL1 without OES_texture_float_linear", () => {
    const renderer = makeRenderer({ isWebGL2: false, hasFloatLinear: false });
    act(() => {
      runCapabilityProbe(renderer);
    });
    expect(useWebglContextStore.getState().floatTextureLinear).toBe(false);
  });

  it("probe does not throw even when extension is absent", () => {
    const renderer = makeRenderer({ isWebGL2: false, hasFloatLinear: false });
    expect(() => {
      act(() => {
        runCapabilityProbe(renderer);
      });
    }).not.toThrow();
  });

  it("setFloatTextureLinear does not affect other store fields", () => {
    act(() => {
      useWebglContextStore.setState({ contextLost: false, recoveryKey: 42 });
    });
    const renderer = makeRenderer({ isWebGL2: false, hasFloatLinear: false });
    act(() => {
      runCapabilityProbe(renderer);
    });
    const state = useWebglContextStore.getState();
    expect(state.floatTextureLinear).toBe(false);
    expect(state.contextLost).toBe(false);
    expect(state.recoveryKey).toBe(42);
  });
});

void vi;
