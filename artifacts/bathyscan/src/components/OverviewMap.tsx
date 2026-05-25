import React, { useEffect, useRef, useState, useCallback } from "react";
import { useGetMarkers, getGetMarkersQueryKey } from "@workspace/api-client-react";
import type { Marker } from "@workspace/api-client-react";
import { useTerrainStore } from "@/lib/terrainStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import {
  buildHeatmapBitmap,
  computeInitialTransform,
  clampTransform,
  canvasToLonLat,
  renderHeatmap,
  renderGridLines,
  renderMarkers,
  renderDepthPoles,
  renderCameraArrow,
  renderScaleBar,
  renderHabitatOverlay,
  renderGpsPosition,
  renderLiveTrail,
} from "@/lib/overviewRenderer";
import type { OverviewTransform } from "@/lib/overviewRenderer";
import { useHabitatStore } from "@/lib/habitatStore";
import { useGpsStore } from "@/lib/gpsStore";
import { useTrailStore } from "@/lib/trailStore";

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  lon: number;
  lat: number;
  depth: number;
}

export const OverviewMap: React.FC = () => {
  const setOverviewOpen = useUiStore((s) => s.setOverviewOpen);
  const setPendingDropIn = useUiStore((s) => s.setPendingDropIn);
  const gpsActive = useGpsStore((s) => s.active);
  const gpsPosition = useGpsStore((s) => s.position);
  const gpsError = useGpsStore((s) => s.error);
  const startWatching = useGpsStore((s) => s.startWatching);
  const overviewGrid = useTerrainStore((s) => s.overviewGrid);

  const datasetId = overviewGrid?.datasetId ?? "";
  const { data: markerData } = useGetMarkers(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  // --- Canvas ref ---
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Stable refs (no React state — updated imperatively in event handlers / rAF) ---
  const bitmapRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef<OverviewTransform | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const rafRef = useRef<number>(0);

  // Drag tracking
  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // Mouse position (canvas-relative, −1 means outside)
  const mousePosRef = useRef({ x: -1, y: -1 });

  // --- React state: tooltip only ---
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false, x: 0, y: 0, lon: 0, lat: 0, depth: 0,
  });

  // GPS & trail state (read directly from stores in rAF — no React re-render)
  const pulseRef = useRef(0);

  // Keep markers ref in sync without causing rAF re-registration
  useEffect(() => {
    markersRef.current = markerData ?? [];
  }, [markerData]);

  // Build offscreen bitmap whenever overviewGrid changes
  useEffect(() => {
    if (!overviewGrid) return;
    bitmapRef.current = buildHeatmapBitmap(overviewGrid);
  }, [overviewGrid]);

  // Compute initial transform whenever the grid or canvas is ready
  const initTransform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !overviewGrid) return;
    transformRef.current = computeInitialTransform(overviewGrid, canvas.width, canvas.height);
  }, [overviewGrid]);

  useEffect(() => {
    initTransform();
  }, [initTransform]);

  // ---------------------------------------------------------------------------
  // rAF render loop
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const loop = () => {
      const ctx = canvas.getContext("2d");
      const grid = overviewGrid;
      const bitmap = bitmapRef.current;
      const t = transformRef.current;

      if (!ctx || !grid || !bitmap || !t) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const cW = canvas.width;
      const cH = canvas.height;

      // Background
      ctx.fillStyle = "#020818";
      ctx.fillRect(0, 0, cW, cH);

      // Depth heatmap
      renderHeatmap(ctx, bitmap, grid, t);

      // Lat/lon grid (only at scale ≥ 2)
      renderGridLines(ctx, grid, t, cW, cH);

      // Markers
      renderMarkers(ctx, markersRef.current, grid, t, cW, cH);

      // Depth poles (drawn above markers so labels are visible)
      renderDepthPoles(ctx, markersRef.current, grid, t);

      // Camera arrow — read from Zustand store directly (no React re-render)
      const cam = useCameraStore.getState();
      if (cam.cameraLon !== null && cam.cameraLat !== null) {
        renderCameraArrow(ctx, cam.cameraLon, cam.cameraLat, cam.heading, grid, t);
      }

      // Habitat overlay (drawn above depth heatmap, below markers)
      const habitatScores = useHabitatStore.getState().scores;
      const habitatActive = useHabitatStore.getState().activeSpecies !== null;
      if (habitatActive && habitatScores) {
        renderHabitatOverlay(ctx, habitatScores, grid, t);
      }

      // GPS position + live trail
      const gps = useGpsStore.getState();
      const trail = useTrailStore.getState();
      pulseRef.current = (pulseRef.current + 0.02) % 1;
      const pulse = Math.abs(Math.sin(pulseRef.current * Math.PI));

      if (trail.recording && trail.currentPoints.length > 0) {
        renderLiveTrail(ctx, trail.currentPoints, grid, t, pulse);
      }

      if (gps.active && gps.position) {
        renderGpsPosition(
          ctx,
          gps.position.longitude,
          gps.position.latitude,
          gps.position.accuracy,
          grid,
          t,
          cW,
          cH,
          pulse,
        );
      }

      // Scale bar
      renderScaleBar(ctx, grid, t, cH);

      // Subtle border
      ctx.strokeStyle = "rgba(0,229,255,0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, cW - 1, cH - 1);

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [overviewGrid]);

  // ---------------------------------------------------------------------------
  // Mouse / wheel events
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      hasDraggedRef.current = false;
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        ox: transformRef.current?.offsetX ?? 0,
        oy: transformRef.current?.offsetY ?? 0,
      };
    };

    const updateTooltip = (mx: number, my: number) => {
      const grid = overviewGrid;
      const t = transformRef.current;
      if (!grid || !t) return;

      const { lon, lat } = canvasToLonLat(mx, my, grid, t);
      const lonRange = grid.maxLon - grid.minLon || 1;
      const latRange = grid.maxLat - grid.minLat || 1;
      const col = Math.round(((lon - grid.minLon) / lonRange) * (grid.width - 1));
      const row = Math.round(((lat - grid.minLat) / latRange) * (grid.height - 1));
      const inBounds =
        col >= 0 && col < grid.width && row >= 0 && row < grid.height;
      const depth = inBounds ? (grid.depths[row * grid.width + col] ?? 0) : 0;
      setTooltip({ visible: inBounds, x: mx + 14, y: my - 10, lon, lat, depth });
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      mousePosRef.current = { x: mx, y: my };

      // Tooltip
      const insideCanvas =
        mx >= 0 && mx < canvas.width && my >= 0 && my < canvas.height;
      if (insideCanvas) {
        updateTooltip(mx, my);
      } else {
        setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      }

      // Pan
      if (!isDraggingRef.current || !transformRef.current || !overviewGrid) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasDraggedRef.current = true;

      transformRef.current = clampTransform(
        {
          ...transformRef.current,
          offsetX: dragStartRef.current.ox + dx,
          offsetY: dragStartRef.current.oy + dy,
        },
        overviewGrid,
        canvas.width,
        canvas.height,
      );
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    const handleMouseLeave = () => {
      isDraggingRef.current = false;
      mousePosRef.current = { x: -1, y: -1 };
      setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;
      if (!t || !overviewGrid) return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newScale = Math.max(0.5, Math.min(20, t.scale * factor));
      const ratio = newScale / t.scale;

      transformRef.current = clampTransform(
        {
          ...t,
          scale: newScale,
          offsetX: mx + (t.offsetX - mx) * ratio,
          offsetY: my + (t.offsetY - my) * ratio,
        },
        overviewGrid,
        canvas.width,
        canvas.height,
      );
    };

    const handleClick = (e: MouseEvent) => {
      if (hasDraggedRef.current) return;
      const t = transformRef.current;
      if (!t || !overviewGrid) return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const { lon, lat } = canvasToLonLat(mx, my, overviewGrid, t);
      const { x: worldX, z: worldZ } = lonLatToWorldXZ(lon, lat, overviewGrid);

      useUiStore.getState().setPendingDropIn({ worldX, worldZ });
      useUiStore.getState().setOverviewOpen(false);
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("click", handleClick);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("click", handleClick);
    };
  }, [overviewGrid]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        background: "#020818",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Canvas fills the overlay */}
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        style={{ width: "100%", height: "100%", cursor: "crosshair", display: "block" }}
      />

      {/* Header bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          background: "rgba(2,8,24,0.75)",
          backdropFilter: "blur(6px)",
          borderBottom: "1px solid rgba(0,229,255,0.1)",
          zIndex: 41,
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            letterSpacing: "0.25em",
            color: "#00e5ff",
            textShadow: "0 0 8px rgba(0,229,255,0.45)",
          }}
        >
          ▼ OVERVIEW MAP
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            letterSpacing: "0.12em",
            color: "#334155",
          }}
        >
          SCROLL TO ZOOM · DRAG TO PAN · CLICK TO DROP IN · [O] CLOSE
        </span>

        {/* GPS controls */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", pointerEvents: "auto" }}>
          {gpsError && (
            <span style={{ color: "#ef4444", fontSize: 9, fontFamily: "'JetBrains Mono', monospace", maxWidth: 180 }}>
              ⚠ {gpsError}
            </span>
          )}

          {gpsActive && gpsPosition && overviewGrid && (() => {
            const inBounds =
              gpsPosition.latitude >= overviewGrid.minLat &&
              gpsPosition.latitude <= overviewGrid.maxLat &&
              gpsPosition.longitude >= overviewGrid.minLon &&
              gpsPosition.longitude <= overviewGrid.maxLon;
            if (!inBounds) return null;
            return (
              <button
                onClick={() => {
                  const { x: worldX, z: worldZ } = lonLatToWorldXZ(
                    gpsPosition.longitude,
                    gpsPosition.latitude,
                    overviewGrid,
                  );
                  setPendingDropIn({ worldX, worldZ });
                  setOverviewOpen(false);
                }}
                style={{
                  background: "rgba(59,130,246,0.15)",
                  border: "1px solid rgba(59,130,246,0.5)",
                  borderRadius: 3,
                  color: "#60a5fa",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9,
                  padding: "2px 8px",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  lineHeight: "20px",
                  whiteSpace: "nowrap",
                }}
              >
                ↓ DIVE HERE
              </button>
            );
          })()}

          <button
            onClick={() => startWatching()}
            style={{
              background: gpsActive ? "rgba(59,130,246,0.15)" : "rgba(0,10,20,0.75)",
              border: `1px solid ${gpsActive ? "rgba(59,130,246,0.5)" : "rgba(0,229,255,0.2)"}`,
              borderRadius: 3,
              color: gpsActive ? "#60a5fa" : "#475569",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              padding: "2px 10px",
              cursor: "pointer",
              letterSpacing: "0.1em",
              lineHeight: "20px",
              whiteSpace: "nowrap",
            }}
          >
            {gpsActive ? "📍 GPS ACTIVE" : "📍 MY LOCATION"}
          </button>

          <button
            onClick={() => setOverviewOpen(false)}
            style={{
              pointerEvents: "auto",
              background: "none",
              border: "1px solid rgba(0,229,255,0.2)",
              color: "#475569",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              padding: "1px 10px",
              borderRadius: 3,
              cursor: "pointer",
              letterSpacing: "0.1em",
              lineHeight: "20px",
            }}
          >
            ✕ CLOSE
          </button>
        </div>
      </div>

      {/* Depth tooltip */}
      {tooltip.visible && (
        <div
          style={{
            position: "absolute",
            left: tooltip.x,
            top: tooltip.y,
            background: "rgba(2,8,24,0.92)",
            border: "1px solid rgba(0,229,255,0.2)",
            borderRadius: 4,
            padding: "5px 9px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 42,
          }}
        >
          <div style={{ color: "#00e5ff", marginBottom: 1 }}>
            {tooltip.lon.toFixed(4)}° &nbsp;{tooltip.lat.toFixed(4)}°
          </div>
          <div style={{ color: "#64748b" }}>{Math.round(tooltip.depth)} m depth</div>
        </div>
      )}
    </div>
  );
};
