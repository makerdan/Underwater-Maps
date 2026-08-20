import { describe, it, expect, vi, beforeEach } from "vitest";
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

beforeEach(() => {
  authState.isSignedIn = true;
  unackedState.value = false;
  syncControl.state.snapshot = { syncing: false, lastSyncFailed: false };
  syncControl.flushServerSync.mockClear();
});

describe("SettingsSyncIndicator", () => {
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