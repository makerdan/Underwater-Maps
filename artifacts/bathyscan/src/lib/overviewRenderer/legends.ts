/**
 * overviewRenderer/legends.ts — interactive EFH + substrate species legends
 * and the depth-to-colour colormap legend strip.
 */
import type { EfhFeature, SubstrateFeature } from "@workspace/api-client-react";
import type { UnitsSystem, ColormapTheme } from "../settingsStore";
import { getColormap } from "../colormap";
import { hexToRgba } from "./internal";

/**
 * Shared geometry for the Overview Map's top-right compass and zoom stack.
 * The canvas legend uses the zoom stack's bottom edge plus its own gap so the
 * two layers cannot overlap when their positions change together.
 */
export const OVERVIEW_CONTROL_LAYOUT = {
  controlsTopOffset: 36,
  compassTopOffset: 14,
  zoomTopOffset: 56,
  zoomButtonSize: 32,
  zoomButtonGap: 4,
  zoomButtonCount: 3,
  legendGap: 8,
} as const;

export const OVERVIEW_LEGEND_TOP =
  OVERVIEW_CONTROL_LAYOUT.zoomTopOffset +
  OVERVIEW_CONTROL_LAYOUT.controlsTopOffset +
  OVERVIEW_CONTROL_LAYOUT.zoomButtonCount * OVERVIEW_CONTROL_LAYOUT.zoomButtonSize +
  (OVERVIEW_CONTROL_LAYOUT.zoomButtonCount - 1) * OVERVIEW_CONTROL_LAYOUT.zoomButtonGap +
  OVERVIEW_CONTROL_LAYOUT.legendGap;

// ---------------------------------------------------------------------------
// EFH legend (interactive, per-species toggle)
// ---------------------------------------------------------------------------

/**
 * One row of the EFH species legend used for click hit-testing.
 */
export interface EfhLegendRow {
  /** `commonName` as stored in feature.properties — used as the toggle key. */
  key: string;
  /** Display label. */
  label: string;
  /** Species hex color. */
  color: string;
  /** Click hit-rect in canvas pixels: [x, y, w, h]. */
  rect: [number, number, number, number];
}

export interface EfhLegendLayout {
  box: [number, number, number, number];
  rows: EfhLegendRow[];
}

/**
 * Draw a compact per-species toggle legend in the bottom-right corner of the
 * canvas. Unique species are derived from the features array; each row can be
 * toggled on/off via `hiddenSpecies`. Hidden rows are dimmed and struck-through.
 *
 * Returns the layout so callers can hit-test clicks and call
 * `uiStore.toggleEfhSpecies(key)`.
 */
export function renderEfhLegend(
  ctx: CanvasRenderingContext2D,
  features: EfhFeature[],
  cW: number,
  cH: number,
  hiddenSpecies: ReadonlySet<string> = new Set(),
): EfhLegendLayout | null {
  if (!features.length) return null;

  // Collect unique (commonName, color) pairs in first-seen order.
  const seen = new Map<string, string>();
  for (const f of features) {
    const name = f.properties.commonName ?? f.properties.species ?? "";
    if (name && !seen.has(name)) seen.set(name, f.properties.color ?? "#00e5ff");
  }
  const entries = Array.from(seen.entries());
  if (!entries.length) return null;

  const FONT = "'JetBrains Mono', monospace";
  const SWATCH = 9;
  const ROW_H = 14;
  const PAD = 8;
  const FONT_SIZE = 9;
  const HEADER_H = 14;

  ctx.save();
  ctx.font = `${FONT_SIZE}px ${FONT}`;

  const labels = entries.map(([name]) => name);
  const maxW = labels.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const headerW = ctx.measureText("EFH SPECIES").width;
  const boxW = PAD * 2 + SWATCH + 6 + Math.max(maxW, headerW);
  const boxH = PAD * 2 + HEADER_H + entries.length * ROW_H;
  const x = cW - boxW - 8;
  const y = cH - boxH - 30;

  ctx.fillStyle = "rgba(2,8,24,0.85)";
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(34,197,94,0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#94a3b8";
  ctx.fillText("EFH SPECIES", x + PAD, y + PAD + FONT_SIZE);

  const rows: EfhLegendRow[] = entries.map(([name, color], i) => {
    const rowY = y + PAD + HEADER_H + i * ROW_H;
    const hidden = hiddenSpecies.has(name);
    const alpha = hidden ? 0.32 : 1.0;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x + PAD, rowY + 1, SWATCH, SWATCH);
    ctx.strokeStyle = hexToRgba(color, 0.95);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + PAD + 0.5, rowY + 1.5, SWATCH, SWATCH);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(name, x + PAD + SWATCH + 6, rowY + FONT_SIZE);

    if (hidden) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const lineY = rowY + 1 + SWATCH / 2 + 0.5;
      ctx.moveTo(x + PAD, lineY);
      ctx.lineTo(x + boxW - PAD, lineY);
      ctx.stroke();
    }

    ctx.globalAlpha = 1.0;

    return {
      key: name,
      label: name,
      color,
      rect: [x + 2, rowY, boxW - 4, ROW_H],
    };
  });

  ctx.restore();

  return { box: [x, y, boxW, boxH], rows };
}

