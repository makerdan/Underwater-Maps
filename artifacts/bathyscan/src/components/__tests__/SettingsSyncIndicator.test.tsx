import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const syncControl = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { snapshot: { syncing: false, lastSyncFailed: false } };
  const flushServerSync = vi.fn(() => Promise.resolve());
  const setStatus = (next: { syncing: boolean; lastSyncFailed: boolean }) => {
    state.snapshot = next;
    for (const listener of listeners) listener();
  };
  return { listeners, state, flushServerSync, setStatus };
});

const authState = vi.hoisted(() => ({ isSignedIn: true }));
const unackedState = vi.hoisted(() => ({ value: false }));

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => authState,
}));

vi.mock("@/hooks/useServerSettingsSync", () => ({
  flushServerSync: syncControl.flushServerSync,
  getSettingsSyncStatus: () => syncControl.state.snapshot,
  subscribeSettingsSyncStatus: (listener: () => void) => {
    syncControl.listeners.add(listener);
    return () => syncControl.listeners.delete(listener);
  },
  hasUnackedSettingsEdits: () => unackedState.value,
}));

import { SettingsSyncIndicator } from "@/components/SettingsSyncIndicator";
import { GlobalResetFooter } from "@/pages/settings/components/GlobalResetFooter";

beforeEach(() => {
  vi.useFakeTimers();
  authState.isSignedIn = true;
  unackedState.value = false;
  syncControl.state.snapshot = { syncing: false, lastSyncFailed: false };
  syncControl.flushServerSync.mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("SettingsSyncIndicator", () => {
  it("shows an acknowledgement immediately, then hides it after two seconds", () => {
    render(<SettingsSyncIndicator />);
    const status = screen.getByTestId("global-settings-sync-status");
    expect(status).toHaveAttribute(
      "data-sync-state",
      "acknowledged",
    );
    expect(status).toHaveClass("pointer-events-none");

    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.getByTestId("global-settings-sync-status")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("global-settings-sync-status")).toBeNull();
  });

  it("distinguishes acknowledged settings from locally pending settings", () => {
    render(<SettingsSyncIndicator />);
    expect(screen.getByTestId("global-settings-sync-status")).toHaveAttribute(
      "data-sync-state",
      "acknowledged",
    );

    unackedState.value = true;
    act(() => syncControl.setStatus({ syncing: true, lastSyncFailed: false }));
    expect(screen.getByTestId("global-settings-sync-status")).toHaveAttribute(
      "data-sync-state",
      "pending",
    );
    expect(screen.getByText("Settings pending sync")).toBeInTheDocument();
  });

  it("shows a fresh acknowledgement after later pending work completes", () => {
    render(<SettingsSyncIndicator />);

    act(() => vi.advanceTimersByTime(1_000));

    unackedState.value = true;
    act(() => syncControl.setStatus({ syncing: true, lastSyncFailed: false }));
    expect(screen.getByText("Settings pending sync")).toBeInTheDocument();

    // Let the original acknowledgement timer reach its deadline while the
    // actionable pending state is displayed.
    act(() => vi.advanceTimersByTime(1_000));

    unackedState.value = false;
    act(() => syncControl.setStatus({ syncing: false, lastSyncFailed: false }));
    expect(screen.getByTestId("global-settings-sync-status")).toHaveAttribute(
      "data-sync-state",
      "acknowledged",
    );

    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.getByText("Settings synced")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("global-settings-sync-status")).toBeNull();
  });

  it("does not block global reset confirmation while settings are acknowledged", () => {
    render(
      <>
        <SettingsSyncIndicator />
        <GlobalResetFooter />
      </>,
    );

    expect(screen.getByTestId("global-settings-sync-status")).toHaveAttribute(
      "data-sync-state",
      "acknowledged",
    );
    fireEvent.click(screen.getByTestId("reset-all-btn"));
    expect(screen.getByRole("group", { name: "Confirm reset" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-reset-all-btn"));
    expect(screen.getByTestId("reset-flash")).toBeInTheDocument();
  });

  it("keeps failed state actionable and retries through the canonical flush", () => {
    render(<SettingsSyncIndicator />);
    act(() => syncControl.setStatus({ syncing: false, lastSyncFailed: true }));
    expect(screen.getByTestId("global-settings-sync-status")).toHaveAttribute(
      "data-sync-state",
      "failed",
    );

    fireEvent.click(screen.getByTestId("global-settings-sync-retry"));
    expect(syncControl.flushServerSync).toHaveBeenCalledTimes(1);

    act(() => syncControl.setStatus({ syncing: true, lastSyncFailed: true }));
    expect(screen.getByTestId("global-settings-sync-status")).toHaveAttribute(
      "data-sync-state",
      "pending",
    );

    unackedState.value = false;
    act(() => syncControl.setStatus({ syncing: false, lastSyncFailed: false }));
    expect(screen.getByTestId("global-settings-sync-status")).toHaveAttribute(
      "data-sync-state",
      "acknowledged",
    );
  });

  it("is hidden for signed-out users", () => {
    authState.isSignedIn = false;
    render(<SettingsSyncIndicator />);
    expect(screen.queryByTestId("global-settings-sync-status")).toBeNull();
  });
});