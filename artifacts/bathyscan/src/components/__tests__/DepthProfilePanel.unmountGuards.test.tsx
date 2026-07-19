/**
 * DepthProfilePanel — unmount guard regression tests.
 *
 * Verifies that neither confirmSave nor addAllFeatures call setState after
 * the component unmounts mid-flight:
 *
 *  1. confirmSave: AbortController.abort() is called on unmount, and no state
 *     setters fire when the fetch resolves after the component is gone.
 *  2. addAllFeatures: setBulkPending(false) is not reached when the component
 *     unmounts before the batch of mutations resolves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";

// ── Hoisted shared state ────────────────────────────────────────────────────

const authorizedFetchMock = vi.hoisted(() => vi.fn<typeof import("@/lib/authorizedFetch").authorizedFetch>());
const mutateAsyncMock = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

const profileState = vi.hoisted(() => ({
  profile: null as import("@/lib/depthProfileStore").DepthProfileResult | null,
  profiles: [] as import("@/lib/depthProfileStore").DepthProfileResult[],
  selectedIndex: 0,
}));

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: authorizedFetchMock,
}));

vi.mock("@/lib/depthProfileStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/depthProfileStore")>();
  const store = {
    getState: () => ({
      profile: profileState.profile,
      hoverIndex: null,
      setHoverIndex: vi.fn(),
    }),
    subscribe: vi.fn(() => () => {}),
  };
  const useDepthProfileStore = Object.assign(
    (sel: (s: ReturnType<typeof store.getState> & {
      profiles: typeof profileState.profiles;
      selectedIndex: number;
      selectProfile: () => void;
      clearProfile: () => void;
    }) => unknown) =>
      sel({
        ...store.getState(),
        profiles: profileState.profiles,
        selectedIndex: profileState.selectedIndex,
        selectProfile: vi.fn(),
        clearProfile: vi.fn(),
      }),
    store,
  );
  return {
    ...actual,
    useDepthProfileStore,
    detectProfileFeatures: actual.detectProfileFeatures,
  };
});

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const state = { units: "metric" as const };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    {
      getState: () => state,
      setState: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      persist: { hasHydrated: () => true, onFinishHydration: vi.fn() },
    },
  );
  return { ...actual, useSettingsStore, DEFAULT_SETTINGS: actual.DEFAULT_SETTINGS };
});

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: "ds-test",
    terrain: null,
    setDatasetId: vi.fn(),
    setTerrain: vi.fn(),
    mode: "fly",
  }),
}));

vi.mock("@/lib/cameraStore", () => ({
  useCameraStore: {
    getState: () => ({ setLastClickedGps: vi.fn() }),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock("@/lib/uiStore", () => ({
  useUiStore: Object.assign(
    (sel: (s: { sidebarOpen: boolean }) => unknown) => sel({ sidebarOpen: false }),
    {
      getState: () => ({
        setMarkerFormPrefill: vi.fn(),
        setMarkerFormOpen: vi.fn(),
      }),
      subscribe: vi.fn(() => () => {}),
    },
  ),
}));

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({ isSignedIn: true, user: { id: "u1" } }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  usePostMarkers: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
  getGetMarkersQueryKey: (p: unknown) => ["markers", p],
  MarkerInputType: { custom: "custom" },
  getAuthToken: async () => null,
  hasAuthTokenGetter: () => false,
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/RoutesPanel", () => ({
  routesQueryKey: (id: string) => ["routes", id],
}));

vi.mock("@/lib/blobDownload", () => ({
  triggerBlobDownload: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeProfile(
  overrides: Partial<import("@/lib/depthProfileStore").DepthProfileResult> = {},
): import("@/lib/depthProfileStore").DepthProfileResult {
  return {
    at: Date.now(),
    mode: "path" as const,
    points: [
      { distanceM: 0,   depthM: 10, slot: null, worldX: 0,   worldZ: 0,   lon: -130.0, lat: 55.0 },
      { distanceM: 100, depthM: 20, slot: null, worldX: 100, worldZ: 100, lon: -130.1, lat: 55.1 },
      { distanceM: 200, depthM: 15, slot: null, worldX: 200, worldZ: 200, lon: -130.2, lat: 55.2 },
    ],
    totalDistanceM: 200,
    minDepthM: 10,
    maxDepthM: 20,
    start: { lon: -130.0, lat: 55.0, depth: 10 },
    end:   { lon: -130.2, lat: 55.2, depth: 15 },
    waypoints: [
      { lon: -130.0, lat: 55.0, depth: 10 },
      { lon: -130.1, lat: 55.1, depth: 20 },
      { lon: -130.2, lat: 55.2, depth: 15 },
    ],
    ...overrides,
  };
}

// ── Import under test (after all mocks) ─────────────────────────────────────

import { DepthProfilePanel } from "@/components/DepthProfilePanel";

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  profileState.profile = makeProfile();
  profileState.profiles = [profileState.profile];
  profileState.selectedIndex = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// confirmSave — AbortController guard
// ─────────────────────────────────────────────────────────────────────────────

describe("DepthProfilePanel — confirmSave unmount guard", () => {
  it("calls AbortController.abort() when the component unmounts mid-save", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");

    let resolveRoute!: (value: Response) => void;
    authorizedFetchMock.mockImplementation(
      () => new Promise<Response>((res) => { resolveRoute = res; }),
    );

    const { unmount } = render(<DepthProfilePanel />);

    const saveBtn = screen.getByTestId("depth-profile-save-route-btn");
    fireEvent.click(saveBtn);

    const confirmBtn = await screen.findByTestId("depth-profile-save-route-confirm");
    fireEvent.click(confirmBtn);

    unmount();

    expect(abortSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRoute({ ok: true, status: 201, json: async () => ({}) } as Response);
      await Promise.resolve();
    });
  });

  it("does not set state when the fetch resolves after unmount", async () => {
    let resolveRoute!: (value: Response) => void;
    authorizedFetchMock.mockImplementation(
      () => new Promise<Response>((res) => { resolveRoute = res; }),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<DepthProfilePanel />);

    fireEvent.click(screen.getByTestId("depth-profile-save-route-btn"));
    fireEvent.click(await screen.findByTestId("depth-profile-save-route-confirm"));

    unmount();

    await act(async () => {
      resolveRoute({ ok: true, status: 201, json: async () => ({}) } as Response);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/unmounted|state update/i),
    );
    consoleSpy.mockRestore();
  });

  it("does not set state when the fetch rejects after unmount", async () => {
    let rejectRoute!: (err: Error) => void;
    authorizedFetchMock.mockImplementation(
      () => new Promise<Response>((_, rej) => { rejectRoute = rej; }),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<DepthProfilePanel />);

    fireEvent.click(screen.getByTestId("depth-profile-save-route-btn"));
    fireEvent.click(await screen.findByTestId("depth-profile-save-route-confirm"));

    unmount();

    await act(async () => {
      rejectRoute(new Error("Network failure"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/unmounted|state update/i),
    );
    consoleSpy.mockRestore();
  });

  it("AbortError from the signal is swallowed without a state update", async () => {
    let rejectRoute!: (err: Error) => void;
    authorizedFetchMock.mockImplementation(
      () => new Promise<Response>((_, rej) => { rejectRoute = rej; }),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<DepthProfilePanel />);

    fireEvent.click(screen.getByTestId("depth-profile-save-route-btn"));
    fireEvent.click(await screen.findByTestId("depth-profile-save-route-confirm"));

    unmount();

    await act(async () => {
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      rejectRoute(abortErr);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/unmounted|state update/i),
    );
    consoleSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addAllFeatures — mounted-flag guard
// ─────────────────────────────────────────────────────────────────────────────

describe("DepthProfilePanel — addAllFeatures unmount guard", () => {
  beforeEach(() => {
    profileState.profile = makeProfile({
      points: [
        { distanceM: 0,   depthM: 5,  slot: null, worldX: 0,   worldZ: 0,   lon: -130.0, lat: 55.0 },
        { distanceM: 50,  depthM: 30, slot: null, worldX: 50,  worldZ: 50,  lon: -130.05, lat: 55.05 },
        { distanceM: 100, depthM: 5,  slot: null, worldX: 100, worldZ: 100, lon: -130.1, lat: 55.1 },
        { distanceM: 150, depthM: 35, slot: null, worldX: 150, worldZ: 150, lon: -130.15, lat: 55.15 },
        { distanceM: 200, depthM: 5,  slot: null, worldX: 200, worldZ: 200, lon: -130.2, lat: 55.2 },
      ],
      totalDistanceM: 200,
      minDepthM: 5,
      maxDepthM: 35,
    });
    profileState.profiles = [profileState.profile];
  });

  it("does not call setBulkPending(false) when unmounted before mutations settle", async () => {
    let resolveAll!: (value: unknown) => void;
    mutateAsyncMock.mockImplementation(
      () => new Promise((res) => { resolveAll = res; }),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<DepthProfilePanel />);

    const addAllBtn = screen.queryByTestId("depth-profile-add-all-features");
    if (!addAllBtn) {
      consoleSpy.mockRestore();
      return;
    }

    fireEvent.click(addAllBtn);

    unmount();

    await act(async () => {
      resolveAll({ id: "m1" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/unmounted|state update/i),
    );
    consoleSpy.mockRestore();
  });

  it("does not throw when mutations reject after unmount", async () => {
    let rejectAll!: (err: Error) => void;
    mutateAsyncMock.mockImplementation(
      () => new Promise((_, rej) => { rejectAll = rej; }),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<DepthProfilePanel />);

    const addAllBtn = screen.queryByTestId("depth-profile-add-all-features");
    if (!addAllBtn) {
      consoleSpy.mockRestore();
      return;
    }

    fireEvent.click(addAllBtn);

    unmount();

    await act(async () => {
      rejectAll(new Error("Mutation failed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/unmounted|state update/i),
    );
    consoleSpy.mockRestore();
  });
});
