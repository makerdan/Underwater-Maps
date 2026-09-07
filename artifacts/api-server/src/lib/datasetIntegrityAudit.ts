/**
 * Read-only integrity checks for terrain artifacts.
 *
 * This module intentionally accepts unknown input at its public boundary. A
 * dataset audit is most useful when the record itself is malformed, so the
 * auditor must not rely on the StoredTerrainJson TypeScript interface to
 * protect it from bad runtime data.
 */

export const DATASET_INTEGRITY_AUDIT_VERSION = 1 as const;
export const DATASET_INTEGRITY_MAX_FINDINGS = 32 as const;

export type DatasetAuditSeverity = "pass" | "warning" | "blocked";

export type DatasetAuditReason =
  | "dataset_id_missing"
  | "grid_dimensions_invalid"
  | "grid_cardinality_mismatch"
  | "grid_values_non_finite"
  | "grid_all_nodata"
  | "nodata_ratio_high"
  | "topography_nodata_ratio_high"
  | "depth_semantics_invalid"
  | "topography_semantics_invalid"
  | "depth_range_mismatch"
  | "bbox_invalid"
  | "bbox_antimeridian"
  | "center_invalid"
  | "center_outside_bbox"
  | "orientation_unknown"
  | "orientation_not_row_zero_south"
  | "orientation_columns_not_west_to_east"
  | "orientation_source_served_mismatch"
  | "provenance_unknown"
  | "crs_unknown"
  | "crs_not_wgs84"
  | "gps_placement_ready"
  | "gps_placement_uncertain"
  | "parity_shape_drift"
  | "parity_bounds_drift"
  | "parity_depth_semantics_drift"
  | "parity_orientation_drift"
  | "parity_provenance_drift"
  | "parity_crs_drift"
  | "parity_dataset_identity_drift";

export interface DatasetAuditFinding {
  readonly severity: DatasetAuditSeverity;
  readonly reason: DatasetAuditReason;
  readonly message: string;
  /**
   * Counts and observed values are deliberately scalar. The report must stay
   * bounded even when a grid contains millions of bad cells.
   */
  readonly evidence?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DatasetAuditMetrics {
  readonly expectedCellCount: number | null;
  readonly depthCellCount: number;
  readonly depthNoDataCount: number;
  readonly depthNoDataRatio: number | null;
  readonly depthInvalidFiniteCount: number;
  readonly topographyCellCount: number;
  readonly topographyNoDataCount: number;
  readonly topographyNoDataRatio: number | null;
  readonly topographyInvalidFiniteCount: number;
  readonly antimeridianCrossing: boolean | null;
}

export interface DatasetIntegrityAuditReport {
  readonly version: typeof DATASET_INTEGRITY_AUDIT_VERSION;
  readonly datasetId: string | null;
  readonly status: DatasetAuditSeverity;
  readonly findings: readonly DatasetAuditFinding[];
  readonly metrics: DatasetAuditMetrics;
  readonly gpsPlacementReady: boolean;
}

export type DatasetArtifactKind = "stored" | "uploaded" | "catalog" | "bundle" | "served" | "unknown";

export type DatasetOrientation =
  | "row-0-south"
  | "row-0-north"
  | "south-to-north"
  | "north-to-south"
  | "unknown";

export interface DatasetAuditOptions {
  readonly artifactKind?: DatasetArtifactKind;
  /** Optional explicit source metadata when the artifact has been transformed. */
  readonly sourceOrientation?: unknown;
  readonly servedOrientation?: unknown;
  readonly sourceCrs?: unknown;
  readonly servedCrs?: unknown;
  readonly sourceProvenance?: unknown;
  readonly maxFindings?: number;
}

export interface DatasetParityReport {
  readonly version: typeof DATASET_INTEGRITY_AUDIT_VERSION;
  readonly persistedDatasetId: string | null;
  readonly servedDatasetId: string | null;
  readonly status: DatasetAuditSeverity;
  readonly findings: readonly DatasetAuditFinding[];
}

interface NormalizedArtifact {
  readonly datasetId: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly depths: readonly unknown[];
  readonly topography: readonly unknown[] | null;
  readonly bounds: Bounds | null;
  readonly centerLon: number | null;
  readonly centerLat: number | null;
  readonly minDepth: number | null;
  readonly maxDepth: number | null;
  readonly orientation: NormalizedOrientation;
  readonly sourceOrientation: NormalizedOrientation;
  readonly sourceCrs: string | null;
  readonly servedCrs: string | null;
  readonly provenance: string | null;
  readonly sourceProvenance: string | null;
  readonly nodataValues: readonly unknown[];
}

interface Bounds {
  readonly minLon: number;
  readonly maxLon: number;
  readonly minLat: number;
  readonly maxLat: number;
}

interface NormalizedOrientation {
  readonly row0: "south" | "north" | null;
  readonly columns: "west-to-east" | "east-to-west" | null;
  readonly known: boolean;
}

const SEVERITY_RANK: Record<DatasetAuditSeverity, number> = {
  pass: 0,
  warning: 1,
  blocked: 2,
};

const DEFAULT_MAX_FINDINGS = 24;
const NODATA_WARNING_RATIO = 0.25;
const NODATA_BLOCKED_RATIO = 0.75;
const EPSILON = 1e-9;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstDefined(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function normalizeBounds(value: unknown): Bounds | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    minLon: finiteNumber(record.minLon) ?? Number.NaN,
    maxLon: finiteNumber(record.maxLon) ?? Number.NaN,
    minLat: finiteNumber(record.minLat) ?? Number.NaN,
    maxLat: finiteNumber(record.maxLat) ?? Number.NaN,
  };
}

