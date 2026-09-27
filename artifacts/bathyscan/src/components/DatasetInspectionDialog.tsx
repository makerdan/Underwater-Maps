import { useMemo, type CSSProperties, type FC, type RefObject } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Database,
  Info,
  MapPinned,
  Ruler,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  getGetDatasetsIdAuditQueryKey,
  getGetUserDatasetsIdAuditQueryKey,
  useGetDatasetsIdAudit,
  useGetUserDatasetsIdAudit,
  type DatasetAuditFinding,
  type DatasetAuditFindingReason,
  type DatasetAuditFindingSeverity,
  type DatasetAuditReport,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type DatasetInspectionBounds = {
  minLon: number | null;
  maxLon: number | null;
  minLat: number | null;
  maxLat: number | null;
} | null;

export type DatasetInspectionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  datasetId: string;
  datasetName: string;
  datasetSource: "public" | "owned";
  sourceLabel: string;
  bounds: DatasetInspectionBounds;
};

const UNKNOWN = "Unknown / unavailable";

const REASON_LABELS: Record<string, string> = {
  dataset_id_missing: "Dataset identity",
  grid_dimensions_invalid: "Grid dimensions",
  grid_cardinality_mismatch: "Grid cardinality",
  grid_values_non_finite: "Cell values",
  grid_all_nodata: "Usable depth cells",
  nodata_ratio_high: "Depth no-data",
  topography_nodata_ratio_high: "Topography no-data",
  depth_semantics_invalid: "Depth convention",
  topography_semantics_invalid: "Topography convention",
  depth_range_mismatch: "Depth range",
  bbox_invalid: "Geographic bounds",
  bbox_antimeridian: "Antimeridian",
  center_invalid: "Dataset center",
  center_outside_bbox: "Center within bounds",
  orientation_unknown: "Served orientation",
  orientation_not_row_zero_south: "Served orientation",
  orientation_columns_not_west_to_east: "Served orientation",
  orientation_source_served_mismatch: "Source to served orientation",
  provenance_unknown: "Provenance",
  crs_unknown: "Served CRS",
  crs_not_wgs84: "Served CRS",
  gps_placement_ready: "GPS placement",
  gps_placement_uncertain: "GPS placement",
  parity_shape_drift: "Lifecycle shape parity",
  parity_bounds_drift: "Lifecycle bounds parity",
  parity_depth_semantics_drift: "Lifecycle depth parity",
  parity_orientation_drift: "Lifecycle orientation parity",
  parity_provenance_drift: "Lifecycle provenance parity",
  parity_crs_drift: "Lifecycle CRS parity",
  parity_dataset_identity_drift: "Lifecycle identity parity",
};

const NEXT_STEPS: Record<string, string> = {
  dataset_id_missing: "Confirm the dataset has a stable identifier before loading it.",
  grid_dimensions_invalid: "Check the source metadata and provide positive integer width and height.",
  grid_cardinality_mismatch: "Rebuild or re-export the grid so each array matches width × height.",
  grid_values_non_finite: "Remove non-finite cell values or encode recognized no-data values.",
  grid_all_nodata: "Provide a depth grid with finite cells before relying on placement.",
  nodata_ratio_high: "Review the source mask and reduce no-data coverage before trusting this grid.",
  topography_nodata_ratio_high: "Review topography coverage; land placement may remain incomplete.",
  depth_semantics_invalid: "Confirm depths use BathyScan's positive-down convention.",
  topography_semantics_invalid: "Confirm topography uses non-negative above-water elevations.",
  depth_range_mismatch: "Reconcile the declared depth range with the finite cell values.",
  bbox_invalid: "Verify the listed geographic bounds in WGS84 longitude and latitude.",
  bbox_antimeridian: "Confirm the antimeridian interpretation and west-to-east extent.",
  center_invalid: "Supply a dataset center within WGS84 geographic limits.",
  center_outside_bbox: "Reconcile the dataset center with its geographic bounds.",
  orientation_unknown: "Declare how served rows and columns map to geographic direction.",
  orientation_not_row_zero_south: "Serve row 0 from the southern edge of the grid.",
  orientation_columns_not_west_to_east: "Serve columns from west to east, or declare the transform.",
  orientation_source_served_mismatch: "Document the source-to-served orientation transform.",
  provenance_unknown: "Record the upstream source or processing provenance.",
  crs_unknown: "Declare the coordinate reference system used by served coordinates.",
  crs_not_wgs84: "Reproject served coordinates to WGS84 / EPSG:4326 or document the transform.",
  gps_placement_uncertain: "Complete the geographic metadata declarations before using GPS placement.",
  parity_shape_drift: "Compare persisted and served grid metadata and resolve the shape difference.",
  parity_bounds_drift: "Compare persisted and served bounds and resolve the geographic difference.",
  parity_depth_semantics_drift: "Compare depth conventions across lifecycle stages.",
  parity_orientation_drift: "Compare orientation declarations across lifecycle stages.",
  parity_provenance_drift: "Compare provenance declarations across lifecycle stages.",
  parity_crs_drift: "Review the declared coordinate transformation across lifecycle stages.",
  parity_dataset_identity_drift: "Confirm persisted and served artifacts use the same dataset ID.",
};

