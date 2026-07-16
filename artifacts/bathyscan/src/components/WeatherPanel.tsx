/**
 * WeatherPanel — HTML overlay for Drift Planner showing wind, tidal, and wave
 * conditions. Fetches 24 h of surface conditions from /api/surface-conditions
 * using the terrain centre as the query point.
 *
 * When conditions are unavailable (estimatedConditions=true) it shows manual
 * override sliders so the user can still plan a drift.
 */

import React, { useEffect, useCallback, useRef, useState } from "react";
import { useOfflineStore } from "@/lib/offlineStore";
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
  type TrollingPresetFolder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppState } from "@/lib/context";
import { useDriftStore, TROLL_MAX_KNOTS } from "@/lib/driftStore";
import { useTimelineStore } from "@/lib/timelineStore";
import { computeDrift } from "@/lib/computeDrift";
import { BOAT_PROFILES } from "@/lib/boatProfiles";
import { useSurfaceConditions } from "@/hooks/useSurfaceConditions";
import { useSettingsStore } from "@/lib/settingsStore";
import { LocationBadge } from "@/components/LocationBadge";
import { formatSpeedFromKnots, cardinal } from "@/lib/units";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

// Undo window for "soft" trolling-preset deletes (ms). The preset is hidden
// from the list immediately and the actual DELETE only fires when the
// window elapses, so a misclick can still be reverted by clicking "Undo".
const UNDO_DELETE_WINDOW_MS = 5000;

/** Escape all five XML special characters for safe embedding in GPX text nodes. */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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
  color: "#e2e8f0",
  letterSpacing: "0.06em",
  backdropFilter: "blur(8px)",
  minWidth: 220,
  maxWidth: 260,
  pointerEvents: "auto",
};

const LABEL: React.CSSProperties = { color: "#94a3b8", fontSize: 9, letterSpacing: "0.18em" };
const VALUE: React.CSSProperties = { color: "#00e5ff", fontWeight: 700 };
const DIVIDER: React.CSSProperties = { borderTop: "1px solid rgba(0,229,255,0.1)", margin: "8px 0" };

/**
 * Shows a subtle offline badge with the weather pack snapshot date when the
 * device has no network connection and a weather pack is available.
 */
