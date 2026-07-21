import React, { useEffect, useRef } from "react";
import {
  usePaletteStore,
  PALETTE_PRESETS,
  MID1_HEX,
  MID2_HEX,
  bandColorsFromPreset,
  DEFAULT_BAND_COLORS,
  DEFAULT_BAND_BOUNDARIES,
  MIN_BOUNDARY_GAP_FT,
  MIN_BANDS,
  MAX_BANDS,
  MAX_BOUNDARY_FT,
} from "@/lib/paletteStore";
import { colormapCanvas } from "@/lib/colormap";
import { formatDepth } from "@/lib/units";
import { useSettingsStore } from "@/lib/settingsStore";
import { flushServerSync } from "@/hooks/useServerSettingsSync";
import { S } from "../styles";
import { SliderRow, ToggleRow, ColorRow, ColormapSelectRow } from "./RowWidgets";
import { defaultContourInterval } from "../constants";

const FT_TO_M_SETTINGS = 0.3048;

const BAND_PRESET_SWATCHES = [
  { hex: "#00bcd4", label: "Turquoise" },
  { hex: "#1565c0", label: "Ocean Blue" },
  { hex: "#1a237e", label: "Navy" },
  { hex: "#4a148c", label: "Deep Violet" },
  { hex: "#000000", label: "Black" },
];

const HEX_RE_SETTINGS = /^#[0-9a-fA-F]{6}$/;

function DebouncedHexInput({
  value, onCommit, style, testId,
}: {
  value: string;
  onCommit: (hex: string) => void;
  style?: React.CSSProperties;
  testId?: string;
}) {
  const [local, setLocal] = React.useState(value);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => { setLocal(value); }, [value]);
  React.useEffect(
    () => () => { if (timerRef.current) clearTimeout(timerRef.current); },
    [],
  );
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocal(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (HEX_RE_SETTINGS.test(v)) {
      timerRef.current = setTimeout(() => onCommit(v), 300);
    }
  };
  return (
    <input
      type="text"
      value={local}
      onChange={handleChange}
      style={style}
      data-testid={testId}
      aria-label="Hex colour value"
      maxLength={7}
    />
  );
}

function ContourIntervalRow() {
  const units = useSettingsStore((s) => s.units);
  const contourInterval = useSettingsStore((s) => s.contourInterval);
  const setContourInterval = useSettingsStore((s) => s.setContourInterval);
  const isMetric = units === "metric";
  const isNautical = units === "nautical";
  const sliderMin  = isMetric ? 0.5 : isNautical ? 0.5 : 1;
  const sliderMax  = isMetric ? 50  : isNautical ? 50  : 200;
  const sliderStep = isMetric ? 0.5 : isNautical ? 0.5 : 1;
  const formatInterval = (v: number) => {
    const n = v % 1 === 0 ? v.toFixed(0) : v.toFixed(1);
    return isMetric ? `${n} m` : isNautical ? `${n} fm` : `${n} ft`;
  };
  const unitLabel = isMetric ? "metres" : isNautical ? "fathoms" : "feet";
  const prevUnitsRef = useRef(units);
  useEffect(() => {
    const prev = prevUnitsRef.current;
    prevUnitsRef.current = units;
    if (prev === units) return;
    setContourInterval(defaultContourInterval(units));
  }, [units, setContourInterval]);
  return (
    <SliderRow
      label="Contour Interval"
      value={Math.min(sliderMax, Math.max(sliderMin, contourInterval))}
      min={sliderMin}
      max={sliderMax}
      step={sliderStep}
      format={formatInterval}
      onChange={setContourInterval}
      sublabel={`Depth spacing between lines (${unitLabel})`}
    />
  );
}

/**
 * Variable-length depth band editor: one row per band with a colour picker,
 * quick swatches, and an editable upper boundary (slider + typed input).
 * Bands can be added (splits the widest band) and removed (min 2), and the
 * last boundary is fully editable — the scale is not capped at 2000 ft.
 */