function normalizeOrientation(value: unknown): NormalizedOrientation {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const row = firstDefined(record, ["row0", "rowOrder", "rows", "latitudeOrder"]);
    const columns = firstDefined(record, ["columns", "columnOrder", "longitudeOrder"]);
    return {
      row0: normalizeRow(row),
      columns: normalizeColumns(columns),
      known: normalizeRow(row) !== null && normalizeColumns(columns) !== null,
    };
  }

  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  const row0 = normalizeRow(text);
  const columns = text.includes("east-to-west") || text.includes("east_first")
    ? "east-to-west"
    : text.includes("west-to-east") || text.includes("west_first")
      ? "west-to-east"
      : "west-to-east";
  return {
    row0,
    columns,
    known: row0 !== null && (text.length === 0 || text.includes("west") || text.includes("east") || text.includes("south") || text.includes("north")),
  };
}

function normalizeRow(value: unknown): "south" | "north" | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    text === "south" ||
    text === "row-0-south" ||
    text === "row0-south" ||
    text === "south-to-north" ||
    text === "south_first" ||
    text === "south-first"
  ) return "south";
  if (
    text === "north" ||
    text === "row-0-north" ||
    text === "row0-north" ||
    text === "north-to-south" ||
    text === "north_first" ||
    text === "north-first"
  ) return "north";
  if (text.includes("row 0") && text.includes("south")) return "south";
  if (text.includes("row 0") && text.includes("north")) return "north";
  return null;
}

function normalizeColumns(value: unknown): "west-to-east" | "east-to-west" | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "west-to-east" || text === "west_first" || text === "west-first") return "west-to-east";
  if (text === "east-to-west" || text === "east_first" || text === "east-first") return "east-to-west";
  return null;
}

function normalizeCrs(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return `EPSG:${value}`;
  return stringValue(value);
}

function isWgs84(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().replace(/[\s_-]/g, "");
  return normalized === "wgs84" ||
    normalized === "epsg:4326".replace(/[\s_-]/g, "") ||
    normalized.includes("epsg::4326") ||
    normalized.includes("urn:ogc:def:crs:epsg::4326");
}