const OfflineWeatherBadge: React.FC = () => {
  const isOnline = useOfflineStore((s) => s.isOnline);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const { terrain } = useAppState();

  useEffect(() => {
    if (isOnline || !terrain) return;
    let mounted = true;
    import("@/lib/offlinePackStore").then(async ({ getPackForLocation }) => {
      const centerLat = (terrain.minLat + terrain.maxLat) / 2;
      const centerLon = (terrain.minLon + terrain.maxLon) / 2;
      const pack = await getPackForLocation(centerLat, centerLon);
      if (mounted) setSnapshotAt(pack?.weatherPack.snapshotAt ?? null);
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, [isOnline, terrain]);

  if (isOnline || !snapshotAt) return null;

  const dateStr = new Date(snapshotAt).toLocaleDateString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div
      data-testid="weather-offline-badge"
      style={{
        fontSize: 8,
        letterSpacing: "0.12em",
        color: "#fbbf24",
        background: "rgba(251,191,36,0.06)",
        border: "1px solid rgba(251,191,36,0.2)",
        borderRadius: 3,
        padding: "3px 6px",
        marginBottom: 8,
      }}
    >
      ⚡ OFFLINE · AS OF {dateStr.toUpperCase()}
    </div>
  );
};

interface WeatherPanelProps {
  onClose: () => void;
  /** When true, renders inline (no absolute positioning, no floating header). */
  embedded?: boolean;
}

export const WeatherPanel: React.FC<WeatherPanelProps> = ({ onClose, embedded = false }) => {
  const { terrain } = useAppState();
  const driftConditions = useDriftStore((s) => s.driftConditions);
  const setDriftConditions = useDriftStore((s) => s.setDriftConditions);
  const setDriftPath = useDriftStore((s) => s.setDriftPath);
  const setEstimatedConditions = useDriftStore((s) => s.setEstimatedConditions);
  const estimatedConditions = useDriftStore((s) => s.estimatedConditions);
  const driftHour = useDriftStore((s) => s.driftHour);
  const driftPlannerActive = useDriftStore((s) => s.driftPlannerActive);
  const timelineCurrentTime = useTimelineStore((s) => s.currentTime);
  const driftStartLat = useDriftStore((s) => s.driftStartLat);
  const driftStartLon = useDriftStore((s) => s.driftStartLon);
  const setDriftStart = useDriftStore((s) => s.setDriftStart);
  const lineLengthM = useDriftStore((s) => s.lineLengthM);
  const setLineLengthM = useDriftStore((s) => s.setLineLengthM);
  const manualWindSpeedKnots = useDriftStore((s) => s.manualWindSpeedKnots);
  const setManualWindSpeedKnots = useDriftStore((s) => s.setManualWindSpeedKnots);
  const manualWindDegrees = useDriftStore((s) => s.manualWindDegrees);
  const setManualWindDegrees = useDriftStore((s) => s.setManualWindDegrees);
  const manualTidalSpeedKnots = useDriftStore((s) => s.manualTidalSpeedKnots);
  const setManualTidalSpeedKnots = useDriftStore((s) => s.setManualTidalSpeedKnots);
  const manualTidalDegrees = useDriftStore((s) => s.manualTidalDegrees);
  const setManualTidalDegrees = useDriftStore((s) => s.setManualTidalDegrees);
  const manualSlackNow = useDriftStore((s) => s.manualSlackNow);
  const setManualSlackNow = useDriftStore((s) => s.setManualSlackNow);
  const driftMode = useDriftStore((s) => s.driftMode);
  const setDriftMode = useDriftStore((s) => s.setDriftMode);
  const boatHeadingDeg = useDriftStore((s) => s.boatHeadingDeg);
  const setBoatHeadingDeg = useDriftStore((s) => s.setBoatHeadingDeg);
  const boatSpeedKnots = useDriftStore((s) => s.boatSpeedKnots);
  const setBoatSpeedKnots = useDriftStore((s) => s.setBoatSpeedKnots);
  const backtroll = useDriftStore((s) => s.backtroll);
  const toggleBacktroll = useDriftStore((s) => s.toggleBacktroll);
  const snapToDepthEnabled = useDriftStore((s) => s.snapToDepthEnabled);
  const setSnapToDepthEnabled = useDriftStore((s) => s.setSnapToDepthEnabled);
  const snapToDepthM = useDriftStore((s) => s.snapToDepthM);
  const setSnapToDepthM = useDriftStore((s) => s.setSnapToDepthM);
  const driftWaypoints = useDriftStore((s) => s.driftWaypoints);
  const removeDriftWaypoint = useDriftStore((s) => s.removeDriftWaypoint);
  const clearDriftWaypoints = useDriftStore((s) => s.clearDriftWaypoints);
  const setDriftWaypoints = useDriftStore((s) => s.setDriftWaypoints);
  const boatProfileId = useDriftStore((s) => s.boatProfileId);
  const setBoatProfileId = useDriftStore((s) => s.setBoatProfileId);
  const units = useSettingsStore((s) => s.units);

  // Saved plans
  const savedDriftPlans = useDriftStore((s) => s.savedDriftPlans);
  const saveDriftPlan = useDriftStore((s) => s.saveDriftPlan);
  const deleteSavedDriftPlan = useDriftStore((s) => s.deleteSavedDriftPlan);
  const loadDriftPlan = useDriftStore((s) => s.loadDriftPlan);
  const skippedPlanCount = useDriftStore((s) => s.skippedPlanCount);
  const clearSkippedPlanCount = useDriftStore((s) => s.clearSkippedPlanCount);
  // Reverse drift
  const driftPath = useDriftStore((s) => s.driftPath);
  const reverseModeActive = useDriftStore((s) => s.reverseModeActive);
  const setReverseModeActive = useDriftStore((s) => s.setReverseModeActive);
  const reverseDriftPath = useDriftStore((s) => s.reverseDriftPath);
  const catchLat = useDriftStore((s) => s.catchLat);
  const catchLon = useDriftStore((s) => s.catchLon);

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
  const [planNameInput, setPlanNameInput] = useState("");
  const [planError, setPlanError] = useState<string | null>(null);
  const [showSavedPlans, setShowSavedPlans] = useState(false);

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

  // ── GPX export ────────────────────────────────────────────────────────────
  const handleExportGpx = useCallback(() => {
    if (!driftPath || driftPath.length === 0) return;
    const planName = planNameInput.trim() || "Drift Plan";
    const now = new Date().toISOString();
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<gpx version="1.1" creator="BathyScan Drift Planner" xmlns="http://www.topografix.com/GPX/1/1">\n`;
    xml += `  <metadata><name>${escapeXml(planName)}</name><time>${now}</time></metadata>\n`;
    xml += `  <trk>\n    <name>${escapeXml(planName)}</name>\n    <trkseg>\n`;
    for (const wp of driftPath) {
      const time = new Date(Date.now() + wp.hour * 3600000).toISOString();
      const desc = `Hour ${wp.hour}: ${wp.driftSpeedKnots.toFixed(1)} kt drift, line ${Math.round(wp.lineAngleDeg)}°, hook ${Math.round(wp.hookDepthM)} m${wp.isSlack ? ", slack" : ""}${wp.bottomReached ? ", BOTTOM" : ""}`;
      xml += `      <trkpt lat="${wp.lat.toFixed(7)}" lon="${wp.lon.toFixed(7)}">\n`;
      xml += `        <ele>${(-wp.hookDepthM).toFixed(1)}</ele>\n`;
      xml += `        <time>${time}</time>\n`;
      xml += `        <desc>${escapeXml(desc)}</desc>\n`;
      xml += `      </trkpt>\n`;
    }
    xml += `    </trkseg>\n  </trk>\n</gpx>`;
    const blob = new Blob([xml], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${planName.replace(/[^a-z0-9_-]/gi, "_")}_drift.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [driftPath, planNameInput]);

  // ── Save plan ─────────────────────────────────────────────────────────────
  const handleSavePlan = useCallback(() => {
    const name = planNameInput.trim();
    if (!name) { setPlanError("Name required"); return; }
    setPlanError(null);
    saveDriftPlan(name);
    setPlanNameInput("");
    setShowSavedPlans(true);
  }, [planNameInput, saveDriftPlan]);

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

  // ─── Shared undo infrastructure ──────────────────────────────────────────
  // Both folder deletes and preset deletes share the same pending-deletes ref
  // and toast hook so a single flush-on-unmount effect covers all of them.
  const pendingDeletesRef = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>(),
  );
  const { toast } = useToast();

  const handleDeleteFolder = useCallback((id: string, folderName: string) => {
    const foldersSnapshot = queryClient.getQueryData<TrollingPresetFolder[]>(foldersQueryKey);
    const presetsSnapshot = queryClient.getQueryData<TrollingPreset[]>(presetsQueryKey);
    // Capture save-target so it can be restored if the user undoes or the
    // server rejects the delete.
    const prevSaveFolderId = saveFolderId;

    // Optimistically remove the folder and move its presets to root so the
    // list reflects the change while the 5-second undo window is open.
    queryClient.setQueryData<TrollingPresetFolder[] | undefined>(foldersQueryKey, (prev) =>
      prev ? prev.filter((f) => f.id !== id) : prev,
    );
    queryClient.setQueryData<TrollingPreset[] | undefined>(presetsQueryKey, (prev) =>
      prev
        ? prev.map((p) => (p.folderId === id ? { ...p, folderId: null } : p))
        : prev,
    );
    if (saveFolderId === id) setSaveFolderId(null);

    const undoKey = `folder:${id}`;

    const restore = () => {
      if (foldersSnapshot !== undefined) queryClient.setQueryData(foldersQueryKey, foldersSnapshot);
      if (presetsSnapshot !== undefined) queryClient.setQueryData(presetsQueryKey, presetsSnapshot);
      if (prevSaveFolderId !== null) setSaveFolderId(prevSaveFolderId);
    };

    // Closure flag — set by undo() to prevent the mutation from firing even
    // if the timer callback was already queued when the user clicked "Undo".
    let abortedFolder = false;

    const commit = () => {
      if (abortedFolder) return;
      pendingDeletesRef.current.delete(undoKey);
      deleteFolderMutation.mutate(
        { id },
        {
          onSuccess: () => {
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: foldersQueryKey }),
              queryClient.invalidateQueries({ queryKey: presetsQueryKey }),
            ]);
          },
          onError: (err) => {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 404 || status === 409) {
              // Already gone — re-sync.
              void Promise.all([
                queryClient.invalidateQueries({ queryKey: foldersQueryKey }),
                queryClient.invalidateQueries({ queryKey: presetsQueryKey }),
              ]);
              return;
            }
            restore();
          },
        },
      );
    };

    const undo = () => {
      abortedFolder = true;
      const entry = pendingDeletesRef.current.get(undoKey);
      if (!entry) return;
      clearTimeout(entry.timer);
      pendingDeletesRef.current.delete(undoKey);
      restore();
    };

    const timer = setTimeout(commit, UNDO_DELETE_WINDOW_MS);
    pendingDeletesRef.current.set(undoKey, {
      timer,
      commit: () => {
        clearTimeout(timer);
        commit();
      },
    });

    const toastHandle = toast({
      title: "Folder deleted",
      description: `"${folderName}" will be removed. Its presets will move to the root list.`,
      duration: UNDO_DELETE_WINDOW_MS,
      action: (
        <ToastAction
          altText="Undo delete"
          data-testid="undo-delete-trolling-folder"
          onClick={() => {
            undo();
            toastHandle.dismiss();
          }}
        >
          Undo
        </ToastAction>
      ),
    });
  }, [queryClient, foldersQueryKey, presetsQueryKey, saveFolderId, deleteFolderMutation, toast]);

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

    // Closure flag — set by undo() to prevent the mutation from firing even
    // if the timer callback was already queued when the user clicked "Undo".
    let aborted = false;

    const commit = () => {
      if (aborted) return;
      pendingDeletesRef.current.delete(presetId);
      deletePresetMutation.mutate(
        { id: presetId },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: presetsQueryKey });
          },
          onError: (err) => {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 404 || status === 409) {
              // Already gone — re-sync.
              void queryClient.invalidateQueries({ queryKey: presetsQueryKey });
            } else {
              // Restore the list on failure so the user can retry.
              if (snapshot !== undefined) {
                queryClient.setQueryData(presetsQueryKey, snapshot);
              }
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
      aborted = true;
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
  // When the drift planner is active its own driftHour drives the display;
  // otherwise the timeline scrubber's current hour is used.
  const surfaceConditionsHourOverride = driftPlannerActive
    ? undefined
    : timelineCurrentTime.getUTCHours();
  const { data, hours: sharedHours, loading: isLoading, isFetching, error: isError, estimated, refetch, centerLat: cLat, centerLon: cLon } =
    useSurfaceConditions(!!terrain, surfaceConditionsHourOverride);

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
      backtroll,
      boatProfileId,
      trollWaypoints: driftWaypoints,
    });
    setDriftPath(path);
  }, [
    sharedHours, estimated, terrain,
    driftStartLat, driftStartLon, centerLat, centerLon,
    lineLengthM, driftMode, boatHeadingDeg, boatSpeedKnots, backtroll, boatProfileId, driftWaypoints,
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
      backtroll,
      boatProfileId,
      trollWaypoints: driftWaypoints,
    });
    setDriftPath(path);
  }, [
    terrain,
    manualWindSpeedKnots, manualWindDegrees,
    manualTidalSpeedKnots, manualTidalDegrees, manualSlackNow,
    driftStartLat, driftStartLon, centerLat, centerLon,
    lineLengthM, driftMode, boatHeadingDeg, boatSpeedKnots, backtroll, boatProfileId, driftWaypoints,
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

  const panelStyle: React.CSSProperties = embedded
    ? {
        width: "100%",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        color: "#e2e8f0",
        letterSpacing: "0.06em",
        pointerEvents: "auto",
      }
    : PANEL_STYLE;

  return (
    <div data-testid="weather-panel" style={panelStyle}>
      {!embedded && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ ...VALUE, fontSize: 11, letterSpacing: "0.15em" }}>⛵ DRIFT PLANNER</span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: "0 2px" }}
        >×</button>
      </div>
      )}

      {/* Location context badge */}
      {terrain && (
        <div style={{ marginBottom: 6 }}>
          <LocationBadge
            datasetName={terrain.name}
            lat={cLat}
            lon={cLon}
            isLoading={isLoading}
            isFetching={isFetching}
          />
        </div>
      )}

      {/* ── Skipped-plans warning ────────────────────────────────────────── */}
      {skippedPlanCount > 0 && (
        <div
          role="alert"
          style={{ marginBottom: 6, padding: "4px 8px", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
        >
          <span style={{ fontSize: 8, color: "#fbbf24" }}>
            ⚠ {skippedPlanCount} saved plan{skippedPlanCount > 1 ? "s were" : " was"} skipped — format was outdated or corrupt.
          </span>
          <button
            onClick={clearSkippedPlanCount}
            title="Dismiss"
            style={{ background: "none", border: "none", color: "#fbbf24", cursor: "pointer", fontSize: 10, lineHeight: 1, padding: "0 2px" }}
          >✕</button>
        </div>
      )}

      {/* ── Saved Plans section ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", marginBottom: showSavedPlans ? 6 : 0 }}
          onClick={() => setShowSavedPlans((v) => !v)}
        >
          <span style={{ ...LABEL, fontSize: 8 }}>📁 SAVED PLANS ({savedDriftPlans.length})</span>
          <span style={{ color: "#94a3b8", fontSize: 10 }}>{showSavedPlans ? "▲" : "▼"}</span>
        </div>

        {showSavedPlans && (
          <div style={{ background: "rgba(0,10,20,0.6)", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 4, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
            {/* Save current plan */}
            <div style={{ display: "flex", gap: 4 }}>
              <input
                type="text"
                value={planNameInput}
                onChange={(e) => { setPlanNameInput(e.target.value); setPlanError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSavePlan(); }}
                placeholder="Plan name…"
                style={{ flex: 1, background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#e2e8f0", fontFamily: "inherit", fontSize: 9, padding: "2px 6px", borderRadius: 3 }}
              />
              <button
                onClick={handleSavePlan}
                style={{ background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)", color: "#00e5ff", fontFamily: "inherit", fontSize: 8, padding: "2px 8px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.1em", whiteSpace: "nowrap" }}
              >SAVE</button>
            </div>
            {planError && <div style={{ color: "#f87171", fontSize: 8 }}>{planError}</div>}

            {/* Plans list */}
            {savedDriftPlans.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 8, fontStyle: "italic" }}>No saved plans yet</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 120, overflowY: "auto" }}>
                {[...savedDriftPlans].reverse().map((plan) => (
                  <div key={plan.id} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(0,10,20,0.5)", borderRadius: 3, padding: "2px 4px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "#e2e8f0", fontSize: 8, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{plan.name}</div>
                      <div style={{ color: "#64748b", fontSize: 7 }}>{plan.driftMode} · {plan.lineLengthM}m · {new Date(plan.savedAt).toLocaleDateString()}</div>
                    </div>
                    <button
                      onClick={() => loadDriftPlan(plan)}
                      title="Load this plan"
                      style={{ background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.25)", color: "#22d3ee", fontFamily: "inherit", fontSize: 7, padding: "1px 5px", borderRadius: 2, cursor: "pointer" }}
                    >LOAD</button>
                    <button
                      onClick={() => deleteSavedDriftPlan(plan.id)}
                      title="Delete plan"
                      style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", fontFamily: "inherit", fontSize: 7, padding: "1px 5px", borderRadius: 2, cursor: "pointer" }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
      <OfflineWeatherBadge />

      {cond && !estimatedConditions && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Compass degrees={cond.windDegrees} size={42} color="#7dd3fc" />
            <div>
              <div style={{ ...LABEL, display: "inline-flex", alignItems: "center", gap: 6 }}>
                WIND
                {isFetching && (
                  <span
                    data-testid="wind-refreshing"
                    style={{
                      fontSize: 8,
                      letterSpacing: "0.15em",
                      color: "#94a3b8",
                      border: "1px solid rgba(148,163,184,0.3)",
                      borderRadius: 2,
                      padding: "1px 4px",
                    }}
                  >
                    REFRESHING…
                  </span>
                )}
              </div>
              <div style={{ ...VALUE, color: "#7dd3fc" }}>{formatSpeedFromKnots(cond.windSpeedKnots, { units })}</div>
              <div style={{ fontSize: 9, color: "#94a3b8" }}>{cardinal(cond.windDegrees)} {Math.round(cond.windDegrees)}°</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Compass degrees={cond.tidalDegrees} size={42} color="#34d399" />
            <div>
              <div style={{ ...LABEL, display: "inline-flex", alignItems: "center", gap: 6 }}>
                TIDAL CURRENT
                {isFetching && (
                  <span
                    data-testid="tide-current-refreshing"
                    style={{
                      fontSize: 8,
                      letterSpacing: "0.15em",
                      color: "#94a3b8",
                      border: "1px solid rgba(148,163,184,0.3)",
                      borderRadius: 2,
                      padding: "1px 4px",
                    }}
                  >
                    REFRESHING…
                  </span>
                )}
              </div>
              <div style={{ ...VALUE, color: "#34d399" }}>{formatSpeedFromKnots(cond.tidalSpeedKnots, { units })}</div>
              <div style={{ fontSize: 9, color: "#94a3b8" }}>{cardinal(cond.tidalDegrees)} {Math.round(cond.tidalDegrees)}°</div>
              {data?.tidalDataSource === "noaa-coops" && data.tidalStationName ? (
                <div
                  data-testid="tidal-source"
                  style={{ fontSize: 8, color: "#cbd5e1", marginTop: 2, letterSpacing: "0.05em" }}
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
                  style={{ fontSize: 8, color: "#cbd5e1", marginTop: 2, letterSpacing: "0.05em", fontStyle: "italic" }}
                >
                  Estimated (no NOAA station nearby)
                </div>
              )}
            </div>
          </div>
          <div>
            <span style={LABEL}>WAVE HEIGHT </span>
            <span style={{ ...VALUE, color: "#60a5fa" }}>{cond.waveHeightM.toFixed(2)} m</span>
            {cond.waveDirectionDeg !== undefined && (
              <span style={{ fontSize: 9, color: "#94a3b8", marginLeft: 6 }}>
                {cardinal(cond.waveDirectionDeg)} {Math.round(cond.waveDirectionDeg)}°
              </span>
            )}
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
            const modeTitle = m === "drift"
              ? "Drift: boat drifts freely with wind and current — no engine power."
              : "Trolling: boat moves under engine power through wind and current.";
            return (
              <button
                key={m}
                data-testid={`drift-mode-btn-${m}`}
                onClick={() => setDriftMode(m)}
                title={modeTitle}
                style={{
                  flex: 1,
                  background: active ? "rgba(0,229,255,0.15)" : "rgba(0,10,20,0.8)",
                  border: `1px solid ${active ? "rgba(0,229,255,0.5)" : "rgba(0,229,255,0.15)"}`,
                  color: active ? "#00e5ff" : "#94a3b8",
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
                <div style={{ ...VALUE, color: "#fbbf24" }}>{cardinal(boatHeadingDeg)} {Math.round(boatHeadingDeg)}°</div>
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

          {/* Backtroll toggle — stern-first reverse against the current */}
          <button
            data-testid="backtroll-toggle"
            onClick={toggleBacktroll}
            title={backtroll
              ? "Backtroll ON: boat moves stern-first against the current for a slow, controlled presentation. Click to switch back to forward trolling."
              : "Backtroll: run the boat stern-first against the current — ideal for holding a tight lane over structure."}
            style={{
              display: "block",
              width: "100%",
              marginBottom: 4,
              padding: "4px 0",
              background: backtroll ? "rgba(251,191,36,0.15)" : "rgba(0,229,255,0.04)",
              border: `1px solid ${backtroll ? "rgba(251,191,36,0.55)" : "rgba(0,229,255,0.2)"}`,
              borderRadius: 3,
              color: backtroll ? "#fbbf24" : "#64748b",
              fontFamily: "inherit",
              fontSize: 9,
              letterSpacing: "0.18em",
              cursor: "pointer",
              textTransform: "uppercase",
              fontWeight: backtroll ? 700 : 400,
              transition: "all 0.15s",
            }}
          >
            {backtroll ? "⛵ BACKTROLL ON" : "BACKTROLL"}
          </button>

          {/* Snap-to-depth toggle — snaps dragged waypoints to a depth contour */}
          <button
            data-testid="snap-to-depth-toggle"
            onClick={() => setSnapToDepthEnabled(!snapToDepthEnabled)}
            title={snapToDepthEnabled
              ? `Snap to depth ON: dragging waypoints snaps to the ${Math.round(snapToDepthM)} m contour. Click to disable.`
              : "Enable snap to depth: drag waypoints snap to the chosen depth contour."}
            style={{
              display: "block",
              width: "100%",
              marginBottom: snapToDepthEnabled ? 0 : 4,
              padding: "4px 0",
              background: snapToDepthEnabled ? "rgba(240,171,252,0.12)" : "rgba(0,229,255,0.04)",
              border: `1px solid ${snapToDepthEnabled ? "rgba(240,171,252,0.55)" : "rgba(0,229,255,0.2)"}`,
              borderRadius: snapToDepthEnabled ? "3px 3px 0 0" : 3,
              color: snapToDepthEnabled ? "#f0abfc" : "#64748b",
              fontFamily: "inherit",
              fontSize: 9,
              letterSpacing: "0.18em",
              cursor: "pointer",
              textTransform: "uppercase",
              fontWeight: snapToDepthEnabled ? 700 : 400,
              transition: "all 0.15s",
            }}
          >
            {snapToDepthEnabled ? "📍 SNAP TO DEPTH ON" : "SNAP TO DEPTH"}
          </button>

          {/* Depth target input — shown when snap is enabled */}
          {snapToDepthEnabled && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                marginBottom: 4,
                background: "rgba(240,171,252,0.06)",
                border: "1px solid rgba(240,171,252,0.35)",
                borderTop: "none",
                borderRadius: "0 0 3px 3px",
              }}
            >
              <span style={{ fontSize: 8, color: "#c084fc", letterSpacing: "0.12em", flex: 1 }}>
                TARGET DEPTH
              </span>
              <input
                data-testid="snap-to-depth-input"
                type="number"
                min={0}
                max={2000}
                step={5}
                value={Math.round(snapToDepthM)}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) setSnapToDepthM(v);
                }}
                style={{
                  width: 52,
                  background: "rgba(240,171,252,0.08)",
                  border: "1px solid rgba(240,171,252,0.35)",
                  borderRadius: 3,
                  color: "#f0abfc",
                  fontFamily: "inherit",
                  fontSize: 10,
                  textAlign: "center",
                  padding: "2px 4px",
                  outline: "none",
                }}
              />
              <span style={{ fontSize: 8, color: "#94a3b8" }}>m</span>
            </div>
          )}

          {/* ── Waypoint list ─────────────────────────────────────────── */}
          <div
            data-testid="drift-waypoint-list"
            style={{ marginBottom: 6 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={LABEL}>WAYPOINTS ({driftWaypoints.length})</div>
              {driftWaypoints.length > 0 && (
                <button
                  data-testid="clear-all-waypoints"
                  onClick={clearDriftWaypoints}
                  title="Remove all waypoints"
                  style={{
                    background: "rgba(248,113,113,0.08)",
                    border: "1px solid rgba(248,113,113,0.35)",
                    color: "#f87171",
                    fontFamily: "inherit",
                    fontSize: 8,
                    padding: "2px 6px",
                    borderRadius: 3,
                    cursor: "pointer",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                  }}
                >
                  Clear all
                </button>
              )}
            </div>
            {driftWaypoints.length === 0 ? (
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.1em", fontStyle: "italic" }}>
                Click the map to place waypoints
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {driftWaypoints.map((wp, i) => (
                  <div
                    key={i}
                    data-testid={`drift-waypoint-row-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: "rgba(0,10,20,0.6)",
                      border: "1px solid rgba(0,229,255,0.12)",
                      borderRadius: 3,
                      padding: "3px 5px",
                    }}
                  >
                    <span style={{ color: "#fbbf24", fontSize: 8, minWidth: 12, textAlign: "right", flexShrink: 0 }}>
                      {i + 1}
                    </span>
                    <span style={{ flex: 1, color: "#94a3b8", fontSize: 8, letterSpacing: "0.06em", fontVariantNumeric: "tabular-nums" }}>
                      {wp.lat.toFixed(4)}°&nbsp;{wp.lon.toFixed(4)}°
                    </span>
                    <button
                      data-testid={`remove-waypoint-${i}`}
                      onClick={() => removeDriftWaypoint(i)}
                      title={`Remove waypoint ${i + 1}`}
                      aria-label={`Remove waypoint ${i + 1}`}
                      style={{
                        background: "none",
                        border: "1px solid rgba(248,113,113,0.25)",
                        color: "#f87171",
                        fontFamily: "inherit",
                        fontSize: 9,
                        padding: "0 4px",
                        borderRadius: 2,
                        cursor: "pointer",
                        lineHeight: 1.4,
                        flexShrink: 0,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

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
                        style={{ background: "none", border: "1px solid rgba(0,229,255,0.2)", color: isFirst ? "#64748b" : "#00e5ff", cursor: isFirst ? "default" : "pointer", fontSize: 8, padding: "0 3px", borderRadius: 2, lineHeight: 1.2 }}
                      >▲</button>
                      <button
                        title="Move down"
                        aria-label={`Move preset ${p.name} down`}
                        disabled={isLast}
                        onClick={() => void handleMovePresetInFolder(folderId, p.id, 1)}
                        style={{ background: "none", border: "1px solid rgba(0,229,255,0.2)", color: isLast ? "#64748b" : "#00e5ff", cursor: isLast ? "default" : "pointer", fontSize: 8, padding: "0 3px", borderRadius: 2, lineHeight: 1.2 }}
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
                  <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 2 }}>
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
                                onClick={() => handleDeleteFolder(folder.id, folder.name)}
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
                          <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 2, paddingLeft: 14, fontStyle: "italic" }}>
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
                        <span style={{ flex: 1, color: "#cbd5e1", fontSize: 9, fontWeight: 700, letterSpacing: "0.12em" }}>
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
              <div style={{ fontSize: 8, color: "#f87171", marginTop: 2, userSelect: "text" }}>{presetError}</div>
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
            <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 2 }}>
              Max {TROLL_MAX_KNOTS} kt · 0 kt falls back to pure drift
            </div>
          </div>

          {/* Multi-leg waypoint list */}
          {/* Section removed: compact list above handles this */}
        </div>
      )}

      {/* ── Reverse Drift section ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 8, padding: "6px 8px", background: reverseModeActive ? "rgba(249,115,22,0.08)" : "rgba(0,10,20,0.4)", border: `1px solid ${reverseModeActive ? "rgba(249,115,22,0.4)" : "rgba(0,229,255,0.1)"}`, borderRadius: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: reverseModeActive ? 6 : 0 }}>
          <span style={{ ...LABEL, color: reverseModeActive ? "#fb923c" : "#94a3b8", fontSize: 8 }}>⟵ REVERSE DRIFT</span>
          <button
            onClick={() => setReverseModeActive(!reverseModeActive)}
            title={reverseModeActive
              ? "Reverse Drift ON: click the water to mark a catch location and see where the fish may have come from."
              : "Reverse Drift: click a catch location on the map to trace where the fish likely originated."}
            style={{ background: reverseModeActive ? "rgba(249,115,22,0.18)" : "rgba(0,10,20,0.6)", border: `1px solid ${reverseModeActive ? "rgba(249,115,22,0.5)" : "rgba(0,229,255,0.2)"}`, color: reverseModeActive ? "#fb923c" : "#94a3b8", fontFamily: "inherit", fontSize: 8, padding: "2px 8px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.1em" }}
          >{reverseModeActive ? "ON" : "OFF"}</button>
        </div>
        {reverseModeActive && (
          <div style={{ fontSize: 8, color: "#94a3b8" }}>
            {catchLat === null
              ? "Click the water to mark your catch location — the backwards path will appear in orange."
              : <>
                  Catch: {catchLat.toFixed(4)}, {catchLon?.toFixed(4)}
                  {reverseDriftPath && <span style={{ color: "#fb923c", marginLeft: 4 }}>→ {reverseDriftPath.length - 1}h path</span>}
                </>
            }
          </div>
        )}
      </div>

      {/* Boat profile selector */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ ...LABEL, marginBottom: 3 }}>VESSEL PROFILE</div>
        <select
          data-testid="boat-profile-select"
          value={boatProfileId}
          onChange={(e) => setBoatProfileId(e.target.value)}
          style={{
            width: "100%",
            background: "rgba(0,10,20,0.8)",
            border: "1px solid rgba(0,229,255,0.2)",
            color: "#00e5ff",
            fontFamily: "inherit",
            fontSize: 10,
            padding: "3px 5px",
            borderRadius: 3,
            cursor: "pointer",
          }}
        >
          {BOAT_PROFILES.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 2, letterSpacing: "0.06em" }}>
          Affects wind leeway coefficient used in drift model
        </div>
      </div>

      <div style={{ marginBottom: 6 }}>
        <span style={LABEL}>LINE LENGTH </span>
        <input
          type="number"
          min={0.5}
          max={500}
          step={5}
          value={lineLengthM}
          onChange={(e) => setLineLengthM(Number(e.target.value))}
          style={{ width: 60, background: "rgba(0,10,20,0.8)", border: `1px solid ${lineLengthM < 0.5 || lineLengthM > 500 ? "rgba(248,113,113,0.6)" : "rgba(0,229,255,0.2)"}`, color: "#00e5ff", fontFamily: "inherit", fontSize: 10, padding: "2px 4px", borderRadius: 3, marginLeft: 4 }}
        />
        <span style={{ ...LABEL, marginLeft: 3 }}>m</span>
        {(lineLengthM < 0.5 || lineLengthM > 500) ? (
          <div style={{ fontSize: 8, color: "#f87171", marginTop: 1 }}>Must be 0.5 – 500 m</div>
        ) : (
          <div style={{ fontSize: 8, color: "#64748b", marginTop: 1 }}>0.5 – 500 m</div>
        )}
      </div>

      {(isError || estimatedConditions) && (
        <div style={{ marginTop: 6 }}>
          <div style={{ ...LABEL, marginBottom: 4 }}>MANUAL OVERRIDE</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div>
              <div style={LABEL}>WIND {manualWindSpeedKnots} kt @ {cardinal(manualWindDegrees)} ({manualWindDegrees}°)</div>
              <input type="range" min={0} max={40} value={manualWindSpeedKnots} onChange={(e) => setManualWindSpeedKnots(Number(e.target.value))} style={sliderStyle} />
              <input type="range" min={0} max={359} value={manualWindDegrees} onChange={(e) => setManualWindDegrees(Number(e.target.value))} style={sliderStyle} />
            </div>
            <div>
              <div style={LABEL}>TIDAL {manualSlackNow ? "0.0 (slack)" : manualTidalSpeedKnots} kt @ {cardinal(manualTidalDegrees)} ({manualTidalDegrees}°)</div>
              <input type="range" min={0} max={6} step={0.1} value={manualTidalSpeedKnots} disabled={manualSlackNow} onChange={(e) => setManualTidalSpeedKnots(Number(e.target.value))} style={{ ...sliderStyle, opacity: manualSlackNow ? 0.4 : 1 }} />
              <input type="range" min={0} max={359} value={manualTidalDegrees} onChange={(e) => setManualTidalDegrees(Number(e.target.value))} style={sliderStyle} />
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, color: manualSlackNow ? "#c084fc" : "#cbd5e1", cursor: "pointer", fontSize: 9, letterSpacing: "0.1em" }}>
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

      {/* ── Plan name + GPX export ───────────────────────────────────────── */}
      {driftPath && driftPath.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              type="text"
              value={planNameInput}
              onChange={(e) => setPlanNameInput(e.target.value)}
              placeholder="Plan name (optional for GPX)…"
              style={{ flex: 1, background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.15)", color: "#e2e8f0", fontFamily: "inherit", fontSize: 8, padding: "2px 6px", borderRadius: 3 }}
            />
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <button
              onClick={handleSavePlan}
              title="Save plan to local storage"
              style={{ flex: 1, background: "rgba(0,229,255,0.06)", border: "1px solid rgba(0,229,255,0.2)", color: "#22d3ee", fontFamily: "inherit", fontSize: 8, padding: "3px 4px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.1em" }}
            >💾 SAVE PLAN</button>
            <button
              onClick={handleExportGpx}
              title="Export drift path as GPX 1.1"
              style={{ flex: 1, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.25)", color: "#4ade80", fontFamily: "inherit", fontSize: 8, padding: "3px 4px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.1em" }}
            >↓ EXPORT GPX</button>
          </div>
        </div>
      )}

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
