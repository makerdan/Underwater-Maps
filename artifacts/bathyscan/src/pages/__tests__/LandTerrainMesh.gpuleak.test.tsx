/**
 * LandTerrainMesh — GPU-leak regression tests.
 *
 * Exercises the three disposal bugs that were fixed:
 *
 *   Bug A — PlaneGeometry leaked across primary-dataset switches.
 *            geometry.dispose() must be called when landGrid changes.
 *
 *   Bug B — MeshStandardMaterial (procedural ramp) leaked across switches.
 *            proceduralMaterial.dispose() must be called when landGrid changes.
 *
 *   Bug C — Satellite texture not disposed on unmount (empty-deps closure
 *            captured mount-time null).  The live texture must be disposed
 *            when the component unmounts.
 *
 * Three.js is replaced with a custom factory (not the shared __mocks__ stub)
 * so that dispose spies can be injected on PlaneGeometry and MeshStandardMaterial.
 * All other TourScene component imports are stubbed to prevent transitive
 * module-init side effects (e.g. terrainShader.ts creating a DataTexture at
 * module scope).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Trackable Three.js instances — "mock" prefix required for vitest hoisting.
// ---------------------------------------------------------------------------
const mockGeoInstances: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
const mockMatInstances: Array<{ dispose: ReturnType<typeof vi.fn>; map?: unknown }> = [];
// Texture loader — tests set this to trigger the loaded callback.
let mockTextureLoaderLoad: ReturnType<typeof vi.fn> = vi.fn();

// ---------------------------------------------------------------------------
// Custom three mock — must include every class used at module-init time by the
// transitive import chain (terrainShader.ts creates DataTexture at module scope).
// ---------------------------------------------------------------------------
vi.mock("three", () => {
  class PlaneGeometry {
    attributes = { position: { array: new Float32Array(48) } }; // 4×4 = 48 floats
    dispose = vi.fn();
    rotateX = vi.fn().mockReturnThis();
    setAttribute = vi.fn();
    computeVertexNormals = vi.fn();
    constructor() {
      mockGeoInstances.push(this as InstanceType<typeof PlaneGeometry>);
    }
  }
  class MeshStandardMaterial {
    map: unknown = undefined;
    vertexColors = false;
    roughness = 1;
    metalness = 0;
    side = 2;
    dispose = vi.fn();
    constructor(opts: Record<string, unknown> = {}) {
      Object.assign(this, opts);
      mockMatInstances.push(this as InstanceType<typeof MeshStandardMaterial>);
    }
  }
  class BufferAttribute {
    constructor(public array: Float32Array, public itemSize: number) {}
  }
  class Color {
    r = 0; g = 0; b = 0;
    constructor(_hex?: string) {}
    lerpColors(_a: Color, _b: Color, _t: number) { return this; }
    set() { return this; }
    setRGB() { return this; }
  }
  class TextureLoader {
    load(...args: unknown[]) { mockTextureLoaderLoad(...args); }
  }
  class Texture {
    dispose = vi.fn();
    flipY = true;
    needsUpdate = false;
    minFilter = 0;
    magFilter = 0;
  }
  // terrainShader.ts creates a DataTexture at module scope — must be a valid stub.
  class DataTexture {
    dispose = vi.fn();
    needsUpdate = false;
    minFilter = 0;
    magFilter = 0;
    wrapS = 0;
    wrapT = 0;
    constructor(_data?: unknown, _w?: number, _h?: number, _format?: number, _type?: number) {}
  }
  class ShaderMaterial {
    uniforms: Record<string, { value: unknown }> = {};
    constructor(opts: { uniforms?: Record<string, { value: unknown }> } = {}) {
      this.uniforms = opts.uniforms ?? {};
    }
    dispose() {}
  }
  class BufferGeometry {
    attributes: Record<string, unknown> = {};
    setAttribute() { return this; }
    computeVertexNormals() {}
    dispose() {}
  }
  class Vector3 {
    x = 0; y = 0; z = 0;
    set() { return this; }
    copy() { return this; }
  }
  class Vector4 {
    set() { return this; }
  }
  return {
    PlaneGeometry,
    MeshStandardMaterial,
    MeshBasicMaterial: MeshStandardMaterial,
    BufferAttribute,
    Color,
    TextureLoader,
    Texture,
    DataTexture,
    ShaderMaterial,
    BufferGeometry,
    Vector3,
    Vector4,
    DoubleSide: 2,
    FrontSide: 0,
    BackSide: 1,
    ClampToEdgeWrapping: 1001,
    RepeatWrapping: 1000,
    LinearFilter: 1006,
    NearestFilter: 1003,
    RedFormat: 1028,
    RGBAFormat: 1023,
    UnsignedByteType: 1009,
    FloatType: 1015,
    AdditiveBlending: 1,
    NormalBlending: 2,
    SRGBColorSpace: "srgb",
    NoColorSpace: "",
    MathUtils: {
      clamp: (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi),
      degToRad: (d: number) => (d * Math.PI) / 180,
      lerp: (a: number, b: number, t: number) => a + (b - a) * t,
    },
  };
});

vi.mock("@react-three/fiber");

// ---------------------------------------------------------------------------
// Stub out all TourScene component imports that are NOT LandTerrainMesh.
// This prevents transitive module-init side-effects from contaminating the test.
// ---------------------------------------------------------------------------
vi.mock("@/components/TerrainMesh",               () => ({ TerrainMesh: () => null }));
vi.mock("@/components/EfhZoneLayer",              () => ({ EfhZoneLayer: () => null }));
vi.mock("@/components/SubstrateLayer",            () => ({ SubstrateLayer: () => null }));
vi.mock("@/components/IntertidalHotspotsLayer",   () => ({ IntertidalHotspotsLayer: () => null }));
vi.mock("@/components/Hyd93FeaturesLayer",        () => ({ Hyd93FeaturesLayer: () => null }));
vi.mock("@/components/Particles",                 () => ({ Particles: () => null }));
vi.mock("@/components/Caustics",                  () => ({ Caustics: () => null }));
vi.mock("@/components/TidalWaterPlane",           () => ({ TidalWaterPlane: () => null }));
vi.mock("@/components/TidalCurrentArrows",        () => ({ TidalCurrentArrows: () => null }));
vi.mock("@/components/MarkerLayer",               () => ({ MarkerLayer: () => null }));
vi.mock("@/components/TrailLayer",                () => ({ TrailLayer: () => null }));
vi.mock("@/components/DepthPoleLayer",            () => ({ DepthPoleLayer: () => null, DepthPoleDomLabels: () => null }));
vi.mock("@/components/GpsMarker",                 () => ({ GpsMarker: () => null }));
vi.mock("@/components/DepthProfileLine",          () => ({ DepthProfileLine: () => null }));
vi.mock("@/components/WaterSurfacePlane",         () => ({ WaterSurfacePlane: () => null }));
vi.mock("@/components/WaterTempVolumeLayer",      () => ({ WaterTempVolumeLayer: () => null }));
vi.mock("@/components/LandmassMesh",              () => ({ LandmassMesh: () => null }));
vi.mock("@/components/TerrainContourLines",       () => ({ TerrainContourLines: () => null }));
vi.mock("@/components/DriftWaterPlane",           () => ({ DriftWaterPlane: () => null }));
vi.mock("@/components/DriftBoat",                 () => ({ DriftBoat: () => null }));
vi.mock("@/components/DriftPath",                 () => ({ DriftPath: () => null }));
vi.mock("@/components/WindArrow",                 () => ({ WindArrow: () => null }));
vi.mock("@/components/ConditionsOverlays",        () => ({ ConditionsOverlays: () => null }));
vi.mock("@/components/CurrentsLayer",             () => ({ CurrentsLayer: () => null }));
vi.mock("@/components/WebglContextLostOverlay",   () => ({ WebglContextLostOverlay: () => null }));
vi.mock("@/components/ThermalCursorTracker",      () => ({ ThermalCursorTracker: () => null }));

// ---------------------------------------------------------------------------
// Hooks used by sibling TourScene components (not LandTerrainMesh directly,
// but evaluated at module scope via the import chain).
// ---------------------------------------------------------------------------
vi.mock("@/hooks/useFlyControls",        () => ({ useFlyControls: () => {} }));
vi.mock("@/hooks/useGpsFollowCamera",    () => ({ useGpsFollowCamera: () => {} }));
vi.mock("@/hooks/useTemperatureProfile", () => ({ useTemperatureProfile: () => ({ profile: null }) }));
vi.mock("@/hooks/useWaterTempTexture",   () => ({ useWaterTempTexture: () => ({ texture: null }) }));
vi.mock("@/hooks/useTidalData",          () => ({}));
vi.mock("@/lib/waterTemp",               () => ({ sampleTemperatureProfile: vi.fn(() => []) }));
vi.mock("@/lib/testHelpers",             () => ({ registerTestThreeCamera: vi.fn() }));
vi.mock("@/lib/followBoundsCheck",       () => ({ runFollowBoundsCheck: vi.fn() }));

// ---------------------------------------------------------------------------
// Store mocks — landGrid and tileUrl are mutable so tests can drive changes.
// ---------------------------------------------------------------------------
type LandGrid = {
  elevation: number[];
  width: number;
  height: number;
  maxElevation: number;
};

let mockLandGrid: LandGrid | null = null;
let mockTileUrl: string | null = null;
let mockSatelliteImagery = false;

vi.mock("@/lib/landTerrainStore", () => ({
  useLandTerrainStore: (sel: (s: { landGrid: LandGrid | null }) => unknown) =>
    sel({ landGrid: mockLandGrid }),
}));

vi.mock("@/lib/satelliteTileStore", () => ({
  useSatelliteTileStore: (sel: (s: { tileUrl: string | null }) => unknown) =>
    sel({ tileUrl: mockTileUrl }),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: { satelliteImagery: boolean }) => unknown) =>
    sel({ satelliteImagery: mockSatelliteImagery }),
  DEFAULT_SETTINGS: {},
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: null }),
}));

vi.mock("@/hooks/useLandTerrain",  () => ({ useLandTerrain:  () => {} }));
vi.mock("@/hooks/useSatelliteTile", () => ({ useSatelliteTile: () => {} }));

vi.mock("@/lib/terrain", () => ({
  WORLD_SIZE: 100,
  MAX_DEPTH_WORLD: 50,
  INITIAL_CAMERA_POSITION: [0, 0, 0],
  getSeaSurfaceY: vi.fn(() => 0),
  buildWaterSurface: vi.fn(() => ({ visible: true, y: 0 })),
}));

// Remaining stores used by other TourScene parts (not LandTerrainMesh directly).
vi.mock("@/lib/cameraStore",       () => ({ useCameraStore:      (s: (st: Record<string,unknown>) => unknown) => s({}) }));
vi.mock("@/lib/terrainStore",      () => ({ useTerrainStore:     (s: (st: Record<string,unknown>) => unknown) => s({ visibleDatasets: [], primaryDatasetId: null }) }));
vi.mock("@/lib/gpsStore",          () => ({ useGpsStore:         { subscribe: vi.fn(() => vi.fn()) } }));
vi.mock("@/lib/driftStore",        () => ({ useDriftStore:       (s: (st: Record<string,unknown>) => unknown) => s({}) }));
vi.mock("@/lib/currentsStore",     () => ({ useCurrentsStore:    (s: (st: Record<string,unknown>) => unknown) => s({}) }));
vi.mock("@/lib/webglContextStore", () => ({ useWebglContextStore:(s: (st: Record<string,unknown>) => unknown) => s({ contextLost: false, floatTextureLinear: true }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetDatasetsIdTerrain: vi.fn(() => ({ data: null })),
  getGetDatasetsIdTerrainQueryKey: vi.fn(() => []),
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks are hoisted.
// ---------------------------------------------------------------------------
import { LandTerrainMesh } from "../TourScene";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeGrid(seed = 0): LandGrid {
  return {
    elevation: Array.from({ length: 4 }, (_, i) => (i + seed + 1) * 10),
    width: 2,
    height: 2,
    maxElevation: 100,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockGeoInstances.length = 0;
  mockMatInstances.length = 0;
  mockTextureLoaderLoad = vi.fn();
  mockLandGrid = null;
  mockTileUrl = null;
  mockSatelliteImagery = false;
});

// ---------------------------------------------------------------------------
// Bug A — geometry disposed when landGrid changes
// ---------------------------------------------------------------------------
describe("LandTerrainMesh — Bug A: geometry disposal on landGrid change", () => {
  it("disposes the old PlaneGeometry exactly once when landGrid changes", async () => {
    mockLandGrid = makeGrid(0);
    const { rerender } = render(<LandTerrainMesh />);

    // First render — one geometry created.
    expect(mockGeoInstances).toHaveLength(1);
    const firstGeo = mockGeoInstances[0]!;
    expect(firstGeo.dispose).not.toHaveBeenCalled();

    // Switch to a new landGrid — should dispose the first geometry exactly once.
    await act(async () => {
      mockLandGrid = makeGrid(1);
      rerender(<LandTerrainMesh />);
    });

    expect(mockGeoInstances).toHaveLength(2);
    expect(firstGeo.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes geometry on unmount", async () => {
    mockLandGrid = makeGrid(0);
    const { unmount } = render(<LandTerrainMesh />);

    const geo = mockGeoInstances[0]!;
    await act(async () => { unmount(); });
    expect(geo.dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Bug B — proceduralMaterial disposed when landGrid changes
// ---------------------------------------------------------------------------
describe("LandTerrainMesh — Bug B: proceduralMaterial disposal on landGrid change", () => {
  it("disposes the old MeshStandardMaterial when landGrid changes", async () => {
    mockLandGrid = makeGrid(0);
    const { rerender } = render(<LandTerrainMesh />);

    // Procedural material: vertexColors=true, no map
    const firstMat = mockMatInstances.find((m) => !m.map)!;
    expect(firstMat).toBeDefined();
    expect(firstMat.dispose).not.toHaveBeenCalled();

    await act(async () => {
      mockLandGrid = makeGrid(1);
      rerender(<LandTerrainMesh />);
    });

    expect(firstMat.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes proceduralMaterial on unmount", async () => {
    mockLandGrid = makeGrid(0);
    const { unmount } = render(<LandTerrainMesh />);

    const mat = mockMatInstances.find((m) => !m.map)!;
    expect(mat).toBeDefined();

    await act(async () => { unmount(); });
    expect(mat.dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Bug C — satellite texture disposed on unmount via ref (not stale closure)
// ---------------------------------------------------------------------------
describe("LandTerrainMesh — Bug C: satellite texture disposed on unmount via ref", () => {
  it("disposes a texture that loaded AFTER mount when the component unmounts", async () => {
    mockLandGrid = makeGrid(0);
    mockTileUrl = "blob:fake-tile-url";
    mockSatelliteImagery = true;

    const { unmount } = render(<LandTerrainMesh />);

    // Deliver a fake texture via the TextureLoader callback so the satellite
    // material branch (satelliteImagery && satelliteTexture) is reached.
    const loadArgs = mockTextureLoaderLoad.mock.calls[0];
    const onLoad = loadArgs?.[1] as
      | ((tex: { dispose: ReturnType<typeof vi.fn>; flipY: boolean; needsUpdate: boolean }) => void)
      | undefined;
    expect(onLoad).toBeDefined();

    const fakeTexture = { dispose: vi.fn(), flipY: false, needsUpdate: false };
    await act(async () => { onLoad!(fakeTexture); });

    // Texture is live; must NOT have been disposed yet.
    expect(fakeTexture.dispose).not.toHaveBeenCalled();

    // Unmount — the ref-based cleanup must dispose the live texture, not the
    // mount-time null that the old empty-closure captured (Bug C).
    await act(async () => { unmount(); });
    expect(fakeTexture.dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Bug D — satellite-textured MeshStandardMaterial disposed on unmount
// ---------------------------------------------------------------------------
describe("LandTerrainMesh — Bug D: satellite material disposed on unmount", () => {
  it("disposes the satellite MeshStandardMaterial when unmounting with satellite imagery active", async () => {
    mockLandGrid = makeGrid(0);
    mockTileUrl = "blob:fake-tile-url";
    mockSatelliteImagery = true;

    const { unmount } = render(<LandTerrainMesh />);

    // Deliver a fake texture via the TextureLoader callback so the satellite
    // material branch (satelliteImagery && satelliteTexture) is reached.
    const loadArgs = mockTextureLoaderLoad.mock.calls[0];
    const onLoad = loadArgs?.[1] as
      | ((tex: { dispose: ReturnType<typeof vi.fn>; flipY: boolean; needsUpdate: boolean }) => void)
      | undefined;
    expect(onLoad).toBeDefined();

    const fakeTexture = { dispose: vi.fn(), flipY: false, needsUpdate: false };
    await act(async () => { onLoad!(fakeTexture); });

    // After the texture loads the component creates a satellite MeshStandardMaterial
    // (map !== undefined/null). Find it in the tracked instances.
    const satelliteMat = mockMatInstances.find((m) => m.map != null);
    expect(satelliteMat).toBeDefined();
    expect(satelliteMat!.dispose).not.toHaveBeenCalled();

    // Unmount — the ref-based unmount cleanup must dispose the satellite
    // material (Bug D fix).
    await act(async () => { unmount(); });
    expect(satelliteMat!.dispose).toHaveBeenCalledTimes(1);
  });

  it("does NOT dispose the procedural material on unmount via the satellite-material cleanup path", async () => {
    // When satellite imagery is off, the active material is the procedural one
    // (no .map). The satellite-material unmount cleanup must not dispose it —
    // that is owned by prevProceduralMaterialRef (Bug B).
    mockLandGrid = makeGrid(0);
    mockSatelliteImagery = false;

    const { unmount } = render(<LandTerrainMesh />);

    const proceduralMat = mockMatInstances.find((m) => !m.map);
    expect(proceduralMat).toBeDefined();

    await act(async () => { unmount(); });

    // Bug B cleanup disposes it once; the Bug D path must NOT add a second call.
    expect(proceduralMat!.dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Net budget — zero GPU leak across 5 consecutive landGrid switches
//
// Each switch must dispose the previous PlaneGeometry and proceduralMaterial
// exactly once, so the number of live (not yet disposed) instances never
// exceeds 1 at any point.  This is the render-side regression guard for
// LandTerrainMesh that mirrors the TerrainMesh budget test: it will fail if
// a future change re-introduces Bug A (geometry leak) or Bug B (material
// leak) without being caught by the existing per-bug tests above.
// ---------------------------------------------------------------------------
describe("LandTerrainMesh — net GPU budget: zero geometry/material leak across 5 landGrid switches", () => {
  it("disposes every superseded PlaneGeometry exactly once; exactly 1 live at all times", async () => {
    mockLandGrid = makeGrid(0);
    const { rerender } = render(<LandTerrainMesh />);

    expect(mockGeoInstances).toHaveLength(1);

    for (let i = 1; i <= 5; i++) {
      await act(async () => {
        mockLandGrid = makeGrid(i);
        rerender(<LandTerrainMesh />);
      });

      // Every geometry created before the current one must be disposed.
      for (let j = 0; j < i; j++) {
        expect(mockGeoInstances[j]!.dispose).toHaveBeenCalledTimes(1);
      }
      // Current geometry must NOT be disposed yet.
      expect(mockGeoInstances[i]!.dispose).not.toHaveBeenCalled();

      // Invariant: exactly one PlaneGeometry is live at all times.
      const liveCount = mockGeoInstances.filter((g) => g.dispose.mock.calls.length === 0).length;
      expect(liveCount).toBe(1);
    }
  });

  it("disposes every superseded proceduralMaterial exactly once; exactly 1 live at all times", async () => {
    mockLandGrid = makeGrid(0);
    const { rerender } = render(<LandTerrainMesh />);

    // Procedural materials have vertexColors=true and no .map property.
    const proceduralMats = () => mockMatInstances.filter((m) => !m.map);

    expect(proceduralMats()).toHaveLength(1);

    for (let i = 1; i <= 5; i++) {
      await act(async () => {
        mockLandGrid = makeGrid(i);
        rerender(<LandTerrainMesh />);
      });

      const mats = proceduralMats();
      // Every material created before the current one must be disposed.
      for (let j = 0; j < i; j++) {
        expect(mats[j]!.dispose).toHaveBeenCalledTimes(1);
      }
      // Current material must NOT be disposed yet.
      expect(mats[i]!.dispose).not.toHaveBeenCalled();

      // Invariant: exactly one proceduralMaterial is live at all times.
      const liveCount = mats.filter((m) => m.dispose.mock.calls.length === 0).length;
      expect(liveCount).toBe(1);
    }
  });

  it("after unmount following 5 switches, no geometry or material instance is left live", async () => {
    mockLandGrid = makeGrid(0);
    const { rerender, unmount } = render(<LandTerrainMesh />);

    for (let i = 1; i <= 5; i++) {
      await act(async () => {
        mockLandGrid = makeGrid(i);
        rerender(<LandTerrainMesh />);
      });
    }

    await act(async () => { unmount(); });

    // Every PlaneGeometry must be disposed exactly once.
    for (const geo of mockGeoInstances) {
      expect(geo.dispose).toHaveBeenCalledTimes(1);
    }
    // Every proceduralMaterial (no .map) must be disposed exactly once.
    for (const mat of mockMatInstances.filter((m) => !m.map)) {
      expect(mat.dispose).toHaveBeenCalledTimes(1);
    }
  });
});
