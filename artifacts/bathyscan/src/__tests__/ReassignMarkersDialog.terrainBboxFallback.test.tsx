/**
 * ReassignMarkersDialog.terrainBboxFallback.test.tsx
 *
 * Regression tests for the custom-dataset bbox fallback: a save backed by a
 * custom dataset with NO catalog entry (orphan save — catalog.coverageBbox
 * absent) previously resolved bbox to null, so the unassigned-markers query
 * was never enabled and the dialog always showed zero eligible markers.
 *
 * The dialog must now fall back to the save's `terrainBbox` (derived
 * server-side from the custom dataset's terrain metadata), and only show the
 * "no coverage area on record" warning when BOTH bbox sources are absent.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockUseGetMarkers = vi.hoisted(() => vi.fn());
const mockSaves = vi.hoisted(() => ({ data: [] as unknown[] }));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  usePatchMarkersId: () => ({ mutateAsync: vi.fn() }),
  useGetDatasetsMySaves: () => ({ data: mockSaves.data, isLoading: false }),
  useGetMarkers: mockUseGetMarkers,
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

import { ReassignMarkersDialog } from "@/components/ReassignMarkersDialog";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TERRAIN_BBOX = { minLat: 37, minLon: -122, maxLat: 38, maxLon: -121 };

/** Orphan save: catalog entry removed, but the custom dataset's own bbox exists. */
const ORPHAN_SAVE = {
  id: "save-orphan",
  datasetId: "11111111-2222-4333-8444-555555555555",
  status: "ready",
  displayLabel: "Custom Area Save",
  catalogId: "deleted-entry",
  requestedAt: "2024-06-01T00:00:00Z",
  catalog: null,
  terrainBbox: TERRAIN_BBOX,
};

/** Save with neither a catalog coverageBbox nor a terrainBbox. */
const NO_BBOX_SAVE = {
  ...ORPHAN_SAVE,
  id: "save-no-bbox",
  terrainBbox: null,
};

function selectSave(saveId: string) {
  fireEvent.click(screen.getByTestId(`reassign-save-radio-${saveId}`));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ReassignMarkersDialog — terrainBbox fallback for custom-dataset saves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseGetMarkers.mockReturnValue({
      data: [{ id: "m-1", datasetId: null, lat: 37.5, lon: -121.5 }],
      isLoading: false,
    });
  });

  it("enables the unassigned-markers query with the terrainBbox bounds when catalog.coverageBbox is absent", async () => {
    mockSaves.data = [ORPHAN_SAVE];
    render(<ReassignMarkersDialog onClose={() => {}} />);

    selectSave("save-orphan");

    await waitFor(() => {
      const [params, options] = mockUseGetMarkers.mock.lastCall as [
        Record<string, number> | undefined,
        { query: { enabled: boolean } },
      ];
      expect(params).toEqual(TERRAIN_BBOX);
      expect(options.query.enabled).toBe(true);
    });
  });

  it("surfaces the unassigned marker count instead of the 'no coverage area' warning", async () => {
    mockSaves.data = [ORPHAN_SAVE];
    render(<ReassignMarkersDialog onClose={() => {}} />);

    selectSave("save-orphan");

    await waitFor(() => {
      const count = screen.getByTestId("reassign-markers-count");
      expect(count.textContent).toContain("1");
      expect(count.textContent).toContain("unassigned marker");
      expect(count.textContent).not.toContain("no coverage area");
    });
  });

  it("still shows the 'no coverage area' warning when neither bbox source exists, and keeps the query disabled", async () => {
    mockSaves.data = [NO_BBOX_SAVE];
    render(<ReassignMarkersDialog onClose={() => {}} />);

    selectSave("save-no-bbox");

    await waitFor(() => {
      expect(
        screen.getByTestId("reassign-markers-count").textContent,
      ).toContain("no coverage area on record");
    });
    const [params, options] = mockUseGetMarkers.mock.lastCall as [
      Record<string, number> | undefined,
      { query: { enabled: boolean } },
    ];
    expect(params).toBeUndefined();
    expect(options.query.enabled).toBe(false);
  });

  it("prefers the catalog coverageBbox over terrainBbox when both are present", async () => {
    const catalogBbox = { minLat: 10, minLon: 20, maxLat: 11, maxLon: 21 };
    mockSaves.data = [
      {
        ...ORPHAN_SAVE,
        id: "save-both",
        catalog: { name: "Catalog Entry", coverageBbox: catalogBbox },
      },
    ];
    render(<ReassignMarkersDialog onClose={() => {}} />);

    selectSave("save-both");

    await waitFor(() => {
      const [params] = mockUseGetMarkers.mock.lastCall as [Record<string, number> | undefined];
      expect(params).toEqual(catalogBbox);
    });
  });
});
