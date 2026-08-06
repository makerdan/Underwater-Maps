/**
 * Unit tests for MarkerForm in create mode — specifically the non-network
 * error path (Bug 3).
 *
 * When postMarkers fails with a non-network error (HTTP 4xx/5xx, server
 * validation, auth rejection) the form must:
 *   1. Show a toast with a user-facing error message.
 *   2. Keep the form open (not call setMarkerFormOpen(false)).
 *
 * This file is separate from MarkerFormEdit.test.tsx because the create-mode
 * mock requires lastClickedGps to be non-null so the form renders at all.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, waitFor, act } from "@testing-library/react";
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
const postMutateSpy = vi.hoisted(() => vi.fn());
const setMarkerFormOpenSpy = vi.hoisted(() => vi.fn());
const toastSpy = vi.hoisted(() => vi.fn());

// ── Store mocks ──────────────────────────────────────────────────────────────
vi.mock("@/lib/cameraStore", () => ({
  // Provide real GPS coords so the form renders in create mode.
  useCameraStore: (sel: (s: { lastClickedGps: { lon: number; lat: number; depth: number } }) => unknown) =>
    sel({ lastClickedGps: { lon: -122.5, lat: 37.8, depth: 45 } }),
}));

vi.mock("@/lib/uiStore", () => {
  const state = {
    setMarkerFormOpen: setMarkerFormOpenSpy,
    // Pre-populate label so the form renders with a valid label from the start
    // without requiring a fireEvent.change whose state update may be batched.
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
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      usePostMarkers: () => ({
        mutate: postMutateSpy,
        isPending: false,
      }),
      usePatchMarkersId: () => ({
        mutate: vi.fn(),
        isPending: false,
      }),
      getGetMarkersQueryKey: (params: unknown) => ["Markers", params],
      MarkerInputType: { custom: "custom" },
    }),
);

// ── Tests ────────────────────────────────────────────────────────────────────
describe("MarkerForm — create mode non-network error (Bug 3)", () => {
  beforeEach(() => {
    postMutateSpy.mockClear();
    setMarkerFormOpenSpy.mockClear();
    toastSpy.mockClear();
    // Ensure no edit marker is open so the form is in create mode.
    useMarkerEditStore.getState().close();
  });

  /**
   * Render the form and submit it. The label is pre-populated via
   * markerFormPrefill in the uiStore mock, so no state-changing event is needed
   * before submit. Wait for postMutateSpy to be called and return the callbacks.
   */
  async function renderAndSubmit() {
    const { container } = renderWithProviders(<MarkerForm />);

    // Wait for the prefill useEffect to run (it runs on [gps, visibleMarkerTypes, isEditMode]).
    // This ensures the label state is "Test marker" before we submit.
    await waitFor(() => {
      const labelInput = container.querySelector<HTMLInputElement>(
        "input[placeholder*='Large school']",
      );
      expect(labelInput?.value).toBe("Test marker");
    });

    // Submit via the form element — wrapping both events in act() ensures all
    // pending React state updates are flushed before we check the spy.
    const formEl = container.querySelector("form");
    expect(formEl, "Form element must be present in create mode").not.toBeNull();

    await act(async () => {
      fireEvent.submit(formEl!);
    });

    await waitFor(() => expect(postMutateSpy).toHaveBeenCalledOnce());

    return postMutateSpy.mock.calls[0] as [
      unknown,
      { onError: (err: Error) => void; onSuccess?: () => void },
    ];
  }

  it("shows a toast when postMarkers fails with a non-network error", async () => {
    const [, opts] = await renderAndSubmit();

    // Simulate a non-network HTTP error from postMarkers (e.g. HTTP 500).
    opts.onError(new Error("Request failed with status 500"));

    // A toast with a user-facing message must have been shown.
    expect(toastSpy).toHaveBeenCalledOnce();
    const toastArg = toastSpy.mock.calls[0]![0] as { title?: string; variant?: string };
    expect(toastArg.title).toMatch(/failed to save marker/i);
    expect(toastArg.variant).toBe("destructive");
  });

  it("does NOT show a toast when postMarkers fails with a TypeError (network error)", async () => {
    const [, opts] = await renderAndSubmit();

    // TypeError → network error; should queue offline via idb-keyval, not show a toast.
    opts.onError(new TypeError("Failed to fetch"));

    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("keeps the form open (does not call setMarkerFormOpen(false)) on a non-network error", async () => {
    const [, opts] = await renderAndSubmit();

    opts.onError(new Error("Request failed with status 422"));

    // setMarkerFormOpen(false) must NOT have been called — form stays open.
    expect(setMarkerFormOpenSpy).not.toHaveBeenCalledWith(false);
  });
});