/**
 * Hit-test a canvas-pixel click against an EFH legend layout. Returns the
 * commonName key whose row was clicked, or null if outside any row.
 */
export function hitTestEfhLegend(
  cx: number,
  cy: number,
  layout: EfhLegendLayout | null,
): string | null {
  if (!layout) return null;
  for (const r of layout.rows) {
    const [x, y, w, h] = r.rect;
    if (cx >= x && cx <= x + w && cy >= y && cy <= y + h) return r.key;
  }
  return null;
}

/**
 * One row of the substrate legend, with the canvas-pixel bounding box used
 * for click hit-testing the row to toggle visibility.
 */
export interface SubstrateLegendRow {
  /** Lower-cased substrate key, matches `feature.properties.substrate`. */
  key: string;
  /** Display label (upper-cased substrate name). */
  label: string;
  /** CMECS swatch color (hex). */
  color: string;
  /** Click hit-rect in canvas pixels: [x, y, w, h]. */
  rect: [number, number, number, number];
}

export interface SubstrateLegendLayout {
  /** Box bounds: [x, y, w, h]. */
  box: [number, number, number, number];
  rows: SubstrateLegendRow[];
}

/**
 * Draw a compact substrate legend (CMECS classes present in the current
 * feature set) in the bottom-left corner. The 3D scene's substrate legend
 * lives in the Overlays & Tools side panel; this is the 2D equivalent.
 *
 * Rows whose substrate key is in `hiddenClasses` are rendered dimmed to
 * signal they're filtered out. Returns the layout so callers can hit-test
 * legend clicks against `rows[i].rect` and toggle the class.
 */
export function renderSubstrateLegend(
  ctx: CanvasRenderingContext2D,
  features: SubstrateFeature[],
  cH: number,
  hiddenClasses: ReadonlySet<string> = new Set(),
): SubstrateLegendLayout | null {
  if (!features.length) return null;

  // Collect unique (substrate, color) pairs, preserving first-seen order.
  const seen = new Map<string, string>();
  for (const f of features) {
    const key = f.properties.substrate;
    if (!seen.has(key)) seen.set(key, f.properties.color ?? "#e2d5a0");
  }
  const entries = Array.from(seen.entries());
  if (!entries.length) return null;

  const FONT = "'JetBrains Mono', monospace";
  const SWATCH = 9;
  const ROW_H = 14;
  const PAD = 8;
  const FONT_SIZE = 9;
  const HEADER_H = 14;

  ctx.save();
  ctx.font = `${FONT_SIZE}px ${FONT}`;
  const labels = entries.map(([s]) => s.toUpperCase());
  const maxW = labels.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const headerW = ctx.measureText("SUBSTRATE").width;
  const boxW = PAD * 2 + SWATCH + 6 + Math.max(maxW, headerW);
  const boxH = PAD * 2 + HEADER_H + entries.length * ROW_H;
  const x = 12;
  const y = cH - boxH - 40;

  ctx.fillStyle = "rgba(2,8,24,0.85)";
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,229,255,0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#94a3b8";
  ctx.fillText("SUBSTRATE", x + PAD, y + PAD + FONT_SIZE);

  const rows: SubstrateLegendRow[] = entries.map(([label, color], i) => {
    const rowY = y + PAD + HEADER_H + i * ROW_H;
    const key = label.toLowerCase();
    const hidden = hiddenClasses.has(key);
    const alpha = hidden ? 0.32 : 1.0;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x + PAD, rowY + 1, SWATCH, SWATCH);
    ctx.strokeStyle = hexToRgba(color, 0.95);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + PAD + 0.5, rowY + 1.5, SWATCH, SWATCH);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(labels[i] ?? label.toUpperCase(), x + PAD + SWATCH + 6, rowY + FONT_SIZE);

    // Strike-through hidden rows so the dimming reads as "filtered out".
    if (hidden) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const lineY = rowY + 1 + SWATCH / 2 + 0.5;
      ctx.moveTo(x + PAD, lineY);
      ctx.lineTo(x + boxW - PAD, lineY);
      ctx.stroke();
    }

    ctx.globalAlpha = 1.0;

    return {
      key,
      label: labels[i] ?? label.toUpperCase(),
      color,
      rect: [x + 2, rowY, boxW - 4, ROW_H],
    };
  });

  ctx.restore();

  return { box: [x, y, boxW, boxH], rows };
}

