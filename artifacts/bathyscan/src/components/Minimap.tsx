import React, { useEffect, useRef, useMemo } from "react";
import { useAppState } from "@/lib/context";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { useGetMarkers, getGetMarkersQueryKey } from "@workspace/api-client-react";
import type { Marker } from "@workspace/api-client-react";
import { getColormap, getColormapDepthDomain, getColormapTRange, colormapCssGradient } from "@/lib/colormap";
import { usePaletteStore } from "@/lib/paletteStore";
import { useSettingsStore } from "@/lib/settingsStore";
import type { ColormapTheme } from "@/lib/settingsStore";
import { WORLD_SIZE, NO_DATA_COLOR } from "@/lib/terrain";
import type { DepthsArray } from "@workspace/api-client-react";
import { MARKER_COLOR } from "@/lib/markerConstants";
import { loadMarkerIconImage, peekMarkerIconImage } from "@/lib/markerIcons";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { useSatelliteTileStore } from "@/lib/satelliteTileStore";

const W = 180;
const H = 180;

// sRGB-gamma byte for a linear-light channel value — keeps NO_DATA_COLOR on
// the same perceptual path as the colormapped tiles.
function linToSRGBByte(c: number): number {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

const ND_R = linToSRGBByte(NO_DATA_COLOR.r);
const ND_G = linToSRGBByte(NO_DATA_COLOR.g);
const ND_B = linToSRGBByte(NO_DATA_COLOR.b);

function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  depths: DepthsArray,
  width: number,
  height: number,
  minDepth: number,
  maxDepth: number,
  colormapTheme: ColormapTheme = "ocean",
  topography?: number[] | null,
) {
  // Match the 3D terrain: ocean/custom themes normalise against the absolute
  // 0–2000 ft scale; fixed themes stretch across the grid's own range.
  const domain = getColormapDepthDomain(colormapTheme, minDepth, maxDepth);
  const depthRange = domain.max - domain.min || 1;
  const toColor = getColormap(colormapTheme);
  const imageData = ctx.createImageData(W, H);

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const gx = Math.min(width - 1, Math.floor((px / W) * width));
      // Flip y so that py=0 (top) maps to high-latitude rows (North-up).
      const gy = (height - 1) - Math.min(height - 1, Math.floor((py / H) * height));
      const idx = gy * width + gx;
      const rawDepth = depths[idx];
      const i = (py * W + px) * 4;

      // Null/undefined depth → survey gap: render as NO_DATA_COLOR light-gray,
      // matching overviewRenderer.ts and the 3D terrain mesh behaviour.
      if (rawDepth === null || rawDepth === undefined) {
        imageData.data[i]     = ND_R;
        imageData.data[i + 1] = ND_G;
        imageData.data[i + 2] = ND_B;
        imageData.data[i + 3] = 255;
        continue;
      }

      // Land cell (above-water elevation > 0 in topography): render as flat
      // gray matching overviewRenderer.ts and the 3D shader land colour.
      if (topography && (topography[idx] ?? 0) > 0) {
        imageData.data[i]     = 120;
        imageData.data[i + 1] = 120;
        imageData.data[i + 2] = 120;
        imageData.data[i + 3] = 255;
        continue;
      }

      const t = (rawDepth - domain.min) / depthRange;
      // Convert THREE.Color (linear-sRGB when ColorManagement is enabled) to
      // display-space sRGB bytes for 2D canvas, matching the legend overlay
      // and the colormapCanvas helper in colormap.ts.
      const lin = toColor(t);
      const c = lin.clone().convertLinearToSRGB();
      imageData.data[i]     = Math.max(0, Math.min(255, Math.round(c.r * 255)));
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

  ctx.fillStyle = "#d4ac0d";
  ctx.shadowColor = "#d4ac0d";
  ctx.shadowBlur = 6;
  ctx.fill();

  ctx.restore();
}

/** Rasterised marker-icon size used on the minimap (source px / drawn px). */
const MARKER_ICON_SRC_PX = 32;
const MARKER_ICON_DRAW_PX = 12;

