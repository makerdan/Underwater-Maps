/**
 * GpsImportDialog.closeLock.test.tsx
 *
 * Regression: the × close button and the backdrop must be non-interactive
 * while marker / trolling-preset mutations are in-flight.
 *
 * Strategy:
 *  1. Mock parseGpsFile to resolve immediately with one waypoint inside bounds.
 *  2. Trigger the file-input change to reach the "preview" phase.
 *  3. Mock usePostMarkers.mutateAsync to return a promise that never resolves,
 *     simulating an in-flight POST.
 *  4. Click "Import" to kick off doImport.
 *  5. Assert: close button is disabled, backdrop click does not call onClose.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { TerrainData } from "@workspace/api-client-react";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mutateAsyncMarkers = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const mutateAsyncPresets = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  usePostMarkers: () => ({ mutateAsync: mutateAsyncMarkers, isPending: false }),
  usePostTrollingPresets: () => ({ mutateAsync: mutateAsyncPresets, isPending: false }),
  getGetMarkersQueryKey: (...a: unknown[]) => ["markers", ...a],
  getGetTrollingPresetsQueryKey: () => ["trollingPresets"],
  MarkerInputType: { custom: "custom" },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/gpsImport", () => ({
  parseGpsFile: vi.fn(),
  partitionByBounds: vi.fn(),
  countPoints: vi.fn(() => 1),
  isInBounds: vi.fn(() => true),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: { waterType: string; defaultMarkerType: string }) => unknown) =>
    sel({ waterType: "saltwater", defaultMarkerType: "custom" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useFocusTrap", () => ({
  useFocusTrap: () => {},
}));

vi.mock("@/lib/markerConstants", () => ({
  SALTWATER_MARKER_TYPES: [{ value: "custom", label: "Custom" }],
  FRESHWATER_MARKER_TYPES: [{ value: "custom", label: "Custom" }],
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

import { parseGpsFile, partitionByBounds } from "@/lib/gpsImport";

const TERRAIN: TerrainData = {
  datasetId: "ds-test",
  minLon: -122,
  minLat: 37,
  maxLon: -121,
  maxLat: 38,
  waterType: "saltwater",
} as unknown as TerrainData;

function setupParseMock() {
  const parsedResult = {
    waypoints: [{ lon: -121.5, lat: 37.5, name: "WP1", depth: 10 }],
    routes: [],
  };
  (parseGpsFile as ReturnType<typeof vi.fn>).mockResolvedValue(parsedResult);
  (partitionByBounds as ReturnType<typeof vi.fn>).mockReturnValue({
    inside: parsedResult,
    outsideWaypoints: 0,
    outsideRoutes: 0,
    outsideRoutePoints: 0,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

import { GpsImportDialog } from "@/components/GpsImportDialog";

describe("GpsImportDialog close-lock during import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupParseMock();
    // Make marker mutation hang forever — simulates in-flight POST
    mutateAsyncMarkers.mockReturnValue(new Promise(() => {}));
    mutateAsyncPresets.mockReturnValue(new Promise(() => {}));
  });

  async function renderAndReachPreview(onClose: ReturnType<typeof vi.fn>) {
    render(<GpsImportDialog terrain={TERRAIN} onClose={onClose} />);

    const fileInput = screen.getByTestId("gps-import-file-input");
    const fakeFile = new File(["fake"], "track.gpx", { type: "application/gpx+xml" });
    Object.defineProperty(fileInput, "files", { value: [fakeFile], configurable: true });
    fireEvent.change(fileInput);

    // Wait for preview to appear (parseGpsFile resolves on next tick)
    await waitFor(() => screen.getByTestId("gps-import-confirm"));
    return screen.getByTestId("gps-import-confirm");
  }

  it("close button is enabled before import starts", async () => {
    const onClose = vi.fn();
    await renderAndReachPreview(onClose);

    const closeBtn = screen.getByTestId("gps-import-close-btn");
    expect(closeBtn).not.toBeDisabled();
    expect(closeBtn).not.toHaveAttribute("aria-disabled", "true");
  });

  it("close button is disabled while import is in-flight", async () => {
    const onClose = vi.fn();
    const confirmBtn = await renderAndReachPreview(onClose);

    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(screen.getByTestId("gps-import-close-btn")).toBeDisabled(),
    );

    const closeBtn = screen.getByTestId("gps-import-close-btn");
    expect(closeBtn).toHaveAttribute("aria-disabled", "true");
    expect(closeBtn).toHaveAttribute("title", "Import in progress — please wait");
  });

  it("onClose is NOT called when close button is clicked during import", async () => {
    const onClose = vi.fn();
    const confirmBtn = await renderAndReachPreview(onClose);

    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(screen.getByTestId("gps-import-close-btn")).toBeDisabled(),
    );

    fireEvent.click(screen.getByTestId("gps-import-close-btn"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("backdrop click does NOT call onClose while import is in-flight", async () => {
    const onClose = vi.fn();
    const confirmBtn = await renderAndReachPreview(onClose);

    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(screen.getByTestId("gps-import-close-btn")).toBeDisabled(),
    );

    const backdrop = screen.getByTestId("gps-import-dialog");
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("in-progress label is shown while import is in-flight", async () => {
    const onClose = vi.fn();
    const confirmBtn = await renderAndReachPreview(onClose);

    expect(screen.queryByTestId("gps-import-in-progress-label")).not.toBeInTheDocument();

    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(screen.getByTestId("gps-import-in-progress-label")).toBeInTheDocument(),
    );
  });

  it("onClose IS called when close button is clicked before import starts", async () => {
    const onClose = vi.fn();
    await renderAndReachPreview(onClose);

    const closeBtn = screen.getByTestId("gps-import-close-btn");
    expect(closeBtn).not.toBeDisabled();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
