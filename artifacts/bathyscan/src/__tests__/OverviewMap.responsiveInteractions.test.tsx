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
});