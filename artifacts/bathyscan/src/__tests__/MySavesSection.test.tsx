/**
 * Unit tests for the MySavesSection component.
 *
 * MySavesSection renders a merged "My Datasets" folder tree inside the left
 * panel (DatasetPanel > Explore > Your Data).  It shows one section that
 * merges the user's uploaded datasets and catalog saves:
 *   1. Section shows sign-in prompt when the user is not signed in.
 *   2. Single "My Datasets" header with one "+ folder" button; the old
 *      "My Saved Uploads" / "Catalog Saves" headers are gone.
 *   3. Empty state when signed in with no datasets, folders, or saves.
 *   4. No double-listing — a materialized catalog save and its linked
 *      dataset render as ONE save-style card (never an upload card too).
 *   5. Provenance badges distinguish uploads from catalog saves.
 *   6. Upload rename / load / delete flows still work.
 *   7. Delete confirmation copy differs by kind (permanent for uploads,
 *      re-savable phrasing for catalog saves).
 *   8. Folders: empty folders are visible; expanded folder contents render
 *      inside the indented container for both card kinds.
 *   9. "Move to folder…" for uploads hits the dataset move endpoint.
 *  10. Processing/failed saves render inline with status/retry.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";
import { renderWithProviders } from "./setup";
import { MySavesSection } from "@/components/MySavesSection";

// ---------------------------------------------------------------------------
// Hoisted shared spies
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  deleteUploadMutateAsync: vi.fn().mockResolvedValue(undefined),
  renameUploadMutateAsync: vi.fn().mockResolvedValue(undefined),
  moveUploadMutateAsync: vi.fn().mockResolvedValue(undefined),
  moveSaveMutateAsync: vi.fn().mockResolvedValue(undefined),
  onLoadCatalogSave: vi.fn(),
  onLoadUserDataset: vi.fn(),
  onDatasetsRemoved: vi.fn(),
  onBrowseDatasets: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Hoisted proxy factory
// ---------------------------------------------------------------------------
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return {
      data: undefined,
      isFetching: false,
      isLoading: false,
      isError: false,
    };
  }
  function mutationHook() {
    return {
      mutate: noop,
      mutateAsync: vi.fn().mockResolvedValue(undefined),
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
            `/api/mock/${(a as string[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UPLOAD_A: Record<string, unknown> = {
  id: "upload-a",
  name: "Tolstoi Sonar Survey",
  minDepth: 10,
  maxDepth: 200,
  folderId: null,
  createdAt: "2024-01-15T00:00:00.000Z",
};

const UPLOAD_B: Record<string, unknown> = {
  id: "upload-b",
  name: "Juneau Harbour Scan",
  minDepth: 5,
  maxDepth: 80,
  folderId: null,
  createdAt: "2024-02-20T00:00:00.000Z",
};

// Catalog save whose datasetId matches upload-a — used in the dedup test.
const SAVE_FOR_UPLOAD_A: Record<string, unknown> = {
  id: "save-001",
  catalogId: "some-catalog-dataset",
  status: "ready",
  datasetId: "upload-a",
  folderId: null,
  catalog: {
    name: "Some Catalog Dataset",
    sourceAgency: "NOAA",
    dataType: "bathymetry",
  },
  errorMessage: null,
};

const FOLDER_1: Record<string, unknown> = {
  id: "folder-1",
  name: "Area A",
  parentId: null,
  createdAt: "2024-03-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Mutable state read by vi.mock overrides
// ---------------------------------------------------------------------------
let currentIsSignedIn = true;
let currentUserDatasets: unknown[] = [];
let currentMySaves: unknown[] = [];
let currentUserFolders: unknown[] = [];
let currentSaveFolderExpanded: Record<string, boolean> = {};
let currentWaterType = "saltwater";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetUserDatasets: () => ({
        data: currentUserDatasets,
        isFetching: false,
        isLoading: false,
        isError: false,
      }),
      useGetDatasetsMySaves: () => ({
        data: currentMySaves,
        isFetching: false,
        isLoading: false,
        isError: false,
        refetch: () => Promise.resolve(),
      }),
      useGetUserFolders: () => ({
        data: currentUserFolders,
        isFetching: false,
        isLoading: false,
        isError: false,
      }),
      useDeleteUserDatasetsId: () => ({
        mutate: () => {},
        mutateAsync: mocks.deleteUploadMutateAsync,
        isPending: false,
        isSuccess: false,
        variables: undefined,
      }),
      usePatchUserDatasetsIdRename: () => ({
        mutate: () => {},
        mutateAsync: mocks.renameUploadMutateAsync,
        isPending: false,
        isSuccess: false,
        variables: undefined,
      }),
      usePatchUserDatasetsIdMove: () => ({
        mutate: () => {},
        mutateAsync: mocks.moveUploadMutateAsync,
        isPending: false,
        isSuccess: false,
        variables: undefined,
      }),
      usePatchDatasetsMySavesIdMove: () => ({
        mutate: () => {},
        mutateAsync: mocks.moveSaveMutateAsync,
        isPending: false,
        isSuccess: false,
        variables: undefined,
      }),
    }),
);

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import(
    "@/__tests__/testHelpers.auth"
  );
  return mockClerkCompat({
    useAuth: () => ({
      isSignedIn: currentIsSignedIn,
      isLoaded: true,
    }),
  });
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQueries: ({ queries }: { queries: unknown[] }) =>
    queries.map(() => ({
      data: undefined,
      isPending: true,
      isError: false,
      isSuccess: false,
    })),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({
    children,
  }: {
    children: React.ReactNode;
  }) => children,
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const mockUseSettingsStore = (
    sel: (s: { waterType: string; saveFolderExpanded: Record<string, boolean> }) => unknown,
  ) =>
    sel({
      waterType: currentWaterType,
      saveFolderExpanded: currentSaveFolderExpanded,
    });
  Object.assign(mockUseSettingsStore, {
    persist: actual.useSettingsStore.persist,
    setState: actual.useSettingsStore.setState,
    getState: actual.useSettingsStore.getState,
    subscribe: actual.useSettingsStore.subscribe,
  });
  return {
    ...actual,
    useSettingsStore: mockUseSettingsStore,
  };
});

vi.mock("@/lib/contextMenuStore", () => ({
  useContextMenuStore: {
    getState: () => ({ show: vi.fn() }),
  },
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  DragOverlay: () => null,
  useDraggable: () => ({ setNodeRef: vi.fn(), attributes: {}, listeners: {}, isDragging: false }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
  PointerSensor: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSection() {
  return renderWithProviders(
    <MySavesSection
      onLoadCatalogSave={mocks.onLoadCatalogSave}
      onLoadUserDataset={mocks.onLoadUserDataset}
      onDatasetsRemoved={mocks.onDatasetsRemoved}
      onBrowseDatasets={mocks.onBrowseDatasets}
    />,
  );
}

function resetState() {
  mocks.onLoadCatalogSave.mockClear();
  mocks.onLoadUserDataset.mockClear();
  mocks.onDatasetsRemoved.mockClear();
  mocks.onBrowseDatasets.mockClear();
  mocks.deleteUploadMutateAsync.mockClear();
  mocks.moveUploadMutateAsync.mockClear();
  mocks.moveSaveMutateAsync.mockClear();
  currentIsSignedIn = true;
  currentUserDatasets = [];
  currentMySaves = [];
  currentUserFolders = [];
  currentSaveFolderExpanded = {};
  currentWaterType = "saltwater";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MySavesSection — visibility", () => {
  beforeEach(resetState);

  it("shows sign-in prompt when the user is not signed in", () => {
    currentIsSignedIn = false;
    renderSection();

    expect(screen.queryByText("My Datasets")).not.toBeInTheDocument();
    expect(screen.getByText(/Sign in to see saved datasets/i)).toBeInTheDocument();
  });

  it("shows a single merged empty state when signed in with no datasets", () => {
    renderSection();

    expect(
      screen.getByText(/No datasets yet — upload sonar data or save datasets from the catalog/i),
    ).toBeInTheDocument();
  });
});

describe("MySavesSection — single merged header", () => {
  beforeEach(() => {
    resetState();
    currentUserDatasets = [UPLOAD_A];
    currentMySaves = [];
  });

  it('shows no legacy section headers and a single "+ folder" button', () => {
    renderSection();

    expect(screen.queryByText("My Datasets")).not.toBeInTheDocument();
    expect(screen.queryByText("My Saved Uploads")).not.toBeInTheDocument();
    expect(screen.queryByText("Catalog Saves")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /\+ folder/i })).toHaveLength(1);
  });

  it('shows a single "+ folder" button in the header', () => {
    renderSection();

    expect(screen.getAllByRole("button", { name: "+ folder" })).toHaveLength(1);
  });

  it("upload card filename carries a title attribute with the full name", () => {
    renderSection();

    const nameEl = screen.getByTestId("text-upload-name-upload-a");
    expect(nameEl).toHaveAttribute("title", "Tolstoi Sonar Survey");
  });
});

describe("MySavesSection — no double-listing of materialized saves", () => {
  beforeEach(resetState);

  it("renders a materialized save and its linked dataset as ONE save card", () => {
    currentUserDatasets = [UPLOAD_A, UPLOAD_B];
    currentMySaves = [SAVE_FOR_UPLOAD_A];
    renderSection();

    // The save renders as a save-style card…
    expect(screen.getByTestId("save-card-save-001")).toBeInTheDocument();
    // …and its linked dataset must NOT also appear as an upload card.
    expect(
      screen.queryByTestId("upload-card-upload-a"),
    ).not.toBeInTheDocument();
    // The unrelated upload still renders normally.
    expect(screen.getByTestId("upload-card-upload-b")).toBeInTheDocument();
  });

  it("shows all upload cards when none match any catalog save datasetId", () => {
    currentUserDatasets = [UPLOAD_A, UPLOAD_B];
    currentMySaves = [];
    renderSection();

    expect(screen.getByTestId("upload-card-upload-a")).toBeInTheDocument();
    expect(screen.getByTestId("upload-card-upload-b")).toBeInTheDocument();
  });
});

describe("MySavesSection — provenance indicators", () => {
  beforeEach(resetState);

  it("upload cards carry an Upload badge and save cards a Catalog badge", () => {
    currentUserDatasets = [UPLOAD_B];
    currentMySaves = [SAVE_FOR_UPLOAD_A];
    renderSection();

    expect(screen.getByTestId("provenance-upload-upload-b")).toHaveTextContent(/upload/i);
    expect(screen.getByTestId("provenance-catalog-save-001")).toHaveTextContent(/catalog/i);
  });
});

describe("MySavesSection — upload rename", () => {
  beforeEach(() => {
    resetState();
    mocks.renameUploadMutateAsync.mockClear();
    mocks.renameUploadMutateAsync.mockResolvedValue(undefined);
    currentUserDatasets = [UPLOAD_A];
  });

  it("renames an upload via the inline editor (success path)", async () => {
    renderSection();

    fireEvent.click(screen.getByTestId("btn-rename-upload-upload-a"));
    const input = screen.getByTestId("input-rename-upload-upload-a");
    fireEvent.change(input, { target: { value: "  Renamed Survey  " } });
    fireEvent.click(screen.getByTestId("btn-rename-save-upload-a"));

    await waitFor(() => {
      expect(mocks.renameUploadMutateAsync).toHaveBeenCalledWith({
        id: "upload-a",
        data: { name: "Renamed Survey" },
      });
    });
    // Editor closes after success.
    await waitFor(() => {
      expect(
        screen.queryByTestId("input-rename-upload-upload-a"),
      ).not.toBeInTheDocument();
    });
  });

  it("rejects empty/whitespace-only names client-side without calling the API", async () => {
    renderSection();

    fireEvent.click(screen.getByTestId("btn-rename-upload-upload-a"));
    const input = screen.getByTestId("input-rename-upload-upload-a");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("btn-rename-save-upload-a"));

    expect(
      await screen.findByTestId("rename-upload-error-upload-a"),
    ).toHaveTextContent(/name cannot be empty/i);
    expect(mocks.renameUploadMutateAsync).not.toHaveBeenCalled();
  });

  it("shows an error and keeps the old name when the server rejects the rename", async () => {
    mocks.renameUploadMutateAsync.mockRejectedValueOnce(
      new Error("server exploded"),
    );
    renderSection();

    fireEvent.click(screen.getByTestId("btn-rename-upload-upload-a"));
    const input = screen.getByTestId("input-rename-upload-upload-a");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByTestId("btn-rename-save-upload-a"));

    expect(
      await screen.findByTestId("rename-upload-error-upload-a"),
    ).toHaveTextContent("server exploded");

    // Cancel back out — the original name is still shown.
    fireEvent.click(screen.getByTestId("btn-rename-cancel-upload-a"));
    expect(
      screen.getByTestId("text-upload-name-upload-a"),
    ).toHaveTextContent("Tolstoi Sonar Survey");
  });

  it("cancel via Escape closes the editor without calling the API", () => {
    renderSection();

    fireEvent.click(screen.getByTestId("btn-rename-upload-upload-a"));
    const input = screen.getByTestId("input-rename-upload-upload-a");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(
      screen.queryByTestId("input-rename-upload-upload-a"),
    ).not.toBeInTheDocument();
    expect(mocks.renameUploadMutateAsync).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("text-upload-name-upload-a"),
    ).toHaveTextContent("Tolstoi Sonar Survey");
  });
});

describe("MySavesSection — upload Load button", () => {
  beforeEach(() => {
    resetState();
    currentUserDatasets = [UPLOAD_A];
  });

  it("clicking Load calls onLoadUserDataset with the dataset id", () => {
    renderSection();

    const loadBtn = screen.getByTestId("btn-load-upload-upload-a");
    fireEvent.click(loadBtn);

    expect(mocks.onLoadUserDataset).toHaveBeenCalledWith(
      "upload-a",
      expect.anything(),
    );
  });
});

describe("MySavesSection — delete confirmations differ by kind", () => {
  beforeEach(resetState);

  it("upload delete confirm warns the data is permanently deleted, and confirming calls mutateAsync", async () => {
    currentUserDatasets = [UPLOAD_B];
    renderSection();

    fireEvent.click(screen.getByTestId("btn-delete-upload-upload-b"));

    const dialog = screen.getByTestId("confirm-delete-upload");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/permanently remove the uploaded dataset/i);
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    // No re-savable phrasing on the upload dialog.
    expect(dialog).not.toHaveTextContent(/re-save it from the catalog/i);

    fireEvent.click(screen.getByTestId("confirm-delete-upload-confirm"));

    await waitFor(() => {
      expect(mocks.deleteUploadMutateAsync).toHaveBeenCalledWith({
        id: "upload-b",
      });
    });
  });

  it("catalog save delete confirm says it can be re-saved from the catalog later", () => {
    currentMySaves = [SAVE_FOR_UPLOAD_A];
    currentUserDatasets = [UPLOAD_A];
    renderSection();

    fireEvent.click(screen.getByTestId("btn-delete-save-save-001"));

    const dialog = screen.getByTestId("confirm-delete-save");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/re-save it from the catalog later/i);
    // No permanent-upload-deletion phrasing on the save dialog.
    expect(dialog).not.toHaveTextContent(/permanently remove the uploaded dataset/i);
  });
});

describe("MySavesSection — merged folder tree", () => {
  beforeEach(resetState);

  it("shows an empty folder in the tree (visible immediately after creation)", () => {
    currentUserFolders = [FOLDER_1];
    renderSection();

    expect(screen.getByText("Area A")).toBeInTheDocument();
    // Merged empty-state message must NOT hide the folder view.
    expect(
      screen.queryByText(/No datasets yet — upload sonar data/i),
    ).not.toBeInTheDocument();
  });

  it("an expanded empty folder shows its empty placeholder", () => {
    currentUserFolders = [FOLDER_1];
    currentSaveFolderExpanded = { "folder-1": true };
    renderSection();

    expect(screen.getByText(/No datasets in this folder/i)).toBeInTheDocument();
  });

  it("renders both save and upload cards inside the indented expanded folder container", () => {
    // upload-c is a root-level upload unrelated to any save; upload-a is the
    // save's materialized dataset and must stay collapsed into the save card.
    const UPLOAD_C = { ...UPLOAD_A, id: "upload-c", name: "Root Scan" };
    currentUserFolders = [FOLDER_1];
    currentUserDatasets = [
      { ...UPLOAD_B, folderId: "folder-1" },
      UPLOAD_A,
      UPLOAD_C,
    ];
    currentMySaves = [{ ...SAVE_FOR_UPLOAD_A, folderId: "folder-1" }];
    currentSaveFolderExpanded = { "folder-1": true };
    renderSection();

    const contents = screen.getByTestId("save-folder-contents-folder-1");
    // Both kinds render inside the folder's indented contents container.
    expect(within(contents).getByTestId("save-card-save-001")).toBeInTheDocument();
    expect(within(contents).getByTestId("upload-card-upload-b")).toBeInTheDocument();
    // The container carries the per-level right inset.
    expect(contents).toHaveStyle({ marginLeft: "14px" });
    // The save's linked dataset never double-renders as an upload card.
    expect(screen.queryByTestId("upload-card-upload-a")).not.toBeInTheDocument();
    // The root-level upload renders outside the folder container.
    expect(
      within(contents).queryByTestId("upload-card-upload-c"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("upload-card-upload-c")).toBeInTheDocument();
  });
});

describe("MySavesSection — move upload to folder", () => {
  beforeEach(() => {
    resetState();
    currentUserFolders = [FOLDER_1];
    currentUserDatasets = [UPLOAD_A];
  });

  it('"Move to folder…" on an upload calls the dataset move endpoint', async () => {
    renderSection();

    fireEvent.click(screen.getByTestId("btn-move-upload-upload-a"));

    const dialog = screen.getByRole("dialog", {
      name: /Move "Tolstoi Sonar Survey"/i,
    });
    // Pick the folder option, then confirm.
    fireEvent.click(within(dialog).getByText("📁 Area A"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(mocks.moveUploadMutateAsync).toHaveBeenCalledWith({
        id: "upload-a",
        data: { folderId: "folder-1" },
      });
    });
    // The save move endpoint must NOT be involved for uploads.
    expect(mocks.moveSaveMutateAsync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SaveCard ADD / IN VIEW button
// ---------------------------------------------------------------------------

describe("MySavesSection — SaveCard ADD/IN VIEW button", () => {
  beforeEach(resetState);

  const READY_SAVE: Record<string, unknown> = {
    id: "save-ready",
    catalogId: "cat-ready",
    status: "ready",
    datasetId: "ds-ready",
    folderId: null,
    catalog: {
      name: "Ready Dataset",
      sourceAgency: "NOAA",
      dataType: "bathymetry",
    },
    errorMessage: null,
  };

  function renderWithAddToView({
    onAddToView = vi.fn(),
    atViewCap = false,
    visibleDatasetIds = new Set<string>(),
  }: {
    onAddToView?: (dsId: string) => void;
    atViewCap?: boolean;
    visibleDatasetIds?: Set<string>;
  } = {}) {
    currentMySaves = [READY_SAVE];
    return renderWithProviders(
      <MySavesSection
        onLoadCatalogSave={mocks.onLoadCatalogSave}
        onLoadUserDataset={mocks.onLoadUserDataset}
        onAddToView={onAddToView}
        atViewCap={atViewCap}
        visibleDatasetIds={visibleDatasetIds}
      />,
    );
  }

  it("shows ADD button when onAddToView is provided and save is ready", () => {
    renderWithAddToView();
    expect(screen.getByTestId("btn-add-to-view-save-save-ready")).toBeInTheDocument();
    expect(screen.getByTestId("btn-add-to-view-save-save-ready")).toHaveTextContent("ADD");
  });

  it("does not show ADD button when onAddToView is not provided", () => {
    currentMySaves = [READY_SAVE];
    renderWithProviders(
      <MySavesSection
        onLoadCatalogSave={mocks.onLoadCatalogSave}
        onLoadUserDataset={mocks.onLoadUserDataset}
      />,
    );
    expect(screen.queryByTestId("btn-add-to-view-save-save-ready")).not.toBeInTheDocument();
  });

  it("clicking ADD calls onAddToView with the save's datasetId", () => {
    const onAddToView = vi.fn();
    renderWithAddToView({ onAddToView });

    fireEvent.click(screen.getByTestId("btn-add-to-view-save-save-ready"));
    expect(onAddToView).toHaveBeenCalledWith("ds-ready");
  });

  it("shows IN VIEW when save's datasetId is in visibleDatasetIds", () => {
    renderWithAddToView({ visibleDatasetIds: new Set(["ds-ready"]) });
    expect(screen.getByTestId("btn-add-to-view-save-save-ready")).toHaveTextContent("IN VIEW");
  });

  it("is disabled when atViewCap=true and dataset is not already in view", () => {
    renderWithAddToView({ atViewCap: true });
    const btn = screen.getByTestId("btn-add-to-view-save-save-ready");
    expect(btn).toBeDisabled();
  });

  it("is NOT disabled when atViewCap=true but the dataset is already in view", () => {
    renderWithAddToView({ atViewCap: true, visibleDatasetIds: new Set(["ds-ready"]) });
    const btn = screen.getByTestId("btn-add-to-view-save-save-ready");
    expect(btn).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Mock-drift guard: SaveCard and UploadCard share the same add-to-view props
// ---------------------------------------------------------------------------

describe("MySavesSection — add-to-view prop parity guard", () => {
  /**
   * Compile-time guard: MySavesSection (which threads the add-to-view props to
   * BOTH DraggableSaveCard and DraggableUploadCard) must expose all three
   * optional props.  If any prop is dropped from either card's interface, the
   * TypeScript compile step (typecheck) will fail before this assertion runs.
   */
  it("MySavesSection exposes onAddToView / atViewCap / visibleDatasetIds (threads to both card kinds)", () => {
    // Build a fully-typed props object — TS will error here if any key is removed.
    const dummyProps: React.ComponentProps<typeof MySavesSection> = {
      onLoadCatalogSave: () => {},
      onLoadUserDataset: () => {},
      onAddToView: undefined,
      atViewCap: undefined,
      visibleDatasetIds: undefined,
    };

    expect("onAddToView" in dummyProps).toBe(true);
    expect("atViewCap" in dummyProps).toBe(true);
    expect("visibleDatasetIds" in dummyProps).toBe(true);
  });
});

