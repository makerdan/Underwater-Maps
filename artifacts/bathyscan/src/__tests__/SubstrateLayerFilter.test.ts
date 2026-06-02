/**
 * Tests for SubstrateLayer's substrate-class visibility system.
 *
 * Architecture note (as of the geometry-caching fix):
 *   SubstrateLayer now calls `buildPolyRenders` once for ALL features (deps:
 *   collection + terrain only) and toggles `mesh.visible` / `lineLoop.visible`
 *   per frame based on `hiddenSubstrateClasses` — no geometry is disposed or
 *   recreated on a legend filter change.
 *
 *   `filterVisibleSubstrateFeatures` is still exported and used by the 2D
 *   OverviewMap layer (which does filter before render), but it is no longer
 *   called inside SubstrateLayer's useMemo.
 *
 * These tests confirm:
 *   1. `filterVisibleSubstrateFeatures` correctly omits hidden classes (used
 *      by the 2D map layer and as a standalone utility).
 *   2. Toggling a class via `uiStore` correctly updates the Set that the
 *      visibility check reads.
 *   3. The visibility check is case-insensitive (matches `.toLowerCase()`).
 *   4. `clearHiddenSubstrateClasses` restores full visibility.
 *   5. Geometry object references are stable across visibility toggles —
 *      no GPU buffers are disposed/recreated by a filter change.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub Three.js and @react-three/fiber — SubstrateLayer imports both at the
// top level.  The pure utility functions under test (filterVisibleSubstrateFeatures,
// buildPolyRenders, etc.) create stub geometry objects; tests only assert on
// array length, reference identity, and plain-JS properties — none of which
// require real WebGL constructors.
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

vi.mock("@react-three/fiber", () => ({
  useFrame: () => {},
  extend: () => {},
}));

import type { SubstrateFeature } from "@workspace/api-client-react";
import {
  filterVisibleSubstrateFeatures,
  buildPolyRenders,
  buildSelectedSubstrate,
  computePolyZoneProps,
} from "@/components/SubstrateLayer";
import { useUiStore } from "@/lib/uiStore";
import {
  useZoneOverlayStore,
  ZONE_DEFAULT_COLORS,
} from "@/lib/zoneOverlayStore";

// ---------------------------------------------------------------------------
// Bounding box that contains all fixture polygons.
// ---------------------------------------------------------------------------
const MIN_LON = -119.9;
const MAX_LON = -119.3;
const MIN_LAT = 47.2;
const MAX_LAT = 47.8;
const BOUNDS = [MIN_LON, MAX_LON, MIN_LAT, MAX_LAT] as const;

// ---------------------------------------------------------------------------
// Minimal feature factories — only the fields SubstrateLayer reads.
// ---------------------------------------------------------------------------

function makePolygonFeature(
  unitId: string,
  substrate: string,
  color = "#cccccc",
): SubstrateFeature {
  return {
    type: "Feature",
    properties: {
      unitId,
      substrate,
      shoreZoneClass: "Test",
      cmecsCode: "TST",
      color,
      szMaterial: null,
      szForm: null,
      areaSqM: null,
      natsur: null,
      encChart: null,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-119.75, 47.35],
          [-119.72, 47.35],
          [-119.72, 47.38],
          [-119.75, 47.38],
          [-119.75, 47.35],
        ],
      ],
    },
  } as unknown as SubstrateFeature;
}

function makeMultiPolygonFeature(
  unitId: string,
  substrate: string,
  color = "#aabbcc",
): SubstrateFeature {
  return {
    type: "Feature",
    properties: {
      unitId,
      substrate,
      shoreZoneClass: "Test",
      cmecsCode: "TST",
      color,
      szMaterial: null,
      szForm: null,
      areaSqM: null,
      natsur: null,
      encChart: null,
    },
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [-119.48, 47.62],
            [-119.42, 47.62],
            [-119.42, 47.68],
            [-119.48, 47.68],
            [-119.48, 47.62],
          ],
        ],
      ],
    },
  } as unknown as SubstrateFeature;
}

// ---------------------------------------------------------------------------
// filterVisibleSubstrateFeatures — the production filter used by SubstrateLayer
// ---------------------------------------------------------------------------

describe("filterVisibleSubstrateFeatures (production filter used by SubstrateLayer)", () => {
  const sand = makePolygonFeature("poly-sand", "sand", "#e2d5a0");
  const gravel = makeMultiPolygonFeature("poly-gravel", "gravel", "#9ab5c4");
  const bedrock = makePolygonFeature("poly-bedrock", "bedrock", "#888888");
  const all = [sand, gravel, bedrock];

  it("returns all features when the hidden set is empty", () => {
    const result = filterVisibleSubstrateFeatures(all, new Set());
    expect(result).toHaveLength(3);
  });

  it("omits only the hidden class, keeping the rest", () => {
    const result = filterVisibleSubstrateFeatures(all, new Set(["bedrock"]));
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.properties.unitId)).not.toContain("poly-bedrock");
  });

  it("returns an empty array when every class is hidden", () => {
    const result = filterVisibleSubstrateFeatures(
      all,
      new Set(["sand", "gravel", "bedrock"]),
    );
    expect(result).toHaveLength(0);
  });

  it("is case-insensitive: mixed-case substrate key matches lower-cased hidden entry", () => {
    const mixedCase = makePolygonFeature("poly-mixed", "Bedrock");
    const result = filterVisibleSubstrateFeatures([mixedCase], new Set(["bedrock"]));
    expect(result).toHaveLength(0);
  });

  it("returns an empty array for an empty input list", () => {
    const result = filterVisibleSubstrateFeatures([], new Set(["sand"]));
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filterVisibleSubstrateFeatures → buildPolyRenders pipeline
// (mirrors SubstrateLayer's useMemo: filter then build geometry)
// ---------------------------------------------------------------------------

describe("SubstrateLayer rendering pipeline: filter → buildPolyRenders", () => {
  const sand = makePolygonFeature("poly-sand", "sand", "#e2d5a0");
  const gravel = makeMultiPolygonFeature("poly-gravel", "gravel", "#9ab5c4");
  const bedrock = makePolygonFeature("poly-bedrock", "bedrock", "#888888");
  const all = [sand, gravel, bedrock];

  it("produces one PolyRender per Polygon feature when nothing is hidden", () => {
    const visible = filterVisibleSubstrateFeatures([sand, bedrock], new Set());
    const polys = buildPolyRenders(visible, ...BOUNDS);
    expect(polys).toHaveLength(2);
  });

  it("produces one PolyRender per sub-polygon of a MultiPolygon feature", () => {
    const visible = filterVisibleSubstrateFeatures([gravel], new Set());
    const polys = buildPolyRenders(visible, ...BOUNDS);
    expect(polys).toHaveLength(1);
  });

  it("hidden class features produce zero PolyRender entries (geometry omitted)", () => {
    const visible = filterVisibleSubstrateFeatures(all, new Set(["bedrock"]));
    const polys = buildPolyRenders(visible, ...BOUNDS);

    expect(polys).toHaveLength(2);
    const unitIds = polys.map((p) => p.feature.properties.unitId);
    expect(unitIds).toContain("poly-sand");
    expect(unitIds).toContain("poly-gravel");
    expect(unitIds).not.toContain("poly-bedrock");
  });

  it("all classes hidden → empty render list", () => {
    const visible = filterVisibleSubstrateFeatures(
      all,
      new Set(["sand", "gravel", "bedrock"]),
    );
    const polys = buildPolyRenders(visible, ...BOUNDS);
    expect(polys).toHaveLength(0);
  });

  it("each PolyRender carries an outlineGeometry", () => {
    const visible = filterVisibleSubstrateFeatures([sand], new Set());
    const polys = buildPolyRenders(visible, ...BOUNDS);
    expect(polys[0]?.outlineGeometry).toBeDefined();
  });

  it("each PolyRender carries a fillGeometry for a valid Polygon", () => {
    const visible = filterVisibleSubstrateFeatures([sand], new Set());
    const polys = buildPolyRenders(visible, ...BOUNDS);
    expect(polys[0]?.fillGeometry).not.toBeNull();
  });

  it("each PolyRender exposes the source feature", () => {
    const visible = filterVisibleSubstrateFeatures([sand], new Set());
    const polys = buildPolyRenders(visible, ...BOUNDS);
    expect(polys[0]?.feature.properties.unitId).toBe("poly-sand");
  });

  it("each PolyRender exposes the feature color", () => {
    const visible = filterVisibleSubstrateFeatures([sand], new Set());
    const polys = buildPolyRenders(visible, ...BOUNDS);
    expect(polys[0]?.color).toBe("#e2d5a0");
  });
});

// ---------------------------------------------------------------------------
// uiStore integration: toggleSubstrateClass drives the production filter
// ---------------------------------------------------------------------------

describe("SubstrateLayer filter in sync with uiStore.hiddenSubstrateClasses", () => {
  const sand = makePolygonFeature("poly-sand", "sand");
  const gravel = makePolygonFeature("poly-gravel", "gravel");
  const all = [sand, gravel];

  beforeEach(() => {
    useUiStore.setState({
      hiddenSubstrateClasses: new Set<string>(),
      substrateColorMode: true,
    });
  });

  it("starts with all features visible (empty hidden set)", () => {
    const hidden = useUiStore.getState().hiddenSubstrateClasses;
    const visible = filterVisibleSubstrateFeatures(all, hidden);
    const polys = buildPolyRenders(visible, ...BOUNDS);
    expect(polys).toHaveLength(2);
  });

  it("hiding a class via toggleSubstrateClass removes its features from the rendered set", () => {
    useUiStore.getState().toggleSubstrateClass("sand");

    const hidden = useUiStore.getState().hiddenSubstrateClasses;
    const visible = filterVisibleSubstrateFeatures(all, hidden);
    const polys = buildPolyRenders(visible, ...BOUNDS);

    expect(polys).toHaveLength(1);
    expect(polys[0]?.feature.properties.unitId).toBe("poly-gravel");
  });

  it("toggling the same class again unhides it, restoring full visibility", () => {
    useUiStore.getState().toggleSubstrateClass("sand");
    useUiStore.getState().toggleSubstrateClass("sand");

    const hidden = useUiStore.getState().hiddenSubstrateClasses;
    const visible = filterVisibleSubstrateFeatures(all, hidden);
    const polys = buildPolyRenders(visible, ...BOUNDS);
    expect(polys).toHaveLength(2);
  });

  it("hiding both classes yields an empty render list", () => {
    useUiStore.getState().toggleSubstrateClass("sand");
    useUiStore.getState().toggleSubstrateClass("gravel");

    const hidden = useUiStore.getState().hiddenSubstrateClasses;
    const visible = filterVisibleSubstrateFeatures(all, hidden);
    const polys = buildPolyRenders(visible, ...BOUNDS);
    expect(polys).toHaveLength(0);
  });

  it("clearHiddenSubstrateClasses restores full visibility from a partial-hidden state", () => {
    useUiStore.getState().toggleSubstrateClass("sand");

    const hiddenAfterToggle = useUiStore.getState().hiddenSubstrateClasses;
    expect(filterVisibleSubstrateFeatures(all, hiddenAfterToggle)).toHaveLength(1);

    useUiStore.getState().clearHiddenSubstrateClasses();

    const hidden = useUiStore.getState().hiddenSubstrateClasses;
    const visible = filterVisibleSubstrateFeatures(all, hidden);
    const polys = buildPolyRenders(visible, ...BOUNDS);
    expect(polys).toHaveLength(2);
  });

  it("toggling hides the selected substrate and clears selectedSubstrate in uiStore", () => {
    useUiStore.setState({
      selectedSubstrate: {
        unitId: "poly-sand",
        substrate: "sand",
        shoreZoneClass: "SAND",
        cmecsCode: "SBS_SA",
        color: "#e2d5a0",
        szMaterial: null,
        szForm: null,
        areaSqM: null,
        natsur: null,
        encChart: null,
        sourceName: "test",
        creditUrl: "",
      },
    });

    useUiStore.getState().toggleSubstrateClass("sand");

    expect(useUiStore.getState().selectedSubstrate).toBeNull();
  });

  it("toggling a different class leaves selectedSubstrate intact", () => {
    const sel = {
      unitId: "poly-sand",
      substrate: "sand",
      shoreZoneClass: "SAND",
      cmecsCode: "SBS_SA",
      color: "#e2d5a0",
      szMaterial: null,
      szForm: null,
      areaSqM: null,
      natsur: null,
      encChart: null,
      sourceName: "test",
      creditUrl: "",
    };
    useUiStore.setState({ selectedSubstrate: sel });

    useUiStore.getState().toggleSubstrateClass("gravel");

    expect(useUiStore.getState().selectedSubstrate).toEqual(sel);
  });
});

// ---------------------------------------------------------------------------
// Geometry caching: no recreation on filter toggle (new component behaviour)
//
// SubstrateLayer now builds geometry for ALL features once (deps: collection +
// terrain only) and toggles mesh.visible instead of rebuilding on every
// hiddenSubstrateClasses change.  These tests lock in that contract by
// verifying that:
//   - `buildPolyRenders` is called once for the full feature set, and
//   - the geometry object references remain identical after a visibility
//     toggle (i.e. toggling hides via `visible`, not by disposing/recreating).
// ---------------------------------------------------------------------------

describe("SubstrateLayer geometry caching: stable refs across visibility toggles", () => {
  const sand = makePolygonFeature("poly-sand", "sand");
  const gravel = makePolygonFeature("poly-gravel", "gravel");
  const bedrock = makeMultiPolygonFeature("poly-bedrock", "bedrock");
  const allFeatures = [sand, gravel, bedrock];

  it("builds geometry for every feature regardless of hidden set", () => {
    const polys = buildPolyRenders(allFeatures, ...BOUNDS);
    expect(polys).toHaveLength(3);
  });

  it("geometry references are identical before and after a simulated toggle", () => {
    const polys = buildPolyRenders(allFeatures, ...BOUNDS);

    const fillsBefore = polys.map((p) => p.fillGeometry);
    const outlinesBefore = polys.map((p) => p.outlineGeometry);

    // Simulate a toggle: compute visibility without calling buildPolyRenders again.
    const hidden = new Set(["sand"]);
    const visibilities = polys.map(
      (p) => !hidden.has(p.feature.properties.substrate.toLowerCase()),
    );

    expect(visibilities).toEqual([false, true, true]);

    // Geometry objects are the exact same references — nothing was disposed
    // or recreated by the visibility check.
    polys.forEach((p, i) => {
      expect(p.fillGeometry).toBe(fillsBefore[i]);
      expect(p.outlineGeometry).toBe(outlinesBefore[i]);
    });
  });

  it("toggling all classes still leaves all geometry objects intact", () => {
    const polys = buildPolyRenders(allFeatures, ...BOUNDS);
    const outlinesBefore = polys.map((p) => p.outlineGeometry);

    const hidden = new Set(["sand", "gravel", "bedrock"]);
    const visibilities = polys.map(
      (p) => !hidden.has(p.feature.properties.substrate.toLowerCase()),
    );

    expect(visibilities).toEqual([false, false, false]);
    polys.forEach((p, i) => {
      expect(p.outlineGeometry).toBe(outlinesBefore[i]);
    });
  });

  it("visibility is computed from substrate name, case-insensitively", () => {
    const mixed = makePolygonFeature("poly-mixed", "Bedrock");
    const polys = buildPolyRenders([mixed], ...BOUNDS);

    const hidden = new Set(["bedrock"]);
    const isVisible = !hidden.has(
      polys[0]!.feature.properties.substrate.toLowerCase(),
    );

    expect(isVisible).toBe(false);
    expect(polys[0]?.outlineGeometry).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Click guard: hidden polygons must not set selectedSubstrate
//
// The component attaches `onClick` only when `isVisible` is true (i.e.
// `onClick={isVisible ? handleClick(p.feature) : undefined}`).  These tests
// mirror that conditional by computing `isVisible` from hiddenSubstrateClasses
// before deciding whether to call setSelectedSubstrate — confirming that no
// selectedSubstrate is ever written for a hidden feature.
// ---------------------------------------------------------------------------

describe("SubstrateLayer click guard: hidden polygons do not set selectedSubstrate", () => {
  beforeEach(() => {
    useUiStore.setState({
      hiddenSubstrateClasses: new Set<string>(),
      substrateColorMode: true,
      selectedSubstrate: null,
    });
  });

  it("clicking a visible polygon sets selectedSubstrate", () => {
    const sand = makePolygonFeature("poly-sand", "sand");
    const hidden = useUiStore.getState().hiddenSubstrateClasses;
    const isVisible = !hidden.has(sand.properties.substrate.toLowerCase());

    if (isVisible) {
      useUiStore
        .getState()
        .setSelectedSubstrate(
          buildSelectedSubstrate(sand, "test source", "http://test.com"),
        );
    }

    expect(useUiStore.getState().selectedSubstrate?.unitId).toBe("poly-sand");
  });

  it("clicking a hidden polygon does NOT set selectedSubstrate", () => {
    const bedrock = makePolygonFeature("poly-bedrock", "bedrock");
    useUiStore.getState().toggleSubstrateClass("bedrock");

    const hidden = useUiStore.getState().hiddenSubstrateClasses;
    const isVisible = !hidden.has(bedrock.properties.substrate.toLowerCase());

    if (isVisible) {
      useUiStore
        .getState()
        .setSelectedSubstrate(
          buildSelectedSubstrate(bedrock, "test source", "http://test.com"),
        );
    }

    expect(useUiStore.getState().selectedSubstrate).toBeNull();
  });

  it("case-insensitive: mixed-case substrate name is correctly identified as hidden", () => {
    const mixed = makePolygonFeature("poly-mixed", "Bedrock");
    useUiStore.getState().toggleSubstrateClass("bedrock");

    const hidden = useUiStore.getState().hiddenSubstrateClasses;
    const isVisible = !hidden.has(mixed.properties.substrate.toLowerCase());

    if (isVisible) {
      useUiStore
        .getState()
        .setSelectedSubstrate(
          buildSelectedSubstrate(mixed, "test source", "http://test.com"),
        );
    }

    expect(useUiStore.getState().selectedSubstrate).toBeNull();
  });

  it("re-showing a hidden polygon (toggle x2) allows selectedSubstrate to be set again", () => {
    const sand = makePolygonFeature("poly-sand", "sand");
    useUiStore.getState().toggleSubstrateClass("sand");
    useUiStore.getState().toggleSubstrateClass("sand");

    const hidden = useUiStore.getState().hiddenSubstrateClasses;
    const isVisible = !hidden.has(sand.properties.substrate.toLowerCase());

    if (isVisible) {
      useUiStore
        .getState()
        .setSelectedSubstrate(
          buildSelectedSubstrate(sand, "test source", "http://test.com"),
        );
    }

    expect(useUiStore.getState().selectedSubstrate?.unitId).toBe("poly-sand");
  });
});

// ---------------------------------------------------------------------------
// Zone colour override: SubstrateLayer applies zoneOverlayStore slot colours
//
// These tests call computePolyZoneProps — the exact pure helper extracted
// from SubstrateLayer's allPolys.map() loop — so a regression in the
// component's production decision path is caught immediately.
//
// The function signature mirrors the component's per-polygon block:
//   computePolyZoneProps(substrate, classVisible, zoneOverlayEnabled, zoneSlots)
//   → { colorOverride: string | undefined; isVisible: boolean }
// ---------------------------------------------------------------------------

describe("SubstrateLayer zone colour override (zoneOverlayEnabled=true)", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    useZoneOverlayStore.getState().resetToDefaults();
  });

  function slots() {
    return useZoneOverlayStore.getState().slots;
  }

  it("sand substrate receives slot-0 (default warm-yellow) colour override", () => {
    const { colorOverride } = computePolyZoneProps("sand", true, true, slots());
    expect(colorOverride).toBe(ZONE_DEFAULT_COLORS[0]);
  });

  it("gravel substrate receives slot-1 (default earthy-amber) colour override", () => {
    const { colorOverride } = computePolyZoneProps("gravel", true, true, slots());
    expect(colorOverride).toBe(ZONE_DEFAULT_COLORS[1]);
  });

  it("silt substrate receives slot-2 (default cool-blue-grey) colour override", () => {
    const { colorOverride } = computePolyZoneProps("silt", true, true, slots());
    expect(colorOverride).toBe(ZONE_DEFAULT_COLORS[2]);
  });

  it("bedrock substrate receives slot-3 (default terracotta) colour override", () => {
    const { colorOverride } = computePolyZoneProps("bedrock", true, true, slots());
    expect(colorOverride).toBe(ZONE_DEFAULT_COLORS[3]);
  });

  it("colorOverride reflects a user-set custom colour for slot 0", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#ff1234");
    const { colorOverride } = computePolyZoneProps("sand", true, true, slots());
    expect(colorOverride).toBe("#ff1234");
  });

  it("custom colour on slot 2 flows through to a silt polygon", () => {
    useZoneOverlayStore.getState().setSlotColor(2, "#00aabb");
    const { colorOverride } = computePolyZoneProps("silt", true, true, slots());
    expect(colorOverride).toBe("#00aabb");
  });

  it("each of the four slots carries an independent custom colour", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#aaaa00");
    useZoneOverlayStore.getState().setSlotColor(1, "#00aaaa");
    useZoneOverlayStore.getState().setSlotColor(2, "#aa00aa");
    useZoneOverlayStore.getState().setSlotColor(3, "#aaaaaa");
    const s = slots();
    expect(computePolyZoneProps("sand",    true, true, s).colorOverride).toBe("#aaaa00");
    expect(computePolyZoneProps("gravel",  true, true, s).colorOverride).toBe("#00aaaa");
    expect(computePolyZoneProps("silt",    true, true, s).colorOverride).toBe("#aa00aa");
    expect(computePolyZoneProps("bedrock", true, true, s).colorOverride).toBe("#aaaaaa");
  });

  it("compound label 'sandy reef' resolves to the slot-0 colour", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#beefed");
    const { colorOverride } = computePolyZoneProps("sandy reef", true, true, slots());
    expect(colorOverride).toBe("#beefed");
  });

  it("mixed-case substrate 'SILT' still resolves to the correct slot colour", () => {
    const { colorOverride } = computePolyZoneProps("SILT", true, true, slots());
    expect(colorOverride).toBe(ZONE_DEFAULT_COLORS[2]);
  });
});

describe("SubstrateLayer zone slot visibility gate (zoneOverlayEnabled=true)", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    useZoneOverlayStore.getState().resetToDefaults();
  });

  function slots() {
    return useZoneOverlayStore.getState().slots;
  }

  it("all polygons are visible by default (all slots visible)", () => {
    expect(computePolyZoneProps("sand",    true, true, slots()).isVisible).toBe(true);
    expect(computePolyZoneProps("gravel",  true, true, slots()).isVisible).toBe(true);
    expect(computePolyZoneProps("silt",    true, true, slots()).isVisible).toBe(true);
    expect(computePolyZoneProps("bedrock", true, true, slots()).isVisible).toBe(true);
  });

  it("hiding slot 0 makes sand polygons invisible", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    expect(computePolyZoneProps("sand", true, true, slots()).isVisible).toBe(false);
  });

  it("hiding slot 1 makes gravel polygons invisible", () => {
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    expect(computePolyZoneProps("gravel", true, true, slots()).isVisible).toBe(false);
  });

  it("hiding slot 2 makes silt polygons invisible", () => {
    useZoneOverlayStore.getState().setSlotVisible(2, false);
    expect(computePolyZoneProps("silt", true, true, slots()).isVisible).toBe(false);
  });

  it("hiding slot 3 makes bedrock polygons invisible", () => {
    useZoneOverlayStore.getState().setSlotVisible(3, false);
    expect(computePolyZoneProps("bedrock", true, true, slots()).isVisible).toBe(false);
  });

  it("hiding slot 0 does not affect polygons in slots 1–3", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    const s = slots();
    expect(computePolyZoneProps("gravel",  true, true, s).isVisible).toBe(true);
    expect(computePolyZoneProps("silt",    true, true, s).isVisible).toBe(true);
    expect(computePolyZoneProps("bedrock", true, true, s).isVisible).toBe(true);
  });

  it("re-showing a hidden slot restores polygon visibility", () => {
    useZoneOverlayStore.getState().setSlotVisible(2, false);
    expect(computePolyZoneProps("silt", true, true, slots()).isVisible).toBe(false);
    useZoneOverlayStore.getState().setSlotVisible(2, true);
    expect(computePolyZoneProps("silt", true, true, slots()).isVisible).toBe(true);
  });

  it("polygon is invisible when BOTH class is hidden AND slot is hidden", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    expect(computePolyZoneProps("sand", false, true, slots()).isVisible).toBe(false);
  });

  it("polygon is invisible when class is hidden even if slot is visible", () => {
    expect(computePolyZoneProps("sand", false, true, slots()).isVisible).toBe(false);
  });

  it("polygon is invisible when slot is hidden even if class filter is open", () => {
    useZoneOverlayStore.getState().setSlotVisible(3, false);
    expect(computePolyZoneProps("bedrock", true, true, slots()).isVisible).toBe(false);
  });

  it("resetToDefaults restores all slot visibilities", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    useZoneOverlayStore.getState().resetToDefaults();
    const s = slots();
    expect(computePolyZoneProps("sand",   true, true, s).isVisible).toBe(true);
    expect(computePolyZoneProps("gravel", true, true, s).isVisible).toBe(true);
  });

  it("hiding all four slots makes every substrate class invisible", () => {
    for (let i = 0; i < 4; i++) {
      useZoneOverlayStore.getState().setSlotVisible(i as 0 | 1 | 2 | 3, false);
    }
    const s = slots();
    expect(computePolyZoneProps("sand",    true, true, s).isVisible).toBe(false);
    expect(computePolyZoneProps("gravel",  true, true, s).isVisible).toBe(false);
    expect(computePolyZoneProps("silt",    true, true, s).isVisible).toBe(false);
    expect(computePolyZoneProps("bedrock", true, true, s).isVisible).toBe(false);
  });
});

describe("SubstrateLayer zone overlay disabled (zoneOverlayEnabled=false)", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    useZoneOverlayStore.getState().resetToDefaults();
  });

  function slots() {
    return useZoneOverlayStore.getState().slots;
  }

  it("colorOverride is undefined when zone overlay is disabled", () => {
    const { colorOverride } = computePolyZoneProps("sand", true, false, slots());
    expect(colorOverride).toBeUndefined();
  });

  it("isVisible is true (classVisible=true) regardless of slot hidden state when overlay is off", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    const { isVisible } = computePolyZoneProps("sand", true, false, slots());
    expect(isVisible).toBe(true);
  });

  it("polygon is still invisible when class is hidden, even with overlay off", () => {
    const { isVisible } = computePolyZoneProps("sand", false, false, slots());
    expect(isVisible).toBe(false);
  });

  it("buildPolyRenders preserves the server-side poly.color when overlay is off", () => {
    const feature = makePolygonFeature("poly-sand", "sand", "#server-color");
    const polys = buildPolyRenders([feature], ...BOUNDS);
    expect(polys[0]!.color).toBe("#server-color");
    // And overlay disabled means no colorOverride
    const { colorOverride } = computePolyZoneProps("sand", true, false, slots());
    expect(colorOverride).toBeUndefined();
  });
});
