/**
 * Regression tests for the `silent` option of `requestDatasetSwitch`.
 *
 * Covers the startup auto-load path: silent calls must call onConfirm
 * directly and never open the dialog — regardless of whether the preview
 * resolves to "synthetic", "unknown", or rejects with an AbortError.
 *
 * Also asserts the inverse: a non-silent call with a synthetic result does
 * open the dialog (sets pending in the store), preserving existing behaviour.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const fetchQueryMock = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  queryClient: { fetchQuery: (...args: unknown[]) => fetchQueryMock(...args) },
}));

vi.mock("@workspace/api-client-react", () => ({
  getDatasetsIdPreview: vi.fn(),
  getGetDatasetsIdPreviewQueryKey: (id: string) => ["datasets", id, "preview"],
}));

import { requestDatasetSwitch, useSimulatedDataStore } from "@/lib/simulatedDataStore";
import type { DatasetPreview } from "@workspace/api-client-react";

function makePreview(dataSource: DatasetPreview["dataSource"]): DatasetPreview {
  return {
    datasetId: "ds-test",
    name: "Test Dataset",
    bbox: { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 },
    dataSource,
    syntheticReason: dataSource !== "ncei" ? "upstream unavailable" : undefined,
  };
}

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* ignore */ }
  useSimulatedDataStore.setState({ pending: null, suppressed: false });
  fetchQueryMock.mockReset();
});

describe("requestDatasetSwitch — silent mode", () => {
  it("calls onConfirm immediately when preview resolves synthetic and silent:true", async () => {
    fetchQueryMock.mockResolvedValue(makePreview("synthetic"));
    const onConfirm = vi.fn();
    const setPendingSpy = vi.spyOn(useSimulatedDataStore.getState(), "setPending");

    await requestDatasetSwitch({
      datasetId: "ds-test",
      datasetName: "Test Dataset",
      onConfirm,
      silent: true,
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(setPendingSpy).not.toHaveBeenCalled();
    expect(useSimulatedDataStore.getState().pending).toBeNull();
  });

  it("calls onConfirm immediately when preview rejects with AbortError and silent:true", async () => {
    fetchQueryMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const onConfirm = vi.fn();

    await requestDatasetSwitch({
      datasetId: "ds-test",
      datasetName: "Test Dataset",
      onConfirm,
      silent: true,
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(useSimulatedDataStore.getState().pending).toBeNull();
  });

  it("calls onConfirm immediately when preview resolves unknown and silent:true", async () => {
    fetchQueryMock.mockResolvedValue(makePreview("unknown"));
    const onConfirm = vi.fn();

    await requestDatasetSwitch({
      datasetId: "ds-test",
      onConfirm,
      silent: true,
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(useSimulatedDataStore.getState().pending).toBeNull();
  });
});

describe("requestDatasetSwitch — suppressed mode (session-wide suppress)", () => {
  it("calls onConfirm immediately (non-silent) for synthetic data when suppressed=true", async () => {
    fetchQueryMock.mockResolvedValue(makePreview("synthetic"));
    useSimulatedDataStore.setState({ suppressed: true });
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const setPendingSpy = vi.spyOn(useSimulatedDataStore.getState(), "setPending");

    await requestDatasetSwitch({
      datasetId: "ds-test",
      datasetName: "Test Dataset",
      onConfirm,
      onCancel,
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(setPendingSpy).not.toHaveBeenCalled();
    expect(useSimulatedDataStore.getState().pending).toBeNull();
  });

  it("calls onConfirm immediately (non-silent) for unknown data when suppressed=true", async () => {
    fetchQueryMock.mockResolvedValue(makePreview("unknown"));
    useSimulatedDataStore.setState({ suppressed: true });
    const onConfirm = vi.fn();

    await requestDatasetSwitch({ datasetId: "ds-test", onConfirm });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(useSimulatedDataStore.getState().pending).toBeNull();
  });
});

describe("requestDatasetSwitch — non-silent mode (dialog preserved)", () => {
  it("sets pending in the store when preview resolves synthetic and silent is not set", async () => {
    fetchQueryMock.mockResolvedValue(makePreview("synthetic"));
    const onConfirm = vi.fn();

    await requestDatasetSwitch({
      datasetId: "ds-test",
      datasetName: "Test Dataset",
      onConfirm,
    });

    expect(onConfirm).not.toHaveBeenCalled();
    const pending = useSimulatedDataStore.getState().pending;
    expect(pending).not.toBeNull();
    expect(pending?.datasetId).toBe("ds-test");
    expect(pending?.preview.dataSource).toBe("synthetic");
  });

  it("sets pending when preview rejects (non-silent) — treat as unknown", async () => {
    fetchQueryMock.mockRejectedValue(new Error("network error"));
    const onConfirm = vi.fn();

    await requestDatasetSwitch({
      datasetId: "ds-test",
      onConfirm,
    });

    expect(onConfirm).not.toHaveBeenCalled();
    const pending = useSimulatedDataStore.getState().pending;
    expect(pending).not.toBeNull();
    expect(pending?.preview.dataSource).toBe("unknown");
  });

  it("calls onConfirm immediately (non-silent) when preview resolves real data", async () => {
    fetchQueryMock.mockResolvedValue(makePreview("ncei"));
    const onConfirm = vi.fn();

    await requestDatasetSwitch({
      datasetId: "ds-test",
      onConfirm,
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(useSimulatedDataStore.getState().pending).toBeNull();
  });
});