function DepthBandEditor({
  labelStyle,
  hexStyle,
  colorInputStyle,
}: {
  labelStyle: React.CSSProperties;
  hexStyle: React.CSSProperties;
  colorInputStyle: React.CSSProperties;
}) {
  const bandColors = usePaletteStore((s) => s.bandColors);
  const setBandColor = usePaletteStore((s) => s.setBandColor);
  const resetBandColors = usePaletteStore((s) => s.resetBandColors);
  const bandBoundaries = usePaletteStore((s) => s.bandBoundaries);
  const setBandBoundary = usePaletteStore((s) => s.setBandBoundary);
  const resetBandBoundaries = usePaletteStore((s) => s.resetBandBoundaries);
  const addBand = usePaletteStore((s) => s.addBand);
  const removeBand = usePaletteStore((s) => s.removeBand);
  const blendBands = usePaletteStore((s) => s.blendBands);
  const setBlendBands = usePaletteStore((s) => s.setBlendBands);
  const units = useSettingsStore((s) => s.units);

  const allColorsDefault =
    bandColors.length === DEFAULT_BAND_COLORS.length &&
    bandColors.every((c, i) => c.toLowerCase() === DEFAULT_BAND_COLORS[i]!.toLowerCase());
  const allBoundariesDefault =
    bandBoundaries.length === DEFAULT_BAND_BOUNDARIES.length &&
    bandBoundaries.every((b, i) => b === DEFAULT_BAND_BOUNDARIES[i]);

  const isMetric = units === "metric";
  const ftToDisplay = (ft: number) =>
    isMetric ? +(ft * FT_TO_M_SETTINGS).toFixed(1) : ft;
  const displayToFt = (v: number) =>
    Math.round(isMetric ? v / FT_TO_M_SETTINGS : v);
  const inputUnit = isMetric ? "m" : "ft";

  const smallBtn = (disabled: boolean): React.CSSProperties => ({
    background: "none",
    border: "1px solid rgba(0,229,255,0.2)",
    borderRadius: 3,
    color: disabled ? "#64748b" : "#67e8f9",
    fontSize: "calc(8px * var(--bs-font-scale, 1))",
    letterSpacing: "0.12em",
    padding: "2px 8px",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
  });

  const canAdd = bandColors.length < MAX_BANDS;
  const canRemove = bandColors.length > MIN_BANDS;

  return (
    <div data-testid="depth-band-color-editor" style={{ padding: "8px 16px 4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6, flexWrap: "wrap" }}>
        <div style={{ ...labelStyle, fontSize: "calc(9px * var(--bs-font-scale, 1))", letterSpacing: "0.15em" }}>
          DEPTH BANDS ({bandColors.length})
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            data-testid="band-add-btn"
            onClick={() => { addBand(); void flushServerSync(); }}
            disabled={!canAdd}
            style={smallBtn(!canAdd)}
          >
            + ADD BAND
          </button>
          <button
            type="button"
            data-testid="band-colors-reset-btn"
            onClick={() => { resetBandColors(); void flushServerSync(); }}
            disabled={allColorsDefault}
            style={smallBtn(allColorsDefault)}
          >
            RESET COLOURS
          </button>
          <button
            type="button"
            data-testid="band-boundaries-reset-btn"
            onClick={() => { resetBandBoundaries(); void flushServerSync(); }}
            disabled={allBoundariesDefault}
            style={smallBtn(allBoundariesDefault)}
          >
            RESET BOUNDARIES
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {bandColors.map((color, i) => {
          const loFt = bandBoundaries[i] ?? 0;
          const hiFt = bandBoundaries[i + 1] ?? loFt + MIN_BOUNDARY_GAP_FT;
          const loM = loFt * FT_TO_M_SETTINGS;
          const hiM = hiFt * FT_TO_M_SETTINGS;
          const bandLabel = `${formatDepth(loM, { units })} – ${formatDepth(hiM, { units })}`;

          // Each band row edits its UPPER boundary (index i+1). Interior
          // boundaries clamp between neighbours; the last boundary is free
          // up to MAX_BOUNDARY_FT.
          const bIdx = i + 1;
          const isLast = bIdx === bandBoundaries.length - 1;
          const prevFt = bandBoundaries[bIdx - 1] ?? 0;
          const minFt = prevFt + MIN_BOUNDARY_GAP_FT;
          const maxFt = isLast
            ? MAX_BOUNDARY_FT
            : (bandBoundaries[bIdx + 1] ?? MAX_BOUNDARY_FT) - MIN_BOUNDARY_GAP_FT;
          // Keep the slider usable when the boundary can range to 36000 ft:
          // cap the slider at a sensible span; the typed input allows the
          // full range.
          const sliderMaxFt = isLast
            ? Math.max(2000, Math.min(MAX_BOUNDARY_FT, hiFt * 2))
            : maxFt;
          const stepDisplay = isMetric ? 0.5 : 1;
          const displayVal = ftToDisplay(hiFt);
          const changed = DEFAULT_BAND_BOUNDARIES[bIdx] !== undefined
            ? hiFt !== DEFAULT_BAND_BOUNDARIES[bIdx]
            : true;

          return (
            <div
              key={i}
              data-testid={`band-color-row-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(88px, 110px) auto auto 1fr auto",
                alignItems: "center",
                gap: 8,
                padding: "5px 0",
                borderBottom: "1px solid rgba(0,229,255,0.05)",
              }}
            >
              <span style={{ ...labelStyle, fontSize: "calc(9px * var(--bs-font-scale, 1))", letterSpacing: "0.05em", color: "#cbd5e1", whiteSpace: "nowrap" }}>
                {bandLabel}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="color"
                  data-testid={`band-color-picker-${i}`}
                  value={color}
                  onChange={(e) => setBandColor(i, e.target.value)}
                  style={colorInputStyle}
                  aria-label={`Band ${i} colour: ${bandLabel}`}
                />
                <DebouncedHexInput
                  value={color}
                  onCommit={(hex) => { setBandColor(i, hex); void flushServerSync(); }}
                  style={{ ...hexStyle, width: 64 }}
                  testId={`band-color-hex-${i}`}
                />
              </div>
              <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                {BAND_PRESET_SWATCHES.map((sw) => (
                  <button
                    key={sw.hex}
                    type="button"
                    title={sw.label}
                    aria-label={`Set ${bandLabel} to ${sw.label}`}
                    onClick={() => { setBandColor(i, sw.hex); void flushServerSync(); }}
                    style={{
                      width: 14,
                      height: 14,
                      background: sw.hex,
                      border: color.toLowerCase() === sw.hex.toLowerCase()
                        ? "2px solid #00e5ff"
                        : "1px solid rgba(255,255,255,0.25)",
                      borderRadius: 2,
                      cursor: "pointer",
                      padding: 0,
                      flexShrink: 0,
                    }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="range"
                  data-testid={`band-boundary-slider-${bIdx}`}
                  min={ftToDisplay(minFt)}
                  max={ftToDisplay(sliderMaxFt)}
                  step={stepDisplay}
                  value={displayVal}
                  onChange={(e) => setBandBoundary(bIdx, displayToFt(Number(e.target.value)))}
                  style={{ ...S.slider, width: "100%", minWidth: 60 }}
                  aria-label={`Band ${i} upper boundary depth`}
                />
                <input
                  type="number"
                  data-testid={`band-boundary-input-${bIdx}`}
                  min={ftToDisplay(minFt)}
                  max={ftToDisplay(maxFt)}
                  step={stepDisplay}
                  value={displayVal}
                  onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setBandBoundary(bIdx, displayToFt(v)); }}
                  style={{ ...hexStyle, width: 58, textAlign: "right", color: changed ? "#00e5ff" : "#cbd5e1" }}
                  aria-label={`Band ${i} upper boundary value in ${inputUnit}`}
                />
                <span style={{ ...labelStyle, fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#475569", minWidth: 14 }}>{inputUnit}</span>
              </div>
              <button
                type="button"
                data-testid={`band-remove-btn-${i}`}
                title={canRemove ? "Remove this band" : `Minimum ${MIN_BANDS} bands`}
                aria-label={`Remove band ${bandLabel}`}
                onClick={() => { removeBand(i); void flushServerSync(); }}
                disabled={!canRemove}
                style={{
                  ...smallBtn(!canRemove),
                  padding: "2px 6px",
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div data-testid="blend-bands-toggle" style={{ marginTop: 10, borderTop: "1px solid rgba(0,229,255,0.08)" }}>
        <ToggleRow
          label="Blend band colors"
          value={blendBands}
          onChange={(v) => { setBlendBands(v); }}
          sublabel="On: smooth gradient between bands. Off: crisp discrete colour steps."
        />
      </div>
    </div>
  );
}

/**
 * Merged "Depth Colors" card: colormap theme, land/no-data colour, contour
 * lines, palette presets, live preview, and the variable-length depth band
 * editor (shown for the Ocean and Custom themes).
 */
export function DepthColorsCard() {
  const shallow = usePaletteStore((s) => s.shallow);
  const deep = usePaletteStore((s) => s.deep);
  const reset = usePaletteStore((s) => s.reset);
  const setBandColors = usePaletteStore((s) => s.setBandColors);
  const bandCount = usePaletteStore((s) => s.bandColors.length);
  const blendBands = usePaletteStore((s) => s.blendBands);

  const colormapTheme = useSettingsStore((s) => s.colormapTheme);
  const setColormapThemeByUser = useSettingsStore((s) => s.setColormapThemeByUser);
  const brightDaylight = useSettingsStore((s) => s.brightDaylight);
  const colormapUserSet = useSettingsStore((s) => s.colormapUserSet);
  const nodataColor = useSettingsStore((s) => s.nodataColor);
  const setNodataColor = useSettingsStore((s) => s.setNodataColor);
  const contoursEnabled = useSettingsStore((s) => s.contoursEnabled);
  const setContoursEnabled = useSettingsStore((s) => s.setContoursEnabled);

  const isBandTheme = colormapTheme === "ocean" || colormapTheme === "custom";

  const bandColorsKey = usePaletteStore((s) => s.bandColors.join(","));
  const bandBoundariesKey = usePaletteStore((s) => s.bandBoundaries.join(","));

  const previewRef = React.useRef<HTMLImageElement>(null);
  React.useEffect(() => {
    if (!previewRef.current) return;
    const vert = colormapCanvas(14, 240, colormapTheme);
    const horiz = document.createElement("canvas");
    horiz.width = 240;
    horiz.height = 14;
    const hctx = horiz.getContext("2d")!;
    hctx.save();
    hctx.translate(0, 14);
    hctx.rotate(-Math.PI / 2);
    hctx.drawImage(vert, 0, 0, 14, 240);
    hctx.restore();
    previewRef.current.src = horiz.toDataURL();
  }, [shallow, deep, colormapTheme, bandColorsKey, bandBoundariesKey, blendBands]);

  const activePresetId = PALETTE_PRESETS.find(
    (p) =>
      p.shallow.toLowerCase() === shallow.toLowerCase() &&
      p.deep.toLowerCase() === deep.toLowerCase(),
  )?.id;

  const labelStyle: React.CSSProperties = {
    fontSize: "calc(9px * var(--bs-font-scale, 1))",
    letterSpacing: "0.15em",
    color: "#94a3b8",
  };
  const colorInputStyle: React.CSSProperties = {
    width: 36,
    height: 24,
    border: "1px solid rgba(0,229,255,0.2)",
    borderRadius: 3,
    background: "transparent",
    cursor: "pointer",
    padding: 0,
  };
  const hexStyle: React.CSSProperties = {
    fontFamily: "inherit",
    fontSize: "calc(10px * var(--bs-font-scale, 1))",
    color: "#cbd5e1",
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(0,229,255,0.12)",
    borderRadius: 3,
    padding: "3px 6px",
    width: 80,
    textAlign: "center",
  };

  return (
    <div style={S.card} data-testid="depth-colors-card">
      <div style={S.cardHeader}>◈ DEPTH COLORS</div>

      <ColormapSelectRow
        label="Depth Colormap"
        value={colormapTheme}
        onChange={setColormapThemeByUser}
        options={[
          { value: "ocean", label: "Ocean (blue)" },
          { value: "freshwater", label: "Freshwater (green)" },
          { value: "thermal", label: "Thermal (purple→white)" },
          { value: "grayscale", label: "Grayscale" },
          { value: "viridis", label: "Viridis (purple→yellow)" },
          { value: "custom", label: "Custom (edit bands)" },
        ]}
        sublabel="Terrain surface colour gradient"
      />
      {brightDaylight && !colormapUserSet && (
        <div
          data-testid="bright-daylight-grayscale-note"
          style={{
            padding: "6px 12px 10px",
            fontSize: "calc(11px * var(--bs-font-scale, 1))",
            color: "rgba(255, 200, 80, 0.9)",
            lineHeight: 1.4,
          }}
        >
          Bright Daylight mode is showing the terrain in grayscale for maximum
          sunlight contrast. Pick a colormap above to override this.
        </div>
      )}
      <ColorRow
        label="Land / No-data Color"
        value={nodataColor}
        onChange={setNodataColor}
        sublabel="Color for land and survey gaps — match your basemap background"
      />
      <ToggleRow
        label="Show Contour Lines"
        value={contoursEnabled}
        onChange={setContoursEnabled}
        sublabel="Iso-depth lines on the 2D overview map"
      />
      <div style={{ opacity: contoursEnabled ? 1 : 0.4, pointerEvents: contoursEnabled ? "auto" : "none" }}>
        <ContourIntervalRow />
      </div>

      {/* Preset palettes */}
      <div style={{ padding: "12px 16px 4px" }}>
        <div style={{ ...labelStyle, marginBottom: 6 }}>PRESETS</div>
        <div
          data-testid="palette-presets"
          style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
        >
          {PALETTE_PRESETS.map((preset) => {
            const isActive = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                data-testid={`palette-preset-${preset.id}`}
                aria-pressed={isActive}
                title={preset.label}
                onClick={() => {
                  setBandColors(bandColorsFromPreset(preset, bandCount));
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 8px 4px 4px",
                  background: isActive ? "rgba(0,229,255,0.12)" : "rgba(0,0,0,0.3)",
                  border: isActive ? "1px solid rgba(0,229,255,0.55)" : "1px solid rgba(0,229,255,0.18)",
                  borderRadius: 3,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: isActive ? "#67e8f9" : "#e2e8f0",
                  fontSize: "calc(9px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    width: 28,
                    height: 14,
                    borderRadius: 2,
                    border: "1px solid rgba(0,0,0,0.4)",
                    background: `linear-gradient(90deg, ${preset.shallow} 0%, ${MID1_HEX} 33%, ${MID2_HEX} 66%, ${preset.deep} 100%)`,
                  }}
                />
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preview gradient */}
      <div style={{ padding: "12px 16px 6px" }}>
        <div style={{ ...labelStyle, marginBottom: 6 }}>PREVIEW (SHALLOW → DEEP)</div>
        <img
          ref={previewRef}
          alt="depth palette preview"
          data-testid="palette-preview"
          style={{
            width: "100%",
            height: 14,
            display: "block",
            border: "1px solid rgba(0,229,255,0.2)",
            borderRadius: 2,
          }}
        />
      </div>

      {isBandTheme && (
        <DepthBandEditor
          labelStyle={labelStyle}
          hexStyle={hexStyle}
          colorInputStyle={colorInputStyle}
        />
      )}

      {/* Reset */}
      <div style={{ padding: "10px 16px 14px", display: "flex", justifyContent: "flex-end" }}>
        <button
          data-testid="palette-reset-btn"
          onClick={() => { reset(); }}
          style={{
            background: "rgba(0,229,255,0.06)",
            border: "1px solid rgba(0,229,255,0.25)",
            borderRadius: 3,
            color: "#67e8f9",
            fontSize: "calc(9px * var(--bs-font-scale, 1))",
            letterSpacing: "0.15em",
            padding: "4px 12px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          RESET TO DEFAULTS
        </button>
      </div>
    </div>
  );
}
