import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";

const mockApi = vi.hoisted(() => {
  const noop = () => {};
  return new Proxy({}, {
    get(_target, property) {
      if (property === "then" || property === "catch" || property === "finally") return undefined;
      const key = String(property);
      if (key in _target) return (_target as Record<string, unknown>)[key];
      if (key.startsWith("useGet")) return () => ({ data: [], isLoading: false, isError: false, refetch: noop });
      if (/^use(Post|Put|Patch|Delete)/.test(key)) return () => ({ mutate: noop, mutateAsync: vi.fn() });
      if (key.endsWith("QueryKey")) return () => [key];
      return noop;
    },
    has(_target, property) { return typeof property !== "symbol"; },
  });
});

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: null, setTerrain: vi.fn(), setDatasetId: vi.fn() }),
}));
vi.mock("@/lib/simulatedDataStore", () => ({ requestDatasetSwitch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => Object.assign(mockApi, {
  useGetSubstrate: () => ({ data: { features: [] }, isError: false }),
}));

import { OverviewMap } from "@/components/OverviewMap";

function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}><OverviewMap /></QueryClientProvider>,
  );
}

function grid() {
  return {
    datasetId: "responsive-ds", name: "Responsive", resolution: 2, width: 2, height: 2,
    depths: [10, 20, 30, 40], minDepth: 10, maxDepth: 40,
    minLon: -122, maxLon: -120, minLat: 47, maxLat: 49,
    centerLon: -121, centerLat: 48, waterType: "saltwater" as const,
  };
}

describe("OverviewMap responsive interactions", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    sessionStorage.clear();
    localStorage.clear();
    const overviewGrid = grid();
    useTerrainStore.setState({
      overviewGrid,
      activeGrid: null,
      primaryDatasetId: overviewGrid.datasetId,
      visibleDatasets: [{ datasetId: overviewGrid.datasetId, source: "preset", overviewGrid, activeGrid: null }],
    });
    useUiStore.setState({ overviewOpen: true, pendingDropIn: null, efhOverlayEnabled: false, selectedSubstrate: null, substrateColorMode: false });
  });

  it("keeps the backing canvas dimensions aligned after viewport resize", async () => {
    renderOverview();
    const canvas = screen.getByTestId("overview-map-canvas") as HTMLCanvasElement;

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);

    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
    await act(async () => { fireEvent(window, new Event("resize")); });
    expect(canvas.width).toBe(390);
    expect(canvas.height).toBe(844);
  });

  it("accepts pointer pan streams and clears them when cancelled", async () => {
    renderOverview();
    const canvas = screen.getByTestId("overview-map-canvas");

    await act(async () => {
      fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerMove(window, { pointerId: 1, pointerType: "touch", clientX: 130, clientY: 120 });
      fireEvent.pointerCancel(window, { pointerId: 1, pointerType: "touch" });
      fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: "touch", clientX: 200, clientY: 200, button: 0 });
      fireEvent.pointerUp(window, { pointerId: 2, pointerType: "touch" });
    });
    expect(canvas).toBeInTheDocument();
  });

  it("keeps Close independently reachable in the header controls", async () => {
    renderOverview();
    const close = screen.getByTestId("overview-close");

    expect(close).toBeVisible();
    await act(async () => { fireEvent.click(close); });
    expect(useUiStore.getState().overviewOpen).toBe(false);
  });

  it("clearly identifies the inactive GPS action as starting live GPS", () => {
    renderOverview();
    fireEvent.click(screen.getByTestId("overview-map-folder-gps"));
    const gps = screen.getByTestId("gps-activate-btn");

    expect(gps).toHaveTextContent("📍 MY LOCATION");
    expect(gps).toHaveAccessibleName("Use my location");
  });

  it("offers session and named-layout saves for moved puzzle tiles", () => {
    sessionStorage.setItem(
      "bathyscan:puzzleTransforms",
      JSON.stringify([["responsive-ds", { tx: 12, ty: 8, angleDeg: 0 }]]),
    );
    renderOverview();
    fireEvent.click(screen.getByTestId("overview-map-folder-puzzle"));

    const saveSession = screen.getByTestId("overview-puzzle-save");
    const saveLayout = screen.getByTestId("overview-puzzle-save-layout");
    expect(saveSession).toHaveTextContent("✦ SAVE");
    expect(saveSession).toHaveAccessibleName("Save puzzle tile positions to this session");
    expect(saveLayout).toHaveTextContent("📌 SAVE LAYOUT");
    expect(saveLayout).toHaveAccessibleName("Save current puzzle arrangement as a named layout");

    fireEvent.click(saveLayout);
    expect(screen.getByTestId("overview-puzzle-layout-form")).toBeInTheDocument();
    expect(screen.getByTestId("overview-puzzle-layout-confirm"))
      .toHaveAccessibleName("Save named puzzle layout");
  });

  it("keeps the compass and zoom controls together below the header", () => {
    renderOverview();

    const compass = screen.getByTestId("overview-compass");
    const zoomIn = screen.getByTestId("overview-zoom-in");
    const zoomOut = screen.getByTestId("overview-zoom-out");
    const zoomFit = screen.getByTestId("overview-zoom-fit");

    expect(compass).toHaveStyle({ top: "50px", right: "14px" });
    expect(zoomIn.parentElement).toHaveStyle({ top: "92px", right: "16px" });
    expect(zoomOut).toBeInTheDocument();
    expect(zoomFit).toBeInTheDocument();
  });
});
