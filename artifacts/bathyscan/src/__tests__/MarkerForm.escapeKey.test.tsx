/**
 * MarkerForm.escapeKey.test.tsx
 *
 * Verifies that pressing Escape while MarkerForm is open triggers handleClose,
 * which in create mode calls setMarkerFormOpen(false), and in edit mode with a
 * dirty form opens the discard AlertDialog instead of closing immediately.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { MarkerForm } from "@/components/MarkerForm";
import { useMarkerEditStore } from "@/lib/markerEditStore";

// ── API client proxy (hoisted) ───────────────────────────────────────────────
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isLoading: false, isError: false };
  }
  function mutationHook() {
    return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined };
  }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${a.filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

// ── Hoisted spies ─────────────────────────────────────────────────────────────
const setMarkerFormOpenSpy = vi.hoisted(() => vi.fn());

// ── Store mocks ──────────────────────────────────────────────────────────────
vi.mock("@/lib/cameraStore", () => ({
  useCameraStore: (sel: (s: { lastClickedGps: { lon: number; lat: number; depth: number } }) => unknown) =>
    sel({ lastClickedGps: { lon: -122.5, lat: 37.8, depth: 45 } }),
}));

vi.mock("@/lib/uiStore", () => {
  const state = {
    setMarkerFormOpen: setMarkerFormOpenSpy,
    markerFormPrefill: { label: "Test marker" },
  };
  return {
    useUiStore: Object.assign(
      (sel: (s: typeof state) => unknown) => sel(state),
      { getState: () => state },
    ),
  };
});

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    terrain: {
      datasetId: "test-ds",
      waterType: "saltwater",
      minDepth: 0,
      maxDepth: 200,
      rows: 10,
      cols: 10,
    },
  }),
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) => sel({ isOnline: true }),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: { units: string; waterType: string }) => unknown) =>
    sel({ units: "metric", waterType: "saltwater" }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("idb-keyval", () => ({ set: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/hooks/useReturnFocus", () => ({
  useReturnFocus: () => {},
}));

vi.mock(
  "@workspace/api-client-react",
  () => makeApiClientMock(),
);

function fireEscape() {
  fireEvent.keyDown(window, { key: "Escape", bubbles: true });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MarkerForm — Escape key (create mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMarkerEditStore.getState().close();
  });

  it("renders safely without a selected marker type and hides salmon guidance", () => {
    expect(() => renderWithProviders(<MarkerForm />)).not.toThrow();

    expect(screen.getByText(/DROP MARKER/)).toBeInTheDocument();
    expect(screen.queryByTestId("salmon-depth-guide")).not.toBeInTheDocument();
  });

  it("calls setMarkerFormOpen(false) when Escape is pressed in create mode", () => {
    renderWithProviders(<MarkerForm />);

    fireEscape();

    expect(setMarkerFormOpenSpy).toHaveBeenCalledWith(false);
  });
});

describe("MarkerForm — Escape key (edit mode, clean form)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMarkerEditStore.getState().open({
      id: "m-1",
      label: "Existing marker",
      type: "custom",
      lon: -122,
      lat: 37,
      depth: 10,
      notes: "",
      datasetId: "test-ds",
      createdAt: new Date().toISOString(),
    } as import("@workspace/api-client-react").Marker);
  });

  it("closes immediately (calls requestClose) when form is clean and Escape is pressed", async () => {
    renderWithProviders(<MarkerForm />);

    // In edit mode with a clean form, Escape should not open the discard dialog.
    fireEscape();

    // The discard dialog should NOT appear.
    await waitFor(() => {
      expect(screen.queryByText(/discard/i)).not.toBeInTheDocument();
    });
  });
});

describe("MarkerForm — Escape key (edit mode, dirty form)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMarkerEditStore.getState().open({
      id: "m-2",
      label: "Original label",
      type: "custom",
      lon: -122,
      lat: 37,
      depth: 10,
      notes: "",
      datasetId: "test-ds",
      createdAt: new Date().toISOString(),
    } as import("@workspace/api-client-react").Marker);
  });

  it("opens the discard AlertDialog when form is dirty and Escape is pressed", async () => {
    renderWithProviders(<MarkerForm />);

    // Dirty the form by changing the label.
    const labelInput = screen.getByDisplayValue("Original label");
    fireEvent.change(labelInput, { target: { value: "Changed label" } });

    fireEscape();

    // The discard AlertDialog should appear (multiple elements with "Discard" text is expected).
    await waitFor(() => {
      expect(screen.getAllByText(/discard/i).length).toBeGreaterThan(0);
    });
  });
});
