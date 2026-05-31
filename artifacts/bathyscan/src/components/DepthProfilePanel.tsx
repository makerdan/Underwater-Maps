/**
 * DepthProfilePanel — DOM panel that renders the depth cross-section chart.
 *
 * Reads useDepthProfileStore.profile. Shows nothing when no profile is set.
 * Renders an SVG line chart of depth vs distance with a slim coloured strip
 * underneath each sample indicating the AI zone classification (when known).
 *
 * The panel header is a drag handle — click-and-drag to reposition freely on
 * screen. Position is remembered per session; resets to bottom-center on reload.
 *
 * Independent of the marker system; dismiss via the × button.
 */
import React from "react";
import { triggerBlobDownload } from "@/lib/blobDownload";
import { useQueryClient } from "@tanstack/react-query";
import {
  useDepthProfileStore,
  detectProfileFeatures,
  type ProfileFeature,
  type ProfileFeatureKind,
} from "@/lib/depthProfileStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useAppState } from "@/lib/context";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { formatDistance, formatDepth } from "@/lib/units";
import { HelpIcon } from "@/components/help/HelpButton";
import {
  usePostMarkers,
  getGetMarkersQueryKey,
  MarkerInputType,
} from "@workspace/api-client-react";
import { useUser } from "@/lib/clerkCompat";
import { routesQueryKey } from "@/components/RoutesPanel";

const ZONE_LABEL = ["Sand", "Sediment", "Silt", "Basalt"] as const;

const SLOT_COLORS = [
  "#dabe91",
  "#5c4e3e",
  "#a8afc0",
  "#262120",
] as const;

const SLOT_NAMES = [
  "Sand",
  "Sediment",
  "Silt",
  "Basalt",
] as const;

const WIDTH = 420;
const HEIGHT = 180;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 28;
const STRIP_HEIGHT = 8;
const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM - STRIP_HEIGHT;

const PANEL_MIN_W = WIDTH + 24;

function timestampForFilename(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 64) || "dataset";
}

function triggerDownload(blob: Blob, filename: string) {
  triggerBlobDownload(blob, filename);
}

/** Clamp a panel position so it can't be dragged fully off-screen. */
function clampPos(x: number, y: number, panelW: number, _panelH: number): { x: number; y: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth  : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 720;
  const MARGIN = 40; // px of panel that must stay visible
  return {
    x: Math.max(-panelW + MARGIN, Math.min(vw - MARGIN, x)),
    y: Math.max(0, Math.min(vh - MARGIN, y)),
  };
}

