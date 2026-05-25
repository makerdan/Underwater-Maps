/**
 * ProvenancePanel — collapsible HUD inset showing data source provenance.
 *
 * Displayed below the dataset name in the DatasetPanel. Shows:
 *  • Data source badge (NCEI Multibeam / GEBCO / Synthetic)
 *  • Resolution and grid size
 *  • Credit link
 *  • EFH availability badge for supported datasets
 */
import React, { useState } from "react";
import type { TerrainData } from "@workspace/api-client-react";

interface ProvenancePanelProps {
  terrain: TerrainData;
  hasEfh?: boolean;
}

type DataSource = "ncei" | "gebco" | "synthetic";

const SOURCE_META: Record<
  DataSource,
  { label: string; color: string; description: string; creditUrl: string }
> = {
  ncei: {
    label: "NCEI Multibeam",
    color: "#22d3ee",
    description: "High-resolution (1–50 m) NCEI Bag Mosaic — real multibeam survey data from NOAA.",
    creditUrl: "https://www.ncei.noaa.gov/maps/bathymetry/",
  },
  gebco: {
    label: "GEBCO 2024",
    color: "#a78bfa",
    description: "General Bathymetric Chart of the Oceans (~400 m global grid, GEBCO/SRTM15+).",
    creditUrl: "https://www.gebco.net/data_and_products/gridded_bathymetry_data/",
  },
  synthetic: {
    label: "Synthetic",
    color: "#f59e0b",
    description:
      "Procedurally generated terrain. Real upstream data sources (NCEI, GEBCO) were unreachable.",
    creditUrl: "",
  },
};

export const ProvenancePanel: React.FC<ProvenancePanelProps> = ({
  terrain,
  hasEfh,
}) => {
  const [expanded, setExpanded] = useState(false);

  const sourceKey: DataSource =
    (terrain.dataSource as DataSource | undefined) ??
    (terrain.synthetic ? "synthetic" : "gebco");

  const src = SOURCE_META[sourceKey] ?? SOURCE_META.gebco;

  return (
    <div
      style={{
        marginTop: 6,
        borderTop: "1px solid rgba(255,255,255,0.08)",
        paddingTop: 5,
      }}
    >
      {/* Header row — always visible */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setExpanded((e) => !e)}
        role="button"
        aria-expanded={expanded}
        aria-label="Toggle data provenance"
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            background: `${src.color}22`,
            border: `1px solid ${src.color}66`,
            borderRadius: 3,
            padding: "1px 6px",
            fontSize: 9,
            color: src.color,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          <svg
            width="7"
            height="7"
            viewBox="0 0 8 8"
            style={{ fill: src.color, flexShrink: 0 }}
          >
            <circle cx="4" cy="4" r="4" />
          </svg>
          {src.label}
        </span>

        {hasEfh && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              background: "rgba(16,185,129,0.12)",
              border: "1px solid rgba(16,185,129,0.4)",
              borderRadius: 3,
              padding: "1px 6px",
              fontSize: 9,
              color: "#10b981",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            EFH
          </span>
        )}

        <span
          style={{
            marginLeft: "auto",
            color: "#4b5563",
            fontSize: 9,
            lineHeight: 1,
          }}
        >
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10,
            color: "#94a3b8",
            lineHeight: 1.5,
          }}
        >
          <p style={{ margin: "0 0 4px" }}>{src.description}</p>

          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px" }}>
            <span style={{ color: "#64748b" }}>Resolution:</span>
            <span>
              {terrain.resolution}×{terrain.resolution} ({terrain.resolution ** 2} cells)
            </span>

            <span style={{ color: "#64748b" }}>Depth range:</span>
            <span>
              {terrain.minDepth} – {terrain.maxDepth} m
            </span>

            <span style={{ color: "#64748b" }}>Extent:</span>
            <span>
              {Math.abs(terrain.maxLon - terrain.minLon).toFixed(2)}° ×{" "}
              {Math.abs(terrain.maxLat - terrain.minLat).toFixed(2)}°
            </span>
          </div>

          {src.creditUrl && (
            <a
              href={src.creditUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                marginTop: 4,
                color: src.color,
                fontSize: 9,
                textDecoration: "underline",
                opacity: 0.8,
              }}
            >
              View source data ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
};
