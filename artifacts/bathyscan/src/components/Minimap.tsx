import React, { useEffect, useRef, useMemo } from "react";
import { useAppState } from "@/lib/context";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { useGetMarkers, getGetMarkersQueryKey } from "@workspace/api-client-react";
import type { Marker } from "@workspace/api-client-react";
import { getColormap, colormapCssGradient } from "@/lib/colormap";
import { usePaletteStore } from "@/lib/paletteStore";
import { useSettingsStore } from "@/lib/settingsStore";
import type { ColormapTheme } from "@/lib/settingsStore";
import { WORLD_SIZE } from "@/lib/terrain";
import { MARKER_COLOR } from "@/lib/markerConstants";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { useSatelliteTileStore } from "@/lib/satelliteTileStore";

const W = 180;
const H = 180;

function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  depths: number[],
  width: number,
  height: number,
  minDepth: number,
  maxDepth: number,
  colormapTheme: ColormapTheme = "ocean",
) {
  const depthRange = maxDepth - minDepth || 1;
  const toColor = getColormap(colormapTheme);
  const imageData = ctx.createImageData(W, H);

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const gx = Math.min(width - 1, Math.floor((px / W) * width));
      // Flip y so that py=0 (top) maps to high-latitude rows (North-up).
      const gy = (height - 1) - Math.min(height - 1, Math.floor((py / H) * height));
      const idx = gy * width + gx;
      const depth = depths[idx] ?? minDepth;
      const t = (depth - minDepth) / depthRange;
      // Convert THREE.Color (linear-sRGB when ColorManagement is enabled) to
      // display-space sRGB bytes for 2D canvas, matching the legend overlay
      // and the colormapCanvas helper in colormap.ts.
      const lin = toColor(t);
      const c = lin.clone().convertLinearToSRGB();
      const i = (py * W + px) * 4;
      imageData.data[i] = Math.max(0, Math.min(255, Math.round(c.r * 255)));
      imageData.data[i + 1] = Math.max(0, Math.min(255, Math.round(c.g * 255)));
      imageData.data[i + 2] = Math.max(0, Math.min(255, Math.round(c.b * 255)));
      imageData.data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export function drawArrow(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  heading: number,
) {
  // North-up convention: heading 180° = North = top of canvas = rotate(0).
  // Formula: (180 - heading) maps the cameraStore heading to canvas rotation.
  const rad = (180 - heading) * (Math.PI / 180);
  const size = 7;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(rad);

  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.6, size * 0.6);
  ctx.lineTo(0, 0);
  ctx.lineTo(-size * 0.6, size * 0.6);
  ctx.closePath();

  ctx.fillStyle = "#00e5ff";
  ctx.shadowColor = "#00e5ff";
  ctx.shadowBlur = 6;
  ctx.fill();

  ctx.restore();
}

