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
  useDeleteMarkersId,
  useGetDatasetsMySaves,
  useGetMarkers,
  usePatchMarkersId,
  getGetMarkersQueryKey,
  getGetDatasetsMySavesQueryKey,
  MarkerInputType,
  type TerrainData,
  type UserCatalogSave,
} from "@workspace/api-client-react";
import {
  parseGpsFile,
  partitionByBounds,
  applyColumnAssignment,
  countPoints,
  isInBounds,
  computeResultBbox,
  bboxIntersects,
  type Bounds,
  type ParseResult,
  type ParsedRoute,
  type RawColumnMeta,
  type ColumnAssignment,
  type ExcelParseProgress,
} from "@/lib/gpsImport";
import { ColumnMappingStep } from "@/components/ColumnMappingStep";
import {
  SALTWATER_MARKER_TYPES,
  FRESHWATER_MARKER_TYPES,
  NATURAL_WORLD_MARKER_TYPES,
  MARINER_MARKER_TYPES,
  SPECIAL_MARKER_TYPES,
  type MarkerTypeValue,
} from "@/lib/markerConstants";
import { useSettingsStore } from "@/lib/settingsStore";
import { useToast } from "@/hooks/use-toast";
import { useReturnFocus } from "@/hooks/useReturnFocus";
import { authorizedFetch } from "@/lib/authorizedFetch";

const SAVED_ROUTE_WAYPOINTS_MAX = 20;
const MARKER_LABEL_MAX = 200;
const MARKER_NOTES_MAX = 2000;
const TROLLING_NAME_MAX = 80;


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

function routeDistanceM(points: ParsedRoute["points"]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const dLat = lat2 - lat1;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    total += 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }
  return total;
}

