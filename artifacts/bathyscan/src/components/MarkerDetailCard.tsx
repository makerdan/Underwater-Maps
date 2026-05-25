/**
 * MarkerDetailCard — small read-only card showing details for a single marker.
 * Opened via the marker right-click menu's "View details" action.
 */
import React, { useEffect } from "react";
import { useMarkerDetailStore } from "@/lib/markerDetailStore";
import { MARKER_COLOR, MARKER_ICON } from "@/lib/markerConstants";
import { useSettingsStore } from "@/lib/settingsStore";
import { formatDepth } from "@/lib/units";

const MONO: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
};

export const MarkerDetailCard: React.FC = () => {
  const marker = useMarkerDetailStore((s) => s.marker);
  const hide = useMarkerDetailStore((s) => s.hide);
  const units = useSettingsStore((s) => s.units);

  useEffect(() => {
    if (!marker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marker, hide]);

  if (!marker) return null;

  const color = MARKER_COLOR[marker.type] ?? "#e2e8f0";
  const icon = MARKER_ICON[marker.type] ?? "●";
  const createdAt = marker.createdAt ? new Date(marker.createdAt) : null;

  return (
    <div
      data-testid="marker-detail-card"
      style={{
        position: "absolute",
        top: 60,
        right: 16,
        width: 280,
        zIndex: 35,
        background: "rgba(0,10,20,0.94)",
        border: `1px solid ${color}55`,
        borderRadius: 4,
        padding: "10px 14px",
        color: "#cbd5e1",
        backdropFilter: "blur(8px)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        ...MONO,
        fontSize: 11,
        letterSpacing: "0.05em",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ color, fontSize: 14, fontWeight: 600 }}>
          {icon} {marker.label}
        </span>
        <button
          onClick={hide}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.2)",
            color: "#64748b",
            padding: "0 6px",
            borderRadius: 2,
            cursor: "pointer",
            fontSize: 11,
            ...MONO,
          }}
          aria-label="Close marker details"
        >
          ✕
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 10 }}>
        <span style={{ color: "#475569" }}>TYPE</span>
        <span style={{ color: "#cbd5e1" }}>{marker.type}</span>
        <span style={{ color: "#475569" }}>LON</span>
        <span style={{ color: "#00e5ff" }}>{marker.lon.toFixed(5)}°</span>
        <span style={{ color: "#475569" }}>LAT</span>
        <span style={{ color: "#00e5ff" }}>{marker.lat.toFixed(5)}°</span>
        <span style={{ color: "#475569" }}>DEPTH</span>
        <span style={{ color: "#fb923c" }}>{formatDepth(marker.depth, { units })}</span>
        {createdAt && (
          <>
            <span style={{ color: "#475569" }}>CREATED</span>
            <span style={{ color: "#94a3b8" }}>{createdAt.toLocaleString()}</span>
          </>
        )}
      </div>
      {marker.notes && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(0,229,255,0.1)" }}>
          <div style={{ color: "#475569", fontSize: 9, marginBottom: 4 }}>NOTES</div>
          <div style={{ color: "#cbd5e1", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {marker.notes}
          </div>
        </div>
      )}
    </div>
  );
};
