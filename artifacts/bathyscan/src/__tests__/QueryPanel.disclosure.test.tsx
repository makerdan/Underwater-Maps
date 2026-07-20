/**
 * QueryPanel — LLM disclosure notice unit tests.
 *
 * Verifies that:
 *  1. The disclosure notice renders when llmDisclosureAcknowledged = false.
 *  2. The submit button is disabled while the notice is present.
 *  3. Clicking "UNDERSTOOD" sets llmDisclosureAcknowledged = true and
 *     removes the notice, re-enabling submission.
 *  4. queryLLM is NOT called when the user attempts to submit before
 *     acknowledging the disclosure.
 *  5. queryLLM IS called after acknowledgment (submission gate is unblocked).
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
}));

vi.mock("@/lib/queryTools", () => ({
  executeTool: vi.fn(),
}));

// The buildContext callback reaches into these stores' getState() — provide
// a minimal safe shape so they don't throw during submission.
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
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
}

const noop = () => {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QueryPanel — LLM disclosure notice", () => {
  beforeEach(() => {
    resetSettings();
    queryLLMMock.mockReset();
    queryLLMMock.mockResolvedValue({ toolCalls: [], textResponse: "ok" });
  });

  it("renders the disclosure notice when llmDisclosureAcknowledged is false", () => {
    useSettingsStore.setState({ llmDisclosureAcknowledged: false });
    renderWithProviders(
      <QueryPanel open={true} onClose={noop} setDatasetId={noop} />,
    );
    expect(screen.getByTestId("llm-disclosure-notice")).toBeInTheDocument();
  });

  it("does not render the disclosure notice when llmDisclosureAcknowledged is true", () => {
    useSettingsStore.setState({ llmDisclosureAcknowledged: true });
    renderWithProviders(
      <QueryPanel open={true} onClose={noop} setDatasetId={noop} />,
    );
    expect(screen.queryByTestId("llm-disclosure-notice")).not.toBeInTheDocument();
  });

  it("submit button is disabled while disclosure is unacknowledged", () => {
    useSettingsStore.setState({ llmDisclosureAcknowledged: false });
    renderWithProviders(
      <QueryPanel open={true} onClose={noop} setDatasetId={noop} />,
    );
    expect(screen.getByTestId("query-submit")).toBeDisabled();
  });

  it("queryLLM is NOT called when submit is attempted before acknowledgment", async () => {
    useSettingsStore.setState({ llmDisclosureAcknowledged: false });
    renderWithProviders(
      <QueryPanel open={true} onClose={noop} setDatasetId={noop} />,
    );

    const input = screen.getByTestId("query-input");
    await act(async () => {
      fireEvent.change(input, { target: { value: "how deep is it?" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(queryLLMMock).not.toHaveBeenCalled();
  });

  it("clicking the acknowledge button sets llmDisclosureAcknowledged to true", () => {
    useSettingsStore.setState({ llmDisclosureAcknowledged: false });
    renderWithProviders(
      <QueryPanel open={true} onClose={noop} setDatasetId={noop} />,
    );

    fireEvent.click(screen.getByTestId("llm-disclosure-acknowledge"));

    expect(useSettingsStore.getState().llmDisclosureAcknowledged).toBe(true);
  });

  it("disclosure notice disappears and submit becomes enabled after acknowledgment", () => {
    useSettingsStore.setState({ llmDisclosureAcknowledged: false });
    renderWithProviders(
      <QueryPanel open={true} onClose={noop} setDatasetId={noop} />,
    );

    fireEvent.click(screen.getByTestId("llm-disclosure-acknowledge"));

    expect(screen.queryByTestId("llm-disclosure-notice")).not.toBeInTheDocument();

    const input = screen.getByTestId("query-input");
    fireEvent.change(input, { target: { value: "how deep is it?" } });
    expect(screen.getByTestId("query-submit")).not.toBeDisabled();
  });

  it("queryLLM IS called after acknowledgment when the user submits", async () => {
    useSettingsStore.setState({ llmDisclosureAcknowledged: true });
    renderWithProviders(
      <QueryPanel open={true} onClose={noop} setDatasetId={noop} />,
    );

    const input = screen.getByTestId("query-input");
    await act(async () => {
      fireEvent.change(input, { target: { value: "how deep is it?" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(queryLLMMock).toHaveBeenCalledTimes(1);
    expect(queryLLMMock).toHaveBeenCalledWith(
      "how deep is it?",
      expect.objectContaining({ datasetName: expect.any(String) }),
      expect.any(AbortSignal),
    );
  });

  it("returns null when open is false", () => {
    useSettingsStore.setState({ llmDisclosureAcknowledged: false });
    renderWithProviders(
      <QueryPanel open={false} onClose={noop} setDatasetId={noop} />,
    );
    expect(screen.queryByTestId("query-panel")).not.toBeInTheDocument();
  });
});
