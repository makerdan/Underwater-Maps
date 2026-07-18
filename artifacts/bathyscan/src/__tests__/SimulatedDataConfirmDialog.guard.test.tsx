/**
 * Guard test — the pre-load SimulatedDataConfirmDialog must keep working
 * alongside the rainbow terrain treatment. Asserts the dialog renders for a
 * pending synthetic switch, exposes its testids, and wires Confirm/Cancel.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

vi.mock("@/lib/queryClient", () => ({
  queryClient: { fetchQuery: vi.fn() },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
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
    syntheticReason: "upstream bathymetry services unreachable",
    bbox: { minLon: -134, maxLon: -132, minLat: 55, maxLat: 56.5 },
  } as unknown as DatasetPreview;
}

describe("SimulatedDataConfirmDialog guard", () => {
  beforeEach(() => {
    useSimulatedDataStore.setState({ pending: null, suppressed: false });
  });

  it("renders nothing when no switch is pending", () => {
    render(<SimulatedDataConfirmDialog />);
    expect(screen.queryByTestId("simulated-data-dialog")).not.toBeInTheDocument();
  });

  it("renders the warning dialog for a pending synthetic switch", () => {
    useSimulatedDataStore.setState({
      pending: {
        datasetId: "d1",
        datasetName: "Thorne Bay",
        preview: makePreview(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      },
    });
    render(<SimulatedDataConfirmDialog />);
    expect(screen.getByTestId("simulated-data-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("simulated-data-dataset")).toHaveTextContent("Thorne Bay");
    expect(screen.getByTestId("simulated-data-reason")).toHaveTextContent(
      /upstream bathymetry services unreachable/,
    );
  });

  it("fires onConfirm for Load anyway and onCancel for Cancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    useSimulatedDataStore.setState({
      pending: {
        datasetId: "d1",
        datasetName: "Thorne Bay",
        preview: makePreview(),
        onConfirm,
        onCancel,
      },
    });
    const { unmount } = render(<SimulatedDataConfirmDialog />);
    fireEvent.click(screen.getByTestId("simulated-data-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    unmount();

    useSimulatedDataStore.setState({
      pending: {
        datasetId: "d1",
        datasetName: "Thorne Bay",
        preview: makePreview(),
        onConfirm,
        onCancel,
      },
    });
    render(<SimulatedDataConfirmDialog />);
    fireEvent.click(screen.getByTestId("simulated-data-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
