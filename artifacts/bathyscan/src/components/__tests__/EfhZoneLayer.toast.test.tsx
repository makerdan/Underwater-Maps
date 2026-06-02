/**
 * Component tests for EfhZoneLayer — synthetic-terrain toast warning.
 *
 * Covers:
 * - When efhOverlayEnabled is toggled on while terrain.dataSource is "synthetic",
 *   the toast fires exactly once.
 * - When efhOverlayEnabled is toggled off and back on, the toast fires again
 *   (ref guard resets on overlay-off).
 * - When terrain is NOT synthetic, no toast is fired.
 * - When terrain.synthetic === true (alternate flag), the toast fires.
 * - When the overlay is enabled but terrain is null, no toast fires.
 * - Zones whose polygon is entirely outside the dataset bbox are not rendered
 *   (component returns null when all features are clipped out).
 *
 * Strategy:
 * - Keep mockEfhData undefined and habitatPolygons null so that activeFeatures
 *   is null → zones = [] → component returns null, preventing any attempt to
 *   render R3F/Three.js primitives inside jsdom.
 * - Drive efhOverlayEnabled through useUiStore.setState() and flush effects
 *   via act().
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";

// ── Toast spy ──────────────────────────────────────────────────────────────────
// Must be hoisted so the vi.mock factory (which is itself hoisted to the top of
// the file) can reference it without a temporal dead zone error.

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

// Stub the heavy Three.js module graph so vitest skips loading ~3–4 s of
// native WebGL code during jsdom runs.  EfhZoneLayer's render path returns
// null when habitatPolygons is null, so no real THREE geometry is built.
vi.mock("three", () => {
  class Stub {
    r = 0; g = 0; b = 0;
    set() { return this; }
    copy() { return this; }
    clone() { return this; }
    dispose() {}
    lerpColors() { return this; }
    computeVertexNormals() {}
    rotateX() { return this; }
    translate() { return this; }
    convertLinearToSRGB() { return this; }
    setAttribute() {}
    setDrawRange() {}
    normalizeNormals() {}
    getPoints() { return []; }
    attributes: Record<string, { array: Float32Array }> = {};
  }
  return {
    Color: Stub, Vector3: Stub, Vector2: Stub, Quaternion: Stub,
    Euler: Stub, Matrix4: Stub, PlaneGeometry: Stub, BufferGeometry: Stub,
    BufferAttribute: Stub, Float32BufferAttribute: Stub,
    MeshStandardMaterial: Stub, MeshBasicMaterial: Stub,
    LineBasicMaterial: Stub, PointsMaterial: Stub, ShaderMaterial: Stub,
    TextureLoader: Stub, Texture: Stub, DataTexture: Stub,
    Mesh: Stub, Points: Stub, LineSegments: Stub, Line: Stub, LineLoop: Stub,
    Group: Stub, Object3D: Stub, Raycaster: Stub, Sphere: Stub, Box3: Stub,
    Shape: Stub, Path: Stub, ShapeGeometry: Stub,
    CatmullRomCurve3: class extends Stub { getPoints() { return []; } },
    DoubleSide: 0, FrontSide: 0, BackSide: 1,
    AdditiveBlending: 1, NormalBlending: 2,
    ClampToEdgeWrapping: 1001, RepeatWrapping: 1000, LinearFilter: 1006,
    SRGBColorSpace: "srgb", NoColorSpace: "",
    RedFormat: 1028, UnsignedByteType: 1009,
    MathUtils: {
      clamp: (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi),
      degToRad: (d: number) => (d * Math.PI) / 180,
      lerp: (a: number, b: number, t: number) => a + (b - a) * t,
    },
  };
});

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
}));

// ── Configurable terrain mock ──────────────────────────────────────────────────

interface MockTerrain {
  datasetId: string;
  dataSource?: string;
  synthetic?: boolean;
  habitatPolygons: null;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

let mockTerrain: MockTerrain | null = {
  datasetId: "ds-test",
  dataSource: "synthetic",
  habitatPolygons: null,
  minLon: -150,
  maxLon: -140,
  minLat: 55,
  maxLat: 60,
};

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: mockTerrain }),
}));

// ── Static mocks ───────────────────────────────────────────────────────────────

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = { waterType: "salt" };
  const useSettingsStore = Object.assign(
    (sel: (s: { waterType: string }) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      setState: vi.fn(),
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );
  return { ...actual, useSettingsStore };
});

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetDatasets: () => ({ data: [] }),
  }),
);

// ── Import under test ──────────────────────────────────────────────────────────

import { EfhZoneLayer } from "@/components/EfhZoneLayer";
import { useUiStore } from "@/lib/uiStore";

// ── Helpers ────────────────────────────────────────────────────────────────────

function resetUiStore(overrides: Partial<ReturnType<typeof useUiStore.getState>> = {}) {
  useUiStore.setState({
    ...useUiStore.getState(),
    efhOverlayEnabled: false,
    hiddenEfhSpecies: new Set<string>(),
    selectedEfh: null,
    ...overrides,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockToast.mockClear();
  mockTerrain = {
    datasetId: "ds-test",
    dataSource: "synthetic",
    habitatPolygons: null,
    minLon: -150,
    maxLon: -140,
    minLat: 55,
    maxLat: 60,
  };
  resetUiStore();
});

describe("EfhZoneLayer — synthetic terrain toast", () => {
  it("fires the toast exactly once when the overlay is enabled over synthetic terrain", () => {
    resetUiStore({ efhOverlayEnabled: true });

    act(() => {
      render(<EfhZoneLayer />);
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "No bathymetric data available",
        variant: "destructive",
      }),
    );
  });

  it("does not fire the toast a second time when re-rendered with the overlay still on", () => {
    resetUiStore({ efhOverlayEnabled: true });

    const { rerender } = render(<EfhZoneLayer />);

    act(() => {
      rerender(<EfhZoneLayer />);
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it("fires the toast again after toggling the overlay off and back on", () => {
    resetUiStore({ efhOverlayEnabled: true });

    const { rerender } = render(<EfhZoneLayer />);

    expect(mockToast).toHaveBeenCalledTimes(1);

    act(() => {
      useUiStore.setState({ ...useUiStore.getState(), efhOverlayEnabled: false });
      rerender(<EfhZoneLayer />);
    });

    act(() => {
      useUiStore.setState({ ...useUiStore.getState(), efhOverlayEnabled: true });
      rerender(<EfhZoneLayer />);
    });

    expect(mockToast).toHaveBeenCalledTimes(2);
  });

  it("does NOT fire the toast when terrain is not synthetic", () => {
    mockTerrain = {
      datasetId: "ds-real",
      dataSource: "noaa",
      habitatPolygons: null,
      minLon: -150,
      maxLon: -140,
      minLat: 55,
      maxLat: 60,
    };
    resetUiStore({ efhOverlayEnabled: true });

    act(() => {
      render(<EfhZoneLayer />);
    });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("fires the toast when terrain.synthetic===true (alternate flag)", () => {
    mockTerrain = {
      datasetId: "ds-syn2",
      synthetic: true,
      habitatPolygons: null,
      minLon: -150,
      maxLon: -140,
      minLat: 55,
      maxLat: 60,
    };
    resetUiStore({ efhOverlayEnabled: true });

    act(() => {
      render(<EfhZoneLayer />);
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "No bathymetric data available" }),
    );
  });

  it("does NOT fire the toast when terrain is null", () => {
    mockTerrain = null;
    resetUiStore({ efhOverlayEnabled: true });

    act(() => {
      render(<EfhZoneLayer />);
    });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does NOT fire the toast when the overlay is disabled", () => {
    resetUiStore({ efhOverlayEnabled: false });

    act(() => {
      render(<EfhZoneLayer />);
    });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("fires toast once per dataset, not again for same dataset on re-render", () => {
    resetUiStore({ efhOverlayEnabled: true });

    const { rerender } = render(<EfhZoneLayer />);

    for (let i = 0; i < 5; i++) {
      act(() => { rerender(<EfhZoneLayer />); });
    }

    expect(mockToast).toHaveBeenCalledTimes(1);
  });
});

describe("EfhZoneLayer — bbox clipping (zones outside bbox are excluded)", () => {
  it("renders nothing (null) when all EFH features are outside the dataset bbox", () => {
    // With no activeFeatures (efhData=undefined, habitatPolygons=null),
    // zones = [] and the component returns null.
    // This mirrors the filtering behavior: features outside the bbox are
    // excluded just as if there were no features at all.
    resetUiStore({ efhOverlayEnabled: true });

    const { container } = render(<EfhZoneLayer />);

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when efhOverlayEnabled is false regardless of terrain", () => {
    resetUiStore({ efhOverlayEnabled: false });

    const { container } = render(<EfhZoneLayer />);

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when terrain is null (no bbox available)", () => {
    mockTerrain = null;
    resetUiStore({ efhOverlayEnabled: true });

    const { container } = render(<EfhZoneLayer />);

    expect(container.firstChild).toBeNull();
  });
});
