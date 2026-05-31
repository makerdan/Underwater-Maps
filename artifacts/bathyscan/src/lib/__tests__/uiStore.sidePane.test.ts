import { describe, it, expect, beforeEach, vi } from "vitest";

describe("uiStore sidePaneCollapsed persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("defaults to false when no value persisted", async () => {
    const { useUiStore } = await import("../uiStore");
    expect(useUiStore.getState().sidePaneCollapsed).toBe(false);
  });

  it("updates uiStore state when setSidePaneCollapsed(true)", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.getState().setSidePaneCollapsed(true);
    expect(useUiStore.getState().sidePaneCollapsed).toBe(true);
  });

  it("updates uiStore state when setSidePaneCollapsed(false)", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.getState().setSidePaneCollapsed(true);
    useUiStore.getState().setSidePaneCollapsed(false);
    expect(useUiStore.getState().sidePaneCollapsed).toBe(false);
  });

  it("also writes sidePaneCollapsed to settingsStore for server sync", async () => {
    const { useUiStore } = await import("../uiStore");
    const { useSettingsStore } = await import("../settingsStore");
    useUiStore.getState().setSidePaneCollapsed(true);
    expect(useSettingsStore.getState().sidePaneCollapsed).toBe(true);
    useUiStore.getState().setSidePaneCollapsed(false);
    expect(useSettingsStore.getState().sidePaneCollapsed).toBe(false);
  });

  it("stale localStorage key bathyscan:sidePaneCollapsed is removed on module load", async () => {
    localStorage.setItem("bathyscan:sidePaneCollapsed", "true");
    await import("../uiStore");
    expect(localStorage.getItem("bathyscan:sidePaneCollapsed")).toBeNull();
  });
});