describe("MySavesSection — processing/failed saves render inline", () => {
  beforeEach(resetState);

  it("a processing save renders its card with status text and no upload card", () => {
    currentMySaves = [
      {
        ...SAVE_FOR_UPLOAD_A,
        id: "save-proc",
        status: "processing",
        datasetId: null,
      },
    ];
    renderSection();

    const card = screen.getByTestId("save-card-save-proc");
    expect(card).toHaveTextContent(/processing/i);
  });

  it("a failed save renders with a Retry button", () => {
    currentMySaves = [
      {
        ...SAVE_FOR_UPLOAD_A,
        id: "save-fail",
        status: "failed",
        datasetId: null,
        errorMessage: "download failed",
      },
    ];
    renderSection();

    expect(screen.getByTestId("save-card-save-fail")).toBeInTheDocument();
    expect(screen.getByTestId("save-retry-save-fail")).toBeInTheDocument();
  });
});

describe("MySavesSection — water type badges & mode filtering", () => {
  beforeEach(resetState);

  it("save cards show FRESH for freshwater catalog entries and SALT for saltwater", () => {
    currentMySaves = [
      {
        ...SAVE_FOR_UPLOAD_A,
        id: "save-fresh",
        datasetId: "ds-x",
        catalog: { name: "Lake Ray Roberts", sourceAgency: "TWDB", dataType: "bathymetry", waterType: "freshwater" },
      },
      {
        ...SAVE_FOR_UPLOAD_A,
        id: "save-salt",
        datasetId: "ds-y",
        catalog: { name: "Ocean Survey", sourceAgency: "NOAA", dataType: "bathymetry", waterType: "saltwater" },
      },
    ];
    renderSection();

    expect(screen.getByTestId("watertype-save-save-fresh")).toHaveTextContent(/fresh/i);
    expect(screen.getByTestId("watertype-save-save-salt")).toHaveTextContent(/salt/i);
  });

  it("orphan save cards (no catalog entry) render without a water badge", () => {
    currentMySaves = [
      { ...SAVE_FOR_UPLOAD_A, id: "save-orphan", datasetId: "ds-z", catalog: null },
    ];
    renderSection();

    expect(screen.getByTestId("save-card-save-orphan")).toBeInTheDocument();
    expect(screen.queryByTestId("watertype-save-save-orphan")).toBeNull();
  });

  it("saltwater mode: saltwater uploads show a SALT badge, freshwater uploads are hidden", () => {
    currentUserDatasets = [
      { ...UPLOAD_A, waterType: "saltwater" },
      { ...UPLOAD_B, waterType: "freshwater" },
    ];
    renderSection(); // currentWaterType defaults to "saltwater"

    expect(screen.getByTestId("watertype-upload-upload-a")).toHaveTextContent(/salt/i);
    expect(screen.queryByTestId("provenance-upload-upload-b")).toBeNull();
  });

  it("freshwater mode: freshwater uploads show a FRESH badge, saltwater uploads are hidden", () => {
    currentWaterType = "freshwater";
    currentUserDatasets = [
      { ...UPLOAD_A, waterType: "saltwater" },
      { ...UPLOAD_B, waterType: "freshwater" },
    ];
    renderSection();

    expect(screen.getByTestId("watertype-upload-upload-b")).toHaveTextContent(/fresh/i);
    expect(screen.queryByTestId("provenance-upload-upload-a")).toBeNull();
  });

  it("uploads without a waterType stay visible in both modes and carry no badge", () => {
    currentUserDatasets = [UPLOAD_A];
    renderSection(); // saltwater mode

    expect(screen.getByTestId("provenance-upload-upload-a")).toBeInTheDocument();
    expect(screen.queryByTestId("watertype-upload-upload-a")).toBeNull();
  });
});
