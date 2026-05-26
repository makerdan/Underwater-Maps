/**
 * WeatherPanel — HTML overlay for Drift Planner showing wind, tidal, and wave
 * conditions. Fetches 24 h of surface conditions from /api/surface-conditions
 * using the terrain centre as the query point.
 *
 * When conditions are unavailable (estimatedConditions=true) it shows manual
 * override sliders so the user can still plan a drift.
 */

import React, { useEffect, useCallback, useRef, useState } from "react";
import {
  useGetTrollingPresets,
  usePostTrollingPresets,
  usePatchTrollingPresetsId,
  useDeleteTrollingPresetsId,
  getGetTrollingPresetsQueryKey,
  useGetTrollingPresetFolders,
  usePostTrollingPresetFolders,
  usePatchTrollingPresetFoldersId,
  useDeleteTrollingPresetFoldersId,
  getGetTrollingPresetFoldersQueryKey,
  type TrollingPreset,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppState } from "@/lib/context";
import { useDriftStore, TROLL_MAX_KNOTS } from "@/lib/driftStore";
import { computeDrift } from "@/lib/computeDrift";
import { useSurfaceConditions } from "@/hooks/useSurfaceConditions";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

// Undo window for "soft" trolling-preset deletes (ms). The preset is hidden
// from the list immediately and the actual DELETE only fires when the
// window elapses, so a misclick can still be reverted by clicking "Undo".
const UNDO_DELETE_WINDOW_MS = 5000;

interface CompassProps {
  degrees: number;
  size?: number;
  color?: string;
}

const Compass: React.FC<CompassProps> = ({ degrees, size = 40, color = "#00e5ff" }) => {
  const rad = ((degrees - 90) * Math.PI) / 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.35;
  const tipX = cx + r * Math.cos(rad);
  const tipY = cy + r * Math.sin(rad);
  const tailX = cx - r * 0.55 * Math.cos(rad);
  const tailY = cy - r * 0.55 * Math.sin(rad);
  const perpX = -Math.sin(rad) * r * 0.18;
  const perpY = Math.cos(rad) * r * 0.18;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={size * 0.44} stroke="rgba(0,229,255,0.15)" strokeWidth={1} fill="none" />
      {[0, 90, 180, 270].map((a, i) => {
        const ar = ((a - 90) * Math.PI) / 180;
        const label = ["N", "E", "S", "W"][i];
        return (
          <text
            key={a}
            x={cx + (size * 0.38) * Math.cos(ar)}
            y={cy + (size * 0.38) * Math.sin(ar) + 3}
            textAnchor="middle"
            fontSize={size * 0.14}
            fill="rgba(0,229,255,0.4)"
          >{label}</text>
        );
      })}
      <polygon
        points={`${tipX},${tipY} ${tailX + perpX},${tailY + perpY} ${tailX - perpX},${tailY - perpY}`}
        fill={color}
        opacity={0.9}
      />
    </svg>
  );
};

function degToCardinal(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16]!;
}

const PANEL_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 56,
  right: 16,
  zIndex: 50,
  background: "rgba(0,8,20,0.92)",
  border: "1px solid rgba(0,229,255,0.2)",
  borderRadius: 8,
  padding: "12px 14px",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  color: "#94a3b8",
  letterSpacing: "0.06em",
  backdropFilter: "blur(8px)",
  minWidth: 220,
  maxWidth: 260,
  pointerEvents: "auto",
};

const LABEL: React.CSSProperties = { color: "#475569", fontSize: 9, letterSpacing: "0.18em" };
const VALUE: React.CSSProperties = { color: "#00e5ff", fontWeight: 700 };
const DIVIDER: React.CSSProperties = { borderTop: "1px solid rgba(0,229,255,0.1)", margin: "8px 0" };

interface WeatherPanelProps {
  onClose: () => void;
}

