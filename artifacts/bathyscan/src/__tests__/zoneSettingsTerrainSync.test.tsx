/**
 * Zone Settings → Terrain Live Sync
 *
 * Verifies that visibility and colour changes made in Settings → Visuals
 * (ZoneColoursCard) immediately update zoneOverlayStore — the single source
 * of truth that TerrainMesh.tsx reads via `getState()` on every R3F frame.
 *
 * Because TerrainMesh runs inside an R3F Canvas and calls
 *   `useZoneOverlayStore.getState().slots`
 * on EVERY frame in its `useFrame` loop, any store mutation is picked up
 * within one render frame — no page reload or panel re-open required.
 *
 * These tests act as a contract:
 *   1. Settings → store update is synchronous and correct.
 *   2. `getState()` (the terrain's read path) always reflects the latest state.
 *   3. Both colour and visibility changes are propagated.
 *   4. Both saltwater and freshwater palettes are handled independently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat();
});

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

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
    useGetSettings: () => ({ data: null }),
  }),
);

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: { activeGrid: null }) => unknown) => sel({ activeGrid: null }),
}));

vi.mock("idb-keyval", () => ({
  keys: () => Promise.resolve([]),
  clear: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  del: () => Promise.resolve(),
}));

vi.mock("@/hooks/useUpscaledHeatmap", () => ({
  clearUpscaleCache: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ============================================================================
// Capture refs + extra mocks for TerrainMesh useFrame uniform tests
// ============================================================================

const frameRef = vi.hoisted(() => ({
  cb: null as ((state: { camera: { position: object } }, delta: number) => void) | null,
}));

const uiStateRef = vi.hoisted(() => ({
  zoneOverlayEnabled: true as boolean,
  zonePaintMode: false,
  zonePaintBrushRadius: 1,
  zonePaintSlot: 0 as 0 | 1 | 2 | 3,
}));

const mockMatHolder = vi.hoisted(() => {
  type MockColor = { set: (v: string) => void; getHex: () => string };
  type MockVec4 = {
    set: (x: number, y: number, z: number, w: number) => void;
    getVals: () => number[];
  };
  type MockMat = {
    uniforms: Record<string, { value: unknown }>;
    tint: MockColor[];
    vis: MockVec4;
    dispose: () => void;
  };
  const makeColor = (): MockColor => {
    let h = "";
    return { set: (v: string) => { h = v; }, getHex: () => h };
  };
  const makeVec4 = (): MockVec4 => {
    let v: number[] = [0, 0, 0, 0];
    return {
      set: (x: number, y: number, z: number, w: number) => { v = [x, y, z, w]; },
      getVals: () => [...v],
    };
  };
  let _current: MockMat | null = null;
  return {
    make: (): MockMat => {
      const tint = [makeColor(), makeColor(), makeColor(), makeColor()];
      const vis = makeVec4();
      const explicit: Record<string, { value: unknown }> = {
        uOpacity: { value: 1 },
        uLampPos: { value: { copy: () => {} } },
        uZoneOverlay: { value: 0 },
        uZoneTint0: { value: tint[0] },
        uZoneTint1: { value: tint[1] },
        uZoneTint2: { value: tint[2] },
        uZoneTint3: { value: tint[3] },
        uZoneVisible: { value: vis },
        uHighlightMode: { value: 0 },
        uHighlightMin: { value: 0 },
        uHighlightMax: { value: 0 },
        uShowHabitat: { value: 0 },
        uHabitatIntensity: { value: 0 },
        uHabitatColor: { value: { set: (_v: string) => {} } },
        // TerrainMesh's land/nodata colour effect calls setRGB on this
        // uniform's value; the proxy fallback ({ value: 0 }) would crash.
        uLandColor: { value: { setRGB: (_r: number, _g: number, _b: number) => {} } },
        uHabitatTex: { value: null },
        uHabitatMix: { value: 0 },
      };
      const uniforms: Record<string, { value: unknown }> = new Proxy(explicit, {
        get(target, prop) {
          const key = String(prop);
          return key in target ? target[key] : { value: 0 };
        },
      });
      _current = { uniforms, tint, vis, dispose: () => {} };
      return _current;
    },
    get current() { return _current; },
  };
});

// Stub the heavy Three.js module so vitest skips loading ~3–4 s of native
// WebGL code.  TerrainMesh uses THREE for geometry/materials but those paths
// are already covered by the @/lib/terrain and @/lib/terrainShader mocks.
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

vi.mock("@react-three/fiber", () => ({
  useFrame: (cb: (state: { camera: { position: object } }, delta: number) => void) => {
    frameRef.cb = cb;
  },
}));

vi.mock("@/lib/terrainShader", () => ({
  createTerrainShaderMaterial: () => mockMatHolder.make(),
  getPlaceholderHabitatTexture: () => ({ isTexture: true, dispose: () => {} }),
}));

vi.mock("@/lib/terrain", () => ({
  buildTerrainGeometry: () => ({
    setAttribute: () => {},
    getAttribute: () => null,
    dispose: () => {},
    attributes: { position: { count: 0, array: new Float32Array(0) } },
  }),
  buildTerrainSkirtGeometry: () => ({ setAttribute: () => {}, getAttribute: () => null, dispose: () => {} }),
  computeZoneWeights: () => new Float32Array(0),
  computeSlopeAttribute: () => new Float32Array(0),
  applyColormapToVertexColors: () => {},
  isSyntheticGrid: () => false,
  WORLD_SIZE: 100,
}));

vi.mock("@/lib/textures", () => ({
  getTerrainTextures: () => ({ sand: null, sediment: null, silt: null, basalt: null }),
}));

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: (sel: (s: { zoneMap: null }) => unknown) => sel({ zoneMap: null }),
}));

vi.mock("@/lib/uiStore", () => ({
  useUiStore: Object.assign(
    (sel: (s: typeof uiStateRef) => unknown) => sel(uiStateRef),
    { getState: () => uiStateRef },
  ),
}));

vi.mock("@/lib/highlightStore", () => ({
  useHighlightStore: Object.assign(
    (sel: (s: { mode: string; params: { min: number; max: number } }) => unknown) =>
      sel({ mode: "none", params: { min: 0, max: 0 } }),
    { getState: () => ({ mode: "none", params: { min: 0, max: 0 } }) },
  ),
}));

vi.mock("@/lib/habitatStore", () => ({
  useHabitatStore: (sel: (s: { scores: { status: "idle" }; activeSpecies: null }) => unknown) =>
    sel({ scores: { status: "idle" }, activeSpecies: null }),
}));

vi.mock("@/lib/paletteStore", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const _state = {
    shallow: "#0077be", deep: "#000033",
    customStops: null as null, bandColors: [] as never[], bandBoundaries: [] as never[],
  };
  return {
    ...actual,
    usePaletteStore: Object.assign(
      (sel: (s: typeof _state) => unknown) => sel(_state),
      { getState: () => _state },
    ),
  };
});

vi.mock("@/lib/webglContextStore", () => ({
  useWebglContextStore: (sel: (s: { floatTextureLinear: boolean }) => unknown) =>
    sel({ floatTextureLinear: true }),
}));

import { Settings } from "@/pages/Settings";
import { TerrainMesh } from "@/components/TerrainMesh";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { useZoneOverlayStore, DEFAULT_SLOTS, ZONE_DEFAULT_COLORS } from "@/lib/zoneOverlayStore";
import { NAV_TABS } from "@/pages/settings/constants";
import type { Tab } from "@/pages/settings/constants";
const tabLabel = (id: Tab) => NAV_TABS.find((t) => t.id === id)!.label;

function resetStores() {
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
  useZoneOverlayStore.setState({
    saltwater: DEFAULT_SLOTS as [
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
    ],
    freshwater: DEFAULT_SLOTS as [
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
    ],
    activeWaterType: "saltwater",
    slots: DEFAULT_SLOTS as [
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
    ],
  });
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  resetStores();
});

// ---------------------------------------------------------------------------
// Visibility sync (what uZoneVisible uniform reads via getState())
// ---------------------------------------------------------------------------

describe("Settings → terrain live sync — visibility", () => {
  it("hiding slot 0 immediately updates getState().slots[0].visible to false", () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(0, false);
    });
    expect(useZoneOverlayStore.getState().slots[0]!.visible).toBe(false);
  });

  it("hiding slot 3 immediately updates getState().slots[3].visible to false", () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(3, false);
    });
    expect(useZoneOverlayStore.getState().slots[3]!.visible).toBe(false);
  });

  it("re-showing a hidden slot immediately updates getState().slots[1].visible to true", () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(1, false);
    });
    expect(useZoneOverlayStore.getState().slots[1]!.visible).toBe(false);
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(1, true);
    });
    expect(useZoneOverlayStore.getState().slots[1]!.visible).toBe(true);
  });

  it("toggling multiple slots updates each slot's getState() entry independently", () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(0, false);
      useZoneOverlayStore.getState().setSlotVisible(2, false);
    });
    const s = useZoneOverlayStore.getState().slots;
    expect(s[0]!.visible).toBe(false);
    expect(s[1]!.visible).toBe(true);
    expect(s[2]!.visible).toBe(false);
    expect(s[3]!.visible).toBe(true);
  });

  it("hiding a slot does not change the slot's colour in getState()", () => {
    const originalColor = useZoneOverlayStore.getState().slots[2]!.color;
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(2, false);
    });
    expect(useZoneOverlayStore.getState().slots[2]!.visible).toBe(false);
    expect(useZoneOverlayStore.getState().slots[2]!.color).toBe(originalColor);
  });
});

// ---------------------------------------------------------------------------
// Colour sync (what uZoneTint0..3 uniforms read via getState())
// ---------------------------------------------------------------------------

describe("Settings → terrain live sync — colour", () => {
  it("changing slot 0 colour immediately updates getState().slots[0].color", async () => {
    render(<Settings />);
    fireEvent.click(screen.getByText(tabLabel("display-overlays")));
    const input = screen.getByTestId("settings-zone-colour-input-0") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#112233" } });
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#112233");
    });
  });

  it("changing slot 3 colour immediately updates getState().slots[3].color", async () => {
    render(<Settings />);
    fireEvent.click(screen.getByText(tabLabel("display-overlays")));
    const input = screen.getByTestId("settings-zone-colour-input-3") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#aabbcc" } });
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[3]!.color).toBe("#aabbcc");
    });
  });

  it("colour change does not affect visibility of that slot in getState()", async () => {
    render(<Settings />);
    fireEvent.click(screen.getByText(tabLabel("display-overlays")));
    const input = screen.getByTestId("settings-zone-colour-input-1") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#deadbe" } });
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[1]!.color).toBe("#deadbe");
      expect(useZoneOverlayStore.getState().slots[1]!.visible).toBe(true);
    });
  });

  it("colour change on a hidden slot is preserved when visibility is re-enabled", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(0, false);
    });
    render(<Settings />);
    fireEvent.click(screen.getByText(tabLabel("display-overlays")));
    const input = screen.getByTestId("settings-zone-colour-input-0") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#ff0099" } });
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(0, true);
    });
    await waitFor(() => {
      const slot = useZoneOverlayStore.getState().slots[0]!;
      expect(slot.color).toBe("#ff0099");
      expect(slot.visible).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Reset — getState() reflects defaults after reset
// ---------------------------------------------------------------------------

describe("Settings → terrain live sync — reset to defaults", () => {
  it("reset restores all colours to defaults in getState()", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotColor(0, "#111111");
      useZoneOverlayStore.getState().setSlotColor(2, "#222222");
    });
    render(<Settings />);
    fireEvent.click(screen.getByText(tabLabel("display-overlays")));
    fireEvent.click(screen.getByTestId("settings-zone-colours-reset"));
    await waitFor(() => {
      const slots = useZoneOverlayStore.getState().slots;
      ZONE_DEFAULT_COLORS.forEach((color, i) => {
        expect(slots[i as 0 | 1 | 2 | 3]!.color.toLowerCase()).toBe(color.toLowerCase());
      });
    });
  });

  it("reset restores all slots to visible in getState()", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(1, false);
      useZoneOverlayStore.getState().setSlotVisible(3, false);
    });
    render(<Settings />);
    fireEvent.click(screen.getByText(tabLabel("display-overlays")));
    fireEvent.click(screen.getByTestId("settings-zone-colours-reset"));
    await waitFor(() => {
      const slots = useZoneOverlayStore.getState().slots;
      expect(slots[1]!.visible).toBe(true);
      expect(slots[3]!.visible).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Freshwater mode — changes go to the freshwater palette in getState()
// ---------------------------------------------------------------------------

describe("Settings → terrain live sync — freshwater palette", () => {
  beforeEach(() => {
    act(() => {
      useSettingsStore.setState({ ...useSettingsStore.getState(), waterType: "freshwater" });
      useZoneOverlayStore.getState().setActiveWaterType("freshwater");
    });
  });

  it("hiding slot 0 in freshwater mode updates getState().freshwater[0].visible", () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(0, false);
    });
    expect(useZoneOverlayStore.getState().freshwater[0]!.visible).toBe(false);
  });

  it("freshwater change does not affect saltwater getState().saltwater slots", () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(0, false);
    });
    expect(useZoneOverlayStore.getState().freshwater[0]!.visible).toBe(false);
    expect(useZoneOverlayStore.getState().saltwater[0]!.visible).toBe(true);
  });

  it("freshwater colour change updates getState().freshwater[2].color", async () => {
    render(<Settings />);
    fireEvent.click(screen.getByText(tabLabel("display-overlays")));
    const input = screen.getByTestId("settings-zone-colour-input-2") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#336699" } });
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().freshwater[2]!.color).toBe("#336699");
      expect(useZoneOverlayStore.getState().saltwater[2]!.color).toBe(ZONE_DEFAULT_COLORS[2]);
    });
  });
});

// ---------------------------------------------------------------------------
// Direct store API → terrain frame read path
//
// These tests simulate what TerrainMesh.useFrame does on every tick:
//   const { slots } = useZoneOverlayStore.getState();
// They call the store actions directly (no Settings UI) and assert that
// getState() immediately returns the mutated value — exactly the contract
// TerrainMesh relies on to update uZoneTint*/uZoneVisible uniforms.
// ---------------------------------------------------------------------------