function normalizeArtifact(input: unknown, options: DatasetAuditOptions = {}): NormalizedArtifact {
  const record = asRecord(input) ?? Object.create(null) as Record<string, unknown>;
  const bbox = normalizeBounds(record.bbox);
  const bounds = bbox ?? normalizeBounds(record);
  const source = asRecord(record.source);
  const provenance = firstDefined(record, ["provenance", "dataSource", "bathymetrySource", "sourceName"]) ??
    firstDefined(source ?? Object.create(null) as Record<string, unknown>, ["provenance", "dataSource", "name"]);
  const sourceProvenance = options.sourceProvenance ??
    firstDefined(record, ["sourceProvenance", "sourceDataSource"]) ??
    firstDefined(source ?? Object.create(null) as Record<string, unknown>, ["provenance", "dataSource", "name"]);
  const orientationValue = options.servedOrientation ??
    firstDefined(record, ["servedOrientation", "orientation", "rowOrder"]);
  const sourceOrientationValue = options.sourceOrientation ??
    firstDefined(record, ["sourceOrientation", "sourceRowOrder"]) ??
    firstDefined(source ?? Object.create(null) as Record<string, unknown>, ["orientation", "rowOrder"]);
  const crsValue = options.servedCrs ??
    firstDefined(record, ["servedCrs", "crs", "coordinateReferenceSystem"]);
  const sourceCrsValue = options.sourceCrs ??
    firstDefined(record, ["sourceCrs", "sourceCoordinateReferenceSystem"]) ??
    firstDefined(source ?? Object.create(null) as Record<string, unknown>, ["crs", "coordinateReferenceSystem"]);
  const rawNodata = firstDefined(record, ["nodata", "noData", "nodataValue", "noDataValue"]);
  const nodataValues = [
    ...(Array.isArray(record.nodataValues) ? record.nodataValues : []),
    ...(rawNodata !== undefined ? [rawNodata] : []),
  ];
  const datasetId = stringValue(record.datasetId) ?? stringValue(record.id);
  const depths = arrayValue(record.depths);
  const topography = record.topography === null || record.topography === undefined
    ? null
    : arrayValue(record.topography);
  const width = finiteNumber(record.width);
  const height = finiteNumber(record.height);
  // Do not infer a missing center from a bbox edge. A guessed center can make
  // an incomplete record appear GPS-ready while pointing at the wrong place.
  const centerLon = finiteNumber(record.centerLon);
  const centerLat = finiteNumber(record.centerLat);

  return {
    datasetId,
    width,
    height,
    depths,
    topography,
    bounds,
    centerLon,
    centerLat,
    minDepth: finiteNumber(record.minDepth),
    maxDepth: finiteNumber(record.maxDepth),
    orientation: normalizeOrientation(orientationValue),
    sourceOrientation: normalizeOrientation(sourceOrientationValue),
    sourceCrs: normalizeCrs(sourceCrsValue),
    servedCrs: normalizeCrs(crsValue),
    provenance: stringValue(provenance),
    sourceProvenance: stringValue(sourceProvenance),
    nodataValues,
  };
}

function isExplicitNodata(value: unknown, nodataValues: readonly unknown[]): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number" && Number.isNaN(value)) return true;
  return nodataValues.some((nodata) => typeof value === "number" && typeof nodata === "number"
    ? Object.is(value, nodata) || value === nodata
    : value === nodata);
}

function sameNumber(a: number | null, b: number | null): boolean {
  return a === null || b === null ? a === b : Math.abs(a - b) <= EPSILON;
}

function finding(
  severity: DatasetAuditSeverity,
  reason: DatasetAuditReason,
  message: string,
  evidence?: Readonly<Record<string, string | number | boolean | null>>,
): DatasetAuditFinding {
  return evidence === undefined ? { severity, reason, message } : { severity, reason, message, evidence };
}

function pushFinding(
  findings: DatasetAuditFinding[],
  item: DatasetAuditFinding,
  maxFindings: number,
): void {
  if (findings.length < maxFindings) findings.push(item);
}

function maxAllowedFindings(options: DatasetAuditOptions): number {
  const requested = options.maxFindings;
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_MAX_FINDINGS;
  return Math.max(1, Math.min(DATASET_INTEGRITY_MAX_FINDINGS, Math.floor(requested)));
}

function validBounds(bounds: Bounds | null): boolean {
  if (!bounds) return false;
  return Number.isFinite(bounds.minLon) &&
    Number.isFinite(bounds.maxLon) &&
    Number.isFinite(bounds.minLat) &&
    Number.isFinite(bounds.maxLat) &&
    bounds.minLon >= -180 &&
    bounds.minLon <= 180 &&
    bounds.maxLon >= -180 &&
    bounds.maxLon <= 180 &&
    bounds.minLat >= -90 &&
    bounds.maxLat <= 90 &&
    bounds.minLat <= bounds.maxLat &&
    Math.abs(bounds.maxLon - bounds.minLon) <= 360;
}