export const GpsImportDialog: React.FC<Props> = ({ terrain, onClose }) => {
  useReturnFocus();
  const qc = useQueryClient();
  const { toast } = useToast();
  const postMarkers = usePostMarkers();
  const deleteMarkersId = useDeleteMarkersId();

  const settingsWaterType = useSettingsStore((s) => s.waterType);
  const defaultMarkerType = useSettingsStore((s) => s.defaultMarkerType);
  const waterType =
    (terrain?.waterType as "saltwater" | "freshwater" | undefined) ?? settingsWaterType;
  // Nullish fallbacks keep partial test mocks of markerConstants working.
  const markerTypes = [
    ...((waterType === "freshwater" ? FRESHWATER_MARKER_TYPES : SALTWATER_MARKER_TYPES) ?? []),
    ...(NATURAL_WORLD_MARKER_TYPES ?? []),
    ...(MARINER_MARKER_TYPES ?? []),
    ...(SPECIAL_MARKER_TYPES ?? []),
  ];

  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [markerType, setMarkerType] = useState<MarkerTypeValue>(
    (defaultMarkerType as MarkerTypeValue) ?? MarkerInputType.custom,
  );
  const [importWaypoints, setImportWaypoints] = useState(true);
  const [importRoutes, setImportRoutes] = useState(true);

  // Dataset matcher state (dataset-free import only)
  const [matchedSave, setMatchedSave] = useState<UserCatalogSave | null>(null);
  const [reassignExisting, setReassignExisting] = useState(true);

  // Fetch the user's saved catalog datasets (only when no active terrain)
  const { data: mySavesData, isLoading: mySavesLoading } = useGetDatasetsMySaves(undefined, {
    query: { queryKey: getGetDatasetsMySavesQueryKey(), enabled: !terrain, staleTime: 60_000 },
  });
  const mySaves = useMemo(() => mySavesData ?? [], [mySavesData]);

  // Bbox of the currently-imported points (preview phase only)
  const pointsBbox = useMemo(() => {
    if (phase.kind !== "preview") return null;
    return computeResultBbox(phase.parsed);
  }, [phase]);

  // Saves whose coverage intersects the imported points bbox
  const matchingSaves = useMemo(() => {
    if (terrain || !mySaves.length || !pointsBbox) return [];
    return mySaves.filter(
      (s) =>
        s.status === "ready" &&
        s.catalog?.coverageBbox != null &&
        bboxIntersects(pointsBbox, s.catalog.coverageBbox),
    );
  }, [terrain, mySaves, pointsBbox]);

  // Unassigned markers in the matched save's coverage area
  const matchedBbox = matchedSave?.catalog?.coverageBbox ?? null;
  const { data: existingUnassigned } = useGetMarkers(
    matchedBbox
      ? {
          minLat: matchedBbox.minLat,
          minLon: matchedBbox.minLon,
          maxLat: matchedBbox.maxLat,
          maxLon: matchedBbox.maxLon,
        }
      : undefined,
    { query: { queryKey: getGetMarkersQueryKey(matchedBbox ? { minLat: matchedBbox.minLat, minLon: matchedBbox.minLon, maxLat: matchedBbox.maxLat, maxLon: matchedBbox.maxLon } : undefined), enabled: !!matchedBbox } },
  );
  const existingUnassignedCount = existingUnassigned?.length ?? 0;
  const patchMarkersId = usePatchMarkersId();

  const addCandidateIds = useCallback((result: ParseResult): ParseResult => ({
    ...result,
    routes: result.routes.map((route, index) => ({
      ...route,
      id: route.id ?? `gps-route-${Date.now()}-${index}`,
    })),
  }), []);

  // Reset reassign toggle whenever a different save is selected
  useEffect(() => {
    setReassignExisting(true);
  }, [matchedSave]);

  const [isImporting, setIsImporting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isStalled, setIsStalled] = useState(false);

  // Escape key closes the dialog — mirrors the backdrop-click guard so the
  // handler is suppressed while an import is in-flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isImporting && !isCancelling) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isImporting, isCancelling]);
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
  const lastImportProgressRef = useRef<number | null>(null);
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

  // A request that never settles must not leave the dialog looking permanently
  // busy. The existing Cancel import path remains the safe recovery action.
  useEffect(() => {
    if (!isImporting) {
      setIsStalled(false);
      return;
    }
    lastImportProgressRef.current = Date.now();
    const timer = window.setInterval(() => {
      if (
        !isCancelling &&
        lastImportProgressRef.current != null &&
        Date.now() - lastImportProgressRef.current >= 30_000
      ) {
        setIsStalled(true);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isImporting, isCancelling]);

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
      setMatchedSave(null);
      setPhase({
        kind: "preview",
        fileName,
        parsed: addCandidateIds(part.inside),
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
     [bounds, addCandidateIds],
  );

  const onFileChosen = useCallback(
    async (file: File) => {
      setPhase({ kind: "parsing", fileName: file.name });
      setImportProgress(null);
      try {
        const { result, meta } = await parseGpsFile(file, (progress: ExcelParseProgress) => {
          setImportProgress({
            markersDone: progress.completed,
            markersTotal: progress.total,
            routesDone: 0,
            routesTotal: 0,
            currentKind: "marker",
          });
        });
        // Reset heading/speed to dialog defaults on each new file.
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
      setMatchedSave(null);
      setPhase({
        kind: "preview",
        fileName,
        parsed: addCandidateIds(part.inside),
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
     [phase, bounds, addCandidateIds],
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
    abortControllerRef.current?.abort();
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

    const wpToImport = importWaypoints ? parsed.waypoints : [];

    setImportProgress({
      markersDone: 0,
      markersTotal: wpToImport.length,
      routesDone: 0,
      routesTotal: 0,
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
            datasetId: terrain ? terrain.datasetId : (matchedSave?.datasetId ?? null),
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
      lastImportProgressRef.current = Date.now();
    }

    if (cancelRequestedRef.current) {
      // cancelImport handles cleanup — just return.
      return;
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
      } else if (matchedSave?.datasetId) {
        // Assigned to a saved dataset — refresh that dataset's markers.
        void qc.invalidateQueries({
          queryKey: getGetMarkersQueryKey({ datasetId: matchedSave.datasetId }),
        });
        // Also refresh the generic unassigned query in case any UI depends on it.
        void qc.invalidateQueries({ queryKey: getGetMarkersQueryKey({}) });
      } else {
        // Fully dataset-free: invalidate unassigned markers query.
        void qc.invalidateQueries({ queryKey: getGetMarkersQueryKey({}) });
      }
    }

    // Reassign existing unassigned markers in the matched save's coverage area.
    let reassignFails = 0;
    if (
      !cancelRequestedRef.current &&
      matchedSave?.datasetId &&
      reassignExisting &&
      existingUnassigned &&
      existingUnassigned.length > 0
    ) {
      for (const marker of existingUnassigned) {
        if (cancelRequestedRef.current) break;
        try {
          await patchMarkersId.mutateAsync({
            id: marker.id,
            data: { datasetId: matchedSave.datasetId },
          });
        } catch {
          // best-effort: continue on individual failures, but track them
          reassignFails++;
        }
      }
      // Invalidate the bbox query that fed the count so it re-fetches.
      if (matchedBbox) {
        void qc.invalidateQueries({
          queryKey: getGetMarkersQueryKey({
            minLat: matchedBbox.minLat,
            minLon: matchedBbox.minLon,
            maxLat: matchedBbox.maxLat,
            maxLon: matchedBbox.maxLon,
          }),
        });
      }
    }
    importingRef.current = false;
    abortControllerRef.current = null;
    setIsImporting(false);
    setIsCancelling(false);
    setImportProgress(null);

    if (importCancelled) {
      const parts: string[] = [];
      if (markersOk) parts.push(`${markersOk} marker${markersOk === 1 ? "" : "s"}`);
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
    const failTotal = markersFail;

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
    if (failTotal > 0) {
      desc.push(`${failTotal} marker${failTotal === 1 ? "" : "s"} failed.`);
    }
    if (reassignFails > 0) {
      desc.push(
        `· ${reassignFails} reassignment${reassignFails === 1 ? "" : "s"} failed — some existing markers may remain unlinked.`,
      );
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
    qc,
    terrain,
    markerType,
    bounds,
    toast,
    onClose,
    postMarkers,
    matchedSave,
    matchedBbox,
    reassignExisting,
    existingUnassigned,
    patchMarkersId,
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
           maxWidth: "calc(100vw - 16px)",
           maxHeight: "calc(100dvh - 16px)",
          overflow: "auto",
           overscrollBehavior: "contain",
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
                 : isStalled
                   ? "Import stalled — cancel to recover"
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

        <div style={{ padding: "12px max(12px, env(safe-area-inset-right)) 16px max(12px, env(safe-area-inset-left))" }}>
          {phase.kind === "pick" && (
            <>
              <p style={{ margin: "0 0 10px", color: "#e2e8f0", lineHeight: 1.5 }}>
                Pick a <strong style={{ color: "#cbd5e1" }}>.gpx, .kml, .kmz, .csv, or .xlsx</strong> file <span style={{ color: "#94a3b8", fontWeight: 400 }}>(legacy .xls not supported)</span>.{" "}
                {bounds
                  ? "Points outside this dataset's bounding box will be skipped automatically."
                  : "All points will be saved as unassigned markers. After parsing, matching datasets from your library will be suggested."}
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
              <div data-testid="gps-import-parse-progress" aria-live="polite">
                Parsing <strong>{phase.fileName}</strong>…
              </div>
              {importProgress && (
                <div
                  role="progressbar"
                  aria-valuenow={importProgress.markersDone}
                  aria-valuemin={0}
                  aria-valuemax={importProgress.markersTotal}
                  aria-label="Parsing spreadsheet"
                  style={{
                    height: 6,
                    background: "rgba(0,229,255,0.12)",
                    borderRadius: 3,
                    overflow: "hidden",
                    margin: "16px auto 0",
                    maxWidth: 320,
                  }}
                >
                  <div
                    style={{
                      width: `${importProgress.markersTotal > 0 ? Math.round((importProgress.markersDone / importProgress.markersTotal) * 100) : 10}%`,
                      height: "100%",
                      background: "#00e5ff",
                      transition: "width 120ms linear",
                    }}
                  />
                </div>
              )}
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
              removeWaypoint={removeWaypoint}
              renameRoute={renameRoute}
              removeRoutePoint={removeRoutePoint}
              removeRoute={removeRoute}
              closeRouteLoop={(index) => updateParsed((p) => ({
                ...p,
                routes: p.routes.map((r, i) =>
                  i === index && r.points.length >= 2 && (r.points[0]!.lat !== r.points[r.points.length - 1]!.lat || r.points[0]!.lon !== r.points[r.points.length - 1]!.lon)
                    ? { ...r, points: [...r.points, { ...r.points[0]! }] }
                    : r,
                ),
              }))}
              isSignedIn={true}
              routeDatasetId={terrain?.datasetId ?? matchedSave?.datasetId ?? null}
              onCancel={onClose}
              onConfirm={() => void doImport()}
              isImporting={isImporting}
              onEditMapping={phase.meta.columns.length > 0 ? onEditMapping : undefined}
              matchingSaves={matchingSaves}
              mySavesLoading={mySavesLoading}
              matchedSave={matchedSave}
              setMatchedSave={setMatchedSave}
              existingUnassignedCount={existingUnassignedCount}
              reassignExisting={reassignExisting}
              setReassignExisting={setReassignExisting}
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
                         {isStalled ? "Cancel and recover" : "Cancel import"}
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
  removeWaypoint: (idx: number) => void;
  renameRoute: (idx: number, name: string) => void;
  removeRoutePoint: (routeIdx: number, pointIdx: number) => void;
  removeRoute: (idx: number) => void;
  closeRouteLoop: (idx: number) => void;
  isSignedIn: boolean;
  routeDatasetId: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  isImporting: boolean;
  /** Present only for CSV/Excel imports; opens the column-mapping step. */
  onEditMapping?: () => void;
  /** Dataset-free mode: saves whose coverage overlaps the imported points. */
  matchingSaves?: UserCatalogSave[];
  mySavesLoading?: boolean;
  matchedSave?: UserCatalogSave | null;
  setMatchedSave?: (s: UserCatalogSave | null) => void;
  existingUnassignedCount?: number;
  reassignExisting?: boolean;
  setReassignExisting?: (v: boolean) => void;
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
  removeWaypoint,
  renameRoute,
  removeRoutePoint,
  removeRoute,
  closeRouteLoop,
  isSignedIn,
  routeDatasetId,
  onCancel,
  onConfirm,
  isImporting,
  onEditMapping,
  matchingSaves,
  mySavesLoading,
  matchedSave,
  setMatchedSave,
  existingUnassignedCount,
  reassignExisting,
  setReassignExisting,
}) => {
  const { parsed, original } = phase;
  const insideWpCount = parsed.waypoints.length;
  const insideRouteCount = parsed.routes.length;
  const totalInside = countPoints(parsed);
  const hasBounds = !!bounds;

  const importDisabled =
    (!importWaypoints || insideWpCount === 0);

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

      {!bounds && (
        <DatasetMatcherSection
          matchingSaves={matchingSaves ?? []}
          loading={mySavesLoading ?? false}
          matchedSave={matchedSave ?? null}
          onSelect={setMatchedSave ?? (() => {})}
          existingUnassignedCount={existingUnassignedCount ?? 0}
          reassignExisting={reassignExisting ?? true}
          setReassignExisting={setReassignExisting ?? (() => {})}
        />
      )}

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
           Review {insideRouteCount} imported navigation route
          {insideRouteCount === 1 ? "" : "s"} below
        </label>
      )}

      {insideRouteCount > 0 && importRoutes && (
        <>
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
                 key={r.id ?? `route-${ri}`}
                route={r}
                index={ri}
                renameRoute={renameRoute}
                removeRoutePoint={removeRoutePoint}
                removeRoute={removeRoute}
                 closeRouteLoop={closeRouteLoop}
                 isSignedIn={isSignedIn}
                 datasetId={routeDatasetId}
                 bounds={bounds}
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
// Dataset matcher section (dataset-free import only)
// ---------------------------------------------------------------------------

const DatasetMatcherSection: React.FC<{
  matchingSaves: UserCatalogSave[];
  loading: boolean;
  matchedSave: UserCatalogSave | null;
  onSelect: (save: UserCatalogSave | null) => void;
  existingUnassignedCount: number;
  reassignExisting: boolean;
  setReassignExisting: (v: boolean) => void;
}> = ({
  matchingSaves,
  loading,
  matchedSave,
  onSelect,
  existingUnassignedCount,
  reassignExisting,
  setReassignExisting,
}) => {
  return (
    <details
      open
      data-testid="gps-import-dataset-matcher"
      style={{
        border: "1px solid rgba(0,229,255,0.18)",
        borderRadius: 4,
        marginBottom: 12,
        background: "rgba(0,229,255,0.02)",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          padding: "6px 10px",
          color: "#67e8f9",
          fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
          letterSpacing: "0.12em",
        }}
      >
        ASSIGN TO A SAVED DATASET
      </summary>
      <div style={{ padding: "6px 10px 10px" }}>
        {loading ? (
          <div
            data-testid="gps-import-saves-loading"
            style={{ color: "#94a3b8", fontSize: "calc(14px * var(--bs-font-scale, 1))" }}
          >
            Checking your saved datasets…
          </div>
        ) : matchingSaves.length === 0 ? (
          <div
            data-testid="gps-import-no-matching-saves"
            style={{ color: "#94a3b8", fontSize: "calc(14px * var(--bs-font-scale, 1))" }}
          >
            No matching saved datasets found — points will be saved as unassigned.
          </div>
        ) : (
          <div role="radiogroup" aria-label="Assign imported points to a saved dataset">
            {matchingSaves.map((save) => {
              const name = save.displayLabel ?? save.catalog?.name ?? save.catalogId;
              return (
                <label
                  key={save.id}
                  data-testid={`gps-import-save-option-${save.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                    cursor: "pointer",
                    fontSize: "calc(14px * var(--bs-font-scale, 1))",
                    color: "#e2e8f0",
                  }}
                >
                  <input
                    type="radio"
                    name="gps-import-save-select"
                    checked={matchedSave?.id === save.id}
                    onChange={() => onSelect(save)}
                    data-testid={`gps-import-save-radio-${save.id}`}
                  />
                  {name}
                </label>
              );
            })}
            <label
              data-testid="gps-import-save-option-none"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                fontSize: "calc(14px * var(--bs-font-scale, 1))",
                color: "#94a3b8",
              }}
            >
              <input
                type="radio"
                name="gps-import-save-select"
                checked={matchedSave === null}
                onChange={() => onSelect(null)}
                data-testid="gps-import-save-radio-none"
              />
              None – save as unassigned
            </label>
          </div>
        )}

        {matchedSave !== null && existingUnassignedCount > 0 && (
          <label
            data-testid="gps-import-reassign-existing"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 8,
              cursor: "pointer",
              fontSize: "calc(14px * var(--bs-font-scale, 1))",
              color: "#e2e8f0",
            }}
          >
            <input
              type="checkbox"
              checked={reassignExisting}
              onChange={(e) => setReassignExisting(e.target.checked)}
            />
            Also reassign {existingUnassignedCount} existing unassigned marker
            {existingUnassignedCount === 1 ? "" : "s"} in this area
          </label>
        )}
      </div>
    </details>
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
  closeRouteLoop: (idx: number) => void;
  isSignedIn: boolean;
  datasetId: string | null;
  bounds?: Bounds;
}> = ({ route, index, renameRoute, removeRoutePoint, removeRoute, closeRouteLoop, isSignedIn, datasetId, bounds }) => {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const tooShort = route.points.length < 2;
  const first = route.points[0];
  const last = route.points[route.points.length - 1];
  const isClosed = !!first && !!last && first.lat === last.lat && first.lon === last.lon;

  const save = async () => {
    if (!selected || status === "saving" || status === "saved") return;
    if (!isSignedIn) {
      setError("Sign in to save navigation routes.");
      setStatus("error");
      return;
    }
    if (!datasetId) {
      setError("Load a dataset before saving this navigation route.");
      setStatus("error");
      return;
    }
    const points = bounds
      ? route.points.filter((p) => isInBounds(p.lon, p.lat, bounds))
      : route.points;
    if (points.length < 2) {
      setError("This route has fewer than 2 points in the active dataset.");
      setStatus("error");
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const res = await authorizedFetch(`${(import.meta.env.BASE_URL as string).replace(/\/$/, "")}/api/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId,
          name: sanitize(clamp(route.name || "Imported route", TROLLING_NAME_MAX)) || "Imported route",
          waypoints: downsample(points, SAVED_ROUTE_WAYPOINTS_MAX).map((p) => ({
            lon: p.lon,
            lat: p.lat,
            depth: 0,
          })),
          totalDistanceM: routeDistanceM(points),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { details?: string };
        throw new Error(body.details || `Save failed (${res.status})`);
      }
      void qc.invalidateQueries({ queryKey: ["routes", datasetId] });
      setStatus("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed — please try again.");
      setStatus("error");
    }
  };

  const closeLoop = () => {
    if (tooShort || isClosed || closed) return;
    closeRouteLoop(index);
    setClosed(true);
  };

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
          type="checkbox"
          checked={selected}
          onChange={(e) => setSelected(e.target.checked)}
          aria-label={`Select route ${route.name || index + 1}`}
          data-testid={`gps-import-select-route-${index}`}
          onClick={(e) => e.stopPropagation()}
          style={{ flex: "none" }}
        />
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
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "4px 8px 2px" }}>
        <button
          type="button"
          onClick={closeLoop}
          disabled={tooShort || isClosed || closed || status === "saving"}
          data-testid={`gps-import-close-loop-${index}`}
          aria-label={`Close loop for route ${route.name || index + 1}`}
          style={btnStyle("ghost")}
        >
          {isClosed || closed ? "LOOP CLOSED" : "CLOSE LOOP"}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!selected || tooShort || status === "saving" || status === "saved"}
          data-testid={`gps-import-save-route-${index}`}
          aria-label={`Save navigation route ${route.name || index + 1}`}
          style={btnStyle("primary")}
        >
          {status === "saving" ? "SAVING…" : status === "saved" ? "SAVED ROUTE" : "SAVE ROUTE"}
        </button>
        <button
          type="button"
          onClick={() => removeRoute(index)}
          disabled={status === "saving"}
          data-testid={`gps-import-discard-route-${index}`}
          aria-label={`Discard imported route ${route.name || index + 1}`}
          style={removeBtnStyle}
        >
          DISCARD
        </button>
      </div>
      {error && (
        <div role="alert" style={{ padding: "3px 8px 5px", color: "#f87171", fontSize: "calc(14px * var(--bs-font-scale, 1))" }}>
          {error} {status === "error" && <button type="button" onClick={() => void save()} style={removeBtnStyle}>RETRY</button>}
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
  const mapLongitude = useCallback(
    (lon: number) => (bounds.minLon > bounds.maxLon && lon < bounds.minLon ? lon + 360 : lon),
    [bounds],
  );

  // Compute drawing bounds = dataset bbox union all points, with a 5% pad on
  // each side so points right on the edge are visible.
  const viewBox = useMemo(() => {
    let minLon = bounds.minLon;
    let maxLon = bounds.minLon > bounds.maxLon ? bounds.maxLon + 360 : bounds.maxLon;
    let minLat = bounds.minLat;
    let maxLat = bounds.maxLat;
    const visit = (lon: number, lat: number) => {
      lon = mapLongitude(lon);
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
  }, [original, bounds, mapLongitude]);

  const innerW = MAP_WIDTH - MAP_PAD * 2;
  const innerH = MAP_HEIGHT - MAP_PAD * 2;
  const lonSpan = viewBox.maxLon - viewBox.minLon;
  const latSpan = viewBox.maxLat - viewBox.minLat;

  const project = useCallback(
    (lon: number, lat: number): [number, number] => {
      lon = mapLongitude(lon);
      const x = MAP_PAD + ((lon - viewBox.minLon) / lonSpan) * innerW;
      // SVG Y grows downward; latitude grows upward → flip.
      const y = MAP_PAD + (1 - (lat - viewBox.minLat) / latSpan) * innerH;
      return [x, y];
    },
    [viewBox, lonSpan, latSpan, innerW, innerH, mapLongitude],
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
