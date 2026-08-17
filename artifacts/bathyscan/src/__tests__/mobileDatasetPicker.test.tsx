/**
 * mobileDatasetPicker.test.tsx — regression guard for the MOBILE-ONLY dataset
 * picker's Replace/Add tap semantics (task: mobile add-dataset-to-loaded-view).
 *
 * Guards the failure modes named in the task's Regression Guard:
 *   - Replace mode must keep calling setSinglePrimary semantics (single
 *     visible dataset) and CLOSE the picker.
 *   - Add mode must stack via addSelected semantics (both datasets visible)
 *     and KEEP the picker open.
 *   - The "×" remove button on a loaded row must unload it (toggleVisible
 *     remove path) without closing the picker.
 *   - At maxActiveDatasets, un-loaded rows must be aria-disabled and tapping
 *     them in Add mode must be a no-op.
 *   - The Replace/Add segmented control must be hidden when nothing is loaded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Auto-stubbing api-client mock — pattern copied from mobileChartShell.test.tsx.
// NOTE: keep default data:undefined — never data:[] (useEffect([data]) loop
// hazard). The catalog list override below returns a STABLE module-level
// array, which is equally loop-safe.
const { makeApiClientMock, CATALOG } = vi.hoisted(() => {
  function noop() {}
  function queryHook()    { return { data: undefined, isLoading: false, isError: false }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  const makeApiClientMock = (overrides: Record<string, unknown> = {}) =>
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
  // Four stable catalog entries so the cap (3) can be reached with one left over.
  const CATALOG = [
    { id: "ds-1", name: "Dataset One",   bbox: [0, 0, 1, 1] },
    { id: "ds-2", name: "Dataset Two",   bbox: [0, 0, 1, 1] },
    { id: "ds-3", name: "Dataset Three", bbox: [0, 0, 1, 1] },
    { id: "ds-4", name: "Dataset Four",  bbox: [0, 0, 1, 1] },
  ];
  const catalogQuery = { data: CATALOG, isLoading: false, isError: false };
  return {
    makeApiClientMock: (extra: Record<string, unknown> = {}) =>
      makeApiClientMock({ useGetDatasets: () => catalogQuery, ...extra }),
    CATALOG,
  };
});

vi.mock("@workspace/api-client-react", () => makeApiClientMock());

vi.mock("@/lib/clerkCompat", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({ isLoaded: true, isSignedIn: false }),
  };
});

// Offline pack statuses come from IndexedDB — irrelevant here; return "none"
// for every dataset via an empty map. Preserve the pure helpers (importOriginal).
vi.mock("@/hooks/useOfflinePackStatus", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useOfflinePackStatuses: () => new Map(),
  };
});

import {
  MobileDatasetPicker,
  type MobilePickerMode,
} from "@/components/mobile/MobileDatasetPicker";
import { useTerrainStore } from "@/lib/terrainStore";
import { useSettingsStore } from "@/lib/settingsStore";

/**
 * Harness that owns the picker mode the way MobileChartShell does, so tests
 * can flip modes through the real segmented control.
 */
function Harness({
  onClose,
  initialMode = "replace",
}: {
  onClose: () => void;
  initialMode?: MobilePickerMode;
}) {
  const [mode, setMode] = React.useState<MobilePickerMode>(initialMode);
  return (
    <MobileDatasetPicker
      onClose={onClose}
      onDownloadOffline={() => {}}
      mode={mode}
      onModeChange={setMode}
    />
  );
}

const visibleIds = () =>
  useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId);

