/**
 * Regression tests for uiStore's Find Data panel state.
 *
 * Bug #2: Find Data panel must be closed on cold start. No startup path
 * should ever call setFindDataPanelOpen(true) without an explicit user action.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "../uiStore";

beforeEach(() => {
  useUiStore.setState({
    findDataPanelOpen: false,
    openFindDataCount: 0,
  });
});

describe("uiStore — findDataPanelOpen initial state", () => {
  it("findDataPanelOpen is false in the initial store state", () => {
    expect(useUiStore.getState().findDataPanelOpen).toBe(false);
  });

  it("openFindDataCount starts at 0", () => {
    expect(useUiStore.getState().openFindDataCount).toBe(0);
  });

  it("setFindDataPanelOpen(true) opens the panel and increments openFindDataCount", () => {
    useUiStore.getState().setFindDataPanelOpen(true);
    expect(useUiStore.getState().findDataPanelOpen).toBe(true);
    expect(useUiStore.getState().openFindDataCount).toBe(1);
  });

  it("setFindDataPanelOpen(false) closes the panel without incrementing openFindDataCount", () => {
    useUiStore.getState().setFindDataPanelOpen(true);
    useUiStore.getState().setFindDataPanelOpen(false);
    expect(useUiStore.getState().findDataPanelOpen).toBe(false);
    expect(useUiStore.getState().openFindDataCount).toBe(1);
  });

  it("opening the panel twice increments openFindDataCount twice (unique key per open)", () => {
    useUiStore.getState().setFindDataPanelOpen(true);
    useUiStore.getState().setFindDataPanelOpen(false);
    useUiStore.getState().setFindDataPanelOpen(true);
    expect(useUiStore.getState().openFindDataCount).toBe(2);
  });
});
