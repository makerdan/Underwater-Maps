/**
 * defaultMapLoadLogic.ts — pure helper that resolves which dataset should be
 * auto-selected on app start, given the user's stored preference and the
 * available datasets.
 *
 * Keeping this logic outside of the React effect makes it unit-testable
 * without needing to mount the full component tree.
 *
 * Branches (evaluated in priority order):
 *   1. upload-check not ready  → "wait" (upload existence not yet confirmed)
 *   2. URL share link           → "url-switch"  (URL always wins)
 *   3. resume last session      → "switch"       (when cameraSpawnBehaviour="last")
 *   4. preset preference        → "switch"       (preferred or first available)
 *   5. upload preference        → "upload-pending" | "switch" (exists / deleted)
 *   6. no preference            → "switch"       (first available)
 *   7. no datasets              → "none"
 */
import type { DefaultMapLoad, LastSession } from "./settingsStore";

export interface DatasetStub {
  id: string;
  name: string;
}

export type DefaultDatasetAction =
  /** Still waiting for userDatasets to confirm whether the upload exists. */
  | { type: "wait" }
  /** URL share-link dataset wins — call requestDatasetSwitch. */
  | { type: "url-switch"; datasetId: string; name: string }
  /** Auto-select a preset/fallback dataset — call requestDatasetSwitch. */
  | { type: "switch"; datasetId: string; name: string }
  /** Trigger the user-dataset load pipeline via setPendingExternalUserDatasetId. */
  | { type: "upload-pending"; uploadId: string }
  /** Nothing to select (no datasets available or no action needed). */
  | { type: "none" };

export interface ResolveDefaultDatasetArgs {
  datasets: DatasetStub[];
  defaultMapLoad: DefaultMapLoad | null;
  /** Resolved user-upload list; `undefined` means the query hasn't settled yet. */
  userDatasets: DatasetStub[] | undefined;
  isSignedIn: boolean | undefined;
  /** datasetId extracted from the current URL (?ds=...), if any. */
  urlDatasetId: string | undefined;
  /** Current value of pendingExternalUserDatasetId in AppContext. */
  pendingExternalUserDatasetId: string | null;
  cameraSpawnBehaviour: string;
  lastSession: LastSession | null | undefined;
}

/**
 * Pure function — no side effects, no async, no store access.
 *
 * Returns a descriptor of what the caller should do.  The caller (App.tsx)
 * is responsible for dispatching the action (calling requestDatasetSwitch,
 * setPendingExternalUserDatasetId, or setDatasetId(null)).
 */
export function resolveDefaultDataset(
  args: ResolveDefaultDatasetArgs,
): DefaultDatasetAction {
  const {
    datasets,
    defaultMapLoad,
    userDatasets,
    isSignedIn,
    urlDatasetId,
    pendingExternalUserDatasetId,
    cameraSpawnBehaviour,
    lastSession,
  } = args;

  if (!datasets.length) return { type: "none" };

  // For upload defaults, wait until the userDatasets query settles so we
  // can verify existence before committing. Preset and "no preference"
  // cases don't need to wait.
  const needsUploadCheck =
    defaultMapLoad?.kind === "upload" && !!isSignedIn && userDatasets === undefined;
  if (needsUploadCheck) return { type: "wait" };

  // URL share link always wins.
  const urlMatch = urlDatasetId
    ? datasets.find((d) => d.id === urlDatasetId)
    : undefined;
  if (urlMatch) {
    return { type: "url-switch", datasetId: urlMatch.id, name: urlMatch.name };
  }

  // Resume last session: when no URL share link is present, prefer the
  // dataset from the last session so the user picks up where they left off.
  if (cameraSpawnBehaviour === "last" && lastSession?.datasetId) {
    const sessionDataset = datasets.find((d) => d.id === lastSession.datasetId);
    if (sessionDataset) {
      return { type: "switch", datasetId: sessionDataset.id, name: sessionDataset.name };
    }
    // Dataset no longer exists — fall through to defaultMapLoad / first preset.
  }

  // Apply the user's stored default.
  if (defaultMapLoad) {
    if (defaultMapLoad.kind === "preset") {
      const preferred = datasets.find((d) => d.id === defaultMapLoad.id);
      const target = preferred ?? datasets[0];
      if (target) return { type: "switch", datasetId: target.id, name: target.name };
      return { type: "none" };
    }

    if (defaultMapLoad.kind === "upload") {
      const uploadExists = userDatasets?.some((d) => d.id === defaultMapLoad.id) ?? false;
      if (uploadExists && !pendingExternalUserDatasetId) {
        return { type: "upload-pending", uploadId: defaultMapLoad.id };
      }
      // Upload no longer exists (deleted). Fall back to first preset so
      // the scene isn't permanently blank.
      const target = datasets[0];
      if (target) return { type: "switch", datasetId: target.id, name: target.name };
      return { type: "none" };
    }
  }

  // No stored preference — fall back to the first available dataset.
  const target = datasets[0];
  if (target) return { type: "switch", datasetId: target.id, name: target.name };
  return { type: "none" };
}
