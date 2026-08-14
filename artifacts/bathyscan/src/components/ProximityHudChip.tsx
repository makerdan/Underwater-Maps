/**
 * ProximityHudChip — compact HUD chip showing proximity streaming status.
 *
 * Positioned in the bottom-left HUD area (above the pin readout).
 * Hidden when proximityMode is off.
 *
 * Shows:
 *   - Active count / total registered count  e.g. "3 / 20 ACTIVE"
 *   - Spinner + dataset name while a fetch is in progress
 *   - Click → popover listing every registered dataset with state badge + distance
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/lib/settingsStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useProximityStreamingStore } from "@/lib/proximityStreamingStore";

/** 1 nautical mile = 1852 metres */
const METRES_PER_NM = 1852;

function fmtNM(distM: number): string {
  const nm = distM / METRES_PER_NM;
  if (nm < 0.1) return "<0.1 NM";
  if (nm < 10) return `${nm.toFixed(1)} NM`;
  return `${Math.round(nm)} NM`;
}

type DatasetState = "active" | "loading" | "nearby" | "far";

function stateLabel(s: DatasetState): string {
  switch (s) {
    case "active":  return "ACTIVE";
    case "loading": return "LOADING";
    case "nearby":  return "NEARBY";
    case "far":     return "FAR";
  }
}

function stateColor(s: DatasetState): string {
  switch (s) {
    case "active":  return "#00e5ff";
    case "loading": return "#fb923c";
    case "nearby":  return "#7dd3fc";
    case "far":     return "#64748b";
  }
}