/**
 * Hit-test a canvas-pixel click against a substrate legend layout. Returns
 * the substrate key (lower-cased) whose row was clicked, or null if the
 * click was outside any row. Used by OverviewMap to toggle legend filters.
 */
export function hitTestSubstrateLegend(
  cx: number,
  cy: number,
  layout: SubstrateLegendLayout | null,
): string | null {
  if (!layout) return null;
  for (const r of layout.rows) {
    const [x, y, w, h] = r.rect;
    if (cx >= x && cx <= x + w && cy >= y && cy <= y + h) return r.key;
  }
  return null;
}

/**
 * Render a depth-to-colour legend strip below the Overview Map's top-right
 * compass and zoom controls. The strip runs from shallow (top, t=0) to deep
 * (bottom, t=1) using the active colormap theme, with depth labels at the
 * top, middle, and bottom tick marks. Matches the 3D HUD DepthScaleBar so both
 * views communicate the same colour scale.
 *
 * @param theme    Active colormap theme (read from settingsStore each frame).
 * @param minDepth Shallowest depth value in the grid (metres).
 * @param maxDepth Deepest depth value in the grid (metres).
 * @param canvasW  Canvas width in pixels.
 * @param canvasH  Canvas height in pixels.
 * @param units    Unit system for depth labels.
 */
export function renderColormapLegend(
  ctx: CanvasRenderingContext2D,
  theme: ColormapTheme,
  minDepth: number,
  maxDepth: number,
  canvasW: number,
  canvasH: number,
  units: UnitsSystem = "metric",
): void {
  const STRIP_W = 10;
  const STRIP_H = 120;
  const MARGIN_RIGHT = 16;
  const x = canvasW - MARGIN_RIGHT - STRIP_W;
  const y = OVERVIEW_LEGEND_TOP;
  const LABEL_X = x - 4;

  const toColor = getColormap(theme);
  ctx.save();

  // Draw the gradient strip row by row (top = shallow, bottom = deep).
  // Convert THREE.Color (linear-sRGB) to display-space sRGB bytes so the strip
  // matches the colour the renderer paints on screen.
  // t runs 0→1 across the strip; getColormap(theme) (no range arg) maps t
  // through the absolute band positions so all palette bands are visible.
  for (let py = 0; py < STRIP_H; py++) {
    const t = py / (STRIP_H - 1);
    const c = toColor(t).clone().convertLinearToSRGB();
    const r = Math.max(0, Math.min(255, Math.round(c.r * 255)));
    const g = Math.max(0, Math.min(255, Math.round(c.g * 255)));
    const b = Math.max(0, Math.min(255, Math.round(c.b * 255)));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y + py, STRIP_W, 1);
  }

  // Thin border around the strip
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 0.5, y + 0.5, STRIP_W - 1, STRIP_H - 1);

  // Tick marks at top, middle, and bottom, extending left from the strip
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1;
  for (const frac of [0, 0.5, 1]) {
    const ty = y + Math.round(frac * (STRIP_H - 1));
    ctx.beginPath();
    ctx.moveTo(x - 3, ty);
    ctx.lineTo(x, ty);
    ctx.stroke();
  }

  // Depth labels (metres or feet) right-aligned next to the tick marks
  ctx.font = "8px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.textAlign = "right";

  const depthToLabel = (metres: number): string => {
    const d = Math.abs(Math.round(metres));
    if (units !== "metric") {
      return `${Math.round(d * 3.28084)}ft`;
    }
    return `${d}m`;
  };

  ctx.textBaseline = "top";
  ctx.fillText(depthToLabel(minDepth), LABEL_X, y);

  ctx.textBaseline = "middle";
  ctx.fillText(depthToLabel((minDepth + maxDepth) / 2), LABEL_X, y + STRIP_H / 2);

  ctx.textBaseline = "bottom";
  ctx.fillText(depthToLabel(maxDepth), LABEL_X, y + STRIP_H);

  ctx.restore();
}
