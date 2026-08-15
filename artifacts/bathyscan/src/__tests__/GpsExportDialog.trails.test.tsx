/**
 * GpsExportDialog.trails.test.tsx
 *
 * Tests the Recorded Trails section of the export dialog:
 *  (a) empty state shown when the dataset has no recorded trails
 *  (b) trails listed with checkbox, name, point count, and date
 *  (c) selecting a trail fetches its points and includes a <trk> track in
 *      the downloaded GPX (real serializer via the sync jsdom fallback)
 *  (d) download disabled when nothing at all is selected/available
 *
 * serializeAsync is NOT mocked here — jsdom has no Worker, so the real
 * synchronous GPX serializer runs and we assert on actual output.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Hoisted mock handles ──────────────────────────────────────────────────────

const mockDownloadTextFile = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockGetTrailsIdPoints = vi.hoisted(() =>
  vi.fn<
    (id: string, params?: { page?: number; pageSize?: number }) => Promise<{
      points: { lon: number; lat: number; accuracy: number; timestamp: number; seq: number }[];
      total: number;
      page: number;
      pageSize: number;
    }>
  >(),
);
const mockTrailsData = vi.hoisted(() => ({ current: [] as unknown[] }));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/gpsExport", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/gpsExport")>();
  return {
    ...original,
    downloadTextFile: mockDownloadTextFile,
  };
});

vi.mock("@workspace/api-client-react", () => ({
  useGetMarkers: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetTrollingPresets: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetCatches: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetTrails: () => ({
    data: mockTrailsData.current,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  getGetMarkersQueryKey: (...a: unknown[]) => ["markers", ...a],
  getGetTrollingPresetsQueryKey: () => ["trollingPresets"],
  getGetCatchesQueryKey: (...a: unknown[]) => ["catches", ...a],
  getGetTrailsQueryKey: (...a: unknown[]) => ["trails", ...a],
  getTrailsIdPoints: mockGetTrailsIdPoints,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/hooks/useFocusTrap", () => ({
  useFocusTrap: () => {},
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { GpsExportDialog } from "@/components/GpsExportDialog";

const TERRAIN = {
  datasetId: "ds-1",
  name: "Test Lake",
  minLon: -93,
  minLat: 45,
  maxLon: -92,
  maxLat: 46,
  waterType: "freshwater" as const,
};

const TRAIL_A = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  userId: "u1",
  datasetId: "ds-1",
  name: "Morning drift",
  colour: "#ff6600",
  startedAt: "2026-01-15T08:00:00.000Z",
  endedAt: "2026-01-15T09:00:00.000Z",
  pointCount: 2,
  createdAt: "2026-01-15T09:00:01.000Z",
};

function renderDialog() {
  const onClose = vi.fn();
  render(<GpsExportDialog terrain={TERRAIN as never} onClose={onClose} />);
  return { onClose };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GpsExportDialog — Recorded Trails section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrailsData.current = [];
  });

  // (a) empty state
  it("(a) shows an empty state when no trails exist", () => {
    renderDialog();

    expect(screen.getByTestId("gps-export-trails-section")).toBeInTheDocument();
    expect(screen.getByTestId("gps-export-trails-empty")).toBeInTheDocument();
    expect(screen.getByText(/No recorded trails for this dataset yet/)).toBeInTheDocument();
  });

  // (b) trail rows
  it("(b) lists trails with checkbox, name, point count, and date", () => {
    mockTrailsData.current = [TRAIL_A];
    renderDialog();

    expect(screen.queryByTestId("gps-export-trails-empty")).not.toBeInTheDocument();
    const row = screen.getByTestId(`gps-export-trail-${TRAIL_A.id}`);
    expect(row).toHaveTextContent("Morning drift");
    expect(row).toHaveTextContent("2 pts");
    const checkbox = screen.getByTestId(`gps-export-trail-checkbox-${TRAIL_A.id}`);
    expect(checkbox).not.toBeChecked();
    // Summary shows selected/total.
    expect(screen.getByTestId("gps-export-trail-count").textContent).toBe("0/1");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByTestId("gps-export-trail-count").textContent).toBe("1/1");
  });

  // (c) selected trail exported as a <trk> track
  it("(c) exports a selected trail as a GPX <trk> with timestamped points", async () => {
    mockTrailsData.current = [TRAIL_A];
    mockGetTrailsIdPoints.mockResolvedValue({
      points: [
        { lon: -92.5, lat: 45.5, accuracy: 3, timestamp: Date.UTC(2026, 0, 15, 8, 0, 0), seq: 0 },
        { lon: -92.51, lat: 45.51, accuracy: 3, timestamp: Date.UTC(2026, 0, 15, 8, 0, 10), seq: 1 },
      ],
      total: 2,
      page: 1,
      pageSize: 1000,
    });

    renderDialog();

    fireEvent.click(screen.getByTestId(`gps-export-trail-checkbox-${TRAIL_A.id}`));
    fireEvent.click(screen.getByTestId("gps-export-confirm"));

    await waitFor(() => expect(mockDownloadTextFile).toHaveBeenCalledOnce());

    expect(mockGetTrailsIdPoints).toHaveBeenCalledWith(
      TRAIL_A.id,
      expect.objectContaining({ page: 1 }),
    );

    const gpx = mockDownloadTextFile.mock.calls[0]![0] as string;
    expect(gpx).toContain("<trk>");
    expect(gpx).toContain("<name>Morning drift</name>");
    expect(gpx).toContain("<trkseg>");
    expect(gpx.match(/<trkpt /g)).toHaveLength(2);
    expect(gpx).toContain("<time>2026-01-15T08:00:00.000Z</time>");

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "GPS export ready" }),
    );
  });

  // (d) download gated on selection
  it("(d) keeps Download disabled when trails exist but nothing is selected", () => {
    mockTrailsData.current = [TRAIL_A];
    renderDialog();

    // No markers, no routes, trail not ticked → nothing would be exported.
    expect(screen.getByTestId("gps-export-confirm")).toBeDisabled();

    fireEvent.click(screen.getByTestId(`gps-export-trail-checkbox-${TRAIL_A.id}`));
    expect(screen.getByTestId("gps-export-confirm")).not.toBeDisabled();
  });
});
