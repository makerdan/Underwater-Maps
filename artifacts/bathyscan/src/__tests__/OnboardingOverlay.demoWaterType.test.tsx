/**
 * Regression tests for WT-001 (water-type scoped UX audit):
 * the onboarding "Load the demo" CTA must land the user in a coherent
 * FRESHWATER presentation.
 *
 * The demo (Lake Ray Roberts) is a freshwater lake, but new users start in
 * the saltwater default. If the overlay just requested the dataset switch
 * directly, the demo loaded UNDERNEATH a fully saltwater UI: SALT toggle
 * active, ocean colormap, saltwater zone mapping, and a dataset list that
 * excluded the demo. The fix: when the mode is not freshwater, flip only
 * `waterType` and delegate the load to useWaterTypeSideEffects (which owns
 * teardown, colormap swap, and auto-load of the first freshwater preset).
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// requestDatasetSwitch tracker — resolved impl swapped per test.
const requestDatasetSwitchMock = vi.fn(
  async (args: { datasetId: string; onConfirm: () => void }): Promise<boolean> => {
    args.onConfirm();
    return true;
  },
);
vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: (args: Parameters<typeof requestDatasetSwitchMock>[0]) =>
    requestDatasetSwitchMock(args),
}));

const setDatasetIdMock = vi.fn();
vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: setDatasetIdMock,
    setPendingExternalUserDatasetId: vi.fn(),
  }),
}));

// dismiss() flushes settings to the server — keep it inert here.
vi.mock("@/hooks/useServerSettingsSync", () => ({
  flushServerSync: vi.fn(async () => {}),
  requestSettingsSync: vi.fn(),
}));

import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { OnboardingOverlay } from "@/components/OnboardingOverlay";

describe("OnboardingOverlay — demo load water-type coherence (WT-001)", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      ...DEFAULT_SETTINGS,
      hasSeenOnboarding: false,
    });
    requestDatasetSwitchMock.mockClear();
    setDatasetIdMock.mockClear();
  });

  it("in saltwater mode: flips to freshwater and delegates the load to the side-effects hook", async () => {
    expect(useSettingsStore.getState().waterType).toBe("saltwater");
    render(<OnboardingOverlay />);

    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("onboarding-load-demo-btn"));
    });

    // Mode aligned to the demo's environment…
    expect(useSettingsStore.getState().waterType).toBe("freshwater");
    // …and the load fully delegated: no competing direct switch request
    // (a second in-flight request would be dropped by the guard) and no
    // direct dataset commit that would skip the saltwater teardown.
    expect(requestDatasetSwitchMock).not.toHaveBeenCalled();
    expect(setDatasetIdMock).not.toHaveBeenCalled();
    // Tour dismissed either way.
    expect(useSettingsStore.getState().hasSeenOnboarding).toBe(true);
  });

  it("already in freshwater mode: requests the demo dataset switch directly", async () => {
    useSettingsStore.setState({ waterType: "freshwater" });
    render(<OnboardingOverlay />);

    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("onboarding-load-demo-btn"));
    });

    expect(useSettingsStore.getState().waterType).toBe("freshwater");
    expect(requestDatasetSwitchMock).toHaveBeenCalledTimes(1);
    expect(requestDatasetSwitchMock.mock.calls[0]![0].datasetId).toBe("lake-ray-roberts");
    // Confirmed switch commits the demo dataset.
    expect(setDatasetIdMock).toHaveBeenCalledWith("lake-ray-roberts");
    expect(useSettingsStore.getState().hasSeenOnboarding).toBe(true);
  });
});
