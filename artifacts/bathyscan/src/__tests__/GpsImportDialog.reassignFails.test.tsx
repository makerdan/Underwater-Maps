/**
 * GpsImportDialog.reassignFails.test.tsx
 *
 * Tests that reassignment failures during GPS import are counted and surfaced
 * in the completion toast rather than being silently swallowed.
 *
 * Coverage:
 *  (a) partial failure: some patches succeed, some fail → toast includes failure count
 *  (b) all failures: every PATCH throws → toast includes the total failure count
 *  (c) no failures: PATCH all succeeds → toast does NOT mention reassignments
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Hoisted mock handles ──────────────────────────────────────────────────────

const mockPostMarkers = vi.hoisted(() =>
  vi.fn<() => Promise<{ id: string }>>().mockResolvedValue({ id: "new-1" }),
);
const mockPatchMarkersId = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const mockToast = vi.hoisted(() => vi.fn());
const mockGetDatasetsMySavesImpl = vi.hoisted(() =>
  vi.fn((_opts?: unknown) => ({ data: [] as unknown[], isLoading: false })),
);
const mockGetMarkersImpl = vi.hoisted(() =>
  vi.fn((_params?: unknown, _opts?: unknown) => ({ data: [] as unknown[] })),
);

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  usePostMarkers: () => ({ mutateAsync: mockPostMarkers }),
  usePostTrollingPresets: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useDeleteMarkersId: () => ({ mutateAsync: vi.fn() }),
  usePatchMarkersId: () => ({ mutateAsync: mockPatchMarkersId }),
  useGetDatasetsMySaves: (opts?: unknown) => mockGetDatasetsMySavesImpl(opts),
  useGetMarkers: (params?: unknown, opts?: unknown) => mockGetMarkersImpl(params, opts),
  getGetMarkersQueryKey: (...a: unknown[]) => ["markers", ...a],
  getGetDatasetsMySavesQueryKey: () => ["datasetsMySaves"],
  getGetTrollingPresetsQueryKey: () => ["trollingPresets"],
  MarkerInputType: { custom: "custom" },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/gpsImport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gpsImport")>()),
  parseGpsFile: vi.fn(),
  partitionByBounds: vi.fn(),
  countPoints: vi.fn(() => 1),
  isInBounds: vi.fn(() => true),
  computeResultBbox: vi.fn(() => ({ minLon: -93.5, minLat: 45.0, maxLon: -92.5, maxLat: 46.0 })),
  bboxIntersects: vi.fn(() => true),
  applyColumnAssignment: vi.fn(() => ({ waypoints: [], routes: [] })),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: { waterType: string; defaultMarkerType: string }) => unknown) =>
    sel({ waterType: "saltwater", defaultMarkerType: "custom" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/hooks/useFocusTrap", () => ({
  useFocusTrap: () => {},
}));

vi.mock("@/hooks/useReturnFocus", () => ({
  useReturnFocus: () => {},
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat();
});

vi.mock("@/lib/markerConstants", () => ({
  SALTWATER_MARKER_TYPES: [{ value: "custom", label: "Custom" }],
  FRESHWATER_MARKER_TYPES: [{ value: "custom", label: "Custom" }],
  NATURAL_WORLD_MARKER_TYPES: [],
  MARINER_MARKER_TYPES: [],
  SPECIAL_MARKER_TYPES: [],
}));

vi.mock("@/components/ColumnMappingStep", () => ({
  ColumnMappingStep: () => null,
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { parseGpsFile, partitionByBounds, bboxIntersects } from "@/lib/gpsImport";
import { GpsImportDialog } from "@/components/GpsImportDialog";

// ── Test data ─────────────────────────────────────────────────────────────────

const MATCHING_SAVE = {
  id: "save-abc",
  catalogId: "cat-1",
  status: "ready" as const,
  requestedAt: new Date(),
  datasetId: "ds-lake-1",
  displayLabel: null,
  folderId: null,
  cacheKey: null,
  errorMessage: null,
  readyAt: new Date(),
  catalog: {
    id: "cat-1",
    name: "Lake Superior",
    sourceAgency: "NOAA",
    dataType: "bathymetry" as const,
    coverageBbox: { minLon: -93.8, minLat: 44.8, maxLon: -92.0, maxLat: 46.5 },
    waterType: "freshwater" as const,
    createdAt: new Date(),
    resolutionMMin: null,
    resolutionMMax: null,
    endpointUrl: null,
    accessNotes: null,
    description: null,
    keywords: null,
    lastUpdated: null,
  },
};

const PARSED_RESULT = {
  waypoints: [
    { lon: -93.0, lat: 45.5, name: "WP1", depth: 10, source: "waypoint" as const },
  ],
  routes: [],
};

const EXISTING_MARKERS = [
  {
    id: "m-existing-1",
    datasetId: null,
    lat: 45.5,
    lon: -93.0,
    depth: 5,
    type: "custom",
    label: "Old A",
    createdAt: new Date(),
    userId: "u1",
  },
  {
    id: "m-existing-2",
    datasetId: null,
    lat: 45.6,
    lon: -92.9,
    depth: 3,
    type: "custom",
    label: "Old B",
    createdAt: new Date(),
    userId: "u1",
  },
  {
    id: "m-existing-3",
    datasetId: null,
    lat: 45.4,
    lon: -92.8,
    depth: 7,
    type: "custom",
    label: "Old C",
    createdAt: new Date(),
    userId: "u1",
  },
];

function setupParseMocks() {
  (parseGpsFile as ReturnType<typeof vi.fn>).mockResolvedValue({
    result: PARSED_RESULT,
    meta: { columns: [], sampleRows: [], allRows: [], fileType: "self-describing" },
  });
  (partitionByBounds as ReturnType<typeof vi.fn>).mockReturnValue({
    inside: PARSED_RESULT,
    outsideWaypoints: 0,
    outsideRoutes: 0,
    outsideRoutePoints: 0,
  });
  (bboxIntersects as ReturnType<typeof vi.fn>).mockReturnValue(true);
}

async function renderAndReachPreviewWithSave() {
  const onClose = vi.fn();
  render(<GpsImportDialog onClose={onClose} />);
  const fileInput = screen.getByTestId("gps-import-file-input");
  const fakeFile = new File(["fake"], "track.gpx", { type: "application/gpx+xml" });
  Object.defineProperty(fileInput, "files", { value: [fakeFile], configurable: true });
  fireEvent.change(fileInput);
  // Wait for preview phase
  await waitFor(() => screen.getByTestId("gps-import-confirm"));
  // Select the matching save
  const saveRadio = screen.getByTestId(`gps-import-save-radio-${MATCHING_SAVE.id}`);
  fireEvent.click(saveRadio);
  // Wait for reassign toggle to appear (existing markers present)
  await waitFor(() => screen.getByTestId("gps-import-reassign-existing"));
  return { onClose };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GpsImportDialog — reassignment failure toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupParseMocks();
    mockPostMarkers.mockResolvedValue({ id: "new-marker-1" });
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [MATCHING_SAVE], isLoading: false });
    mockGetMarkersImpl.mockReturnValue({ data: EXISTING_MARKERS });
  });

  // (a) partial failure → toast mentions failure count
  it("(a) includes reassignment failure count in toast when some PATCHes fail", async () => {
    // First PATCH succeeds, second and third throw
    mockPatchMarkersId
      .mockResolvedValueOnce({ id: "m-existing-1", datasetId: "ds-lake-1" })
      .mockRejectedValueOnce(new Error("server error"))
      .mockRejectedValueOnce(new Error("server error"));

    await renderAndReachPreviewWithSave();
    fireEvent.click(screen.getByTestId("gps-import-confirm"));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "GPS import complete",
          description: expect.stringContaining("2 reassignment"),
        }),
      ),
    );
  });

  // (b) all failures → toast mentions all failures
  it("(b) includes count of all failures when every PATCH throws", async () => {
    mockPatchMarkersId.mockRejectedValue(new Error("network error"));

    await renderAndReachPreviewWithSave();
    fireEvent.click(screen.getByTestId("gps-import-confirm"));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "GPS import complete",
          description: expect.stringContaining("3 reassignment"),
        }),
      ),
    );
    // Confirm failure message mentions "failed"
    const call = mockToast.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { title: string }).title === "GPS import complete",
    );
    expect((call?.[0] as { description: string }).description).toContain("failed");
  });

  // (c) no failures → toast does NOT mention reassignments
  it("(c) omits reassignment text from toast when all PATCHes succeed", async () => {
    mockPatchMarkersId.mockResolvedValue({ id: "m-existing-1", datasetId: "ds-lake-1" });

    await renderAndReachPreviewWithSave();
    fireEvent.click(screen.getByTestId("gps-import-confirm"));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "GPS import complete" }),
      ),
    );
    const call = mockToast.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { title: string }).title === "GPS import complete",
    );
    expect((call?.[0] as { description: string }).description).not.toContain("reassignment");
  });
});