describe("Direct store API → terrain frame read path — saltwater (setSlotColor)", () => {
  it("setSlotColor(0) is immediately visible via getState().slots[0].color", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#aabb11");
    const { slots } = useZoneOverlayStore.getState();
    expect(slots[0]!.color).toBe("#aabb11");
  });

  it("setSlotColor(1) is immediately visible via getState().slots[1].color", () => {
    useZoneOverlayStore.getState().setSlotColor(1, "#aabb22");
    expect(useZoneOverlayStore.getState().slots[1]!.color).toBe("#aabb22");
  });

  it("setSlotColor(2) is immediately visible via getState().slots[2].color", () => {
    useZoneOverlayStore.getState().setSlotColor(2, "#aabb33");
    expect(useZoneOverlayStore.getState().slots[2]!.color).toBe("#aabb33");
  });

  it("setSlotColor(3) is immediately visible via getState().slots[3].color", () => {
    useZoneOverlayStore.getState().setSlotColor(3, "#aabb44");
    expect(useZoneOverlayStore.getState().slots[3]!.color).toBe("#aabb44");
  });

  it("setSlotColor updates only the targeted slot; other slots retain their colours", () => {
    useZoneOverlayStore.getState().setSlotColor(1, "#deadbe");
    const { slots } = useZoneOverlayStore.getState();
    expect(slots[0]!.color).toBe(ZONE_DEFAULT_COLORS[0]);
    expect(slots[1]!.color).toBe("#deadbe");
    expect(slots[2]!.color).toBe(ZONE_DEFAULT_COLORS[2]);
    expect(slots[3]!.color).toBe(ZONE_DEFAULT_COLORS[3]);
  });

  it("successive setSlotColor calls produce the latest value on each getState() read", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#111111");
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#111111");
    useZoneOverlayStore.getState().setSlotColor(0, "#222222");
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#222222");
    useZoneOverlayStore.getState().setSlotColor(0, "#333333");
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#333333");
  });
});

