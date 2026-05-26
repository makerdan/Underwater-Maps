import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SubstrateFeature, TerrainData } from "@workspace/api-client-react";
import {
  renderSubstrateLegend,
  hitTestSubstrateLegend,
  renderSubstrateOverlay,
  type SubstrateLegendLayout,
} from "../overviewRenderer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 })),
    roundRect: vi.fn(),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    imageSmoothingEnabled: true,
    font: "",
  } as unknown as CanvasRenderingContext2D;
}

function makeFeature(
  substrate: string,
  color: string,
  unitId = "u1",
): SubstrateFeature {
  return {
    type: "Feature",
    properties: {
      unitId,
      substrate,
      shoreZoneClass: "Rock",
      cmecsCode: "RK",
      color,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-148.0, 60.0],
          [-147.9, 60.0],
          [-147.9, 60.1],
          [-148.0, 60.1],
          [-148.0, 60.0],
        ],
      ],
    },
  } as unknown as SubstrateFeature;
}

const GRID: TerrainData = {
  datasetId: "test",
  resolution: 10,
  width: 10,
  height: 10,
  depths: Array.from({ length: 100 }, () => 50),
  minDepth: 50,
  maxDepth: 50,
  minLon: -148.1,
  maxLon: -147.8,
  minLat: 59.9,
  maxLat: 60.2,
  waterType: "saltwater",
} as unknown as TerrainData;

const TRANSFORM = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  pxPerDeg: 300,
};

// ---------------------------------------------------------------------------
// renderSubstrateLegend
// ---------------------------------------------------------------------------

