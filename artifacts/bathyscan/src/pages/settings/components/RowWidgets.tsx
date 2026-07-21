import React, { useEffect, useRef, useState } from "react";
import { usePaletteStore } from "@/lib/paletteStore";
import { colormapCssGradient } from "@/lib/colormap";
import type { ColormapTheme } from "@/lib/settingsStore";
import { FONT, S } from "../styles";
import { Toggle, Select } from "./Toggle";

export function SliderRow({
  label, value, min, max, step, format, onChange, sublabel,
}: {
  label: string; value: number; min: number; max: number; step: number;
  format?: (v: number) => string; onChange: (v: number) => void; sublabel?: string;
}) {
  const fmt = format ?? ((v) => String(v));
  const inputId = `slider-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div style={S.row}>
      <div>
        <label htmlFor={inputId} style={S.label}>{label}</label>
        {sublabel && <div style={S.sublabel}>{sublabel}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          id={inputId}
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={S.slider}
        />
        <span style={{ color: "#00e5ff", fontSize: "calc(10px * var(--bs-font-scale, 1))", minWidth: 48, textAlign: "right" }}>
          {fmt(value)}
        </span>
      </div>
    </div>
  );
}

export function ToggleRow({
  label, value, onChange, sublabel,
}: {
  label: string; value: boolean; onChange: (v: boolean) => void; sublabel?: string;
}) {
  return (
    <div style={S.row}>
      <div>
        <div style={S.label}>{label}</div>
        {sublabel && <div style={S.sublabel}>{sublabel}</div>}
      </div>
      <Toggle value={value} onChange={onChange} aria-label={label} />
    </div>
  );
}

export function SelectRow<T extends string>({
  label, value, onChange, options, sublabel,
}: {
  label: string; value: T; onChange: (v: T) => void;
  options: { value: T; label: string }[]; sublabel?: string;
}) {
  return (
    <div style={S.row}>
      <div>
        <div style={S.label}>{label}</div>
        {sublabel && <div style={S.sublabel}>{sublabel}</div>}
      </div>
      <Select value={value} onChange={onChange} options={options} />
    </div>
  );
}

export function ColorRow({
  label, value, onChange, sublabel,
}: { label: string; value: string; onChange: (v: string) => void; sublabel?: string }) {
  return (
    <div style={S.row}>
      <div>
        <div style={S.label}>{label}</div>
        {sublabel && <div style={S.sublabel}>{sublabel}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 36, height: 24, border: "1px solid rgba(0,229,255,0.2)",
            borderRadius: 3, background: "transparent", cursor: "pointer", padding: 0,
          }}
          aria-label={label}
        />
        <span style={{ color: "#cbd5e1", fontSize: "calc(10px * var(--bs-font-scale, 1))", minWidth: 64, textAlign: "right" }}>
          {value.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

export function ColormapSwatch({
  theme, width, height, title,
}: { theme: ColormapTheme; width: number; height: number; title?: string }) {
  const paletteVersion = usePaletteStore(
    (s) => `${s.shallow}|${s.deep}|${s.bandColors.join(",")}|${s.bandBoundaries.join(",")}`,
  );
  const background = React.useMemo(
    () => colormapCssGradient(theme, "to right", 16),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paletteVersion is a string fingerprint that encodes all palette state; no other deps needed
    [theme, paletteVersion],
  );
  return (
    <span
      role="img"
      aria-label={title ?? `${theme} colormap preview`}
      title={title ?? `${theme} colormap`}
      style={{
        display: "inline-block",
        width,
        height,
        background,
        borderRadius: 3,
        border: "1px solid rgba(0,229,255,0.2)",
        flexShrink: 0,
      }}
    />
  );
}

export function ColormapSelectRow({
  label, value, onChange, options, sublabel,
}: {
  label: string;
  value: ColormapTheme;
  onChange: (v: ColormapTheme) => void;
  options: { value: ColormapTheme; label: string }[];
  sublabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value) ?? options[0]!;

  return (
    <div style={S.row}>
      <div>
        <div style={S.label}>{label}</div>
        {sublabel && <div style={S.sublabel}>{sublabel}</div>}
      </div>
      <div ref={wrapRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
        <ColormapSwatch theme={value} width={56} height={16} title={`Current: ${current.label}`} />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${label}: ${current.label}`}
          data-testid="depth-colormap-select"
          data-value={value}
          style={{
            ...S.select,
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 160,
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: "#e2e8f0" }}>{current.label}</span>
          <span style={{ color: "#cbd5e1", fontSize: "calc(16px * var(--bs-font-scale, 1))", lineHeight: 1 }}>{open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <ul
            role="listbox"
            aria-label={label}
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              zIndex: 200,
              listStyle: "none",
              margin: 0,
              padding: 4,
              background: "var(--bs-s-select-bg, rgba(0,10,20,0.96))",
              border: "1px solid var(--bs-s-card-border, rgba(0,229,255,0.25))",
              borderRadius: 4,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              minWidth: 240,
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            {options.map((o) => {
              const selected = o.value === value;
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={selected}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    cursor: "pointer",
                    borderRadius: 3,
                    background: selected ? "rgba(0,229,255,0.10)" : "transparent",
                    color: selected ? "#00e5ff" : "#e2e8f0",
                    fontSize: "calc(11px * var(--bs-font-scale, 1))",
                    fontFamily: FONT,
                  }}
                  onMouseEnter={(e) => {
                    if (!selected) (e.currentTarget as HTMLLIElement).style.background = "rgba(0,229,255,0.05)";
                  }}
                  onMouseLeave={(e) => {
                    if (!selected) (e.currentTarget as HTMLLIElement).style.background = "transparent";
                  }}
                >
                  <ColormapSwatch theme={o.value} width={40} height={12} title={`${o.label} preview`} />
                  <span style={{ flex: 1 }}>{o.label}</span>
                  {selected && <span style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#00e5ff" }}>●</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
