/**
 * GpsImportDialog.escapeKey.test.tsx
 *
 * Verifies that pressing Escape closes the dialog in normal state, and that
 * the Escape handler is suppressed while an import is in-flight (matching the
 * backdrop-click guard).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { TerrainData } from "@workspace/api-client-react";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockPostMarkers = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const mockPostTrollingPresets = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  postMarkers: mockPostMarkers,
  postTrollingPresets: mockPostTrollingPresets,
  usePostMarkers: () => ({ mutateAsync: mockPostMarkers }),
  usePostTrollingPresets: () => ({ mutateAsync: mockPostTrollingPresets }),
  useDeleteMarkersId: () => ({ mutateAsync: vi.fn() }),
  usePatchMarkersId: () => ({ mutateAsync: vi.fn() }),
  useGetDatasetsMySaves: () => ({ data: [], isLoading: false }),
  useGetMarkers: () => ({ data: [] }),
  getGetMarkersQueryKey: (...a: unknown[]) => ["markers", ...a],
  getGetDatasetsMySavesQueryKey: () => ["datasetsMySaves"],
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
  computeResultBbox: vi.fn(() => null),
  bboxIntersects: vi.fn(() => false),
  applyColumnAssignment: vi.fn(() => ({ waypoints: [], routes: [] })),
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

vi.mock("@/hooks/useReturnFocus", () => ({
  useReturnFocus: () => {},
}));

vi.mock("@/lib/markerConstants", () => ({
  SALTWATER_MARKER_TYPES: [{ value: "custom", label: "Custom" }],
  FRESHWATER_MARKER_TYPES: [{ value: "custom", label: "Custom" }],
  NATURAL_WORLD_MARKER_TYPES: [],
  MARINER_MARKER_TYPES: [],
  SPECIAL_MARKER_TYPES: [],
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

import { parseGpsFile, partitionByBounds } from "@/lib/gpsImport";
import { GpsImportDialog } from "@/components/GpsImportDialog";

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
  (parseGpsFile as ReturnType<typeof vi.fn>).mockResolvedValue({
    result: parsedResult,
    meta: { columns: [], sampleRows: [], allRows: [], fileType: "self-describing" },
  });
  (partitionByBounds as ReturnType<typeof vi.fn>).mockReturnValue({
    inside: parsedResult,
    outsideWaypoints: 0,
    outsideRoutes: 0,
    outsideRoutePoints: 0,
  });
}

function fireEscape() {
  fireEvent.keyDown(window, { key: "Escape", bubbles: true });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GpsImportDialog — Escape key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupParseMock();
  });

  it("calls onClose when Escape is pressed in normal (non-importing) state", () => {
    const onClose = vi.fn();
    render(<GpsImportDialog terrain={TERRAIN} onClose={onClose} />);

    fireEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when Escape is pressed while import is in-flight", async () => {
    // Make the import hang forever so isImporting stays true.
    mockPostMarkers.mockReturnValue(new Promise(() => {}));
    mockPostTrollingPresets.mockReturnValue(new Promise(() => {}));

    const onClose = vi.fn();
    render(<GpsImportDialog terrain={TERRAIN} onClose={onClose} />);

    // Advance to preview phase.
    const fileInput = screen.getByTestId("gps-import-file-input");
    const fakeFile = new File(["fake"], "track.gpx", { type: "application/gpx+xml" });
    Object.defineProperty(fileInput, "files", { value: [fakeFile], configurable: true });
    fireEvent.change(fileInput);

    await waitFor(() => screen.getByTestId("gps-import-confirm"));

    // Kick off the import.
    fireEvent.click(screen.getByTestId("gps-import-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("gps-import-close-btn")).toBeDisabled(),
    );

    // Escape must be a no-op while importing.
    fireEscape();
    expect(onClose).not.toHaveBeenCalled();
  });
});
