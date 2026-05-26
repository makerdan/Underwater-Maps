/**
 * Component tests for SimulatedDataConfirmDialog + the suppression /
 * session-storage behavior of simulatedDataStore. Locks in the
 * Cancel-preserves-state, Load-anyway, and "Don't ask again this session"
 * guardrails for the synthetic-data warning flow (task #381).
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { SimulatedDataConfirmDialog } from "@/components/SimulatedDataConfirmDialog";
import { useSimulatedDataStore } from "@/lib/simulatedDataStore";
import { useUiStore } from "@/lib/uiStore";

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* ignore */ }
  useSimulatedDataStore.setState({ pending: null, suppressed: false });
  useUiStore.setState({ ...useUiStore.getState(), findDataPanelOpen: false });
});

function openPending(over: Partial<NonNullable<ReturnType<typeof useSimulatedDataStore.getState>["pending"]>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  useSimulatedDataStore.setState({
    pending: {
      datasetId: "ds-1",
      datasetName: "Test Dataset",
      preview: {
        datasetId: "ds-1",
        name: "Test Dataset",
        bbox: { minLon: -1, minLat: 1, maxLon: -2, maxLat: 2 },
        dataSource: "synthetic",
        syntheticReason: "Upstream bathymetry services unreachable",
      },
      onConfirm,
      onCancel,
      ...over,
    },
  });
  return { onConfirm, onCancel };
}

describe("SimulatedDataConfirmDialog", () => {
  it("renders the dataset name and synthetic reason", () => {
    openPending();
    render(<SimulatedDataConfirmDialog />);
    expect(screen.getByTestId("simulated-data-dialog")).toBeTruthy();
    expect(screen.getByTestId("simulated-data-dataset").textContent).toMatch(/Test Dataset/);
    expect(screen.getByTestId("simulated-data-reason").textContent).toMatch(
      /Upstream bathymetry services unreachable/i,
    );
  });

  it("Cancel calls onCancel, closes the dialog, and reopens Find Data", () => {
    const { onConfirm, onCancel } = openPending();
    render(<SimulatedDataConfirmDialog />);
    act(() => {
      fireEvent.click(screen.getByTestId("simulated-data-cancel"));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(useUiStore.getState().findDataPanelOpen).toBe(true);
  });

  it("Load anyway calls onConfirm without flipping suppression", () => {
    const { onConfirm, onCancel } = openPending();
    render(<SimulatedDataConfirmDialog />);
    act(() => {
      fireEvent.click(screen.getByTestId("simulated-data-confirm"));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(useSimulatedDataStore.getState().suppressed).toBe(false);
  });

  it("toggling 'Don't ask again this session' persists to sessionStorage", () => {
    openPending();
    render(<SimulatedDataConfirmDialog />);
    const box = screen.getByTestId("simulated-data-suppress") as HTMLInputElement;
    act(() => {
      fireEvent.click(box);
    });
    expect(useSimulatedDataStore.getState().suppressed).toBe(true);
    expect(sessionStorage.getItem("bathyscan:simulatedDataWarn:suppress")).toBeTruthy();
  });
});