export const DepthProfilePanel: React.FC = () => {
  const profile = useDepthProfileStore((s) => s.profile);
  const profiles = useDepthProfileStore((s) => s.profiles);
  const selectedIndex = useDepthProfileStore((s) => s.selectedIndex);
  const selectProfile = useDepthProfileStore((s) => s.selectProfile);
  const clearProfile = useDepthProfileStore((s) => s.clearProfile);
  const hoverIndex = useDepthProfileStore((s) => s.hoverIndex);
  const setHoverIndex = useDepthProfileStore((s) => s.setHoverIndex);
  const units = useSettingsStore((s) => s.units);
  const { datasetId, terrain } = useAppState();
  const isSynthetic =
    (terrain as { dataSource?: string; synthetic?: boolean } | null)?.dataSource === "synthetic" ||
    (terrain as { dataSource?: string; synthetic?: boolean } | null)?.synthetic === true;
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  // ── Drag state ────────────────────────────────────────────────────────
  // null = default bottom-center (absolute positioning); set = fixed position.
  const [panelPos, setPanelPos] = React.useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const dragOrigin = React.useRef<{ mouseX: number; mouseY: number; panelX: number; panelY: number } | null>(null);

  const handleDragPointerDown = React.useCallback((e: React.PointerEvent) => {
    // Only drag with primary mouse button or single touch.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();

    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();

    dragOrigin.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panelX: rect.left,
      panelY: rect.top,
    };

    // Switch to fixed positioning at the panel's current visual position.
    setPanelPos({ x: rect.left, y: rect.top });
    setIsDragging(true);
    panel.setPointerCapture(e.pointerId);
  }, []);

  const handleDragPointerMove = React.useCallback((e: React.PointerEvent) => {
    if (!isDragging || !dragOrigin.current || !panelRef.current) return;
    e.preventDefault();

    const dx = e.clientX - dragOrigin.current.mouseX;
    const dy = e.clientY - dragOrigin.current.mouseY;
    const rawX = dragOrigin.current.panelX + dx;
    const rawY = dragOrigin.current.panelY + dy;
    const panelRect = panelRef.current.getBoundingClientRect();
    const { x, y } = clampPos(rawX, rawY, panelRect.width, panelRect.height);
    setPanelPos({ x, y });
  }, [isDragging]);

  const handleDragPointerUp = React.useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    setIsDragging(false);
    dragOrigin.current = null;
    if (panelRef.current) {
      panelRef.current.releasePointerCapture(e.pointerId);
    }
  }, [isDragging]);

  // ── Marker creation ───────────────────────────────────────────────────
  const dropMarkerAtHover = React.useCallback(() => {
    const state = useDepthProfileStore.getState();
    const p = state.profile;
    const idx = state.hoverIndex;
    if (!p || idx === null || idx < 0 || idx >= p.points.length) return;
    const sample = p.points[idx]!;
    useCameraStore.getState().setLastClickedGps({
      lon: sample.lon,
      lat: sample.lat,
      depth: sample.depthM,
    });
    useUiStore.getState().setMarkerFormPrefill(null);
    useUiStore.getState().setMarkerFormOpen(true);
  }, []);

  const { isSignedIn } = useUser();
  const qc = useQueryClient();
  const postMarkers = usePostMarkers();
  const [bulkPending, setBulkPending] = React.useState(false);

  // ── Save as route ─────────────────────────────────────────────────────
  const [showSaveInput, setShowSaveInput] = React.useState(false);
  const [guestSignInPrompt, setGuestSignInPrompt] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");
  const [saveLoading, setSaveLoading] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const defaultRouteName = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `Route ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const openSaveInput = () => {
    if (!isSignedIn) {
      setGuestSignInPrompt(true);
      return;
    }
    setSaveName(defaultRouteName());
    setSaveError(null);
    setShowSaveInput(true);
  };

  const cancelSave = () => {
    setShowSaveInput(false);
    setGuestSignInPrompt(false);
    setSaveError(null);
  };

  const confirmSave = async () => {
    const trimmed = saveName.trim();
    if (!trimmed || !datasetId || !profile || !profile.waypoints || profile.waypoints.length < 2) return;
    setSaveLoading(true);
    setSaveError(null);
    try {
      const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const res = await fetch(`${base}/api/routes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId,
          name: trimmed,
          waypoints: profile.waypoints,
          totalDistanceM: profile.totalDistanceM,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        setSaveError((body.details as string | undefined) ?? `Error ${res.status}`);
        return;
      }
      void qc.invalidateQueries({ queryKey: routesQueryKey(datasetId) });
      setShowSaveInput(false);
    } catch {
      setSaveError("Network error — please try again.");
    } finally {
      setSaveLoading(false);
    }
  };

  const features: ProfileFeature[] = React.useMemo(
    () => (profile ? detectProfileFeatures(profile) : []),
    [profile],
  );

  if (!profile) return null;

  const { points, totalDistanceM, minDepthM, maxDepthM, start, end } = profile;

  const depthRange = (maxDepthM - minDepthM) || 1;
  const padDepth = depthRange * 0.08;
  const yMin = minDepthM - padDepth;
  const yMax = maxDepthM + padDepth;

  const xOf = (distanceM: number): number =>
    PAD_LEFT + (totalDistanceM > 0 ? (distanceM / totalDistanceM) * PLOT_W : 0);
  const yOf = (depthM: number): number =>
    PAD_TOP + ((depthM - yMin) / (yMax - yMin || 1)) * PLOT_H;

  let path = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const cmd = i === 0 ? "M" : "L";
    path += `${cmd}${xOf(p.distanceM).toFixed(1)},${yOf(p.depthM).toFixed(1)} `;
  }

  const firstP = points[0]!;
  const lastP = points[points.length - 1]!;
  const areaPath =
    `M${xOf(firstP.distanceM).toFixed(1)},${(PAD_TOP + PLOT_H).toFixed(1)} ` +
    path +
    `L${xOf(lastP.distanceM).toFixed(1)},${(PAD_TOP + PLOT_H).toFixed(1)} Z`;

  const ticks = [yMin, yMin + (yMax - yMin) * 0.33, yMin + (yMax - yMin) * 0.66, yMax];

  const stripY = PAD_TOP + PLOT_H + 2;
  const stripRects: React.ReactElement[] = [];
  if (points.length >= 2) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const x0 = xOf(a.distanceM);
      const x1 = xOf(b.distanceM);
      const color = a.slot !== null ? SLOT_COLORS[a.slot] ?? "#64748b" : "#64748b";
      stripRects.push(
        <rect
          key={i}
          x={x0}
          y={stripY}
          width={Math.max(1, x1 - x0 + 0.5)}
          height={STRIP_HEIGHT}
          fill={color}
        />,
      );
    }
  }

  const featureLabel = (f: ProfileFeature): string => {
    const sample = points[f.index]!;
    const distStr = formatDistance(sample.distanceM, { units });
    const noun =
      f.kind === "peak" ? "Hump" : f.kind === "trough" ? "Hole" : "Ledge";
    return `${noun} @ ${distStr}`;
  };

  const FEATURE_STYLE: Record<
    ProfileFeatureKind,
    { color: string; glyph: string; tagBg: string }
  > = {
    peak:   { color: "#facc15", glyph: "▲", tagBg: "rgba(250,204,21,0.12)" },
    trough: { color: "#f87171", glyph: "▼", tagBg: "rgba(248,113,113,0.12)" },
    ledge:  { color: "#fb923c", glyph: "◆", tagBg: "rgba(251,146,60,0.12)" },
  };

  const promoteFeature = (f: ProfileFeature) => {
    const sample = points[f.index];
    if (!sample) return;
    useCameraStore.getState().setLastClickedGps({
      lon: sample.lon,
      lat: sample.lat,
      depth: sample.depthM,
    });
    useUiStore.getState().setMarkerFormPrefill({
      label: featureLabel(f),
      type: MarkerInputType.custom,
    });
    useUiStore.getState().setMarkerFormOpen(true);
  };

  const addAllFeatures = async () => {
    if (!datasetId || features.length === 0 || bulkPending) return;
    setBulkPending(true);
    try {
      await Promise.all(
        features.map((f) => {
          const sample = points[f.index]!;
          return postMarkers.mutateAsync({
            data: {
              datasetId,
              lon: sample.lon,
              lat: sample.lat,
              depth: sample.depthM,
              type: MarkerInputType.custom,
              label: featureLabel(f),
              notes: null,
            },
          });
        }),
      );
      void qc.invalidateQueries({
        queryKey: getGetMarkersQueryKey({ datasetId }),
      });
    } catch {
      // Surface failures via mutation state.
    } finally {
      setBulkPending(false);
    }
  };

  const anyClassified = points.some((p) => p.slot !== null);
  const presentSlots = Array.from(
    new Set(points.map((p) => p.slot).filter((s): s is number => s !== null)),
  ).sort();

  const filenameBase = `bathyscan-profile_${sanitizeForFilename(
    datasetId ?? "dataset",
  )}_${timestampForFilename(profile.at)}`;

  const exportCsv = () => {
    const header = "distance_m,depth_m,slot,lon,lat";
    const lines = points.map((p) => {
      const slot = p.slot === null ? "" : String(p.slot);
      return `${p.distanceM.toFixed(3)},${p.depthM.toFixed(4)},${slot},${p.lon.toFixed(7)},${p.lat.toFixed(7)}`;
    });
    const csv = [header, ...lines].join("\n") + "\n";
    triggerDownload(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `${filenameBase}.csv`,
    );
  };

  const exportPng = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(WIDTH));
    clone.setAttribute("height", String(HEIGHT));
    const xml = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob(
      ['<?xml version="1.0" standalone="no"?>\n', xml],
      { type: "image/svg+xml;charset=utf-8" },
    );
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH * scale;
      canvas.height = HEIGHT * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); return; }
      ctx.fillStyle = "#000a14";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) triggerDownload(blob, `${filenameBase}.png`);
      }, "image/png");
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  const exportBtnStyle: React.CSSProperties = {
    background: "rgba(0,229,255,0.08)",
    border: "1px solid rgba(0,229,255,0.35)",
    color: "#cbd5e1",
    cursor: "pointer",
    fontSize: 9,
    letterSpacing: "0.12em",
    padding: "3px 8px",
    borderRadius: 3,
    fontFamily: "inherit",
  };

  // ── Panel positioning ─────────────────────────────────────────────────
  // When panelPos is null, use default bottom-center (absolute).
  // When panelPos is set (after first drag), switch to fixed.
  const panelStyle: React.CSSProperties = panelPos
    ? {
        position: "fixed",
        left: panelPos.x,
        top: panelPos.y,
        zIndex: 36,
        pointerEvents: "auto",
        background: "rgba(0,10,20,0.92)",
        border: "1px solid rgba(0,229,255,0.3)",
        borderRadius: 6,
        padding: 12,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#cbd5e1",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        backdropFilter: "blur(8px)",
        minWidth: PANEL_MIN_W,
      }
    : {
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 36,
        pointerEvents: "auto",
        background: "rgba(0,10,20,0.92)",
        border: "1px solid rgba(0,229,255,0.3)",
        borderRadius: 6,
        padding: 12,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#cbd5e1",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        backdropFilter: "blur(8px)",
        minWidth: PANEL_MIN_W,
      };

  const isPathProfile = profile.mode === "path";

  return (
    <div
      ref={panelRef}
      data-testid="depth-profile-panel"
      className="depth-profile-panel"
      style={panelStyle}
    >
      {/* Header / drag handle */}
      <div
        data-testid="depth-profile-drag-handle"
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: "0.22em", color: "#00e5ff", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "rgba(0,229,255,0.45)", letterSpacing: 0 }}>⠿</span>
          {isPathProfile ? "▼ PATH PROFILE" : "▼ DEPTH PROFILE"}
          <HelpIcon articleId="depth-profile" label="Depth profile" />
        </div>
        <div
          style={{ display: "flex", alignItems: "center", gap: 6 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            data-testid="depth-profile-export-csv"
            aria-label="Download depth profile as CSV"
            onClick={exportCsv}
            style={exportBtnStyle}
          >
            CSV
          </button>
          <button
            data-testid="depth-profile-export-png"
            aria-label="Download depth profile as PNG"
            onClick={exportPng}
            style={exportBtnStyle}
          >
            PNG
          </button>
          <button
            aria-label="Close depth profile"
            onClick={clearProfile}
            style={{
              background: "transparent",
              border: "none",
              color: "#e2e8f0",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* History tabs */}
      {profiles.length > 1 && (
        <div
          data-testid="depth-profile-history"
          style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}
        >
          {profiles.map((p, i) => {
            const isActive = i === selectedIndex;
            const deltaM = p.maxDepthM - p.minDepthM;
            const distKm = p.totalDistanceM / 1000;
            const distLabel =
              distKm >= 1
                ? `${distKm.toFixed(1)} km`
                : `${Math.round(p.totalDistanceM)} m`;
            const depthLabel = formatDepth(deltaM, { units, decimals: 0 });
            const label = i === 0 ? "Latest" : `#${i + 1}`;
            return (
              <button
                key={p.at}
                data-testid={`depth-profile-history-tab-${i}`}
                aria-label={`Depth profile ${label}: Δ ${depthLabel}, ${distLabel}`}
                aria-pressed={isActive}
                onClick={() => selectProfile(i)}
                style={{
                  fontSize: 9,
                  padding: "3px 7px",
                  borderRadius: 3,
                  border: isActive
                    ? "1px solid rgba(0,229,255,0.7)"
                    : "1px solid rgba(0,229,255,0.2)",
                  background: isActive
                    ? "rgba(0,229,255,0.15)"
                    : "rgba(0,229,255,0.04)",
                  color: isActive ? "#00e5ff" : "#cbd5e1",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "0.06em",
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 1,
                  lineHeight: 1.3,
                  minWidth: 48,
                  transition: "border-color 0.1s, background 0.1s, color 0.1s",
                }}
              >
                <span style={{ fontWeight: isActive ? 700 : 400 }}>{label}</span>
                <span style={{ fontSize: 8, color: isActive ? "#e2e8f0" : "#94a3b8" }}>
                  {p.mode === "path" ? "⬡ " : ""}Δ{depthLabel} · {distLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Stats row */}
      <div style={{ fontSize: 10, color: "#e2e8f0", marginBottom: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>LEN <span style={{ color: "#e2e8f0" }}>{formatDistance(totalDistanceM, { units })}</span></span>
        <span>MIN <span style={{ color: "#e2e8f0" }}>{formatDepth(minDepthM, { units, decimals: 1 })}</span></span>
        <span>MAX <span style={{ color: "#e2e8f0" }}>{formatDepth(maxDepthM, { units, decimals: 1 })}</span></span>
        <span>Δ <span style={{ color: "#e2e8f0" }}>{formatDepth(maxDepthM - minDepthM, { units, decimals: 1 })}</span></span>
        {isPathProfile && profile.waypoints && (
          <span>WPT <span style={{ color: "#e2e8f0" }}>{profile.waypoints.length}</span></span>
        )}
      </div>

      {/* Save as route — only for path profiles with ≥2 waypoints on real (non-synthetic) terrain */}
      {isPathProfile && profile.waypoints && profile.waypoints.length >= 2 && !isSynthetic && (
        <div
          data-testid="depth-profile-save-route"
          style={{
            marginBottom: 8,
            padding: "6px 8px",
            background: "rgba(0,229,255,0.04)",
            border: "1px solid rgba(0,229,255,0.14)",
            borderRadius: 4,
          }}
        >
          {guestSignInPrompt ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
              <span style={{ fontSize: 9, color: "#94a3b8" }}>
                Sign in to save routes.
              </span>
              <button
                type="button"
                aria-label="Dismiss sign-in prompt"
                onClick={cancelSave}
                style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 11, lineHeight: 1, padding: "0 2px" }}
              >
                ✕
              </button>
            </div>
          ) : !showSaveInput ? (
            <button
              type="button"
              data-testid="depth-profile-save-route-btn"
              aria-label="Save path as a named route"
              onClick={openSaveInput}
              style={exportBtnStyle}
            >
              🛤 SAVE AS ROUTE…
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <input
                autoFocus
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { void confirmSave(); }
                  if (e.key === "Escape") cancelSave();
                }}
                placeholder="Route name"
                style={{
                  background: "rgba(0,10,20,0.8)",
                  border: "1px solid rgba(0,229,255,0.5)",
                  color: "#e2e8f0",
                  fontFamily: "inherit",
                  fontSize: 10,
                  padding: "3px 7px",
                  borderRadius: 3,
                  width: "100%",
                }}
              />
              {saveError && (
                <div style={{ fontSize: 9, color: "#f87171" }}>{saveError}</div>
              )}
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  data-testid="depth-profile-save-route-confirm"
                  disabled={saveLoading || !saveName.trim()}
                  onClick={() => { void confirmSave(); }}
                  style={{
                    ...exportBtnStyle,
                    opacity: saveLoading || !saveName.trim() ? 0.5 : 1,
                    cursor: saveLoading || !saveName.trim() ? "not-allowed" : "pointer",
                  }}
                >
                  {saveLoading ? "SAVING…" : "SAVE"}
                </button>
                <button
                  type="button"
                  data-testid="depth-profile-save-route-cancel"
                  onClick={cancelSave}
                  style={{ ...exportBtnStyle, background: "transparent" }}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chart */}
      <svg
        ref={svgRef}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label="Depth cross-section"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const localX = ((e.clientX - rect.left) * WIDTH) / rect.width;
          const t = Math.max(0, Math.min(1, (localX - PAD_LEFT) / PLOT_W));
          const idx = Math.max(
            0,
            Math.min(points.length - 1, Math.round(t * (points.length - 1))),
          );
          if (idx !== hoverIndex) setHoverIndex(idx);
        }}
        onMouseLeave={() => setHoverIndex(null)}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const localX = ((e.clientX - rect.left) * WIDTH) / rect.width;
          const t = Math.max(0, Math.min(1, (localX - PAD_LEFT) / PLOT_W));
          const idx = Math.max(
            0,
            Math.min(points.length - 1, Math.round(t * (points.length - 1))),
          );
          setHoverIndex(idx);
          dropMarkerAtHover();
        }}
        style={{ display: "block", cursor: "crosshair" }}
      >
        {/* Plot background */}
        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={PLOT_W}
          height={PLOT_H}
          fill="rgba(0,40,80,0.18)"
          stroke="rgba(0,229,255,0.12)"
        />

        {/* Y-axis gridlines + labels */}
        {ticks.map((d, i) => {
          const y = yOf(d);
          return (
            <g key={i}>
              <line
                x1={PAD_LEFT}
                x2={PAD_LEFT + PLOT_W}
                y1={y}
                y2={y}
                stroke="rgba(0,229,255,0.08)"
              />
              <text
                x={PAD_LEFT - 6}
                y={y + 3}
                fontSize={9}
                fill="#cbd5e1"
                textAnchor="end"
                fontFamily="'JetBrains Mono', monospace"
              >
                {formatDepth(d, { units, localize: false })}
              </text>
            </g>
          );
        })}

        {/* Waypoint boundary lines for path profiles */}
        {isPathProfile && profile.waypoints && profile.waypoints.length > 2 &&
          profile.waypoints.slice(1, -1).map((wp, i) => {
            // Find the sample closest to this intermediate waypoint by lon/lat.
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let j = 0; j < points.length; j++) {
              const dx = points[j]!.lon - wp.lon;
              const dy = points[j]!.lat - wp.lat;
              const d = dx * dx + dy * dy;
              if (d < bestDist) { bestDist = d; bestIdx = j; }
            }
            const x = xOf(points[bestIdx]!.distanceM);
            return (
              <line
                key={i}
                x1={x}
                x2={x}
                y1={PAD_TOP}
                y2={PAD_TOP + PLOT_H}
                stroke="rgba(0,229,255,0.25)"
                strokeDasharray="2 4"
                strokeWidth={1}
              />
            );
          })
        }

        {/* Area fill */}
        <path d={areaPath} fill="rgba(0,229,255,0.12)" />

        {/* Depth polyline */}
        <path
          d={path}
          fill="none"
          stroke="#00e5ff"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Zone strip beneath the chart */}
        {stripRects}

        {/* Auto-detected feature indicators */}
        {features.map((f) => {
          const sample = points[f.index];
          if (!sample) return null;
          const cx = xOf(sample.distanceM);
          const cy = yOf(sample.depthM);
          const fs = FEATURE_STYLE[f.kind];
          const above = f.kind === "peak";
          const tipY = above ? cy - 7 : cy + 7;
          return (
            <g
              key={`feat-${f.index}`}
              data-testid={`depth-profile-feature-${f.kind}`}
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                promoteFeature(f);
              }}
            >
              <text
                x={cx}
                y={tipY}
                fontSize={9}
                fill={fs.color}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ pointerEvents: "auto" }}
              >
                {fs.glyph}
              </text>
            </g>
          );
        })}

        {/* Hover indicator */}
        {hoverIndex !== null && points[hoverIndex] ? (() => {
          const hp = points[hoverIndex]!;
          const hx = xOf(hp.distanceM);
          const hy = yOf(hp.depthM);
          const zoneName = hp.slot !== null ? (ZONE_LABEL[hp.slot] ?? "Zone") : "—";
          const tipW = 132;
          const tipH = 46;
          let tipX = hx + 8;
          if (tipX + tipW > PAD_LEFT + PLOT_W) tipX = hx - tipW - 8;
          const tipY = Math.max(PAD_TOP + 2, hy - tipH - 6);
          return (
            <g pointerEvents="none" data-testid="depth-profile-hover">
              <line
                x1={hx}
                x2={hx}
                y1={PAD_TOP}
                y2={PAD_TOP + PLOT_H}
                stroke="rgba(0,229,255,0.6)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <circle
                cx={hx}
                cy={hy}
                r={4}
                fill="#00e5ff"
                stroke="#001018"
                strokeWidth={1}
              />
              <g transform={`translate(${tipX.toFixed(1)},${tipY.toFixed(1)})`}>
                <rect
                  width={tipW}
                  height={tipH}
                  rx={3}
                  fill="rgba(0,15,25,0.96)"
                  stroke="rgba(0,229,255,0.45)"
                />
                <text x={6} y={13} fontSize={9} fill="#e2e8f0" fontFamily="'JetBrains Mono', monospace">
                  D <tspan fill="#e2e8f0">{formatDistance(hp.distanceM, { units })}</tspan>
                </text>
                <text x={6} y={25} fontSize={9} fill="#e2e8f0" fontFamily="'JetBrains Mono', monospace">
                  Z <tspan fill="#e2e8f0">{formatDepth(hp.depthM, { units, decimals: 1 })}</tspan>
                </text>
                <text x={6} y={37} fontSize={9} fill="#e2e8f0" fontFamily="'JetBrains Mono', monospace">
                  ZN <tspan fill="#e2e8f0">{zoneName}</tspan>
                </text>
              </g>
            </g>
          );
        })() : null}

        {/* X-axis labels */}
        <text
          x={PAD_LEFT}
          y={HEIGHT - 4}
          fontSize={9}
          fill="#cbd5e1"
          textAnchor="start"
          fontFamily="'JetBrains Mono', monospace"
        >
          0 m
        </text>
        <text
          x={PAD_LEFT + PLOT_W}
          y={HEIGHT - 4}
          fontSize={9}
          fill="#cbd5e1"
          textAnchor="end"
          fontFamily="'JetBrains Mono', monospace"
        >
          {formatDistance(totalDistanceM)}
        </text>
      </svg>

      {/* Endpoint coords */}
      <div style={{ fontSize: 9, color: "#cbd5e1", marginTop: 6, display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span>A {start.lat.toFixed(4)},{start.lon.toFixed(4)}</span>
        <span>B {end.lat.toFixed(4)},{end.lon.toFixed(4)}</span>
      </div>

      {/* Auto-suggested features */}
      {features.length > 0 && (
        <div
          data-testid="depth-profile-features"
          style={{
            marginTop: 8,
            paddingTop: 6,
            borderTop: "1px dashed rgba(0,229,255,0.15)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 5,
            }}
          >
            <div style={{ fontSize: 9, letterSpacing: "0.18em", color: "#e2e8f0" }}>
              SUGGESTED ({features.length})
            </div>
            <button
              type="button"
              data-testid="depth-profile-add-all-features"
              aria-label="Add all detected features as markers"
              disabled={bulkPending || !datasetId}
              onClick={() => { void addAllFeatures(); }}
              style={{
                ...exportBtnStyle,
                opacity: bulkPending || !datasetId ? 0.5 : 1,
                cursor: bulkPending || !datasetId ? "not-allowed" : "pointer",
              }}
            >
              {bulkPending ? "ADDING…" : "+ ADD ALL"}
            </button>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 5,
              maxHeight: 70,
              overflowY: "auto",
            }}
          >
            {features.map((f) => {
              const fs = FEATURE_STYLE[f.kind];
              return (
                <button
                  key={f.index}
                  type="button"
                  data-testid={`depth-profile-promote-feature-${f.index}`}
                  aria-label={`Add marker for ${featureLabel(f)}`}
                  onClick={() => promoteFeature(f)}
                  onMouseEnter={() => setHoverIndex(f.index)}
                  onMouseLeave={() => setHoverIndex(null)}
                  style={{
                    fontSize: 9,
                    padding: "3px 6px",
                    borderRadius: 3,
                    border: `1px solid ${fs.color}55`,
                    background: fs.tagBg,
                    color: "#e2e8f0",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    letterSpacing: "0.04em",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <span style={{ color: fs.color }}>{fs.glyph}</span>
                  {featureLabel(f)}
                  <span style={{ color: "#cbd5e1" }}>+</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {anyClassified ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6, fontSize: 9, color: "#e2e8f0" }}>
          {presentSlots.map((slot) => (
            <span key={slot} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 8,
                  background: SLOT_COLORS[slot] ?? "#64748b",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              />
              {SLOT_NAMES[slot] ?? "Zone"}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 6, fontSize: 9, color: "#94a3b8" }}>
          Zone classification not yet available — strip shows neutral grey.
        </div>
      )}
    </div>
  );
};
