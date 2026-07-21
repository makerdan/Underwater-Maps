/**
 * OnboardingOverlay — Skip/Done flush wiring
 *
 * Covers:
 *   - Skip sets hasSeenOnboarding:true locally BEFORE calling flushServerSync
 *     (so the immediate flush's payload carries the new flag)
 *   - When the immediate flush fails, the edit is re-enqueued through
 *     requestSettingsSync() (the canonical debounced retry/back-off path)
 *     rather than silently dropped
 *   - When the immediate flush succeeds, no retry is scheduled
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const { flushServerSyncMock, requestSettingsSyncMock, callOrder } = vi.hoisted(() => {
  const callOrder: string[] = [];
  const flushServerSyncMock = vi.fn(() => {
    callOrder.push("flushServerSync");
    return Promise.resolve();
  });
  const requestSettingsSyncMock = vi.fn(() => {
    callOrder.push("requestSettingsSync");
  });
  return { flushServerSyncMock, requestSettingsSyncMock, callOrder };
});

vi.mock("@/hooks/useServerSettingsSync", () => ({
  flushServerSync: flushServerSyncMock,
  requestSettingsSync: requestSettingsSyncMock,
}));

const settingsState = {
  hasSeenOnboarding: false,
  setHasSeenOnboarding: vi.fn((v: boolean) => {
    callOrder.push(`setHasSeenOnboarding(${v})`);
    settingsState.hasSeenOnboarding = v;
  }),
};

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: Object.assign(
    (sel: (s: typeof settingsState) => unknown) => sel(settingsState),
    {
      getState: () => settingsState,
      setState: vi.fn(),
      subscribe: () => () => {},
      persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
    },
  ),
}));

const uiState = { setFindDataPanelOpen: vi.fn() };

vi.mock("@/lib/uiStore", () => ({
  useUiStore: Object.assign(
    (sel: (s: typeof uiState) => unknown) => sel(uiState),
    { getState: () => uiState, setState: vi.fn(), subscribe: () => () => {} },
  ),
}));

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: vi.fn(),
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ setDatasetId: vi.fn() }),
}));

import { OnboardingOverlay } from "@/components/OnboardingOverlay";

describe("OnboardingOverlay — Skip flush wiring", () => {
  beforeEach(() => {
    callOrder.length = 0;
    settingsState.hasSeenOnboarding = false;
    flushServerSyncMock.mockClear();
    flushServerSyncMock.mockImplementation(() => {
      callOrder.push("flushServerSync");
      return Promise.resolve();
    });
    requestSettingsSyncMock.mockClear();
    settingsState.setHasSeenOnboarding.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("Skip sets the local flag BEFORE flushing, and flushes exactly once", async () => {
    render(<OnboardingOverlay />);
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));

    expect(settingsState.setHasSeenOnboarding).toHaveBeenCalledWith(true);
    expect(flushServerSyncMock).toHaveBeenCalledTimes(1);
    // Ordering matters: the flag must be committed to the store before the
    // immediate flush builds its payload, or the PUT carries the old value.
    expect(callOrder).toEqual(["setHasSeenOnboarding(true)", "flushServerSync"]);

    // Successful flush → no retry scheduled.
    await Promise.resolve();
    await Promise.resolve();
    expect(requestSettingsSyncMock).not.toHaveBeenCalled();
  });

  it("re-enqueues the sync via requestSettingsSync when the immediate flush fails", async () => {
    flushServerSyncMock.mockImplementation(() => {
      callOrder.push("flushServerSync");
      return Promise.reject(new Error("429 rate_limit"));
    });

    render(<OnboardingOverlay />);
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));

    expect(flushServerSyncMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(requestSettingsSyncMock).toHaveBeenCalledTimes(1);
    });
    // The local flag stays true regardless — the retry path owns persistence.
    expect(settingsState.setHasSeenOnboarding).toHaveBeenCalledWith(true);
  });
});