describe("Direct store API → terrain frame read path — saltwater (setSlotVisible)", () => {
  it("setSlotVisible(0, false) is immediately visible via getState().slots[0].visible", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    expect(useZoneOverlayStore.getState().slots[0]!.visible).toBe(false);
  });

  it("setSlotVisible(3, false) is immediately visible via getState().slots[3].visible", () => {
    useZoneOverlayStore.getState().setSlotVisible(3, false);
    expect(useZoneOverlayStore.getState().slots[3]!.visible).toBe(false);
  });

  it("setSlotVisible(1, false) then setSlotVisible(1, true) reflects true on next read", () => {
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    expect(useZoneOverlayStore.getState().slots[1]!.visible).toBe(false);
    useZoneOverlayStore.getState().setSlotVisible(1, true);
    expect(useZoneOverlayStore.getState().slots[1]!.visible).toBe(true);
  });

  it("hiding multiple slots is reflected independently in a single getState() read", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    useZoneOverlayStore.getState().setSlotVisible(2, false);
    const { slots } = useZoneOverlayStore.getState();
    expect(slots[0]!.visible).toBe(false);
    expect(slots[1]!.visible).toBe(true);
    expect(slots[2]!.visible).toBe(false);
    expect(slots[3]!.visible).toBe(true);
  });

  it("setSlotVisible does not change the slot's colour in getState()", () => {
    const before = useZoneOverlayStore.getState().slots[2]!.color;
    useZoneOverlayStore.getState().setSlotVisible(2, false);
    expect(useZoneOverlayStore.getState().slots[2]!.color).toBe(before);
  });
});

