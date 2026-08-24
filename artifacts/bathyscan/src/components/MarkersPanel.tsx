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
import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGetMarkers, getGetMarkersQueryKey, type Marker } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { ReassignMarkersDialog } from "@/components/ReassignMarkersDialog";
import { OVERLAY_Z } from "@/lib/overlayScale";
import { MARKER_COLOR } from "@/lib/markerConstants";
import { MarkerIcon } from "@/lib/markerIcons";
import { useMarkerDetailStore } from "@/lib/markerDetailStore";

const GpsImportDialog = React.lazy(() =>
  import("@/components/GpsImportDialog").then(({ GpsImportDialog: Dialog }) => ({
    default: Dialog,
  })),
);

const PANEL_WIDTH = 300;

// MarkerRow measured height: 8px top + 8px bottom padding, ~19px label line,
// 2px gap, ~17px sublabel line = ~54px. Use 56 as estimateSize.
const MARKER_ROW_HEIGHT = 56;

interface MarkerRowProps {
  marker: Marker;
}

const MarkerRow: React.FC<MarkerRowProps> = ({ marker }) => {
  const showDetails = useMarkerDetailStore((s) => s.show);
  const drift = marker.geometry?.kind === "drift" ? marker.geometry : null;
  return (
  <div
    data-testid={`marker-row-item`}
    role="button"
    tabIndex={0}
    onClick={() => showDetails(marker)}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") showDetails(marker); }}
    style={{
      padding: "8px 10px",
      borderBottom: "1px solid rgba(148,163,184,0.08)",
      display: "flex",
      flexDirection: "column",
      gap: 2,
    }}
  >
      <div style={{ color: "#e2e8f0", fontSize: "calc(14px * var(--bs-font-scale, 1))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
        <MarkerIcon type={marker.type} size={15} color={MARKER_COLOR[marker.type] ?? "#e2e8f0"} />
      {marker.label}
    </div>
    <div style={{ color: "#64748b", fontSize: "calc(12.5px * var(--bs-font-scale, 1))", letterSpacing: "0.04em" }}>
       {drift ? `SAVED DRIFT · ${Math.round(drift.summary.durationS / 3600)} h · ${Math.round(drift.summary.distanceM)} m` : `${marker.type} · ${marker.lat.toFixed(4)}, ${marker.lon.toFixed(4)} · ${marker.depth.toFixed(1)} m`}
       {marker.expiresAt && <span style={{ color: "#fbbf24" }}> · TEMPORARY · expires {new Date(marker.expiresAt).toLocaleDateString()}</span>}
    </div>
  </div>
  );
};

/** Inner component that holds the virtualizer — extracted so that the ref is
 *  always bound to the scroll element before the virtualizer is created. */
interface MarkerListProps {
  markers: Marker[];
}

const MarkerList: React.FC<MarkerListProps> = ({ markers }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: markers.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => MARKER_ROW_HEIGHT,
    overscan: 5,
    measureElement:
      typeof window !== "undefined" && navigator.userAgent.indexOf("Firefox") === -1
        ? (element) => element.getBoundingClientRect().height
        : undefined,
  });

  return (
    <div
      ref={scrollRef}
      data-testid="markers-panel-list"
      style={{ flex: 1, overflowY: "auto" }}
    >
      <div
        data-testid="markers-virtual-container"
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const m = markers[virtualItem.index];
          if (!m) return null;
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              data-testid={`marker-row-${virtualItem.index}`}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
                boxSizing: "border-box",
              }}
            >
              <MarkerRow
                marker={m}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const MarkersPanel: React.FC = () => {
  const { terrain } = useAppState();
  const setMarkersPanelOpen = useUiStore((s) => s.setMarkersPanelOpen);
  const [gpsImportOpen, setGpsImportOpen] = React.useState(false);
  const [reassignOpen, setReassignOpen] = React.useState(false);

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
           zIndex: OVERLAY_Z.drawer,
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
              fontSize: "calc(20px * var(--bs-font-scale, 1))",
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
            fontSize: "calc(12.5px * var(--bs-font-scale, 1))",
            color: "#64748b",
            letterSpacing: "0.06em",
            borderBottom: "1px solid rgba(148,163,184,0.08)",
            flexShrink: 0,
          }}
        >
          {hasDataset ? `Dataset: ${terrain!.datasetId}` : "Unassigned markers (no active dataset)"}
        </div>

        {/* Marker list area */}
        {isLoading && (
          <div
            data-testid="markers-panel-loading"
            style={{ padding: "20px 12px", color: "#64748b", textAlign: "center", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", flex: 1 }}
          >
            Loading markers…
          </div>
        )}

        {isError && (
          <div style={{ padding: "16px 12px", flex: 1 }}>
            <div
              style={{
                color: "#f87171",
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              lineHeight: 1.6,
              flex: 1,
            }}
          >
            No markers yet.
            <br />
            Import a GPS file below.
          </div>
        )}

        {!isLoading && !isError && markers && markers.length > 0 && (
          <MarkerList markers={markers} />
        )}

        {/* Footer: Import GPS + Reassign */}
        <div
          style={{
            padding: "10px 12px",
            borderTop: "1px solid rgba(0,229,255,0.12)",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.1em",
            }}
          >
            ▼ IMPORT GPS…
          </button>
          {!hasDataset && (
            <button
              onClick={() => setReassignOpen(true)}
              data-testid="markers-panel-reassign"
              style={{
                width: "100%",
                padding: "7px 0",
                background: "rgba(0,229,255,0.05)",
                border: "1px solid rgba(0,229,255,0.2)",
                borderRadius: 4,
                color: "#67e8f9",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                letterSpacing: "0.1em",
              }}
            >
              ↗ REASSIGN TO DATASET…
            </button>
          )}
        </div>
      </div>

      {gpsImportOpen && (
        <React.Suspense fallback={null}>
          <GpsImportDialog
            terrain={terrain ?? undefined}
            onClose={() => setGpsImportOpen(false)}
          />
        </React.Suspense>
      )}
      {reassignOpen && (
        <ReassignMarkersDialog onClose={() => setReassignOpen(false)} />
      )}
    </>
  );
};