const palette: Record<DatasetAuditFindingSeverity, { color: string; border: string; surface: string; icon: LucideIcon }> = {
  pass: { color: "#74d3c2", border: "rgba(116,211,194,.3)", surface: "rgba(116,211,194,.07)", icon: CheckCircle2 },
  warning: { color: "#e6b86a", border: "rgba(230,184,106,.34)", surface: "rgba(230,184,106,.08)", icon: AlertTriangle },
  blocked: { color: "#df9292", border: "rgba(223,146,146,.34)", surface: "rgba(223,146,146,.08)", icon: Ban },
};

const styles: Record<string, CSSProperties> = {
  content: {
    width: "min(980px, calc(100vw - 24px))",
    maxWidth: "980px",
    maxHeight: "calc(100dvh - 24px)",
    padding: 0,
    gap: 0,
    overflow: "hidden",
    border: "1px solid rgba(112, 185, 190, .32)",
    borderRadius: 14,
    background: "#081c2b",
    color: "#d8e7e8",
    boxShadow: "0 24px 80px rgba(0, 11, 20, .55)",
  },
  header: {
    padding: "24px 30px 20px",
    borderBottom: "1px solid rgba(112, 185, 190, .18)",
    background: "linear-gradient(125deg, rgba(20, 67, 78, .48), rgba(8, 28, 43, .92) 58%)",
  },
  eyebrow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
    color: "#74d3c2",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".16em",
    textTransform: "uppercase",
  },
  title: {
    maxWidth: "calc(100% - 40px)",
    color: "#ecf6f3",
    fontSize: "clamp(20px, 3vw, 31px)",
    fontWeight: 700,
    lineHeight: 1.15,
    letterSpacing: "-.025em",
    overflowWrap: "anywhere",
  },
  description: {
    maxWidth: 720,
    marginTop: 10,
    color: "#9fb8bb",
    fontSize: 13,
    lineHeight: 1.55,
  },
  identity: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 18,
  },
  tag: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 25,
    padding: "3px 8px",
    border: "1px solid rgba(116, 211, 194, .32)",
    borderRadius: 999,
    color: "#a6ded6",
    background: "rgba(116, 211, 194, .09)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".08em",
    textTransform: "uppercase",
  },
  id: {
    minWidth: 0,
    color: "#76979d",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    overflowWrap: "anywhere",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
    padding: "22px 30px 26px",
    overflowY: "auto",
  },
  section: {
    border: "1px solid rgba(112, 185, 190, .16)",
    borderRadius: 10,
    background: "rgba(4, 19, 31, .48)",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 16px 12px",
    borderBottom: "1px solid rgba(112, 185, 190, .14)",
  },
  sectionLabel: {
    color: "#c9e0df",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".15em",
    textTransform: "uppercase",
  },
  sectionNote: {
    color: "#718e94",
    fontSize: 11,
    textAlign: "right",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 1,
    background: "rgba(112, 185, 190, .1)",
  },
  evidence: {
    minWidth: 0,
    padding: "13px 15px",
    background: "#0a2233",
  },
  evidenceLabel: {
    marginBottom: 6,
    color: "#719198",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: ".11em",
    lineHeight: 1.35,
    textTransform: "uppercase",
  },
  evidenceValue: {
    color: "#e2efec",
    fontSize: 14,
    fontWeight: 650,
    lineHeight: 1.35,
    overflowWrap: "anywhere",
  },
  unknown: {
    color: "#83999c",
    fontStyle: "italic",
    fontWeight: 400,
  },
  statusStrip: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 10,
  },
  statusCard: {
    minWidth: 0,
    padding: "14px 16px",
    border: "1px solid rgba(112, 185, 190, .2)",
    borderRadius: 10,
    background: "rgba(4, 19, 31, .54)",
  },
  statusLabel: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    marginBottom: 9,
    color: "#87a5a9",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: ".13em",
    textTransform: "uppercase",
  },
  statusValue: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    fontSize: 17,
    fontWeight: 750,
    letterSpacing: "-.01em",
  },
  qualifier: {
    marginTop: 8,
    color: "#8aa3a7",
    fontSize: 11,
    lineHeight: 1.45,
  },
  findingList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
  },
  finding: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: 10,
    padding: "11px 12px",
    border: "1px solid",
    borderRadius: 8,
  },
  findingTitle: {
    marginBottom: 3,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: ".04em",
  },
  findingMessage: {
    color: "#b5c9ca",
    fontSize: 12,
    lineHeight: 1.5,
  },
  nextStep: {
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1px solid rgba(210, 230, 226, .1)",
    color: "#d9c28b",
    fontSize: 11,
    lineHeight: 1.45,
  },
  empty: {
    padding: "15px 16px",
    color: "#80999d",
    fontSize: 12,
    fontStyle: "italic",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    padding: "14px 30px 18px",
    borderTop: "1px solid rgba(112, 185, 190, .16)",
  },
  close: {
    minHeight: 38,
    padding: "8px 16px",
    border: "1px solid rgba(116, 211, 194, .38)",
    borderRadius: 7,
    color: "#06212a",
    background: "#74d3c2",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: ".12em",
    textTransform: "uppercase",
  },
};

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  const value = candidate.status ?? candidate.statusCode ?? candidate.response?.status;
  return typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
}