function drawMarkerDots(
  ctx: CanvasRenderingContext2D,
  markers: Marker[],
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
) {
  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;

  for (const m of markers) {
    const px = ((m.lon - minLon) / lonRange) * W;
    // North-up: invert y so high-lat (North) is at top.
    const py = H - ((m.lat - minLat) / latRange) * H;
    if (px < 0 || px > W || py < 0 || py > H) continue;

    const color = MARKER_COLOR[m.type] ?? "#e2e8f0";

    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

export const Minimap: React.FC = () => {
  const { terrain } = useAppState();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Stored as an offscreen canvas so we can drawImage with globalAlpha for
  // satellite compositing (putImageData ignores globalAlpha).
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const satelliteImgRef = useRef<HTMLImageElement | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const setOverviewOpen = useUiStore((s) => s.setOverviewOpen);
  const colormapTheme = useSettingsStore((s) => s.colormapTheme);
  const units = useSettingsStore((s) => s.units);
  const shallow = usePaletteStore((s) => s.shallow);
  const deep = usePaletteStore((s) => s.deep);
  const bandColors = usePaletteStore((s) => s.bandColors);
  const customStops = usePaletteStore((s) => s.customStops);
  const bandBoundaries = usePaletteStore((s) => s.bandBoundaries);

  // Build the CSS gradient for the legend strip.  Re-computed only when the
  // theme or palette changes — same dependencies that rebuild the heatmap.
  const legendGradient = useMemo(
    () => colormapCssGradient(colormapTheme, "to bottom", 16),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colormapTheme, shallow, deep, bandColors, customStops, bandBoundaries],
  );

  // Depth labels for the legend (shallow top, deep bottom)
  const legendLabels = useMemo(() => {
    if (!terrain) return { top: "", mid: "", bot: "" };
    const { minDepth, maxDepth } = terrain;
    const fmt = (m: number) => {
      const d = Math.abs(Math.round(m));
      return units !== "metric" ? `${Math.round(d * 3.28084)}ft` : `${d}m`;
    };
    return {
      top: fmt(minDepth),
      mid: fmt((minDepth + maxDepth) / 2),
      bot: fmt(maxDepth),
    };
  }, [terrain, units]);

  const tileUrl = useSatelliteTileStore((s) => s.tileUrl);

  // Load satellite image whenever the tile URL changes. Trigger an immediate
  // redraw on load so the background appears without waiting for the next
  // camera movement (Minimap has no continuous rAF loop unlike OverviewMap).
  useEffect(() => {
    if (!tileUrl) {
      satelliteImgRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      satelliteImgRef.current = img;
      // Redraw immediately so satellite background appears on load.
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx || !heatmapCanvasRef.current) return;
      const camState = useCameraStore.getState();
      compositeFrame(ctx, camState.cameraLon, camState.cameraLat, camState.heading);
    };
    img.onerror = () => {
      satelliteImgRef.current = null;
    };
    img.src = tileUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileUrl]);

  const datasetId = terrain?.datasetId ?? "";
  const { data: markers } = useGetMarkers(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  // Keep markers ref in sync
  useEffect(() => {
    markersRef.current = markers ?? [];
  }, [markers]);

  // Composite the minimap: dark background → satellite → heatmap (semi-transparent)
  // → marker dots → camera arrow. Using drawImage for the heatmap layer so
  // globalAlpha compositing works (putImageData ignores globalAlpha).
  const compositeFrame = (
    ctx: CanvasRenderingContext2D,
    camLon: number | null,
    camLat: number | null,
    heading: number,
  ) => {
    if (!terrain) return;

    // 1. Dark background (fallback when satellite not yet loaded)
    ctx.fillStyle = "#020818";
    ctx.fillRect(0, 0, W, H);

    // 2. Satellite imagery background
    if (satelliteImgRef.current) {
      ctx.drawImage(satelliteImgRef.current, 0, 0, W, H);
    }

    // 3. Depth heatmap — semi-transparent overlay so satellite shows through
    if (heatmapCanvasRef.current) {
      ctx.globalAlpha = satelliteImgRef.current ? 0.65 : 1.0;
      ctx.drawImage(heatmapCanvasRef.current, 0, 0);
      ctx.globalAlpha = 1.0;
    }

    // 4. Marker dots
    drawMarkerDots(
      ctx,
      markersRef.current,
      terrain.minLon,
      terrain.maxLon,
      terrain.minLat,
      terrain.maxLat,
    );

    // 5. Camera arrow
    if (camLon !== null && camLat !== null) {
      const px = ((camLon - terrain.minLon) / (terrain.maxLon - terrain.minLon)) * W;
      // North-up: invert y so high-lat (North) is at top.
      const py = H - ((camLat - terrain.minLat) / (terrain.maxLat - terrain.minLat)) * H;
      if (px >= 0 && px <= W && py >= 0 && py <= H) {
        drawArrow(ctx, px, py, heading);
      }
    }
  };

  // Rebuild heatmap offscreen canvas when terrain, colormap theme, or palette changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Build offscreen heatmap canvas so it can be drawImage'd with globalAlpha.
    const offscreen = document.createElement("canvas");
    offscreen.width = W;
    offscreen.height = H;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;
    drawHeatmap(
      offCtx,
      terrain.depths,
      terrain.width,
      terrain.height,
      terrain.minDepth,
      terrain.maxDepth,
      colormapTheme,
    );
    heatmapCanvasRef.current = offscreen;

    const camState = useCameraStore.getState();
    compositeFrame(ctx, camState.cameraLon, camState.cameraLat, camState.heading);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, colormapTheme, shallow, deep, bandColors, customStops, bandBoundaries]);

  // Re-composite when satellite image loads (tileUrl changed)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain || !heatmapCanvasRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const camState = useCameraStore.getState();
    compositeFrame(ctx, camState.cameraLon, camState.cameraLat, camState.heading);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileUrl]);

  // Subscribe to cameraStore and update arrow + marker dots imperatively
  useEffect(() => {
    const unsub = useCameraStore.subscribe((state) => {
      const canvas = canvasRef.current;
      if (!canvas || !terrain) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      compositeFrame(ctx, state.cameraLon, state.cameraLat, state.heading);
    });

    return () => { unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain]);

  // Force a canvas redraw whenever markers change (camera may not have moved)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const camState = useCameraStore.getState();
    compositeFrame(ctx, camState.cameraLon, camState.cameraLat, camState.heading);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, terrain]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const worldX = (px / W) * WORLD_SIZE - WORLD_SIZE / 2;
    // North-up: top of canvas = North = high worldZ; invert y.
    const worldZ = WORLD_SIZE / 2 - (py / H) * WORLD_SIZE;
    useUiStore.getState().setPendingDropIn({ worldX, worldZ });
  };

  if (!terrain) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 4,
        pointerEvents: "auto",
      }}
    >
      <ViewscreenTooltip label="Open the full overview map" side="left">
        <button
          onClick={() => setOverviewOpen(true)}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            letterSpacing: "0.15em",
            color: "#94a3b8",
            background: "rgba(0,10,20,0.75)",
            border: "1px solid rgba(0,229,255,0.15)",
            borderRadius: 3,
            padding: "3px 8px",
            cursor: "pointer",
          }}
          className="hover:text-cyan-400 transition-colors"
        >
          ▲ OVERVIEW
        </button>
      </ViewscreenTooltip>


      <div
        style={{
          position: "relative",
          border: "1px solid rgba(0,229,255,0.25)",
          borderRadius: 4,
          overflow: "hidden",
          boxShadow: "0 0 12px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,229,255,0.1)",
        }}
      >
        <ViewscreenTooltip label="Click to teleport here" side="left">
          <canvas
            ref={canvasRef}
            data-testid="minimap-canvas"
            width={W}
            height={H}
            onClick={handleClick}
            style={{ display: "block", cursor: "crosshair" }}
          />
        </ViewscreenTooltip>
        {/* Corner label */}
        <div
          style={{
            position: "absolute",
            top: 3,
            left: 5,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 8,
            color: "rgba(0,229,255,0.4)",
            letterSpacing: "0.1em",
            pointerEvents: "none",
          }}
        >
          MINIMAP
        </div>
        {/* North indicator */}
        <div
          style={{
            position: "absolute",
            top: 3,
            right: 5,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 8,
            fontWeight: 700,
            color: "rgba(0,229,255,0.6)",
            pointerEvents: "none",
          }}
        >
          N
        </div>
        {/* South indicator */}
        <div
          style={{
            position: "absolute",
            bottom: 3,
            right: 5,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 8,
            fontWeight: 700,
            color: "rgba(0,229,255,0.35)",
            pointerEvents: "none",
          }}
        >
          S
        </div>
        {/* Colormap legend strip — bottom-left, shallow top → deep bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 14,
            left: 5,
            display: "flex",
            flexDirection: "row",
            alignItems: "stretch",
            gap: 3,
            pointerEvents: "none",
          }}
        >
          {/* Gradient strip */}
          <div
            style={{
              width: 6,
              height: 72,
              background: legendGradient,
              border: "0.5px solid rgba(255,255,255,0.2)",
              flexShrink: 0,
            }}
          />
          {/* Depth labels: top / mid / bottom */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 7,
              color: "rgba(255,255,255,0.65)",
              lineHeight: 1,
            }}
          >
            <span>{legendLabels.top}</span>
            <span>{legendLabels.mid}</span>
            <span>{legendLabels.bot}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
