/**
 * LocationBadge — compact pill showing which dataset centre a panel is
 * sampling from. Three visual states:
 *
 *   • Loading  — no data yet for this location (dataset switch in progress)
 *   • Fetching — fresh data is being retrieved for an existing view (background refresh)
 *   • Ready    — data is current; shows dataset name + lat/lon
 */
import React from "react";

interface LocationBadgeProps {
  datasetName: string | undefined;
  lat: number | null;
  lon: number | null;
  /** True while the first fetch for this location is in-flight (isLoading). */
  isLoading: boolean;
  /** True for any in-flight fetch, including background refreshes (isFetching). */
  isFetching?: boolean;
}

function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
}

function fmtLon(lon: number): string {
  return `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
}

export const LocationBadge: React.FC<LocationBadgeProps> = ({
  datasetName,
  lat,
  lon,
  isLoading,
  isFetching = false,
}) => {
  if (lat === null || lon === null) return null;

  const isStale = !isLoading && isFetching;

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: "calc(12px * var(--bs-font-scale, 1))",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    padding: "2px 6px",
    borderRadius: 3,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    maxWidth: "100%",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    userSelect: "none",
    flexShrink: 0,
  };

  if (isLoading) {
    return (
      <div
        data-testid="location-badge"
        data-state="loading"
        style={{
          ...baseStyle,
          background: "rgba(251,191,36,0.10)",
          border: "1px solid rgba(251,191,36,0.35)",
          color: "#fbbf24",
        }}
        title="Fetching data for this location…"
      >
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#fbbf24",
            opacity: 0.9,
            animation: "location-badge-pulse 1.2s ease-in-out infinite",
          }}
        />
        <span>Updating…</span>
        <style>{`
          @keyframes location-badge-pulse {
            0%, 100% { opacity: 0.3; }
            50% { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  if (isStale) {
    return (
      <div
        data-testid="location-badge"
        data-state="fetching"
        style={{
          ...baseStyle,
          background: "rgba(148,163,184,0.08)",
          border: "1px dashed rgba(148,163,184,0.35)",
          color: "#94a3b8",
        }}
        title="Refreshing data for this location…"
      >
        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#94a3b8", opacity: 0.6 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {datasetName ? `${datasetName} — ` : ""}{fmtLat(lat)}, {fmtLon(lon)}
        </span>
        <span style={{ opacity: 0.7 }}>↻</span>
      </div>
    );
  }

  return (
    <div
      data-testid="location-badge"
      data-state="ready"
      style={{
        ...baseStyle,
        background: "rgba(0,229,255,0.06)",
        border: "1px solid rgba(0,229,255,0.22)",
        color: "#7dd3fc",
      }}
      title={`Sampling ${datasetName ?? "dataset"} centre: ${fmtLat(lat)}, ${fmtLon(lon)}`}
    >
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#00e5ff", opacity: 0.7 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {datasetName ? `${datasetName} — ` : ""}{fmtLat(lat)}, {fmtLon(lon)}
      </span>
    </div>
  );
};
