/**
 * Regression guard for the stale-closure fix in SimulatedDataConfirmDialog.
 *
 * Before the fix, handleCancel was a plain function declaration inside the
 * component body, captured by the keydown useEffect at mount time. If the
 * user ticked "Don't ask again" (suppressed=true) AFTER the dialog rendered —
 * but WITHOUT the pending object changing — the Escape key still called the
 * stale handleCancel that had suppressed=false, causing a "Load cancelled"
 * toast that should have been suppressed.
 *
 * The fix wraps handleCancel in useCallback with suppressed in its deps, and
 * adds handleCancel to the keydown effect deps, so the listener is always
 * re-registered with a fresh handleCancel whenever suppressed changes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import type { DatasetPreview } from "@workspace/api-client-react";

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () => makeApiClientMock());
vi.mock("@/lib/queryClient", () => ({ queryClient: { fetchQuery: vi.fn() } }));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
  toast: toastMock,
}));

vi.mock("@/lib/uiStore", () => ({
  useUiStore: (sel: (s: { setFindDataPanelOpen: () => void }) => unknown) =>
    sel({ setFindDataPanelOpen: () => {} }),
}));

import { SimulatedDataConfirmDialog } from "@/components/SimulatedDataConfirmDialog";
import { useSimulatedDataStore } from "@/lib/simulatedDataStore";

function makePreview(): DatasetPreview {
  return {
    dataSource: "synthetic",
    syntheticReason: "upstream services unreachable",
    bbox: { minLon: -134, maxLon: -132, minLat: 55, maxLat: 56.5 },
  } as unknown as DatasetPreview;
}

describe("SimulatedDataConfirmDialog — Escape key stale-closure regression", () => {
  beforeEach(() => {
    useSimulatedDataStore.setState({ pending: null, suppressed: false });
    toastMock.mockClear();
  });

  it("fires toast when Escape is pressed with suppressed=false", () => {
    const onCancel = vi.fn();
    useSimulatedDataStore.setState({
      pending: {
        datasetId: "d1",
        datasetName: "Test Bay",
        preview: makePreview(),
        onConfirm: vi.fn(),
        onCancel,
      },
      suppressed: false,
    });
    render(<SimulatedDataConfirmDialog />);

    fireEvent.keyDown(window, { key: "Escape", bubbles: true });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("suppresses toast when suppressed becomes true AFTER dialog renders (stale-closure fix)", () => {
    const onCancel = vi.fn();
    useSimulatedDataStore.setState({
      pending: {
        datasetId: "d1",
        datasetName: "Test Bay",
        preview: makePreview(),
        onConfirm: vi.fn(),
        onCancel,
      },
      suppressed: false,
    });
    const { rerender } = render(<SimulatedDataConfirmDialog />);

    // Simulate user ticking "Don't ask again" AFTER the dialog opened.
    // Before the fix: the effect's captured handleCancel still had suppressed=false,
    // so pressing Escape would fire the toast anyway.
    // After the fix: handleCancel is re-wrapped via useCallback, re-registered
    // in the keydown listener, so suppressed=true is respected.
    act(() => {
      useSimulatedDataStore.setState({ suppressed: true });
    });
    rerender(<SimulatedDataConfirmDialog />);

    fireEvent.keyDown(window, { key: "Escape", bubbles: true });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("ignores non-Escape keydowns", () => {
    const onCancel = vi.fn();
    useSimulatedDataStore.setState({
      pending: {
        datasetId: "d1",
        datasetName: "Test Bay",
        preview: makePreview(),
        onConfirm: vi.fn(),
        onCancel,
      },
      suppressed: false,
    });
    render(<SimulatedDataConfirmDialog />);

    fireEvent.keyDown(window, { key: "Enter", bubbles: true });
    fireEvent.keyDown(window, { key: " ", bubbles: true });

    expect(onCancel).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
