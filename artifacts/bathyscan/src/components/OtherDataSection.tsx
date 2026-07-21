/**
 * OtherDataSection — collapsed "Other data in this area" section shown at
 * the bottom of the Overview Map's selected-area panel. Lists non-bathymetry
 * NCEI records (oceanographic, geophysical, climate …) for the selected area
 * as a reference-only listing. Fetches lazily on first expand using the
 * `broad` NCEI proxy parameter so all record types are returned; bathymetry
 * records are filtered out client-side so broadened queries never leak into
 * the main bathymetry result list.
 */
import React, { useState } from "react";
import {
  useGetNceiSearch,
  getGetNceiSearchQueryKey,
} from "@workspace/api-client-react";
import type { NceiPortalResult } from "@workspace/api-client-react";
import { classifyNceiDataType, NCEI_TYPE_BADGE_COLORS } from "@/lib/nceiClassify";

export const OtherDataSection: React.FC<{
  bbox: { north: number; south: number; east: number; west: number };
}> = ({ bbox }) => {
  const [expanded, setExpanded] = useState(false);
  const bboxString = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const nceiParams = { bbox: bboxString, broad: true, max: 30 };
  const { data, isLoading, isError } = useGetNceiSearch(nceiParams, {
    query: {
      queryKey: getGetNceiSearchQueryKey(nceiParams),
      enabled: expanded,
      staleTime: 5 * 60_000,
    },
  });
  const others = React.useMemo(() => {
    if (!data) return [];
    return (data as NceiPortalResult[])
      .map((r) => ({ r, type: classifyNceiDataType(r.name, r.description) }))
      .filter((x) => x.type !== "bathymetry");
  }, [data]);

  return (
    <div data-testid="overview-other-data-section" style={{ borderTop: "1px solid rgba(0,229,255,0.12)" }}>
      <button
        data-testid="overview-other-data-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#7dd3fc",
          padding: "8px 12px",
          cursor: "pointer",
          fontSize: "calc(12.5px * var(--bs-font-scale, 1))",
          letterSpacing: "0.12em",
          fontFamily: "'JetBrains Mono', monospace",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: "calc(11px * var(--bs-font-scale, 1))" }}>{expanded ? "▾" : "▸"}</span>
        <span style={{ flex: 1 }}>OTHER DATA IN THIS AREA</span>
        {expanded && !isLoading && !isError && (
          <span style={{ color: "#64748b" }}>{others.length}</span>
        )}
      </button>
      {expanded && (
        <div style={{ padding: "0 12px 10px", maxHeight: 220, overflowY: "auto" }}>
          {isLoading && (
            <div style={{ fontSize: "calc(12.5px * var(--bs-font-scale, 1))", color: "#94a3b8", padding: "6px 0" }}>Searching NCEI…</div>
          )}
          {isError && (
            <div style={{ fontSize: "calc(12.5px * var(--bs-font-scale, 1))", color: "#fca5a5", padding: "6px 0" }}>
              ⚠ Could not load NCEI records for this area.
            </div>
          )}
          {!isLoading && !isError && others.length === 0 && (
            <div style={{ fontSize: "calc(12.5px * var(--bs-font-scale, 1))", color: "#94a3b8", padding: "6px 0" }}>
              No non-bathymetry NCEI records found here.
            </div>
          )}
          {others.map(({ r, type }) => {
            const badgeColor = NCEI_TYPE_BADGE_COLORS[type];
            return (
              <div
                key={r.id}
                data-testid="overview-other-data-card"
                style={{
                  padding: "6px 8px",
                  marginBottom: 5,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(148,163,184,0.12)",
                  borderRadius: 3,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    data-testid="overview-other-data-badge"
                    style={{
                      fontSize: "calc(10px * var(--bs-font-scale, 1))",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: badgeColor,
                      border: `1px solid ${badgeColor}55`,
                      borderRadius: 3,
                      padding: "1px 5px",
                      flexShrink: 0,
                    }}
                  >
                    {type}
                  </span>
                  {!r.wcsAvailable && (
                    <span style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#94a3b8", letterSpacing: "0.06em" }}>
                      REFERENCE ONLY
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "calc(13px * var(--bs-font-scale, 1))", color: "#cbd5e1", marginTop: 3, lineHeight: 1.35 }}>
                  {r.metadataUrl ? (
                    <a
                      href={r.metadataUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#cbd5e1", textDecoration: "underline dotted" }}
                    >
                      {r.name}
                    </a>
                  ) : (
                    r.name
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
