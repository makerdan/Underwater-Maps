/**
 * GpsImportDialog — modal for importing GPS waypoints and trolling routes.
 *
 * Opened from DatasetPanel's "Import GPS…" button. Lets the user pick a
 * .gpx/.kml/.kmz/.csv file, previews how many points fall inside the active
 * dataset's bounding box (with a small in-dialog map so they can see the
 * filtering visually), and lets them edit the import before committing:
 *
 *   • rename routes / remove individual waypoints from each route
 *   • remove individual standalone waypoints
 *   • pick the marker type that waypoints will become
 *   • override the default heading / speed assigned to imported routes
 *
 * On confirm it calls POST /api/markers per surviving waypoint and
 * POST /api/trolling-presets per surviving route.
 *
 * Hard limits:
 *   • MAX_IMPORT_POINTS (5000) total points per file (enforced in parseGpsFile)
 *   • TROLLING_PRESET_WAYPOINTS_MAX (50) per preset — longer routes are
 *     downsampled with a clear notice.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePostMarkers,
  usePostTrollingPresets,
  useDeleteMarkersId,
  getGetMarkersQueryKey,
  getGetTrollingPresetsQueryKey,
  MarkerInputType,
  type TerrainData,
} from "@workspace/api-client-react";
import {
  parseGpsFile,
  partitionByBounds,
  applyColumnAssignment,
  countPoints,
  isInBounds,
  type Bounds,
  type ParseResult,
  type ParsedRoute,
  type RawColumnMeta,
  type ColumnAssignment,
} from "@/lib/gpsImport";
import { ColumnMappingStep } from "@/components/ColumnMappingStep";
import {
  SALTWATER_MARKER_TYPES,
  FRESHWATER_MARKER_TYPES,
  type MarkerTypeValue,
} from "@/lib/markerConstants";
import { useSettingsStore } from "@/lib/settingsStore";
import { useToast } from "@/hooks/use-toast";

const TROLLING_PRESET_WAYPOINTS_MAX = 50;
const MARKER_LABEL_MAX = 200;
const MARKER_NOTES_MAX = 2000;
const TROLLING_NAME_MAX = 80;

const DEFAULT_HEADING_DEG = 0;
const DEFAULT_SPEED_KNOTS = 2.5;
const HEADING_MIN = 0;
const HEADING_MAX = 360;
const SPEED_MIN = 0;
const SPEED_MAX = 10;

interface Props {
  /** Active terrain dataset. When absent the dialog imports without bounds-filtering and no datasetId is attached to saved markers. */
  terrain?: TerrainData;
  onClose: () => void;
}