function boundsContains(bounds: Bounds, lon: number, lat: number): boolean {
  const span = bounds.minLon <= bounds.maxLon
    ? bounds.maxLon - bounds.minLon
    : bounds.maxLon + 360 - bounds.minLon;
  let unwrapped = lon;
  while (unwrapped < bounds.minLon) unwrapped += 360;
  while (unwrapped > bounds.minLon + 360) unwrapped -= 360;
  return lat >= bounds.minLat - EPSILON &&
    lat <= bounds.maxLat + EPSILON &&
    unwrapped >= bounds.minLon - EPSILON &&
    unwrapped <= bounds.minLon + span + EPSILON;
}

function isAntimeridianCrossing(bounds: Bounds | null): boolean {
  return Boolean(bounds && validBounds(bounds) && bounds.minLon > bounds.maxLon);
}

function orientationMatchesCanonical(orientation: NormalizedOrientation): boolean {
  return orientation.row0 === "south" && orientation.columns === "west-to-east";
}

function valuesSummary(values: readonly unknown[], nodataValues: readonly unknown[]): {
  noData: number;
  invalidFinite: number;
  finite: number;
  negative: number;
} {
  let noData = 0;
  let invalidFinite = 0;
  let finite = 0;
  let negative = 0;
  for (const value of values) {
    if (isExplicitNodata(value, nodataValues)) {
      noData++;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      invalidFinite++;
      continue;
    }
    finite++;
    if (value < 0) negative++;
  }
  return { noData, invalidFinite, finite, negative };
}

function reportStatus(findings: readonly DatasetAuditFinding[]): DatasetAuditSeverity {
  let status: DatasetAuditSeverity = "pass";
  for (const item of findings) {
    if (SEVERITY_RANK[item.severity] > SEVERITY_RANK[status]) status = item.severity;
  }
  return status;
}

/**
 * Audit a stored, uploaded, catalog, served, or bundled terrain artifact.
 *
 * The function is synchronous and has no I/O. It never changes arrays or
 * metadata supplied by the caller.
 */
