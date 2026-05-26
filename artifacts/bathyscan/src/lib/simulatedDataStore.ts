/**
 * simulatedDataStore — global state for the "simulated depth data" warning
 * dialog. Centralizes the dataset-switch interception so every entry point
 * (Find Data, My Saves, presets, programmatic switches) flows through the
 * same preflight + confirmation pathway.
 *
 * Lifecycle:
 *   1. caller invokes `requestDatasetSwitch({ datasetId, datasetName, onConfirm, onCancel })`
 *   2. helper calls the preview API to learn the resolved dataSource
 *   3. if the result is real (ncei/gebco) — or session-suppressed — onConfirm
 *      fires immediately and no dialog opens
 *   4. otherwise the dialog opens with the resolved reason; Confirm → onConfirm,
 *      Cancel → onCancel + toast.
 *
 * "Don't ask again this session" is persisted in sessionStorage so it clears
 * with the tab. Default is always-ask.
 */
import { create } from "zustand";
import {
  getDatasetsIdPreview,
  getGetDatasetsIdPreviewQueryKey,
  type DatasetPreview,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";

const SUPPRESS_KEY = "bathyscan:simulatedDataWarn:suppress";

function readSuppressed(): boolean {
  try {
    return sessionStorage.getItem(SUPPRESS_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSuppressed(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(SUPPRESS_KEY, "true");
    else sessionStorage.removeItem(SUPPRESS_KEY);
  } catch {
    // ignore
  }
}

export interface PendingSwitch {
  datasetId: string;
  datasetName: string;
  preview: DatasetPreview;
  onConfirm: () => void;
  onCancel: () => void;
}

interface SimulatedDataState {
  pending: PendingSwitch | null;
  suppressed: boolean;
  setPending: (p: PendingSwitch | null) => void;
  setSuppressed: (v: boolean) => void;
}

export const useSimulatedDataStore = create<SimulatedDataState>((set) => ({
  pending: null,
  suppressed: readSuppressed(),
  setPending: (pending) => set({ pending }),
  setSuppressed: (suppressed) => {
    writeSuppressed(suppressed);
    set({ suppressed });
  },
}));

export interface RequestSwitchArgs {
  datasetId: string;
  datasetName?: string;
  onConfirm: () => void;
  /** Called when the user dismisses the dialog. Defaults to no-op. */
  onCancel?: () => void;
}

/**
 * Centralized entry point for switching the active dataset. Resolves the
 * upstream data source via the preview endpoint; if synthetic (or
 * verification failed), opens the confirmation dialog. Otherwise the switch
 * happens immediately.
 */
export async function requestDatasetSwitch(args: RequestSwitchArgs): Promise<void> {
  const { datasetId, onConfirm } = args;
  const onCancel = args.onCancel ?? (() => {});

  const { suppressed, setPending } = useSimulatedDataStore.getState();

  let preview: DatasetPreview;
  try {
    preview = await queryClient.fetchQuery({
      queryKey: getGetDatasetsIdPreviewQueryKey(datasetId),
      queryFn: () => getDatasetsIdPreview(datasetId),
      staleTime: 30_000,
    });
  } catch (err) {
    // Treat preflight failure as worst-case (do not silently load).
    preview = {
      datasetId,
      name: args.datasetName ?? datasetId,
      bbox: { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 },
      dataSource: "unknown",
      syntheticReason: `Could not verify data source: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const needsWarning = preview.dataSource === "synthetic" || preview.dataSource === "unknown";
  if (!needsWarning || suppressed) {
    onConfirm();
    return;
  }

  setPending({
    datasetId,
    datasetName: args.datasetName ?? preview.name ?? datasetId,
    preview,
    onConfirm: () => {
      setPending(null);
      onConfirm();
    },
    onCancel: () => {
      setPending(null);
      onCancel();
    },
  });
}