describe("Direct store API → terrain frame read path — freshwater palette", () => {
  beforeEach(() => {
    act(() => {
      useZoneOverlayStore.getState().setActiveWaterType("freshwater");
    });
  });

  it("setSlotColor in freshwater mode is immediately reflected in getState().slots", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#11ff00");
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#11ff00");
  });

  it("freshwater setSlotColor is in getState().freshwater but not getState().saltwater", () => {
    useZoneOverlayStore.getState().setSlotColor(1, "#22ff00");
    const state = useZoneOverlayStore.getState();
    expect(state.freshwater[1]!.color).toBe("#22ff00");
    expect(state.saltwater[1]!.color).toBe(ZONE_DEFAULT_COLORS[1]);
  });

  it("setSlotVisible(2, false) in freshwater mode is in getState().freshwater but not saltwater", () => {
    useZoneOverlayStore.getState().setSlotVisible(2, false);
    const state = useZoneOverlayStore.getState();
    expect(state.freshwater[2]!.visible).toBe(false);
    expect(state.saltwater[2]!.visible).toBe(true);
  });

  it("switching back to saltwater makes getState().slots reflect saltwater palette", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#33ff00");
    useZoneOverlayStore.getState().setActiveWaterType("saltwater");
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe(ZONE_DEFAULT_COLORS[0]);
  });
});

