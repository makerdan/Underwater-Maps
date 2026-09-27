import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { DatasetAuditReport } from "@workspace/api-client-react";
import { DatasetInspectionDialog } from "@/components/DatasetInspectionDialog";
import { renderWithProviders } from "./setup";

const auditMocks = vi.hoisted(() => {
  const emptyQuery = () => ({
    data: undefined as unknown,
    error: null as unknown,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  });

  return {
    publicResult: emptyQuery(),
    ownedResult: emptyQuery(),
    publicCalls: [] as unknown[][],
    ownedCalls: [] as unknown[][],
  };
});

vi.mock("@workspace/api-client-react", () => ({
  getGetDatasetsIdAuditQueryKey: (id: string) => [`/api/datasets/${id}/audit`],
  getGetUserDatasetsIdAuditQueryKey: (id: string) => [`/api/user/datasets/${id}/audit`],
  useGetDatasetsIdAudit: (id: string, options: unknown) => {
    auditMocks.publicCalls.push([id, options]);
    return auditMocks.publicResult;
  },
  useGetUserDatasetsIdAudit: (id: string, options: unknown) => {
    auditMocks.ownedCalls.push([id, options]);
    return auditMocks.ownedResult;
  },
}));

const readyReport: DatasetAuditReport = {
  version: 1,
  datasetId: "public-reef",
  status: "pass",
  findings: [
    {
      severity: "pass",
      reason: "grid_dimensions_invalid",
      message: "Grid dimensions are valid.",
      evidence: { width: 4, height: 3 },
    },
    {
      severity: "pass",
      reason: "depth_semantics_invalid",
      message: "Finite depth values use the positive-down convention.",
    },
    {
      severity: "pass",
      reason: "orientation_not_row_zero_south",
      message: "Served grid uses row 0 south and columns west-to-east.",
    },
    {
      severity: "pass",
      reason: "provenance_unknown",
      message: "Source provenance is declared.",
      evidence: { provenance: "NOAA NCEI" },
    },
    {
      severity: "pass",
      reason: "crs_not_wgs84",
      message: "Served coordinates are declared as WGS84/EPSG:4326.",
    },
    {
      severity: "pass",
      reason: "gps_placement_ready",
      message: "Artifact is ready for GPS placement.",
    },
  ],
  metrics: {
    expectedCellCount: 12,
    depthCellCount: 12,
    depthNoDataCount: 1,
    depthNoDataRatio: 1 / 12,
    depthInvalidFiniteCount: 0,
    topographyCellCount: 0,
    topographyNoDataCount: 0,
    topographyNoDataRatio: null,
    topographyInvalidFiniteCount: 0,
    antimeridianCrossing: false,
  },
  gpsPlacementReady: true,
};