describe("renderSubstrateLegend", () => {
  it("returns null for an empty feature list", () => {
    const ctx = makeMockCtx();
    const result = renderSubstrateLegend(ctx, [], 400);
    expect(result).toBeNull();
  });

  it("returns one row per unique substrate class", () => {
    const ctx = makeMockCtx();
    const features: SubstrateFeature[] = [
      makeFeature("bedrock", "#aaaaaa", "u1"),
      makeFeature("bedrock", "#aaaaaa", "u2"),
      makeFeature("gravel", "#bbbbbb", "u3"),
      makeFeature("sand", "#cccccc", "u4"),
    ];
    const layout = renderSubstrateLegend(ctx, features, 400);
    expect(layout).not.toBeNull();
    expect(layout!.rows).toHaveLength(3);
  });

  it("each row key is the lower-cased substrate string", () => {
    const ctx = makeMockCtx();
    const features: SubstrateFeature[] = [
      makeFeature("Bedrock", "#aaaaaa", "u1"),
      makeFeature("Gravel", "#bbbbbb", "u2"),
    ];
    const layout = renderSubstrateLegend(ctx, features, 400);
    expect(layout!.rows.map((r) => r.key)).toEqual(["bedrock", "gravel"]);
  });

  it("preserves first-seen order of substrate classes", () => {
    const ctx = makeMockCtx();
    const features: SubstrateFeature[] = [
      makeFeature("sand", "#cccccc", "u1"),
      makeFeature("mud", "#dddddd", "u2"),
      makeFeature("sand", "#cccccc", "u3"),
      makeFeature("bedrock", "#aaaaaa", "u4"),
    ];
    const layout = renderSubstrateLegend(ctx, features, 400);
    expect(layout!.rows.map((r) => r.key)).toEqual(["sand", "mud", "bedrock"]);
  });

  it("includes a row for hidden classes (rows are always present, just dimmed)", () => {
    const ctx = makeMockCtx();
    const features: SubstrateFeature[] = [
      makeFeature("bedrock", "#aaaaaa", "u1"),
      makeFeature("gravel", "#bbbbbb", "u2"),
    ];
    const hidden = new Set(["bedrock"]);
    const layout = renderSubstrateLegend(ctx, features, 400, hidden);
    expect(layout!.rows).toHaveLength(2);
    expect(layout!.rows.map((r) => r.key)).toContain("bedrock");
  });

  it("each row rect is a 4-element tuple of numbers", () => {
    const ctx = makeMockCtx();
    const layout = renderSubstrateLegend(
      ctx,
      [makeFeature("bedrock", "#aaaaaa", "u1")],
      400,
    );
    const rect = layout!.rows[0]!.rect;
    expect(rect).toHaveLength(4);
    rect.forEach((v) => expect(typeof v).toBe("number"));
  });

  it("row rects have positive width and height", () => {
    const ctx = makeMockCtx();
    const features: SubstrateFeature[] = [
      makeFeature("bedrock", "#aaaaaa", "u1"),
      makeFeature("gravel", "#bbbbbb", "u2"),
    ];
    const layout = renderSubstrateLegend(ctx, features, 400);
    for (const row of layout!.rows) {
      expect(row.rect[2]).toBeGreaterThan(0);
      expect(row.rect[3]).toBeGreaterThan(0);
    }
  });

  it("row rects do not overlap for distinct classes", () => {
    const ctx = makeMockCtx();
    const features: SubstrateFeature[] = [
      makeFeature("bedrock", "#aaaaaa", "u1"),
      makeFeature("gravel", "#bbbbbb", "u2"),
      makeFeature("sand", "#cccccc", "u3"),
    ];
    const layout = renderSubstrateLegend(ctx, features, 600);
    const rows = layout!.rows;
    for (let i = 0; i < rows.length - 1; i++) {
      const [, ay, , ah] = rows[i]!.rect;
      const [, by] = rows[i + 1]!.rect;
      expect(ay + ah).toBeLessThanOrEqual(by + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// hitTestSubstrateLegend
// ---------------------------------------------------------------------------

describe("hitTestSubstrateLegend", () => {
  it("returns null when layout is null", () => {
    expect(hitTestSubstrateLegend(50, 50, null)).toBeNull();
  });

  it("returns null when click is outside all row rects", () => {
    const layout: SubstrateLegendLayout = {
      box: [12, 300, 100, 60],
      rows: [
        { key: "bedrock", label: "BEDROCK", color: "#aaa", rect: [14, 320, 96, 14] },
        { key: "gravel", label: "GRAVEL", color: "#bbb", rect: [14, 334, 96, 14] },
      ],
    };
    expect(hitTestSubstrateLegend(500, 500, layout)).toBeNull();
    expect(hitTestSubstrateLegend(14, 300, layout)).toBeNull();
  });

  it("returns the correct key for a click inside the first row", () => {
    const layout: SubstrateLegendLayout = {
      box: [12, 300, 100, 60],
      rows: [
        { key: "bedrock", label: "BEDROCK", color: "#aaa", rect: [14, 320, 96, 14] },
        { key: "gravel", label: "GRAVEL", color: "#bbb", rect: [14, 334, 96, 14] },
      ],
    };
    expect(hitTestSubstrateLegend(30, 325, layout)).toBe("bedrock");
  });

  it("returns the correct key for a click inside the second row", () => {
    const layout: SubstrateLegendLayout = {
      box: [12, 300, 100, 60],
      rows: [
        { key: "bedrock", label: "BEDROCK", color: "#aaa", rect: [14, 320, 96, 14] },
        { key: "gravel", label: "GRAVEL", color: "#bbb", rect: [14, 334, 96, 14] },
      ],
    };
    expect(hitTestSubstrateLegend(50, 340, layout)).toBe("gravel");
  });

  it("returns the key for a click at the exact top-left corner of a row rect", () => {
    const layout: SubstrateLegendLayout = {
      box: [12, 300, 100, 30],
      rows: [{ key: "sand", label: "SAND", color: "#ccc", rect: [14, 310, 96, 14] }],
    };
    expect(hitTestSubstrateLegend(14, 310, layout)).toBe("sand");
  });

  it("returns null for a click one pixel above the first row", () => {
    const layout: SubstrateLegendLayout = {
      box: [12, 300, 100, 30],
      rows: [{ key: "sand", label: "SAND", color: "#ccc", rect: [14, 310, 96, 14] }],
    };
    expect(hitTestSubstrateLegend(14, 309, layout)).toBeNull();
  });

  it("resolves a click via a real renderSubstrateLegend layout", () => {
    const ctx = makeMockCtx();
    const features: SubstrateFeature[] = [
      makeFeature("bedrock", "#aaaaaa", "u1"),
      makeFeature("gravel", "#bbbbbb", "u2"),
    ];
    const layout = renderSubstrateLegend(ctx, features, 400)!;
    const firstRow = layout.rows[0]!;
    const [rx, ry, rw, rh] = firstRow.rect;
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    expect(hitTestSubstrateLegend(cx, cy, layout)).toBe(firstRow.key);
  });
});

// ---------------------------------------------------------------------------
// renderSubstrateOverlay — hidden-class filtering
// ---------------------------------------------------------------------------

describe("renderSubstrateOverlay", () => {
  it("calls fill for each visible feature polygon", () => {
    const ctx = makeMockCtx();
    const features: SubstrateFeature[] = [
      makeFeature("bedrock", "#aaaaaa", "u1"),
      makeFeature("gravel", "#bbbbbb", "u2"),
    ];
    renderSubstrateOverlay(ctx, features, GRID, TRANSFORM);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("does not call fill for a feature whose substrate is in hiddenClasses", () => {
    const ctx = makeMockCtx();
    const features: SubstrateFeature[] = [
      makeFeature("bedrock", "#aaaaaa", "u1"),
    ];
    const hidden = new Set(["bedrock"]);
    renderSubstrateOverlay(ctx, features, GRID, TRANSFORM, null, hidden);
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it("skips only the hidden substrate, drawing the visible ones", () => {
    const ctx = makeMockCtx();
    const features: SubstrateFeature[] = [
      makeFeature("bedrock", "#aaaaaa", "u1"),
      makeFeature("gravel", "#bbbbbb", "u2"),
      makeFeature("sand", "#cccccc", "u3"),
    ];
    const hidden = new Set(["bedrock"]);
    renderSubstrateOverlay(ctx, features, GRID, TRANSFORM, null, hidden);
    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });

  it("skips all features when all substrate classes are hidden", () => {
    const ctx = makeMockCtx();
    const features: SubstrateFeature[] = [
      makeFeature("bedrock", "#aaaaaa", "u1"),
      makeFeature("gravel", "#bbbbbb", "u2"),
    ];
    const hidden = new Set(["bedrock", "gravel"]);
    renderSubstrateOverlay(ctx, features, GRID, TRANSFORM, null, hidden);
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it("is case-insensitive: mixed-case substrate key matches lower-cased hidden set entry", () => {
    const ctx = makeMockCtx();
    const features: SubstrateFeature[] = [
      makeFeature("Bedrock", "#aaaaaa", "u1"),
    ];
    const hidden = new Set(["bedrock"]);
    renderSubstrateOverlay(ctx, features, GRID, TRANSFORM, null, hidden);
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it("draws nothing when the feature list is empty", () => {
    const ctx = makeMockCtx();
    renderSubstrateOverlay(ctx, [], GRID, TRANSFORM);
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// uiStore — toggleSubstrateClass reducer
// ---------------------------------------------------------------------------

describe("uiStore toggleSubstrateClass", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("adds a class key to hiddenSubstrateClasses when it is absent", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.setState({ hiddenSubstrateClasses: new Set() });
    useUiStore.getState().toggleSubstrateClass("bedrock");
    expect(useUiStore.getState().hiddenSubstrateClasses.has("bedrock")).toBe(true);
  });

  it("removes a class key from hiddenSubstrateClasses when it is already present", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.setState({ hiddenSubstrateClasses: new Set(["bedrock"]) });
    useUiStore.getState().toggleSubstrateClass("bedrock");
    expect(useUiStore.getState().hiddenSubstrateClasses.has("bedrock")).toBe(false);
  });

  it("lower-cases the input before adding to the set", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.setState({ hiddenSubstrateClasses: new Set() });
    useUiStore.getState().toggleSubstrateClass("Bedrock");
    expect(useUiStore.getState().hiddenSubstrateClasses.has("bedrock")).toBe(true);
    expect(useUiStore.getState().hiddenSubstrateClasses.has("Bedrock")).toBe(false);
  });

  it("returns a new Set reference on each toggle (immutable update)", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.setState({ hiddenSubstrateClasses: new Set() });

    const before = useUiStore.getState().hiddenSubstrateClasses;
    useUiStore.getState().toggleSubstrateClass("gravel");
    const after = useUiStore.getState().hiddenSubstrateClasses;
    expect(after).not.toBe(before);

    const after2Ref = useUiStore.getState().hiddenSubstrateClasses;
    useUiStore.getState().toggleSubstrateClass("gravel");
    const after2 = useUiStore.getState().hiddenSubstrateClasses;
    expect(after2).not.toBe(after2Ref);
  });

  it("does not mutate the previous Set when toggling", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.setState({ hiddenSubstrateClasses: new Set() });
    const prev = useUiStore.getState().hiddenSubstrateClasses;
    useUiStore.getState().toggleSubstrateClass("mud");
    expect(prev.has("mud")).toBe(false);
  });

  it("clears the selected substrate when its class is toggled hidden", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.setState({
      hiddenSubstrateClasses: new Set(),
      selectedSubstrate: {
        unitId: "u1",
        substrate: "bedrock",
        shoreZoneClass: "Rock",
        cmecsCode: "RK",
        color: "#aaa",
        szMaterial: null,
        szForm: null,
        areaSqM: null,
        natsur: null,
        encChart: null,
        sourceName: "test",
        creditUrl: "",
      },
    });
    useUiStore.getState().toggleSubstrateClass("bedrock");
    expect(useUiStore.getState().selectedSubstrate).toBeNull();
  });

  it("does not clear the selected substrate when a different class is toggled", async () => {
    const { useUiStore } = await import("../uiStore");
    const sel = {
      unitId: "u1",
      substrate: "bedrock",
      shoreZoneClass: "Rock",
      cmecsCode: "RK",
      color: "#aaa",
      szMaterial: null,
      szForm: null,
      areaSqM: null,
      natsur: null,
      encChart: null,
      sourceName: "test",
      creditUrl: "",
    };
    useUiStore.setState({ hiddenSubstrateClasses: new Set(), selectedSubstrate: sel });
    useUiStore.getState().toggleSubstrateClass("gravel");
    expect(useUiStore.getState().selectedSubstrate).toEqual(sel);
  });
});