describe("Direct store API → terrain frame read path — reset", () => {
  it("resetToDefaults immediately restores all colours in getState().slots", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#deadbe");
    useZoneOverlayStore.getState().setSlotColor(3, "#c0ffee");
    useZoneOverlayStore.getState().resetToDefaults();
    const { slots } = useZoneOverlayStore.getState();
    ZONE_DEFAULT_COLORS.forEach((color, i) => {
      expect(slots[i as 0 | 1 | 2 | 3]!.color.toLowerCase()).toBe(color.toLowerCase());
    });
  });

  it("resetToDefaults immediately restores all slots to visible in getState().slots", () => {
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    useZoneOverlayStore.getState().setSlotVisible(3, false);
    useZoneOverlayStore.getState().resetToDefaults();
    const { slots } = useZoneOverlayStore.getState();
    for (let i = 0; i < 4; i++) {
      expect(slots[i as 0 | 1 | 2 | 3]!.visible).toBe(true);
    }
  });
});

// ============================================================================
// TerrainMesh useFrame → shader uniform write tests
//
// These tests verify that the useFrame callback in TerrainMesh.tsx actually
// reads the latest zoneOverlayStore slots and writes them into the Three.js
// shader uniforms (uZoneTint0–uZoneTint3 and uZoneVisible).
//
// Strategy:
//   1. vi.mock("@react-three/fiber") captures the useFrame callback in frameRef.
//   2. vi.mock("@/lib/terrainShader") makes createTerrainShaderMaterial() return
//      a mock material (mockMatHolder) whose Color/Vec4 values record every .set() call.
//   3. Each test: set store state → render TerrainMesh → call frameRef.cb() →
//      assert the mock material's uniform values.
// ============================================================================

