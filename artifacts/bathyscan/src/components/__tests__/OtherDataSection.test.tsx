/**
 * Component tests for OtherDataSection — the collapsed "Other data in this
 * area" reference listing at the bottom of the Overview Map's selected-area
 * panel.
 *
 * Covers:
 * - Renders collapsed by default; the NCEI query is disabled until expanded.
 * - Expanding shows non-bathymetry records with type badges.
 * - Bathymetry records from the broadened query are filtered out (never leak
 *   into this reference list — they belong to the main results).
 * - "REFERENCE ONLY" label appears only for records without WCS coverage.
 * - Empty state message when there are no non-bathymetry records.
 * - Loading and error states.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockApi = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: false,
  isError: false,
  calls: [] as Array<{ params: unknown; enabled: boolean | undefined }>,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetNceiSearch: (
    params: unknown,
    opts?: { query?: { enabled?: boolean } },
  ) => {
    mockApi.calls.push({ params, enabled: opts?.query?.enabled });
    const enabled = opts?.query?.enabled !== false;
    return {
      data: enabled ? mockApi.data : undefined,
      isLoading: enabled ? mockApi.isLoading : false,
      isError: enabled ? mockApi.isError : false,
    };
  },
  getGetNceiSearchQueryKey: (params: unknown) => ["ncei-search", params],
}));

import { OtherDataSection } from "../OtherDataSection";

const BBOX = { north: 55.87, south: 55.53, east: -132.15, west: -132.75 };

function nceiResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "gov.noaa.ngdc:rec-1",
    name: "CTD casts, Clarence Strait",
    description: "Salinity and water temperature profiles",
    sourceAgency: "NOAA/NCEI",
    coverageBbox: { minLon: -132.7, minLat: 55.5, maxLon: -132.2, maxLat: 55.9 },
    resolutionMMin: null,
    resolutionMMax: null,
    metadataUrl: null,
    wcsAvailable: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockApi.data = undefined;
  mockApi.isLoading = false;
  mockApi.isError = false;
  mockApi.calls = [];
});

describe("OtherDataSection", () => {
  it("renders collapsed with the query disabled", () => {
    render(<OtherDataSection bbox={BBOX} />);
    const toggle = screen.getByTestId("overview-other-data-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("overview-other-data-card")).toBeNull();
    // The lazily-gated query must be disabled while collapsed.
    expect(mockApi.calls.at(-1)?.enabled).toBe(false);
    // The broadened NCEI params carry the bbox string + broad flag.
    expect(mockApi.calls.at(-1)?.params).toEqual({
      bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`,
      broad: true,
      max: 30,
    });
  });

  it("expanding enables the query and shows non-bathymetry records with badges", () => {
    mockApi.data = [
      nceiResult(),
      nceiResult({
        id: "rec-2",
        name: "Marine magnetic anomaly data",
        description: null,
        wcsAvailable: true,
      }),
    ];
    render(<OtherDataSection bbox={BBOX} />);
    fireEvent.click(screen.getByTestId("overview-other-data-toggle"));

    expect(screen.getByTestId("overview-other-data-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(mockApi.calls.at(-1)?.enabled).toBe(true);
    const cards = screen.getAllByTestId("overview-other-data-card");
    expect(cards).toHaveLength(2);
    const badges = screen.getAllByTestId("overview-other-data-badge");
    expect(badges.map((b) => b.textContent)).toEqual(["oceanographic", "geophysical"]);
  });

  it("filters bathymetry records out of the broadened result set", () => {
    mockApi.data = [
      nceiResult({ id: "bathy-1", name: "Multibeam Bathymetric Survey H12345" }),
      nceiResult({ id: "rec-2", name: "Monthly climate normals", description: null }),
    ];
    render(<OtherDataSection bbox={BBOX} />);
    fireEvent.click(screen.getByTestId("overview-other-data-toggle"));

    const cards = screen.getAllByTestId("overview-other-data-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("Monthly climate normals");
    expect(screen.queryByText(/Multibeam Bathymetric Survey/)).toBeNull();
    // Count in the header reflects the filtered list.
    expect(screen.getByTestId("overview-other-data-toggle")).toHaveTextContent("1");
  });

  it("labels records without WCS coverage as REFERENCE ONLY", () => {
    mockApi.data = [
      nceiResult({ id: "no-wcs", wcsAvailable: false }),
      nceiResult({
        id: "with-wcs",
        name: "Sediment core samples",
        description: null,
        wcsAvailable: true,
      }),
    ];
    render(<OtherDataSection bbox={BBOX} />);
    fireEvent.click(screen.getByTestId("overview-other-data-toggle"));

    const cards = screen.getAllByTestId("overview-other-data-card");
    expect(cards[0]).toHaveTextContent("REFERENCE ONLY");
    expect(cards[1]).not.toHaveTextContent("REFERENCE ONLY");
  });

  it("links the record name when a metadataUrl is present", () => {
    mockApi.data = [
      nceiResult({ metadataUrl: "https://www.ncei.noaa.gov/metadata/rec-1" }),
    ];
    render(<OtherDataSection bbox={BBOX} />);
    fireEvent.click(screen.getByTestId("overview-other-data-toggle"));
    const link = screen.getByRole("link", { name: /CTD casts/ });
    expect(link).toHaveAttribute("href", "https://www.ncei.noaa.gov/metadata/rec-1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows the empty-state message when all records are bathymetry", () => {
    mockApi.data = [nceiResult({ name: "Hydrographic survey soundings" })];
    render(<OtherDataSection bbox={BBOX} />);
    fireEvent.click(screen.getByTestId("overview-other-data-toggle"));
    expect(screen.getByText(/No non-bathymetry NCEI records found here/)).toBeInTheDocument();
    expect(screen.queryByTestId("overview-other-data-card")).toBeNull();
  });

  it("shows the loading state while fetching", () => {
    mockApi.isLoading = true;
    render(<OtherDataSection bbox={BBOX} />);
    fireEvent.click(screen.getByTestId("overview-other-data-toggle"));
    expect(screen.getByText(/Searching NCEI/)).toBeInTheDocument();
  });

  it("shows the error state when the fetch fails", () => {
    mockApi.isError = true;
    render(<OtherDataSection bbox={BBOX} />);
    fireEvent.click(screen.getByTestId("overview-other-data-toggle"));
    expect(screen.getByText(/Could not load NCEI records/)).toBeInTheDocument();
    expect(screen.queryByTestId("overview-other-data-card")).toBeNull();
  });

  it("collapses again on a second toggle click", () => {
    mockApi.data = [nceiResult()];
    render(<OtherDataSection bbox={BBOX} />);
    const toggle = screen.getByTestId("overview-other-data-toggle");
    fireEvent.click(toggle);
    expect(screen.getAllByTestId("overview-other-data-card")).toHaveLength(1);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("overview-other-data-card")).toBeNull();
  });
});
