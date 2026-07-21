/**
 * Tests for the transient-failure retry logic in `requestDatasetSwitch`.
 *
 * When the preview fetch fails on the first attempt but succeeds on the
 * second, the dialog must NOT open — the warning should only appear when
 * all retry attempts are exhausted.
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

import { requestDatasetSwitch, useSimulatedDataStore, __retryConfig } from "@/lib/simulatedDataStore";
import type { DatasetPreview } from "@workspace/api-client-react";

function makePreview(dataSource: DatasetPreview["dataSource"]): DatasetPreview {
  return {
    datasetId: "ds-retry",
    name: "Retry Dataset",
    bbox: { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 },
    dataSource,
    syntheticReason: dataSource !== "ncei" ? "upstream unavailable" : undefined,
  };
}

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* ignore */ }
  useSimulatedDataStore.setState({ pending: null, suppressed: false });
  fetchQueryMock.mockReset();
  // Zero out delay so tests don't actually wait 1.5 s between attempts.
  __retryConfig.delayMs = 0;
});

describe("requestDatasetSwitch — retry on transient failure", () => {
  it("succeeds without dialog when first attempt fails but retry returns real data (ncei)", async () => {
    fetchQueryMock
      .mockRejectedValueOnce(new Error("network hiccup"))
      .mockResolvedValueOnce(makePreview("ncei"));

    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    await requestDatasetSwitch({
      datasetId: "ds-retry",
      datasetName: "Retry Dataset",
      onConfirm,
      onCancel,
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(useSimulatedDataStore.getState().pending).toBeNull();
    expect(fetchQueryMock).toHaveBeenCalledTimes(2);
  });

  it("succeeds without dialog when first attempt fails but retry returns gebco data", async () => {
    fetchQueryMock
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(makePreview("gebco"));

    const onConfirm = vi.fn();

    await requestDatasetSwitch({
      datasetId: "ds-retry",
      onConfirm,
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(useSimulatedDataStore.getState().pending).toBeNull();
    expect(fetchQueryMock).toHaveBeenCalledTimes(2);
  });

  it("opens the dialog when retry also fails (both attempts exhausted)", async () => {
    fetchQueryMock
      .mockRejectedValueOnce(new Error("network hiccup"))
      .mockRejectedValueOnce(new Error("still down"));

    const onConfirm = vi.fn();

    await requestDatasetSwitch({
      datasetId: "ds-retry",
      datasetName: "Retry Dataset",
      onConfirm,
    });

    expect(onConfirm).not.toHaveBeenCalled();
    const pending = useSimulatedDataStore.getState().pending;
    expect(pending).not.toBeNull();
    expect(pending?.preview.dataSource).toBe("unknown");
    expect(fetchQueryMock).toHaveBeenCalledTimes(2);
  });

  it("opens the dialog when retry returns synthetic data", async () => {
    fetchQueryMock
      .mockRejectedValueOnce(new Error("network hiccup"))
      .mockResolvedValueOnce(makePreview("synthetic"));

    const onConfirm = vi.fn();

    await requestDatasetSwitch({
      datasetId: "ds-retry",
      datasetName: "Retry Dataset",
      onConfirm,
    });

    expect(onConfirm).not.toHaveBeenCalled();
    const pending = useSimulatedDataStore.getState().pending;
    expect(pending).not.toBeNull();
    expect(pending?.preview.dataSource).toBe("synthetic");
    expect(fetchQueryMock).toHaveBeenCalledTimes(2);
  });

  it("silent mode still calls onConfirm immediately even after both attempts fail", async () => {
    fetchQueryMock
      .mockRejectedValueOnce(new Error("network hiccup"))
      .mockRejectedValueOnce(new Error("still down"));

    const onConfirm = vi.fn();

    await requestDatasetSwitch({
      datasetId: "ds-retry",
      onConfirm,
      silent: true,
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(useSimulatedDataStore.getState().pending).toBeNull();
  });

  it("makes exactly two fetch attempts, not more", async () => {
    fetchQueryMock.mockRejectedValue(new Error("always fails"));

    const onConfirm = vi.fn();

    await requestDatasetSwitch({
      datasetId: "ds-retry",
      onConfirm,
    });

    expect(fetchQueryMock).toHaveBeenCalledTimes(2);
  });

  it("skips the preview fetch entirely and confirms immediately when suppressed", async () => {
    // When "Don't ask again this session" is active the dialog can never
    // open, so the preflight fetch (with its multi-second retry/backoff) must
    // be skipped — onConfirm fires synchronously. This is what lets the Find
    // Data panel close immediately after clicking Load with warnings
    // suppressed (e2e find-data-my-uploads relies on this).
    useSimulatedDataStore.setState({ suppressed: true });
    fetchQueryMock.mockRejectedValue(new Error("should never be called"));

    const onConfirm = vi.fn();
    await requestDatasetSwitch({ datasetId: "ds-retry", onConfirm });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(fetchQueryMock).not.toHaveBeenCalled();
    expect(useSimulatedDataStore.getState().pending).toBeNull();
  });

  it("uses staleTime:0 on the retry attempt to bypass cached errors", async () => {
    fetchQueryMock
      .mockRejectedValueOnce(new Error("first fail"))
      .mockResolvedValueOnce(makePreview("ncei"));

    const onConfirm = vi.fn();

    await requestDatasetSwitch({ datasetId: "ds-retry", onConfirm });

    const [firstCall, secondCall] = fetchQueryMock.mock.calls;
    expect(firstCall[0]).toMatchObject({ staleTime: 30_000 });
    expect(secondCall[0]).toMatchObject({ staleTime: 0 });
  });
});