const MOCK_GRID = {
  width: 2, height: 2, resolution: 2,
  elevations: [-1, -2, -3, -4],
  spacing: 10, lat: 0, lng: 0,
  minDepth: -4, maxDepth: -1,
  waterType: "saltwater",
  depths: new Float32Array(4),
} as unknown as Parameters<typeof TerrainMesh>[0]["grid"];

const MOCK_FRAME_STATE = {
  camera: { position: { x: 0, y: 0, z: 0 } },
  clock: { elapsedTime: 0 },
} as unknown as Parameters<NonNullable<typeof frameRef.cb>>[0];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTerrainAndTick() {
  render(<TerrainMesh grid={MOCK_GRID} />);
  frameRef.cb?.(MOCK_FRAME_STATE, 0);
}

// ---------------------------------------------------------------------------
// uZoneTint* uniforms — saltwater palette
// ---------------------------------------------------------------------------

describe("TerrainMesh useFrame → uZoneTint uniforms reflect slot colours (saltwater)", () => {
  beforeEach(() => {
    resetStores();
    uiStateRef.zoneOverlayEnabled = true;
  });

  it("writes slot 0 colour to uZoneTint0 uniform on each frame tick", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#aabbcc");
    renderTerrainAndTick();
    expect(mockMatHolder.current!.tint[0]!.getHex()).toBe("#aabbcc");
  });

  it("writes slot 1 colour to uZoneTint1 uniform on each frame tick", () => {
    useZoneOverlayStore.getState().setSlotColor(1, "#112233");
    renderTerrainAndTick();
    expect(mockMatHolder.current!.tint[1]!.getHex()).toBe("#112233");
  });

  it("writes slot 2 colour to uZoneTint2 uniform on each frame tick", () => {
    useZoneOverlayStore.getState().setSlotColor(2, "#deadbe");
    renderTerrainAndTick();
    expect(mockMatHolder.current!.tint[2]!.getHex()).toBe("#deadbe");
  });

  it("writes slot 3 colour to uZoneTint3 uniform on each frame tick", () => {
    useZoneOverlayStore.getState().setSlotColor(3, "#c0ffee");
    renderTerrainAndTick();
    expect(mockMatHolder.current!.tint[3]!.getHex()).toBe("#c0ffee");
  });

  it("writes all four tints in a single frame tick from their respective slots", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#111111");
    useZoneOverlayStore.getState().setSlotColor(1, "#222222");
    useZoneOverlayStore.getState().setSlotColor(2, "#333333");
    useZoneOverlayStore.getState().setSlotColor(3, "#444444");
    renderTerrainAndTick();
    const { tint } = mockMatHolder.current!;
    expect(tint[0]!.getHex()).toBe("#111111");
    expect(tint[1]!.getHex()).toBe("#222222");
    expect(tint[2]!.getHex()).toBe("#333333");
    expect(tint[3]!.getHex()).toBe("#444444");
  });

  it("a second frame tick picks up a colour change made after the first tick", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#aaaaaa");
    render(<TerrainMesh grid={MOCK_GRID} />);
    frameRef.cb?.(MOCK_FRAME_STATE, 0);
    expect(mockMatHolder.current!.tint[0]!.getHex()).toBe("#aaaaaa");

    useZoneOverlayStore.getState().setSlotColor(0, "#bbbbbb");
    frameRef.cb?.(MOCK_FRAME_STATE, 0);
    expect(mockMatHolder.current!.tint[0]!.getHex()).toBe("#bbbbbb");
  });
});

