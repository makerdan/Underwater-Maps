/**
 * DataSourceBadge — reusable source-attribution chip used by the Tide /
 * Water Level, Currents, and Temperature overlay panels.
 *
 * Source tiers:
 *   "noaa"      — real NOAA CO-OPS data (green)
 *   "usgs"      — real USGS NWIS gauge data (green)
 *   "glerl"     — real NOAA GLERL Great-Lakes model data (green)
 *   "estimated" — synthetic / heuristic fallback (dim dashed)
 *
 * Matches the `StationSourceBadge` visual language already used inside
 * TidePanel, so all panels feel consistent without duplicating the inline
 * styles.
 */
import React from "react";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

export type DataSource = "noaa" | "usgs" | "glerl" | "estimated";

export interface DataSourceBadgeProps {
  source: DataSource;
  stationName?: string;
  stationId?: string;
  distanceKm?: number;
}

function labelFor(source: DataSource): string {
  switch (source) {
    case "noaa": return "NOAA";
    case "usgs": return "USGS";
    case "glerl": return "GLERL";
    case "estimated": return "Estimated";
  }
}

function isReal(source: DataSource): boolean {
  return source === "noaa" || source === "usgs" || source === "glerl";
}

export const DataSourceBadge: React.FC<DataSourceBadgeProps> = ({
  source,
  stationName,
  stationId,
  distanceKm,
}) => {
  const real = isReal(source);
  const sourceLabel = labelFor(source);

  const label = real
    ? stationName
      ? `${sourceLabel} — ${stationName}`
      : sourceLabel
    : "Estimated (no station found)";

  const tooltip = real
    ? stationId
      ? `Real observations from ${sourceLabel} station ${stationId}${distanceKm !== undefined ? ` (${distanceKm.toFixed(1)} km away)` : ""}`
      : `Real observations from a nearby ${sourceLabel} station`
    : `Synthetic fallback — no real station was in range`;

  const style: React.CSSProperties = real
    ? {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 13.5,
        fontFamily: FONT,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        padding: "1px 5px",
        borderRadius: 2,
        background: "rgba(52,211,153,0.12)",
        border: "1px solid rgba(52,211,153,0.5)",
        color: "#34d399",
        marginTop: 3,
      }
    : {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 13.5,
        fontFamily: FONT,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        padding: "1px 5px",
        borderRadius: 2,
        background: "rgba(148,163,184,0.08)",
        border: "1px dashed rgba(148,163,184,0.4)",
        color: "#e2e8f0",
        marginTop: 3,
      };

  const content = (
    <span
      data-testid="data-source-badge"
      data-source={source}
      style={style}
      title={tooltip}
    >
      <span aria-hidden="true">{real ? "●" : "◌"}</span>
      <span>{label}</span>
      {real && stationId && (
        <span style={{ opacity: 0.85, letterSpacing: 0 }}>#{stationId}</span>
      )}
      {real && distanceKm !== undefined && (
        <span style={{ opacity: 0.7, letterSpacing: 0 }}>{distanceKm.toFixed(1)} km</span>
      )}
    </span>
  );

  if (real && stationId && source === "noaa") {
    return (
      <a
        href={`https://tidesandcurrents.noaa.gov/stationhome.html?id=${encodeURIComponent(stationId)}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: "none" }}
      >
        {content}
      </a>
    );
  }

  return content;
};