export function auditDatasetIntegrity(
  input: unknown,
  options: DatasetAuditOptions = {},
): DatasetIntegrityAuditReport {
  const artifact = normalizeArtifact(input, options);
  const maxFindings = maxAllowedFindings(options);
  const findings: DatasetAuditFinding[] = [];

  if (artifact.datasetId === null) {
    pushFinding(findings, finding("blocked", "dataset_id_missing", "Dataset has no stable datasetId."), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "dataset_id_missing", "Dataset has a stable datasetId.", { datasetId: artifact.datasetId }), maxFindings);
  }

  const dimensionsValid = artifact.width !== null &&
    artifact.height !== null &&
    Number.isInteger(artifact.width) &&
    Number.isInteger(artifact.height) &&
    artifact.width > 0 &&
    artifact.height > 0;
  if (!dimensionsValid) {
    pushFinding(findings, finding("blocked", "grid_dimensions_invalid", "Grid width and height must be positive integers.", {
      width: artifact.width,
      height: artifact.height,
    }), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "grid_dimensions_invalid", "Grid dimensions are valid.", {
      width: artifact.width,
      height: artifact.height,
    }), maxFindings);
  }

  const expectedCellCount = dimensionsValid ? artifact.width! * artifact.height! : null;
  const cardinalityValid = expectedCellCount !== null && artifact.depths.length === expectedCellCount &&
    (artifact.topography === null || artifact.topography.length === expectedCellCount);
  if (!cardinalityValid) {
    pushFinding(findings, finding("blocked", "grid_cardinality_mismatch", "Grid arrays do not match width × height.", {
      expectedCellCount,
      depthCellCount: artifact.depths.length,
      topographyCellCount: artifact.topography?.length ?? 0,
    }), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "grid_cardinality_mismatch", "Grid arrays match width × height.", {
      expectedCellCount,
    }), maxFindings);
  }

  const depthSummary = valuesSummary(artifact.depths, artifact.nodataValues);
  const topographySummary = artifact.topography === null
    ? { noData: 0, invalidFinite: 0, finite: 0, negative: 0 }
    : valuesSummary(artifact.topography, artifact.nodataValues);
  if (depthSummary.invalidFinite > 0 || topographySummary.invalidFinite > 0) {
    pushFinding(findings, finding("blocked", "grid_values_non_finite", "Grid contains values that are neither finite numbers nor recognized no-data cells.", {
      depthInvalidFiniteCount: depthSummary.invalidFinite,
      topographyInvalidFiniteCount: topographySummary.invalidFinite,
    }), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "grid_values_non_finite", "All grid values are finite or recognized no-data cells."), maxFindings);
  }

  const depthNoDataRatio = artifact.depths.length === 0 ? null : depthSummary.noData / artifact.depths.length;
  if (depthSummary.finite === 0) {
    pushFinding(findings, finding("blocked", "grid_all_nodata", "Depth grid contains no usable finite cells.", {
      depthCellCount: artifact.depths.length,
      depthNoDataCount: depthSummary.noData,
    }), maxFindings);
  } else if (depthNoDataRatio !== null && depthNoDataRatio >= NODATA_BLOCKED_RATIO) {
    pushFinding(findings, finding("blocked", "nodata_ratio_high", "Depth grid is mostly no-data and cannot be trusted for placement.", {
      noDataRatio: depthNoDataRatio,
    }), maxFindings);
  } else if (depthNoDataRatio !== null && depthNoDataRatio > NODATA_WARNING_RATIO) {
    pushFinding(findings, finding("warning", "nodata_ratio_high", "Depth grid contains a high no-data ratio.", {
      noDataRatio: depthNoDataRatio,
    }), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "nodata_ratio_high", "Depth grid no-data ratio is within the trusted range.", {
      noDataRatio: depthNoDataRatio,
    }), maxFindings);
  }

  if (depthSummary.negative > 0) {
    pushFinding(findings, finding("blocked", "depth_semantics_invalid", "Depth values must use BathyScan's positive-down convention.", {
      negativeDepthCount: depthSummary.negative,
    }), maxFindings);
  } else if (depthSummary.finite > 0) {
    pushFinding(findings, finding("pass", "depth_semantics_invalid", "Finite depth values use the positive-down convention."), maxFindings);
  } else {
    pushFinding(findings, finding("warning", "depth_semantics_invalid", "Depth convention cannot be evaluated without finite depth values."), maxFindings);
  }

  if (artifact.topography === null) {
    pushFinding(findings, finding("pass", "topography_semantics_invalid", "No topography layer was supplied; bathymetry-only artifacts are allowed."), maxFindings);
  } else if (topographySummary.negative > 0) {
    pushFinding(findings, finding("blocked", "topography_semantics_invalid", "Topography values must be non-negative above-water elevations.", {
      negativeTopographyCount: topographySummary.negative,
    }), maxFindings);
  } else if (topographySummary.invalidFinite > 0) {
    pushFinding(findings, finding("blocked", "topography_semantics_invalid", "Topography contains invalid numeric values."), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "topography_semantics_invalid", "Topography values use the non-negative elevation convention."), maxFindings);
  }
  const topographyNoDataRatio = artifact.topography === null || artifact.topography.length === 0
    ? null
    : topographySummary.noData / artifact.topography.length;
  if (artifact.topography !== null && topographyNoDataRatio !== null &&
      topographyNoDataRatio >= NODATA_BLOCKED_RATIO) {
    pushFinding(findings, finding("warning", "topography_nodata_ratio_high", "Supplied topography is mostly no-data and cannot be relied on for land placement.", {
      noDataRatio: topographyNoDataRatio,
    }), maxFindings);
  } else if (artifact.topography !== null && topographyNoDataRatio !== null &&
      topographyNoDataRatio > NODATA_WARNING_RATIO) {
    pushFinding(findings, finding("warning", "topography_nodata_ratio_high", "Supplied topography contains a high no-data ratio.", {
      noDataRatio: topographyNoDataRatio,
    }), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "topography_nodata_ratio_high", artifact.topography === null
      ? "No topography layer was supplied."
      : "Topography no-data ratio is within the trusted range.", {
      noDataRatio: topographyNoDataRatio,
    }), maxFindings);
  }

  let observedMinDepth = Infinity;
  let observedMaxDepth = -Infinity;
  for (const value of artifact.depths) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    observedMinDepth = Math.min(observedMinDepth, value);
    observedMaxDepth = Math.max(observedMaxDepth, value);
  }
  const rangeValid = artifact.minDepth === null || artifact.maxDepth === null
    ? true
    : artifact.minDepth <= artifact.maxDepth &&
      (depthSummary.finite === 0 || (artifact.minDepth - EPSILON <= observedMinDepth &&
        artifact.maxDepth + EPSILON >= observedMaxDepth));
  if (!rangeValid) {
    pushFinding(findings, finding("blocked", "depth_range_mismatch", "Stored depth range does not contain the finite depth values.", {
      minDepth: artifact.minDepth,
      maxDepth: artifact.maxDepth,
    }), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "depth_range_mismatch", "Stored depth range is absent or consistent with finite depth values."), maxFindings);
  }

  const boundsValid = validBounds(artifact.bounds);
  if (!boundsValid) {
    pushFinding(findings, finding("blocked", "bbox_invalid", "Bounding box is missing or outside WGS84 geographic limits."), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "bbox_invalid", "Bounding box is a valid WGS84 geographic extent."), maxFindings);
  }
  const antimeridianCrossing = isAntimeridianCrossing(artifact.bounds);
  if (antimeridianCrossing) {
    pushFinding(findings, finding("pass", "bbox_antimeridian", "Bounding box crosses the antimeridian and retains continuous west-to-east semantics."), maxFindings);
  } else if (boundsValid) {
    pushFinding(findings, finding("pass", "bbox_antimeridian", "Bounding box does not cross the antimeridian."), maxFindings);
  } else {
    pushFinding(findings, finding("warning", "bbox_antimeridian", "Antimeridian behavior cannot be evaluated until the bounding box is valid."), maxFindings);
  }

  const centerValid = artifact.centerLon !== null && artifact.centerLat !== null &&
    artifact.centerLon >= -180 && artifact.centerLon <= 180 &&
    artifact.centerLat >= -90 && artifact.centerLat <= 90;
  if (!centerValid) {
    pushFinding(findings, finding("blocked", "center_invalid", "Dataset center is missing or outside WGS84 limits."), maxFindings);
  } else if (artifact.bounds && boundsValid && !boundsContains(artifact.bounds, artifact.centerLon!, artifact.centerLat!)) {
    pushFinding(findings, finding("blocked", "center_outside_bbox", "Dataset center is outside its bounding box."), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "center_outside_bbox", "Dataset center is inside its bounding box."), maxFindings);
  }

  const servedOrientation = artifact.orientation;
  if (!servedOrientation.known) {
    pushFinding(findings, finding("warning", "orientation_unknown", "Served row/column orientation is not declared; placement cannot be verified."), maxFindings);
  } else if (servedOrientation.row0 !== "south") {
    pushFinding(findings, finding("blocked", "orientation_not_row_zero_south", "Served grid row 0 is not declared as the southern edge."), maxFindings);
  } else if (servedOrientation.columns !== "west-to-east") {
    pushFinding(findings, finding("blocked", "orientation_columns_not_west_to_east", "Served grid columns are not declared west-to-east."), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "orientation_not_row_zero_south", "Served grid uses row 0 south and columns west-to-east."), maxFindings);
  }

  if (artifact.sourceOrientation.known && servedOrientation.known &&
      artifact.sourceOrientation.row0 !== servedOrientation.row0) {
    pushFinding(findings, finding("pass", "orientation_source_served_mismatch", "Source and served row order differ with an explicit transformation boundary."), maxFindings);
  } else if (artifact.sourceOrientation.known && servedOrientation.known) {
    pushFinding(findings, finding("pass", "orientation_source_served_mismatch", "Source and served orientation declarations agree."), maxFindings);
  } else {
    pushFinding(findings, finding("warning", "orientation_source_served_mismatch", "Source-to-served orientation parity is not fully verifiable."), maxFindings);
  }

  if (artifact.provenance === null) {
    pushFinding(findings, finding("warning", "provenance_unknown", "Source provenance is unavailable; the artifact is not silently treated as sourced."), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "provenance_unknown", "Source provenance is declared.", { provenance: artifact.provenance }), maxFindings);
  }

  const crsKnown = artifact.servedCrs !== null;
  if (!crsKnown) {
    pushFinding(findings, finding("warning", "crs_unknown", "Served coordinate reference system is unavailable; geographic placement remains uncertain."), maxFindings);
  } else if (!isWgs84(artifact.servedCrs)) {
    pushFinding(findings, finding("blocked", "crs_not_wgs84", "Served coordinates are not declared as WGS84/EPSG:4326."), maxFindings);
  } else {
    pushFinding(findings, finding("pass", "crs_not_wgs84", "Served coordinates are declared as WGS84/EPSG:4326."), maxFindings);
  }
  if (artifact.sourceCrs !== null && artifact.servedCrs !== null && artifact.sourceCrs !== artifact.servedCrs) {
    pushFinding(findings, finding("pass", "parity_crs_drift", "Source and served CRS differ explicitly, indicating a declared transformation."), maxFindings);
  }

  const placementCertain = boundsValid && centerValid &&
    Boolean(artifact.bounds && boundsContains(artifact.bounds, artifact.centerLon!, artifact.centerLat!)) &&
    orientationMatchesCanonical(servedOrientation) &&
    crsKnown && isWgs84(artifact.servedCrs);
  if (placementCertain) {
    pushFinding(findings, finding("pass", "gps_placement_ready", "Artifact is ready for GPS placement."), maxFindings);
  } else if (boundsValid && centerValid) {
    pushFinding(findings, finding("warning", "gps_placement_uncertain", "GPS placement is uncertain because one or more geographic metadata declarations are incomplete."), maxFindings);
  } else {
    pushFinding(findings, finding("blocked", "gps_placement_uncertain", "GPS placement is blocked by invalid geographic metadata."), maxFindings);
  }

  return {
    version: DATASET_INTEGRITY_AUDIT_VERSION,
    datasetId: artifact.datasetId,
    status: reportStatus(findings),
    findings,
    metrics: {
      expectedCellCount,
      depthCellCount: artifact.depths.length,
      depthNoDataCount: depthSummary.noData,
      depthNoDataRatio,
      depthInvalidFiniteCount: depthSummary.invalidFinite,
      topographyCellCount: artifact.topography?.length ?? 0,
      topographyNoDataCount: topographySummary.noData,
      topographyNoDataRatio,
      topographyInvalidFiniteCount: topographySummary.invalidFinite,
      antimeridianCrossing: boundsValid ? antimeridianCrossing : null,
    },
    gpsPlacementReady: placementCertain,
  };
}

