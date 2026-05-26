/**
 * GpsExportDialog — modal for exporting markers + trolling routes to GPX/KML.
 *
 * Opened from DatasetPanel's "Export GPS…" button. Lets the user pick a
 * format (GPX or KML) and downloads a single file containing the active
 * dataset's markers (as waypoints) plus all of the user's trolling presets
 * (as routes). Filename is `<dataset>-<YYYY-MM-DD>.<ext>`.
 *
 * Mirrors GpsImportDialog's visual + portal/scrim conventions so the entry
 * points feel symmetric.
 */
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  useGetMarkers,
  useGetTrollingPresets,
  getGetMarkersQueryKey,
  getGetTrollingPresetsQueryKey,
  type TerrainData,
} from "@workspace/api-client-react";
import {
  serializeGpx,
  serializeKml,
  buildExportFilename,
  downloadTextFile,
  mimeForFormat,
  type ExportFormat,
} from "@/lib/gpsExport";
import { useToast } from "@/hooks/use-toast";

interface Props {
  terrain: TerrainData;
  onClose: () => void;
}

export const GpsExportDialog: React.FC<Props> = ({ terrain, onClose }) => {
  const { toast } = useToast();
  const [format, setFormat] = useState<ExportFormat>("gpx");

  const { data: markers } = useGetMarkers(
    { datasetId: terrain.datasetId },
    {
      query: {
        enabled: !!terrain.datasetId,
        queryKey: getGetMarkersQueryKey({ datasetId: terrain.datasetId }),
      },
    },
  );
  const { data: presets } = useGetTrollingPresets({
    query: { queryKey: getGetTrollingPresetsQueryKey() },
  });

  const markerCount = markers?.length ?? 0;
  const presetCount = presets?.length ?? 0;
  const nothingToExport = markerCount === 0 && presetCount === 0;

  const exportData = useMemo(
    () => ({
      datasetName: terrain.name || "BathyScan",
      markers: (markers ?? []).map((m) => ({
        lon: m.lon,
        lat: m.lat,
        depth: m.depth,
        label: m.label,
        type: m.type,
        notes: m.notes ?? undefined,
      })),
      routes: (presets ?? [])
        .filter((p) => Array.isArray(p.waypoints) && p.waypoints.length >= 2)
        .map((p) => ({
          name: p.name,
          points: p.waypoints.map((w) => ({ lon: w.lon, lat: w.lat })),
        })),
    }),
    [markers, presets, terrain.name],
  );

  const handleDownload = () => {
    if (nothingToExport) return;
    const filename = buildExportFilename(exportData.datasetName, format);
    const content =
      format === "gpx" ? serializeGpx(exportData) : serializeKml(exportData);
    try {
      downloadTextFile(content, filename, mimeForFormat(format));
      toast({
        title: "GPS export ready",
        description: `Downloaded ${filename} (${markerCount} marker${
          markerCount === 1 ? "" : "s"
        }, ${exportData.routes.length} route${
          exportData.routes.length === 1 ? "" : "s"
        }).`,
      });
      onClose();
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const body = (
    <div
      data-testid="gps-export-dialog"
      role="dialog"
      aria-label="Export GPS data"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,8,24,0.7)",
        backdropFilter: "blur(4px)",
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#cbd5e1",
        fontSize: 11,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 460,
          maxWidth: "92vw",
          maxHeight: "86vh",
          overflow: "auto",
          background: "rgba(2,8,24,0.96)",
          border: "1px solid rgba(0,229,255,0.3)",
          borderRadius: 8,
          boxShadow: "0 12px 48px rgba(0,0,0,0.7)",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid rgba(0,229,255,0.15)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              color: "#00e5ff",
              letterSpacing: "0.18em",
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            ▲ EXPORT GPS
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "#475569",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 14 }}>
          <p style={{ margin: "0 0 10px", color: "#94a3b8", lineHeight: 1.5 }}>
            Download this dataset's markers and your trolling routes as a
            single <strong style={{ color: "#cbd5e1" }}>.gpx</strong> or{" "}
            <strong style={{ color: "#cbd5e1" }}>.kml</strong> file. Import it
            into your chartplotter, Garmin, or Navionics tools.
          </p>

          <div
            data-testid="gps-export-summary"
            style={{
              padding: "10px 12px",
              background: "rgba(0,229,255,0.04)",
              border: "1px solid rgba(0,229,255,0.15)",
              borderRadius: 4,
              marginBottom: 12,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              fontSize: 10,
            }}
          >
            <div>
              <div style={{ color: "#64748b" }}>Markers</div>
              <div
                style={{ color: "#cbd5e1", fontSize: 13 }}
                data-testid="gps-export-marker-count"
              >
                {markerCount}
              </div>
            </div>
            <div>
              <div style={{ color: "#64748b" }}>Trolling routes</div>
              <div
                style={{ color: "#cbd5e1", fontSize: 13 }}
                data-testid="gps-export-route-count"
              >
                {exportData.routes.length}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 9,
                color: "#64748b",
                marginBottom: 4,
                letterSpacing: "0.12em",
              }}
            >
              FORMAT
            </div>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              data-testid="gps-export-format"
              style={{
                width: "100%",
                padding: "5px 6px",
                background: "rgba(2,8,24,0.6)",
                border: "1px solid rgba(0,229,255,0.2)",
                borderRadius: 3,
                color: "#cbd5e1",
                fontFamily: "inherit",
                fontSize: 11,
              }}
            >
              <option value="gpx">GPX (chartplotters, Garmin)</option>
              <option value="kml">KML (Google Earth, Navionics)</option>
            </select>
          </div>

          {nothingToExport && (
            <div
              style={{
                padding: "8px 10px",
                background: "rgba(251,191,36,0.08)",
                border: "1px solid rgba(251,191,36,0.3)",
                borderRadius: 4,
                color: "#fbbf24",
                marginBottom: 12,
                fontSize: 10,
              }}
            >
              No markers or trolling routes to export yet.
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 8,
            }}
          >
            <button onClick={onClose} style={btnStyle("ghost")}>
              Cancel
            </button>
            <button
              onClick={handleDownload}
              data-testid="gps-export-confirm"
              disabled={nothingToExport}
              style={{
                ...btnStyle("primary"),
                opacity: nothingToExport ? 0.5 : 1,
                cursor: nothingToExport ? "not-allowed" : "pointer",
              }}
            >
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
};

function btnStyle(variant: "primary" | "ghost"): React.CSSProperties {
  if (variant === "primary") {
    return {
      padding: "6px 14px",
      background: "rgba(0,229,255,0.15)",
      border: "1px solid rgba(0,229,255,0.4)",
      borderRadius: 3,
      color: "#00e5ff",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 11,
      letterSpacing: "0.1em",
    };
  }
  return {
    padding: "6px 14px",
    background: "transparent",
    border: "1px solid rgba(148,163,184,0.3)",
    borderRadius: 3,
    color: "#94a3b8",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 11,
    letterSpacing: "0.1em",
  };
}
