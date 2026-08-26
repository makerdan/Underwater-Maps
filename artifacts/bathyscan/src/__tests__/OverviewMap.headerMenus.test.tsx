import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const overviewGrid = {
  datasetId: "header-menu-dataset",
  name: "Header menu test",
  resolution: 2,
  width: 2,
  height: 2,
  depths: [10, 20, 30, 40],
  minDepth: 10,
  maxDepth: 40,
  minLon: -122,
  maxLon: -120,
  minLat: 47,
  maxLat: 49,
  centerLon: -121,
  centerLat: 48,
  waterType: "saltwater" as const,
};

function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <OverviewMap />
    </QueryClientProvider>,
  );
}

describe("OverviewMap header folders", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
    useTerrainStore.setState({
      overviewGrid,
      activeGrid: null,
      primaryDatasetId: overviewGrid.datasetId,
      visibleDatasets: [{ datasetId: overviewGrid.datasetId, source: "preset", overviewGrid, activeGrid: null }],
    });
    useUiStore.setState({
      overviewOpen: true,
      pendingDropIn: null,
      efhOverlayEnabled: false,
      selectedSubstrate: null,
      substrateColorMode: false,
    });
  });

  it("keeps Close permanently exposed while actions live in labelled folders", () => {
    renderOverview();

    expect(screen.getByTestId("overview-close")).toBeVisible();
    expect(screen.getByTestId("overview-map-folder-view")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("overview-map-folder-gps")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("overview-map-folder-puzzle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("overview-tools-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("overview-fit-to-data")).not.toBeVisible();
    expect(screen.getByTestId("gps-activate-btn")).not.toBeVisible();
    expect(screen.getByTestId("overview-puzzle-toggle")).not.toBeVisible();
  });

  it("opens one folder at a time and preserves conditional puzzle and tool actions", async () => {
    renderOverview();

    const view = screen.getByTestId("overview-map-folder-view");
    const gps = screen.getByTestId("overview-map-folder-gps");
    const puzzle = screen.getByTestId("overview-map-folder-puzzle");

    fireEvent.click(view);
    expect(screen.getByTestId("overview-view-menu")).toBeVisible();
    expect(screen.getByTestId("overview-fit-to-data")).toBeVisible();

    fireEvent.click(gps);
    expect(screen.getByTestId("overview-view-menu")).not.toBeVisible();
    expect(screen.getByTestId("overview-gps-menu")).toBeVisible();
    expect(screen.getByTestId("gps-activate-btn")).toBeVisible();

    fireEvent.click(puzzle);
    expect(screen.getByTestId("overview-gps-menu")).not.toBeVisible();
    expect(screen.getByTestId("overview-puzzle-toggle")).toBeVisible();
    fireEvent.click(screen.getByTestId("overview-puzzle-toggle"));
    expect(screen.getByTestId("overview-puzzle-snap-toggle")).toBeVisible();

    const tools = screen.getByTestId("overview-tools-toggle");
    fireEvent.click(tools);
    expect(screen.getByTestId("overview-tools-popover")).toBeVisible();
    expect(screen.getByTestId("overview-puzzle-menu")).not.toBeVisible();
    expect(screen.getByTestId("overview-waypoint-mode-toggle")).toBeVisible();

    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.getByTestId("overview-tools-popover")).not.toBeVisible();
    expect(tools).toHaveFocus();
  });

  it("dismisses folders at their outside boundary and keeps narrow panels fixed", async () => {
    renderOverview();
    const puzzle = screen.getByTestId("overview-map-folder-puzzle");

    fireEvent.click(puzzle);
    const panel = screen.getByTestId("overview-puzzle-menu");
    expect(panel).toBeVisible();
    expect(panel).toHaveClass("overview-folder-panel-puzzle");
    expect(getComputedStyle(panel).position).toBe("fixed");

    await act(async () => { fireEvent.mouseDown(document.body); });
    expect(panel).not.toBeVisible();
    expect(puzzle).toHaveFocus();
    expect(screen.getByTestId("overview-close")).toBeVisible();
  });
});