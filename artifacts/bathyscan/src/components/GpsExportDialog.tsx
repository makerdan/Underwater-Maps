/**
 * GpsExportDialog — modal for exporting markers, trolling routes, and
 * recorded GPS trails to GPX/KML.
 *
 * Opened from DatasetPanel's "Export GPS…" button. Lets the user pick a
 * format (GPX or KML) and downloads a single file containing the active
 * dataset's markers (as waypoints), all of the user's trolling presets
 * (as routes), plus any recorded trails the user ticks in the Recorded
 * Trails section (as GPX <trk> tracks). Filename is `<dataset>-<YYYY-MM-DD>.<ext>`.
 *
 * Mirrors GpsImportDialog's visual + portal/scrim conventions so the entry
 * points feel symmetric.
 */
import React, { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import {
  useGetMarkers,
  useGetTrollingPresets,
  useGetCatches,
  useGetTrails,
  getGetMarkersQueryKey,
  getGetTrollingPresetsQueryKey,
  getGetCatchesQueryKey,
  getGetTrailsQueryKey,
  getTrailsIdPoints,
  type TerrainData,
} from "@workspace/api-client-react";
import {
  serializeAsync,
  buildExportFilename,
  downloadTextFile,
  mimeForFormat,
  type ExportFormat,
  type ExportTrail,
  type ExportTrailPoint,
} from "@/lib/gpsExport";
import { useToast } from "@/hooks/use-toast";

interface Props {
  terrain: TerrainData;
  onClose: () => void;
}

/** Page size for trail point retrieval — the server-side maximum. */
const TRAIL_POINTS_PAGE_SIZE = 1000;
/** Hard cap on pages fetched per trail (server caps trails at 50k points). */
const TRAIL_POINTS_MAX_PAGES = 100;

/**
 * Fetch every point of a trail, paging through GET /api/trails/:id/points
 * until `total` is reached.
 */
async function fetchAllTrailPoints(trailId: string): Promise<ExportTrailPoint[]> {
  const points: ExportTrailPoint[] = [];
  for (let page = 1; page <= TRAIL_POINTS_MAX_PAGES; page++) {
    const res = await getTrailsIdPoints(trailId, {
      page,
      pageSize: TRAIL_POINTS_PAGE_SIZE,
    });
    for (const p of res.points) {
      points.push({ lon: p.lon, lat: p.lat, timestamp: p.timestamp });
    }
    if (res.points.length === 0 || points.length >= res.total) break;
  }
  return points;
}

export const GpsExportDialog: React.FC<Props> = ({ terrain, onClose }) => {
  const { toast } = useToast();
  const [format, setFormat] = useState<ExportFormat>("gpx");
  const [isSerializing, setIsSerializing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  const {
    data: markers,
    isLoading: markersLoading,
    isError: markersError,
    refetch: markersRefetch,
  } = useGetMarkers(
    { datasetId: terrain.datasetId },
    {
      query: {
        enabled: !!terrain.datasetId,
        queryKey: getGetMarkersQueryKey({ datasetId: terrain.datasetId }),
      },
    },
  );
  const {
    data: presets,
    isLoading: presetsLoading,
    isError: presetsError,
    refetch: presetsRefetch,
  } = useGetTrollingPresets({
    query: { queryKey: getGetTrollingPresetsQueryKey() },
  });
  const {
    data: catches,
    isLoading: catchesLoading,
    isError: catchesError,
    refetch: catchesRefetch,
  } = useGetCatches(
    { datasetId: terrain.datasetId },
    {
      query: {
        enabled: !!terrain.datasetId,
        queryKey: getGetCatchesQueryKey({ datasetId: terrain.datasetId }),
      },
    },
  );
  const {
    data: trails,
    isLoading: trailsLoading,
    isError: trailsError,
    refetch: trailsRefetch,
  } = useGetTrails(
    { datasetId: terrain.datasetId },
    {
      query: {
        enabled: !!terrain.datasetId,
        queryKey: getGetTrailsQueryKey({ datasetId: terrain.datasetId }),
      },
    },
  );

  const [selectedTrailIds, setSelectedTrailIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleTrail = (id: string) => {
    setSelectedTrailIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isLoading = markersLoading || presetsLoading || catchesLoading || trailsLoading;
  const isError = !isLoading && (markersError || presetsError || catchesError || trailsError);
  const isSuccess = !isLoading && !isError;

  const handleRetry = () => {
    void markersRefetch();
    void presetsRefetch();
    void catchesRefetch();
    void trailsRefetch();
  };

  const markerCount = markers?.length ?? 0;
  const presetCount = presets?.length ?? 0;
  const trailCount = trails?.length ?? 0;
  // Only trails still present in the fetched list count as selected — a
  // refetch may have dropped (deleted/retention-purged) a previously ticked id.
  const selectedTrails = (trails ?? []).filter((t) => selectedTrailIds.has(t.id));
  const nothingToExport =
    isSuccess && markerCount === 0 && presetCount === 0 && trailCount === 0;

  const exportData = useMemo(
    () => {
      // Catch symbols per marker, one per entry, insertion order preserved.
      const symbolsByMarker = new Map<string, string[]>();
      for (const c of catches ?? []) {
        const list = symbolsByMarker.get(c.markerId) ?? [];
        list.push(c.symbol);
        if (!symbolsByMarker.has(c.markerId)) symbolsByMarker.set(c.markerId, list);
      }
      return {
      datasetName: terrain.name || "BathyScan",
      markers: (markers ?? []).map((m) => ({
        lon: m.lon,
        lat: m.lat,
        depth: m.depth,
        label: m.label,
        type: m.type,
        notes: m.notes ?? undefined,
        catchSymbols: symbolsByMarker.get(m.id),
      })),
      routes: (presets ?? [])
        .filter((p) => Array.isArray(p.waypoints) && p.waypoints.length >= 2)
        .map((p) => ({
          name: p.name,
          points: p.waypoints.map((w) => ({ lon: w.lon, lat: w.lat })),
        })),
      };
    },
    [markers, presets, catches, terrain.name],
  );

  // Nothing would end up in the file when there are no markers, no routes,
  // and no ticked trails — trails only export when explicitly selected.
  const nothingSelected =
    markerCount === 0 &&
    exportData.routes.length === 0 &&
    selectedTrails.length === 0;

  const handleDownload = () => {
    if (nothingSelected || !isSuccess || isSerializing) return;
    const filename = buildExportFilename(exportData.datasetName, format);
    setIsSerializing(true);
    (async () => {
      // Fetch full point lists for the ticked trails before serializing.
      const exportTrails: ExportTrail[] = [];
      for (const t of selectedTrails) {
        const points = await fetchAllTrailPoints(t.id);
        exportTrails.push({ id: t.id, name: t.name, colour: t.colour, points });
      }
      const content = await serializeAsync(
        { ...exportData, trails: exportTrails },
        format,
      );
      downloadTextFile(content, filename, mimeForFormat(format));
      toast({
        title: "GPS export ready",
        description: `Downloaded ${filename} (${markerCount} marker${
          markerCount === 1 ? "" : "s"
        }, ${exportData.routes.length} route${
          exportData.routes.length === 1 ? "" : "s"
        }, ${exportTrails.length} trail${
          exportTrails.length === 1 ? "" : "s"
        }).`,
      });
      onClose();
    })()
      .catch((err: unknown) => {
        toast({
          title: "Export failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      })
      .finally(() => {
        setIsSerializing(false);
      });
  };

  const body = (
    <div
      data-testid="gps-export-dialog"
      role="dialog"
      aria-modal="true"
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
        fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        style={{
          width: 460,
          maxWidth: "calc(100vw - 32px)",
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
              fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
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
              color: "#94a3b8",
              fontSize: "calc(24px * var(--bs-font-scale, 1))",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 14 }}>
          <p style={{ margin: "0 0 10px", color: "#e2e8f0", lineHeight: 1.5 }}>
            Download this dataset's markers, your trolling routes, and any
            recorded trails you select as a single{" "}
            <strong style={{ color: "#cbd5e1" }}>.gpx</strong> or{" "}
            <strong style={{ color: "#cbd5e1" }}>.kml</strong> file. Import it
            into your chartplotter, Garmin, or Navionics tools.
          </p>

          {isLoading && (
            <div
              data-testid="gps-export-loading"
              style={{
                padding: "10px 12px",
                background: "rgba(0,229,255,0.04)",
                border: "1px solid rgba(0,229,255,0.15)",
                borderRadius: 4,
                marginBottom: 12,
                color: "#94a3b8",
                fontSize: "calc(15px * var(--bs-font-scale, 1))",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span aria-hidden="true" style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
              Loading…
            </div>
          )}
          {isError && (
            <div
              data-testid="gps-export-error"
              style={{
                padding: "10px 12px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 4,
                marginBottom: 12,
                color: "#f87171",
                fontSize: "calc(15px * var(--bs-font-scale, 1))",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>Failed to load — </span>
              <button
                onClick={handleRetry}
                data-testid="gps-export-retry"
                style={{
                  background: "none",
                  border: "1px solid rgba(239,68,68,0.4)",
                  borderRadius: 3,
                  color: "#f87171",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "calc(14px * var(--bs-font-scale, 1))",
                  padding: "2px 8px",
                }}
              >
                Retry
              </button>
            </div>
          )}
          {isSuccess && (
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
              fontSize: "calc(15px * var(--bs-font-scale, 1))",
            }}
          >
            <div>
              <div style={{ color: "#cbd5e1" }}>Markers</div>
              <div
                style={{ color: "#cbd5e1", fontSize: "calc(19.5px * var(--bs-font-scale, 1))" }}
                data-testid="gps-export-marker-count"
              >
                {markerCount}
              </div>
            </div>
            <div>
              <div style={{ color: "#cbd5e1" }}>Trolling routes</div>
              <div
                style={{ color: "#cbd5e1", fontSize: "calc(19.5px * var(--bs-font-scale, 1))" }}
                data-testid="gps-export-route-count"
              >
                {exportData.routes.length}
              </div>
            </div>
            <div>
              <div style={{ color: "#cbd5e1" }}>Trails selected</div>
              <div
                style={{ color: "#cbd5e1", fontSize: "calc(19.5px * var(--bs-font-scale, 1))" }}
                data-testid="gps-export-trail-count"
              >
                {selectedTrails.length}/{trailCount}
              </div>
            </div>
          </div>
          )}

          {isSuccess && (
            <div style={{ marginBottom: 12 }} data-testid="gps-export-trails-section">
              <div
                style={{
                  fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                  color: "#cbd5e1",
                  marginBottom: 4,
                  letterSpacing: "0.12em",
                }}
              >
                RECORDED TRAILS
              </div>
              {trailCount === 0 ? (
                <div
                  data-testid="gps-export-trails-empty"
                  style={{
                    padding: "8px 10px",
                    background: "rgba(148,163,184,0.06)",
                    border: "1px solid rgba(148,163,184,0.2)",
                    borderRadius: 4,
                    color: "#94a3b8",
                    fontSize: "calc(14px * var(--bs-font-scale, 1))",
                  }}
                >
                  No recorded trails for this dataset yet. Record one with the
                  GPS Trail recorder, then export it here.
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    maxHeight: 160,
                    overflow: "auto",
                    border: "1px solid rgba(0,229,255,0.15)",
                    borderRadius: 4,
                    padding: "4px 6px",
                    background: "rgba(0,229,255,0.03)",
                  }}
                >
                  {(trails ?? []).map((t) => (
                    <label
                      key={t.id}
                      data-testid={`gps-export-trail-${t.id}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: "pointer",
                        padding: "3px 2px",
                        fontSize: "calc(14px * var(--bs-font-scale, 1))",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTrailIds.has(t.id)}
                        onChange={() => toggleTrail(t.id)}
                        data-testid={`gps-export-trail-checkbox-${t.id}`}
                        style={{ accentColor: "#00e5ff", cursor: "pointer" }}
                      />
                      <span
                        aria-hidden="true"
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: t.colour,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          color: "#e2e8f0",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.name}
                      </span>
                      <span style={{ color: "#94a3b8", flexShrink: 0 }}>
                        {t.pointCount.toLocaleString()} pts ·{" "}
                        {new Date(t.startedAt).toLocaleDateString()}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                color: "#cbd5e1",
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
                fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
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
                fontSize: "calc(15px * var(--bs-font-scale, 1))",
              }}
            >
              No markers, trolling routes, or recorded trails to export yet.
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
              disabled={!isSuccess || nothingSelected || isSerializing}
              aria-busy={isSerializing}
              style={{
                ...btnStyle("primary"),
                opacity: (!isSuccess || nothingSelected || isSerializing) ? 0.5 : 1,
                cursor: (!isSuccess || nothingSelected || isSerializing) ? "not-allowed" : "pointer",
              }}
            >
              {isSerializing ? "Downloading…" : "Download"}
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
      fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
      letterSpacing: "0.1em",
    };
  }
  return {
    padding: "6px 14px",
    background: "transparent",
    border: "1px solid rgba(148,163,184,0.3)",
    borderRadius: 3,
    color: "#e2e8f0",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
    letterSpacing: "0.1em",
  };
}
