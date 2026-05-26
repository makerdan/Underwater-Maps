/**
 * GpsImportDialog — modal for importing GPS waypoints and trolling routes.
 *
 * Opened from DatasetPanel's "Import GPS…" button. Lets the user pick a
 * .gpx/.kml/.kmz/.csv file, previews how many points fall inside the active
 * dataset's bounding box, lets them pick a marker type and/or a trolling
 * preset name, and on confirm calls POST /api/markers per waypoint and
 * POST /api/trolling-presets per route.
 *
 * Hard limits:
 *   • MAX_IMPORT_POINTS (5000) total points per file (enforced in parseGpsFile)
 *   • TROLLING_PRESET_WAYPOINTS_MAX (50) per preset — longer routes are
 *     downsampled with a clear notice.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePostMarkers,
  usePostTrollingPresets,
  getGetMarkersQueryKey,
  getGetTrollingPresetsQueryKey,
  MarkerInputType,
  type TerrainData,
} from "@workspace/api-client-react";
import {
  parseGpsFile,
  partitionByBounds,
  countPoints,
  isInBounds,
  type ParseResult,
  type ParsedRoute,
} from "@/lib/gpsImport";
import {
  SALTWATER_MARKER_TYPES,
  FRESHWATER_MARKER_TYPES,
  type MarkerTypeValue,
} from "@/lib/markerConstants";
import { useSettingsStore } from "@/lib/settingsStore";
import { useToast } from "@/hooks/use-toast";

const TROLLING_PRESET_WAYPOINTS_MAX = 50;
const MARKER_LABEL_MAX = 60;
const MARKER_NOTES_MAX = 500;
const TROLLING_NAME_MAX = 80;

interface Props {
  terrain: TerrainData;
  onClose: () => void;
}

type Phase =
  | { kind: "pick" }
  | { kind: "parsing"; fileName: string }
  | {
      kind: "preview";
      fileName: string;
      parsed: ParseResult;
      insideCount: number;
      outsideWp: number;
      outsideRoutes: number;
      outsideRoutePoints: number;
    }
  | { kind: "importing" }
  | { kind: "error"; message: string };

/** Evenly downsample a polyline to at most `max` points, always keeping endpoints. */
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]!);
  return out;
}

function clamp(s: string | undefined, n: number): string {
  if (!s) return "";
  const t = s.trim();
  return t.length > n ? t.slice(0, n) : t;
}

