/**
 * ColumnMappingStep.test.tsx
 *
 * Unit tests covering:
 *  - Renders mapping table when lat column is missing
 *  - Continue button disabled until lat + lon are set
 *  - Duplicate-column assignment triggers inline warning
 *  - Live preview updates when a dropdown changes
 *  - Step is not needed for GPX (self-describing) — column list empty
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ColumnMappingStep } from "@/components/ColumnMappingStep";
import type { RawColumnMeta, ColumnAssignment } from "@/lib/gpsImport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(
  headers: string[],
  sampleRows: Record<string, string>[] = [],
  fileType: "csv" | "excel" | "self-describing" = "csv",
): RawColumnMeta {
  return {
    columns: headers.map((h) => ({ header: h, mappedAlias: null })),
    sampleRows,
    allRows: sampleRows,
    fileType,
  };
}

const SAMPLE_META: RawColumnMeta = {
  columns: [
    { header: "LATI", mappedAlias: null },
    { header: "LONG", mappedAlias: null },
    { header: "WAYPOINT_NAME", mappedAlias: null },
  ],
  sampleRows: [
    { LATI: "11.35", LONG: "142.5", WAYPOINT_NAME: "Challenger" },
    { LATI: "11.40", LONG: "142.55", WAYPOINT_NAME: "Sibling" },
  ],
  allRows: [
    { LATI: "11.35", LONG: "142.5", WAYPOINT_NAME: "Challenger" },
    { LATI: "11.40", LONG: "142.55", WAYPOINT_NAME: "Sibling" },
  ],
  fileType: "csv",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ColumnMappingStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock localStorage to avoid cross-test contamination.
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it("renders one dropdown row per canonical field", () => {
    const onConfirm = vi.fn();
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByTestId("col-map-row-lat")).toBeInTheDocument();
    expect(screen.getByTestId("col-map-row-lon")).toBeInTheDocument();
    expect(screen.getByTestId("col-map-row-name")).toBeInTheDocument();
    expect(screen.getByTestId("col-map-row-depth")).toBeInTheDocument();
    expect(screen.getByTestId("col-map-row-type")).toBeInTheDocument();
    expect(screen.getByTestId("col-map-row-notes")).toBeInTheDocument();
  });

  it("shows required-fields warning when lat or lon is unset", () => {
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("column-mapping-required-warning"),
    ).toBeInTheDocument();
  });

  it("hides required-fields warning when both lat and lon are assigned", () => {
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        initialAssignment={{
          lat: "LATI",
          lon: "LONG",
          name: null,
          depth: null,
          type: null,
          notes: null,
        }}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("column-mapping-required-warning"),
    ).not.toBeInTheDocument();
  });

  it("Continue button is disabled when lat is unassigned", () => {
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const btn = screen.getByTestId("column-mapping-continue");
    expect(btn).toBeDisabled();
  });

  it("Continue button is disabled when lat is assigned but lon is not", () => {
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        initialAssignment={{ lat: "LATI", lon: null, name: null, depth: null, type: null, notes: null }}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByTestId("column-mapping-continue")).toBeDisabled();
  });

  it("Continue button is enabled when both lat and lon are assigned", () => {
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        initialAssignment={{ lat: "LATI", lon: "LONG", name: null, depth: null, type: null, notes: null }}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByTestId("column-mapping-continue")).not.toBeDisabled();
  });

  it("calls onConfirm with the assignment when Continue is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        initialAssignment={{ lat: "LATI", lon: "LONG", name: "WAYPOINT_NAME", depth: null, type: null, notes: null }}
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("column-mapping-continue"));
    expect(onConfirm).toHaveBeenCalledOnce();
    const called = onConfirm.mock.calls[0]![0] as ColumnAssignment;
    expect(called.lat).toBe("LATI");
    expect(called.lon).toBe("LONG");
    expect(called.name).toBe("WAYPOINT_NAME");
  });

  it("does not call onConfirm when Continue is clicked while disabled", () => {
    const onConfirm = vi.fn();
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("column-mapping-continue"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onBack when Back button is clicked", () => {
    const onBack = vi.fn();
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        onConfirm={vi.fn()}
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByTestId("column-mapping-back"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows duplicate-column warning when same header used in two fields", () => {
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        initialAssignment={{ lat: "LATI", lon: "LATI", name: null, depth: null, type: null, notes: null }}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const lonRow = screen.getByTestId("col-map-row-lon");
    expect(
      within(lonRow).getByTestId("col-map-duplicate-warning-lon"),
    ).toBeInTheDocument();
  });

  it("live preview updates when a dropdown is changed", () => {
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        initialAssignment={{ lat: "LATI", lon: "LONG", name: null, depth: null, type: null, notes: null }}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    const preview = screen.getByTestId("column-mapping-preview-table");
    // Initially name column header shows "(skipped)"
    expect(within(preview).getByText(/skipped/)).toBeInTheDocument();

    // Select a name column
    const nameSelect = screen.getByTestId("col-map-select-name");
    fireEvent.change(nameSelect, { target: { value: "WAYPOINT_NAME" } });

    // Now preview table shows name header
    const updatedPreview = screen.getByTestId("column-mapping-preview-table");
    expect(within(updatedPreview).getByText(/WAYPOINT_NAME/)).toBeInTheDocument();
  });

  it("renders preview rows from sampleRows", () => {
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        initialAssignment={{ lat: "LATI", lon: "LONG", name: "WAYPOINT_NAME", depth: null, type: null, notes: null }}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByTestId("column-mapping-preview-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("column-mapping-preview-row-1")).toBeInTheDocument();
    expect(screen.queryByTestId("column-mapping-preview-row-2")).not.toBeInTheDocument();
  });

  it("shows no preview section when sampleRows is empty", () => {
    const emptyMeta = makeMeta(["LATI", "LONG"], []);
    render(
      <ColumnMappingStep
        meta={emptyMeta}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("column-mapping-preview")).not.toBeInTheDocument();
  });

  it("all header options are available in each dropdown", () => {
    render(
      <ColumnMappingStep
        meta={SAMPLE_META}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const latSelect = screen.getByTestId("col-map-select-lat");
    const options = Array.from(latSelect.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("LATI");
    expect(options).toContain("LONG");
    expect(options).toContain("WAYPOINT_NAME");
  });

  it("saves assignment to localStorage for Excel files on confirm", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    const excelMeta = makeMeta(["Lat", "Lon", "Site"], [], "excel");
    const onConfirm = vi.fn();
    render(
      <ColumnMappingStep
        meta={excelMeta}
        initialAssignment={{ lat: "Lat", lon: "Lon", name: "Site", depth: null, type: null, notes: null }}
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("column-mapping-continue"));
    expect(setItem).toHaveBeenCalledOnce();
    const [key, value] = setItem.mock.calls[0] as [string, string];
    expect(key).toMatch(/^bathyscan:colmap:/);
    const saved = JSON.parse(value) as Record<string, string | null>;
    expect(saved.lat).toBe("Lat");
    expect(saved.lon).toBe("Lon");
    expect(saved.name).toBe("Site");
  });

  it("restores saved assignment from localStorage for Excel files", () => {
    const savedAssignment = { lat: "Lat", lon: "Lon", name: "Site", depth: null, type: null, notes: null };
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => JSON.stringify(savedAssignment)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    const excelMeta = makeMeta(["Lat", "Lon", "Site"], [], "excel");
    render(
      <ColumnMappingStep
        meta={excelMeta}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect((screen.getByTestId("col-map-select-lat") as HTMLSelectElement).value).toBe("Lat");
    expect((screen.getByTestId("col-map-select-lon") as HTMLSelectElement).value).toBe("Lon");
    expect((screen.getByTestId("col-map-select-name") as HTMLSelectElement).value).toBe("Site");
  });

  it("does NOT save assignment to localStorage for self-describing files on confirm", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    const gpxMeta = makeMeta(["Lat", "Lon"], [], "self-describing");
    render(
      <ColumnMappingStep
        meta={gpxMeta}
        initialAssignment={{ lat: "Lat", lon: "Lon", name: null, depth: null, type: null, notes: null }}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("column-mapping-continue"));
    expect(setItem).not.toHaveBeenCalled();
  });

  it("renders no header options when meta has no columns (self-describing format like GPX)", () => {
    const gpxMeta = makeMeta([], [], "self-describing");
    const { container } = render(
      <ColumnMappingStep
        meta={gpxMeta}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    // Selects exist for the 6 fields, but none have real header options
    const selects = Array.from(container.querySelectorAll("select"));
    expect(selects).toHaveLength(6);
    for (const select of selects) {
      const realOptions = Array.from(select.querySelectorAll("option")).filter(
        (o) => o.value !== "",
      );
      expect(realOptions).toHaveLength(0);
    }
    // No preview rows
    expect(screen.queryByTestId("column-mapping-preview")).not.toBeInTheDocument();
  });
});
