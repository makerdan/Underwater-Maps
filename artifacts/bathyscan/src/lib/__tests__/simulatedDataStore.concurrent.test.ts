/**
 * Tests for the in-flight guard in `requestDatasetSwitch`.
 *
 * When two calls are dispatched concurrently (double-click, rapid re-trigger),
 * the second must not race with the first and silently overwrite its
 * `onConfirm`/`onCancel` closures.  The second call returns immediately
 * without invoking either callback.
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

import {
  requestDatasetSwitch,
  useSimulatedDataStore,
  __retryConfig,
  __resetInFlightForTest,
} from "@/lib/simulatedDataStore";
import type { DatasetPreview } from "@workspace/api-client-react";

function makePreview(dataSource: DatasetPreview["dataSource"]): DatasetPreview {
  return {
    datasetId: "ds-concurrent",
    name: "Concurrent Dataset",
    bbox: { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 },
    dataSource,
    syntheticReason: dataSource !== "ncei" ? "upstream unavailable" : undefined,
  };
}

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* ignore */ }
  useSimulatedDataStore.setState({ pending: null, suppressed: false });
  fetchQueryMock.mockReset();
  __retryConfig.delayMs = 0;
  __resetInFlightForTest();
});

describe("requestDatasetSwitch — in-flight concurrent guard", () => {
  it("second call is dropped while first is still awaiting the preview fetch", async () => {
    // First call will be slow — the deferred promise does not resolve until
    // we manually release it, giving us a window to dispatch the second call.
    let releaseFetch!: (preview: DatasetPreview) => void;
    const deferred = new Promise<DatasetPreview>((resolve) => {
      releaseFetch = resolve;
    });
    fetchQueryMock.mockReturnValueOnce(deferred);

    const onConfirm1 = vi.fn();
    const onCancel1 = vi.fn();
    const onConfirm2 = vi.fn();
    const onCancel2 = vi.fn();

    // Start the first call but don't await it yet.
    const first = requestDatasetSwitch({
      datasetId: "ds-concurrent",
      datasetName: "Dataset 1",
      onConfirm: onConfirm1,
      onCancel: onCancel1,
    });

    // Second call fires while the first is still in flight.
    const second = requestDatasetSwitch({
      datasetId: "ds-concurrent",
      datasetName: "Dataset 2",
      onConfirm: onConfirm2,
      onCancel: onCancel2,
    });

    // The second call must resolve immediately (guard hit) without touching
    // either callback.
    await second;
    expect(onConfirm2).not.toHaveBeenCalled();
    expect(onCancel2).not.toHaveBeenCalled();

    // Now release the first fetch with real data so it proceeds normally.
    releaseFetch(makePreview("ncei"));
    await first;

    // The first call's onConfirm fires; the second's callbacks remain clean.
    expect(onConfirm1).toHaveBeenCalledTimes(1);
    expect(onCancel1).not.toHaveBeenCalled();
    expect(onConfirm2).not.toHaveBeenCalled();
    expect(onCancel2).not.toHaveBeenCalled();
  });

  it("second call is dropped even when first results in a dialog (unknown source)", async () => {
    let releaseFetch!: (preview: DatasetPreview) => void;
    const deferred = new Promise<DatasetPreview>((resolve) => {
      releaseFetch = resolve;
    });
    fetchQueryMock.mockReturnValueOnce(deferred);

    const onConfirm1 = vi.fn();
    const onConfirm2 = vi.fn();

    const first = requestDatasetSwitch({
      datasetId: "ds-concurrent",
      datasetName: "Dataset 1",
      onConfirm: onConfirm1,
    });

    const second = requestDatasetSwitch({
      datasetId: "ds-concurrent",
      datasetName: "Dataset 2",
      onConfirm: onConfirm2,
    });

    await second;
    expect(onConfirm2).not.toHaveBeenCalled();

    releaseFetch(makePreview("unknown"));
    await first;

    // First call opened the dialog (pending is set); second didn't overwrite it.
    const pending = useSimulatedDataStore.getState().pending;
    expect(pending).not.toBeNull();
    expect(pending?.datasetId).toBe("ds-concurrent");
    expect(onConfirm1).not.toHaveBeenCalled(); // dialog hasn't been confirmed yet
    expect(onConfirm2).not.toHaveBeenCalled();
  });

  it("guard resets after first call completes, allowing a subsequent call", async () => {
    // First call succeeds normally.
    fetchQueryMock.mockResolvedValueOnce(makePreview("ncei"));

    const onConfirm1 = vi.fn();
    await requestDatasetSwitch({
      datasetId: "ds-concurrent",
      datasetName: "Dataset 1",
      onConfirm: onConfirm1,
    });
    expect(onConfirm1).toHaveBeenCalledTimes(1);

    // Second call — guard should be reset after the first completed.
    fetchQueryMock.mockResolvedValueOnce(makePreview("ncei"));

    const onConfirm2 = vi.fn();
    await requestDatasetSwitch({
      datasetId: "ds-concurrent",
      datasetName: "Dataset 2",
      onConfirm: onConfirm2,
    });

    expect(onConfirm2).toHaveBeenCalledTimes(1);
  });

  it("guard resets even when the fetch throws, allowing a subsequent call", async () => {
    fetchQueryMock
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"));

    const onConfirm1 = vi.fn();
    await requestDatasetSwitch({
      datasetId: "ds-concurrent",
      onConfirm: onConfirm1,
    });

    // Now the in-flight flag must be clear.
    fetchQueryMock.mockResolvedValueOnce(makePreview("ncei"));

    const onConfirm2 = vi.fn();
    await requestDatasetSwitch({
      datasetId: "ds-concurrent",
      onConfirm: onConfirm2,
    });

    expect(onConfirm2).toHaveBeenCalledTimes(1);
  });

  it("suppressed=true path is not gated by the in-flight flag (synchronous fast path)", async () => {
    // Suppress: the fast-path calls onConfirm synchronously without fetching,
    // so the in-flight flag should never block it.
    useSimulatedDataStore.setState({ suppressed: true });
    fetchQueryMock.mockResolvedValue(makePreview("ncei"));

    const onConfirm1 = vi.fn();
    const onConfirm2 = vi.fn();

    // Both calls happen synchronously — neither should be blocked.
    const first = requestDatasetSwitch({ datasetId: "ds-1", onConfirm: onConfirm1 });
    const second = requestDatasetSwitch({ datasetId: "ds-2", onConfirm: onConfirm2 });

    await Promise.all([first, second]);

    // Suppressed fast-path fires immediately for both.
    expect(onConfirm1).toHaveBeenCalledTimes(1);
    expect(onConfirm2).toHaveBeenCalledTimes(1);
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });
});
