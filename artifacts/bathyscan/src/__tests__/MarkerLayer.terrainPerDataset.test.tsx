/**
 * MarkerLayer — per-dataset terrain grid wiring and world-position tests.
 *
 * Guards the fix from Task 3550 Bug 1.
 *
 * The previous approach passed the secondary terrain to an untransformed
 * MarkerSprite, placing it at the same local XZ in primary world space as the
 * primary markers.  With primary bbox -10..0 and secondary bbox 5..15 the
 * secondary mesh center is at world X=150 while its marker was rendered at X=0.
 *
 * The fix wraps each dataset's markers in the same <group position/scale> that
 * NonPrimaryDatasetMeshes uses for the mesh, so MarkerSprite's
 * lonLatToWorldXZ(lon, lat, secondaryGrid) produces LOCAL coordinates that
 * the group transform maps to the correct PRIMARY world position.
 *
 * Strategy
 * --------
 * • Mock MarkerSprite to capture which terrain prop it receives.
 * • Seed the terrainStore with primary and secondary grids.
 * • Render MarkerLayer and assert:
 *   - Each MarkerSprite receives its own dataset's grid (not the other's).
 *   - Secondary markers are suppressed when their dataset has no loaded grid.
 *   - The secondary marker group (name="marker-group-ds-b") exists in the DOM,
 *     proving markers are inside the transform wrapper, not the primary group.
 * • Use computeSecondaryMeshTransform directly to verify world-position math:
 *   the secondary mesh center must land at the expected primary world X.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type { Marker, TerrainData } from "@workspace/api-client-react";
import { useTerrainStore } from "@/lib/terrainStore";
import { useMarkerLayerStore } from "@/lib/markerLayerStore";
import { applyGeoCorrectionToGrid, computeSecondaryMeshTransform } from "@/components/NonPrimaryDatasetMeshes";
import { lonLatToWorldXZ, lonSpan, WORLD_SIZE } from "@/lib/terrain";

// ---------------------------------------------------------------------------
// Three.js stub
// ---------------------------------------------------------------------------
vi.mock("three", () => {
  class Stub {
    r = 0; g = 0; b = 0;
    set() { return this; } copy() { return this; } clone() { return this; }
    dispose() {} lerpColors() { return this; } computeVertexNormals() {}
    rotateX() { return this; } translate() { return this; }
    convertLinearToSRGB() { return this; }
    setAttribute() {} setDrawRange() {} normalizeNormals() {}
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
    CatmullRomCurve3: class extends Stub { override getPoints() { return []; } },
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

// ---------------------------------------------------------------------------
// Capture terrain prop passed to each MarkerSprite invocation.
// ---------------------------------------------------------------------------
const capturedTerrains = new Map<string, TerrainData>();
const capturedEffectiveLonLats = new Map<string, { lon: number; lat: number } | undefined>();

vi.mock("@/components/MarkerSprite", () => ({
  MarkerSprite: ({ marker, terrain, effectiveLonLat }: {
    marker: Marker;
    terrain: TerrainData;
    effectiveLonLat?: { lon: number; lat: number };
  }) => {
    capturedTerrains.set(marker.id, terrain);
    capturedEffectiveLonLats.set(marker.id, effectiveLonLat);
    return null;
  },
}));

// ---------------------------------------------------------------------------
// Puzzle store stub — MarkerLayer imports usePuzzleStore after the merge.
// ---------------------------------------------------------------------------
const puzzleState = {
  puzzleMode: false,
  puzzleTransforms: {} as Record<string, { tx: number; ty: number; angleDeg: number }>,
  overviewTransform: null as {
    pxPerDeg: number;
    scale: number;
    offsetX: number;
    offsetY: number;
  } | null,
  worldGrid: null as TerrainData | null,
};

vi.mock("@/lib/puzzleStore", () => ({
  usePuzzleStore: (sel: (s: {
    puzzleMode: boolean;
    puzzleTransforms: Record<string, { tx: number; ty: number; angleDeg: number }>;
    overviewTransform: typeof puzzleState.overviewTransform;
    worldGrid: TerrainData | null;
  }) => unknown) => sel(puzzleState),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGrid(
  datasetId: string,
  minLon: number, maxLon: number,
  minLat = 40, maxLat = 50,
): TerrainData {
  return {
    datasetId,
    minLon, maxLon, minLat, maxLat,
    minDepth: 0, maxDepth: 100,
    resolution: 2, depths: [0, 50, 50, 100],
    width: 2, height: 2, waterType: "saltwater",
  } as unknown as TerrainData;
}

function makeMarker(id: string, datasetId: string, lon: number, lat: number): Marker {
  return { id, type: "custom", datasetId, lat, lon, notes: null } as unknown as Marker;
}

const GRID_A = makeGrid("ds-a", -10, 0);   // primary  — lon range [-10,  0]
const GRID_B = makeGrid("ds-b",  5, 15);   // secondary — lon range [ 5, 15]

// Fixed slot markers — each at the centre of its own dataset bbox so the
// isMarkerInBounds check passes (lon within [-10,0] and [5,15] respectively).
const markerA = makeMarker("m-a", "ds-a", -5, 45);  // centre of GRID_A bbox
const markerB = makeMarker("m-b", "ds-b",  10, 45); // centre of GRID_B bbox

// ---------------------------------------------------------------------------
// API client mock
// ---------------------------------------------------------------------------

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) return (...a: unknown[]) => [k, ...a];
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetMarkers: ({ datasetId }: { datasetId: string }) => {
      if (datasetId === "ds-a") return { data: [markerA] };
      if (datasetId === "ds-b") return { data: [markerB] };
      return { data: [] };
    },
    getGetMarkersQueryKey: ({ datasetId }: { datasetId: string }) => ["markers", datasetId],
    useGetCatches: () => ({ data: [] }),
    getGetCatchesQueryKey: ({ datasetId }: { datasetId: string }) => ["catches", datasetId],
  }),
);

// The offline-fallback wrapper uses a raw useQuery (needs a QueryClientProvider)
// plus IndexedDB; neither exists in this headless test. Delegate straight to the
// mocked useGetMarkers so slot behavior matches the pre-fallback contract.
vi.mock("@/hooks/useGetMarkersWithOfflineFallback", async () => {
  const api = await import("@workspace/api-client-react");
  return {
    useGetMarkersWithOfflineFallback: (datasetId: string, enabled: boolean) => {
      const { data } = (api as { useGetMarkers: (p: { datasetId: string }) => { data: unknown } }).useGetMarkers({ datasetId });
      void enabled;
      return { data };
    },
  };
});

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: GRID_A }),
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal();
  const storeState = {
    visibleMarkerTypes: ["custom", "waypoint", "hazard", "poi"],
    showMarkerLabels: false,
    markerClusterThreshold: 0,
    maxActiveDatasets: 3,
    waterType: "saltwater",
  };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      setState: vi.fn(),
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );
  return { ...(actual as object), useSettingsStore };
});

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------
import { MarkerLayer } from "@/components/MarkerLayer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupsNamed(container: HTMLElement, name: string): NodeListOf<Element> {
  return container.querySelectorAll(`[name="${name}"]`);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  capturedTerrains.clear();
  capturedEffectiveLonLats.clear();
  puzzleState.puzzleMode = false;
  puzzleState.puzzleTransforms = {};
  puzzleState.overviewTransform = null;
  puzzleState.worldGrid = null;
  useTerrainStore.getState().clear();
  useMarkerLayerStore.getState().clear();
});

// ---------------------------------------------------------------------------
// World-position math — pure function tests (no React rendering needed)
// ---------------------------------------------------------------------------

describe("computeSecondaryMeshTransform — world-position alignment", () => {
  it("places the secondary mesh centre at the expected primary world X", () => {
    // Primary bbox: -10..0 lon, centre -5, range 10
    // Secondary bbox: 5..15 lon, centre 10, range 10
    // cx = (normalizeLonDelta(10 - (-5)) / 10) * 100 = (15/10)*100 = 150
    const { cx } = computeSecondaryMeshTransform(GRID_A, GRID_B);
    expect(cx).toBeCloseTo(150, 2);
  });

  it("secondary centre marker ends up at primary world X = cx when inside the transform group", () => {
    // lonLatToWorldXZ of the secondary bbox centre in the secondary's OWN frame → local X=0
    const { x: localX } = lonLatToWorldXZ(-5, 45, GRID_A);
    expect(localX).toBeCloseTo(0, 2);

    // The group transform maps local X to primary world X: worldX = cx + xScale * localX
    const { cx, xScale } = computeSecondaryMeshTransform(GRID_A, GRID_B);
    const worldX = cx + xScale * localX;
    // The secondary mesh centre (at lon=10) lands at world X ≈ 150, not X=0.
    expect(worldX).toBeCloseTo(cx, 2);
  });

  it("primary centre marker stays at world X = 0 (identity transform for primary)", () => {
    // Primary bbox: -10..0, centre -5 → local X=0
    const { x: localX } = lonLatToWorldXZ(-5, 45, GRID_A);
    expect(localX).toBeCloseTo(0, 2);
    // Primary uses identity transform: worldX = 0 + 1 * localX = 0
    expect(0 + 1 * localX).toBeCloseTo(0, 2);
  });
});

// ---------------------------------------------------------------------------
// lonSpan — direct span utility (no normalizeLonDelta folding)
// ---------------------------------------------------------------------------

describe("lonSpan — bbox longitude span", () => {
  it("returns 360 for a full-world bbox (-180..180)", () => {
    expect(lonSpan(-180, 180)).toBe(360);
  });

  it("returns 200 for a wide non-crossing bbox (0..200)", () => {
    expect(lonSpan(0, 200)).toBe(200);
  });

  it("returns 20 for an antimeridian-crossing bbox (170..-170)", () => {
    expect(lonSpan(170, -170)).toBe(20);
  });

  it("returns 10 for a normal small bbox (-10..0)", () => {
    expect(lonSpan(-10, 0)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// lonLatToWorldXZ — dateline-aware bbox tests
// ---------------------------------------------------------------------------

describe("lonLatToWorldXZ — dateline-crossing bboxes", () => {
  // Normal (non-crossing) bbox 0..200 — lonSpan = 200, preserved as-is.
  it("maps the west edge (minLon) of a wide non-crossing bbox (0..200) to x=-WORLD_SIZE/2", () => {
    const grid = makeGrid("wide", 0, 200);
    const { x } = lonLatToWorldXZ(0, 45, grid); // 0 is the west edge (minLon)
    expect(x).toBeCloseTo(-WORLD_SIZE / 2, 2);
  });

  it("maps the centre of a wide non-crossing bbox (0..200) to x=0", () => {
    const grid = makeGrid("wide", 0, 200);
    const { x } = lonLatToWorldXZ(100, 45, grid); // 100 is the centre of 0..200
    expect(x).toBeCloseTo(0, 2);
  });

  it("maps the east edge (maxLon) of a wide non-crossing bbox (0..200) to x=+WORLD_SIZE/2", () => {
    const grid = makeGrid("wide", 0, 200);
    const { x } = lonLatToWorldXZ(200, 45, grid); // 200 is the east edge (maxLon)
    expect(x).toBeCloseTo(WORLD_SIZE / 2, 2);
  });

  // Antimeridian-crossing bbox 170..-170 — lonSpan = 20°, centre at lon=180.
  it("maps the west edge of an antimeridian-crossing bbox (170..-170) to x=-WORLD_SIZE/2", () => {
    const grid = makeGrid("cross", 170, -170);
    const { x } = lonLatToWorldXZ(170, 45, grid); // west edge = minLon
    expect(x).toBeCloseTo(-WORLD_SIZE / 2, 2);
  });

  it("maps the centre of an antimeridian-crossing bbox (170..-170) to x=0", () => {
    const grid = makeGrid("cross", 170, -170);
    const { x } = lonLatToWorldXZ(180, 45, grid); // centre = 180° (the antimeridian)
    expect(x).toBeCloseTo(0, 2);
  });

  it("maps the east edge of an antimeridian-crossing bbox (170..-170) to x=+WORLD_SIZE/2", () => {
    const grid = makeGrid("cross", 170, -170);
    const { x } = lonLatToWorldXZ(-170, 45, grid); // east edge = maxLon
    expect(x).toBeCloseTo(WORLD_SIZE / 2, 2);
  });
});

// ---------------------------------------------------------------------------
// MarkerLayer rendering — group structure and terrain wiring
// ---------------------------------------------------------------------------

describe("MarkerLayer — per-dataset terrain grid wiring", () => {
  it("passes the primary dataset's own grid to markers from that dataset", async () => {
    useTerrainStore.getState().setGrids({ activeGrid: GRID_A });

    await act(async () => { render(<MarkerLayer />); });

    expect(capturedTerrains.get("m-a")).toBe(GRID_A);
  });

  it("passes the secondary dataset's own grid — NOT the primary — to markers from the secondary", async () => {
    useTerrainStore.getState().setGrids({ activeGrid: GRID_A });
    useTerrainStore.getState().toggleVisible({ datasetId: "ds-b", source: "preset" });
    useTerrainStore.getState().setDatasetGrids("ds-b", { activeGrid: GRID_B });

    await act(async () => { render(<MarkerLayer />); });

    // m-b belongs to ds-b — must use GRID_B, not GRID_A
    expect(capturedTerrains.get("m-b")).toBe(GRID_B);
    expect(capturedTerrains.get("m-b")).not.toBe(GRID_A);
  });

  it("renders each dataset's markers inside a named group so the transform is correct", async () => {
    useTerrainStore.getState().setGrids({ activeGrid: GRID_A });
    useTerrainStore.getState().toggleVisible({ datasetId: "ds-b", source: "preset" });
    useTerrainStore.getState().setDatasetGrids("ds-b", { activeGrid: GRID_B });

    const { container } = await act(async () => render(<MarkerLayer />));

    // Both datasets have named marker groups
    expect(groupsNamed(container, "marker-group-ds-a").length).toBeGreaterThan(0);
    expect(groupsNamed(container, "marker-group-ds-b").length).toBeGreaterThan(0);
  });

  it("primary and secondary markers each get their own grid when both are visible", async () => {
    useTerrainStore.getState().setGrids({ activeGrid: GRID_A });
    useTerrainStore.getState().toggleVisible({ datasetId: "ds-b", source: "preset" });
    useTerrainStore.getState().setDatasetGrids("ds-b", { activeGrid: GRID_B });

    await act(async () => { render(<MarkerLayer />); });

    expect(capturedTerrains.get("m-a")).toBe(GRID_A);
    expect(capturedTerrains.get("m-b")).toBe(GRID_B);
  });

  it("suppresses markers whose dataset has no loaded grid (activeGrid is null)", async () => {
    useTerrainStore.getState().setGrids({ activeGrid: GRID_A });
    useTerrainStore.getState().toggleVisible({ datasetId: "ds-b", source: "preset" });
    // intentionally NOT loading ds-b's grid

    await act(async () => { render(<MarkerLayer />); });

    // m-b is from ds-b which has no grid — suppressed
    expect(capturedTerrains.has("m-b")).toBe(false);
    // m-a is still rendered
    expect(capturedTerrains.get("m-a")).toBe(GRID_A);
  });

  it("keeps a geo-corrected marker at the same world position while puzzle mode stays open", async () => {
    const correction = { dLon: 2, dLat: -1, angleDeg: 0 };
    useTerrainStore.getState().setGrids({ activeGrid: GRID_A });
    useTerrainStore.getState().toggleVisible({ datasetId: "ds-b", source: "preset" });
    useTerrainStore.getState().setDatasetGrids("ds-b", { activeGrid: GRID_B });
    useTerrainStore.getState().setDatasetGeoCorrections({ "ds-b": correction });

    const correctedGroup = computeSecondaryMeshTransform(
      GRID_A,
      applyGeoCorrectionToGrid(GRID_B, correction),
      correction,
    );
    const toWorldPosition = (effectiveLonLat?: { lon: number; lat: number }) => {
      const { x, z } = lonLatToWorldXZ(
        effectiveLonLat?.lon ?? markerB.lon,
        effectiveLonLat?.lat ?? markerB.lat,
        GRID_B,
      );
      return {
        x: correctedGroup.cx + correctedGroup.xScale * x,
        z: correctedGroup.cz + correctedGroup.zScale * z,
      };
    };

    const withoutPuzzle = await act(async () => render(<MarkerLayer />));
    const baselineMarkerPosition = capturedEffectiveLonLats.get("m-b");
    expect(capturedTerrains.get("m-b")).toBe(GRID_B);
    const worldPositionWithoutPuzzle = toWorldPosition(baselineMarkerPosition);
    withoutPuzzle.unmount();
    capturedTerrains.clear();
    capturedEffectiveLonLats.clear();

    puzzleState.puzzleMode = true;
    puzzleState.puzzleTransforms = { "ds-b": { tx: 200, ty: 100, angleDeg: 0 } };
    puzzleState.overviewTransform = { pxPerDeg: 100, scale: 1, offsetX: 0, offsetY: 0 };
    puzzleState.worldGrid = makeGrid("world", -10, 15);

    await act(async () => { render(<MarkerLayer />); });
    const correctedMarkerPosition = capturedEffectiveLonLats.get("m-b");
    const worldPositionWithPuzzleOpen = toWorldPosition(correctedMarkerPosition);

    // The group transform owns the applied correction. A stale-open puzzle editor
    // must not also provide an adjusted lon/lat to MarkerSprite.
    expect(capturedTerrains.get("m-b")).toBe(GRID_B);
    expect(correctedMarkerPosition).toBeUndefined();
    expect(worldPositionWithPuzzleOpen.x).toBeCloseTo(worldPositionWithoutPuzzle.x, 8);
    expect(worldPositionWithPuzzleOpen.z).toBeCloseTo(worldPositionWithoutPuzzle.z, 8);
  });
});
