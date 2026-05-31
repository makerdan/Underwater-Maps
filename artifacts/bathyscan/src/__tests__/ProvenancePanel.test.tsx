import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { ProvenancePanel } from "@/components/ProvenancePanel";
import { useLandTerrainStore } from "@/lib/landTerrainStore";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/lib/blobDownload", () => ({
  triggerBlobDownload: vi.fn(),
}));

type ClassificationState = {
  source: string | null;
  currentSubstrateFp: string | null;
};

const classificationState: ClassificationState = {
  source: null,
  currentSubstrateFp: null,
};

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: (sel: (s: ClassificationState) => unknown) =>
    sel(classificationState),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTerrain(overrides: Partial<TerrainData> = {}): TerrainData {
  return {
    datasetId: "test-dataset",
    name: "Test Dataset",
    waterType: "saltwater",
    resolution: 4,
    width: 4,
    height: 4,
    depths: Array(16).fill(-10),
    minDepth: 10,
    maxDepth: 10,
    minLon: -70,
    maxLon: -69,
    minLat: 41,
    maxLat: 42,
    centerLon: -69.5,
    centerLat: 41.5,
    synthetic: false,
    hasTopography: false,
    dataSource: "gebco",
    ...overrides,
  } as unknown as TerrainData;
}

beforeEach(() => {
  useLandTerrainStore.getState().clear();
  classificationState.source = null;
  classificationState.currentSubstrateFp = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProvenancePanel — Copernicus DEM badge", () => {
  it("shows the copernicus-dem-badge when terrain.hasTopography is true", () => {
    const terrain = makeTerrain({ hasTopography: true });
    renderWithProviders(<ProvenancePanel terrain={terrain} />);
    expect(screen.getByTestId("copernicus-dem-badge")).toBeInTheDocument();
  });

  it("shows the copernicus-dem-badge when the land grid is loaded in the store", () => {
    useLandTerrainStore.getState().setLandGrid({
      elevation: [1, 2, 3, 4],
      width: 2,
      height: 2,
      minElevation: 1,
      maxElevation: 4,
      minLon: -70,
      maxLon: -69,
      minLat: 41,
      maxLat: 42,
    });
    const terrain = makeTerrain({ hasTopography: false });
    renderWithProviders(<ProvenancePanel terrain={terrain} />);
    expect(screen.getByTestId("copernicus-dem-badge")).toBeInTheDocument();
  });

  it("shows the copernicus-dem-badge when both terrain.hasTopography and land grid are set", () => {
    useLandTerrainStore.getState().setLandGrid({
      elevation: [5],
      width: 1,
      height: 1,
      minElevation: 5,
      maxElevation: 5,
      minLon: -70,
      maxLon: -69,
      minLat: 41,
      maxLat: 42,
    });
    const terrain = makeTerrain({ hasTopography: true });
    renderWithProviders(<ProvenancePanel terrain={terrain} />);
    expect(screen.getByTestId("copernicus-dem-badge")).toBeInTheDocument();
  });

  it("hides the copernicus-dem-badge when terrain.hasTopography is false and no land grid is loaded", () => {
    const terrain = makeTerrain({ hasTopography: false });
    renderWithProviders(<ProvenancePanel terrain={terrain} />);
    expect(screen.queryByTestId("copernicus-dem-badge")).not.toBeInTheDocument();
  });

  it("hides the copernicus-dem-badge when land grid is cleared after being set", () => {
    useLandTerrainStore.getState().setLandGrid({
      elevation: [1],
      width: 1,
      height: 1,
      minElevation: 1,
      maxElevation: 1,
      minLon: -70,
      maxLon: -69,
      minLat: 41,
      maxLat: 42,
    });
    useLandTerrainStore.getState().clear();
    const terrain = makeTerrain({ hasTopography: false });
    renderWithProviders(<ProvenancePanel terrain={terrain} />);
    expect(screen.queryByTestId("copernicus-dem-badge")).not.toBeInTheDocument();
  });
});

describe("ProvenancePanel — topo badge", () => {
  it("shows the topo badge when terrain.hasTopography is true", () => {
    const terrain = makeTerrain({ hasTopography: true });
    renderWithProviders(<ProvenancePanel terrain={terrain} />);
    expect(screen.getByTestId("topo-badge")).toBeInTheDocument();
  });

  it("hides the topo badge when terrain.hasTopography is false", () => {
    const terrain = makeTerrain({ hasTopography: false });
    renderWithProviders(<ProvenancePanel terrain={terrain} />);
    expect(screen.queryByTestId("topo-badge")).not.toBeInTheDocument();
  });
});
