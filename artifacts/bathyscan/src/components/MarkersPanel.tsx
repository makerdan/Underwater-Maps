/**
 * MarkersPanel — dedicated panel for browsing and importing GPS markers.
 *
 * Opened via the MARKERS ToggleButton in OverlaysToolsPanel. Shows:
 *   • All markers for the currently-active dataset (when terrain is loaded)
 *   • Unassigned (dataset-free) markers for the authenticated user when no
 *     dataset is active
 *
 * Allows importing GPS files via GpsImportDialog in dataset-free mode.
 */
import React, { useState } from "react";
import { useGetMarkers, getGetMarkersQueryKey } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { GpsImportDialog } from "@/components/GpsImportDialog";

const PANEL_WIDTH = 300;

interface MarkerRowProps {
  id: string;
  label: string;
  lat: number;
  lon: number;
  depth: number;
  type: string;
}

const MarkerRow: React.FC<MarkerRowProps> = ({ label, lat, lon, depth, type }) => (
  <div
    style={{
      padding: "8px 10px",
      borderBottom: "1px solid rgba(148,163,184,0.08)",
      display: "flex",
      flexDirection: "column",
      gap: 2,
    }}
  >
    <div style={{ color: "#e2e8f0", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {label}
    </div>
    <div style={{ color: "#64748b", fontSize: 12.5, letterSpacing: "0.04em" }}>
      {type} &bull; {lat.toFixed(4)}, {lon.toFixed(4)} &bull; {depth.toFixed(1)} m
    </div>
  </div>
);

export const MarkersPanel: React.FC = () => {
  const { terrain } = useAppState();
  const setMarkersPanelOpen = useUiStore((s) => s.setMarkersPanelOpen);
  const [gpsImportOpen, setGpsImportOpen] = useState(false);

  const hasDataset = !!terrain?.datasetId;

  const queryParams = hasDataset
    ? { datasetId: terrain!.datasetId }
    : { minLat: -90, minLon: -180, maxLat: 90, maxLon: 180 };

  // Query: dataset markers or unassigned markers.
  const { data: markers, isLoading, isError, refetch } = useGetMarkers(
    queryParams,
    {
      query: {
        enabled: true,
        queryKey: getGetMarkersQueryKey(queryParams),
      },
    },
  );

  return (
    <>
      <div
        data-testid="markers-panel"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: PANEL_WIDTH,
          height: "100%",
          background: "rgba(2,8,24,0.96)",
          borderLeft: "1px solid rgba(0,229,255,0.18)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          zIndex: 300,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid rgba(0,229,255,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              color: "#00e5ff",
              letterSpacing: "0.18em",
              fontWeight: 700,
              fontSize: 13.5,
            }}
          >
            📍 MARKERS
          </span>
          <button
            onClick={() => setMarkersPanelOpen(false)}
            aria-label="Close markers panel"
            data-testid="markers-panel-close"
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              fontSize: 20,
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            ×
          </button>
        </div>

        {/* Sub-header: context label */}
        <div
          style={{
            padding: "6px 12px",
            fontSize: 12.5,
            color: "#64748b",
            letterSpacing: "0.06em",
            borderBottom: "1px solid rgba(148,163,184,0.08)",
            flexShrink: 0,
          }}
        >
          {hasDataset ? `Dataset: ${terrain!.datasetId}` : "Unassigned markers (no active dataset)"}
        </div>

        {/* Marker list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {isLoading && (
            <div
              data-testid="markers-panel-loading"
              style={{ padding: "20px 12px", color: "#64748b", textAlign: "center", fontSize: 13.5 }}
            >
              Loading markers…
            </div>
          )}

          {isError && (
            <div style={{ padding: "16px 12px" }}>
              <div
                style={{
                  color: "#f87171",
                  fontSize: 13.5,
                  marginBottom: 10,
                  padding: "8px 10px",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  borderRadius: 4,
                }}
              >
                Failed to load markers.
              </div>
              <button
                onClick={() => void refetch()}
                data-testid="markers-panel-retry"
                style={{
                  padding: "5px 12px",
                  background: "transparent",
                  border: "1px solid rgba(148,163,184,0.3)",
                  borderRadius: 3,
                  color: "#e2e8f0",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 13.5,
                }}
              >
                Retry
              </button>
            </div>
          )}

          {!isLoading && !isError && markers !== undefined && markers.length === 0 && (
            <div
              data-testid="markers-panel-empty"
              style={{
                padding: "20px 12px",
                color: "#64748b",
                textAlign: "center",
                fontSize: 13.5,
                lineHeight: 1.6,
              }}
            >
              No markers yet.
              <br />
              Import a GPS file below.
            </div>
          )}

          {!isLoading && !isError && markers && markers.length > 0 && (
            <div data-testid="markers-panel-list">
              {markers.map((m) => (
                <MarkerRow
                  key={m.id}
                  id={m.id}
                  label={m.label}
                  lat={m.lat}
                  lon={m.lon}
                  depth={m.depth}
                  type={m.type}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer: Import GPS */}
        <div
          style={{
            padding: "10px 12px",
            borderTop: "1px solid rgba(0,229,255,0.12)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setGpsImportOpen(true)}
            data-testid="markers-panel-import-gps"
            style={{
              width: "100%",
              padding: "7px 0",
              background: "rgba(0,229,255,0.08)",
              border: "1px solid rgba(0,229,255,0.3)",
              borderRadius: 4,
              color: "#00e5ff",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13.5,
              letterSpacing: "0.1em",
            }}
          >
            ▼ IMPORT GPS…
          </button>
        </div>
      </div>

      {gpsImportOpen && (
        <GpsImportDialog
          terrain={terrain ?? undefined}
          onClose={() => setGpsImportOpen(false)}
        />
      )}
    </>
  );
};
