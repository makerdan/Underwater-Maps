/**
 * GpsExportDialog.loadingError.test.tsx
 *
 * Tests that the export dialog correctly renders loading and error states
 * from the marker/preset/catches queries, rather than showing the misleading
 * "Nothing to export" empty state while data is in-flight or after a failure.
 *
 * Coverage:
 *  (a) spinner shown while any query is loading
 *  (b) error+retry shown when any query fails
 *  (c) summary counts shown once queries succeed
 *  (d) "Nothing to export" only shown when isSuccess AND counts are zero
 *  (e) Download button disabled during loading/error states
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Hoisted mock handles ──────────────────────────────────────────────────────

const mockMarkersRefetch = vi.hoisted(() => vi.fn());
const mockPresetsRefetch = vi.hoisted(() => vi.fn());
const mockCatchesRefetch = vi.hoisted(() => vi.fn());

interface QueryResult {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

const mockGetMarkersImpl = vi.hoisted(() =>
  vi.fn<() => QueryResult>(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: mockMarkersRefetch,
  })),
);
const mockGetTrollingPresetsImpl = vi.hoisted(() =>
  vi.fn<() => QueryResult>(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: mockPresetsRefetch,
  })),
);
const mockGetCatchesImpl = vi.hoisted(() =>
  vi.fn<() => QueryResult>(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: mockCatchesRefetch,
  })),
);

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  useGetMarkers: (_p: unknown, _o: unknown) => mockGetMarkersImpl(),
  useGetTrollingPresets: (_o: unknown) => mockGetTrollingPresetsImpl(),
  useGetCatches: (_p: unknown, _o: unknown) => mockGetCatchesImpl(),
  getGetMarkersQueryKey: (...a: unknown[]) => ["markers", ...a],
  getGetTrollingPresetsQueryKey: () => ["trollingPresets"],
  getGetCatchesQueryKey: (...a: unknown[]) => ["catches", ...a],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useFocusTrap", () => ({
  useFocusTrap: () => {},
}));

vi.mock("@/lib/gpsExport", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/gpsExport")>();
  return {
    ...original,
    downloadTextFile: vi.fn(),
    triggerBlobDownload: vi.fn(),
  };
});

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

function renderDialog() {
  const onClose = vi.fn();
  render(<GpsExportDialog terrain={TERRAIN as never} onClose={onClose} />);
  return { onClose };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GpsExportDialog — loading state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // (a) spinner shown while loading
  it("(a) shows loading indicator when markers query is loading", () => {
    mockGetMarkersImpl.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockMarkersRefetch,
    });
    mockGetTrollingPresetsImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockPresetsRefetch,
    });
    mockGetCatchesImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockCatchesRefetch,
    });

    renderDialog();

    expect(screen.getByTestId("gps-export-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("gps-export-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("gps-export-error")).not.toBeInTheDocument();
  });

  it("(a) shows loading indicator when presets query is loading", () => {
    mockGetMarkersImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockMarkersRefetch,
    });
    mockGetTrollingPresetsImpl.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockPresetsRefetch,
    });
    mockGetCatchesImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockCatchesRefetch,
    });

    renderDialog();

    expect(screen.getByTestId("gps-export-loading")).toBeInTheDocument();
  });

  // (b) error+retry shown on failure
  it("(b) shows error message and retry button when markers query fails", () => {
    mockGetMarkersImpl.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockMarkersRefetch,
    });
    mockGetTrollingPresetsImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockPresetsRefetch,
    });
    mockGetCatchesImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockCatchesRefetch,
    });

    renderDialog();

    expect(screen.getByTestId("gps-export-error")).toBeInTheDocument();
    expect(screen.getByTestId("gps-export-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("gps-export-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("gps-export-loading")).not.toBeInTheDocument();
  });

  it("(b) retry button calls refetch on all three queries", () => {
    mockGetMarkersImpl.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockMarkersRefetch,
    });
    mockGetTrollingPresetsImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockPresetsRefetch,
    });
    mockGetCatchesImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockCatchesRefetch,
    });

    renderDialog();

    fireEvent.click(screen.getByTestId("gps-export-retry"));

    expect(mockMarkersRefetch).toHaveBeenCalledOnce();
    expect(mockPresetsRefetch).toHaveBeenCalledOnce();
    expect(mockCatchesRefetch).toHaveBeenCalledOnce();
  });

  // (c) summary counts shown on success
  it("(c) shows summary counts once all queries succeed", () => {
    mockGetMarkersImpl.mockReturnValue({
      data: [{ id: "m1", lon: 1, lat: 2, depth: 10, label: "A", type: "custom" }],
      isLoading: false,
      isError: false,
      refetch: mockMarkersRefetch,
    });
    mockGetTrollingPresetsImpl.mockReturnValue({
      data: [{ id: "p1", name: "Route", waypoints: [{ lon: 1, lat: 2 }, { lon: 3, lat: 4 }] }],
      isLoading: false,
      isError: false,
      refetch: mockPresetsRefetch,
    });
    mockGetCatchesImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockCatchesRefetch,
    });

    renderDialog();

    expect(screen.getByTestId("gps-export-summary")).toBeInTheDocument();
    expect(screen.getByTestId("gps-export-marker-count").textContent).toBe("1");
    expect(screen.getByTestId("gps-export-route-count").textContent).toBe("1");
    expect(screen.queryByTestId("gps-export-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("gps-export-error")).not.toBeInTheDocument();
  });

  // (d) "Nothing to export" only shown when isSuccess AND counts are zero
  it("(d) does NOT show 'Nothing to export' while loading", () => {
    mockGetMarkersImpl.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockMarkersRefetch,
    });
    mockGetTrollingPresetsImpl.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockPresetsRefetch,
    });
    mockGetCatchesImpl.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockCatchesRefetch,
    });

    renderDialog();

    expect(screen.queryByText(/Nothing to export/)).not.toBeInTheDocument();
  });

  it("(d) does NOT show 'Nothing to export' on error", () => {
    mockGetMarkersImpl.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockMarkersRefetch,
    });
    mockGetTrollingPresetsImpl.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockPresetsRefetch,
    });
    mockGetCatchesImpl.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockCatchesRefetch,
    });

    renderDialog();

    expect(screen.queryByText(/Nothing to export/)).not.toBeInTheDocument();
  });

  it("(d) shows empty-state message when success with zero counts", () => {
    mockGetMarkersImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockMarkersRefetch,
    });
    mockGetTrollingPresetsImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockPresetsRefetch,
    });
    mockGetCatchesImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockCatchesRefetch,
    });

    renderDialog();

    expect(screen.getByText(/No markers or trolling routes to export yet/)).toBeInTheDocument();
  });

  // (e) Download button disabled during loading/error
  it("(e) Download button is disabled while loading", () => {
    mockGetMarkersImpl.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockMarkersRefetch,
    });
    mockGetTrollingPresetsImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockPresetsRefetch,
    });
    mockGetCatchesImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockCatchesRefetch,
    });

    renderDialog();

    expect(screen.getByTestId("gps-export-confirm")).toBeDisabled();
  });

  it("(e) Download button is disabled on error", () => {
    mockGetMarkersImpl.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockMarkersRefetch,
    });
    mockGetTrollingPresetsImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockPresetsRefetch,
    });
    mockGetCatchesImpl.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockCatchesRefetch,
    });

    renderDialog();

    expect(screen.getByTestId("gps-export-confirm")).toBeDisabled();
  });
});
