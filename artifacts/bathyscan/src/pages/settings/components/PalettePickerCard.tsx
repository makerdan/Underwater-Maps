import React from "react";
import {
  usePaletteStore,
  DEFAULT_SHALLOW,
  DEFAULT_DEEP,
  PALETTE_PRESETS,
  MID1_HEX,
  MID2_HEX,
  bandColorsFromPreset,
  DEFAULT_BAND_COLORS,
  DEFAULT_BAND_BOUNDARIES,
  MIN_BOUNDARY_GAP_FT,
} from "@/lib/paletteStore";
import { colormapCanvas, OCEAN_MAX_DEPTH_FT } from "@/lib/colormap";
import { formatDepth } from "@/lib/units";
import { useSettingsStore } from "@/lib/settingsStore";
import { flushServerSync } from "@/hooks/useServerSettingsSync";
import { S } from "../styles";

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

function DepthBandColorEditor({
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
  const units = useSettingsStore((s) => s.units);

  const allColorsDefault = bandColors.every(
    (c, i) => c.toLowerCase() === DEFAULT_BAND_COLORS[i]!.toLowerCase(),
  );
  const allBoundariesDefault = bandBoundaries.every(
    (b, i) => b === DEFAULT_BAND_BOUNDARIES[i],
  );

  const isMetric = units === "metric";
  const ftToDisplay = (ft: number) =>
    isMetric ? +(ft * FT_TO_M_SETTINGS).toFixed(1) : ft;
  const displayToFt = (v: number) =>
    Math.round(isMetric ? v / FT_TO_M_SETTINGS : v);
  const inputUnit = isMetric ? "m" : "ft";

  return (
    <div data-testid="depth-band-color-editor" style={{ padding: "8px 16px 4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ ...labelStyle, fontSize: "calc(9px * var(--bs-font-scale, 1))", letterSpacing: "0.15em" }}>
          DEPTH BAND COLOURS
        </div>
        <button
          type="button"
          data-testid="band-colors-reset-btn"
          onClick={() => { resetBandColors(); void flushServerSync(); }}
          disabled={allColorsDefault}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.2)",
            borderRadius: 3,
            color: allColorsDefault ? "#64748b" : "#67e8f9",
            fontSize: "calc(8px * var(--bs-font-scale, 1))",
            letterSpacing: "0.12em",
            padding: "2px 8px",
            cursor: allColorsDefault ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          RESET COLOURS
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {bandColors.map((color, i) => {
          const loFt = bandBoundaries[i] ?? DEFAULT_BAND_BOUNDARIES[i]!;
          const hiFt = bandBoundaries[i + 1] ?? DEFAULT_BAND_BOUNDARIES[i + 1]!;
          const loM = loFt * FT_TO_M_SETTINGS;
          const hiM = hiFt * FT_TO_M_SETTINGS;
          const bandLabel = `${formatDepth(loM, { units })} – ${formatDepth(hiM, { units })}`;

          return (
            <div
              key={i}
              data-testid={`band-color-row-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "90px auto 68px auto",
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
                  onCommit={(hex) => setBandColor(i, hex)}
                  style={hexStyle}
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
                    onClick={() => setBandColor(i, sw.hex)}
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
              <div
                style={{
                  width: 14,
                  height: 14,
                  background: color,
                  border: "1px solid rgba(0,229,255,0.3)",
                  borderRadius: 2,
                  flexShrink: 0,
                }}
                aria-hidden
                title={color}
              />
            </div>
          );
        })}
      </div>

      {/* Band Boundaries */}
      <div style={{ marginTop: 14, borderTop: "1px solid rgba(0,229,255,0.08)", paddingTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ ...labelStyle, fontSize: "calc(9px * var(--bs-font-scale, 1))", letterSpacing: "0.15em" }}>
            BAND BOUNDARIES
          </div>
          <button
            type="button"
            data-testid="band-boundaries-reset-btn"
            onClick={() => { resetBandBoundaries(); void flushServerSync(); }}
            disabled={allBoundariesDefault}
            style={{
              background: "none",
              border: "1px solid rgba(0,229,255,0.2)",
              borderRadius: 3,
              color: allBoundariesDefault ? "#64748b" : "#67e8f9",
              fontSize: "calc(8px * var(--bs-font-scale, 1))",
              letterSpacing: "0.12em",
              padding: "2px 8px",
              cursor: allBoundariesDefault ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            RESET BOUNDARIES
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", alignItems: "center", gap: 8, padding: "3px 0" }}>
            <span style={{ ...labelStyle, fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#64748b", whiteSpace: "nowrap" }}>START (FIXED)</span>
            <span style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#64748b", fontFamily: "inherit" }}>{formatDepth(0, { units })}</span>
            <span style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#475569", minWidth: 20 }} />
          </div>
          {Array.from({ length: 9 }, (_, idx) => {
            const bIdx = idx + 1;
            const currentFt = bandBoundaries[bIdx] ?? DEFAULT_BAND_BOUNDARIES[bIdx]!;
            const prevFt = bandBoundaries[bIdx - 1] ?? DEFAULT_BAND_BOUNDARIES[bIdx - 1]!;
            const nextFt = bandBoundaries[bIdx + 1] ?? DEFAULT_BAND_BOUNDARIES[bIdx + 1]!;
            const minDisplay = ftToDisplay(prevFt + MIN_BOUNDARY_GAP_FT);
            const maxDisplay = ftToDisplay(nextFt - MIN_BOUNDARY_GAP_FT);
            const stepDisplay = isMetric ? 0.5 : 5;
            const displayVal = ftToDisplay(currentFt);
            const changed = currentFt !== DEFAULT_BAND_BOUNDARIES[bIdx];
            return (
              <div
                key={bIdx}
                data-testid={`band-boundary-row-${bIdx}`}
                style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", alignItems: "center", gap: 8, padding: "3px 0", borderBottom: "1px solid rgba(0,229,255,0.04)" }}
              >
                <span style={{ ...labelStyle, fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#94a3b8", whiteSpace: "nowrap" }}>BOUNDARY {bIdx}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="range"
                    data-testid={`band-boundary-slider-${bIdx}`}
                    min={minDisplay} max={maxDisplay} step={stepDisplay} value={displayVal}
                    onChange={(e) => setBandBoundary(bIdx, displayToFt(Number(e.target.value)))}
                    style={{ ...S.slider, width: "100%" }}
                    aria-label={`Band boundary ${bIdx} depth`}
                  />
                  <input
                    type="number"
                    data-testid={`band-boundary-input-${bIdx}`}
                    min={minDisplay} max={maxDisplay} step={stepDisplay} value={displayVal}
                    onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setBandBoundary(bIdx, displayToFt(v)); }}
                    style={{ ...hexStyle, width: 58, textAlign: "right", color: changed ? "#00e5ff" : "#cbd5e1" }}
                    aria-label={`Band boundary ${bIdx} value in ${inputUnit}`}
                  />
                  <span style={{ ...labelStyle, fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#475569", minWidth: 14 }}>{inputUnit}</span>
                </div>
                <div
                  style={{ width: 6, height: 6, borderRadius: "50%", background: changed ? "#00e5ff" : "transparent", border: changed ? "none" : "1px solid rgba(0,229,255,0.15)", flexShrink: 0 }}
                  title={changed ? "Modified" : "Default"} aria-hidden
                />
              </div>
            );
          })}
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", alignItems: "center", gap: 8, padding: "3px 0" }}>
            <span style={{ ...labelStyle, fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#64748b", whiteSpace: "nowrap" }}>END (FIXED)</span>
            <span style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#64748b", fontFamily: "inherit" }}>{formatDepth(OCEAN_MAX_DEPTH_FT * FT_TO_M_SETTINGS, { units })}</span>
            <span style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#475569", minWidth: 20 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomBandColorEditor({
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
  const units = useSettingsStore((s) => s.units);

  return (
    <div style={{ padding: "6px 16px 8px" }} data-testid="palette-custom-editor">
      <div style={{ ...labelStyle, marginBottom: 6 }}>DEPTH BAND COLOURS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {bandColors.map((color, i) => {
          const loFt = DEFAULT_BAND_BOUNDARIES[i]!;
          const hiFt = DEFAULT_BAND_BOUNDARIES[i + 1]!;
          const loM = loFt * FT_TO_M_SETTINGS;
          const hiM = hiFt * FT_TO_M_SETTINGS;
          const bandLabel = `${formatDepth(loM, { units })} – ${formatDepth(hiM, { units })}`;
          return (
            <div
              key={i}
              data-testid={`palette-custom-band-${i}`}
              style={{ display: "grid", gridTemplateColumns: "90px auto 1fr", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(0,229,255,0.05)" }}
            >
              <span style={{ ...labelStyle, fontSize: "calc(9px * var(--bs-font-scale, 1))", letterSpacing: "0.05em", color: "#cbd5e1", whiteSpace: "nowrap" }}>
                {bandLabel}
              </span>
              <input
                type="color"
                data-testid={`palette-custom-band-${i}-color`}
                value={color}
                onChange={(e) => setBandColor(i, e.target.value)}
                style={colorInputStyle}
                aria-label={`Band ${i + 1} colour: ${bandLabel}`}
              />
              <DebouncedHexInput
                value={color}
                onCommit={(hex) => { setBandColor(i, hex); void flushServerSync(); }}
                style={hexStyle}
                testId={`palette-custom-band-${i}-hex`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PalettePickerCard() {
  const shallow = usePaletteStore((s) => s.shallow);
  const deep = usePaletteStore((s) => s.deep);
  const setShallow = usePaletteStore((s) => s.setShallow);
  const setDeep = usePaletteStore((s) => s.setDeep);
  const reset = usePaletteStore((s) => s.reset);
  const setBandColors = usePaletteStore((s) => s.setBandColors);

  const colormapTheme = useSettingsStore((s) => s.colormapTheme);
  const isCustom = colormapTheme === "custom";
  const isOcean = colormapTheme === "ocean";

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
  }, [shallow, deep, colormapTheme, bandColorsKey, bandBoundariesKey]);

  const isDefault = shallow.toLowerCase() === DEFAULT_SHALLOW.toLowerCase()
    && deep.toLowerCase() === DEFAULT_DEEP.toLowerCase();

  const activePresetId = PALETTE_PRESETS.find(
    (p) =>
      p.shallow.toLowerCase() === shallow.toLowerCase() &&
      p.deep.toLowerCase() === deep.toLowerCase(),
  )?.id;

  const swatchRow: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    fontSize: "calc(11px * var(--bs-font-scale, 1))",
    borderBottom: "1px solid rgba(0,229,255,0.06)",
  };
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
    <div style={S.card}>
      <div style={S.cardHeader}>◈ DEPTH COLOR PALETTE</div>

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
                  setShallow(preset.shallow);
                  setDeep(preset.deep);
                  setBandColors(bandColorsFromPreset(preset));
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

      {!isCustom && (
        <>
          {/* Shallow picker */}
          <div style={swatchRow}>
            <span style={labelStyle}>SHALLOW</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="text"
                data-testid="palette-shallow-hex"
                value={shallow}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) setShallow(v);
                }}
                style={hexStyle}
              />
              <input
                type="color"
                data-testid="palette-shallow-input"
                value={shallow}
                onChange={(e) => setShallow(e.target.value)}
                style={colorInputStyle}
                aria-label="Shallow water color"
              />
            </div>
          </div>

          {/* Deep picker */}
          <div style={swatchRow}>
            <span style={labelStyle}>DEEP</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="text"
                data-testid="palette-deep-hex"
                value={deep}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) setDeep(v);
                }}
                style={hexStyle}
              />
              <input
                type="color"
                data-testid="palette-deep-input"
                value={deep}
                onChange={(e) => setDeep(e.target.value)}
                style={colorInputStyle}
                aria-label="Deep water color"
              />
            </div>
          </div>

          {isOcean && (
            <DepthBandColorEditor
              labelStyle={labelStyle}
              hexStyle={hexStyle}
              colorInputStyle={colorInputStyle}
            />
          )}
        </>
      )}

      {isCustom && (
        <CustomBandColorEditor
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
          disabled={!isCustom && isDefault}
          style={{
            background: "rgba(0,229,255,0.06)",
            border: "1px solid rgba(0,229,255,0.25)",
            borderRadius: 3,
            color: (!isCustom && isDefault) ? "#64748b" : "#67e8f9",
            fontSize: "calc(9px * var(--bs-font-scale, 1))",
            letterSpacing: "0.15em",
            padding: "4px 12px",
            cursor: (!isCustom && isDefault) ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          RESET TO DEFAULTS
        </button>
      </div>
    </div>
  );
}
