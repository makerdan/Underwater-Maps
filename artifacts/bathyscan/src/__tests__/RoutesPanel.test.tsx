/**
 * RoutesPanel.test.tsx — tests for the "Save as route" button flow
 * that lives in DepthProfilePanel.
 *
 * Covers:
 *  - The save-as-route section is visible only for path profiles with ≥2 waypoints
 *  - The section is absent for straight-line ("line") profiles
 *  - Clicking "SAVE AS ROUTE…" for a guest (not signed in) shows the sign-in prompt
 *  - Clicking "SAVE AS ROUTE…" for a signed-in user shows the name input
 *  - Confirming the save calls POST /api/routes and then invalidates the routes query
 *  - Cancelling the save input hides it without making a network request
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { DepthProfilePanel } from "@/components/DepthProfilePanel";
import { RoutesPanel } from "@/components/RoutesPanel";

// ── Shared mutable state ──────────────────────────────────────────────────────
let isSignedIn = true;
const invalidateQueriesSpy = vi.fn();
const fetchSpy = vi.fn();

type TerrainStub = { dataSource?: string; synthetic?: boolean } | null;
let mockTerrain: TerrainStub = null;
let mockDatasetId: string | null = "ds-1";

// ── Profile fixtures ──────────────────────────────────────────────────────────
const PATH_PROFILE = {
  mode: "path" as const,
  waypoints: [
    { lon: -122.0, lat: 37.0, depth: 10 },
    { lon: -122.1, lat: 37.1, depth: 20 },
  ],
  points: [
    { distanceM: 0,    depthM: 10, slot: null, worldX: 0,   worldZ: 0,   lon: -122.0, lat: 37.0 },
    { distanceM: 5000, depthM: 20, slot: null, worldX: 100, worldZ: 100, lon: -122.1, lat: 37.1 },
  ],
  totalDistanceM: 5000,
  minDepthM: 10,
  maxDepthM: 20,
  start: { lon: -122.0, lat: 37.0, depth: 10 },
  end:   { lon: -122.1, lat: 37.1, depth: 20 },
  at: 1_700_000_000_000,
};

const LINE_PROFILE = {
  ...PATH_PROFILE,
  mode: "line" as const,
  waypoints: undefined,
};

let activeProfile: typeof PATH_PROFILE | typeof LINE_PROFILE | null = PATH_PROFILE;

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/depthProfileStore", () => {
  const store = {
    profile: null as unknown,
    profiles: [] as unknown[],
    selectedIndex: 0,
    hoverIndex: null,
    pushProfile: vi.fn(),
    clearProfile: vi.fn(),
    setHoverIndex: vi.fn(),
    selectProfile: vi.fn(),
  };

  const useDepthProfileStore = Object.assign(
    (sel: (s: typeof store) => unknown) => {
      store.profile = activeProfile;
      store.profiles = activeProfile ? [activeProfile] : [];
      return sel(store);
    },
    { getState: () => ({ ...store, profile: activeProfile, profiles: activeProfile ? [activeProfile] : [] }) },
  );

  return {
    useDepthProfileStore,
    detectProfileFeatures: vi.fn(() => []),
    buildPathProfile: vi.fn(),
    depthMetresToWorldY: vi.fn(() => 0),
  };
});

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({ isSignedIn, user: isSignedIn ? { id: "user-a" } : null }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ datasetId: mockDatasetId, terrain: mockTerrain }),
}));

vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: (sel: (s: { collapsed: Record<string, boolean>; toggle: () => void }) => unknown) =>
    sel({ collapsed: {}, toggle: vi.fn() }),
}));

vi.mock("@/lib/flyRouteStore", () => ({
  useFlyRouteStore: Object.assign(
    (sel: (s: { active: boolean }) => unknown) => sel({ active: false }),
    { getState: () => ({ startFly: vi.fn(), stopFly: vi.fn() }) },
  ),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: { units: string }) => unknown) =>
    sel({ units: "metric" }),
}));

vi.mock("@/lib/cameraStore", () => ({
  useCameraStore: Object.assign(
    (sel: (s: { lastClickedGps: null }) => unknown) => sel({ lastClickedGps: null }),
    { getState: () => ({ setLastClickedGps: vi.fn() }) },
  ),
}));

vi.mock("@/lib/uiStore", () => ({
  useUiStore: Object.assign(
    (sel: (s: { markerFormOpen: boolean }) => unknown) => sel({ markerFormOpen: false }),
    { getState: () => ({ setMarkerFormOpen: vi.fn(), setMarkerFormPrefill: vi.fn() }) },
  ),
}));

vi.mock("@/lib/units", () => ({
  formatDistance: (_m: number, _opts: unknown) => "5.0 km",
  formatDepth: (_m: number, _opts: unknown) => "20.0 m",
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesSpy }),
  useQuery: () => ({ data: undefined, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@workspace/api-client-react", () => ({
  usePostMarkers: () => ({ mutateAsync: vi.fn(), isPending: false }),
  getGetMarkersQueryKey: (params: unknown) => ["markers", params],
  MarkerInputType: { custom: "custom" },
}));

// routesQueryKey is a tiny pure function; let the real module run.
// No need to mock @/components/RoutesPanel.

// ── Global fetch mock ─────────────────────────────────────────────────────────
beforeEach(() => {
  invalidateQueriesSpy.mockClear();
  fetchSpy.mockClear();
  isSignedIn = true;
  activeProfile = PATH_PROFILE;
  mockTerrain = null;
  mockDatasetId = "ds-1";

  globalThis.fetch = fetchSpy;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DepthProfilePanel — save-as-route section visibility", () => {
  it("shows the save-as-route section for a path profile with ≥2 waypoints", () => {
    activeProfile = PATH_PROFILE;
    renderWithProviders(<DepthProfilePanel />);
    expect(screen.getByTestId("depth-profile-save-route")).toBeInTheDocument();
    expect(screen.getByTestId("depth-profile-save-route-btn")).toBeInTheDocument();
  });

  it("hides the save-as-route section for a straight-line (non-path) profile", () => {
    activeProfile = LINE_PROFILE;
    renderWithProviders(<DepthProfilePanel />);
    expect(screen.queryByTestId("depth-profile-save-route")).not.toBeInTheDocument();
  });

  it("hides the save-as-route section when profile has fewer than 2 waypoints", () => {
    activeProfile = {
      ...PATH_PROFILE,
      waypoints: [{ lon: -122.0, lat: 37.0, depth: 10 }],
    };
    renderWithProviders(<DepthProfilePanel />);
    expect(screen.queryByTestId("depth-profile-save-route")).not.toBeInTheDocument();
  });

  it("renders nothing when there is no active profile", () => {
    activeProfile = null;
    const { container } = renderWithProviders(<DepthProfilePanel />);
    expect(container.firstChild).toBeNull();
  });
});

describe("DepthProfilePanel — save-as-route button — guest (not signed in)", () => {
  it("shows the sign-in prompt when a guest clicks the save button", () => {
    isSignedIn = false;
    renderWithProviders(<DepthProfilePanel />);

    fireEvent.click(screen.getByTestId("depth-profile-save-route-btn"));

    expect(screen.getByText(/sign in to save routes/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Route name")).not.toBeInTheDocument();
  });

  it("dismisses the guest prompt via the ✕ button", () => {
    isSignedIn = false;
    renderWithProviders(<DepthProfilePanel />);

    fireEvent.click(screen.getByTestId("depth-profile-save-route-btn"));
    expect(screen.getByText(/sign in to save routes/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Dismiss sign-in prompt"));
    expect(screen.queryByText(/sign in to save routes/i)).not.toBeInTheDocument();
  });
});

describe("DepthProfilePanel — save-as-route button — signed in", () => {
  it("shows the name input and confirm/cancel buttons after clicking save", () => {
    renderWithProviders(<DepthProfilePanel />);

    fireEvent.click(screen.getByTestId("depth-profile-save-route-btn"));

    expect(screen.getByPlaceholderText("Route name")).toBeInTheDocument();
    expect(screen.getByTestId("depth-profile-save-route-confirm")).toBeInTheDocument();
    expect(screen.getByTestId("depth-profile-save-route-cancel")).toBeInTheDocument();
  });

  it("hides the input and makes no network request when cancel is clicked", () => {
    renderWithProviders(<DepthProfilePanel />);

    fireEvent.click(screen.getByTestId("depth-profile-save-route-btn"));
    fireEvent.click(screen.getByTestId("depth-profile-save-route-cancel"));

    expect(screen.queryByPlaceholderText("Route name")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pressing Escape cancels without a network request", () => {
    renderWithProviders(<DepthProfilePanel />);

    fireEvent.click(screen.getByTestId("depth-profile-save-route-btn"));
    const input = screen.getByPlaceholderText("Route name");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByPlaceholderText("Route name")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs to /api/routes and invalidates the routes query on successful save", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "new-route-id", name: "My Route" }),
    });

    renderWithProviders(<DepthProfilePanel />);

    fireEvent.click(screen.getByTestId("depth-profile-save-route-btn"));

    const input = screen.getByPlaceholderText("Route name");
    fireEvent.change(input, { target: { value: "My Test Route" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("depth-profile-save-route-confirm"));
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/routes");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ datasetId: "ds-1", name: "My Test Route" });

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: expect.arrayContaining(["routes", "ds-1"]) }),
      );
    });

    expect(screen.queryByPlaceholderText("Route name")).not.toBeInTheDocument();
  });

  it("shows an error message when the server responds with a non-ok status", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ details: "name too long" }),
    });

    renderWithProviders(<DepthProfilePanel />);

    fireEvent.click(screen.getByTestId("depth-profile-save-route-btn"));
    const input = screen.getByPlaceholderText("Route name");
    fireEvent.change(input, { target: { value: "Bad Name" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("depth-profile-save-route-confirm"));
    });

    await waitFor(() => {
      expect(screen.getByText("name too long")).toBeInTheDocument();
    });

    expect(invalidateQueriesSpy).not.toHaveBeenCalled();
  });

  it("shows a network error message when fetch throws", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("offline"));

    renderWithProviders(<DepthProfilePanel />);

    fireEvent.click(screen.getByTestId("depth-profile-save-route-btn"));
    const input = screen.getByPlaceholderText("Route name");
    fireEvent.change(input, { target: { value: "Some Route" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("depth-profile-save-route-confirm"));
    });

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });

    expect(invalidateQueriesSpy).not.toHaveBeenCalled();
  });
});

// ── RoutesPanel — synthetic terrain guard ─────────────────────────────────────

describe("RoutesPanel — synthetic terrain guard", () => {
  it("shows the simulated-data message when dataSource is 'synthetic' and hides the route list", () => {
    isSignedIn = true;
    mockDatasetId = "ds-real";
    mockTerrain = { dataSource: "synthetic" };

    renderWithProviders(<RoutesPanel />);

    expect(screen.getByTestId("routes-panel-synthetic-msg")).toBeInTheDocument();
    expect(screen.getByText(/routes are not available for simulated data/i)).toBeInTheDocument();
    expect(screen.queryByTestId(/^route-entry-/)).not.toBeInTheDocument();
  });

  it("shows the simulated-data message when legacy synthetic flag is true", () => {
    isSignedIn = true;
    mockDatasetId = "ds-real";
    mockTerrain = { synthetic: true };

    renderWithProviders(<RoutesPanel />);

    expect(screen.getByTestId("routes-panel-synthetic-msg")).toBeInTheDocument();
    expect(screen.queryByTestId(/^route-entry-/)).not.toBeInTheDocument();
  });

  it("does NOT show the simulated-data message for a real dataset (dataSource = 'gebco')", () => {
    isSignedIn = true;
    mockDatasetId = "ds-real";
    mockTerrain = { dataSource: "gebco" };

    renderWithProviders(<RoutesPanel />);

    expect(screen.queryByTestId("routes-panel-synthetic-msg")).not.toBeInTheDocument();
  });

  it("still shows sign-in message (not simulated-data message) for a signed-out user with synthetic terrain", () => {
    isSignedIn = false;
    mockDatasetId = "ds-real";
    mockTerrain = { dataSource: "synthetic" };

    renderWithProviders(<RoutesPanel />);

    expect(screen.getByText(/sign in to save and view routes/i)).toBeInTheDocument();
    expect(screen.queryByTestId("routes-panel-synthetic-msg")).not.toBeInTheDocument();
  });

  it("still shows 'load a dataset' message when datasetId is null regardless of terrain", () => {
    isSignedIn = true;
    mockDatasetId = null;
    mockTerrain = { dataSource: "synthetic" };

    renderWithProviders(<RoutesPanel />);

    expect(screen.getByText(/load a dataset to view routes/i)).toBeInTheDocument();
    expect(screen.queryByTestId("routes-panel-synthetic-msg")).not.toBeInTheDocument();
  });
});
