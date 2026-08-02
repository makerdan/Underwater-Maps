/**
 * Minimap — survey-gap hover tooltip
 *
 * Verifies:
 *   1. Hovering over a null-depth cell shows "Survey gap" tooltip text.
 *   2. Hovering over a non-null cell shows the default "Click to teleport here".
 *   3. The tooltip is suppressed (default text) when showNodataBoundary is false.
 *   4. The toggle button is rendered with the correct aria-pressed state.
 *   5. Clicking the toggle button calls setShowNodataBoundary.
 *
 * The Minimap draws to a <canvas>; we don't test pixel output here — only the
 * tooltip state derived from the null-cell hit-detection logic and the toggle.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useUiStore } from "@/lib/uiStore";

// ---------------------------------------------------------------------------
// Mocks required to mount Minimap without a full app context
// ---------------------------------------------------------------------------

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return () => ({ mutate: noop, mutateAsync: noop, isPending: false });
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) return (...a: unknown[]) => [k, ...a];
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () => makeApiClientMock());

/** 3×3 terrain with one null cell at centre (index 4 = row 1, col 1). */
const TERRAIN_WITH_NULL = {
  datasetId: "test-ds",
  width: 3,
  height: 3,
  resolution: 3,
  depths: [1, 2, 3, 4, null, 6, 7, 8, 9],
  minDepth: 1,
  maxDepth: 9,
  minLon: -1,
  maxLon: 1,
  minLat: -1,
  maxLat: 1,
};

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: TERRAIN_WITH_NULL }),
}));

vi.mock("@/lib/cameraStore", () => {
  const camState = { cameraPosition: { known: false as const }, heading: 0 };
  const store = Object.assign((sel: (s: unknown) => unknown) => sel ? sel(camState) : camState, {
    getState: () => camState,
    setState: () => {},
    subscribe: (_cb: unknown) => () => {},
  });
  return { useCameraStore: store };
});

vi.mock("@/lib/satelliteTileStore", () => ({
  useSatelliteTileStore: (sel: (s: unknown) => unknown) =>
    sel ? sel({ tileUrl: null }) : null,
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const state = { colormapTheme: "ocean", units: "metric" };
  const store = Object.assign((sel: (s: unknown) => unknown) => sel ? sel(state) : state, {
    getState: () => state,
    setState: () => {},
    subscribe: () => () => {},
    persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
  });
  return {
    ...actual,
    useSettingsStore: store,
  };
});

vi.mock("@/lib/paletteStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paletteStore")>();
  const state = {
    shallow: "#00b4d8",
    deep: "#03045e",
    bandColors: actual.DEFAULT_BAND_COLORS,
    customStops: [] as unknown[],
    bandBoundaries: actual.DEFAULT_BAND_BOUNDARIES ?? [0, 2000],
    blendBands: false,
  };
  const store = Object.assign((sel: (s: unknown) => unknown) => sel ? sel(state) : state, {
    getState: () => state,
    setState: () => {},
    subscribe: () => () => {},
  });
  return { ...actual, usePaletteStore: store };
});

vi.mock("@/lib/markerConstants", () => ({ MARKER_COLOR: {} }));
vi.mock("@/lib/markerIcons", () => ({
  loadMarkerIconImage: async () => null,
  peekMarkerIconImage: () => null,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children, label }: { children: React.ReactNode; label: string }) => (
    <div data-testid="vt-wrapper" data-label={label}>{children}</div>
  ),
}));

// ---------------------------------------------------------------------------

import React from "react";
import { Minimap } from "@/components/Minimap";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** BoundingClientRect stub for the 180×180 canvas. */
function canvasRect() {
  return { left: 0, top: 0, width: 180, height: 180, right: 180, bottom: 180 };
}

/**
 * Compute canvas px for a grid cell (col gx, row gy) matching drawHeatmap's
 * coordinate convention:
 *   px = (gx + 0.5) / width  * 180
 *   py = (height - 1 - gy + 0.5) / height * 180   (North-up: gy=0 → bottom)
 */
