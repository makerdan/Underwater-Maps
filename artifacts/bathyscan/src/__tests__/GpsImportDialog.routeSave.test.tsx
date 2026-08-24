/**
 * GpsImportDialog.routeSave.test.tsx
 *
 * Guards the route-save recovery path for guests: opening Clerk sign-in must
 * not discard the imported route currently being edited.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TerrainData } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  authorizedFetch: vi.fn<() => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(),
  openSignIn: vi.fn(),
  auth: { isSignedIn: false },
}));

vi.mock("@workspace/api-client-react", () => ({
  usePostMarkers: () => ({ mutateAsync: vi.fn() }),
  useDeleteMarkersId: () => ({ mutateAsync: vi.fn() }),
  usePatchMarkersId: () => ({ mutateAsync: vi.fn() }),
  useGetDatasetsMySaves: () => ({ data: [], isLoading: false }),
  useGetMarkers: () => ({ data: [] }),
  getGetMarkersQueryKey: (...args: unknown[]) => ["markers", ...args],
  getGetDatasetsMySavesQueryKey: () => ["dataset-saves"],
  MarkerInputType: { custom: "custom" },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/gpsImport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gpsImport")>()),
  parseGpsFile: vi.fn(),
  partitionByBounds: vi.fn(),
  countPoints: vi.fn(() => 2),
  isInBounds: vi.fn(() => true),
  computeResultBbox: vi.fn(() => null),
  bboxIntersects: vi.fn(() => false),
  applyColumnAssignment: vi.fn(() => ({ waypoints: [], routes: [] })),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (selector: (state: { waterType: string; defaultMarkerType: string }) => unknown) =>
    selector({ waterType: "saltwater", defaultMarkerType: "custom" }),
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

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: mocks.authorizedFetch,
}));

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({
    isSignedIn: mocks.auth.isSignedIn,
    isLoaded: true,
    user: mocks.auth.isSignedIn ? { id: "route-user" } : null,
  }),
  useClerk: () => ({ openSignIn: mocks.openSignIn }),
}));

import { parseGpsFile, partitionByBounds } from "@/lib/gpsImport";
import { GpsImportDialog } from "@/components/GpsImportDialog";

const TERRAIN = {
  datasetId: "route-dataset",
  minLon: -123,
  minLat: 37,
  maxLon: -121,
  maxLat: 39,
  waterType: "saltwater",
} as unknown as TerrainData;

const PARSED_RESULT = {
  waypoints: [],
  routes: [
    {
      id: "imported-route",
      name: "Imported route",
      points: [
        { lon: -122.1, lat: 37.2 },
        { lon: -122.2, lat: 37.3 },
      ],
    },
  ],
};

async function renderAndReachRouteEditor() {
  render(<GpsImportDialog terrain={TERRAIN} onClose={vi.fn()} />);
  const input = screen.getByTestId("gps-import-file-input");
  const file = new File(["route"], "route.gpx", { type: "application/gpx+xml" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  fireEvent.change(input);
  await waitFor(() => expect(screen.getByTestId("gps-import-save-route-0")).toBeInTheDocument());
}

describe("GpsImportDialog — imported route saving", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.isSignedIn = false;
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
  });

  it("opens sign-in for a guest without discarding the edited route", async () => {
    await renderAndReachRouteEditor();

    const nameInput = screen.getByTestId("gps-import-route-name-0");
    fireEvent.change(nameInput, { target: { value: "Edited guest route" } });
    fireEvent.click(screen.getByTestId("gps-import-save-route-0"));

    expect(mocks.openSignIn).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("Edited guest route")).toBeInTheDocument();
    expect(mocks.authorizedFetch).not.toHaveBeenCalled();
  });

  it("saves directly for a signed-in user without opening sign-in", async () => {
    mocks.auth.isSignedIn = true;
    mocks.authorizedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "saved-route" }),
    });
    await renderAndReachRouteEditor();

    fireEvent.click(screen.getByTestId("gps-import-save-route-0"));

    await waitFor(() => expect(mocks.authorizedFetch).toHaveBeenCalledTimes(1));
    expect(mocks.openSignIn).not.toHaveBeenCalled();
    expect(screen.getByTestId("gps-import-save-route-0")).toHaveTextContent("SAVED ROUTE");
  });
});
