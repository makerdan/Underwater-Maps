/**
 * ColumnMappingStep — dialog step that lets the user assign CSV/Excel columns
 * to the six canonical GPS-import fields (lat, lon, name, depth, type, notes).
 *
 * Rendered inside GpsImportDialog when auto-detection fails to find a lat or
 * lon column, or when the user explicitly clicks "Edit column mapping" on the
 * review step.
 *
 * Features:
 *  - Dropdown per field, pre-populated from auto-detected assignment.
 *  - "— skip —" option for optional fields.
 *  - Continue disabled until lat + lon are both assigned.
 *  - Duplicate-column guard: using the same header for two fields shows an
 *    inline warning and grays the option out in other dropdowns.
 *  - Live preview of the first 5 source rows rendered with the current mapping.
 *  - localStorage persistence (CSV files only), keyed by a fingerprint of the
 *    detected header names.
 */
import React, { useCallback, useMemo, useState } from "react";
import type { RawColumnMeta, ColumnAssignment } from "@/lib/gpsImport";

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_PREFIX = "bathyscan:colmap:";

/** Stable fingerprint of a set of headers — sorted, lower-cased, joined. */
function headerFingerprint(columns: RawColumnMeta["columns"]): string {
  return columns
    .map((c) => c.header.trim().toLowerCase())
    .sort()
    .join("|");
}

function saveAssignment(fingerprint: string, assignment: ColumnAssignment): void {
  try {
    localStorage.setItem(LS_PREFIX + fingerprint, JSON.stringify(assignment));
  } catch {
    // Ignore QuotaExceededError or SecurityError.
  }
}

function loadAssignment(fingerprint: string): ColumnAssignment | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + fingerprint);
    if (!raw) return null;
    return JSON.parse(raw) as ColumnAssignment;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Derive default assignment from RawColumnMeta
// ---------------------------------------------------------------------------

/**
 * Build a `ColumnAssignment` from auto-detected column metadata. For each
 * canonical field, pick the first column whose `mappedAlias` matches. Note
 * that "elevation" alias maps to the `depth` field (the sign-flip happens in
 * applyColumnAssignment). Optional fields default to null.
 */
