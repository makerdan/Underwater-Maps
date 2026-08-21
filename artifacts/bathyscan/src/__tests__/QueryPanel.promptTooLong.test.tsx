/**
 * QueryPanel — prompt-too-long error handling tests.
 *
 * Verifies that when the terrain-guide chat receives a prompt-size validation
 * error from the API (queryLLM throws QueryTooLongError), the panel surfaces
 * an actionable "shorten your question" message rather than a generic failure.
 *
 * Also confirms that ordinary AI failures still produce the generic message so
 * the two error paths remain distinct.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { QueryPanel } from "@/components/QueryPanel";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: true }),
}));

const queryLLMMock = vi.fn();
vi.mock("@/lib/queryLLM", () => ({
  queryLLM: (...args: unknown[]) => queryLLMMock(...args),
  // QueryTooLongError must be present in the mock so the QueryPanel module can
  // import it.  We provide a real class here so instanceof checks in QueryPanel
  // work correctly even though queryLLM itself is stubbed.
  QueryTooLongError: class QueryTooLongError extends Error {
    constructor(details?: string) {
      super(details ?? "Query too long");
      this.name = "QueryTooLongError";
    }
  },
}));

vi.mock("@/lib/queryTools", () => ({
  executeTool: vi.fn(),
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: {
    getState: () => ({ activeGrid: null }),
  },
}));

vi.mock("@/lib/cameraStore", () => ({
  useCameraStore: {
    getState: () => ({ cameraPosition: { known: false }, cameraDepth: null }),
  },
}));

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: {
    getState: () => ({ zoneMap: null }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetSettings() {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS, llmDisclosureAcknowledged: true });
}

const noop = () => {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QueryPanel — prompt-too-long error handling", () => {
  beforeEach(() => {
    resetSettings();
    queryLLMMock.mockReset();
  });

  it("shows a clear 'question too long' message when queryLLM throws QueryTooLongError", async () => {
    const tooLongErr = Object.assign(new Error("final retained prompt must not exceed 16000 characters"), {
      name: "QueryTooLongError",
    });
    queryLLMMock.mockRejectedValueOnce(tooLongErr);

    renderWithProviders(
      <QueryPanel open={true} onClose={noop} setDatasetId={noop} />,
    );

    const input = screen.getByTestId("query-input");
    await act(async () => {
      fireEvent.change(input, { target: { value: "a".repeat(2001) } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    const result = await screen.findByTestId("query-result");
    expect(result.textContent).toMatch(/too long/i);
    expect(result.textContent).toMatch(/shorten/i);
  });

  it("the 'too long' message mentions shortening the question or context", async () => {
    const tooLongErr = Object.assign(new Error("Query too long"), {
      name: "QueryTooLongError",
    });
    queryLLMMock.mockRejectedValueOnce(tooLongErr);

    renderWithProviders(
      <QueryPanel open={true} onClose={noop} setDatasetId={noop} />,
    );

    const input = screen.getByTestId("query-input");
    await act(async () => {
      fireEvent.change(input, { target: { value: "how deep is it?" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    const result = await screen.findByTestId("query-result");
    // The message should guide the user: shorten the question or conversation context.
    expect(result.textContent).toMatch(/question|context/i);
    expect(result.textContent).toMatch(/shorten/i);
  });

  it("shows a generic fallback message for non-size AI failures", async () => {
    queryLLMMock.mockRejectedValueOnce(new Error("AI service unavailable"));

    renderWithProviders(
      <QueryPanel open={true} onClose={noop} setDatasetId={noop} />,
    );

    const input = screen.getByTestId("query-input");
    await act(async () => {
      fireEvent.change(input, { target: { value: "what is the depth?" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    const result = await screen.findByTestId("query-result");
    // Generic AI errors should NOT say "too long"
    expect(result.textContent).not.toMatch(/too long/i);
    expect(result.textContent).toContain("AI service unavailable");
  });

  it("does not call queryLLM when query is empty", async () => {
    renderWithProviders(
      <QueryPanel open={true} onClose={noop} setDatasetId={noop} />,
    );

    const input = screen.getByTestId("query-input");
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(queryLLMMock).not.toHaveBeenCalled();
  });
});
