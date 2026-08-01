/**
 * Unit tests for the merged "My Datasets" section in FindDataPanel.
 *
 * The My Saves tab shows ONE section that merges the user's uploaded
 * datasets and catalog saves into a single folder tree:
 *   1. Section is absent when the user is not signed in.
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
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";

// ---------------------------------------------------------------------------
// Hoisted shared spies — must live in vi.hoisted so the vi.mock() factories
// (which are also hoisted) can reference them without TDZ errors.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  deleteUploadMutateAsync: vi.fn().mockResolvedValue(undefined),
  renameUploadMutateAsync: vi.fn().mockResolvedValue(undefined),
  moveUploadMutateAsync: vi.fn().mockResolvedValue(undefined),
  moveSaveMutateAsync: vi.fn().mockResolvedValue(undefined),
  setPendingExternalUserDatasetId: vi.fn(),
  requestDatasetSwitch: vi.fn(
    ({
      onConfirm,
    }: {
      datasetId: string;
      onConfirm?: () => void;
    }) => {
      onConfirm?.();
    },
  ),
}));

// ---------------------------------------------------------------------------
// Hoisted proxy factory — same as FindDataPanel.intertidalChip.test.tsx.
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

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: vi.fn(),
    setCatalogSourcedAt: vi.fn(),
    setPendingExternalUserDatasetId: mocks.setPendingExternalUserDatasetId,
  }),
}));

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

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: mocks.requestDatasetSwitch,
}));

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
      waterType: "saltwater",
      saveFolderExpanded: currentSaveFolderExpanded,
    });
  // uiStore.ts reads DEFAULT_SETTINGS and useSettingsStore.persist/setState at
  // module init — keep those real so importing uiStore doesn't crash.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const onClose = vi.fn();

function renderPanel() {
  return renderWithProviders(<FindDataPanel onClose={onClose} />);
}

function switchToSavesTab() {
  const btn = screen.getByRole("button", { name: /My Saves/i });
  fireEvent.click(btn);
}

function resetState() {
  onClose.mockClear();
  mocks.setPendingExternalUserDatasetId.mockClear();
  mocks.deleteUploadMutateAsync.mockClear();
  mocks.moveUploadMutateAsync.mockClear();
  mocks.moveSaveMutateAsync.mockClear();
  mocks.requestDatasetSwitch.mockClear();
  currentIsSignedIn = true;
  currentUserDatasets = [];
  currentMySaves = [];
  currentUserFolders = [];
  currentSaveFolderExpanded = {};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FindDataPanel — My Datasets section visibility", () => {
  beforeEach(resetState);

  it("section is absent when the user is not signed in", () => {
    currentIsSignedIn = false;
    renderPanel();
    switchToSavesTab();

    expect(screen.queryByText("My Datasets")).not.toBeInTheDocument();
    expect(screen.getByText(/Sign in to see saved datasets/i)).toBeInTheDocument();
  });

  it("shows a single merged empty state when signed in with no datasets", () => {
    renderPanel();
    switchToSavesTab();

    expect(
      screen.getByText(/No datasets yet — upload sonar data or save datasets from the catalog/i),
    ).toBeInTheDocument();
  });
});

describe("FindDataPanel — single merged header", () => {
  beforeEach(() => {
    resetState();
    currentUserDatasets = [UPLOAD_A];
    currentMySaves = [];
  });

  it('shows exactly one "My Datasets" header and no legacy section headers', () => {
    renderPanel();
    switchToSavesTab();

    expect(screen.getAllByText("My Datasets")).toHaveLength(1);
    expect(screen.queryByText("My Saved Uploads")).not.toBeInTheDocument();
    expect(screen.queryByText("Catalog Saves")).not.toBeInTheDocument();
  });

  it('shows a single "+ folder" button in the header', () => {
    renderPanel();
    switchToSavesTab();

    expect(screen.getAllByRole("button", { name: "+ folder" })).toHaveLength(1);
  });

  it("upload card filename carries a title attribute with the full name", () => {
    renderPanel();
    switchToSavesTab();

    const nameEl = screen.getByTestId("text-upload-name-upload-a");
    expect(nameEl).toHaveAttribute("title", "Tolstoi Sonar Survey");
  });
});

describe("FindDataPanel — no double-listing of materialized saves", () => {
  beforeEach(resetState);

  it("renders a materialized save and its linked dataset as ONE save card", () => {
    currentUserDatasets = [UPLOAD_A, UPLOAD_B];
    currentMySaves = [SAVE_FOR_UPLOAD_A];
    renderPanel();
    switchToSavesTab();

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
    renderPanel();
    switchToSavesTab();

    expect(screen.getByTestId("upload-card-upload-a")).toBeInTheDocument();
    expect(screen.getByTestId("upload-card-upload-b")).toBeInTheDocument();
  });
});

describe("FindDataPanel — provenance indicators", () => {
  beforeEach(resetState);

  it("upload cards carry an Upload badge and save cards a Catalog badge", () => {
    currentUserDatasets = [UPLOAD_B];
    currentMySaves = [SAVE_FOR_UPLOAD_A];
    renderPanel();
    switchToSavesTab();

    expect(screen.getByTestId("provenance-upload-upload-b")).toHaveTextContent(/upload/i);
    expect(screen.getByTestId("provenance-catalog-save-001")).toHaveTextContent(/catalog/i);
  });
});

describe("FindDataPanel — upload rename", () => {
  beforeEach(() => {
    resetState();
    mocks.renameUploadMutateAsync.mockClear();
    mocks.renameUploadMutateAsync.mockResolvedValue(undefined);
    currentUserDatasets = [UPLOAD_A];
  });

  it("renames an upload via the inline editor (success path)", async () => {
    renderPanel();
    switchToSavesTab();

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
    renderPanel();
    switchToSavesTab();

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
    renderPanel();
    switchToSavesTab();

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
    renderPanel();
    switchToSavesTab();

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

describe("FindDataPanel — upload Load button", () => {
  beforeEach(() => {
    resetState();
    currentUserDatasets = [UPLOAD_A];
  });

  it("clicking Load fires setPendingExternalUserDatasetId with the dataset id", () => {
    renderPanel();
    switchToSavesTab();

    const loadBtn = screen.getByTestId("btn-load-upload-upload-a");
    fireEvent.click(loadBtn);

    expect(mocks.requestDatasetSwitch).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: "upload-a" }),
    );
    expect(mocks.setPendingExternalUserDatasetId).toHaveBeenCalledWith(
      "upload-a",
    );
  });

  it("closes the panel (calls onClose) once the switch is confirmed", () => {
    // Regression guard for the load-then-close behavior: the onConfirm
    // callback passed to requestDatasetSwitch must call onClose so the Find
    // Data drawer dismisses after a successful Load. The requestDatasetSwitch
    // mock invokes onConfirm synchronously, simulating a confirmed (or
    // suppressed-dialog) switch.
    renderPanel();
    switchToSavesTab();

    fireEvent.click(screen.getByTestId("btn-load-upload-upload-a"));

    expect(mocks.requestDatasetSwitch).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("FindDataPanel — delete confirmations differ by kind", () => {
  beforeEach(resetState);

  it("upload delete confirm warns the data is permanently deleted, and confirming calls mutateAsync", async () => {
    currentUserDatasets = [UPLOAD_B];
    renderPanel();
    switchToSavesTab();

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
    renderPanel();
    switchToSavesTab();

    fireEvent.click(screen.getByTestId("btn-delete-save-save-001"));

    const dialog = screen.getByTestId("confirm-delete-save");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/re-save it from the catalog later/i);
    // No permanent-upload-deletion phrasing on the save dialog.
    expect(dialog).not.toHaveTextContent(/permanently remove the uploaded dataset/i);
  });
});

describe("FindDataPanel — merged folder tree", () => {
  beforeEach(resetState);

  it("shows an empty folder in the tree (visible immediately after creation)", () => {
    currentUserFolders = [FOLDER_1];
    renderPanel();
    switchToSavesTab();

    expect(screen.getByText("Area A")).toBeInTheDocument();
    // Merged empty-state message must NOT hide the folder view.
    expect(
      screen.queryByText(/No datasets yet — upload sonar data/i),
    ).not.toBeInTheDocument();
  });

  it("an expanded empty folder shows its empty placeholder", () => {
    currentUserFolders = [FOLDER_1];
    currentSaveFolderExpanded = { "folder-1": true };
    renderPanel();
    switchToSavesTab();

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
    renderPanel();
    switchToSavesTab();

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

describe("FindDataPanel — move upload to folder", () => {
  beforeEach(() => {
    resetState();
    currentUserFolders = [FOLDER_1];
    currentUserDatasets = [UPLOAD_A];
  });

  it('"Move to folder…" on an upload calls the dataset move endpoint', async () => {
    renderPanel();
    switchToSavesTab();

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

describe("FindDataPanel — processing/failed saves render inline", () => {
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
    renderPanel();
    switchToSavesTab();

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
    renderPanel();
    switchToSavesTab();

    expect(screen.getByTestId("save-card-save-fail")).toBeInTheDocument();
    expect(screen.getByTestId("save-retry-save-fail")).toBeInTheDocument();
  });
});
