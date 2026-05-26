/**
 * ProvenancePanel — collapsible HUD inset showing data source provenance.
 *
 * Displayed below the dataset name in the DatasetPanel. Shows:
 *  • Data source badge (NCEI Multibeam / GEBCO / Simulated)
 *  • Resolution and grid size
 *  • Credit link
 *  • EFH availability badge for supported datasets
 */
import React, { useState } from "react";
import type { TerrainData } from "@workspace/api-client-react";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { useClassificationStore } from "@/lib/classificationStore";

interface ProvenancePanelProps {
  terrain: TerrainData;
  hasEfh?: boolean;
}

type DataSource =
  | "ncei"
  | "gebco"
  | "synthetic"
  | "twdb"
  | "usace"
  | "usgs-3dep";

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
    label: "Simulated",
    color: "#f59e0b",
    description:
      "Procedurally generated terrain. Real upstream data sources (NCEI, GEBCO) were unreachable.",
    creditUrl: "",
  },
  "usgs-3dep": {
    label: "USGS 3DEP",
    color: "#34d399",
    description:
      "USGS 3D Elevation Program — best-available DEM (1-m lidar where collected, 1/3\" seamless otherwise). Used for inland reservoir pre-impoundment bathymetry and surrounding topography.",
    creditUrl: "https://www.usgs.gov/3d-elevation-program",
  },
  twdb: {
    label: "TWDB Survey",
    color: "#34d399",
    description:
      "Texas Water Development Board Reservoir Volumetric & Sedimentation Survey.",
    creditUrl: "https://www.twdb.texas.gov/surfacewater/surveys/index.asp",
  },
  usace: {
    label: "USACE Hydro",
    color: "#34d399",
    description:
      "US Army Corps of Engineers hydrographic survey.",
    creditUrl: "https://www.usace.army.mil/",
  },
};

export const ProvenancePanel: React.FC<ProvenancePanelProps> = ({
  terrain,
  hasEfh,
}) => {
  const [expanded, setExpanded] = useState(false);
  const zoneSource = useClassificationStore((s) => s.source);
  const substrateFp = useClassificationStore((s) => s.currentSubstrateFp);
  const substrateGrounded = !!substrateFp && substrateFp !== "00000000";

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
      <ViewscreenTooltip label={expanded ? "Hide source details" : "Show source details"} side="right">
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

        {zoneSource && (
          <ViewscreenTooltip
            label={
              zoneSource === "ai"
                ? "Seafloor zones classified by AI"
                : "Seafloor zones estimated from depth (AI was unavailable)"
            }
            side="top"
          >
          <span
            data-testid={`provenance-zone-source-${zoneSource}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              background:
                zoneSource === "ai"
                  ? "rgba(0,229,255,0.12)"
                  : "rgba(251,191,36,0.12)",
              border:
                zoneSource === "ai"
                  ? "1px solid rgba(0,229,255,0.45)"
                  : "1px solid rgba(251,191,36,0.45)",
              borderRadius: 3,
              padding: "1px 6px",
              fontSize: 9,
              color: zoneSource === "ai" ? "#00e5ff" : "#fbbf24",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {zoneSource === "ai" ? "AI ZONES" : "EST ZONES"}
          </span>
          </ViewscreenTooltip>
        )}

        {substrateGrounded && (
          <ViewscreenTooltip
            label="Covered cells anchored to ShoreZone / NOAA ENC substrate surveys"
            side="top"
          >
          <span
            data-testid="provenance-substrate-grounded"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              background: "rgba(132,204,22,0.12)",
              border: "1px solid rgba(132,204,22,0.45)",
              borderRadius: 3,
              padding: "1px 6px",
              fontSize: 9,
              color: "#84cc16",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            SURVEY
          </span>
          </ViewscreenTooltip>
        )}

        {terrain.hasTopography && (
          <ViewscreenTooltip
            label="Has above-water terrain — enable Show landmass in Settings"
            side="top"
          >
          <span
            data-testid="topo-badge"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              background: "rgba(245,158,11,0.12)",
              border: "1px solid rgba(245,158,11,0.4)",
              borderRadius: 3,
              padding: "1px 6px",
              fontSize: 9,
              color: "#f59e0b",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            TOPO
          </span>
          </ViewscreenTooltip>
        )}

        <span
          style={{
            marginLeft: "auto",
            color: "#4b5563",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          {expanded ? "▲" : "▼"}
        </span>
      </div>
      </ViewscreenTooltip>

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

            {zoneSource && (
              <>
                <span style={{ color: "#64748b" }}>Zones:</span>
                <span style={{ color: zoneSource === "ai" ? "#cbd5e1" : "#fbbf24" }}>
                  {zoneSource === "ai"
                    ? "AI-classified from depth grid"
                    : "Estimated from depth (AI unavailable)"}
                </span>
              </>
            )}
          </div>

          {terrain.hasTopography && terrain.topography && (
            <button
              type="button"
              data-testid="btn-download-topography"
              onClick={(e) => {
                e.stopPropagation();
                const payload = {
                  datasetId: terrain.datasetId,
                  name: terrain.name,
                  resolution: terrain.resolution,
                  bbox: {
                    minLon: terrain.minLon,
                    minLat: terrain.minLat,
                    maxLon: terrain.maxLon,
                    maxLat: terrain.maxLat,
                  },
                  units: "metres above sea level",
                  topography: terrain.topography,
                };
                const blob = new Blob([JSON.stringify(payload)], {
                  type: "application/json",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${terrain.datasetId}-topography.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              style={{
                display: "block",
                marginTop: 4,
                background: "transparent",
                border: "1px solid rgba(245,158,11,0.5)",
                color: "#f59e0b",
                fontSize: 9,
                padding: "2px 8px",
                borderRadius: 3,
                cursor: "pointer",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              ↓ Download topography (JSON)
            </button>
          )}

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
