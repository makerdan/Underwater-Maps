/**
 * savedViewLabels.test.tsx
 *
 * Regression tests for user-visible label strings in the Saved Views section
 * of the left panel (DatasetPanel) and the terrain context menu.
 *
 * Guards against accidental reversion to "Bookmarks" or similar renames that
 * would break the UI without any TypeScript error.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DatasetPanel } from "@/components/DatasetPanel";
import { buildTerrainMenuItems } from "@/lib/terrainContextMenu";
import type { TerrainData } from "@workspace/api-client-react";
import type { CameraBookmark } from "@/lib/settingsStore";

// ---------------------------------------------------------------------------
// Shared proxy factory for @workspace/api-client-react.
// vi.mock() factories are hoisted before ES imports, so any helpers used
// inside them must be created via vi.hoisted().
// ---------------------------------------------------------------------------
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isLoading: false, isError: false };
  }
  function mutationHook() {
    return {
      mutate: noop,
      mutateAsync: noop,
      isPending: false,
      isSuccess: false,
      variables: undefined,
    };
  }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (
          typeof p === "symbol" ||
          p === "then" ||
          p === "catch" ||
          p === "finally"
        )
          return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k))
          return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) =>
            `/api/mock/${a.filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// ---------------------------------------------------------------------------
// Mutable bookmark state — updated per-test so the settingsStore mock can
// return different bookmark lists without re-importing the module.
// ---------------------------------------------------------------------------
let activeBookmarks: CameraBookmark[] = [];

const FAKE_BOOKMARK: CameraBookmark = {
  id: "bk-1",
  name: "North Wall",
  lon: -122.5,
  lat: 47.6,
  depth: 42,
  heading: 0,
};

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetDatasets: () => ({ data: [], isLoading: false }),
    useGetUserDatasets: () => ({ data: [], isLoading: false }),
    useGetMarkers: () => ({ data: [] }),
  }),
);

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: "test-ds",
    setDatasetId: vi.fn(),
    setTerrain: vi.fn(),
    // terrain.datasetId must be truthy so the bookmarks section renders.
    terrain: { datasetId: "test-ds" },
    mode: "fly",
    pendingExternalUserDatasetId: null,
    setPendingExternalUserDatasetId: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({ useAuth: () => ({ isSignedIn: false, isLoaded: true }) });
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
  QueryClient: class {
    fetchQuery = vi.fn();
    invalidateQueries = vi.fn();
  },
  QueryCache: class { constructor(_opts?: unknown) {} },
  MutationCache: class { constructor(_opts?: unknown) {} },
}));

vi.mock("react-dropzone", () => ({
  useDropzone: () => ({
    getRootProps: () => ({ "data-testid": "dropzone-terrain" }),
    getInputProps: () => ({ "data-testid": "dropzone-input" }),
    isDragActive: false,
  }),
}));

vi.mock("@/lib/terrainStore", () => {
  const state = {
    setGrids: vi.fn(),
    visibleDatasets: [] as Array<{ datasetId: string }>,
    primaryDatasetId: null as string | null,
    hideAllOthers: vi.fn(),
    toggleVisible: vi.fn(),
    addSelected: vi.fn(),
    removeSelected: vi.fn(),
    autoActivate: vi.fn(),
    autoEvict: vi.fn(),
    clearAutoEviction: vi.fn(),
    selectedIds: [] as string[],
    selectedSources: {} as Record<string, string>,
    evictedId: null as string | null,
    autoEvictedId: null as string | null,
    clearEviction: vi.fn(),
  };
  const useTerrainStore = ((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state) as unknown as {
    (sel?: (s: typeof state) => unknown): unknown;
    getState: () => typeof state;
  };
  useTerrainStore.getState = () => state;
  return { useTerrainStore, VISIBLE_DATASETS_CAP: 3, MAX_ACTIVE_DATASETS: 3 };
});

vi.mock("@/lib/uiStore", () => ({
  useUiStore: { getState: () => ({ setPendingDropIn: vi.fn() }) },
}));

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: {
    getState: () => ({ clearZoneMap: vi.fn(), classify: vi.fn() }),
  },
}));

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: ({ onConfirm }: { onConfirm: () => void }) => {
    onConfirm();
  },
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: true }),
}));

vi.mock("@/lib/markerEditStore", () => ({
  useMarkerEditStore: (sel: (s: { editingMarkerId: string | null }) => unknown) =>
    sel({ editingMarkerId: null }),
}));

vi.mock("@/lib/activeLoadStore", () => ({
  useActiveLoadStore: {
    getState: () => ({
      start: vi.fn(),
      update: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      active: null,
    }),
  },
}));

vi.mock("@/lib/markerConstants", () => ({
  MARKER_COLOR: {},
  MARKER_ICON: {},
  SALTWATER_MARKER_TYPES: [],
  FRESHWATER_MARKER_TYPES: [],
}));

vi.mock("@/lib/markerLayerStore", () => ({
  useMarkerLayerStore: () => ({ layers: [] }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useUndoableMarkerDelete", () => ({
  useUndoableMarkerDelete: () => ({ handleDelete: vi.fn() }),
}));

vi.mock("@/lib/fetchWithProgress", () => ({
  fetchJsonWithProgress: vi.fn(),
}));

vi.mock("@/lib/terrain", () => ({
  lonLatToWorldXZ: vi.fn(() => [0, 0]),
  MAX_DEPTH_WORLD: 10000,
}));

vi.mock("@/lib/units", () => ({
  formatDepthRange: (min: number, max: number, units: string) =>
    `${min} ${units} to ${max} ${units}`,
}));

vi.mock("@/components/DatasetFolderTree", () => ({
  DatasetFolderTree: () => null,
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/LoadingDial", () => ({
  LoadingDial: () => null,
}));

vi.mock("@/components/GpsImportDialog", () => ({
  GpsImportDialog: () => null,
}));

vi.mock("@/components/GpsExportDialog", () => ({
  GpsExportDialog: () => null,
}));

/**
 * ViewscreenTooltip mock: passes children through and exposes the tooltip
 * label as a `data-tooltip` attribute so tests can assert label text without
 * triggering the compose-refs / React 19 Radix ref loop.
 */
vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({
    children,
    label,
  }: {
    children: React.ReactNode;
    label: string;
  }) =>
    React.createElement("span", { "data-tooltip": label }, children),
}));

/**
 * settingsStore mock reads from `activeBookmarks` (module-level mutable ref)
 * so individual tests can set bookmarks without re-importing the module.
 */
vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const useSettingsStore = ((
    sel: (s: {
      waterType: "saltwater" | "freshwater";
      units: "metric" | "imperial";
      bookmarks: Record<string, CameraBookmark[]>;
      renameBookmark: () => void;
      deleteBookmark: () => void;
    }) => unknown,
  ) => {
    const state = {
      waterType: "saltwater" as const,
      units: "metric" as const,
      bookmarks: { "test-ds": activeBookmarks },
      renameBookmark: vi.fn(),
      deleteBookmark: vi.fn(),
    };
    return sel(state);
  }) as unknown as {
    (sel: (s: unknown) => unknown): unknown;
    getState: () => unknown;
  };
  useSettingsStore.getState = () => ({
    waterType: "saltwater",
    units: "metric",
    bookmarks: { "test-ds": activeBookmarks },
    renameBookmark: vi.fn(),
    deleteBookmark: vi.fn(),
  });
  return { ...actual, useSettingsStore };
});

// ── Helper ────────────────────────────────────────────────────────────────────