export const WeatherPanel: React.FC<WeatherPanelProps> = ({ onClose }) => {
  const { terrain } = useAppState();
  const {
    driftConditions,
    setDriftConditions,
    setDriftPath,
    setEstimatedConditions,
    estimatedConditions,
    driftHour,
    driftStartLat,
    driftStartLon,
    setDriftStart,
    lineLengthM,
    setLineLengthM,
    manualWindSpeedKnots,
    setManualWindSpeedKnots,
    manualWindDegrees,
    setManualWindDegrees,
    manualTidalSpeedKnots,
    setManualTidalSpeedKnots,
    manualTidalDegrees,
    setManualTidalDegrees,
    manualSlackNow,
    setManualSlackNow,
    driftMode,
    setDriftMode,
    boatHeadingDeg,
    setBoatHeadingDeg,
    boatSpeedKnots,
    setBoatSpeedKnots,
    driftWaypoints,
    removeDriftWaypoint,
    moveDriftWaypoint,
    clearDriftWaypoints,
    setDriftWaypoints,
  } = useDriftStore();

  const queryClient = useQueryClient();
  const presetsQueryKey = getGetTrollingPresetsQueryKey();
  const foldersQueryKey = getGetTrollingPresetFoldersQueryKey();
  const { data: trollingPresets } = useGetTrollingPresets({
    query: { queryKey: presetsQueryKey, staleTime: 60 * 1000 },
  });
  const { data: presetFolders } = useGetTrollingPresetFolders({
    query: { queryKey: foldersQueryKey, staleTime: 60 * 1000 },
  });
  const postPresetMutation = usePostTrollingPresets();
  const patchPresetMutation = usePatchTrollingPresetsId();
  const deletePresetMutation = useDeleteTrollingPresetsId();
  const postFolderMutation = usePostTrollingPresetFolders();
  const patchFolderMutation = usePatchTrollingPresetFoldersId();
  const deleteFolderMutation = useDeleteTrollingPresetFoldersId();
  const [presetName, setPresetName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  // Folder UI state. Save target controls which folder a new preset will
  // land in (null = root). Collapsed folder ids are remembered locally so
  // groups can be expanded/collapsed without a server round-trip.
  const [saveFolderId, setSaveFolderId] = useState<string | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set());
  const [folderRootCollapsed, setFolderRootCollapsed] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");

  const handleSavePreset = useCallback(async () => {
    const trimmed = presetName.trim();
    if (!trimmed) {
      setPresetError("Name required");
      return;
    }
    setPresetError(null);
    try {
      await postPresetMutation.mutateAsync({
        data: {
          name: trimmed,
          headingDeg: Math.round(boatHeadingDeg),
          speedKnots: Math.max(0, Math.min(TROLL_MAX_KNOTS, boatSpeedKnots)),
          startLat: driftStartLat,
          startLon: driftStartLon,
          waypoints: driftWaypoints.map((wp) => ({ lat: wp.lat, lon: wp.lon })),
          folderId: saveFolderId,
        },
      });
      setPresetName("");
      await queryClient.invalidateQueries({ queryKey: presetsQueryKey });
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : "Save failed");
    }
  }, [presetName, postPresetMutation, boatHeadingDeg, boatSpeedKnots, driftStartLat, driftStartLon, driftWaypoints, saveFolderId, queryClient, presetsQueryKey]);

  const handleCreateFolder = useCallback(async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setFolderError("Name required");
      return;
    }
    setFolderError(null);
    try {
      await postFolderMutation.mutateAsync({ data: { name: trimmed } });
      setNewFolderName("");
      await queryClient.invalidateQueries({ queryKey: foldersQueryKey });
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Create failed");
    }
  }, [newFolderName, postFolderMutation, queryClient, foldersQueryKey]);

  const handleStartFolderRename = useCallback((id: string, currentName: string) => {
    setEditingFolderId(id);
    setEditingFolderName(currentName);
  }, []);

  const handleCancelFolderRename = useCallback(() => {
    setEditingFolderId(null);
    setEditingFolderName("");
  }, []);

  const handleCommitFolderRename = useCallback(async () => {
    if (!editingFolderId) return;
    const trimmed = editingFolderName.trim();
    if (!trimmed) {
      handleCancelFolderRename();
      return;
    }
    try {
      await patchFolderMutation.mutateAsync({ id: editingFolderId, data: { name: trimmed } });
      await queryClient.invalidateQueries({ queryKey: foldersQueryKey });
    } catch {
      // no-op; query will refetch
    } finally {
      handleCancelFolderRename();
    }
  }, [editingFolderId, editingFolderName, patchFolderMutation, queryClient, foldersQueryKey, handleCancelFolderRename]);

  const handleDeleteFolder = useCallback(async (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("Delete this folder? Presets inside will move back to the root list.")) {
      return;
    }
    try {
      await deleteFolderMutation.mutateAsync({ id });
      if (saveFolderId === id) setSaveFolderId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: foldersQueryKey }),
        queryClient.invalidateQueries({ queryKey: presetsQueryKey }),
      ]);
    } catch {
      // no-op
    }
  }, [deleteFolderMutation, saveFolderId, queryClient, foldersQueryKey, presetsQueryKey]);

  const handleAssignPresetToFolder = useCallback(async (presetId: string, folderId: string | null) => {
    try {
      await patchPresetMutation.mutateAsync({ id: presetId, data: { folderId } });
      await queryClient.invalidateQueries({ queryKey: presetsQueryKey });
    } catch {
      // no-op
    }
  }, [patchPresetMutation, queryClient, presetsQueryKey]);

  const toggleFolderCollapsed = useCallback((id: string) => {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleLoadPreset = useCallback((presetId: string) => {
    const preset = trollingPresets?.find((p) => p.id === presetId);
    if (!preset) return;
    setBoatHeadingDeg(preset.headingDeg);
    setBoatSpeedKnots(preset.speedKnots);
    if (preset.startLat != null && preset.startLon != null) {
      setDriftStart(preset.startLat, preset.startLon);
    }
    setDriftWaypoints(
      Array.isArray(preset.waypoints)
        ? preset.waypoints.map((wp) => ({ lat: wp.lat, lon: wp.lon }))
        : [],
    );
    setDriftMode("trolling");
  }, [trollingPresets, setBoatHeadingDeg, setBoatSpeedKnots, setDriftStart, setDriftWaypoints, setDriftMode]);

  // ─── Soft-delete (undo) state ────────────────────────────────────────────
  // Preset ids hidden from the list while their 5s undo window is still
  // open. The actual DELETE only fires when the window elapses, so a
  // misclick can be reverted by clicking "Undo".
  const [pendingDeletePresetIds, setPendingDeletePresetIds] = useState<
    Set<string>
  >(() => new Set());
  const pendingDeletesRef = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>(),
  );
  const { toast } = useToast();

  const handleDeletePreset = useCallback((presetId: string) => {
    const preset = trollingPresets?.find((p) => p.id === presetId);
    if (!preset) return;
    const snapshot = queryClient.getQueryData<TrollingPreset[]>(presetsQueryKey);

    // Hide the row immediately by removing it from the cache so other
    // consumers of this query (and this list) reflect the pending delete.
    queryClient.setQueryData<TrollingPreset[] | undefined>(presetsQueryKey, (prev) =>
      prev ? prev.filter((p) => p.id !== presetId) : prev,
    );
    setPendingDeletePresetIds((s) => new Set(s).add(presetId));

    const commit = () => {
      pendingDeletesRef.current.delete(presetId);
      deletePresetMutation.mutate(
        { id: presetId },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: presetsQueryKey });
          },
          onError: () => {
            // Restore the list on failure so the user can retry.
            if (snapshot !== undefined) {
              queryClient.setQueryData(presetsQueryKey, snapshot);
            }
          },
          onSettled: () => {
            setPendingDeletePresetIds((s) => {
              if (!s.has(presetId)) return s;
              const next = new Set(s);
              next.delete(presetId);
              return next;
            });
          },
        },
      );
    };

    const undo = () => {
      const entry = pendingDeletesRef.current.get(presetId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pendingDeletesRef.current.delete(presetId);
      if (snapshot !== undefined) {
        queryClient.setQueryData(presetsQueryKey, snapshot);
      }
      setPendingDeletePresetIds((s) => {
        const next = new Set(s);
        next.delete(presetId);
        return next;
      });
    };

    const timer = setTimeout(commit, UNDO_DELETE_WINDOW_MS);
    pendingDeletesRef.current.set(presetId, {
      timer,
      commit: () => {
        clearTimeout(timer);
        commit();
      },
    });

    const toastHandle = toast({
      title: "Trolling course deleted",
      description: `"${preset.name}" will be removed.`,
      duration: UNDO_DELETE_WINDOW_MS,
      action: (
        <ToastAction
          altText="Undo delete"
          data-testid="undo-delete-trolling-preset"
          onClick={() => {
            undo();
            toastHandle.dismiss();
          }}
        >
          Undo
        </ToastAction>
      ),
    });
  }, [trollingPresets, deletePresetMutation, queryClient, presetsQueryKey, toast]);

  // Flush any open undo windows on unmount so the server eventually
  // receives the DELETE even if the user closes the Drift Planner.
  useEffect(() => {
    const map = pendingDeletesRef.current;
    return () => {
      const entries = Array.from(map.values());
      map.clear();
      for (const entry of entries) entry.commit();
    };
  }, []);
  // pendingDeletePresetIds drives this effect indirectly via React Query
  // cache updates; we reference it so eslint sees the dependency.
  void pendingDeletePresetIds;

  const handleStartRename = useCallback((presetId: string, currentName: string) => {
    setEditingPresetId(presetId);
    setEditingName(currentName);
  }, []);

  const handleCancelRename = useCallback(() => {
    setEditingPresetId(null);
    setEditingName("");
  }, []);

  const handleCommitRename = useCallback(async () => {
    if (!editingPresetId) return;
    const trimmed = editingName.trim();
    if (!trimmed) {
      handleCancelRename();
      return;
    }
    try {
      await patchPresetMutation.mutateAsync({ id: editingPresetId, data: { name: trimmed } });
      await queryClient.invalidateQueries({ queryKey: presetsQueryKey });
    } catch {
      // no-op; query will refetch on next visit
    } finally {
      handleCancelRename();
    }
  }, [editingPresetId, editingName, patchPresetMutation, queryClient, presetsQueryKey, handleCancelRename]);

  const handleMovePresetInFolder = useCallback(async (
    folderId: string | null,
    presetId: string,
    delta: -1 | 1,
  ) => {
    if (!trollingPresets) return;
    // Reorder only within the same folder bucket so visual moves don't
    // accidentally hop a preset across folders. We rewrite sortOrder for
    // every preset in that bucket as a contiguous 0..N-1 sequence.
    const inFolder = trollingPresets.filter(
      (p) => (p.folderId ?? null) === folderId,
    );
    const idx = inFolder.findIndex((p) => p.id === presetId);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= inFolder.length) return;
    const reordered = [...inFolder];
    const a = reordered[idx];
    const b = reordered[target];
    if (!a || !b) return;
    [reordered[idx], reordered[target]] = [b, a];

    // Optimistic update so the list doesn't snap back during the round-trip.
    const next = trollingPresets.map((p) => {
      const newIndex = reordered.findIndex((r) => r.id === p.id);
      return newIndex >= 0 ? { ...p, sortOrder: newIndex } : p;
    });
    queryClient.setQueryData(presetsQueryKey, next);
    try {
      await Promise.all(
        reordered.map((p, i) =>
          p.sortOrder === i
            ? Promise.resolve()
            : patchPresetMutation.mutateAsync({ id: p.id, data: { sortOrder: i } }),
        ),
      );
    } finally {
      await queryClient.invalidateQueries({ queryKey: presetsQueryKey });
    }
  }, [trollingPresets, patchPresetMutation, queryClient, presetsQueryKey]);

  const centerLat = terrain ? (terrain.minLat + terrain.maxLat) / 2 : 0;
  const centerLon = terrain ? (terrain.minLon + terrain.maxLon) / 2 : 0;

  // Shared surface-conditions hook — same query key as the always-on overlays,
  // so React Query dedupes and Drift Planner stays in sync with WIND/TIDE/CURRENT.
  const { data, hours: sharedHours, loading: isLoading, error: isError, estimated, refetch } =
    useSurfaceConditions(!!terrain);

  // Single source of truth for the auto-drift recompute. Every input that
  // feeds computeDrift is captured in the dependency list so moving the
  // start point, changing line length, or any other driver retriggers the
  // calculation immediately — the timeline and "bottom in reach" readout
  // never trail the inputs.
  const recomputeAutoDrift = useCallback(() => {
    if (!sharedHours.length || !terrain) return;
    const hoursForStore = sharedHours.map(({ tideRising: _r, ...rest }) => rest) as
      import("@/lib/driftStore").HourlySurfaceCondition[];
    setDriftConditions(hoursForStore);
    setEstimatedConditions(estimated);

    const startLat = driftStartLat ?? centerLat;
    const startLon = driftStartLon ?? centerLon;
    if (driftStartLat === null) setDriftStart(centerLat, centerLon);

    const path = computeDrift({
      conditions: hoursForStore,
      startLat,
      startLon,
      lineLengthM,
      lineWeightG: 500,
      terrain,
      mode: driftMode,
      boatHeadingDeg,
      boatSpeedKnots,
      trollWaypoints: driftWaypoints,
    });
    setDriftPath(path);
  }, [
    sharedHours, estimated, terrain,
    driftStartLat, driftStartLon, centerLat, centerLon,
    lineLengthM, driftMode, boatHeadingDeg, boatSpeedKnots, driftWaypoints,
    setDriftConditions, setEstimatedConditions, setDriftStart, setDriftPath,
  ]);

  useEffect(() => {
    recomputeAutoDrift();
  }, [recomputeAutoDrift]);

  // Single source of truth for the manual-override recompute. Every input
  // that feeds computeDrift is captured in the dependency list — including
  // the "slack now" toggle and the store setters — so manual wind/tide
  // changes flow into the drift path and timeline immediately instead of
  // waiting for another render to catch up.
  const recomputeWithManual = useCallback(() => {
    if (!terrain) return;
    const tidalSpeed = manualSlackNow ? 0 : manualTidalSpeedKnots;
    const manualConditions = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      windSpeedKnots: manualWindSpeedKnots,
      windDegrees: manualWindDegrees,
      tidalSpeedKnots: tidalSpeed,
      tidalDegrees: manualTidalDegrees,
      waveHeightM: 0.3,
      isSlack: manualSlackNow,
      phase: manualSlackNow ? ("slack-high" as const) : undefined,
    }));
    setDriftConditions(manualConditions);
    const startLat = driftStartLat ?? centerLat;
    const startLon = driftStartLon ?? centerLon;
    const path = computeDrift({
      conditions: manualConditions,
      startLat,
      startLon,
      lineLengthM,
      lineWeightG: 500,
      terrain,
      mode: driftMode,
      boatHeadingDeg,
      boatSpeedKnots,
      trollWaypoints: driftWaypoints,
    });
    setDriftPath(path);
  }, [
    terrain,
    manualWindSpeedKnots, manualWindDegrees,
    manualTidalSpeedKnots, manualTidalDegrees, manualSlackNow,
    driftStartLat, driftStartLon, centerLat, centerLon,
    lineLengthM, driftMode, boatHeadingDeg, boatSpeedKnots, driftWaypoints,
    setDriftConditions, setDriftPath,
  ]);

  // Auto-rerun manual recompute whenever its inputs change while the
  // manual-override UI is the active source (live data missing or
  // estimated). Mirrors the auto-drift useEffect above so the readout
  // stays in lockstep with the sliders.
  const manualOverrideActive = isError || estimatedConditions;
  useEffect(() => {
    if (!manualOverrideActive) return;
    recomputeWithManual();
  }, [manualOverrideActive, recomputeWithManual]);

  const cond = driftConditions?.[driftHour];

  const sliderStyle: React.CSSProperties = {
    width: "100%",
    accentColor: "#00e5ff",
    cursor: "pointer",
  };

  return (
    <div style={PANEL_STYLE}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ ...VALUE, fontSize: 11, letterSpacing: "0.15em" }}>⛵ DRIFT PLANNER</span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 14, padding: "0 2px" }}
        >×</button>
      </div>

      {isLoading && (
        <div style={{ color: "#22d3ee", fontSize: 9, letterSpacing: "0.12em", marginBottom: 8 }}>
          ↻ Fetching conditions…
        </div>
      )}

      {(isError || estimatedConditions) && (
        <div style={{ color: "#fbbf24", fontSize: 9, letterSpacing: "0.1em", marginBottom: 8, padding: "4px 6px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 4 }}>
          ⚠ Using estimated conditions
        </div>
      )}

      {cond && !estimatedConditions && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Compass degrees={cond.windDegrees} size={42} color="#7dd3fc" />
            <div>
              <div style={LABEL}>WIND</div>
              <div style={{ ...VALUE, color: "#7dd3fc" }}>{cond.windSpeedKnots.toFixed(1)} kt</div>
              <div style={{ fontSize: 9, color: "#475569" }}>{degToCardinal(cond.windDegrees)} {Math.round(cond.windDegrees)}°</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Compass degrees={cond.tidalDegrees} size={42} color="#34d399" />
            <div>
              <div style={LABEL}>TIDAL CURRENT</div>
              <div style={{ ...VALUE, color: "#34d399" }}>{cond.tidalSpeedKnots.toFixed(1)} kt</div>
              <div style={{ fontSize: 9, color: "#475569" }}>{degToCardinal(cond.tidalDegrees)} {Math.round(cond.tidalDegrees)}°</div>
              {data?.tidalDataSource === "noaa-coops" && data.tidalStationName ? (
                <div
                  data-testid="tidal-source"
                  style={{ fontSize: 8, color: "#64748b", marginTop: 2, letterSpacing: "0.05em" }}
                  title={`NOAA CO-OPS station ${data.tidalStationId ?? ""}`}
                >
                  NOAA: {data.tidalStationName}
                  {typeof data.tidalStationDistanceKm === "number"
                    ? ` (${data.tidalStationDistanceKm.toFixed(1)} km away)`
                    : ""}
                </div>
              ) : (
                <div
                  data-testid="tidal-source"
                  style={{ fontSize: 8, color: "#64748b", marginTop: 2, letterSpacing: "0.05em", fontStyle: "italic" }}
                >
                  Estimated (no NOAA station nearby)
                </div>
              )}
            </div>
          </div>
          <div>
            <span style={LABEL}>WAVE HEIGHT </span>
            <span style={{ ...VALUE, color: "#60a5fa" }}>{cond.waveHeightM.toFixed(2)} m</span>
          </div>
        </div>
      )}

      <div style={DIVIDER} />

      {/* Mode toggle: Drift vs Trolling */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ ...LABEL, marginBottom: 4 }}>MODE</div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["drift", "trolling"] as const).map((m) => {
            const active = driftMode === m;
            return (
              <button
                key={m}
                onClick={() => setDriftMode(m)}
                style={{
                  flex: 1,
                  background: active ? "rgba(0,229,255,0.15)" : "rgba(0,10,20,0.8)",
                  border: `1px solid ${active ? "rgba(0,229,255,0.5)" : "rgba(0,229,255,0.15)"}`,
                  color: active ? "#00e5ff" : "#475569",
                  fontFamily: "inherit",
                  fontSize: 9,
                  padding: "4px",
                  borderRadius: 3,
                  cursor: "pointer",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                {m === "drift" ? "⛵ DRIFT" : "🎣 TROLLING"}
              </button>
            );
          })}
        </div>
      </div>

      {driftMode === "trolling" && (
        <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(0,229,255,0.04)", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 4 }}>
          {driftWaypoints.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <Compass degrees={boatHeadingDeg} size={42} color="#fbbf24" />
              <div style={{ flex: 1 }}>
                <div style={LABEL}>BOAT HEADING</div>
                <div style={{ ...VALUE, color: "#fbbf24" }}>{degToCardinal(boatHeadingDeg)} {Math.round(boatHeadingDeg)}°</div>
                <input
                  data-testid="boat-heading-slider"
                  type="range"
                  min={0}
                  max={359}
                  value={boatHeadingDeg}
                  onChange={(e) => setBoatHeadingDeg(Number(e.target.value))}
                  style={sliderStyle}
                />
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 9, color: "#fbbf24", marginBottom: 6, letterSpacing: "0.1em" }}>
              ⇢ Heading auto-steered to waypoints
            </div>
          )}

          <div style={{ marginBottom: 6 }}>
            <div style={LABEL}>PRESETS</div>
            {(() => {
              const sortedFolders = [...(presetFolders ?? [])].sort((a, b) =>
                a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
              );
              const renderPresetRow = (p: NonNullable<typeof trollingPresets>[number], idxInGroup: number, groupLen: number, folderId: string | null) => {
                const isEditing = editingPresetId === p.id;
                const isFirst = idxInGroup === 0;
                const isLast = idxInGroup === groupLen - 1;
                return (
                  <div key={p.id} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <button
                        title="Move up"
                        aria-label={`Move preset ${p.name} up`}
                        disabled={isFirst}
                        onClick={() => void handleMovePresetInFolder(folderId, p.id, -1)}
                        style={{ background: "none", border: "1px solid rgba(0,229,255,0.2)", color: isFirst ? "#334155" : "#00e5ff", cursor: isFirst ? "default" : "pointer", fontSize: 8, padding: "0 3px", borderRadius: 2, lineHeight: 1.2 }}
                      >▲</button>
                      <button
                        title="Move down"
                        aria-label={`Move preset ${p.name} down`}
                        disabled={isLast}
                        onClick={() => void handleMovePresetInFolder(folderId, p.id, 1)}
                        style={{ background: "none", border: "1px solid rgba(0,229,255,0.2)", color: isLast ? "#334155" : "#00e5ff", cursor: isLast ? "default" : "pointer", fontSize: 8, padding: "0 3px", borderRadius: 2, lineHeight: 1.2 }}
                      >▼</button>
                    </div>
                    {isEditing ? (
                      <input
                        autoFocus
                        aria-label={`Rename preset ${p.name}`}
                        value={editingName}
                        maxLength={80}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => void handleCommitRename()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); void handleCommitRename(); }
                          else if (e.key === "Escape") { e.preventDefault(); handleCancelRename(); }
                        }}
                        style={{ flex: 1, background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.4)", color: "#00e5ff", fontFamily: "inherit", fontSize: 9, padding: "3px 6px", borderRadius: 3 }}
                      />
                    ) : (
                      <button
                        onClick={() => handleLoadPreset(p.id)}
                        title={`Load ${p.name}: ${Math.round(p.headingDeg)}° @ ${p.speedKnots}kt`}
                        style={{ flex: 1, textAlign: "left", background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontFamily: "inherit", fontSize: 9, padding: "3px 6px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.1em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {p.name} · {Math.round(p.headingDeg)}° @ {p.speedKnots}kt
                      </button>
                    )}
                    {sortedFolders.length > 0 && !isEditing && (
                      <select
                        aria-label={`Move preset ${p.name} to folder`}
                        title="Move to folder"
                        value={p.folderId ?? ""}
                        onChange={(e) => void handleAssignPresetToFolder(p.id, e.target.value === "" ? null : e.target.value)}
                        style={{ background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontFamily: "inherit", fontSize: 9, padding: "2px", borderRadius: 3, cursor: "pointer", maxWidth: 60 }}
                      >
                        <option value="">— root —</option>
                        {sortedFolders.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    )}
                    {!isEditing && (
                      <button
                        onClick={() => handleStartRename(p.id, p.name)}
                        aria-label={`Rename preset ${p.name}`}
                        title="Rename preset"
                        style={{ background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontFamily: "inherit", fontSize: 9, padding: "3px 6px", borderRadius: 3, cursor: "pointer" }}
                      >✎</button>
                    )}
                    <button
                      onClick={() => void handleDeletePreset(p.id)}
                      aria-label={`Delete preset ${p.name}`}
                      title="Delete preset"
                      style={{ background: "rgba(0,10,20,0.8)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontFamily: "inherit", fontSize: 9, padding: "3px 6px", borderRadius: 3, cursor: "pointer" }}
                    >×</button>
                  </div>
                );
              };

              const inRoot = (trollingPresets ?? []).filter((p) => !p.folderId);
              const totalPresets = trollingPresets?.length ?? 0;
              if (totalPresets === 0 && sortedFolders.length === 0) {
                return (
                  <div style={{ fontSize: 8, color: "#475569", marginTop: 2 }}>
                    No saved presets yet
                  </div>
                );
              }
              return (
                <div data-testid="preset-list" style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 3 }}>
                  {sortedFolders.map((folder) => {
                    const inFolder = (trollingPresets ?? []).filter((p) => p.folderId === folder.id);
                    const collapsed = collapsedFolderIds.has(folder.id);
                    const isEditingFolder = editingFolderId === folder.id;
                    return (
                      <div key={folder.id} data-testid={`preset-folder-${folder.id}`} style={{ border: "1px solid rgba(0,229,255,0.12)", borderRadius: 3, padding: "3px 4px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button
                            onClick={() => toggleFolderCollapsed(folder.id)}
                            aria-label={collapsed ? `Expand folder ${folder.name}` : `Collapse folder ${folder.name}`}
                            title={collapsed ? "Expand" : "Collapse"}
                            style={{ background: "none", border: "none", color: "#00e5ff", cursor: "pointer", fontSize: 10, padding: "0 4px" }}
                          >{collapsed ? "▸" : "▾"}</button>
                          {isEditingFolder ? (
                            <input
                              autoFocus
                              aria-label={`Rename folder ${folder.name}`}
                              value={editingFolderName}
                              maxLength={80}
                              onChange={(e) => setEditingFolderName(e.target.value)}
                              onBlur={() => void handleCommitFolderRename()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); void handleCommitFolderRename(); }
                                else if (e.key === "Escape") { e.preventDefault(); handleCancelFolderRename(); }
                              }}
                              style={{ flex: 1, background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.4)", color: "#fbbf24", fontFamily: "inherit", fontSize: 9, padding: "2px 6px", borderRadius: 3 }}
                            />
                          ) : (
                            <span style={{ flex: 1, color: "#fbbf24", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              📁 {folder.name} ({inFolder.length})
                            </span>
                          )}
                          {!isEditingFolder && (
                            <>
                              <button
                                onClick={() => handleStartFolderRename(folder.id, folder.name)}
                                aria-label={`Rename folder ${folder.name}`}
                                title="Rename folder"
                                style={{ background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontFamily: "inherit", fontSize: 9, padding: "2px 5px", borderRadius: 3, cursor: "pointer" }}
                              >✎</button>
                              <button
                                onClick={() => void handleDeleteFolder(folder.id)}
                                aria-label={`Delete folder ${folder.name}`}
                                title="Delete folder"
                                style={{ background: "rgba(0,10,20,0.8)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontFamily: "inherit", fontSize: 9, padding: "2px 5px", borderRadius: 3, cursor: "pointer" }}
                              >×</button>
                            </>
                          )}
                        </div>
                        {!collapsed && inFolder.length > 0 && (
                          <div data-testid={`preset-folder-${folder.id}-contents`} style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 3, paddingLeft: 8 }}>
                            {inFolder.map((p, i) => renderPresetRow(p, i, inFolder.length, folder.id))}
                          </div>
                        )}
                        {!collapsed && inFolder.length === 0 && (
                          <div style={{ fontSize: 8, color: "#475569", marginTop: 2, paddingLeft: 14, fontStyle: "italic" }}>
                            Empty
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Root (unfiled) presets — only show the header when folders exist */}
                  {sortedFolders.length > 0 ? (
                    <div data-testid="preset-folder-root" style={{ border: "1px dashed rgba(0,229,255,0.12)", borderRadius: 3, padding: "3px 4px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button
                          onClick={() => setFolderRootCollapsed((v) => !v)}
                          aria-label={folderRootCollapsed ? "Expand root presets" : "Collapse root presets"}
                          title={folderRootCollapsed ? "Expand" : "Collapse"}
                          style={{ background: "none", border: "none", color: "#00e5ff", cursor: "pointer", fontSize: 10, padding: "0 4px" }}
                        >{folderRootCollapsed ? "▸" : "▾"}</button>
                        <span style={{ flex: 1, color: "#64748b", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em" }}>
                          UNFILED ({inRoot.length})
                        </span>
                      </div>
                      {!folderRootCollapsed && inRoot.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 3, paddingLeft: 8 }}>
                          {inRoot.map((p, i) => renderPresetRow(p, i, inRoot.length, null))}
                        </div>
                      )}
                    </div>
                  ) : (
                    inRoot.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {inRoot.map((p, i) => renderPresetRow(p, i, inRoot.length, null))}
                      </div>
                    )
                  )}
                </div>
              );
            })()}

            {/* New-folder controls */}
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              <input
                type="text"
                placeholder="New folder name"
                aria-label="New folder name"
                value={newFolderName}
                maxLength={80}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void handleCreateFolder(); }
                }}
                style={{ flex: 1, background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#fbbf24", fontFamily: "inherit", fontSize: 10, padding: "2px 6px", borderRadius: 3 }}
              />
              <button
                onClick={() => void handleCreateFolder()}
                disabled={postFolderMutation.isPending}
                title="Create folder"
                style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24", fontFamily: "inherit", fontSize: 9, padding: "2px 8px", borderRadius: 3, cursor: postFolderMutation.isPending ? "wait" : "pointer", letterSpacing: "0.15em" }}
              >+ FOLDER</button>
            </div>
            {folderError && (
              <div style={{ fontSize: 8, color: "#f87171", marginTop: 2 }}>{folderError}</div>
            )}

            {/* Save-preset controls */}
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              <input
                type="text"
                placeholder="Name this pass"
                value={presetName}
                maxLength={80}
                onChange={(e) => setPresetName(e.target.value)}
                style={{ flex: 1, background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontFamily: "inherit", fontSize: 10, padding: "2px 6px", borderRadius: 3 }}
              />
              {(presetFolders?.length ?? 0) > 0 && (
                <select
                  aria-label="Save to folder"
                  title="Save to folder"
                  value={saveFolderId ?? ""}
                  onChange={(e) => setSaveFolderId(e.target.value === "" ? null : e.target.value)}
                  style={{ background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontFamily: "inherit", fontSize: 9, padding: "2px 4px", borderRadius: 3, cursor: "pointer", maxWidth: 70 }}
                >
                  <option value="">root</option>
                  {[...(presetFolders ?? [])]
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
                    .map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                </select>
              )}
              <button
                onClick={() => void handleSavePreset()}
                disabled={postPresetMutation.isPending}
                style={{ background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)", color: "#00e5ff", fontFamily: "inherit", fontSize: 9, padding: "2px 8px", borderRadius: 3, cursor: postPresetMutation.isPending ? "wait" : "pointer", letterSpacing: "0.15em" }}
              >SAVE</button>
            </div>
            {presetError && (
              <div style={{ fontSize: 8, color: "#f87171", marginTop: 2 }}>{presetError}</div>
            )}
          </div>

          <div>
            <div style={LABEL}>BOAT SPEED THROUGH WATER</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                data-testid="boat-speed-input"
                type="number"
                min={0}
                max={TROLL_MAX_KNOTS}
                step={0.1}
                value={boatSpeedKnots}
                onChange={(e) => setBoatSpeedKnots(Number(e.target.value))}
                style={{ width: 56, background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontFamily: "inherit", fontSize: 10, padding: "2px 4px", borderRadius: 3 }}
              />
              <span style={{ ...LABEL }}>kt</span>
              <input
                type="range"
                min={0}
                max={TROLL_MAX_KNOTS}
                step={0.1}
                value={boatSpeedKnots}
                onChange={(e) => setBoatSpeedKnots(Number(e.target.value))}
                style={{ ...sliderStyle, flex: 1 }}
              />
            </div>
            <div style={{ fontSize: 8, color: "#475569", marginTop: 2 }}>
              Max {TROLL_MAX_KNOTS} kt · 0 kt falls back to pure drift
            </div>
          </div>

          {/* Multi-leg waypoint list */}
          <div style={{ marginTop: 8, borderTop: "1px solid rgba(0,229,255,0.1)", paddingTop: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={LABEL}>WAYPOINTS ({driftWaypoints.length})</span>
              {driftWaypoints.length > 0 && (
                <button
                  onClick={clearDriftWaypoints}
                  data-testid="clear-waypoints"
                  style={{
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    color: "#f87171",
                    fontFamily: "inherit",
                    fontSize: 8,
                    padding: "2px 6px",
                    borderRadius: 3,
                    cursor: "pointer",
                    letterSpacing: "0.12em",
                  }}
                >CLEAR ALL</button>
              )}
            </div>
            {driftWaypoints.length === 0 ? (
              <div style={{ fontSize: 9, color: "#475569", fontStyle: "italic" }}>
                Click the water to drop turn points. Boat loops Start → WP1 → … → Start.
              </div>
            ) : (
              <div data-testid="waypoint-list" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {driftWaypoints.map((wp, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: "rgba(0,10,20,0.7)",
                      border: "1px solid rgba(0,229,255,0.12)",
                      borderRadius: 3,
                      padding: "2px 4px",
                      fontSize: 9,
                    }}
                  >
                    <span style={{ color: "#fbbf24", fontWeight: 700, minWidth: 24 }}>
                      WP{i + 1}
                    </span>
                    <span style={{ color: "#94a3b8", flex: 1, fontVariantNumeric: "tabular-nums" }}>
                      {wp.lat.toFixed(4)}, {wp.lon.toFixed(4)}
                    </span>
                    <button
                      title="Move up"
                      disabled={i === 0}
                      onClick={() => moveDriftWaypoint(i, -1)}
                      style={{
                        background: "none",
                        border: "1px solid rgba(0,229,255,0.2)",
                        color: i === 0 ? "#334155" : "#00e5ff",
                        cursor: i === 0 ? "default" : "pointer",
                        fontSize: 9,
                        padding: "0 4px",
                        borderRadius: 2,
                      }}
                    >▲</button>
                    <button
                      title="Move down"
                      disabled={i === driftWaypoints.length - 1}
                      onClick={() => moveDriftWaypoint(i, 1)}
                      style={{
                        background: "none",
                        border: "1px solid rgba(0,229,255,0.2)",
                        color: i === driftWaypoints.length - 1 ? "#334155" : "#00e5ff",
                        cursor: i === driftWaypoints.length - 1 ? "default" : "pointer",
                        fontSize: 9,
                        padding: "0 4px",
                        borderRadius: 2,
                      }}
                    >▼</button>
                    <button
                      title="Remove waypoint"
                      onClick={() => removeDriftWaypoint(i)}
                      style={{
                        background: "none",
                        border: "1px solid rgba(239,68,68,0.3)",
                        color: "#f87171",
                        cursor: "pointer",
                        fontSize: 9,
                        padding: "0 4px",
                        borderRadius: 2,
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 6 }}>
        <span style={LABEL}>LINE LENGTH </span>
        <input
          type="number"
          min={10}
          max={1000}
          step={10}
          value={lineLengthM}
          onChange={(e) => setLineLengthM(Number(e.target.value))}
          style={{ width: 60, background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontFamily: "inherit", fontSize: 10, padding: "2px 4px", borderRadius: 3, marginLeft: 4 }}
        />
        <span style={{ ...LABEL, marginLeft: 3 }}>m</span>
      </div>

      {(isError || estimatedConditions) && (
        <div style={{ marginTop: 6 }}>
          <div style={{ ...LABEL, marginBottom: 4 }}>MANUAL OVERRIDE</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div>
              <div style={LABEL}>WIND {manualWindSpeedKnots} kt @ {manualWindDegrees}°</div>
              <input type="range" min={0} max={40} value={manualWindSpeedKnots} onChange={(e) => setManualWindSpeedKnots(Number(e.target.value))} style={sliderStyle} />
              <input type="range" min={0} max={359} value={manualWindDegrees} onChange={(e) => setManualWindDegrees(Number(e.target.value))} style={sliderStyle} />
            </div>
            <div>
              <div style={LABEL}>TIDAL {manualSlackNow ? "0.0 (slack)" : manualTidalSpeedKnots} kt @ {manualTidalDegrees}°</div>
              <input type="range" min={0} max={6} step={0.1} value={manualTidalSpeedKnots} disabled={manualSlackNow} onChange={(e) => setManualTidalSpeedKnots(Number(e.target.value))} style={{ ...sliderStyle, opacity: manualSlackNow ? 0.4 : 1 }} />
              <input type="range" min={0} max={359} value={manualTidalDegrees} onChange={(e) => setManualTidalDegrees(Number(e.target.value))} style={sliderStyle} />
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, color: manualSlackNow ? "#c084fc" : "#64748b", cursor: "pointer", fontSize: 9, letterSpacing: "0.1em" }}>
                <input
                  type="checkbox"
                  checked={manualSlackNow}
                  onChange={(e) => setManualSlackNow(e.target.checked)}
                  style={{ accentColor: "#c084fc" }}
                />
                SLACK NOW (force current to 0)
              </label>
            </div>
            <button
              onClick={recomputeWithManual}
              style={{ background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)", color: "#00e5ff", fontFamily: "inherit", fontSize: 9, padding: "4px 10px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.15em" }}
            >COMPUTE DRIFT</button>
          </div>
        </div>
      )}

      <div style={{ ...DIVIDER, marginTop: 8 }} />
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => void refetch()}
          style={{ flex: 1, background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontFamily: "inherit", fontSize: 9, padding: "4px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.15em" }}
        >⟳ REFRESH</button>
        <div style={{ fontSize: 9, color: "#1e3a5f", alignSelf: "center" }}>Open-Meteo</div>
      </div>
    </div>
  );
};