/** CSS keyframe for the spinner — injected once into the document head. */
const SPIN_KEYFRAME = `@keyframes bs-prox-spin { to { transform: rotate(360deg); } }`;
let spinStyleInjected = false;
function ensureSpinStyle() {
  if (spinStyleInjected || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.textContent = SPIN_KEYFRAME;
  document.head.appendChild(el);
  spinStyleInjected = true;
}

const LOAD_THRESHOLD_M = 500;   // mirrors useDatasetProximityStreaming constant
const UNLOAD_THRESHOLD_M = 3000;

export const ProximityHudChip: React.FC = () => {
  ensureSpinStyle();

  const proximityMode = useSettingsStore((s) => s.proximityMode ?? true);
  const selectedIds    = useTerrainStore((s) => s.selectedIds);
  const visibleDatasets = useTerrainStore((s) => s.visibleDatasets);
  const loadingId      = useProximityStreamingStore((s) => s.loadingDatasetId);
  const distanceTableM = useProximityStreamingStore((s) => s.distanceTableM);
  const nameMap        = useProximityStreamingStore((s) => s.nameMap);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const chipRef  = useRef<HTMLButtonElement>(null);
  const popRef   = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (
      popRef.current && !popRef.current.contains(e.target as Node) &&
      chipRef.current && !chipRef.current.contains(e.target as Node)
    ) {
      setPopoverOpen(false);
    }
  }, []);
  useEffect(() => {
    if (popoverOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [popoverOpen, handleOutsideClick]);

  // Close on Escape
  useEffect(() => {
    if (!popoverOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPopoverOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popoverOpen]);

  if (!proximityMode) return null;

  const activeIds  = new Set(visibleDatasets.map((v) => v.datasetId));
  const activeCount = activeIds.size;
  const totalCount  = selectedIds.length;

  // Derive per-dataset state for the popover
  const popoverRows = [...selectedIds]
    .map((id) => {
      const distM = distanceTableM[id];
      const isActive  = activeIds.has(id);
      const isLoading = loadingId === id;
      let state: DatasetState;
      if (isLoading)        state = "loading";
      else if (isActive)    state = "active";
      else if (distM !== undefined && distM <= LOAD_THRESHOLD_M) state = "nearby";
      else if (distM !== undefined && distM > UNLOAD_THRESHOLD_M) state = "far";
      else                  state = "nearby"; // no bbox / inside threshold
      return { id, distM, state, name: nameMap[id] ?? id };
    })
    .sort((a, b) => {
      // active first, then by distance ascending, unknowns last
      if (a.state === "active" && b.state !== "active") return -1;
      if (b.state === "active" && a.state !== "active") return 1;
      const aD = a.distM ?? Infinity;
      const bD = b.distM ?? Infinity;
      return aD - bD;
    });

  // Chip label
  const loadingName = loadingId ? (nameMap[loadingId] ?? loadingId) : null;
  // Truncate long names for the chip
  const truncate = (s: string, max = 14): string =>
    s.length > max ? s.slice(0, max - 1) + "…" : s;

  const CHIP: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(0,10,20,0.80)",
    border: "1px solid rgba(0,229,255,0.22)",
    borderRadius: 4,
    padding: "4px 10px",
    backdropFilter: "blur(4px)",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: "calc(14px * var(--bs-font-scale, 1))",
    letterSpacing: "0.10em",
    color: "#e2e8f0",
    cursor: "pointer",
    pointerEvents: "auto",
    whiteSpace: "nowrap",
    userSelect: "none",
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={chipRef}
        data-testid="proximity-hud-chip"
        aria-haspopup="true"
        aria-expanded={popoverOpen}
        aria-label="Proximity streaming status"
        onClick={() => setPopoverOpen((v) => !v)}
        style={CHIP}
      >
        {/* Spinner + loading name */}
        {loadingId ? (
          <>
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: "calc(12px * var(--bs-font-scale, 1))",
                height: "calc(12px * var(--bs-font-scale, 1))",
                border: "2px solid rgba(251,146,60,0.35)",
                borderTopColor: "#fb923c",
                borderRadius: "50%",
                animation: "bs-prox-spin 0.7s linear infinite",
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#fb923c" }}>
              LOADING {truncate(loadingName ?? "")}
            </span>
          </>
        ) : (
          <>
            <span
              aria-hidden="true"
              style={{ color: "#00e5ff", fontSize: "calc(10px * var(--bs-font-scale, 1))" }}
            >
              ◉
            </span>
            <span>
              <span style={{ color: "#00e5ff" }}>{activeCount}</span>
              <span style={{ color: "#64748b" }}> / {totalCount}</span>
              <span style={{ color: "#94a3b8" }}> ACTIVE</span>
            </span>
          </>
        )}
        <span
          aria-hidden="true"
          style={{ color: "#475569", fontSize: "calc(11px * var(--bs-font-scale, 1))" }}
        >
          {popoverOpen ? "▴" : "▾"}
        </span>
      </button>

      {/* Popover */}
      {popoverOpen && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Proximity streaming dataset list"
          data-testid="proximity-hud-popover"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 200,
            background: "rgba(0,6,16,0.95)",
            border: "1px solid rgba(0,229,255,0.25)",
            borderRadius: 5,
            backdropFilter: "blur(8px)",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: "calc(13px * var(--bs-font-scale, 1))",
            minWidth: 260,
            maxWidth: 340,
            maxHeight: 320,
            overflowY: "auto",
            boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "7px 12px 5px",
              borderBottom: "1px solid rgba(0,229,255,0.10)",
              color: "#7dd3fc",
              letterSpacing: "0.15em",
              fontSize: "calc(12px * var(--bs-font-scale, 1))",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>PROXIMITY STREAMS</span>
            <span style={{ color: "#475569" }}>READ-ONLY</span>
          </div>

          {popoverRows.length === 0 ? (
            <div
              style={{
                padding: "12px",
                color: "#475569",
                letterSpacing: "0.08em",
                textAlign: "center",
              }}
            >
              No datasets registered
            </div>
          ) : (
            popoverRows.map((row) => (
              <div
                key={row.id}
                data-testid={`prox-row-${row.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 12px",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  background:
                    row.state === "active"
                      ? "rgba(0,229,255,0.04)"
                      : row.state === "loading"
                      ? "rgba(251,146,60,0.05)"
                      : "transparent",
                }}
              >
                {/* State badge */}
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: "calc(11px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.12em",
                    color: stateColor(row.state),
                    background: `${stateColor(row.state)}18`,
                    border: `1px solid ${stateColor(row.state)}40`,
                    borderRadius: 2,
                    padding: "1px 5px",
                  }}
                >
                  {stateLabel(row.state)}
                </span>

                {/* Name */}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: row.state === "far" ? "#475569" : "#cbd5e1",
                    letterSpacing: "0.05em",
                  }}
                  title={row.name !== row.id ? `${row.name} (${row.id})` : row.id}
                >
                  {row.name !== row.id ? row.name : row.id}
                </span>

                {/* Distance */}
                <span
                  style={{
                    flexShrink: 0,
                    color: "#64748b",
                    fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  }}
                >
                  {row.distM !== undefined ? fmtNM(row.distM) : "—"}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
