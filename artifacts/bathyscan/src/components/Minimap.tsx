import React, { useEffect, useRef } from "react";
import { useAppState } from "@/lib/context";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { useGetMarkers, getGetMarkersQueryKey } from "@workspace/api-client-react";
import type { Marker } from "@workspace/api-client-react";
import { getColormap } from "@/lib/colormap";
import { usePaletteStore } from "@/lib/paletteStore";
import { useSettingsStore } from "@/lib/settingsStore";
import type { ColormapTheme } from "@/lib/settingsStore";
import { WORLD_SIZE } from "@/lib/terrain";
import { MARKER_COLOR } from "@/lib/markerConstants";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";

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
      const gy = Math.min(height - 1, Math.floor((py / H) * height));
      const idx = gy * width + gx;
      const depth = depths[idx] ?? minDepth;
      const t = (depth - minDepth) / depthRange;
      const c = toColor(t);
      const i = (py * W + px) * 4;
      imageData.data[i] = Math.round(c.r * 255);
      imageData.data[i + 1] = Math.round(c.g * 255);
      imageData.data[i + 2] = Math.round(c.b * 255);
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
  const rad = heading * (Math.PI / 180);
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
    const py = ((m.lat - minLat) / latRange) * H;
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
  const heatmapRef = useRef<ImageData | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const setOverviewOpen = useUiStore((s) => s.setOverviewOpen);
  const colormapTheme = useSettingsStore((s) => s.colormapTheme);
  const shallow = usePaletteStore((s) => s.shallow);
  const deep = usePaletteStore((s) => s.deep);
  const bandColors = usePaletteStore((s) => s.bandColors);
  const customStops = usePaletteStore((s) => s.customStops);

  const datasetId = terrain?.datasetId ?? "";
  const { data: markers } = useGetMarkers(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  // Keep markers ref in sync
  useEffect(() => {
    markersRef.current = markers ?? [];
  }, [markers]);

  // Draw heatmap when terrain, colormap theme, or palette changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawHeatmap(
      ctx,
      terrain.depths,
      terrain.width,
      terrain.height,
      terrain.minDepth,
      terrain.maxDepth,
      colormapTheme,
    );
    heatmapRef.current = ctx.getImageData(0, 0, W, H);
  }, [terrain, colormapTheme, shallow, deep, bandColors, customStops]);

  // Subscribe to cameraStore and update arrow + marker dots imperatively
  useEffect(() => {
    const unsub = useCameraStore.subscribe((state) => {
      const canvas = canvasRef.current;
      if (!canvas || !terrain) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Restore heatmap
      if (heatmapRef.current) {
        ctx.putImageData(heatmapRef.current, 0, 0);
      }

      // Draw marker dots
      drawMarkerDots(
        ctx,
        markersRef.current,
        terrain.minLon,
        terrain.maxLon,
        terrain.minLat,
        terrain.maxLat,
      );

      // Draw camera arrow if position is known
      if (state.cameraLon !== null && state.cameraLat !== null) {
        const px = ((state.cameraLon - terrain.minLon) / (terrain.maxLon - terrain.minLon)) * W;
        const py = ((state.cameraLat - terrain.minLat) / (terrain.maxLat - terrain.minLat)) * H;
        if (px >= 0 && px <= W && py >= 0 && py <= H) {
          drawArrow(ctx, px, py, state.heading);
        }
      }
    });

    return () => { unsub(); };
  }, [terrain]);

  // Force a canvas redraw whenever markers change (camera may not have moved)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (heatmapRef.current) ctx.putImageData(heatmapRef.current, 0, 0);

    drawMarkerDots(
      ctx,
      markersRef.current,
      terrain.minLon,
      terrain.maxLon,
      terrain.minLat,
      terrain.maxLat,
    );

    const camState = useCameraStore.getState();
    if (camState.cameraLon !== null && camState.cameraLat !== null) {
      const px = ((camState.cameraLon - terrain.minLon) / (terrain.maxLon - terrain.minLon)) * W;
      const py = ((camState.cameraLat - terrain.minLat) / (terrain.maxLat - terrain.minLat)) * H;
      if (px >= 0 && px <= W && py >= 0 && py <= H) {
        drawArrow(ctx, px, py, camState.heading);
      }
    }
  }, [markers, terrain]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const worldX = (px / W) * WORLD_SIZE - WORLD_SIZE / 2;
    const worldZ = (py / H) * WORLD_SIZE - WORLD_SIZE / 2;
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
      </div>
    </div>
  );
};
