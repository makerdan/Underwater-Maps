import { describe, it, expect, beforeEach } from "vitest";

const STORAGE_KEY = "bathyscan:sidePaneCollapsed";

describe("uiStore sidePaneCollapsed persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to false when no value persisted", async () => {
    const { useUiStore } = await import("../uiStore");
    expect(useUiStore.getState().sidePaneCollapsed).toBe(false);
  });

  it("persists collapsed=true to localStorage when setSidePaneCollapsed(true)", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.getState().setSidePaneCollapsed(true);
    expect(useUiStore.getState().sidePaneCollapsed).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("persists collapsed=false to localStorage when setSidePaneCollapsed(false)", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.getState().setSidePaneCollapsed(true);
    useUiStore.getState().setSidePaneCollapsed(false);
    expect(useUiStore.getState().sidePaneCollapsed).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
  });
});
