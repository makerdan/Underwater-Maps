/**
 * Regression tests for resolveDefaultDataset and the startup settings-ready guard.
 *
 * Covers the hydration-race scenario: a signed-in user with a saved preset
 * preference should always load that preset once settings have hydrated, not
 * fall back silently to datasets[0] because the effect fired too early.
 */
import { describe, it, expect } from "vitest";
import { resolveDefaultDataset } from "../defaultMapLoadLogic";
import type { ResolveDefaultDatasetArgs } from "../defaultMapLoadLogic";

const DATASET_A = { id: "ds-a", name: "Dataset A" };
const DATASET_B = { id: "ds-b", name: "Dataset B" };
const datasets = [DATASET_A, DATASET_B];

function baseArgs(overrides: Partial<ResolveDefaultDatasetArgs> = {}): ResolveDefaultDatasetArgs {
  return {
    datasets,
    defaultMapLoad: null,
    userDatasets: undefined,
    isSignedIn: false,
    urlDatasetId: undefined,
    pendingExternalUserDatasetId: null,
    cameraSpawnBehaviour: "default",
    lastSession: null,
    ...overrides,
  };
}

describe("resolveDefaultDataset — settings hydration race", () => {
  it("returns 'switch' to the preferred preset once settings have hydrated", () => {
    const action = resolveDefaultDataset(
      baseArgs({
        defaultMapLoad: { kind: "preset", id: "ds-b" },
        isSignedIn: true,
        userDatasets: [],
      }),
    );
    expect(action.type).toBe("switch");
    if (action.type === "switch") {
      expect(action.datasetId).toBe("ds-b");
    }
  });

  it("returns 'switch' to datasets[0] when no preference is set (signed-out)", () => {
    const action = resolveDefaultDataset(baseArgs({ isSignedIn: false }));
    expect(action.type).toBe("switch");
    if (action.type === "switch") {
      expect(action.datasetId).toBe("ds-a");
    }
  });

  it("returns 'wait' when signed in and upload default but userDatasets not yet settled", () => {
    const action = resolveDefaultDataset(
      baseArgs({
        isSignedIn: true,
        userDatasets: undefined,
        defaultMapLoad: { kind: "upload", id: "user-upload-1" },
      }),
    );
    expect(action.type).toBe("wait");
  });

  it("returns 'none' when the datasets list is empty", () => {
    const action = resolveDefaultDataset(baseArgs({ datasets: [] }));
    expect(action.type).toBe("none");
  });

  it("URL share link wins over stored preference", () => {
    const action = resolveDefaultDataset(
      baseArgs({
        defaultMapLoad: { kind: "preset", id: "ds-b" },
        urlDatasetId: "ds-a",
        isSignedIn: true,
        userDatasets: [],
      }),
    );
    expect(action.type).toBe("url-switch");
    if (action.type === "url-switch") {
      expect(action.datasetId).toBe("ds-a");
    }
  });

  it("falls back to datasets[0] when preferred preset no longer exists", () => {
    const action = resolveDefaultDataset(
      baseArgs({
        defaultMapLoad: { kind: "preset", id: "ds-gone" },
        isSignedIn: true,
        userDatasets: [],
      }),
    );
    expect(action.type).toBe("switch");
    if (action.type === "switch") {
      expect(action.datasetId).toBe("ds-a");
    }
  });
});

describe("resolveDefaultDataset — settingsReady guard contract", () => {
  /**
   * These tests assert the behavior that App.tsx relies on to implement the
   * settingsReady guard:
   *
   *   - Before settings arrive (defaultMapLoad is null, isSignedIn is true),
   *     the function returns "switch" to datasets[0] — which is the WRONG
   *     dataset. That's why App.tsx must NOT call resolveDefaultDataset until
   *     settingsReady is true.
   *
   *   - After settings arrive (defaultMapLoad is set), the function returns
   *     "switch" to the correct preferred dataset.
   *
   * The settingsReady flag in useServerSettingsSync.ts is the mechanism that
   * prevents the "too early" case from being acted upon.
   */
  it("without the guard: null defaultMapLoad picks datasets[0] (wrong behavior to prevent)", () => {
    const action = resolveDefaultDataset(
      baseArgs({ isSignedIn: true, userDatasets: [], defaultMapLoad: null }),
    );
    expect(action.type).toBe("switch");
    if (action.type === "switch") {
      // This is datasets[0], not the user's preference — App.tsx must not
      // act on this result before settingsReady is true.
      expect(action.datasetId).toBe("ds-a");
    }
  });

  it("with settings hydrated: correct preferred dataset is returned", () => {
    const action = resolveDefaultDataset(
      baseArgs({
        isSignedIn: true,
        userDatasets: [],
        defaultMapLoad: { kind: "preset", id: "ds-b" },
      }),
    );
    expect(action.type).toBe("switch");
    if (action.type === "switch") {
      expect(action.datasetId).toBe("ds-b");
    }
  });
});