// ---------------------------------------------------------------------------
// uZoneVisible uniform — saltwater palette
// ---------------------------------------------------------------------------

describe("TerrainMesh useFrame → uZoneVisible uniform reflects slot visibility (saltwater)", () => {
  beforeEach(() => {
    resetStores();
    uiStateRef.zoneOverlayEnabled = true;
  });

  it("sets uZoneVisible to (1,1,1,1) when all slots are visible", () => {
    renderTerrainAndTick();
    expect(mockMatHolder.current!.vis.getVals()).toEqual([1, 1, 1, 1]);
  });

  it("sets x component of uZoneVisible to 0 when slot 0 is hidden", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    renderTerrainAndTick();
    expect(mockMatHolder.current!.vis.getVals()).toEqual([0, 1, 1, 1]);
  });

  it("sets y component of uZoneVisible to 0 when slot 1 is hidden", () => {
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    renderTerrainAndTick();
    expect(mockMatHolder.current!.vis.getVals()).toEqual([1, 0, 1, 1]);
  });

  it("sets z component of uZoneVisible to 0 when slot 2 is hidden", () => {
    useZoneOverlayStore.getState().setSlotVisible(2, false);
    renderTerrainAndTick();
    expect(mockMatHolder.current!.vis.getVals()).toEqual([1, 1, 0, 1]);
  });

  it("sets w component of uZoneVisible to 0 when slot 3 is hidden", () => {
    useZoneOverlayStore.getState().setSlotVisible(3, false);
    renderTerrainAndTick();
    expect(mockMatHolder.current!.vis.getVals()).toEqual([1, 1, 1, 0]);
  });

  it("reflects mixed visibility correctly — slots 0 and 2 hidden", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    useZoneOverlayStore.getState().setSlotVisible(2, false);
    renderTerrainAndTick();
    expect(mockMatHolder.current!.vis.getVals()).toEqual([0, 1, 0, 1]);
  });

  it("reflects mixed visibility correctly — slots 1 and 3 hidden", () => {
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    useZoneOverlayStore.getState().setSlotVisible(3, false);
    renderTerrainAndTick();
    expect(mockMatHolder.current!.vis.getVals()).toEqual([1, 0, 1, 0]);
  });

  it("sets uZoneVisible to (0,0,0,0) when all slots are hidden", () => {
    for (let i = 0; i < 4; i++) {
      useZoneOverlayStore.getState().setSlotVisible(i as 0 | 1 | 2 | 3, false);
    }
    renderTerrainAndTick();
    expect(mockMatHolder.current!.vis.getVals()).toEqual([0, 0, 0, 0]);
  });

  it("re-showing a slot on a subsequent tick updates uZoneVisible back to 1", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    render(<TerrainMesh grid={MOCK_GRID} />);
    frameRef.cb?.(MOCK_FRAME_STATE, 0);
    expect(mockMatHolder.current!.vis.getVals()[0]).toBe(0);

    useZoneOverlayStore.getState().setSlotVisible(0, true);
    frameRef.cb?.(MOCK_FRAME_STATE, 0);
    expect(mockMatHolder.current!.vis.getVals()[0]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// overlay disabled — tint/visibility uniforms must NOT be written
// ---------------------------------------------------------------------------

describe("TerrainMesh useFrame → tint and visibility uniforms skipped when overlay disabled", () => {
  beforeEach(() => {
    resetStores();
    uiStateRef.zoneOverlayEnabled = false;
  });

  it("uZoneTint0 is not updated when zoneOverlayEnabled is false", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#ff0000");
    renderTerrainAndTick();
    expect(mockMatHolder.current!.tint[0]!.getHex()).not.toBe("#ff0000");
  });

  it("uZoneVisible is not updated when zoneOverlayEnabled is false", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    renderTerrainAndTick();
    expect(mockMatHolder.current!.vis.getVals()).toEqual([0, 0, 0, 0]);
  });

  it("uZoneOverlay uniform is 0 when overlay is disabled", () => {
    renderTerrainAndTick();
    expect(mockMatHolder.current!.uniforms["uZoneOverlay"]!.value).toBe(0);
  });

  it("uZoneOverlay uniform is 1 when overlay is enabled", () => {
    uiStateRef.zoneOverlayEnabled = true;
    renderTerrainAndTick();
    expect(mockMatHolder.current!.uniforms["uZoneOverlay"]!.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// uZoneTint* and uZoneVisible — freshwater palette
// ---------------------------------------------------------------------------

describe("TerrainMesh useFrame → uniforms reflect freshwater palette when active", () => {
  beforeEach(() => {
    resetStores();
    uiStateRef.zoneOverlayEnabled = true;
    act(() => {
      useZoneOverlayStore.getState().setActiveWaterType("freshwater");
    });
  });

  it("uses freshwater slot 0 colour for uZoneTint0 uniform", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#00ff99");
    renderTerrainAndTick();
    expect(mockMatHolder.current!.tint[0]!.getHex()).toBe("#00ff99");
  });

  it("uses freshwater slot 2 colour for uZoneTint2 uniform", () => {
    useZoneOverlayStore.getState().setSlotColor(2, "#336699");
    renderTerrainAndTick();
    expect(mockMatHolder.current!.tint[2]!.getHex()).toBe("#336699");
  });

  it("does not use saltwater colours when freshwater is active", () => {
    act(() => {
      useZoneOverlayStore.setState((s) => ({
        saltwater: s.saltwater.map((sl, i) =>
          i === 0 ? { ...sl, color: "#salt00" } : { ...sl }
        ) as typeof s.saltwater,
        slots: s.freshwater,
      }));
    });
    useZoneOverlayStore.getState().setSlotColor(0, "#freshwater");
    renderTerrainAndTick();
    expect(mockMatHolder.current!.tint[0]!.getHex()).toBe("#freshwater");
    expect(mockMatHolder.current!.tint[0]!.getHex()).not.toBe("#salt00");
  });

  it("uZoneVisible reflects freshwater slot visibility — slot 1 hidden", () => {
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    renderTerrainAndTick();
    expect(mockMatHolder.current!.vis.getVals()).toEqual([1, 0, 1, 1]);
  });

  it("uZoneVisible reflects freshwater slot visibility — all visible after switching back", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    act(() => {
      useZoneOverlayStore.getState().setActiveWaterType("saltwater");
    });
    renderTerrainAndTick();
    expect(mockMatHolder.current!.vis.getVals()).toEqual([1, 1, 1, 1]);
  });
});
