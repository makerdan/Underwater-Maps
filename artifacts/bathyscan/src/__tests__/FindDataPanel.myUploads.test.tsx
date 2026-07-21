/**
 * Unit tests for the "My Uploads" section in FindDataPanel.
 *
 * Coverage:
 *   1. My Uploads section is absent when the user is not signed in.
 *   2. Empty state ("No uploaded datasets yet") when signed in but no uploads.
 *   3. Upload cards render and deduplicate against catalog saves — a dataset
 *      already represented as a catalog save must not appear in My Uploads.
 *   4. Clicking "Load" on an upload card fires setPendingExternalUserDatasetId
 *      with the dataset's id.
 *   5. Clicking the delete button triggers the confirmation dialog, and
 *      confirming calls useDeleteUserDatasetsId.mutateAsync({ id }).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";

// ---------------------------------------------------------------------------
// Hoisted shared spies — must live in vi.hoisted so the vi.mock() factories
// (which are also hoisted) can reference them without TDZ errors.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  deleteUploadMutateAsync: vi.fn().mockResolvedValue(undefined),
  renameUploadMutateAsync: vi.fn().mockResolvedValue(undefined),
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
  catalog: {
    name: "Some Catalog Dataset",
    sourceAgency: "NOAA",
    dataType: "bathymetry",
  },
  errorMessage: null,
};

// ---------------------------------------------------------------------------
// Mutable state read by vi.mock overrides
// ---------------------------------------------------------------------------
let currentIsSignedIn = true;
let currentUserDatasets: unknown[] = [];
let currentMySaves: unknown[] = [];

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
  const mockUseSettingsStore = (sel: (s: { waterType: string }) => unknown) =>
    sel({ waterType: "saltwater" });
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FindDataPanel — My Uploads section visibility", () => {
  beforeEach(() => {
    onClose.mockClear();
    mocks.setPendingExternalUserDatasetId.mockClear();
    mocks.deleteUploadMutateAsync.mockClear();
    mocks.requestDatasetSwitch.mockClear();
  });

  it("My Uploads section is absent when the user is not signed in", () => {
    currentIsSignedIn = false;
    currentUserDatasets = [];
    currentMySaves = [];
    renderPanel();
    switchToSavesTab();

    expect(screen.queryByText(/My Saved Uploads/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/No uploaded datasets yet/i),
    ).not.toBeInTheDocument();
  });

  it("shows empty state when signed in but no uploads", () => {
    currentIsSignedIn = true;
    currentUserDatasets = [];
    currentMySaves = [];
    renderPanel();
    switchToSavesTab();

    expect(screen.getByText(/No uploaded datasets yet/i)).toBeInTheDocument();
  });
});

describe("FindDataPanel — section order and label", () => {
  beforeEach(() => {
    currentIsSignedIn = true;
    currentUserDatasets = [UPLOAD_A];
    currentMySaves = [];
  });

  it('section header reads "My Saved Uploads"', () => {
    renderPanel();
    switchToSavesTab();

    expect(screen.getByText("My Saved Uploads")).toBeInTheDocument();
    expect(screen.queryByText(/^My Uploads$/)).not.toBeInTheDocument();
  });

  it("My Saved Uploads section appears above Catalog Saves", () => {
    renderPanel();
    switchToSavesTab();

    const uploadsHeader = screen.getByText("My Saved Uploads");
    const catalogHeader = screen.getByText("Catalog Saves");
    // DOCUMENT_POSITION_FOLLOWING (4): catalogHeader comes after uploadsHeader.
    expect(
      uploadsHeader.compareDocumentPosition(catalogHeader) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("upload card filename carries a title attribute with the full name", () => {
    renderPanel();
    switchToSavesTab();

    const nameEl = screen.getByTestId("text-upload-name-upload-a");
    expect(nameEl).toHaveAttribute("title", "Tolstoi Sonar Survey");
  });
});

describe("FindDataPanel — My Uploads rename", () => {
  beforeEach(() => {
    mocks.renameUploadMutateAsync.mockClear();
    mocks.renameUploadMutateAsync.mockResolvedValue(undefined);
    currentIsSignedIn = true;
    currentUserDatasets = [UPLOAD_A];
    currentMySaves = [];
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

describe("FindDataPanel — My Uploads deduplication", () => {
  beforeEach(() => {
    onClose.mockClear();
    mocks.setPendingExternalUserDatasetId.mockClear();
    mocks.deleteUploadMutateAsync.mockClear();
    mocks.requestDatasetSwitch.mockClear();
    currentIsSignedIn = true;
  });

  it("excludes uploads whose id is already referenced by a catalog save's datasetId", () => {
    currentUserDatasets = [UPLOAD_A, UPLOAD_B];
    currentMySaves = [SAVE_FOR_UPLOAD_A];
    renderPanel();
    switchToSavesTab();

    expect(
      screen.getByText("Juneau Harbour Scan"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("upload-card-upload-a"),
    ).not.toBeInTheDocument();
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

describe("FindDataPanel — My Uploads Load button", () => {
  beforeEach(() => {
    onClose.mockClear();
    mocks.setPendingExternalUserDatasetId.mockClear();
    mocks.deleteUploadMutateAsync.mockClear();
    mocks.requestDatasetSwitch.mockClear();
    currentIsSignedIn = true;
    currentMySaves = [];
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

describe("FindDataPanel — My Uploads delete button", () => {
  beforeEach(() => {
    onClose.mockClear();
    mocks.setPendingExternalUserDatasetId.mockClear();
    mocks.deleteUploadMutateAsync.mockClear();
    mocks.requestDatasetSwitch.mockClear();
    currentIsSignedIn = true;
    currentMySaves = [];
    currentUserDatasets = [UPLOAD_B];
  });

  it("clicking delete opens confirmation dialog and confirming calls mutateAsync with the dataset id", async () => {
    renderPanel();
    switchToSavesTab();

    const deleteBtn = screen.getByTestId("btn-delete-upload-upload-b");
    fireEvent.click(deleteBtn);

    const dialog = screen.getByTestId("confirm-delete-upload");
    expect(dialog).toBeInTheDocument();

    const confirmBtn = screen.getByTestId("confirm-delete-upload-confirm");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mocks.deleteUploadMutateAsync).toHaveBeenCalledWith({
        id: "upload-b",
      });
    });
  });
});