function drawMarkerDots(
  ctx: CanvasRenderingContext2D,
  markers: Marker[],
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  onIconReady?: () => void,
) {
  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;

  for (const m of markers) {
    const px = ((m.lon - minLon) / lonRange) * W;
    // North-up: invert y so high-lat (North) is at top.
    const py = H - ((m.lat - minLat) / latRange) * H;
    if (px < 0 || px > W || py < 0 || py > H) continue;

    const color = MARKER_COLOR[m.type] ?? "#e2e8f0";
    const icon = peekMarkerIconImage(m.type, color, MARKER_ICON_SRC_PX);

    if (icon) {
      // Custom SVG symbol on a dark backing disc for contrast.
      ctx.beginPath();
      ctx.arc(px, py, MARKER_ICON_DRAW_PX / 2 + 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(2,8,24,0.8)";
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.drawImage(
        icon,
        px - MARKER_ICON_DRAW_PX / 2,
        py - MARKER_ICON_DRAW_PX / 2,
        MARKER_ICON_DRAW_PX,
        MARKER_ICON_DRAW_PX,
      );
    } else {
      // Fallback dot until the icon image finishes loading.
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
      ctx.fill();
      ctx.shadowBlur = 0;
      if (onIconReady) {
        void loadMarkerIconImage(m.type, color, MARKER_ICON_SRC_PX).then((img) => {
          if (img) onIconReady();
        });
      }
    }
  }
}

const tileImageCache = new Map<string, HTMLImageElement>();

export const Minimap: React.FC = () => {
  const { terrain } = useAppState();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Coalesces marker-icon load completions into a single static-layer rebuild.
  const iconRebuildScheduledRef = useRef(false);
  // Stored as an offscreen canvas so we can drawImage with globalAlpha for
  // satellite compositing (putImageData ignores globalAlpha).
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Static layer: bg + satellite + heatmap + marker dots. Rebuilt only when
  // data changes so the camera-tick path only composites this + the arrow.
  const staticLayerRef = useRef<HTMLCanvasElement | null>(null);
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
    () =>
      colormapCssGradient(
        colormapTheme,
        "to bottom",
        16,
        // Crop to the dataset's slice of the absolute depth scale so the strip
        // matches the heatmap colours (ocean/custom themes).
        terrain
          ? getColormapTRange(colormapTheme, terrain.minDepth, terrain.maxDepth)
          : undefined,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paletteVersion fingerprint covers all palette state; colormapCssGradient is a pure function
    [colormapTheme, shallow, deep, bandColors, customStops, bandBoundaries, terrain],
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
    const cached = tileImageCache.get(tileUrl);
    if (cached) {
      satelliteImgRef.current = cached;
      // Redraw immediately with the cached image.
      const canvas = canvasRef.current;
      if (canvas && terrain) {
        const ctx = canvas.getContext("2d");
        if (ctx && heatmapCanvasRef.current) {
          rebuildStaticLayer(terrain);
          const camState = useCameraStore.getState();
          const cpos0 = camState.cameraPosition;
          compositeFrame(ctx, cpos0.known ? cpos0.lon : null, cpos0.known ? cpos0.lat : null, camState.heading, terrain);
        }
      }
      return;
    }
    const img = new Image();
    img.onload = () => {
      tileImageCache.set(tileUrl, img);
      satelliteImgRef.current = img;
      // Redraw immediately so satellite background appears on load.
      const canvas = canvasRef.current;
      if (!canvas || !terrain) return;
      const ctx = canvas.getContext("2d");
      if (!ctx || !heatmapCanvasRef.current) return;
      rebuildStaticLayer(terrain);
      const camState = useCameraStore.getState();
      const cposLoad = camState.cameraPosition;
      compositeFrame(ctx, cposLoad.known ? cposLoad.lon : null, cposLoad.known ? cposLoad.lat : null, camState.heading, terrain);
    };
    img.onerror = () => {
      satelliteImgRef.current = null;
    };
    img.src = tileUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildStaticLayer and compositeFrame are render-scope helpers; including them would re-run the effect every render
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

  // Rebuild the static layer (bg + satellite + heatmap + marker dots) onto an
  // offscreen canvas. Called whenever data changes. The camera-tick path just
  // drawImage's this + the arrow, avoiding a full repaint every camera frame.
  const rebuildStaticLayer = (currentTerrain: typeof terrain) => {
    if (!currentTerrain) return;

    // Allocate or reuse the offscreen static canvas.
    if (!staticLayerRef.current) {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      staticLayerRef.current = c;
    }
    const sc = staticLayerRef.current;
    const sCtx = sc.getContext("2d");
    if (!sCtx) return;

    // 1. Dark background
    sCtx.fillStyle = "#020818";
    sCtx.fillRect(0, 0, W, H);

    // 2. Satellite imagery background
    if (satelliteImgRef.current) {
      sCtx.drawImage(satelliteImgRef.current, 0, 0, W, H);
    }

    // 3. Depth heatmap — semi-transparent so satellite shows through
    if (heatmapCanvasRef.current) {
      sCtx.globalAlpha = satelliteImgRef.current ? 0.65 : 1.0;
      sCtx.drawImage(heatmapCanvasRef.current, 0, 0);
      sCtx.globalAlpha = 1.0;
    }

    // 4. Marker symbols (fallback dots until icon rasters finish loading —
    //    onIconReady schedules exactly one rebuild+repaint once they do)
    drawMarkerDots(
      sCtx,
      markersRef.current,
      currentTerrain.minLon,
      currentTerrain.maxLon,
      currentTerrain.minLat,
      currentTerrain.maxLat,
      handleMarkerIconReady,
    );
  };

  // Coalesce many icon-load completions into a single static-layer rebuild.
  const handleMarkerIconReady = () => {
    if (iconRebuildScheduledRef.current) return;
    iconRebuildScheduledRef.current = true;
    setTimeout(() => {
      iconRebuildScheduledRef.current = false;
      const currentTerrain = terrain;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!currentTerrain || !ctx) return;
      rebuildStaticLayer(currentTerrain);
      const camState = useCameraStore.getState();
      const cpos = camState.cameraPosition;
      compositeFrame(ctx, cpos.known ? cpos.lon : null, cpos.known ? cpos.lat : null, camState.heading, currentTerrain);
    }, 50);
  };

  // Composite the minimap onto the visible canvas: static layer + camera arrow.
  // The heavy drawing (heatmap, satellite, markers) lives in rebuildStaticLayer
  // so this function only touches the arrow on each camera tick.
  const compositeFrame = (
    ctx: CanvasRenderingContext2D,
    camLon: number | null,
    camLat: number | null,
    heading: number,
    currentTerrain: typeof terrain,
  ) => {
    if (!currentTerrain) return;

    // 1. Paint the pre-built static layer (bg + satellite + heatmap + markers)
    if (staticLayerRef.current) {
      ctx.drawImage(staticLayerRef.current, 0, 0);
    } else {
      // Fallback: bare background until the static layer is built
      ctx.fillStyle = "#020818";
      ctx.fillRect(0, 0, W, H);
    }

    // 2. Camera arrow — the only element that changes on every camera tick
    if (camLon !== null && camLat !== null) {
      const px = ((camLon - currentTerrain.minLon) / (currentTerrain.maxLon - currentTerrain.minLon)) * W;
      // North-up: invert y so high-lat (North) is at top.
      const py = H - ((camLat - currentTerrain.minLat) / (currentTerrain.maxLat - currentTerrain.minLat)) * H;
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
      terrain.topography,
    );
    heatmapCanvasRef.current = offscreen;

    rebuildStaticLayer(terrain);
    const camState = useCameraStore.getState();
    const cp0 = camState.cameraPosition;
    compositeFrame(ctx, cp0.known ? cp0.lon : null, cp0.known ? cp0.lat : null, camState.heading, terrain);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildStaticLayer and compositeFrame are render-scope helpers that change every render; data deps are listed explicitly
  }, [terrain, colormapTheme, shallow, deep, bandColors, customStops, bandBoundaries]);

  // Re-composite when satellite image loads (tileUrl changed)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain || !heatmapCanvasRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    rebuildStaticLayer(terrain);
    const camState = useCameraStore.getState();
    const cp1 = camState.cameraPosition;
    compositeFrame(ctx, cp1.known ? cp1.lon : null, cp1.known ? cp1.lat : null, camState.heading, terrain);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildStaticLayer and compositeFrame are render-scope helpers; terrain is captured from outer scope (current at call time)
  }, [tileUrl]);

  // Subscribe to cameraStore and update arrow only — static layer is pre-built.
  useEffect(() => {
    const unsub = useCameraStore.subscribe((state) => {
      const canvas = canvasRef.current;
      if (!canvas || !terrain) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const cp2 = state.cameraPosition;
      compositeFrame(ctx, cp2.known ? cp2.lon : null, cp2.known ? cp2.lat : null, state.heading, terrain);
    });

    return () => { unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- compositeFrame is a render-scope helper; re-subscribing only on terrain change is intentional
  }, [terrain]);

  // Rebuild static layer whenever markers change (new dots without camera move)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    rebuildStaticLayer(terrain);
    const camState = useCameraStore.getState();
    const cp3 = camState.cameraPosition;
    compositeFrame(ctx, cp3.known ? cp3.lon : null, cp3.known ? cp3.lat : null, camState.heading, terrain);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuildStaticLayer and compositeFrame are render-scope helpers; data deps (markers, terrain) are listed explicitly
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
            fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            color: "rgba(0,229,255,0.4)",
            letterSpacing: "0.1em",
            pointerEvents: "none",
          }}
        >
          MINIMAP
        </div>
        {/* North indicator — top-center so N is unambiguously at the top edge */}
        <div
          data-testid="minimap-north"
          style={{
            position: "absolute",
            top: 3,
            left: "50%",
            transform: "translateX(-50%)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            fontWeight: 700,
            color: "rgba(0,229,255,0.6)",
            pointerEvents: "none",
          }}
        >
          N
        </div>
        {/* South indicator — bottom-center */}
        <div
          data-testid="minimap-south"
          style={{
            position: "absolute",
            bottom: 3,
            left: "50%",
            transform: "translateX(-50%)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            fontWeight: 700,
            color: "rgba(0,229,255,0.35)",
            pointerEvents: "none",
          }}
        >
          S
        </div>
        {/* East indicator */}
        <div
          data-testid="minimap-east"
          style={{
            position: "absolute",
            top: "50%",
            right: 5,
            transform: "translateY(-50%)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            fontWeight: 700,
            color: "rgba(0,229,255,0.45)",
            pointerEvents: "none",
          }}
        >
          E
        </div>
        {/* West indicator */}
        <div
          data-testid="minimap-west"
          style={{
            position: "absolute",
            top: "50%",
            left: 5,
            transform: "translateY(-50%)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            fontWeight: 700,
            color: "rgba(0,229,255,0.45)",
            pointerEvents: "none",
          }}
        >
          W
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
              fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
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