type Phase =
  | { kind: "pick" }
  | { kind: "parsing"; fileName: string }
  | {
      kind: "mapping";
      fileName: string;
      meta: RawColumnMeta;
      /** Pre-selected assignment from a previous mapping or auto-detection. */
      initialAssignment: ColumnAssignment | null;
    }
  | {
      kind: "preview";
      fileName: string;
      /** Editable, bounds-filtered import payload. */
      parsed: ParseResult;
      /** Original parsed file, used by the preview map to show outside-bounds points. */
      original: ParseResult;
      outsideWp: number;
      outsideRoutes: number;
      outsideRoutePoints: number;
      /** Column metadata from the parser; consumed by the column-mapping UI. */
      meta: RawColumnMeta;
      /** The column assignment used to produce this result (null for auto-detected). */
      columnAssignment: ColumnAssignment | null;
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

function clampNumber(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export const GpsImportDialog: React.FC<Props> = ({ terrain, onClose }) => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const postMarkers = usePostMarkers();
  const postTrollingPresets = usePostTrollingPresets();
  const deleteMarkersId = useDeleteMarkersId();

  const settingsWaterType = useSettingsStore((s) => s.waterType);
  const defaultMarkerType = useSettingsStore((s) => s.defaultMarkerType);
  const waterType =
    (terrain?.waterType as "saltwater" | "freshwater" | undefined) ?? settingsWaterType;
  const markerTypes = waterType === "freshwater" ? FRESHWATER_MARKER_TYPES : SALTWATER_MARKER_TYPES;

  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [markerType, setMarkerType] = useState<MarkerTypeValue>(
    (defaultMarkerType as MarkerTypeValue) ?? MarkerInputType.custom,
  );
  const [importWaypoints, setImportWaypoints] = useState(true);
  const [importRoutes, setImportRoutes] = useState(true);
  const [headingDeg, setHeadingDeg] = useState<number>(DEFAULT_HEADING_DEG);
  const [speedKnots, setSpeedKnots] = useState<number>(DEFAULT_SPEED_KNOTS);
  const [isImporting, setIsImporting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    markersDone: number;
    markersTotal: number;
    routesDone: number;
    routesTotal: number;
    currentKind: "marker" | "route";
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);
  const savedMarkerIdsRef = useRef<string[]>([]);
  const importStartTimeRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  useEffect(() => {
    if (!isImporting) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isImporting]);

  const bounds = useMemo<Bounds | null>(
    () =>
      terrain
        ? {
            minLon: terrain.minLon,
            minLat: terrain.minLat,
            maxLon: terrain.maxLon,
            maxLat: terrain.maxLat,
          }
        : null,
    [terrain],
  );

  /** Advance from parsed data to either the mapping step or the preview step. */
  const advanceFromParsed = useCallback(
    (
      fileName: string,
      result: ParseResult,
      meta: RawColumnMeta,
      columnAssignment: ColumnAssignment | null,
    ) => {
      const hasLatCol = meta.columns.some((c) => c.mappedAlias === "lat");
      const hasLonCol = meta.columns.some((c) => c.mappedAlias === "lon");
      const needsMapping = meta.columns.length > 0 && (!hasLatCol || !hasLonCol);

      if (needsMapping) {
        setPhase({ kind: "mapping", fileName, meta, initialAssignment: columnAssignment });
        return;
      }

      const part = bounds
        ? partitionByBounds(result, bounds)
        : { inside: result, outsideWaypoints: 0, outsideRoutes: 0, outsideRoutePoints: 0 };
      setPhase({
        kind: "preview",
        fileName,
        parsed: part.inside,
        original: result,
        outsideWp: part.outsideWaypoints,
        outsideRoutes: part.outsideRoutes,
        outsideRoutePoints: part.outsideRoutePoints,
        meta,
        columnAssignment,
      });
      setImportWaypoints(part.inside.waypoints.length > 0);
      setImportRoutes(part.inside.routes.length > 0);
    },
    [bounds],
  );

  const onFileChosen = useCallback(
    async (file: File) => {
      setPhase({ kind: "parsing", fileName: file.name });
      setImportProgress(null);
      try {
        const { result, meta } = await parseGpsFile(file);
        // Reset heading/speed to dialog defaults on each new file.
        setHeadingDeg(DEFAULT_HEADING_DEG);
        setSpeedKnots(DEFAULT_SPEED_KNOTS);
        advanceFromParsed(file.name, result, meta, null);
      } catch (err) {
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to parse file",
        });
      }
    },
    [advanceFromParsed],
  );

  /** Called when the user confirms the column mapping step. */
  const onMappingConfirm = useCallback(
    (assignment: ColumnAssignment) => {
      if (phase.kind !== "mapping") return;
      const { fileName, meta } = phase;
      const result = applyColumnAssignment(meta, assignment);
      const part = bounds
        ? partitionByBounds(result, bounds)
        : { inside: result, outsideWaypoints: 0, outsideRoutes: 0, outsideRoutePoints: 0 };
      setPhase({
        kind: "preview",
        fileName,
        parsed: part.inside,
        original: result,
        outsideWp: part.outsideWaypoints,
        outsideRoutes: part.outsideRoutes,
        outsideRoutePoints: part.outsideRoutePoints,
        meta,
        columnAssignment: assignment,
      });
      setImportWaypoints(part.inside.waypoints.length > 0);
      setImportRoutes(part.inside.routes.length > 0);
    },
    [phase, bounds],
  );

  /** Called from the "Edit column mapping" link on the preview step. */
  const onEditMapping = useCallback(() => {
    if (phase.kind !== "preview") return;
    setPhase({
      kind: "mapping",
      fileName: phase.fileName,
      meta: phase.meta,
      initialAssignment: phase.columnAssignment,
    });
  }, [phase]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void onFileChosen(f);
    // Reset so the same file can be re-picked after an error.
    e.target.value = "";
  };

  /** Apply an in-place edit to the editable `parsed` payload in preview phase. */
  const updateParsed = useCallback((mut: (p: ParseResult) => ParseResult) => {
    setPhase((prev) => {
      if (prev.kind !== "preview") return prev;
      return { ...prev, parsed: mut(prev.parsed) };
    });
  }, []);

  const removeWaypoint = useCallback(
    (idx: number) => {
      updateParsed((p) => ({
        ...p,
        waypoints: p.waypoints.filter((_, i) => i !== idx),
      }));
    },
    [updateParsed],
  );

  const renameRoute = useCallback(
    (idx: number, name: string) => {
      updateParsed((p) => ({
        ...p,
        routes: p.routes.map((r, i) => (i === idx ? { ...r, name } : r)),
      }));
    },
    [updateParsed],
  );

  const removeRoutePoint = useCallback(
    (routeIdx: number, pointIdx: number) => {
      updateParsed((p) => ({
        ...p,
        routes: p.routes.map((r, i) =>
          i === routeIdx
            ? { ...r, points: r.points.filter((_, j) => j !== pointIdx) }
            : r,
        ),
      }));
    },
    [updateParsed],
  );

  const removeRoute = useCallback(
    (idx: number) => {
      updateParsed((p) => ({
        ...p,
        routes: p.routes.filter((_, i) => i !== idx),
      }));
    },
    [updateParsed],
  );

  const cancelImport = useCallback(async () => {
    cancelRequestedRef.current = true;
    setIsCancelling(true);
    const toDelete = [...savedMarkerIdsRef.current];
    savedMarkerIdsRef.current = [];
    for (const id of toDelete) {
      try {
        await deleteMarkersId.mutateAsync({ id });
      } catch {
        // best-effort cleanup; ignore individual failures
      }
    }
    onClose();
  }, [deleteMarkersId, onClose]);

  const doImport = useCallback(async () => {
    if (phase.kind !== "preview") return;
    if (importingRef.current) return;
    importingRef.current = true;
    cancelRequestedRef.current = false;
    savedMarkerIdsRef.current = [];
    importStartTimeRef.current = null;
    setIsImporting(true);
    setIsCancelling(false);
    const { parsed } = phase;

    // Routes that have been edited down to <2 points can't be imported as
    // trolling presets; surface that early rather than silently skipping.
    const importableRoutes = importRoutes
      ? parsed.routes.filter((r) => r.points.length >= 2)
      : [];
    const tooShortRoutes = importRoutes
      ? parsed.routes.length - importableRoutes.length
      : 0;

    const wpToImport = importWaypoints ? parsed.waypoints : [];
    const routesToImport: ParsedRoute[] = importableRoutes;

    setImportProgress({
      markersDone: 0,
      markersTotal: wpToImport.length,
      routesDone: 0,
      routesTotal: routesToImport.length,
      currentKind: "marker",
    });
    setPhase({ kind: "importing" });
    importStartTimeRef.current = Date.now();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let markersOk = 0;
    let markersFail = 0;
    let importCancelled = false;
    for (let wi = 0; wi < wpToImport.length; wi++) {
      if (cancelRequestedRef.current) break;
      const w = wpToImport[wi]!;
      const label = sanitize(clamp(w.name || "Imported point", MARKER_LABEL_MAX)) || "Imported point";
      const notes = w.notes ? sanitize(clamp(w.notes, MARKER_NOTES_MAX)) : undefined;
      // Depth: prefer parsed depth; fall back to 0 (surface) when unknown.
      const depth = Number.isFinite(w.depth) ? (w.depth as number) : 0;
      try {
        const created = await postMarkers.mutateAsync({
          data: {
            datasetId: terrain ? terrain.datasetId : null,
            lon: w.lon,
            lat: w.lat,
            depth,
            type: markerType as MarkerInputType,
            label,
            notes: notes && notes.length > 0 ? notes : undefined,
          },
        });
        savedMarkerIdsRef.current.push(created.id);
        markersOk++;
      } catch {
        if (controller.signal.aborted) {
          importCancelled = true;
          break;
        }
        markersFail++;
      }
      setImportProgress((prev) =>
        prev ? { ...prev, markersDone: prev.markersDone + 1 } : prev,
      );
    }

    if (cancelRequestedRef.current) {
      // cancelImport handles cleanup — just return.
      return;
    }

    let presetsOk = 0;
    let presetsFail = 0;
    let downsampled = 0;
    const safeHeading = clampNumber(headingDeg, HEADING_MIN, HEADING_MAX);
    const safeSpeed = clampNumber(speedKnots, SPEED_MIN, SPEED_MAX);
    if (routesToImport.length > 0) {
      setImportProgress((prev) => (prev ? { ...prev, currentKind: "route" } : prev));
    }
    for (let ri = 0; ri < routesToImport.length; ri++) {
      if (cancelRequestedRef.current) break;
      const r = routesToImport[ri]!;
      // When a dataset is active, re-assert in-bounds as defence in depth.
      // When no dataset (dataset-free import), keep all route points.
      let pts = bounds ? r.points.filter((p) => isInBounds(p.lon, p.lat, bounds)) : r.points;
      if (pts.length < 2) {
        presetsFail++;
        setImportProgress((prev) =>
          prev ? { ...prev, routesDone: prev.routesDone + 1 } : prev,
        );
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
            headingDeg: safeHeading,
            speedKnots: safeSpeed,
            waypoints: pts.map((p) => ({ lon: p.lon, lat: p.lat })),
          },
        });
        presetsOk++;
      } catch {
        presetsFail++;
      }
      setImportProgress((prev) =>
        prev ? { ...prev, routesDone: prev.routesDone + 1 } : prev,
      );
    }

    if (cancelRequestedRef.current) {
      return;
    }

    // Refresh affected views.
    if (markersOk > 0) {
      if (terrain) {
        void qc.invalidateQueries({
          queryKey: getGetMarkersQueryKey({ datasetId: terrain.datasetId }),
        });
      } else {
        // Dataset-free: invalidate unassigned markers query.
        void qc.invalidateQueries({ queryKey: getGetMarkersQueryKey({}) });
      }
    }
    if (presetsOk > 0) {
      void qc.invalidateQueries({ queryKey: getGetTrollingPresetsQueryKey() });
    }

    importingRef.current = false;
    abortControllerRef.current = null;
    setIsImporting(false);
    setIsCancelling(false);
    setImportProgress(null);

    if (importCancelled) {
      const parts: string[] = [];
      if (markersOk) parts.push(`${markersOk} marker${markersOk === 1 ? "" : "s"}`);
      if (presetsOk) parts.push(`${presetsOk} trolling preset${presetsOk === 1 ? "" : "s"}`);
      toast({
        title: "Import cancelled",
        description:
          parts.length > 0
            ? `${parts.join(" and ")} saved before cancellation.`
            : "No items were saved.",
      });
      setPhase({ kind: "pick" });
      return;
    }

    const parts: string[] = [];
    if (markersOk) parts.push(`${markersOk} marker${markersOk === 1 ? "" : "s"}`);
    if (presetsOk) parts.push(`${presetsOk} trolling preset${presetsOk === 1 ? "" : "s"}`);
    const failTotal = markersFail + presetsFail + tooShortRoutes;

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
    if (tooShortRoutes > 0) {
      desc.push(
        `${tooShortRoutes} route${tooShortRoutes === 1 ? "" : "s"} skipped (fewer than 2 waypoints).`,
      );
    }
    if (failTotal - tooShortRoutes > 0) {
      desc.push(`${failTotal - tooShortRoutes} item(s) failed.`);
    }

    toast({
      title: "GPS import complete",
      description: desc.join(" "),
    });
    onClose();
  }, [
    phase,
    importWaypoints,
    importRoutes,
    headingDeg,
    speedKnots,
    qc,
    terrain,
    markerType,
    bounds,
    toast,
    onClose,
    postMarkers,
    postTrollingPresets,
  ]);

  const body = (
    <>
    <style>{`@keyframes gps-spin { to { transform: rotate(360deg); } }`}</style>
    <div
      data-testid="gps-import-dialog"
      role="dialog"
      aria-modal="true"
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
        fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
      }}
      onClick={(e) => {
        if (isImporting && !isCancelling) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        style={{
          width: 520,
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
          <span style={{ color: "#00e5ff", letterSpacing: "0.18em", fontWeight: 700, fontSize: "calc(16.5px * var(--bs-font-scale, 1))" }}>
            ▼ IMPORT GPS
          </span>
          {isImporting && (
            <span
              data-testid="gps-import-in-progress-label"
              style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", letterSpacing: "0.08em" }}
            >
              {isCancelling
                ? "Cancelling…"
                : importProgress
                  ? importProgress.currentKind === "marker" && importProgress.markersTotal > 0
                    ? `Saving markers… ${importProgress.markersDone} / ${importProgress.markersTotal}`
                    : importProgress.currentKind === "route" && importProgress.routesTotal > 0
                      ? `Saving routes… ${importProgress.routesDone} / ${importProgress.routesTotal}`
                      : "Importing…"
                  : "Importing — please wait…"}
            </span>
          )}
          <button
            onClick={isImporting && !isCancelling ? undefined : onClose}
            disabled={isImporting && !isCancelling}
            aria-label="Close"
            aria-disabled={isImporting && !isCancelling}
            title={isImporting && !isCancelling ? "Import in progress — please wait" : undefined}
            data-testid="gps-import-close-btn"
            style={{
              background: "none",
              border: "none",
              color: isImporting && !isCancelling ? "#334155" : "#94a3b8",
              fontSize: "calc(24px * var(--bs-font-scale, 1))",
              cursor: isImporting && !isCancelling ? "not-allowed" : "pointer",
              opacity: isImporting && !isCancelling ? 0.35 : 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 14 }}>
          {phase.kind === "pick" && (
            <>
              <p style={{ margin: "0 0 10px", color: "#e2e8f0", lineHeight: 1.5 }}>
                Pick a <strong style={{ color: "#cbd5e1" }}>.gpx, .kml, .kmz, .csv, or .xlsx</strong> file <span style={{ color: "#94a3b8", fontWeight: 400 }}>(legacy .xls not supported)</span>.{" "}
                {bounds
                  ? "Points outside this dataset's bounding box will be skipped automatically."
                  : "All points will be saved as unassigned markers (no active dataset)."}
              </p>
              <input
                ref={fileInputRef}
                data-testid="gps-import-file-input"
                type="file"
                accept=".gpx,.kml,.kmz,.csv,.xlsx,application/gpx+xml,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileInput}
                style={{
                  color: "#cbd5e1",
                  border: "1px solid #22d3ee",
                  borderRadius: "6px",
                  padding: "4px 8px",
                }}
              />
              <div style={{ marginTop: 12, fontSize: "calc(15px * var(--bs-font-scale, 1))", color: "#cbd5e1", lineHeight: 1.5 }}>
                Limit: up to 5,000 points per file. Trolling routes longer than 50 waypoints are downsampled.
              </div>
            </>
          )}

          {phase.kind === "parsing" && (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#e2e8f0" }}>
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

          {phase.kind === "mapping" && (
            <ColumnMappingStep
              meta={phase.meta}
              initialAssignment={phase.initialAssignment}
              onConfirm={onMappingConfirm}
              onBack={() => setPhase({ kind: "pick" })}
            />
          )}

          {phase.kind === "preview" && (
            <PreviewPanel
              phase={phase}
              bounds={bounds ?? undefined}
              importWaypoints={importWaypoints}
              setImportWaypoints={setImportWaypoints}
              importRoutes={importRoutes}
              setImportRoutes={setImportRoutes}
              markerType={markerType}
              setMarkerType={setMarkerType}
              markerTypes={markerTypes}
              headingDeg={headingDeg}
              setHeadingDeg={setHeadingDeg}
              speedKnots={speedKnots}
              setSpeedKnots={setSpeedKnots}
              removeWaypoint={removeWaypoint}
              renameRoute={renameRoute}
              removeRoutePoint={removeRoutePoint}
              removeRoute={removeRoute}
              onCancel={onClose}
              onConfirm={() => void doImport()}
              isImporting={isImporting}
              onEditMapping={phase.meta.columns.length > 0 ? onEditMapping : undefined}
            />
          )}

          {phase.kind === "importing" && (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#e2e8f0" }}>
              {isCancelling ? (
                <div style={{ color: "#fbbf24", fontSize: "calc(15.5px * var(--bs-font-scale, 1))" }}>
                  Cancelling — cleaning up saved markers…
                </div>
              ) : importProgress ? (
                (() => {
                  const isMarkerPhase = importProgress.currentKind === "marker";
                  const done = isMarkerPhase ? importProgress.markersDone : importProgress.routesDone;
                  const total = isMarkerPhase ? importProgress.markersTotal : importProgress.routesTotal;
                  const kindLabel = isMarkerPhase ? "markers" : "routes";
                  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
                  return (
                    <>
                      <div
                        data-testid="gps-import-progress-text"
                        style={{ marginBottom: 12, fontSize: "calc(15.5px * var(--bs-font-scale, 1))" }}
                      >
                        Saving {kindLabel}…{" "}
                        <strong style={{ color: "#00e5ff" }}>{done}</strong>
                        {" / "}
                        <strong style={{ color: "#00e5ff" }}>{total}</strong>
                      </div>
                      <div
                        role="progressbar"
                        aria-valuenow={done}
                        aria-valuemin={0}
                        aria-valuemax={total}
                        aria-label={`Saving ${kindLabel}: ${done} of ${total}`}
                        data-testid="gps-import-progress-bar"
                        style={{
                          height: 6,
                          background: "rgba(0,229,255,0.12)",
                          borderRadius: 3,
                          overflow: "hidden",
                          marginBottom: 16,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${progressPct}%`,
                            background: "#00e5ff",
                            borderRadius: 3,
                            transition: "width 0.15s ease",
                          }}
                        />
                      </div>
                      {(() => {
                        if (done < 2 || !importStartTimeRef.current) return (
                          <div style={{ height: 20, marginBottom: 8 }} />
                        );
                        const elapsed = Date.now() - importStartTimeRef.current;
                        const rate = elapsed / done;
                        const remaining = total - done;
                        const etaSec = Math.ceil((rate * remaining) / 1000);
                        if (etaSec <= 0) return <div style={{ height: 20, marginBottom: 8 }} />;
                        return (
                          <div
                            data-testid="gps-import-eta"
                            style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#64748b", marginBottom: 8, letterSpacing: "0.04em" }}
                          >
                            ~{etaSec} s remaining
                          </div>
                        );
                      })()}
                      <button
                        onClick={() => void cancelImport()}
                        disabled={isCancelling}
                        data-testid="gps-import-cancel-btn"
                        style={{
                          ...btnStyle("ghost"),
                          marginTop: 8,
                          opacity: isCancelling ? 0.5 : 1,
                        }}
                      >
                        Cancel import
                      </button>
                    </>
                  );
                })()
              ) : (
                <>
                  <div style={{ marginBottom: 16 }}>Importing…</div>
                  <button
                    type="button"
                    data-testid="gps-import-cancel-btn"
                    onClick={cancelImport}
                    style={btnStyle("ghost")}
                  >
                    Cancel import
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );

  return createPortal(body, document.body);
};

// ---------------------------------------------------------------------------
// Preview panel (extracted so the dialog body stays readable)
// ---------------------------------------------------------------------------

interface PreviewPanelProps {
  phase: Extract<Phase, { kind: "preview" }>;
  /** When undefined, the dialog is in dataset-free mode — no bounds filtering. */
  bounds?: Bounds;
  importWaypoints: boolean;
  setImportWaypoints: (v: boolean) => void;
  importRoutes: boolean;
  setImportRoutes: (v: boolean) => void;
  markerType: MarkerTypeValue;
  setMarkerType: (v: MarkerTypeValue) => void;
  markerTypes: ReadonlyArray<{ value: string; label: string }>;
  headingDeg: number;
  setHeadingDeg: (v: number) => void;
  speedKnots: number;
  setSpeedKnots: (v: number) => void;
  removeWaypoint: (idx: number) => void;
  renameRoute: (idx: number, name: string) => void;
  removeRoutePoint: (routeIdx: number, pointIdx: number) => void;
  removeRoute: (idx: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isImporting: boolean;
  /** Present only for CSV/Excel imports; opens the column-mapping step. */
  onEditMapping?: () => void;
}

const PreviewPanel: React.FC<PreviewPanelProps> = ({
  phase,
  bounds,
  importWaypoints,
  setImportWaypoints,
  importRoutes,
  setImportRoutes,
  markerType,
  setMarkerType,
  markerTypes,
  headingDeg,
  setHeadingDeg,
  speedKnots,
  setSpeedKnots,
  removeWaypoint,
  renameRoute,
  removeRoutePoint,
  removeRoute,
  onCancel,
  onConfirm,
  isImporting,
  onEditMapping,
}) => {
  const { parsed, original } = phase;
  const insideWpCount = parsed.waypoints.length;
  const insideRouteCount = parsed.routes.length;
  const totalInside = countPoints(parsed);
  const shortRoutes = parsed.routes.filter((r) => r.points.length < 2).length;
  const hasBounds = !!bounds;

  const importDisabled =
    (!importWaypoints || insideWpCount === 0) &&
    (!importRoutes || insideRouteCount === 0 || insideRouteCount === shortRoutes);

  return (
    <>
      <div style={{ marginBottom: 10, color: "#e2e8f0", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ color: "#cbd5e1" }}>{phase.fileName}</strong>
        {onEditMapping && (
          <button
            type="button"
            data-testid="gps-import-edit-column-mapping"
            onClick={onEditMapping}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "#22d3ee",
              fontSize: "calc(14px * var(--bs-font-scale, 1))",
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.04em",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            }}
          >
            Edit column mapping
          </button>
        )}
      </div>

      {bounds && <PreviewMap original={original} bounds={bounds} />}

      <div
        data-testid="gps-import-summary"
        style={{
          padding: "10px 12px",
          background: "rgba(0,229,255,0.04)",
          border: "1px solid rgba(0,229,255,0.15)",
          borderRadius: 4,
          margin: "10px 0 12px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 6,
          fontSize: "calc(15px * var(--bs-font-scale, 1))",
        }}
      >
        <div>
          <div style={{ color: "#cbd5e1" }}>{hasBounds ? "Waypoints (in bounds)" : "Waypoints"}</div>
          <div style={{ color: "#cbd5e1", fontSize: "calc(19.5px * var(--bs-font-scale, 1))" }} data-testid="gps-import-waypoint-count">
            {insideWpCount}
          </div>
        </div>
        <div>
          <div style={{ color: "#cbd5e1" }}>Routes / Tracks</div>
          <div style={{ color: "#cbd5e1", fontSize: "calc(19.5px * var(--bs-font-scale, 1))" }} data-testid="gps-import-route-count">
            {insideRouteCount}
          </div>
        </div>
        <div>
          <div style={{ color: "#cbd5e1" }}>Total points</div>
          <div style={{ color: "#cbd5e1", fontSize: "calc(19.5px * var(--bs-font-scale, 1))" }}>{totalInside}</div>
        </div>
        {(phase.outsideWp > 0 ||
          phase.outsideRoutes > 0 ||
          phase.outsideRoutePoints > 0) && (
          <div
            style={{ gridColumn: "1 / -1", color: "#fbbf24", fontSize: "calc(15px * var(--bs-font-scale, 1))" }}
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

      {insideWpCount > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={importWaypoints}
            onChange={(e) => setImportWaypoints(e.target.checked)}
            data-testid="gps-import-toggle-waypoints"
          />
          Import {insideWpCount} waypoint
          {insideWpCount === 1 ? "" : "s"} as markers
        </label>
      )}

      {insideWpCount > 0 && importWaypoints && (
        <>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#cbd5e1", marginBottom: 4, letterSpacing: "0.12em" }}>
              MARKER TYPE
            </div>
            <select
              value={markerType}
              onChange={(e) => setMarkerType(e.target.value as MarkerTypeValue)}
              data-testid="gps-import-marker-type"
              style={selectStyle}
            >
              {markerTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <details
            data-testid="gps-import-waypoints-editor"
            style={{ marginBottom: 12 }}
          >
            <summary
              style={{
                cursor: "pointer",
                color: "#e2e8f0",
                fontSize: "calc(15px * var(--bs-font-scale, 1))",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              EDIT WAYPOINTS ({insideWpCount})
            </summary>
            <ul style={listStyle} data-testid="gps-import-waypoint-list">
              {parsed.waypoints.map((w, i) => (
                <li key={i} style={listItemStyle}>
                  <span style={{ flex: 1, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {w.name || "(unnamed)"}
                  </span>
                  <span style={{ color: "#cbd5e1", fontSize: "calc(15px * var(--bs-font-scale, 1))" }}>
                    {w.lat.toFixed(4)}, {w.lon.toFixed(4)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove waypoint ${w.name || i + 1}`}
                    data-testid={`gps-import-remove-waypoint-${i}`}
                    onClick={() => removeWaypoint(i)}
                    style={removeBtnStyle}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      {insideRouteCount > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={importRoutes}
            onChange={(e) => setImportRoutes(e.target.checked)}
            data-testid="gps-import-toggle-routes"
          />
          Import {insideRouteCount} route
          {insideRouteCount === 1 ? "" : "s"} as trolling preset
          {insideRouteCount === 1 ? "" : "s"}
        </label>
      )}

      {insideRouteCount > 0 && importRoutes && (
        <>
          <div
            data-testid="gps-import-default-vector"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              marginBottom: 12,
              padding: "8px 10px",
              background: "rgba(0,229,255,0.04)",
              border: "1px solid rgba(0,229,255,0.15)",
              borderRadius: 4,
            }}
          >
            <div>
              <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#cbd5e1", marginBottom: 4, letterSpacing: "0.12em" }}>
                DEFAULT HEADING (°)
              </div>
              <input
                type="number"
                min={HEADING_MIN}
                max={HEADING_MAX}
                step={1}
                value={Number.isFinite(headingDeg) ? headingDeg : ""}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setHeadingDeg(Number.isFinite(v) ? clampNumber(v, HEADING_MIN, HEADING_MAX) : DEFAULT_HEADING_DEG);
                }}
                data-testid="gps-import-heading"
                aria-label="Default heading in degrees"
                style={numberInputStyle}
              />
            </div>
            <div>
              <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#cbd5e1", marginBottom: 4, letterSpacing: "0.12em" }}>
                DEFAULT SPEED (KT)
              </div>
              <input
                type="number"
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={0.1}
                value={Number.isFinite(speedKnots) ? speedKnots : ""}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setSpeedKnots(Number.isFinite(v) ? clampNumber(v, SPEED_MIN, SPEED_MAX) : DEFAULT_SPEED_KNOTS);
                }}
                data-testid="gps-import-speed"
                aria-label="Default speed in knots"
                style={numberInputStyle}
              />
            </div>
            <div style={{ gridColumn: "1 / -1", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#cbd5e1", lineHeight: 1.4 }}>
              Applied to every imported route. You can fine-tune individual presets afterwards in the trolling UI.
            </div>
          </div>

          <div data-testid="gps-import-routes-editor" style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                color: "#cbd5e1",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              EDIT ROUTES ({insideRouteCount})
            </div>
            {parsed.routes.map((r, ri) => (
              <RouteEditor
                key={ri}
                route={r}
                index={ri}
                renameRoute={renameRoute}
                removeRoutePoint={removeRoutePoint}
                removeRoute={removeRoute}
              />
            ))}
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <button onClick={onCancel} style={btnStyle("ghost")}>
          Cancel
        </button>
        <button
          onClick={onConfirm}
          data-testid="gps-import-confirm"
          disabled={importDisabled || isImporting}
          aria-disabled={importDisabled || isImporting}
          style={{
            ...btnStyle("primary"),
            ...(isImporting ? { opacity: 0.6, cursor: "not-allowed" } : {}),
          }}
        >
          {isImporting ? (
            <>
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  marginRight: 6,
                  animation: "gps-spin 0.7s linear infinite",
                  verticalAlign: "middle",
                }}
              />
              Importing…
            </>
          ) : (
            "Import"
          )}
        </button>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Per-route editor (rename + drop individual route points)
// ---------------------------------------------------------------------------

const RouteEditor: React.FC<{
  route: ParsedRoute;
  index: number;
  renameRoute: (idx: number, name: string) => void;
  removeRoutePoint: (routeIdx: number, pointIdx: number) => void;
  removeRoute: (idx: number) => void;
}> = ({ route, index, renameRoute, removeRoutePoint, removeRoute }) => {
  const tooShort = route.points.length < 2;
  return (
    <details
      data-testid={`gps-import-route-${index}`}
      style={{
        border: tooShort
          ? "1px solid rgba(251,191,36,0.4)"
          : "1px solid rgba(148,163,184,0.15)",
        borderRadius: 4,
        marginBottom: 6,
        background: "rgba(15,23,42,0.4)",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          padding: "6px 8px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <input
          type="text"
          value={route.name}
          onChange={(e) => renameRoute(index, e.target.value.slice(0, TROLLING_NAME_MAX))}
          maxLength={TROLLING_NAME_MAX}
          aria-label={`Route ${index + 1} name`}
          data-testid={`gps-import-route-name-${index}`}
          style={{
            flex: 1,
            padding: "4px 6px",
            background: "rgba(2,8,24,0.6)",
            border: "1px solid rgba(0,229,255,0.2)",
            borderRadius: 3,
            color: "#cbd5e1",
            fontFamily: "inherit",
            fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
          }}
          onClick={(e) => e.stopPropagation()}
        />
        <span
          style={{
            color: tooShort ? "#fbbf24" : "#cbd5e1",
            fontSize: "calc(15px * var(--bs-font-scale, 1))",
            minWidth: 50,
            textAlign: "right",
          }}
        >
          {route.points.length} pt{route.points.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          aria-label={`Remove route ${route.name || index + 1}`}
          data-testid={`gps-import-remove-route-${index}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            removeRoute(index);
          }}
          style={removeBtnStyle}
        >
          ✕
        </button>
      </summary>
      {tooShort && (
        <div style={{ padding: "4px 10px", color: "#fbbf24", fontSize: "calc(15px * var(--bs-font-scale, 1))" }}>
          Fewer than 2 waypoints — this route will be skipped.
        </div>
      )}
      <ul style={{ ...listStyle, margin: "4px 8px 8px" }} data-testid={`gps-import-route-points-${index}`}>
        {route.points.map((p, pi) => (
          <li key={pi} style={listItemStyle}>
            <span style={{ flex: 1, color: "#cbd5e1", fontSize: "calc(15px * var(--bs-font-scale, 1))" }}>
              #{pi + 1}
            </span>
            <span style={{ color: "#cbd5e1", fontSize: "calc(15px * var(--bs-font-scale, 1))" }}>
              {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
            </span>
            <button
              type="button"
              aria-label={`Remove waypoint ${pi + 1} from route ${route.name || index + 1}`}
              data-testid={`gps-import-remove-route-point-${index}-${pi}`}
              onClick={() => removeRoutePoint(index, pi)}
              style={removeBtnStyle}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
};

// ---------------------------------------------------------------------------
// Preview map (SVG; in-bounds = cyan, out-of-bounds = amber)
// ---------------------------------------------------------------------------

const MAP_WIDTH = 480;
const MAP_HEIGHT = 180;
const MAP_PAD = 6;

interface PreviewMapProps {
  original: ParseResult;
  bounds: Bounds;
}

const PreviewMap: React.FC<PreviewMapProps> = ({ original, bounds }) => {
  // Compute drawing bounds = dataset bbox union all points, with a 5% pad on
  // each side so points right on the edge are visible.
  const viewBox = useMemo(() => {
    let minLon = bounds.minLon;
    let maxLon = bounds.maxLon;
    let minLat = bounds.minLat;
    let maxLat = bounds.maxLat;
    const visit = (lon: number, lat: number) => {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    };
    for (const w of original.waypoints) visit(w.lon, w.lat);
    for (const r of original.routes) for (const p of r.points) visit(p.lon, p.lat);
    // Guard against degenerate bbox (all points colinear or single dataset).
    if (maxLon - minLon < 1e-9) {
      maxLon += 1e-4;
      minLon -= 1e-4;
    }
    if (maxLat - minLat < 1e-9) {
      maxLat += 1e-4;
      minLat -= 1e-4;
    }
    const padLon = (maxLon - minLon) * 0.05;
    const padLat = (maxLat - minLat) * 0.05;
    return {
      minLon: minLon - padLon,
      maxLon: maxLon + padLon,
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
    };
  }, [original, bounds]);

  const innerW = MAP_WIDTH - MAP_PAD * 2;
  const innerH = MAP_HEIGHT - MAP_PAD * 2;
  const lonSpan = viewBox.maxLon - viewBox.minLon;
  const latSpan = viewBox.maxLat - viewBox.minLat;

  const project = useCallback(
    (lon: number, lat: number): [number, number] => {
      const x = MAP_PAD + ((lon - viewBox.minLon) / lonSpan) * innerW;
      // SVG Y grows downward; latitude grows upward → flip.
      const y = MAP_PAD + (1 - (lat - viewBox.minLat) / latSpan) * innerH;
      return [x, y];
    },
    [viewBox, lonSpan, latSpan, innerW, innerH],
  );

  const [bx1, by1] = project(bounds.minLon, bounds.maxLat);
  const [bx2, by2] = project(bounds.maxLon, bounds.minLat);

  const hasAnything =
    original.waypoints.length > 0 ||
    original.routes.some((r) => r.points.length > 0);

  return (
    <div data-testid="gps-import-preview-map">
      <svg
        width="100%"
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Preview of imported GPS points relative to the dataset bounds"
        style={{
          display: "block",
          background: "rgba(2,8,24,0.7)",
          border: "1px solid rgba(0,229,255,0.2)",
          borderRadius: 4,
        }}
      >
        <rect
          x={bx1}
          y={by1}
          width={Math.max(0, bx2 - bx1)}
          height={Math.max(0, by2 - by1)}
          fill="rgba(0,229,255,0.06)"
          stroke="rgba(0,229,255,0.6)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />

        {original.routes.map((r, ri) => {
          const segments: Array<{ d: string; inside: boolean }> = [];
          for (let i = 1; i < r.points.length; i++) {
            const a = r.points[i - 1]!;
            const b = r.points[i]!;
            const inside =
              isInBounds(a.lon, a.lat, bounds) && isInBounds(b.lon, b.lat, bounds);
            const [ax, ay] = project(a.lon, a.lat);
            const [bxp, byp] = project(b.lon, b.lat);
            segments.push({
              d: `M${ax.toFixed(1)},${ay.toFixed(1)} L${bxp.toFixed(1)},${byp.toFixed(1)}`,
              inside,
            });
          }
          return (
            <g key={`r${ri}`}>
              {segments.map((s, si) => (
                <path
                  key={si}
                  d={s.d}
                  stroke={s.inside ? "#00e5ff" : "#fbbf24"}
                  strokeWidth={1.4}
                  fill="none"
                  opacity={0.85}
                />
              ))}
            </g>
          );
        })}

        {original.waypoints.map((w, wi) => {
          const inside = isInBounds(w.lon, w.lat, bounds);
          const [x, y] = project(w.lon, w.lat);
          return (
            <circle
              key={`w${wi}`}
              cx={x}
              cy={y}
              r={2.5}
              fill={inside ? "#00e5ff" : "#fbbf24"}
              stroke="rgba(2,8,24,0.9)"
              strokeWidth={0.5}
            />
          );
        })}

        {!hasAnything && (
          <text
            x={MAP_WIDTH / 2}
            y={MAP_HEIGHT / 2}
            textAnchor="middle"
            fill="#94a3b8"
            fontSize={10}
            fontFamily="inherit"
          >
            (no points)
          </text>
        )}
      </svg>
      <div
        style={{
          display: "flex",
          gap: 12,
          justifyContent: "flex-end",
          fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
          color: "#cbd5e1",
          marginTop: 4,
        }}
      >
        <span>
          <span style={{ color: "#00e5ff" }}>●</span> in bounds
        </span>
        <span>
          <span style={{ color: "#fbbf24" }}>●</span> outside (skipped)
        </span>
        <span>
          <span style={{ color: "#00e5ff", letterSpacing: -1 }}>┄┄</span> dataset bbox
        </span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 6px",
  background: "rgba(2,8,24,0.6)",
  border: "1px solid rgba(0,229,255,0.2)",
  borderRadius: 3,
  color: "#cbd5e1",
  fontFamily: "inherit",
  fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
};

const numberInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 6px",
  background: "rgba(2,8,24,0.6)",
  border: "1px solid rgba(0,229,255,0.2)",
  borderRadius: 3,
  color: "#cbd5e1",
  fontFamily: "inherit",
  fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  maxHeight: 160,
  overflowY: "auto",
  border: "1px solid rgba(148,163,184,0.12)",
  borderRadius: 3,
};

const listItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 6px",
  borderBottom: "1px solid rgba(148,163,184,0.06)",
};

const removeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(148,163,184,0.25)",
  borderRadius: 3,
  color: "#e2e8f0",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "calc(15px * var(--bs-font-scale, 1))",
  padding: "2px 6px",
  lineHeight: 1,
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