function defaultAssignment(meta: RawColumnMeta): ColumnAssignment {
  const find = (alias: string | string[]): string | null => {
    const aliases = Array.isArray(alias) ? alias : [alias];
    for (const col of meta.columns) {
      if (col.mappedAlias && aliases.includes(col.mappedAlias)) return col.header;
    }
    return null;
  };
  return {
    lat: find("lat"),
    lon: find("lon"),
    name: find("name"),
    depth: find(["depth", "elevation"]),
    type: find("type"),
    notes: find("notes"),
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  meta: RawColumnMeta;
  /** Pre-selected assignment (from auto-detection or a previous edit). */
  initialAssignment?: ColumnAssignment | null;
  onConfirm: (assignment: ColumnAssignment) => void;
  onBack: () => void;
}

const FIELD_LABELS: Record<keyof ColumnAssignment, string> = {
  lat: "Latitude",
  lon: "Longitude",
  name: "Name",
  depth: "Depth",
  type: "Type",
  notes: "Notes",
};

const FIELD_ORDER: (keyof ColumnAssignment)[] = ["lat", "lon", "name", "depth", "type", "notes"];
const REQUIRED_FIELDS: (keyof ColumnAssignment)[] = ["lat", "lon"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ColumnMappingStep: React.FC<Props> = ({
  meta,
  initialAssignment,
  onConfirm,
  onBack,
}) => {
  const fingerprint = useMemo(() => headerFingerprint(meta.columns), [meta.columns]);

  const [assignment, setAssignment] = useState<ColumnAssignment>(() => {
    // Priority: explicit initialAssignment → localStorage restore → auto-detected
    if (initialAssignment != null) return initialAssignment;
    const saved =
      meta.fileType === "csv" || meta.fileType === "excel"
        ? loadAssignment(fingerprint)
        : null;
    return saved ?? defaultAssignment(meta);
  });

  const headers = useMemo(() => meta.columns.map((c) => c.header), [meta.columns]);

  /** Returns true if header `h` is currently assigned to a field OTHER than `currentField`. */
  const isHeaderUsedByOther = useCallback(
    (h: string, currentField: keyof ColumnAssignment): boolean =>
      FIELD_ORDER.some((f) => f !== currentField && assignment[f] === h),
    [assignment],
  );

  /** Returns true when this field's current value is also claimed by another field. */
  const isDuplicate = useCallback(
    (field: keyof ColumnAssignment): boolean => {
      const current = assignment[field];
      return current !== null && isHeaderUsedByOther(current, field);
    },
    [assignment, isHeaderUsedByOther],
  );

  const setField = useCallback(
    (field: keyof ColumnAssignment, value: string | null) => {
      setAssignment((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const canContinue = assignment.lat !== null && assignment.lon !== null;

  const handleConfirm = useCallback(() => {
    if (!canContinue) return;
    if (meta.fileType === "csv" || meta.fileType === "excel") {
      saveAssignment(fingerprint, assignment);
    }
    onConfirm(assignment);
  }, [canContinue, meta.fileType, fingerprint, assignment, onConfirm]);

  // Live preview rows — re-render on every assignment change.
  const previewRows = meta.sampleRows.slice(0, 5);

  return (
    <div data-testid="column-mapping-step">
      <div
        style={{
          fontSize: 13.5,
          color: "#94a3b8",
          letterSpacing: "0.12em",
          marginBottom: 10,
          textTransform: "uppercase",
        }}
      >
        Column Mapping
      </div>

      {(!assignment.lat || !assignment.lon) && (
        <div
          data-testid="column-mapping-required-warning"
          style={{
            padding: "8px 10px",
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.3)",
            borderRadius: 4,
            color: "#fbbf24",
            fontSize: 15,
            marginBottom: 10,
          }}
        >
          Assign <strong>Latitude</strong> and <strong>Longitude</strong> columns to continue.
        </div>
      )}

      <table
        data-testid="column-mapping-table"
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginBottom: 14,
          fontSize: 15,
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                textAlign: "left",
                color: "#94a3b8",
                fontSize: 13.5,
                letterSpacing: "0.1em",
                padding: "4px 6px 6px 0",
                fontWeight: 600,
              }}
            >
              FIELD
            </th>
            <th
              style={{
                textAlign: "left",
                color: "#94a3b8",
                fontSize: 13.5,
                letterSpacing: "0.1em",
                padding: "4px 0 6px",
                fontWeight: 600,
              }}
            >
              COLUMN IN FILE
            </th>
          </tr>
        </thead>
        <tbody>
          {FIELD_ORDER.map((field) => {
            const required = REQUIRED_FIELDS.includes(field);
            const current = assignment[field];
            const duplicate = isDuplicate(field);

            return (
              <tr key={field} data-testid={`col-map-row-${field}`}>
                <td style={{ padding: "4px 8px 4px 0", verticalAlign: "middle" }}>
                  <span style={{ color: required ? "#00e5ff" : "#cbd5e1" }}>
                    {FIELD_LABELS[field]}
                    {required && (
                      <span
                        title="Required"
                        style={{ color: "#f87171", marginLeft: 3 }}
                        aria-label="required"
                      >
                        *
                      </span>
                    )}
                  </span>
                </td>
                <td style={{ padding: "4px 0", verticalAlign: "middle" }}>
                  <div>
                    <select
                      data-testid={`col-map-select-${field}`}
                      value={current ?? ""}
                      aria-label={`Column for ${FIELD_LABELS[field]}`}
                      onChange={(e) =>
                        setField(field, e.target.value === "" ? null : e.target.value)
                      }
                      style={{
                        width: "100%",
                        padding: "4px 6px",
                        background: "rgba(2,8,24,0.6)",
                        border: duplicate
                          ? "1px solid rgba(239,68,68,0.6)"
                          : "1px solid rgba(0,229,255,0.2)",
                        borderRadius: 3,
                        color: "#cbd5e1",
                        fontFamily: "inherit",
                        fontSize: 15,
                      }}
                    >
                      {!required && (
                        <option value="">— skip —</option>
                      )}
                      {required && current === null && (
                        <option value="" disabled>
                          — choose a column —
                        </option>
                      )}
                      {headers.map((h) => {
                        const usedElsewhere = isHeaderUsedByOther(h, field);
                        return (
                          <option key={h} value={h} disabled={usedElsewhere}>
                            {h}
                            {usedElsewhere ? " (already used)" : ""}
                          </option>
                        );
                      })}
                    </select>
                    {duplicate && (
                      <div
                        data-testid={`col-map-duplicate-warning-${field}`}
                        style={{ color: "#f87171", fontSize: 13, marginTop: 2 }}
                      >
                        Same column assigned to another field.
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {previewRows.length > 0 && (
        <details data-testid="column-mapping-preview" open style={{ marginBottom: 14 }}>
          <summary
            style={{
              cursor: "pointer",
              color: "#e2e8f0",
              fontSize: 14,
              letterSpacing: "0.1em",
              marginBottom: 6,
            }}
          >
            PREVIEW ({previewRows.length} row{previewRows.length === 1 ? "" : "s"})
          </summary>
          <div
            style={{
              overflowX: "auto",
              border: "1px solid rgba(0,229,255,0.15)",
              borderRadius: 4,
            }}
          >
            <table
              data-testid="column-mapping-preview-table"
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr style={{ background: "rgba(0,229,255,0.06)" }}>
                  {(["lat", "lon", "name"] as (keyof ColumnAssignment)[]).map((f) => (
                    <th
                      key={f}
                      style={{
                        padding: "4px 8px",
                        textAlign: "left",
                        color: "#94a3b8",
                        fontWeight: 600,
                        fontSize: 13,
                        letterSpacing: "0.08em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {FIELD_LABELS[f]}
                      {assignment[f] ? (
                        <span style={{ color: "#475569", marginLeft: 4 }}>
                          ← {assignment[f]}
                        </span>
                      ) : (
                        <span style={{ color: "#475569", marginLeft: 4 }}>
                          (skipped)
                        </span>
                      )}
                    </th>
                  ))}
                  <th
                    style={{
                      padding: "4px 8px",
                      textAlign: "left",
                      color: "#94a3b8",
                      fontWeight: 600,
                      fontSize: 13,
                      letterSpacing: "0.08em",
                    }}
                  >
                    more…
                  </th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, ri) => {
                  const lat = assignment.lat ? row[assignment.lat] : "—";
                  const lon = assignment.lon ? row[assignment.lon] : "—";
                  const name = assignment.name ? row[assignment.name] : "—";
                  const otherFields = (["depth", "type", "notes"] as (keyof ColumnAssignment)[])
                    .filter((f) => assignment[f] !== null)
                    .map((f) => `${FIELD_LABELS[f]}: ${row[assignment[f]!] ?? ""}`)
                    .join(", ");
                  return (
                    <tr
                      key={ri}
                      data-testid={`column-mapping-preview-row-${ri}`}
                      style={{
                        borderTop: "1px solid rgba(148,163,184,0.06)",
                        background: ri % 2 === 1 ? "rgba(0,229,255,0.02)" : undefined,
                      }}
                    >
                      <td style={{ padding: "3px 8px", color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
                        {lat ?? ""}
                      </td>
                      <td style={{ padding: "3px 8px", color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
                        {lon ?? ""}
                      </td>
                      <td style={{ padding: "3px 8px", color: "#cbd5e1", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {name ?? ""}
                      </td>
                      <td style={{ padding: "3px 8px", color: "#475569", fontSize: 13, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {otherFields || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onBack}
          data-testid="column-mapping-back"
          style={ghostBtnStyle}
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canContinue}
          data-testid="column-mapping-continue"
          style={canContinue ? primaryBtnStyle : disabledBtnStyle}
          aria-disabled={!canContinue}
        >
          Continue →
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const primaryBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "rgba(0,229,255,0.15)",
  border: "1px solid rgba(0,229,255,0.4)",
  borderRadius: 3,
  color: "#00e5ff",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 16.5,
  letterSpacing: "0.1em",
};

const disabledBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  opacity: 0.38,
  cursor: "not-allowed",
  background: "rgba(0,229,255,0.05)",
  borderColor: "rgba(0,229,255,0.15)",
  color: "#475569",
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "transparent",
  border: "1px solid rgba(148,163,184,0.3)",
  borderRadius: 3,
  color: "#e2e8f0",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 16.5,
  letterSpacing: "0.1em",
};
