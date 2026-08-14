/**
 * ReassignMarkersDialog.escapeKey.test.tsx
 *
 * Verifies that:
 * 1. Pressing Escape in normal (idle) state calls onClose.
 * 2. Pressing Escape while reassignment is in-flight does NOT call onClose
 *    (mirrors the close-button / backdrop guards).
 * 3. The listener is cleaned up on unmount.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockPatchMutateAsync = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  usePatchMarkersId: () => ({ mutateAsync: mockPatchMutateAsync }),
  useGetDatasetsMySaves: () => ({
    data: [
      {
        id: "save-1",
        datasetId: "ds-1",
        status: "ready",
        displayLabel: "Test Save",
        catalogId: "cat-1",
        catalog: {
          name: "Test Dataset",
          coverageBbox: { minLat: 37, minLon: -122, maxLat: 38, maxLon: -121 },
        },
      },
    ],
    isLoading: false,
  }),
  useGetMarkers: () => ({
    data: [
      { id: "m-1", datasetId: null, lat: 37.5, lon: -121.5 },
    ],
    isLoading: false,
  }),
  getGetMarkersQueryKey: (...a: unknown[]) => ["markers", ...a],
  getGetDatasetsMySavesQueryKey: () => ["datasetsMySaves"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useFocusTrap", () => ({
  useFocusTrap: () => {},
}));

vi.mock("@/hooks/useReturnFocus", () => ({
  useReturnFocus: () => {},
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

import { ReassignMarkersDialog } from "@/components/ReassignMarkersDialog";

function fireEscape() {
  fireEvent.keyDown(window, { key: "Escape", bubbles: true });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ReassignMarkersDialog — Escape key (idle)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Resolve immediately so reassignment completes quickly (not in-flight)
    mockPatchMutateAsync.mockResolvedValue({});
  });

  it("calls onClose when Escape is pressed in idle state", () => {
    const onClose = vi.fn();
    render(<ReassignMarkersDialog onClose={onClose} />);

    fireEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cleans up the listener on unmount — no call after unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(<ReassignMarkersDialog onClose={onClose} />);
    unmount();

    fireEscape();

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ReassignMarkersDialog — Escape key (reassignment in-flight)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Hang forever so isReassigning stays true
    mockPatchMutateAsync.mockReturnValue(new Promise(() => {}));
  });

  it("does NOT call onClose when Escape is pressed while reassignment is in-flight", async () => {
    const onClose = vi.fn();
    render(<ReassignMarkersDialog onClose={onClose} />);

    // Select the save option via its radio button
    const radio = screen.getByTestId("reassign-save-radio-save-1");
    fireEvent.click(radio);

    // Click the confirm/reassign button
    await waitFor(() =>
      expect(screen.getByTestId("reassign-markers-confirm-btn")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("reassign-markers-confirm-btn"));

    // Wait for reassignment to begin (close button becomes disabled)
    await waitFor(() =>
      expect(screen.getByTestId("reassign-markers-close-btn")).toBeDisabled(),
    );

    // Escape must be a no-op while in-flight
    fireEscape();
    expect(onClose).not.toHaveBeenCalled();
  });
});