function InspectionHarness({
  datasetSource = "public",
  datasetId = "public-reef",
  bounds = { minLon: -123.25, maxLon: -122.5, minLat: 47.1, maxLat: 47.8 },
}: {
  datasetSource?: "public" | "owned";
  datasetId?: string;
  bounds?: { minLon: number | null; maxLon: number | null; minLat: number | null; maxLat: number | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button ref={triggerRef} type="button" data-testid="open-dataset-inspection" onClick={() => setOpen(true)}>
        Inspect selected dataset
      </button>
      <DatasetInspectionDialog
        open={open}
        onOpenChange={setOpen}
        returnFocusRef={triggerRef}
        datasetId={datasetId}
        datasetName="Public Reef Survey"
        datasetSource={datasetSource}
        sourceLabel={datasetSource === "public" ? "NOAA" : "Uploaded by you"}
        bounds={bounds}
      />
    </>
  );
}

function openInspection() {
  fireEvent.click(screen.getByTestId("open-dataset-inspection"));
}

function setPublicReport(report: DatasetAuditReport) {
  auditMocks.publicResult.data = report;
  auditMocks.publicResult.error = null;
  auditMocks.publicResult.isLoading = false;
  auditMocks.publicResult.isFetching = false;
  auditMocks.publicResult.isError = false;
}

function setOwnedError(status: number) {
  auditMocks.ownedResult.data = undefined;
  auditMocks.ownedResult.error = { status };
  auditMocks.ownedResult.isLoading = false;
  auditMocks.ownedResult.isFetching = false;
  auditMocks.ownedResult.isError = true;
}

beforeEach(() => {
  auditMocks.publicResult.data = undefined;
  auditMocks.publicResult.error = null;
  auditMocks.publicResult.isLoading = false;
  auditMocks.publicResult.isFetching = false;
  auditMocks.publicResult.isError = false;
  auditMocks.ownedResult.data = undefined;
  auditMocks.ownedResult.error = null;
  auditMocks.ownedResult.isLoading = false;
  auditMocks.ownedResult.isFetching = false;
  auditMocks.ownedResult.isError = false;
  auditMocks.publicCalls.length = 0;
  auditMocks.ownedCalls.length = 0;
});

describe("DatasetInspectionDialog", () => {
  it("shows ready audit evidence without inferring missing fields", () => {
    setPublicReport(readyReport);
    renderWithProviders(<InspectionHarness />);
    openInspection();

    expect(screen.getByTestId("dataset-inspection-audit-status")).toHaveTextContent("PASS");
    expect(screen.getByTestId("dataset-inspection-gps-status")).toHaveTextContent("READY");
    expect(screen.getByTestId("dataset-inspection-source-label")).toHaveTextContent("NOAA");
    expect(screen.getByTestId("dataset-inspection-bounds")).toHaveTextContent("123.2500° W");
    expect(screen.getByTestId("dataset-inspection-dimensions")).toHaveTextContent("4 × 3 cells");
    expect(screen.getByTestId("dataset-inspection-depth-coverage")).toHaveTextContent("91.7%");
    expect(screen.getByTestId("dataset-inspection-depth-nodata-ratio")).toHaveTextContent("8.3%");
    expect(screen.getByTestId("dataset-inspection-depth-convention")).toHaveTextContent("Positive-down");
    expect(screen.getByTestId("dataset-inspection-orientation")).toHaveTextContent("Row 0 south");
    expect(screen.getByTestId("dataset-inspection-provenance")).toHaveTextContent("NOAA NCEI");
    expect(screen.getByTestId("dataset-inspection-crs")).toHaveTextContent("WGS84 / EPSG:4326");
    expect(screen.getByTestId("dataset-inspection-topography-nodata-ratio")).toHaveTextContent("Not supplied");
    expect(screen.getByTestId("dataset-inspection-findings-pass")).toBeInTheDocument();
    expect(screen.getByText(/not a guarantee of GPS accuracy/i)).toBeInTheDocument();

    const enabledPublicCall = auditMocks.publicCalls.find(([, options]) =>
      (options as { query?: { enabled?: boolean } }).query?.enabled === true,
    );
    expect(enabledPublicCall?.[0]).toBe("public-reef");
    expect(auditMocks.ownedCalls.at(-1)?.[1]).toMatchObject({
      query: { enabled: false, queryKey: ["/api/user/datasets/public-reef/audit"] },
    });
  });

  it("groups warnings and gives a next step when placement evidence is incomplete", () => {
    setPublicReport({
      ...readyReport,
      status: "warning",
      gpsPlacementReady: false,
      findings: [
        { severity: "warning", reason: "orientation_unknown", message: "Served row/column orientation is not declared." },
        { severity: "warning", reason: "provenance_unknown", message: "Source provenance is unavailable." },
        { severity: "warning", reason: "crs_unknown", message: "Served coordinate reference system is unavailable." },
        { severity: "warning", reason: "gps_placement_uncertain", message: "GPS placement is uncertain." },
      ],
    });
    renderWithProviders(<InspectionHarness />);
    openInspection();

    expect(screen.getByTestId("dataset-inspection-audit-status")).toHaveTextContent("WARNING");
    expect(screen.getByTestId("dataset-inspection-gps-status")).toHaveTextContent("NEEDS REVIEW");
    expect(screen.getByTestId("dataset-inspection-findings-warning")).toHaveTextContent("Warnings");
    expect(screen.getByText("Declare how served rows and columns map to geographic direction.")).toBeInTheDocument();
    expect(screen.getByTestId("dataset-inspection-orientation")).toHaveTextContent("Unknown / unavailable");
  });

  it("shows blocked checks as blocked and includes concrete remediation", () => {
    setPublicReport({
      ...readyReport,
      status: "blocked",
      gpsPlacementReady: false,
      findings: [
        { severity: "blocked", reason: "depth_semantics_invalid", message: "Depth values must use positive-down." },
        { severity: "blocked", reason: "gps_placement_uncertain", message: "GPS placement is blocked by invalid geographic metadata." },
      ],
    });
    renderWithProviders(<InspectionHarness />);
    openInspection();

    expect(screen.getByTestId("dataset-inspection-audit-status")).toHaveTextContent("BLOCKED");
    expect(screen.getByTestId("dataset-inspection-gps-status")).toHaveTextContent("BLOCKED");
    expect(screen.getByTestId("dataset-inspection-depth-convention")).toHaveTextContent("Invalid convention");
    expect(screen.getByTestId("dataset-inspection-findings-blocked")).toHaveTextContent("Blocked checks");
    expect(screen.getByText("Confirm depths use BathyScan's positive-down convention.")).toBeInTheDocument();
  });

  it("marks absent audit evidence as unknown instead of passing it", () => {
    setPublicReport({
      ...readyReport,
      status: "warning",
      findings: [],
      metrics: {
        ...readyReport.metrics,
        expectedCellCount: null,
        depthCellCount: 0,
        depthNoDataCount: 0,
        depthNoDataRatio: null,
        topographyCellCount: 0,
        topographyNoDataRatio: null,
        antimeridianCrossing: null,
      },
      gpsPlacementReady: false,
    });
    renderWithProviders(<InspectionHarness bounds={null} />);
    openInspection();

    expect(screen.getByTestId("dataset-inspection-bounds")).toHaveTextContent("Unknown / unavailable");
    expect(screen.getByTestId("dataset-inspection-dimensions")).toHaveTextContent("Unknown / unavailable");
    expect(screen.getByTestId("dataset-inspection-depth-coverage")).toHaveTextContent("Unknown / unavailable");
    expect(screen.getByTestId("dataset-inspection-depth-convention")).toHaveTextContent("Unknown / unavailable");
    expect(screen.getByTestId("dataset-inspection-orientation")).toHaveTextContent("Unknown / unavailable");
    expect(screen.getByTestId("dataset-inspection-provenance")).toHaveTextContent("Unknown / unavailable");
    expect(screen.getByTestId("dataset-inspection-crs")).toHaveTextContent("Unknown / unavailable");
    expect(screen.getByTestId("dataset-inspection-topography-nodata-ratio")).toHaveTextContent("Not supplied");
    expect(screen.getByTestId("dataset-inspection-findings-pass")).toHaveTextContent(/not being presented as a pass/i);
  });

  it("uses the owned audit route and hides ownership details for unavailable datasets", () => {
    setOwnedError(404);
    renderWithProviders(<InspectionHarness datasetSource="owned" datasetId="owned-reef" />);
    openInspection();

    expect(screen.getByTestId("dataset-inspection-source")).toHaveTextContent("Your dataset");
    expect(screen.getByTestId("dataset-inspection-error")).toHaveTextContent("unavailable or no longer accessible");
    expect(screen.getByTestId("button-retry-dataset-inspection")).toBeInTheDocument();

    const enabledOwnedCall = auditMocks.ownedCalls.find(([, options]) =>
      (options as { query?: { enabled?: boolean } }).query?.enabled === true,
    );
    expect(enabledOwnedCall?.[0]).toBe("owned-reef");
    expect(auditMocks.publicCalls.at(-1)?.[1]).toMatchObject({
      query: { enabled: false, queryKey: ["/api/datasets/owned-reef/audit"] },
    });
  });

  it("returns focus to the dataset control when closed with Escape", async () => {
    setPublicReport(readyReport);
    renderWithProviders(<InspectionHarness />);
    const trigger = screen.getByTestId("open-dataset-inspection");
    fireEvent.click(trigger);
    expect(await screen.findByTestId("dataset-inspection-dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("dataset-inspection-dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });
});