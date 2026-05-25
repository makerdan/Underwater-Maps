import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DatasetPanel } from "@/components/DatasetPanel";

const setDatasetIdMock = vi.fn();
const setTerrainMock = vi.fn();

const datasets = [
  {
    id: "alaska-fjord",
    name: "Alaska Fjord",
    description: "Deep saltwater fjord",
    minDepth: 5,
    maxDepth: 350,
    waterType: "saltwater",
  },
  {
    id: "lake-michigan",
    name: "Lake Michigan",
    description: "Freshwater Great Lake",
    minDepth: 0,
    maxDepth: 281,
    waterType: "freshwater",
  },
];

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: setDatasetIdMock,
    setTerrain: setTerrainMock,
    terrain: null,
    mode: "fly",
  }),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isSignedIn: false }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("react-dropzone", () => ({
  useDropzone: () => ({
    getRootProps: () => ({ "data-testid": "dropzone" }),
    getInputProps: () => ({ "data-testid": "dropzone-input" }),
    isDragActive: false,
  }),
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: { getState: () => ({ setGrids: vi.fn() }) },
}));

vi.mock("@/lib/uiStore", () => ({
  useUiStore: { getState: () => ({ setPendingDropIn: vi.fn() }) },
}));

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: {
    getState: () => ({ clearZoneMap: vi.fn(), classify: vi.fn() }),
  },
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: { waterType: "saltwater" | "freshwater" }) => unknown) =>
    sel({ waterType: "saltwater" }),
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: true }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetDatasets: () => ({ data: datasets, isLoading: false }),
  useGetUserDatasets: () => ({ data: [], isLoading: false }),
  usePutSettings: () => ({ mutate: vi.fn() }),
  useGetDatasetsIdOverview: () => ({ data: null, isError: false }),
  useGetDatasetsIdTerrain: () => ({ data: null, isError: false }),
  useGetUserDatasetsIdTerrain: () => ({ data: null, isError: false }),
  useGetUserDatasetsIdOverview: () => ({ data: null, isError: false }),
  useGetMarkers: () => ({ data: [] }),
  useDeleteUserDatasetsId: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
  useDeleteMarkersId: () => ({ mutate: vi.fn() }),
  usePostDatasetsUpload: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
  }),
  getGetDatasetsIdTerrainQueryKey: (id: string) => ["datasets", id, "terrain"],
  getGetDatasetsIdOverviewQueryKey: (id: string) => ["datasets", id, "overview"],
  getGetUserDatasetsQueryKey: () => ["user-datasets"],
  getGetUserDatasetsIdTerrainQueryKey: (id: string) => ["user-datasets", id, "terrain"],
  getGetUserDatasetsIdOverviewQueryKey: (id: string) => ["user-datasets", id, "overview"],
  getGetMarkersQueryKey: (p: unknown) => ["markers", p],
}));

describe("DatasetPanel", () => {
  beforeEach(() => {
    setDatasetIdMock.mockClear();
    setTerrainMock.mockClear();
  });

  it("renders datasets matching the current waterType setting (default saltwater)", () => {
    render(<DatasetPanel />);
    expect(screen.getByText("Alaska Fjord")).toBeInTheDocument();
    expect(screen.getByText("Deep saltwater fjord")).toBeInTheDocument();
    expect(screen.getByTestId("btn-dataset-alaska-fjord")).toBeInTheDocument();
    // Freshwater dataset is filtered out under the default saltwater setting.
    expect(screen.queryByText("Lake Tahoe")).not.toBeInTheDocument();
  });

  it("clicking a dataset triggers loading state (pending fetch)", () => {
    render(<DatasetPanel />);
    const btn = screen.getByTestId("btn-dataset-alaska-fjord");
    fireEvent.click(btn);
    // The loading dot (◌) should appear for the clicked dataset
    expect(btn.textContent).toContain("◌");
  });

  it("collapses and expands dataset list when header is clicked", () => {
    render(<DatasetPanel />);
    expect(screen.getByText("Alaska Fjord")).toBeInTheDocument();

    const header = screen.getByText(/▼ Datasets/);
    fireEvent.click(header);
    expect(screen.queryByText("Alaska Fjord")).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.getByText("Alaska Fjord")).toBeInTheDocument();
  });

  it("renders the upload dropzone area after expanding the upload section", () => {
    render(<DatasetPanel />);
    expect(screen.queryByTestId("dropzone-terrain")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/UPLOAD CUSTOM TERRAIN/));
    expect(screen.getByTestId("dropzone-terrain")).toBeInTheDocument();
  });
});