function cellPx(gx: number, gy: number, W = 3, H = 3, canvasSize = 180) {
  const px = ((gx + 0.5) / W) * canvasSize;
  const py = ((H - 1 - gy + 0.5) / H) * canvasSize;
  return { clientX: px, clientY: py };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Minimap — survey-gap hover tooltip", () => {
  beforeEach(() => {
    useUiStore.setState({ showNodataBoundary: true });
  });

  it("shows 'Survey gap' when hovering over a null-depth cell (centre, gy=1,gx=1)", () => {
    render(<Minimap />);
    const canvas = screen.getByTestId("minimap-canvas");

    // Stub getBoundingClientRect so coordinate math works.
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(canvasRect() as DOMRect);

    // The null cell is at grid (col=1, row=1).
    const pos = cellPx(1, 1);
    fireEvent.mouseMove(canvas, pos);

    // The canvas is wrapped by a ViewscreenTooltip; look for the wrapper
    // whose label has been updated to "Survey gap".
    const wrapper = canvas.closest("[data-label]");
    expect(wrapper?.getAttribute("data-label")).toBe("Survey gap");
  });

  it("shows default tooltip when hovering over a non-null cell", () => {
    render(<Minimap />);
    const canvas = screen.getByTestId("minimap-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(canvasRect() as DOMRect);

    // Top-left cell (gx=0, gy=2) has depth=1 (not null).
    const pos = cellPx(0, 2);
    fireEvent.mouseMove(canvas, pos);

    const wrapper = canvas.closest("[data-label]");
    expect(wrapper?.getAttribute("data-label")).toBe("Click to teleport here");
  });

  it("suppresses 'Survey gap' when showNodataBoundary is false", () => {
    useUiStore.setState({ showNodataBoundary: false });
    render(<Minimap />);
    const canvas = screen.getByTestId("minimap-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(canvasRect() as DOMRect);

    const pos = cellPx(1, 1); // null cell
    fireEvent.mouseMove(canvas, pos);

    const wrapper = canvas.closest("[data-label]");
    expect(wrapper?.getAttribute("data-label")).toBe("Click to teleport here");
  });

  it("resets tooltip to default on mouseLeave", () => {
    render(<Minimap />);
    const canvas = screen.getByTestId("minimap-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(canvasRect() as DOMRect);

    // First hover over null cell.
    fireEvent.mouseMove(canvas, cellPx(1, 1));
    const wrapper = canvas.closest("[data-label]");
    expect(wrapper?.getAttribute("data-label")).toBe("Survey gap");

    // Then leave.
    fireEvent.mouseLeave(canvas);
    expect(wrapper?.getAttribute("data-label")).toBe("Click to teleport here");
  });
});

describe("Minimap — survey-gap overlay toggle button", () => {
  beforeEach(() => {
    useUiStore.setState({ showNodataBoundary: true });
  });

  it("renders the toggle button", () => {
    render(<Minimap />);
    expect(screen.getByTestId("nodata-boundary-toggle")).toBeTruthy();
  });

  it("toggle button has aria-pressed=true when overlay is visible", () => {
    render(<Minimap />);
    const btn = screen.getByTestId("nodata-boundary-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("toggle button has aria-pressed=false when overlay is hidden", () => {
    useUiStore.setState({ showNodataBoundary: false });
    render(<Minimap />);
    const btn = screen.getByTestId("nodata-boundary-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking the toggle button flips showNodataBoundary in the store", () => {
    render(<Minimap />);
    const btn = screen.getByTestId("nodata-boundary-toggle");
    expect(useUiStore.getState().showNodataBoundary).toBe(true);
    fireEvent.click(btn);
    expect(useUiStore.getState().showNodataBoundary).toBe(false);
    fireEvent.click(btn);
    expect(useUiStore.getState().showNodataBoundary).toBe(true);
  });
});
