/**
 * GpsImportDialog.datasetMatcher.test.tsx
 *
 * Tests for the "Assign to a saved dataset" panel that appears in the
 * preview phase when no active terrain dataset is provided.
 *
 * Coverage:
 *  (a) matching saves shown when bbox intersects
 *  (b) "None" path leaves datasetId null
 *  (c) existing-marker count displayed; toggle triggers PATCHes on confirm
 *  (d) zero existing markers hides the reassign toggle
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// ── Hoisted mock handles ──────────────────────────────────────────────────────

const mockPostMarkers = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const mockPatchMarkersId = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
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
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useFocusTrap", () => ({
  useFocusTrap: () => {},
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

// ── Test data ─────────────────────────────────────────────────────────────────

import { parseGpsFile, partitionByBounds, bboxIntersects } from "@/lib/gpsImport";
import { GpsImportDialog } from "@/components/GpsImportDialog";

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
  mockPostMarkers.mockResolvedValue({ id: "new-marker-1" });
  mockPatchMarkersId.mockResolvedValue({ id: "existing-1", datasetId: "ds-lake-1" });
}

async function renderAndReachPreview() {
  const onClose = vi.fn();
  render(<GpsImportDialog onClose={onClose} />);
  const fileInput = screen.getByTestId("gps-import-file-input");
  const fakeFile = new File(["fake"], "track.gpx", { type: "application/gpx+xml" });
  Object.defineProperty(fileInput, "files", { value: [fakeFile], configurable: true });
  fireEvent.change(fileInput);
  // Wait for parse to complete and preview to appear
  await waitFor(() => screen.getByTestId("gps-import-confirm"));
  return { onClose };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GpsImportDialog — DatasetMatcherSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupParseMocks();
  });

  // ── (a) Matching saves shown when bbox intersects ────────────────────────

  it("(a) shows the dataset matcher panel in preview phase (no terrain)", async () => {
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [MATCHING_SAVE], isLoading: false });
    mockGetMarkersImpl.mockReturnValue({ data: [] });
    (bboxIntersects as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await renderAndReachPreview();

    expect(screen.getByTestId("gps-import-dataset-matcher")).toBeInTheDocument();
  });

  it("(a) matching save is listed when its coverage intersects the points bbox", async () => {
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [MATCHING_SAVE], isLoading: false });
    mockGetMarkersImpl.mockReturnValue({ data: [] });
    (bboxIntersects as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await renderAndReachPreview();

    expect(screen.getByTestId(`gps-import-save-option-${MATCHING_SAVE.id}`)).toBeInTheDocument();
    expect(screen.getByText("Lake Superior")).toBeInTheDocument();
  });

  it("(a) non-intersecting save is excluded from the list", async () => {
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [MATCHING_SAVE], isLoading: false });
    mockGetMarkersImpl.mockReturnValue({ data: [] });
    // bboxIntersects returns false → save should NOT appear
    (bboxIntersects as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await renderAndReachPreview();

    // No save option rendered; "no matching" message shown instead
    expect(screen.queryByTestId(`gps-import-save-option-${MATCHING_SAVE.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId("gps-import-no-matching-saves")).toBeInTheDocument();
  });

  it("shows loading indicator while saves are fetching", async () => {
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [] as unknown[], isLoading: true });
    mockGetMarkersImpl.mockReturnValue({ data: [] });

    await renderAndReachPreview();

    expect(screen.getByTestId("gps-import-saves-loading")).toBeInTheDocument();
  });

  it("shows 'no matching' message when saves list is empty after load", async () => {
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [], isLoading: false });
    mockGetMarkersImpl.mockReturnValue({ data: [] });

    await renderAndReachPreview();

    expect(screen.getByTestId("gps-import-no-matching-saves")).toBeInTheDocument();
  });

  // ── (b) "None" path leaves datasetId null ────────────────────────────────

  it("(b) 'None – save as unassigned' option is always present alongside saves", async () => {
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [MATCHING_SAVE], isLoading: false });
    mockGetMarkersImpl.mockReturnValue({ data: [] });
    (bboxIntersects as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await renderAndReachPreview();

    expect(screen.getByTestId("gps-import-save-option-none")).toBeInTheDocument();
  });

  it("(b) confirming with None selected posts markers with datasetId null", async () => {
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [MATCHING_SAVE], isLoading: false });
    mockGetMarkersImpl.mockReturnValue({ data: [] });
    (bboxIntersects as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await renderAndReachPreview();

    // "None" radio is checked by default (matchedSave starts as null)
    fireEvent.click(screen.getByTestId("gps-import-save-radio-none"));
    fireEvent.click(screen.getByTestId("gps-import-confirm"));

    await waitFor(() =>
      expect(mockPostMarkers).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ datasetId: null }),
        }),
      ),
    );
  });

  it("selecting a matching save stamps new markers with its datasetId", async () => {
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [MATCHING_SAVE], isLoading: false });
    mockGetMarkersImpl.mockReturnValue({ data: [] });
    (bboxIntersects as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await renderAndReachPreview();

    fireEvent.click(screen.getByTestId(`gps-import-save-radio-${MATCHING_SAVE.id}`));
    fireEvent.click(screen.getByTestId("gps-import-confirm"));

    await waitFor(() =>
      expect(mockPostMarkers).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ datasetId: "ds-lake-1" }),
        }),
      ),
    );
  });

  // ── (d) Zero existing markers hides the reassign toggle ──────────────────

  it("(d) hides the reassign toggle when no unassigned markers exist in the area", async () => {
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [MATCHING_SAVE], isLoading: false });
    mockGetMarkersImpl.mockReturnValue({ data: [] }); // 0 existing markers
    (bboxIntersects as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await renderAndReachPreview();

    fireEvent.click(screen.getByTestId(`gps-import-save-radio-${MATCHING_SAVE.id}`));

    // Toggle must stay hidden when count is 0
    expect(screen.queryByTestId("gps-import-reassign-existing")).not.toBeInTheDocument();
  });

  // ── (c) Existing-marker count + toggle triggers PATCHes ──────────────────

  it("(c) shows reassign toggle with correct count when existing unassigned markers exist", async () => {
    const existingMarkers = [
      { id: "m1", datasetId: null, lat: 45.5, lon: -93.0, depth: 5, type: "custom", label: "Old A", createdAt: new Date(), userId: "u1" },
      { id: "m2", datasetId: null, lat: 45.6, lon: -92.9, depth: 3, type: "custom", label: "Old B", createdAt: new Date(), userId: "u1" },
    ];
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [MATCHING_SAVE], isLoading: false });
    mockGetMarkersImpl.mockReturnValue({ data: existingMarkers });
    (bboxIntersects as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await renderAndReachPreview();

    fireEvent.click(screen.getByTestId(`gps-import-save-radio-${MATCHING_SAVE.id}`));

    await waitFor(() =>
      expect(screen.getByTestId("gps-import-reassign-existing")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Also reassign 2 existing unassigned markers in this area/)).toBeInTheDocument();
  });

  it("(c) confirming with reassign toggle checked PATCHes each existing marker", async () => {
    const existingMarkers = [
      { id: "m1", datasetId: null, lat: 45.5, lon: -93.0, depth: 5, type: "custom", label: "Old A", createdAt: new Date(), userId: "u1" },
    ];
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [MATCHING_SAVE], isLoading: false });
    mockGetMarkersImpl.mockReturnValue({ data: existingMarkers });
    (bboxIntersects as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await renderAndReachPreview();

    fireEvent.click(screen.getByTestId(`gps-import-save-radio-${MATCHING_SAVE.id}`));
    await waitFor(() => screen.getByTestId("gps-import-reassign-existing"));

    // Toggle is checked by default; confirm triggers the PATCH
    fireEvent.click(screen.getByTestId("gps-import-confirm"));

    await waitFor(() =>
      expect(mockPatchMarkersId).toHaveBeenCalledWith({
        id: "m1",
        data: { datasetId: "ds-lake-1" },
      }),
    );
  });

  it("(c) unchecking the reassign toggle prevents PATCHes on confirm", async () => {
    const existingMarkers = [
      { id: "m1", datasetId: null, lat: 45.5, lon: -93.0, depth: 5, type: "custom", label: "Old A", createdAt: new Date(), userId: "u1" },
    ];
    mockGetDatasetsMySavesImpl.mockReturnValue({ data: [MATCHING_SAVE], isLoading: false });
    mockGetMarkersImpl.mockReturnValue({ data: existingMarkers });
    (bboxIntersects as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await renderAndReachPreview();

    fireEvent.click(screen.getByTestId(`gps-import-save-radio-${MATCHING_SAVE.id}`));
    await waitFor(() => screen.getByTestId("gps-import-reassign-existing"));

    // Uncheck the toggle
    const reassignLabel = screen.getByTestId("gps-import-reassign-existing");
    fireEvent.click(within(reassignLabel).getByRole("checkbox"));

    // Confirm
    fireEvent.click(screen.getByTestId("gps-import-confirm"));

    await waitFor(() => expect(mockPostMarkers).toHaveBeenCalled());
    expect(mockPatchMarkersId).not.toHaveBeenCalled();
  });
});