beforeEach(() => {
  useSettingsStore.getState().resetAll();
  useTerrainStore.getState().clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MobileDatasetPicker — Replace/Add modes", () => {
  it("hides the Replace/Add segmented control when nothing is loaded", () => {
    render(<Harness onClose={() => {}} />);
    expect(screen.queryByTestId("mobile-picker-mode-toggle")).not.toBeInTheDocument();
  });

  it("shows the segmented control once a dataset is loaded, defaulting to Replace", () => {
    useTerrainStore.getState().setSinglePrimary("ds-1", "preset");
    render(<Harness onClose={() => {}} />);
    expect(screen.getByTestId("mobile-picker-mode-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-picker-mode-replace")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("mobile-picker-mode-add")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("Replace mode: tapping an entry replaces ALL visible datasets and closes the picker", () => {
    useTerrainStore.getState().setSinglePrimary("ds-1", "preset");
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.click(screen.getByTestId("mobile-dataset-option-ds-2"));

    // setSinglePrimary semantics: exactly one visible dataset, the tapped one.
    expect(visibleIds()).toEqual(["ds-2"]);
    expect(useTerrainStore.getState().multiDatasetMode).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Add mode: tapping an un-loaded entry stacks it and keeps the picker open", () => {
    useTerrainStore.getState().setSinglePrimary("ds-1", "preset");
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.click(screen.getByTestId("mobile-picker-mode-add"));
    fireEvent.click(screen.getByTestId("mobile-dataset-option-ds-2"));

    // addSelected semantics: both datasets visible, multi-dataset mode on.
    expect(visibleIds()).toEqual(["ds-1", "ds-2"]);
    expect(useTerrainStore.getState().multiDatasetMode).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    // Stays open for a second add in the same session.
    fireEvent.click(screen.getByTestId("mobile-dataset-option-ds-3"));
    expect(visibleIds()).toEqual(["ds-1", "ds-2", "ds-3"]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Add mode: tapping an already-loaded entry is a no-op", () => {
    useTerrainStore.getState().setSinglePrimary("ds-1", "preset");
    const onClose = vi.fn();
    render(<Harness onClose={onClose} initialMode="add" />);

    fireEvent.click(screen.getByTestId("mobile-dataset-option-ds-1"));
    expect(visibleIds()).toEqual(["ds-1"]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("loaded rows show the ● Loaded badge and a × remove button that unloads without closing", () => {
    useTerrainStore.getState().setSinglePrimary("ds-1", "preset");
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    expect(screen.getByText("● Loaded")).toBeInTheDocument();
    // Un-loaded rows get no remove button.
    expect(screen.queryByTestId("mobile-dataset-remove-ds-2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mobile-dataset-remove-ds-1"));

    // toggleVisible remove path: fully deselected, picker still open.
    expect(visibleIds()).toEqual([]);
    expect(useTerrainStore.getState().selectedIds).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cap guard: at maxActiveDatasets, un-loaded rows are aria-disabled in Add mode and tapping is a no-op", () => {
    // Load 3 datasets (default maxActiveDatasets cap).
    useTerrainStore.getState().setSinglePrimary("ds-1", "preset");
    useTerrainStore.getState().addSelected("ds-2", "preset");
    useTerrainStore.getState().addSelected("ds-3", "preset");
    expect(visibleIds()).toHaveLength(3);

    const onClose = vi.fn();
    render(<Harness onClose={onClose} initialMode="add" />);

    const capped = screen.getByTestId("mobile-dataset-option-ds-4");
    expect(capped).toHaveAttribute("aria-disabled", "true");
    expect(capped).toHaveAttribute("title", expect.stringContaining("Cap reached"));

    fireEvent.click(capped);
    expect(visibleIds()).toEqual(["ds-1", "ds-2", "ds-3"]);
    expect(useTerrainStore.getState().selectedIds).not.toContain("ds-4");

    // Loaded rows are NOT dimmed — their × remove stays fully usable.
    expect(screen.getByTestId("mobile-dataset-option-ds-1")).not.toHaveAttribute(
      "aria-disabled",
    );

    // Removing one frees a slot: the row un-dims and can be added again.
    fireEvent.click(screen.getByTestId("mobile-dataset-remove-ds-1"));
    expect(screen.getByTestId("mobile-dataset-option-ds-4")).not.toHaveAttribute(
      "aria-disabled",
    );
    fireEvent.click(screen.getByTestId("mobile-dataset-option-ds-4"));
    expect(visibleIds()).toEqual(["ds-2", "ds-3", "ds-4"]);
  });

  it("Add mode: header close button reads DONE and dismisses the picker", () => {
    useTerrainStore.getState().setSinglePrimary("ds-1", "preset");
    const onClose = vi.fn();
    render(<Harness onClose={onClose} initialMode="add" />);

    const done = screen.getByTestId("mobile-dataset-picker-close");
    expect(done).toHaveTextContent("DONE");
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Replace mode with nothing loaded behaves exactly as before (tap → replace → close)", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    expect(screen.queryByTestId("mobile-picker-mode-toggle")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`mobile-dataset-option-${CATALOG[0]!.id}`));
    expect(visibleIds()).toEqual(["ds-1"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
