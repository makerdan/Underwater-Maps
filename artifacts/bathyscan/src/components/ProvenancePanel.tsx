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
import { triggerBlobDownload } from "@/lib/blobDownload";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { useClassificationStore } from "@/lib/classificationStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useLandTerrainStore } from "@/lib/landTerrainStore";
import { HelpIcon } from "@/components/help/HelpButton";
import { formatFreshness } from "@/lib/freshnessUtils";

interface ProvenancePanelProps {
  terrain: TerrainData;
  hasEfh?: boolean;
  /** ISO 8601 creation date of the catalog entry for the loaded dataset. */
  catalogSourcedAt?: string | null;
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
    creditUrl: "https://www.gebco.net/data-products/gridded-bathymetry-data",
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
  catalogSourcedAt,
}) => {
  const [expanded, setExpanded] = useState(false);
  const zoneSource = useClassificationStore((s) => s.source);
  const substrateFp = useClassificationStore((s) => s.currentSubstrateFp);
  const substrateGrounded = !!substrateFp && substrateFp !== "00000000";

  const terrainExaggeration = useSettingsStore((s) => s.terrainExaggeration);
  const contourInterval = useSettingsStore((s) => s.contourInterval);
  const contoursEnabled = useSettingsStore((s) => s.contoursEnabled);
  const units = useSettingsStore((s) => s.units);
  const intervalUnit =
    units === "metric" ? "m" : units === "nautical" ? "fm" : "ft";

  const landGridLoaded = useLandTerrainStore((s) => s.landGrid !== null);
  const showCopernicusBadge = terrain.hasTopography || landGridLoaded;

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
          flexWrap: "wrap",
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
            fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              color: "#10b981",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Essential Fish Habitat
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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

        {showCopernicusBadge && (
          <ViewscreenTooltip
            label="Land elevation: Copernicus DEM GLO-90 (CC-BY 4.0) — 90 m global land surface model"
            side="top"
          >
            <a
              data-testid="copernicus-dem-badge"
              href="https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                background: "rgba(52,211,153,0.10)",
                border: "1px solid rgba(52,211,153,0.38)",
                borderRadius: 3,
                padding: "1px 6px",
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                color: "#34d399",
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                textDecoration: "none",
                cursor: "pointer",
              }}
            >
              Land: Copernicus DEM 90 m (CC-BY)
            </a>
          </ViewscreenTooltip>
        )}

        <span
          style={{
            marginLeft: "auto",
            color: "#4b5563",
            fontSize: "calc(27px * var(--bs-font-scale, 1))",
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
            fontSize: "calc(15px * var(--bs-font-scale, 1))",
            color: "#e2e8f0",
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
            <HelpIcon articleId="data-provenance" label="Data provenance" />
          </div>
          <p style={{ margin: "0 0 4px" }}>{src.description}</p>

          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px" }}>
            <span style={{ color: "#cbd5e1" }}>Resolution:</span>
            <span>
              {terrain.resolution}×{terrain.resolution} ({terrain.resolution ** 2} cells)
            </span>

            <span style={{ color: "#cbd5e1" }}>Depth range:</span>
            <span>
              {terrain.minDepth} – {terrain.maxDepth} m
            </span>

            <span style={{ color: "#cbd5e1" }}>Extent:</span>
            <span>
              {Math.abs(terrain.maxLon - terrain.minLon).toFixed(2)}° ×{" "}
              {Math.abs(terrain.maxLat - terrain.minLat).toFixed(2)}°
            </span>

            <span style={{ color: "#cbd5e1" }}>Vertical exaggeration:</span>
            <span data-testid="provenance-exaggeration">
              {terrainExaggeration % 1 === 0
                ? terrainExaggeration.toFixed(0)
                : terrainExaggeration.toFixed(1)}
              × {terrainExaggeration > 1 ? "(exaggerated — not true-to-life)" : "(true-to-life)"}
            </span>

            <span style={{ color: "#cbd5e1" }}>Contour interval:</span>
            <span data-testid="provenance-contour-interval">
              {contoursEnabled
                ? `${contourInterval % 1 === 0 ? contourInterval.toFixed(0) : contourInterval.toFixed(1)} ${intervalUnit}`
                : "Contours off"}
            </span>

            {zoneSource && (
              <>
                <span style={{ color: "#cbd5e1" }}>Zones:</span>
                <span style={{ color: zoneSource === "ai" ? "#cbd5e1" : "#fbbf24" }}>
                  {zoneSource === "ai"
                    ? "AI-classified from depth grid"
                    : "Estimated from depth (AI unavailable)"}
                </span>
              </>
            )}
            {formatFreshness(catalogSourcedAt) && (
              <>
                <span style={{ color: "#cbd5e1" }}>Sourced:</span>
                <span>{formatFreshness(catalogSourcedAt)}</span>
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
                triggerBlobDownload(blob, `${terrain.datasetId}-topography.json`);
              }}
              style={{
                display: "block",
                marginTop: 4,
                background: "transparent",
                border: "1px solid rgba(245,158,11,0.5)",
                color: "#f59e0b",
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