/** Strip ASCII control chars that markerFormSchema rejects. */
function sanitize(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export const GpsImportDialog: React.FC<Props> = ({ terrain, onClose }) => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const postMarkers = usePostMarkers();
  const postTrollingPresets = usePostTrollingPresets();

  const settingsWaterType = useSettingsStore((s) => s.waterType);
  const defaultMarkerType = useSettingsStore((s) => s.defaultMarkerType);
  const waterType =
    (terrain.waterType as "saltwater" | "freshwater" | undefined) ?? settingsWaterType;
  const markerTypes = waterType === "freshwater" ? FRESHWATER_MARKER_TYPES : SALTWATER_MARKER_TYPES;

  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [markerType, setMarkerType] = useState<MarkerTypeValue>(
    (defaultMarkerType as MarkerTypeValue) ?? MarkerInputType.custom,
  );
  const [importWaypoints, setImportWaypoints] = useState(true);
  const [importRoutes, setImportRoutes] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bounds = useMemo(
    () => ({
      minLon: terrain.minLon,
      minLat: terrain.minLat,
      maxLon: terrain.maxLon,
      maxLat: terrain.maxLat,
    }),
    [terrain.minLon, terrain.minLat, terrain.maxLon, terrain.maxLat],
  );

  const onFileChosen = useCallback(
    async (file: File) => {
      setPhase({ kind: "parsing", fileName: file.name });
      try {
        const result = await parseGpsFile(file);
        const part = partitionByBounds(result, bounds);
        setPhase({
          kind: "preview",
          fileName: file.name,
          parsed: part.inside,
          insideCount: countPoints(part.inside),
          outsideWp: part.outsideWaypoints,
          outsideRoutes: part.outsideRoutes,
          outsideRoutePoints: part.outsideRoutePoints,
        });
        // Default checkboxes to whichever the file actually contains.
        setImportWaypoints(part.inside.waypoints.length > 0);
        setImportRoutes(part.inside.routes.length > 0);
      } catch (err) {
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to parse file",
        });
      }
    },
    [bounds],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void onFileChosen(f);
    // Reset so the same file can be re-picked after an error.
    e.target.value = "";
  };

  const doImport = useCallback(async () => {
    if (phase.kind !== "preview") return;
    const { parsed } = phase;
    const wpToImport = importWaypoints ? parsed.waypoints : [];
    const routesToImport: ParsedRoute[] = importRoutes ? parsed.routes : [];

    setPhase({ kind: "importing" });

    let markersOk = 0;
    let markersFail = 0;
    for (const w of wpToImport) {
      const label = sanitize(clamp(w.name || "Imported point", MARKER_LABEL_MAX)) || "Imported point";
      const notes = w.notes ? sanitize(clamp(w.notes, MARKER_NOTES_MAX)) : null;
      // Depth: prefer parsed depth; fall back to 0 (surface) when unknown.
      const depth = Number.isFinite(w.depth) ? (w.depth as number) : 0;
      try {
        await postMarkers.mutateAsync({
          data: {
            datasetId: terrain.datasetId,
            lon: w.lon,
            lat: w.lat,
            depth,
            type: markerType as MarkerInputType,
            label,
            notes: notes && notes.length > 0 ? notes : null,
          },
        });
        markersOk++;
      } catch {
        markersFail++;
      }
    }

    let presetsOk = 0;
    let presetsFail = 0;
    let downsampled = 0;
    for (const r of routesToImport) {
      // `routesToImport` already comes from partitionByBounds which trims
      // out-of-bounds points and drops routes with <2 surviving points, so
      // these are guaranteed in-bounds. We re-assert here as a defence in
      // depth: no off-map coordinate may ever reach the API.
      let pts = r.points.filter((p) => isInBounds(p.lon, p.lat, bounds));
      if (pts.length < 2) {
        // Should be unreachable given the partition contract, but skip
        // rather than fall back to the raw (potentially off-map) sequence.
        presetsFail++;
        continue;
      }
      if (pts.length > TROLLING_PRESET_WAYPOINTS_MAX) {
        pts = downsample(pts, TROLLING_PRESET_WAYPOINTS_MAX);
        downsampled++;
      }
      try {
        await postTrollingPresets.mutateAsync({
          data: {
            name: sanitize(clamp(r.name || "Imported route", TROLLING_NAME_MAX)) || "Imported route",
            // Sensible defaults — user can edit afterwards in the trolling UI.
            headingDeg: 0,
            speedKnots: 2.5,
            waypoints: pts.map((p) => ({ lon: p.lon, lat: p.lat })),
          },
        });
        presetsOk++;
      } catch {
        presetsFail++;
      }
    }

    // Refresh affected views.
    if (markersOk > 0) {
      void qc.invalidateQueries({
        queryKey: getGetMarkersQueryKey({ datasetId: terrain.datasetId }),
      });
    }
    if (presetsOk > 0) {
      void qc.invalidateQueries({ queryKey: getGetTrollingPresetsQueryKey() });
    }

    const parts: string[] = [];
    if (markersOk) parts.push(`${markersOk} marker${markersOk === 1 ? "" : "s"}`);
    if (presetsOk) parts.push(`${presetsOk} trolling preset${presetsOk === 1 ? "" : "s"}`);
    const failTotal = markersFail + presetsFail;

    if (parts.length === 0) {
      toast({
        title: "Nothing imported",
        description: failTotal > 0 ? `${failTotal} item(s) failed.` : "No items selected to import.",
        variant: "destructive",
      });
      onClose();
      return;
    }

    const desc: string[] = [];
    desc.push(`Imported ${parts.join(" and ")}.`);
    if (downsampled > 0) {
      desc.push(
        `${downsampled} route${downsampled === 1 ? "" : "s"} downsampled to ${TROLLING_PRESET_WAYPOINTS_MAX} waypoints.`,
      );
    }
    if (failTotal > 0) desc.push(`${failTotal} item(s) failed.`);

    toast({
      title: "GPS import complete",
      description: desc.join(" "),
    });
    onClose();
  }, [phase, importWaypoints, importRoutes, postMarkers, postTrollingPresets, qc, terrain.datasetId, markerType, bounds, toast, onClose]);

  const body = (
    <div
      data-testid="gps-import-dialog"
      role="dialog"
      aria-label="Import GPS data"
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
          <span style={{ color: "#00e5ff", letterSpacing: "0.18em", fontWeight: 700, fontSize: 11 }}>
            ▼ IMPORT GPS
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", color: "#475569", fontSize: 16, cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 14 }}>
          {phase.kind === "pick" && (
            <>
              <p style={{ margin: "0 0 10px", color: "#94a3b8", lineHeight: 1.5 }}>
                Pick a <strong style={{ color: "#cbd5e1" }}>.gpx, .kml, .kmz, or .csv</strong> file. Points outside this
                dataset's bounding box will be skipped automatically.
              </p>
              <input
                ref={fileInputRef}
                data-testid="gps-import-file-input"
                type="file"
                accept=".gpx,.kml,.kmz,.csv,application/gpx+xml,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,text/csv"
                onChange={handleFileInput}
                style={{ color: "#cbd5e1" }}
              />
              <div style={{ marginTop: 12, fontSize: 10, color: "#64748b", lineHeight: 1.5 }}>
                Limit: up to 5,000 points per file. Trolling routes longer than 50 waypoints are downsampled.
              </div>
            </>
          )}

          {phase.kind === "parsing" && (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#94a3b8" }}>
              Parsing <strong>{phase.fileName}</strong>…
            </div>
          )}

          {phase.kind === "error" && (
            <>
              <div
                style={{
                  padding: "10px 12px",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 4,
                  color: "#f87171",
                  marginBottom: 12,
                }}
              >
                {phase.message}
              </div>
              <button
                onClick={() => setPhase({ kind: "pick" })}
                style={btnStyle("primary")}
              >
                Pick another file
              </button>
            </>
          )}

          {phase.kind === "preview" && (
            <>
              <div style={{ marginBottom: 10, color: "#94a3b8" }}>
                <strong style={{ color: "#cbd5e1" }}>{phase.fileName}</strong>
              </div>
              <div
                data-testid="gps-import-summary"
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
                  <div style={{ color: "#64748b" }}>Waypoints (in bounds)</div>
                  <div style={{ color: "#cbd5e1", fontSize: 13 }} data-testid="gps-import-waypoint-count">
                    {phase.parsed.waypoints.length}
                  </div>
                </div>
                <div>
                  <div style={{ color: "#64748b" }}>Routes / Tracks</div>
                  <div style={{ color: "#cbd5e1", fontSize: 13 }} data-testid="gps-import-route-count">
                    {phase.parsed.routes.length}
                  </div>
                </div>
                {(phase.outsideWp > 0 ||
                  phase.outsideRoutes > 0 ||
                  phase.outsideRoutePoints > 0) && (
                  <div
                    style={{ gridColumn: "1 / -1", color: "#fbbf24", fontSize: 10 }}
                    data-testid="gps-import-skipped"
                  >
                    Skipped {phase.outsideWp} waypoint
                    {phase.outsideWp === 1 ? "" : "s"},{" "}
                    {phase.outsideRoutePoints} route point
                    {phase.outsideRoutePoints === 1 ? "" : "s"}, and{" "}
                    {phase.outsideRoutes} fully-out-of-bounds route
                    {phase.outsideRoutes === 1 ? "" : "s"}.
                  </div>
                )}
              </div>

              {phase.parsed.waypoints.length > 0 && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={importWaypoints}
                    onChange={(e) => setImportWaypoints(e.target.checked)}
                    data-testid="gps-import-toggle-waypoints"
                  />
                  Import {phase.parsed.waypoints.length} waypoint
                  {phase.parsed.waypoints.length === 1 ? "" : "s"} as markers
                </label>
              )}

              {phase.parsed.waypoints.length > 0 && importWaypoints && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4, letterSpacing: "0.12em" }}>
                    MARKER TYPE
                  </div>
                  <select
                    value={markerType}
                    onChange={(e) => setMarkerType(e.target.value as MarkerTypeValue)}
                    data-testid="gps-import-marker-type"
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
                    {markerTypes.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {phase.parsed.routes.length > 0 && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={importRoutes}
                    onChange={(e) => setImportRoutes(e.target.checked)}
                    data-testid="gps-import-toggle-routes"
                  />
                  Import {phase.parsed.routes.length} route
                  {phase.parsed.routes.length === 1 ? "" : "s"} as trolling preset
                  {phase.parsed.routes.length === 1 ? "" : "s"}
                </label>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={onClose} style={btnStyle("ghost")}>
                  Cancel
                </button>
                <button
                  onClick={() => void doImport()}
                  data-testid="gps-import-confirm"
                  disabled={
                    (!importWaypoints || phase.parsed.waypoints.length === 0) &&
                    (!importRoutes || phase.parsed.routes.length === 0)
                  }
                  style={btnStyle("primary")}
                >
                  Import
                </button>
              </div>
            </>
          )}

          {phase.kind === "importing" && (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#94a3b8" }}>
              Importing…
            </div>
          )}
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