function coordinate(value: number | null, axis: "lon" | "lat"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return UNKNOWN;
  const suffix = axis === "lon" ? (value < 0 ? "W" : "E") : value < 0 ? "S" : "N";
  return `${Math.abs(value).toFixed(4)}° ${suffix}`;
}

function ratio(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : UNKNOWN;
}

function finiteEvidence(finding: DatasetAuditFinding | undefined, key: string): number | null {
  const value = finding?.evidence?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function messageFor(report: DatasetAuditReport, reason: DatasetAuditFindingReason): DatasetAuditFinding | undefined {
  return report.findings.find((finding) => finding.reason === reason);
}

const Skeleton: FC = () => (
  <div data-testid="dataset-inspection-loading" role="status" aria-label="Loading dataset evidence" style={styles.section}>
    <div style={styles.sectionHeader}>
      <span style={styles.sectionLabel}>Evidence review</span>
      <span style={{ ...styles.sectionNote, color: "#74d3c2" }}>Reading audit record</span>
    </div>
    <div style={styles.grid}>
      {[1, 2, 3, 4, 5, 6].map((item) => (
        <div key={item} style={styles.evidence}>
          <div style={{ width: "42%", height: 9, borderRadius: 4, background: "rgba(151, 193, 193, .14)" }} />
          <div style={{ width: item % 2 ? "67%" : "49%", height: 16, marginTop: 10, borderRadius: 4, background: "rgba(151, 193, 193, .1)" }} />
        </div>
      ))}
    </div>
  </div>
);

const ErrorState: FC<{ source: "public" | "owned"; error: unknown; onRetry: () => void }> = ({ source, error, onRetry }) => {
  const status = errorStatus(error);
  const accessMessage =
    status === 401
      ? "Sign in again to request this audit."
      : status === 403 || status === 404
        ? source === "owned"
          ? "This dataset evidence is unavailable or no longer accessible."
          : "This public dataset evidence is unavailable."
        : "The dataset evidence could not be retrieved right now.";

  return (
    <div data-testid="dataset-inspection-error" role="alert" style={{ ...styles.section, borderColor: "rgba(223,146,146,.32)" }}>
      <div style={styles.findingList}>
        <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
          <AlertTriangle size={19} color="#df9292" aria-hidden="true" />
          <div>
            <div style={{ ...styles.findingTitle, color: "#df9292" }}>
              Evidence unavailable
            </div>
            <div style={styles.findingMessage}>{accessMessage}</div>
            <div style={{ ...styles.nextStep, borderTop: 0, marginTop: 5, paddingTop: 0, color: "#9fb8bb" }}>
              <strong>Next:</strong> {status === 401
                ? "Sign in and reopen the inspection."
                : status === 403 || status === 404
                  ? source === "owned"
                    ? "Check that the dataset is still listed in your library, then reopen this review."
                    : "Return to the catalog and reopen this dataset."
                  : "Retry the audit when the service is available."}
            </div>
            <button
              type="button"
              data-testid="button-retry-dataset-inspection"
              onClick={onRetry}
              style={{ marginTop: 11, padding: "7px 11px", border: "1px solid rgba(116,211,194,.3)", borderRadius: 6, background: "rgba(116,211,194,.08)", color: "#a6ded6", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", cursor: "pointer" }}
            >
              Retry audit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const FindingGroup: FC<{
  severity: DatasetAuditFindingSeverity;
  findings: DatasetAuditFinding[];
}> = ({ severity, findings }) => {
  const visual = palette[severity];
  const Icon = visual.icon;
  const title = severity === "pass" ? "Verified facts" : severity === "warning" ? "Warnings" : "Blocked checks";
  const note = severity === "pass" ? "Returned by the audit" : "Review before relying on this dataset";

  return (
    <section data-testid={`dataset-inspection-findings-${severity}`} style={styles.section}>
      <div style={styles.sectionHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon size={15} color={visual.color} aria-hidden="true" />
          <span style={{ ...styles.sectionLabel, color: visual.color }}>{title}</span>
        </div>
        <span style={styles.sectionNote}>{findings.length ? `${findings.length} returned` : note}</span>
      </div>
      {findings.length ? (
        <div style={styles.findingList}>
          {findings.map((finding, index) => {
            const label = REASON_LABELS[finding.reason] ?? "Audit finding";
            const next = NEXT_STEPS[finding.reason];
            return (
              <article
                key={`${finding.reason}-${index}`}
                data-testid={`dataset-inspection-finding-${severity}-${finding.reason}-${index}`}
                style={{ ...styles.finding, borderColor: visual.border, background: visual.surface }}
              >
                <Icon size={16} color={visual.color} aria-hidden="true" style={{ marginTop: 2 } as CSSProperties} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...styles.findingTitle, color: visual.color }}>{label}</div>
                  <div style={styles.findingMessage}>{finding.message}</div>
                  {finding.evidence && Object.keys(finding.evidence).length > 0 && (
                    <div data-testid={`dataset-inspection-finding-evidence-${severity}-${index}`} style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {Object.entries(finding.evidence).map(([key, value]) => (
                        <span key={key} style={{ color: "#90acad", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10 }}>
                          {key}: <strong style={{ color: "#c4d9d6", fontWeight: 600 }}>{value === null ? UNKNOWN : String(value)}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                  {severity !== "pass" && next && <div style={styles.nextStep}><strong>Next:</strong> {next}</div>}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div style={styles.empty}>
          No {severity} findings were returned; this category has no returned evidence and is not being presented as a pass.
        </div>
      )}
    </section>
  );
};

const EvidenceValue: FC<{ label: string; value: string; testId: string; subdued?: boolean }> = ({ label, value, testId, subdued }) => (
  <div style={styles.evidence}>
    <div style={styles.evidenceLabel}>{label}</div>
    <div data-testid={testId} style={value === UNKNOWN || subdued ? { ...styles.evidenceValue, ...styles.unknown } : styles.evidenceValue}>
      {value}
    </div>
  </div>
);

const UnavailableAuditEvidence: FC<{ bounds: DatasetInspectionBounds }> = ({ bounds }) => {
  const listedBounds = bounds
    ? `${coordinate(bounds.minLon, "lon")} → ${coordinate(bounds.maxLon, "lon")} / ${coordinate(bounds.minLat, "lat")} → ${coordinate(bounds.maxLat, "lat")}`
    : UNKNOWN;
  const incompleteBounds =
    !bounds || [bounds.minLon, bounds.maxLon, bounds.minLat, bounds.maxLat].some((value) => value === null);

  return (
    <>
      <div style={styles.statusStrip}>
        <div data-testid="dataset-inspection-audit-status" style={styles.statusCard}>
          <div style={styles.statusLabel}><ShieldCheck size={14} aria-hidden="true" /> Overall audit</div>
          <div style={{ ...styles.statusValue, color: "#83999c" }}><Info size={20} aria-hidden="true" /> {UNKNOWN}</div>
          <div style={styles.qualifier}>No audit response was available to verify the dataset.</div>
        </div>
        <div data-testid="dataset-inspection-gps-status" style={styles.statusCard}>
          <div style={styles.statusLabel}><MapPinned size={14} aria-hidden="true" /> GPS placement check</div>
          <div style={{ ...styles.statusValue, color: "#83999c" }}><Info size={20} aria-hidden="true" /> {UNKNOWN}</div>
          <div style={styles.qualifier}>Readiness cannot be determined without audit evidence.</div>
        </div>
      </div>
      <section data-testid="dataset-inspection-evidence" style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionLabel}>Listed evidence</span>
          <span style={styles.sectionNote}>No unstated values inferred</span>
        </div>
        <div style={styles.grid}>
          <EvidenceValue label="Listed source bounds" value={listedBounds} testId="dataset-inspection-bounds" subdued={incompleteBounds} />
          <EvidenceValue label="Grid dimensions" value={UNKNOWN} testId="dataset-inspection-dimensions" subdued />
          <EvidenceValue label="Valid depth cells" value={UNKNOWN} testId="dataset-inspection-depth-cells" subdued />
          <EvidenceValue label="Depth coverage" value={UNKNOWN} testId="dataset-inspection-depth-coverage" subdued />
          <EvidenceValue label="Depth no-data ratio" value={UNKNOWN} testId="dataset-inspection-depth-nodata-ratio" subdued />
          <EvidenceValue label="Topography no-data ratio" value={UNKNOWN} testId="dataset-inspection-topography-nodata-ratio" subdued />
          <EvidenceValue label="Depth convention" value={UNKNOWN} testId="dataset-inspection-depth-convention" subdued />
          <EvidenceValue label="Served orientation" value={UNKNOWN} testId="dataset-inspection-orientation" subdued />
          <EvidenceValue label="Provenance" value={UNKNOWN} testId="dataset-inspection-provenance" subdued />
          <EvidenceValue label="Served CRS" value={UNKNOWN} testId="dataset-inspection-crs" subdued />
          <EvidenceValue label="Audit version" value={UNKNOWN} testId="dataset-inspection-version" subdued />
          <EvidenceValue label="Depth invalid finite cells" value={UNKNOWN} testId="dataset-inspection-depth-invalid" subdued />
          <EvidenceValue label="Antimeridian crossing" value={UNKNOWN} testId="dataset-inspection-antimeridian" subdued />
          <EvidenceValue label="Topography cells" value={UNKNOWN} testId="dataset-inspection-topography-cells" subdued />
        </div>
      </section>
    </>
  );
};

export const DatasetInspectionDialog: FC<DatasetInspectionDialogProps> = ({
  open,
  onOpenChange,
  returnFocusRef,
  datasetId,
  datasetName,
  datasetSource,
  sourceLabel,
  bounds,
}) => {
  const publicAudit = useGetDatasetsIdAudit(datasetId, {
    query: {
      enabled: open && datasetSource === "public",
      queryKey: getGetDatasetsIdAuditQueryKey(datasetId),
    },
  });
  const ownedAudit = useGetUserDatasetsIdAudit(datasetId, {
    query: {
      enabled: open && datasetSource === "owned",
      queryKey: getGetUserDatasetsIdAuditQueryKey(datasetId),
    },
  });

  const audit = (datasetSource === "public" ? publicAudit.data : ownedAudit.data) as DatasetAuditReport | undefined;
  const query = datasetSource === "public" ? publicAudit : ownedAudit;
  const findings = useMemo(() => {
    const all = audit?.findings ?? [];
    return {
      pass: all.filter((finding) => finding.severity === "pass"),
      warning: all.filter((finding) => finding.severity === "warning"),
      blocked: all.filter((finding) => finding.severity === "blocked"),
    };
  }, [audit]);

  const dimensionFinding = audit ? messageFor(audit, "grid_dimensions_invalid") : undefined;
  const depthConvention = audit ? messageFor(audit, "depth_semantics_invalid") : undefined;
  const orientation = audit
    ? messageFor(audit, "orientation_not_row_zero_south") ?? messageFor(audit, "orientation_unknown") ?? messageFor(audit, "orientation_columns_not_west_to_east")
    : undefined;
  const provenance = audit ? messageFor(audit, "provenance_unknown") : undefined;
  const crs = audit ? messageFor(audit, "crs_not_wgs84") ?? messageFor(audit, "crs_unknown") : undefined;
  const depthRatio = audit?.metrics.depthNoDataRatio ?? null;
  const validDepthCells = audit
    ? Math.max(0, audit.metrics.depthCellCount - audit.metrics.depthNoDataCount - audit.metrics.depthInvalidFiniteCount)
    : null;
  const depthCoverage =
    audit && audit.metrics.depthCellCount > 0 && validDepthCells !== null
      ? validDepthCells / audit.metrics.depthCellCount
      : null;
  const sourceKind = datasetSource === "public" ? "Public catalog" : "Your dataset";
  const status = audit?.status;
  const statusColor = status ? palette[status].color : "#83999c";
  const StatusIcon = status === "blocked" ? Ban : status === "warning" ? AlertTriangle : CheckCircle2;

  const width = finiteEvidence(dimensionFinding, "width");
  const height = finiteEvidence(dimensionFinding, "height");
  const dimensions = width !== null && height !== null ? `${width} × ${height} cells` : UNKNOWN;
  const depthConventionValue =
    depthConvention?.severity === "pass"
      ? "Positive-down"
      : depthConvention?.severity === "blocked"
        ? "Invalid convention"
        : UNKNOWN;
  const orientationValue =
    orientation?.severity === "pass"
      ? "Row 0 south · columns west to east"
      : orientation?.severity === "blocked"
        ? "Not canonical"
        : UNKNOWN;
  const provenanceValue =
    provenance?.severity === "pass" && typeof provenance.evidence?.provenance === "string"
      ? provenance.evidence.provenance
      : provenance?.severity === "blocked"
        ? "Rejected"
        : UNKNOWN;
  const crsValue =
    crs?.severity === "pass"
      ? "WGS84 / EPSG:4326"
      : crs?.severity === "blocked"
        ? "Not WGS84"
        : UNKNOWN;
  const gpsReady = audit?.gpsPlacementReady;
  const gpsFinding = audit
    ? messageFor(audit, "gps_placement_ready") ?? messageFor(audit, "gps_placement_uncertain")
    : undefined;
  const gpsStatus =
    gpsReady === true
      ? "READY"
      : gpsFinding?.severity === "blocked"
        ? "BLOCKED"
        : gpsReady === false
          ? "NEEDS REVIEW"
          : UNKNOWN;
  const gpsStatusColor =
    gpsReady === true
      ? palette.pass.color
      : gpsFinding?.severity === "blocked"
        ? palette.blocked.color
        : gpsReady === false
          ? palette.warning.color
          : "#83999c";
  const topographyNodata =
    audit && audit.metrics.topographyCellCount === 0
      ? "Not supplied"
      : ratio(audit?.metrics.topographyNoDataRatio);
  const auditVersion = audit ? String(audit.version) : UNKNOWN;
  const invalidDepthCells = audit ? audit.metrics.depthInvalidFiniteCount.toLocaleString() : UNKNOWN;
  const antimeridianCrossing = audit
    ? audit.metrics.antimeridianCrossing === null
      ? UNKNOWN
      : audit.metrics.antimeridianCrossing
        ? "Yes"
        : "No"
    : UNKNOWN;
  const topographyCellCount = audit ? audit.metrics.topographyCellCount.toLocaleString() : UNKNOWN;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="dataset-inspection-dialog"
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
        style={styles.content}
      >
        <DialogHeader style={styles.header}>
          <div style={styles.eyebrow}><Database size={14} aria-hidden="true" /> Dataset inspection · evidence review</div>
          <DialogTitle data-testid="dataset-inspection-title" style={styles.title}>{datasetName}</DialogTitle>
          <DialogDescription style={styles.description}>
            A bounded read of the metadata returned for this dataset. Verified facts are separated from warnings and missing evidence.
          </DialogDescription>
          <div style={styles.identity}>
            <span data-testid="dataset-inspection-source" style={styles.tag}>{sourceKind}</span>
            <span data-testid="dataset-inspection-source-label" style={styles.tag}>{sourceLabel}</span>
            <span data-testid="dataset-inspection-id" style={styles.id}>{datasetId}</span>
          </div>
        </DialogHeader>

        <div style={styles.body}>
          {query.isLoading || query.isFetching && !audit ? (
            <Skeleton />
          ) : query.isError ? (
            <>
              <ErrorState source={datasetSource} error={query.error} onRetry={() => { void query.refetch(); }} />
              <UnavailableAuditEvidence bounds={bounds} />
            </>
          ) : !audit ? (
            <>
              <div data-testid="dataset-inspection-unavailable" role="status" style={{ ...styles.section, borderColor: "rgba(230,184,106,.3)" }}>
                <div style={styles.findingList}>
                  <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                    <Info size={18} color="#e6b86a" aria-hidden="true" />
                    <div>
                      <div style={{ ...styles.findingTitle, color: "#e6b86a" }}>Audit evidence is unavailable</div>
                      <div style={styles.findingMessage}>No audit response was returned for this inspection.</div>
                    </div>
                  </div>
                </div>
              </div>
              <UnavailableAuditEvidence bounds={bounds} />
            </>
          ) : (
            <>
              <div style={styles.statusStrip}>
                <div data-testid="dataset-inspection-audit-status" style={styles.statusCard}>
                  <div style={styles.statusLabel}><ShieldCheck size={14} aria-hidden="true" /> Overall audit</div>
                  <div style={{ ...styles.statusValue, color: statusColor }}><StatusIcon size={20} aria-hidden="true" /> {status ? status.toUpperCase() : UNKNOWN}</div>
                  <div style={styles.qualifier}>A summary of the checks returned in this audit record.</div>
                </div>
                <div data-testid="dataset-inspection-gps-status" style={styles.statusCard}>
                  <div style={styles.statusLabel}><MapPinned size={14} aria-hidden="true" /> GPS placement check</div>
                  <div style={{ ...styles.statusValue, color: gpsStatusColor }}>
                    {gpsReady === true ? <Check size={20} aria-hidden="true" /> : gpsFinding?.severity === "blocked" ? <Ban size={20} aria-hidden="true" /> : gpsReady === false ? <AlertTriangle size={20} aria-hidden="true" /> : <Info size={20} aria-hidden="true" />}
                    {gpsStatus}
                  </div>
                  <div style={styles.qualifier}>Metadata readiness only; this is not a guarantee of GPS accuracy.</div>
                </div>
              </div>

              <section data-testid="dataset-inspection-evidence" style={styles.section}>
                <div style={styles.sectionHeader}>
                  <span style={styles.sectionLabel}>Listed evidence</span>
                  <span style={styles.sectionNote}>No unstated values inferred</span>
                </div>
                <div style={styles.grid}>
                  <EvidenceValue
                    label="Listed source bounds"
                    value={bounds ? `${coordinate(bounds.minLon, "lon")} → ${coordinate(bounds.maxLon, "lon")} / ${coordinate(bounds.minLat, "lat")} → ${coordinate(bounds.maxLat, "lat")}` : UNKNOWN}
                    testId="dataset-inspection-bounds"
                    subdued={!bounds || [bounds.minLon, bounds.maxLon, bounds.minLat, bounds.maxLat].some((value) => value === null)}
                  />
                  <EvidenceValue label="Grid dimensions" value={dimensions} testId="dataset-inspection-dimensions" subdued={dimensions === UNKNOWN} />
                  <EvidenceValue label="Valid depth cells" value={validDepthCells === null ? UNKNOWN : validDepthCells.toLocaleString()} testId="dataset-inspection-depth-cells" subdued={validDepthCells === null} />
                  <EvidenceValue label="Depth coverage" value={ratio(depthCoverage)} testId="dataset-inspection-depth-coverage" subdued={depthCoverage === null} />
                  <EvidenceValue label="Depth no-data ratio" value={ratio(depthRatio)} testId="dataset-inspection-depth-nodata-ratio" subdued={depthRatio === null} />
                  <EvidenceValue label="Topography no-data ratio" value={topographyNodata} testId="dataset-inspection-topography-nodata-ratio" subdued={topographyNodata === UNKNOWN} />
                  <EvidenceValue label="Depth convention" value={depthConventionValue} testId="dataset-inspection-depth-convention" subdued={depthConventionValue === UNKNOWN} />
                  <EvidenceValue label="Served orientation" value={orientationValue} testId="dataset-inspection-orientation" subdued={orientationValue === UNKNOWN} />
                  <EvidenceValue label="Provenance" value={provenanceValue} testId="dataset-inspection-provenance" subdued={provenanceValue === UNKNOWN} />
                  <EvidenceValue label="Served CRS" value={crsValue} testId="dataset-inspection-crs" subdued={crsValue === UNKNOWN} />
                  <EvidenceValue label="Audit version" value={auditVersion} testId="dataset-inspection-version" />
                  <EvidenceValue label="Depth invalid finite cells" value={invalidDepthCells} testId="dataset-inspection-depth-invalid" />
                  <EvidenceValue label="Antimeridian crossing" value={antimeridianCrossing} testId="dataset-inspection-antimeridian" subdued={audit.metrics.antimeridianCrossing === null} />
                  <EvidenceValue label="Topography cells" value={topographyCellCount} testId="dataset-inspection-topography-cells" />
                </div>
              </section>

              <FindingGroup severity="pass" findings={findings.pass} />
              <FindingGroup severity="warning" findings={findings.warning} />
              <FindingGroup severity="blocked" findings={findings.blocked} />
            </>
          )}
        </div>

        <DialogFooter style={styles.footer}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#789498", fontSize: 11 }}>
            <Ruler size={13} aria-hidden="true" />
            Audit facts are bounded and read-only.
          </div>
          <DialogClose asChild>
            <button type="button" data-testid="button-close-dataset-inspection" style={styles.close}>
              Close review
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DatasetInspectionDialog;