export const auditTerrainArtifact = auditDatasetIntegrity;
export const auditTerrainDataset = auditDatasetIntegrity;

function parityFinding(
  severity: DatasetAuditSeverity,
  reason: DatasetAuditReason,
  message: string,
  evidence?: Readonly<Record<string, string | number | boolean | null>>,
): DatasetAuditFinding {
  return finding(severity, reason, message, evidence);
}

/**
 * Compare two lifecycle stages without treating a mismatch as an opportunity
 * to rewrite either stage. The comparison intentionally checks contract
 * metadata, not every interpolated cell value.
 */
export function compareTerrainArtifacts(
  persistedInput: unknown,
  servedInput: unknown,
  options: DatasetAuditOptions = {},
): DatasetParityReport {
  const persisted = normalizeArtifact(persistedInput, options);
  const served = normalizeArtifact(servedInput, options);
  const findings: DatasetAuditFinding[] = [];

  const sameDataset = persisted.datasetId !== null &&
    served.datasetId !== null &&
    persisted.datasetId === served.datasetId;
  findings.push(sameDataset
    ? parityFinding("pass", "parity_dataset_identity_drift", "Persisted and served artifacts identify the same dataset.", {
      datasetId: persisted.datasetId,
    })
    : parityFinding("blocked", "parity_dataset_identity_drift", "Persisted and served artifacts do not identify the same dataset.", {
      persistedDatasetId: persisted.datasetId,
      servedDatasetId: served.datasetId,
    }));

  const sameShape = persisted.width === served.width &&
    persisted.height === served.height &&
    persisted.depths.length === served.depths.length &&
    (persisted.topography?.length ?? 0) === (served.topography?.length ?? 0);
  findings.push(sameShape
    ? parityFinding("pass", "parity_shape_drift", "Persisted and served grid shapes agree.")
    : parityFinding("blocked", "parity_shape_drift", "Persisted and served grid shapes differ.", {
      persistedWidth: persisted.width,
      servedWidth: served.width,
      persistedHeight: persisted.height,
      servedHeight: served.height,
    }));

  const sameBounds = persisted.bounds !== null && served.bounds !== null &&
    sameNumber(persisted.bounds.minLon, served.bounds.minLon) &&
    sameNumber(persisted.bounds.maxLon, served.bounds.maxLon) &&
    sameNumber(persisted.bounds.minLat, served.bounds.minLat) &&
    sameNumber(persisted.bounds.maxLat, served.bounds.maxLat);
  findings.push(sameBounds
    ? parityFinding("pass", "parity_bounds_drift", "Persisted and served geographic bounds agree.")
    : parityFinding("blocked", "parity_bounds_drift", "Persisted and served geographic bounds differ."));

  const persistedDepth = valuesSummary(persisted.depths, persisted.nodataValues);
  const servedDepth = valuesSummary(served.depths, served.nodataValues);
  if (persistedDepth.negative > 0 || servedDepth.negative > 0) {
    findings.push(parityFinding("blocked", "parity_depth_semantics_drift", "At least one lifecycle stage violates the positive-down depth convention."));
  } else if (persistedDepth.finite === 0 || servedDepth.finite === 0) {
    findings.push(parityFinding("warning", "parity_depth_semantics_drift", "Depth convention cannot be confirmed because one lifecycle stage has no finite depth cells."));
  } else {
    findings.push(parityFinding("pass", "parity_depth_semantics_drift", "Persisted and served depth conventions agree."));
  }

  const sameOrientation = persisted.orientation.row0 === served.orientation.row0 &&
    persisted.orientation.columns === served.orientation.columns;
  if (!persisted.orientation.known || !served.orientation.known) {
    findings.push(parityFinding("warning", "parity_orientation_drift", "Persisted and served orientation cannot be compared because one declaration is incomplete."));
  } else {
    findings.push(sameOrientation
      ? parityFinding("pass", "parity_orientation_drift", "Persisted and served orientation declarations agree.")
      : parityFinding("blocked", "parity_orientation_drift", "Persisted and served orientation declarations differ."));
  }

  const sameProvenance = persisted.provenance === served.provenance ||
    (persisted.provenance !== null && served.provenance !== null);
  findings.push(sameProvenance
    ? parityFinding("pass", "parity_provenance_drift", "Persisted and served provenance is present and compatible.")
    : parityFinding("warning", "parity_provenance_drift", "Persisted and served provenance cannot be reconciled."));

  const sameCrs = persisted.servedCrs !== null &&
    served.servedCrs !== null &&
    (persisted.servedCrs === served.servedCrs ||
    (isWgs84(persisted.servedCrs) && isWgs84(served.servedCrs)));
  findings.push(sameCrs
    ? parityFinding("pass", "parity_crs_drift", "Persisted and served CRS declarations agree.")
    : parityFinding("warning", "parity_crs_drift", "Persisted and served CRS declarations differ or are incomplete."));

  return {
    version: DATASET_INTEGRITY_AUDIT_VERSION,
    persistedDatasetId: persisted.datasetId,
    servedDatasetId: served.datasetId,
    status: reportStatus(findings),
    findings: findings.slice(0, maxAllowedFindings(options)),
  };
}

export const auditTerrainParity = compareTerrainArtifacts;
export const compareDatasetIntegrity = compareTerrainArtifacts;