/** Click the SAVED VIEWS accordion header to open it. */
function openSavedViewsSection() {
  const header = screen
    .getAllByRole("button")
    .find((b) => b.textContent?.includes("SAVED VIEWS"));
  if (!header) throw new Error("SAVED VIEWS header button not found in DOM");
  fireEvent.click(header);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Saved Views — user-visible label regression (DatasetPanel)", () => {
  beforeEach(() => {
    activeBookmarks = [];
  });

  it('section header toggle button reads "SAVED VIEWS" (not "BOOKMARKS")', () => {
    render(<DatasetPanel />);

    const header = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("SAVED VIEWS"));

    expect(header).toBeDefined();
    expect(header!.textContent).toMatch(/SAVED VIEWS/);
    expect(header!.textContent).not.toMatch(/BOOKMARK/i);
  });

  it('empty-state copy says "saved view" and does not say "bookmark"', () => {
    render(<DatasetPanel />);
    openSavedViewsSection();

    const emptyMsg = screen.getByText(/No saved views yet/i);
    expect(emptyMsg).toBeInTheDocument();
    expect(emptyMsg.textContent?.toLowerCase()).toContain("saved view");
    expect(emptyMsg.textContent?.toLowerCase()).not.toContain("bookmark");
  });

  describe("bookmark row buttons — with one saved view present", () => {
    beforeEach(() => {
      activeBookmarks = [FAKE_BOOKMARK];
    });

    it('fly button aria-label contains "saved view" (not "bookmark")', () => {
      render(<DatasetPanel />);
      openSavedViewsSection();

      const flyBtn = screen.getByRole("button", {
        name: /fly to this saved view/i,
      });
      expect(flyBtn).toBeInTheDocument();
      expect(flyBtn.getAttribute("aria-label")?.toLowerCase()).toContain(
        "saved view",
      );
      expect(flyBtn.getAttribute("aria-label")?.toLowerCase()).not.toContain(
        "bookmark",
      );
    });

    it('rename button aria-label contains "saved view" (not "bookmark")', () => {
      render(<DatasetPanel />);
      openSavedViewsSection();

      const renameBtn = screen.getByRole("button", {
        name: /rename saved view/i,
      });
      expect(renameBtn).toBeInTheDocument();
      expect(renameBtn.getAttribute("aria-label")?.toLowerCase()).toContain(
        "saved view",
      );
      expect(renameBtn.getAttribute("aria-label")?.toLowerCase()).not.toContain(
        "bookmark",
      );
    });

    it('delete button aria-label contains "saved view" (not "bookmark")', () => {
      render(<DatasetPanel />);
      openSavedViewsSection();

      const deleteBtn = screen.getByRole("button", {
        name: /delete saved view/i,
      });
      expect(deleteBtn).toBeInTheDocument();
      expect(deleteBtn.getAttribute("aria-label")?.toLowerCase()).toContain(
        "saved view",
      );
      expect(deleteBtn.getAttribute("aria-label")?.toLowerCase()).not.toContain(
        "bookmark",
      );
    });

    it('fly button ViewscreenTooltip label says "Fly to this saved view"', () => {
      render(<DatasetPanel />);
      openSavedViewsSection();

      const tooltipWrappers = Array.from(
        document.querySelectorAll<HTMLElement>("[data-tooltip]"),
      );
      const flyTooltip = tooltipWrappers.find((el) => {
        const tip = el.getAttribute("data-tooltip")?.toLowerCase() ?? "";
        return tip.includes("fly to") && tip.includes("saved view");
      });
      expect(flyTooltip).toBeDefined();
      expect(flyTooltip!.getAttribute("data-tooltip")).toBe(
        "Fly to this saved view",
      );
    });

    it('rename button ViewscreenTooltip label says "Rename saved view"', () => {
      render(<DatasetPanel />);
      openSavedViewsSection();

      const tooltipWrappers = Array.from(
        document.querySelectorAll<HTMLElement>("[data-tooltip]"),
      );
      const renameTooltip = tooltipWrappers.find((el) =>
        el.getAttribute("data-tooltip")?.toLowerCase().includes("rename saved view"),
      );
      expect(renameTooltip).toBeDefined();
      expect(renameTooltip!.getAttribute("data-tooltip")).toBe(
        "Rename saved view",
      );
    });

    it('delete button ViewscreenTooltip label says "Delete saved view"', () => {
      render(<DatasetPanel />);
      openSavedViewsSection();

      const tooltipWrappers = Array.from(
        document.querySelectorAll<HTMLElement>("[data-tooltip]"),
      );
      const deleteTooltip = tooltipWrappers.find((el) =>
        el.getAttribute("data-tooltip")?.toLowerCase().includes("delete saved view"),
      );
      expect(deleteTooltip).toBeDefined();
      expect(deleteTooltip!.getAttribute("data-tooltip")).toBe(
        "Delete saved view",
      );
    });
  });
});

// ── terrainContextMenu label tests ────────────────────────────────────────────

function fakeGrid(): TerrainData {
  return {
    datasetId: "ds-1",
    resolution: 2,
    depths: [0, 0, 0, 0],
    minDepth: 0,
    maxDepth: 10,
    minLon: -1,
    maxLon: 1,
    minLat: -1,
    maxLat: 1,
    waterType: "saltwater",
  } as unknown as TerrainData;
}

describe('terrainContextMenu — "Save as saved view…" label', () => {
  it('context menu has an item labelled "Save as saved view…"', () => {
    const items = buildTerrainMenuItems(-122.5, 47.6, 42, "ds-1", () =>
      fakeGrid(),
    );

    const saveItem = items.find((i) =>
      i.label.toLowerCase().includes("saved view"),
    );
    expect(saveItem).toBeDefined();
    expect(saveItem!.label).toBe("Save as saved view…");
  });

  it('context menu does not use the word "bookmark" in any item label', () => {
    const items = buildTerrainMenuItems(-122.5, 47.6, 42, "ds-1", () =>
      fakeGrid(),
    );

    const bookmarkItem = items.find((i) =>
      i.label.toLowerCase().includes("bookmark"),
    );
    expect(bookmarkItem).toBeUndefined();
  });
});
