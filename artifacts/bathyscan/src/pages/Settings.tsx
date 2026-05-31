/**
 * Settings page — full two-column layout with all preference categories.
 *
 * Settings are persisted locally (zustand + localStorage) and synced to the
 * server via GET/PUT /api/settings (debounced 300 ms) when the user is signed in.
 *
 * Route: /settings   Keyboard shortcut: ,
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useUser, useClerk } from "@/lib/clerkCompat";
import { keys as idbKeys, clear as idbClear } from "idb-keyval";
import { useDeleteMarkersMine } from "@workspace/api-client-react";
import { flushServerSync } from "@/hooks/useServerSettingsSync";
import type { Marker } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { clearUpscaleCache, getUpscaleCacheInfo } from "@/hooks/useUpscaledHeatmap";
import {
  listOfflinePacks,
  deleteOfflinePack,
  type OfflinePack,
} from "@/lib/offlinePackStore";
import {
  getHelpPackStatus,
  deleteHelpPack,
  type HelpPackStatus,
} from "@/lib/helpPackStore";

// Undo window for "soft" bulk-marker deletes (ms). The active dataset's
// marker list is cleared from the cache immediately and the actual DELETE
// only fires when the window elapses, so a misclick can be reverted by
// clicking "Undo".
const UNDO_DELETE_WINDOW_MS = 5000;
import {
  useSettingsStore,
  useAnySectionDirty,
  SETTINGS_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_CROSSHAIR_MENU_GAMEPAD_BUTTON,
  SECTION_KEYS,
  type MarkerType,
  type SettingsSection,
  type SettingsState,
} from "@/lib/settingsStore";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUPS,
  DEFAULT_KEY_BINDINGS,
  findBindingConflicts,
  type ShortcutActionId,
} from "@/lib/keyBindings";
import { formatKeyCode, formatGamepadButton } from "@/lib/keyLabel";
import { triggerBlobDownload } from "@/lib/blobDownload";
import { AdvancedDisclosure } from "@/components/AdvancedDisclosure";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMarkersQueryKey } from "@workspace/api-client-react";
import { useTerrainStore } from "@/lib/terrainStore";
import { usePaletteStore, DEFAULT_SHALLOW, DEFAULT_DEEP, PALETTE_PRESETS, MID1_HEX, MID2_HEX, bandColorsFromPreset, DEFAULT_BAND_COLORS, DEFAULT_BAND_BOUNDARIES, MIN_BOUNDARY_GAP_FT } from "@/lib/paletteStore";
import { colormapCanvas, colormapCssGradient, OCEAN_MAX_DEPTH_FT } from "@/lib/colormap";
import { formatDepth } from "@/lib/units";
import type { ColormapTheme } from "@/lib/settingsStore";
import { HelpIcon } from "@/components/help/HelpButton";
import { DefaultMapLoadPicker } from "@/components/DefaultMapLoadPicker";
import { useZoneOverlayStore } from "@/lib/zoneOverlayStore";
import {
  SLOT_NAMES_SALTWATER,
  SLOT_NAMES_FRESHWATER,
} from "@/lib/zoneMap";

/**
 * Format an ISO timestamp into a short human-readable "last synced" label.
 * Uses relative phrasing for recent syncs ("Just now", "5 min ago") and
 * falls back to a localised absolute date once it's older than a day.
 */
function formatLastSynced(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 10) return "JUST NOW";
  if (diffSec < 60) return `${diffSec}S AGO`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} MIN AGO`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}H AGO`;
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).toUpperCase();
}

const SectionTitle: React.FC<{ children: React.ReactNode; helpId?: string; helpLabel?: string }> =
  ({ children, helpId, helpLabel }) => (
    <h2 style={S.sectionTitle}>
      {children}
      {helpId && (
        <span style={{ marginLeft: 8, display: "inline-block", verticalAlign: "middle" }}>
          <HelpIcon articleId={helpId} {...(helpLabel ? { label: helpLabel } : {})} />
        </span>
      )}
    </h2>
  );

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Styling primitives ───────────────────────────────────────────────────────
const FONT = "'JetBrains Mono', 'Fira Code', monospace";

// All colour values go through CSS custom properties so the daylight theme
// can override them by defining the variables on `.bs-settings-page` —
// which cascades into every inline-styled child without requiring per-element
// class names.  The second argument to var() is the dark-mode fallback.
const S = {
  page: {
    minHeight: "100dvh",
    background: "var(--bs-s-page-bg, #040810)",
    color: "var(--bs-s-page-fg, #e2e8f0)",
    fontFamily: FONT,
    display: "flex",
    flexDirection: "column",
  } as React.CSSProperties,

  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "10px 20px",
    borderBottom: "1px solid var(--bs-s-border, rgba(0,229,255,0.12))",
    background: "var(--bs-s-topbar-bg, rgba(4,8,16,0.9))",
    backdropFilter: "blur(8px)",
    position: "sticky" as const,
    top: 0,
    zIndex: 10,
    flexShrink: 0,
  } as React.CSSProperties,

  layout: {
    display: "flex",
    flex: 1,
    maxWidth: 960,
    margin: "0 auto",
    width: "100%",
    gap: 0,
  } as React.CSSProperties,

  sidebar: {
    width: 180,
    flexShrink: 0,
    borderRight: "1px solid var(--bs-s-border, rgba(0,229,255,0.1))",
    padding: "20px 0 25vh 0",
  } as React.CSSProperties,

  content: {
    flex: 1,
    padding: "24px 28px",
    overflowY: "auto" as const,
    maxHeight: "calc(100dvh - 41px)",
  } as React.CSSProperties,

  navItem: (active: boolean): React.CSSProperties => ({
    display: "block",
    width: "100%",
    textAlign: "left",
    background: active ? "var(--bs-s-nav-active-bg, rgba(0,229,255,0.08))" : "none",
    border: "none",
    borderLeft: active
      ? "2px solid var(--bs-s-accent, #00e5ff)"
      : "2px solid transparent",
    padding: "8px 16px",
    fontSize: 9,
    letterSpacing: "0.2em",
    color: active
      ? "var(--bs-s-accent, #00e5ff)"
      : "var(--bs-s-sublabel-fg, #94a3b8)",
    cursor: "pointer",
    fontFamily: FONT,
    transition: "color 0.1s, background 0.1s",
  }),

  sectionTitle: {
    fontSize: 9,
    letterSpacing: "0.25em",
    color: "var(--bs-s-accent, #00e5ff)",
    fontWeight: 700,
    textShadow: "var(--bs-s-accent-shadow, 0 0 6px rgba(0,229,255,0.4))",
    marginBottom: 16,
    marginTop: 0,
  } as React.CSSProperties,

  card: {
    background: "var(--bs-s-card-bg, rgba(0,10,20,0.7))",
    border: "1px solid var(--bs-s-card-border, rgba(0,229,255,0.12))",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 16,
  } as React.CSSProperties,

  cardHeader: {
    padding: "10px 16px",
    borderBottom: "1px solid var(--bs-s-card-border, rgba(0,229,255,0.08))",
    fontSize: 8,
    letterSpacing: "0.2em",
    color: "var(--bs-s-card-header-fg, #cbd5e1)",
    fontWeight: 700,
  } as React.CSSProperties,

  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderBottom: "1px solid var(--bs-s-row-border, rgba(0,229,255,0.05))",
    fontSize: 11,
    gap: 12,
  } as React.CSSProperties,

  label: {
    color: "var(--bs-s-label-fg, #ffffff)",
    flexShrink: 0,
  } as React.CSSProperties,

  sublabel: {
    fontSize: 9,
    color: "var(--bs-s-sublabel-fg, #94a3b8)",
    marginTop: 2,
    letterSpacing: "0.05em",
  } as React.CSSProperties,

  select: {
    background: "var(--bs-s-select-bg, rgba(0,10,20,0.8))",
    border: "1px solid var(--bs-s-card-border, rgba(0,229,255,0.2))",
    borderRadius: 4,
    color: "var(--bs-s-page-fg, #e2e8f0)",
    fontSize: 10,
    padding: "4px 8px",
    fontFamily: FONT,
    cursor: "pointer",
    outline: "none",
  } as React.CSSProperties,

  slider: {
    accentColor: "var(--bs-s-accent, #00e5ff)",
    cursor: "pointer",
    width: 120,
  } as React.CSSProperties,

  toggle: (on: boolean): React.CSSProperties => ({
    position: "relative",
    display: "inline-block",
    width: 36,
    height: 20,
    background: on
      ? "var(--bs-s-toggle-on-bg, rgba(0,229,255,0.3))"
      : "var(--bs-s-toggle-off-bg, rgba(30,58,95,0.4))",
    border: on
      ? "1px solid var(--bs-s-toggle-on-border, rgba(0,229,255,0.5))"
      : "1px solid var(--bs-s-toggle-off-border, rgba(0,229,255,0.15))",
    borderRadius: 10,
    cursor: "pointer",
    flexShrink: 0,
    transition: "background 0.15s, border-color 0.15s",
  }),

  toggleKnob: (on: boolean): React.CSSProperties => ({
    position: "absolute",
    top: 2,
    left: on ? 17 : 2,
    width: 14,
    height: 14,
    background: on
      ? "var(--bs-s-toggle-knob-on, #00e5ff)"
      : "var(--bs-s-toggle-knob-off, #94a3b8)",
    borderRadius: "50%",
    transition: "left 0.15s, background 0.15s",
    boxShadow: on ? "0 0 6px rgba(0,229,255,0.6)" : "none",
  }),

  dangerCard: {
    background: "var(--bs-s-danger-card-bg, rgba(239,68,68,0.04))",
    border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 16,
  } as React.CSSProperties,

  dangerHeader: {
    padding: "10px 16px",
    borderBottom: "1px solid rgba(239,68,68,0.12)",
    fontSize: 8,
    letterSpacing: "0.2em",
    color: "var(--bs-s-danger-fg, #f87171)",
    fontWeight: 700,
  } as React.CSSProperties,

  dangerBtn: {
    background: "var(--bs-s-danger-btn-bg, rgba(239,68,68,0.08))",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: 4,
    color: "var(--bs-s-danger-fg, #f87171)",
    fontSize: 9,
    letterSpacing: "0.15em",
    padding: "6px 14px",
    cursor: "pointer",
    fontFamily: FONT,
    transition: "background 0.1s",
  } as React.CSSProperties,
};

// ─── Atomic controls ──────────────────────────────────────────────────────────
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      style={S.toggle(value)}
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onChange(!value)}
    >
      <div style={S.toggleKnob(value)} />
    </div>
  );
}

function Select<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={S.select}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function SliderRow({
  label, value, min, max, step, format, onChange, sublabel,
}: {
  label: string; value: number; min: number; max: number; step: number;
  format?: (v: number) => string; onChange: (v: number) => void; sublabel?: string;
}) {
  const fmt = format ?? ((v) => String(v));
  return (
    <div style={S.row}>
      <div>
        <div style={S.label}>{label}</div>
        {sublabel && <div style={S.sublabel}>{sublabel}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={S.slider}
        />
        <span style={{ color: "#00e5ff", fontSize: 10, minWidth: 48, textAlign: "right" }}>
          {fmt(value)}
        </span>
      </div>
    </div>
  );
}

function ToggleRow({
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
      <Toggle value={value} onChange={onChange} />
    </div>
  );
}

/**
 * Small horizontal gradient swatch for a colormap theme.
 * Shallow on the left → deep on the right.
 */
function ColormapSwatch({
  theme, width, height, title,
}: { theme: ColormapTheme; width: number; height: number; title?: string }) {
  const paletteVersion = usePaletteStore(
    (s) => `${s.shallow}|${s.deep}|${s.bandColors.join(",")}|${s.bandBoundaries.join(",")}`,
  );
  const background = React.useMemo(
    () => colormapCssGradient(theme, "to right", 16),
    // Re-sample when the user's palette changes (affects the "ocean" theme).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

/**
 * Custom dropdown for the depth colormap. Renders a small gradient swatch
 * beside each option and a larger preview next to the currently selected one,
 * so users can see what they're picking without leaving the Settings page.
 */
function ColormapSelectRow({
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
          <span style={{ color: "#cbd5e1", fontSize: 16, lineHeight: 1 }}>{open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <ul
            role="listbox"
            aria-label={label}
            style={{
              position: "absolute",
              bottom: "calc(100% + 4px)",
              right: 0,
              zIndex: 50,
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
                    fontSize: 11,
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
                  {selected && <span style={{ fontSize: 9, color: "#00e5ff" }}>●</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SelectRow<T extends string>({
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

function ColorRow({
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
        <span style={{ color: "#cbd5e1", fontSize: 10, minWidth: 64, textAlign: "right" }}>
          {value.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

// ─── Save/Reset row infrastructure ────────────────────────────────────────────

/**
 * Provided by the Settings page. Force-flushes any pending debounced sync
 * to the server (or no-ops cleanly when signed out, since localStorage
 * persistence happens synchronously).
 */
const SyncContext = React.createContext<{
  flush: () => Promise<void>;
  isSignedIn: boolean;
} | null>(null);

function SectionSaveButton({
  section,
  sections: sectionsProp,
}: {
  section?: SettingsSection;
  sections?: SettingsSection[];
}) {
  const allSections: SettingsSection[] = sectionsProp ?? (section ? [section] : []);
  const dirty = useSettingsStore((s) => {
    const snap = s.syncedSnapshot ?? {};
    for (const sec of allSections) {
      for (const k of SECTION_KEYS[sec]) {
        if (!Object.is(
          (s as unknown as Record<string, unknown>)[k],
          (snap as Record<string, unknown>)[k],
        )) return true;
      }
    }
    return false;
  });
  const sectionKey = allSections[0] ?? "visuals";
  const ctx = React.useContext(SyncContext);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // If user edits the section again after a "saved" flash, return to idle so
  // they can re-trigger a save. Also clear a stale "error" state when the
  // section becomes clean (e.g. an auto-sync succeeded after a manual error).
  useEffect(() => {
    if (dirty && status === "saved") setStatus("idle");
    if (!dirty && status === "error") {
      setStatus("idle");
      setErrMsg(null);
    }
  }, [dirty, status]);

  const onClick = async () => {
    if (!ctx) return;
    setStatus("saving");
    setErrMsg(null);
    try {
      await ctx.flush();
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setSavedAt(ts);
      setStatus("saved");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStatus("idle"), 3000);
    } catch (e) {
      setStatus("error");
      setErrMsg((e as Error)?.message || "Save failed");
    }
  };

  const isClean = !dirty && status !== "saving" && status !== "error";
  const disabled = status === "saving" || (!dirty && status !== "error");

  let label: string;
  if (status === "saving") label = "SAVING…";
  else if (status === "error") label = "RETRY SAVE";
  else if (status === "saved") label = savedAt ? `✓ SAVED ${savedAt}` : "✓ SAVED";
  else if (isClean) label = "✓ SAVED";
  else label = "SAVE";

  const isErrorStyle = status === "error";
  const isSavedStyle = isClean || status === "saved";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {status === "error" && errMsg && (
        <span
          data-testid={`save-section-${sectionKey}-error`}
          style={{ fontSize: 9, color: "#f87171", letterSpacing: "0.1em", userSelect: "text" }}
        >
          {errMsg}
        </span>
      )}
      <button
        data-testid={`save-section-${sectionKey}-btn`}
        data-state={status}
        data-dirty={dirty ? "true" : "false"}
        onClick={() => void onClick()}
        disabled={disabled}
        style={{
          background: isErrorStyle
            ? "rgba(239,68,68,0.08)"
            : isSavedStyle
              ? "rgba(74,222,128,0.06)"
              : "rgba(0,229,255,0.08)",
          border: `1px solid ${
            isErrorStyle
              ? "rgba(239,68,68,0.35)"
              : isSavedStyle
                ? "rgba(74,222,128,0.25)"
                : "rgba(0,229,255,0.3)"
          }`,
          borderRadius: 3,
          color: isErrorStyle ? "#f87171" : isSavedStyle ? "#4ade80" : "#67e8f9",
          fontSize: 9,
          letterSpacing: "0.15em",
          padding: "3px 10px",
          cursor: disabled ? "default" : "pointer",
          fontFamily: FONT,
          opacity: status === "saving" ? 0.7 : 1,
        }}
      >
        {label}
      </button>
    </div>
  );
}

function SectionActionsRow({
  section,
  sections: sectionsProp,
  withReset = true,
  withSave = true,
}: {
  section?: SettingsSection;
  sections?: SettingsSection[];
  withReset?: boolean;
  withSave?: boolean;
}) {
  const allSections: SettingsSection[] = sectionsProp ?? (section ? [section] : []);
  const resetSection = useSettingsStore((s) => s.resetSection);
  const resetKey = allSections[0] ?? "visuals";
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
      {withReset && (
        <button
          onClick={() => allSections.forEach((sec) => resetSection(sec))}
          data-testid={`reset-section-${resetKey}-btn`}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.15)",
            borderRadius: 3,
            color: "#cbd5e1",
            fontSize: 9,
            letterSpacing: "0.15em",
            padding: "3px 10px",
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          RESET SECTION
        </button>
      )}
      {withSave && <SectionSaveButton sections={allSections} />}
    </div>
  );
}

/** Reset-only row (no Save). Used by Account & Privacy. */
function SectionResetRow({ section }: { section: SettingsSection }) {
  return <SectionActionsRow section={section} withSave={false} />;
}

// ─── Offline / Storage helpers ────────────────────────────────────────────────
interface CachedDataset { url: string; label: string; sizeKb: number | null }

async function listCachedDatasets(): Promise<CachedDataset[]> {
  if (!("caches" in window)) return [];
  const cacheNames = await caches.keys();
  const entries: CachedDataset[] = [];
  for (const name of cacheNames.filter((n) => n === "api-terrain" || n === "api-overview" || n.includes("terrain"))) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const resp = await cache.match(req);
      let sizeKb: number | null = null;
      if (resp) {
        try { sizeKb = Math.round((await resp.clone().arrayBuffer()).byteLength / 1024); } catch { /* ignore */ }
      }
      const match = /\/datasets\/([^/]+)\/(terrain|overview)/.exec(req.url);
      entries.push({
        url: req.url,
        label: match ? `${match[1]} (${match[2]})` : req.url.split("/").slice(-3).join("/"),
        sizeKb,
      });
    }
  }
  return entries;
}

async function clearCacheEntry(url: string) {
  if (!("caches" in window)) return;
  for (const n of await caches.keys()) await (await caches.open(n)).delete(url);
}

async function countPendingItems() {
  let markers = 0, trails = 0;
  try {
    const keys = await idbKeys();
    markers = keys.filter((k) => typeof k === "string" && k.startsWith("pending-marker-")).length;
  } catch { /* ignore */ }
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("pending-trail-")) trails++;
  }
  return { markers, trails };
}

// ─── Contour Lines card ───────────────────────────────────────────────────────
/** Unit-aware default for contour interval: 10 m / 50 ft / 10 fathoms. */
function defaultContourInterval(units: "metric" | "imperial" | "nautical"): number {
  if (units === "nautical") return 10;
  if (units === "imperial") return 50;
  return 10;
}
/**
 * Just the contour interval slider row — used inside the combined
 * "Depth Display" card in VisualsSection so the toggle and slider are adjacent.
 */
function ContourIntervalRow() {
  const s = useSettingsStore();
  const isMetric = s.units === "metric";
  const isNautical = s.units === "nautical";
  const sliderMin  = isMetric ? 5  : isNautical ? 5  : 10;
  const sliderMax  = isMetric ? 50 : isNautical ? 50 : 200;
  const sliderStep = isMetric ? 5  : isNautical ? 1  : 10;
  const formatInterval = (v: number) =>
    isMetric ? `${v} m` : isNautical ? `${v} fm` : `${v} ft`;
  const unitLabel = isMetric ? "metres" : isNautical ? "fathoms" : "feet";
  const prevUnitsRef = useRef(s.units);
  useEffect(() => {
    const prev = prevUnitsRef.current;
    prevUnitsRef.current = s.units;
    if (prev === s.units) return;
    s.setContourInterval(defaultContourInterval(s.units));
  }, [s.units]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SliderRow
      label="Contour Interval"
      value={Math.min(sliderMax, Math.max(sliderMin, s.contourInterval))}
      min={sliderMin}
      max={sliderMax}
      step={sliderStep}
      format={formatInterval}
      onChange={s.setContourInterval}
      sublabel={`Depth spacing between lines (${unitLabel})`}
    />
  );
}

// ─── Section components ───────────────────────────────────────────────────────
function VisualsSection() {
  const s = useSettingsStore();
  return (
    <>
      <SectionTitle helpId="settings" helpLabel="Visuals & Performance">◈ VISUALS &amp; PERFORMANCE</SectionTitle>
      <SectionActionsRow section="visuals" />

      {/* Quality Preset — full-width banner above the card grid */}
      <div
        style={{
          background: "var(--bs-s-card-bg, rgba(0,10,20,0.7))",
          border: "1px solid var(--bs-s-card-border, rgba(0,229,255,0.2))",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.2em", color: "var(--bs-s-card-header-fg, #cbd5e1)", fontWeight: 700, marginBottom: 2 }}>
            QUALITY PRESET
          </div>
          <div style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.05em" }}>
            Master override — adjusts all visual controls below at once
          </div>
        </div>
        <Select
          value={s.qualityPreset}
          onChange={(v) => {
            if (v === "custom") s.setQualityPreset("custom");
            else s.applyQualityPreset(v);
          }}
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
            { value: "ultra", label: "Ultra" },
            { value: "custom", label: "Custom" },
          ]}
        />
      </div>

      {/* Basics */}
      <div style={S.card}>
        <div style={S.cardHeader}>BASICS</div>
        <SliderRow
          label="Terrain Exaggeration"
          value={s.terrainExaggeration}
          min={0.25} max={3.0} step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={s.setTerrainExaggeration}
          sublabel="Vertical stretch applied to terrain"
        />
        <ToggleRow
          label="Marine Snow Effect"
          value={s.enableMarineSnow}
          onChange={s.setEnableMarineSnow}
          sublabel="Floating particles around the camera"
        />
        {s.enableMarineSnow && (
          <div style={{ ...S.row, paddingLeft: 28, background: "rgba(0,229,255,0.02)" }}>
            <div>
              <div style={S.label}>Marine Snow Density</div>
            </div>
            <Select
              value={s.particleDensity}
              onChange={s.setParticleDensity}
              options={[
                { value: "sparse", label: "Sparse (500)" },
                { value: "dense", label: "Dense (2000)" },
              ]}
            />
          </div>
        )}
        <ToggleRow
          label="Caustics Effect"
          value={s.enableCaustics}
          onChange={s.setEnableCaustics}
          sublabel="Light refraction pattern overlay"
        />
      </div>

      {/* Depth Display — colormap + contour lines together */}
      <div style={S.card}>
        <div style={S.cardHeader}>DEPTH DISPLAY</div>
        <ColormapSelectRow
          label="Depth Colormap"
          value={s.colormapTheme}
          onChange={s.setColormapThemeByUser}
          options={[
            { value: "ocean", label: "Ocean (blue)" },
            { value: "freshwater", label: "Freshwater (green)" },
            { value: "thermal", label: "Thermal (purple→white)" },
            { value: "grayscale", label: "Grayscale" },
            { value: "viridis", label: "Viridis (purple→yellow)" },
            { value: "custom", label: "Custom (edit stops)" },
          ]}
          sublabel="Terrain surface colour gradient"
        />
        <ToggleRow
          label="Show Contour Lines"
          value={s.contoursEnabled}
          onChange={s.setContoursEnabled}
          sublabel="Iso-depth lines on the 2D overview map"
        />
        <div style={{ opacity: s.contoursEnabled ? 1 : 0.4, pointerEvents: s.contoursEnabled ? "auto" : "none" }}>
          <ContourIntervalRow />
        </div>
      </div>

      <PalettePickerCard />
      <ZoneColoursCard />
      <AdvancedDisclosure testId="visuals-advanced">
        <div style={S.card}>
          <div style={S.cardHeader}>PARTICLES &amp; TEXTURES</div>
          <SelectRow
            label="Texture Quality"
            value={s.textureQuality}
            onChange={s.setTextureQuality}
            options={[{ value: "off", label: "Off" }, { value: "low", label: "Low" }, { value: "high", label: "High" }]}
            sublabel="Resolution of surface textures draped over the terrain mesh."
          />
          <ToggleRow
            label="Antialiasing"
            value={s.antialiasing}
            onChange={s.setAntialiasing}
            sublabel="MSAA edge smoothing (page reload to apply)"
          />
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}>ATMOSPHERE</div>
          <SliderRow
            label="Fog Density"
            value={s.fogDensity}
            min={0.004} max={0.030} step={0.001}
            format={(v) => v.toFixed(3)}
            onChange={s.setFogDensity}
            sublabel="Exponential underwater haze"
          />
          <ColorRow
            label="Fog Color"
            value={s.fogColor}
            onChange={s.setFogColor}
            sublabel="Background tint of the underwater scene"
          />
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}>LIGHTING</div>
          <SliderRow
            label="Ambient Light Intensity"
            value={s.ambientLightIntensity}
            min={0} max={1} step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={s.setAmbientLightIntensity}
            sublabel="Uniform baseline brightness applied to the entire underwater scene."
          />
          <SliderRow
            label="Directional Light Intensity"
            value={s.directionalLightIntensity}
            min={0} max={1.5} step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={s.setDirectionalLightIntensity}
            sublabel="Brightness of the sun-like light that casts shading and depth shadows across terrain."
          />
          <SliderRow
            label="Lamp Intensity"
            value={s.lampIntensity}
            min={0} max={5} step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={s.setLampIntensity}
            sublabel="Camera-attached point light"
          />
          <SliderRow
            label="Lamp Range"
            value={s.lampRange}
            min={10} max={150} step={5}
            format={(v) => `${v} m`}
            onChange={s.setLampRange}
            sublabel="Radius in metres of the camera-attached point light that illuminates nearby terrain."
          />
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}>TERRAIN RENDERING</div>
          <ToggleRow
            label="Smooth terrain spikes"
            value={s.smoothTerrainSpikes}
            onChange={s.setSmoothTerrainSpikes}
            sublabel="Server-side post-process that blends slopes steeper than 70°. Disable to inspect raw bathymetric artifacts."
          />
          <ToggleRow
            label="Show water surface"
            value={s.showWaterSurface}
            onChange={s.setShowWaterSurface}
            sublabel="Translucent sea-level plane over the bathymetry. Colour tracks the active water type. Turn off for dry cross-section views."
          />
          <ToggleRow
            label="Show landmass"
            value={s.showLandmass}
            onChange={s.setShowLandmass}
            sublabel="Render above-water terrain (islands, shorelines) when the dataset includes topography. No effect on open-ocean datasets."
          />
          <ToggleRow
            label="Satellite imagery"
            value={s.satelliteImagery}
            onChange={s.setSatelliteImagery}
            sublabel="Drape ESRI World Imagery photo over the land mesh. Turn off to use the stylised green→brown→grey colour ramp — clearer in dark scenes."
          />
          <SelectRow
            label="Landmass style"
            value={s.landmassStyle}
            onChange={s.setLandmassStyle}
            options={[
              { value: "realistic", label: "Realistic (sand → grass → rock → snow)" },
              { value: "flat", label: "Flat (neutral grey)" },
            ]}
            sublabel="Use flat shading when overlaying your own data so terrain colour doesn't compete for attention."
          />
        </div>
      </AdvancedDisclosure>
    </>
  );
}

function NavigationSection() {
  const s = useSettingsStore();
  return (
    <>
      <SectionTitle helpId="keyboard-shortcuts" helpLabel="Camera & Controls">◈ CAMERA &amp; CONTROLS</SectionTitle>
      <SectionActionsRow section="camera" />
      <div style={S.card}>
        <div style={S.cardHeader}>BASICS</div>
        <div style={S.row}>
          <div>
            <div style={S.label}>Default Speed Tier</div>
            <div style={S.sublabel}>0 = slowest, 4 = fastest</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="range" min={0} max={4} step={1} value={s.defaultSpeedTier}
              onChange={(e) => s.setDefaultSpeedTier(Number(e.target.value))}
              style={S.slider}
            />
            <span style={{ color: "#00e5ff", fontSize: 10, minWidth: 24, textAlign: "center" }}>
              {s.defaultSpeedTier}
            </span>
          </div>
        </div>
        <SliderRow
          label="Mouse Sensitivity"
          value={s.mouseSensitivity}
          min={0.1} max={3.0} step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={s.setMouseSensitivity}
          sublabel="Multiplier applied to look rotation"
        />
        <ToggleRow
          label="Invert Mouse Y"
          value={s.invertMouseY}
          onChange={s.setInvertMouseY}
          sublabel="Flip vertical look direction"
        />
        <SliderRow
          label="Mouse Wheel Zoom Sensitivity"
          value={s.mouseZoomSensitivity}
          min={0.1} max={3.0} step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={s.setMouseZoomSensitivity}
          sublabel="How fast the wheel zooms (mouse notches)"
        />
        <SliderRow
          label="Touchpad Zoom Sensitivity"
          value={s.touchpadZoomSensitivity}
          min={0.1} max={3.0} step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={s.setTouchpadZoomSensitivity}
          sublabel="How fast two-finger scroll zooms the camera"
        />
        <SliderRow
          label="Mobile Pinch Zoom Sensitivity"
          value={s.pinchZoomSensitivity}
          min={0.1} max={3.0} step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={s.setPinchZoomSensitivity}
          sublabel="How fast pinch gestures zoom on touch devices"
        />
      </div>
      <AdvancedDisclosure testId="camera-advanced">
        <div style={S.card}>
          <div style={S.cardHeader}>CAMERA ADVANCED</div>
          <SliderRow
            label="Field of View"
            value={s.fieldOfView}
            min={30} max={90} step={1}
            format={(v) => `${v}°`}
            onChange={s.setFieldOfView}
            sublabel="Perspective FOV in degrees"
          />
          <SliderRow
            label="Render Distance"
            value={s.renderDistance}
            min={100} max={2000} step={50}
            format={(v) => `${v} m`}
            onChange={s.setRenderDistance}
            sublabel="Camera far clip plane"
          />
          <SelectRow
            label="Camera Spawn"
            value={s.cameraSpawnBehaviour}
            onChange={s.setCameraSpawnBehaviour}
            options={[
              { value: "last", label: "Resume last session" },
              { value: "home", label: "Home position" },
              { value: "deepest", label: "Deepest point" },
            ]}
            sublabel="Where to place the camera on the next visit"
          />
        </div>
        <div style={S.card}>
          <div
            style={{
              ...S.cardHeader,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>TOUCH CONTROLS</span>
            <span style={{ fontSize: 8, color: "#64748b", letterSpacing: "0.1em" }}>
              MOBILE / TOUCH ONLY
            </span>
          </div>
          <SelectRow
            label="On-Screen Joystick"
            value={s.joystickMode}
            onChange={s.setJoystickMode}
            options={[
              { value: "auto", label: "Auto (touch only)" },
              { value: "always", label: "Always on" },
              { value: "off", label: "Off" },
            ]}
            sublabel="Virtual joystick visibility on touch devices"
          />
          <ToggleRow
            label="Show Joystick in Orbit Mode"
            value={s.showJoystickInOrbit}
            onChange={s.setShowJoystickInOrbit}
            sublabel="Keep joystick visible during two-finger orbit gestures on touch"
          />
        </div>
      </AdvancedDisclosure>
    </>
  );
}

function HUDSection() {
  const s = useSettingsStore();
  return (
    <>
      <SectionTitle helpId="interface-tour" helpLabel="HUD & Layout">◈ HUD &amp; LAYOUT</SectionTitle>
      <SectionActionsRow section="hud" />
      <div style={S.card}>
        <div style={S.cardHeader}>VISIBILITY</div>
        <ToggleRow label="Crosshair GPS" value={s.showCrosshairGps} onChange={s.setShowCrosshairGps} sublabel="Centre-screen target coordinates" />
        <ToggleRow label="Your Current Coordinates" value={s.showCameraPosition} onChange={s.setShowCameraPosition} sublabel="Shows your viewpoint's longitude and latitude in the side pane" />
        <ToggleRow label="Heading" value={s.showHeading} onChange={s.setShowHeading} sublabel="Top-left HDG compass value" />
      </div>
      <div style={S.card}>
        <div style={S.cardHeader}>FORMAT &amp; DISPLAY</div>
        <SelectRow
          label="Coordinate Format"
          value={s.coordinateFormat}
          onChange={s.setCoordinateFormat}
          options={[{ value: "decimal", label: "Decimal (12.3456°)" }, { value: "dms", label: "DMS (12°20′44″)" }]}
        />
        <SliderRow
          label="HUD Opacity"
          value={s.hudOpacity}
          min={0.3} max={1.0} step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={s.setHudOpacity}
        />
      </div>
      <AdvancedDisclosure testId="hud-advanced">
        <div style={S.card}>
          <div style={S.cardHeader}>PANELS</div>
          <ToggleRow label="Depth Legend" value={s.showDepthLegend} onChange={s.setShowDepthLegend} sublabel="Floating depth/altitude legend" />
          <ToggleRow label="Depth Scale Bar" value={s.showDepthScaleBar} onChange={s.setShowDepthScaleBar} sublabel="Vertical gradient bar" />
          <ToggleRow label="Compass / Minimap" value={s.showCompassMinimap} onChange={s.setShowCompassMinimap} sublabel="Small compass rose and orientation indicator shown in the corner of the viewport." />
          <ToggleRow label="Controls Legend" value={s.showControlsLegend} onChange={s.setShowControlsLegend} sublabel="Keyboard/mouse cheat sheet overlay" />
          <ToggleRow label="Tide &amp; Currents Panel" value={s.showTidePanel} onChange={s.setShowTidePanel} sublabel="Floating panel with live tide height, current speed, and a short-range forecast graph." />
          <ToggleRow label="Habitat Panel" value={s.showHabitatPanel} onChange={s.setShowHabitatPanel} sublabel="Side panel listing predicted habitat zones and species at the current camera position." />
          <ToggleRow label="Dataset Selector" value={s.showDatasetPanel} onChange={s.setShowDatasetPanel} sublabel="Panel for switching between loaded datasets and viewing dataset metadata." />
          <ToggleRow label="Natural-Language Query" value={s.showQueryPanel} onChange={s.setShowQueryPanel} sublabel="AI-powered search bar that answers plain-English questions about the seafloor." />
          <ToggleRow
            label="Show UI tooltips"
            value={s.showUiTooltips}
            onChange={s.setShowUiTooltips}
            sublabel="Hover hints on viewscreen buttons and HUD elements"
          />
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}>TIME FORMAT</div>
          <SelectRow
            label="Time Display"
            value={s.timeFormat}
            onChange={s.setTimeFormat}
            options={[
              { value: "local", label: "Local time" },
              { value: "utc", label: "UTC" },
              { value: "12h", label: "12-hour" },
              { value: "24h", label: "24-hour" },
            ]}
            sublabel="Clock format used for tide predictions, overlay timestamps, and the tidal panel."
          />
        </div>
      </AdvancedDisclosure>
    </>
  );
}
const SALTWATER_MARKER_TYPE_OPTIONS: { value: MarkerType; label: string }[] = [
  { value: "fish", label: "🐟 Fish" },
  { value: "shipwreck", label: "⚓ Shipwreck" },
  { value: "coral", label: "🪸 Coral" },
  { value: "vent", label: "🌋 Vent" },
  { value: "custom", label: "📍 Custom" },
  { value: "depth_pole", label: "📏 Depth Pole" },
];

const FRESHWATER_MARKER_TYPE_OPTIONS: { value: MarkerType; label: string }[] = [
  { value: "fish", label: "🐟 Fish" },
  { value: "bass", label: "🎣 Bass" },
  { value: "trout", label: "🐠 Trout" },
  { value: "pike", label: "🦈 Pike" },
  { value: "walleye", label: "🐟 Walleye" },
  { value: "crayfish", label: "🦞 Crayfish" },
  { value: "vegetation", label: "🌿 Vegetation" },
  { value: "log", label: "🪵 Submerged Log" },
  { value: "sample", label: "🧪 Water Sample" },
  { value: "shipwreck", label: "⚓ Shipwreck" },
  { value: "custom", label: "📍 Custom" },
  { value: "depth_pole", label: "📏 Depth Pole" },
];
/**
 * Zone Colours card — shown in the Visuals tab.
 * Each of the four terrain slots gets a full row: name, colour picker,
 * hex display, and visibility toggle.  Changes flow through zoneOverlayStore
 * which is already subscribed to by useServerSettingsSync, so they are
 * debounced and persisted server-side automatically.
 */
function ZoneColoursCard() {
  const waterType = useSettingsStore((s) => s.waterType);
  const slots = useZoneOverlayStore((s) => s.slots);
  const setSlotColor = useZoneOverlayStore((s) => s.setSlotColor);
  const setSlotVisible = useZoneOverlayStore((s) => s.setSlotVisible);
  const resetToDefaults = useZoneOverlayStore((s) => s.resetToDefaults);
  const setActiveWaterType = useZoneOverlayStore((s) => s.setActiveWaterType);
  const slotNames =
    waterType === "freshwater" ? SLOT_NAMES_FRESHWATER : SLOT_NAMES_SALTWATER;

  useEffect(() => {
    setActiveWaterType(waterType as "saltwater" | "freshwater");
  }, [waterType, setActiveWaterType]);

  return (
    <div style={S.card}>
      <div
        style={{
          ...S.cardHeader,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>ZONE COLOURS</span>
        <button
          data-testid="settings-zone-colours-reset"
          onClick={resetToDefaults}
          style={{
            fontSize: 9,
            color: "#64748b",
            background: "transparent",
            border: "1px solid rgba(100,116,139,0.3)",
            borderRadius: 3,
            padding: "1px 8px",
            cursor: "pointer",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: FONT,
          }}
        >
          RESET TO DEFAULTS
        </button>
      </div>
      {slotNames.map((name, i) => {
        const slot = slots[i as 0 | 1 | 2 | 3];
        const color = slot?.color ?? "#f5d58a";
        const visible = slot?.visible ?? true;
        return (
          <div
            key={i}
            data-testid={`settings-zone-row-${i}`}
            style={{
              ...S.row,
              borderBottom:
                i < slotNames.length - 1
                  ? S.row.borderBottom
                  : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: color,
                  border: "1px solid rgba(255,255,255,0.15)",
                  boxShadow: `0 0 5px ${color}66`,
                  flexShrink: 0,
                  opacity: visible ? 1 : 0.35,
                  transition: "opacity 0.15s",
                }}
              />
              <div>
                <div style={{ ...S.label, opacity: visible ? 1 : 0.5 }}>{name}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <label
                data-testid={`settings-zone-colour-label-${i}`}
                title={`Change colour — ${name}`}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
              >
                <input
                  data-testid={`settings-zone-colour-input-${i}`}
                  type="color"
                  value={color}
                  onChange={(e) => setSlotColor(i as 0 | 1 | 2 | 3, e.target.value)}
                  style={{
                    width: 28,
                    height: 20,
                    border: "1px solid rgba(0,229,255,0.2)",
                    borderRadius: 3,
                    background: "transparent",
                    cursor: "pointer",
                    padding: 0,
                  }}
                  aria-label={`Zone colour for ${name}`}
                />
                <span
                  style={{
                    color: "#cbd5e1",
                    fontSize: 10,
                    minWidth: 58,
                    textAlign: "right",
                    fontFamily: FONT,
                    opacity: visible ? 1 : 0.5,
                  }}
                >
                  {color.toUpperCase()}
                </span>
              </label>
              <Toggle
                value={visible}
                onChange={(v) => setSlotVisible(i as 0 | 1 | 2 | 3, v)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ZoneColourSwatches() {
  const waterType = useSettingsStore((s) => s.waterType);
  const slots = useZoneOverlayStore((s) => s.slots);
  const setSlotColor = useZoneOverlayStore((s) => s.setSlotColor);
  const resetToDefaults = useZoneOverlayStore((s) => s.resetToDefaults);
  const setActiveWaterType = useZoneOverlayStore((s) => s.setActiveWaterType);
  const slotNames =
    waterType === "freshwater" ? SLOT_NAMES_FRESHWATER : SLOT_NAMES_SALTWATER;

  useEffect(() => {
    setActiveWaterType(waterType as "saltwater" | "freshwater");
  }, [waterType, setActiveWaterType]);

  return (
    <div style={S.card}>
      <div
        style={{
          ...S.cardHeader,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>ZONE COLOURS</span>
        <button
          data-testid="settings-zone-colors-reset"
          onClick={resetToDefaults}
          style={{
            fontSize: 9,
            color: "#64748b",
            background: "transparent",
            border: "1px solid rgba(100,116,139,0.3)",
            borderRadius: 3,
            padding: "1px 6px",
            cursor: "pointer",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            fontFamily: FONT,
          }}
        >
          Reset
        </button>
      </div>
      <div style={{ padding: "10px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {slotNames.map((name, i) => {
          const slot = slots[i as 0 | 1 | 2 | 3];
          const color = slot?.color ?? "#f5d58a";
          return (
            <label
              key={i}
              data-testid={`settings-zone-swatch-${i}`}
              title={`Click to change colour — ${name}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  background: color,
                  border: "1.5px solid rgba(255,255,255,0.15)",
                  boxShadow: `0 0 6px ${color}55`,
                  position: "relative",
                  transition: "box-shadow 0.15s",
                  flexShrink: 0,
                }}
              >
                <input
                  data-testid={`settings-zone-color-input-${i}`}
                  type="color"
                  value={color}
                  onChange={(e) => setSlotColor(i as 0 | 1 | 2 | 3, e.target.value)}
                  style={{
                    position: "absolute",
                    inset: 0,
                    opacity: 0,
                    cursor: "pointer",
                    width: "100%",
                    height: "100%",
                    border: "none",
                    padding: 0,
                  }}
                />
              </span>
              <span
                style={{
                  fontSize: 8,
                  color: "#94a3b8",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  textAlign: "center",
                  maxWidth: 52,
                  lineHeight: 1.3,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {name.split(" /")[0]}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
function AccessibilitySection() {
  const s = useSettingsStore();
  return (
    <>
      <h2 style={S.sectionTitle}>◈ ACCESSIBILITY</h2>
      <SectionActionsRow section="accessibility" />
      <div style={S.card}>
        <div style={S.cardHeader}>DISPLAY</div>
        <ToggleRow
          label="Reduce Motion"
          value={s.reducedMotion}
          onChange={s.setReducedMotion}
          sublabel="Disable non-essential animations &amp; particles"
        />
        <ToggleRow
          label="Color-Blind Safe Palette"
          value={s.colorBlindSafePalette}
          onChange={s.setColorBlindSafePalette}
          sublabel="Switch markers to a high-contrast palette"
        />
        <div style={S.row}>
          <div>
            <div style={S.label}>Text Size</div>
            <div style={S.sublabel}>Scales all panel and HUD text</div>
          </div>
          <Select
            value={s.globalFontSize}
            onChange={s.setGlobalFontSize}
            options={[
              { value: "smallest", label: "Smallest" },
              { value: "small", label: "Small" },
              { value: "medium", label: "Medium" },
              { value: "large", label: "Large" },
              { value: "x-large", label: "X-Large" },
              { value: "largest", label: "Largest" },
            ]}
          />
        </div>
        <ToggleRow
          label="High-Contrast HUD"
          value={s.highContrastHud}
          onChange={s.setHighContrastHud}
          sublabel="Stronger text/background contrast"
        />
        <ToggleRow
          label="Bright Daylight"
          value={s.brightDaylight}
          onChange={s.setBrightDaylight}
          sublabel="Opaque panels, bold text, and high contrast for outdoor use in direct sunlight — automatically switches the terrain to Grayscale for maximum depth contrast while active"
        />
      </div>
    </>
  );
}

/** Non-remappable shortcuts (mouse gestures, Escape, etc.) shown for reference only. */
const FIXED_SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "Click", desc: "Lock mouse / enter fly mode" },
  { keys: "Mouse drag", desc: "Look around" },
  { keys: "Scroll", desc: "Zoom in / out" },
  { keys: "R-drag / Ctrl-drag", desc: "Orbit around point" },
  { keys: "R-click", desc: "Context menu" },
  { keys: "Esc", desc: "Close panels / release pointer" },
];

function GlobalResetFooter() {
  const [confirm, setConfirm] = useState(false);
  const resetAll = useSettingsStore((s) => s.resetAll);

  return (
    <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid rgba(239,68,68,0.15)" }}>
      <div style={{ fontSize: 9, color: "#cbd5e1", letterSpacing: "0.15em", marginBottom: 8 }}>
        GLOBAL RESET
      </div>
      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 12 }}>
        Restore every setting on this page to its default value. Your saved
        dataset home positions and marker data are not affected.
      </div>
      {!confirm ? (
        <button
          onClick={() => setConfirm(true)}
          data-testid="reset-all-btn"
          style={{
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 4,
            color: "#f87171",
            fontSize: 9,
            letterSpacing: "0.15em",
            padding: "6px 14px",
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          RESET ALL SETTINGS
        </button>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 10, color: "#f87171" }}>Reset every setting?</span>
          <button
            onClick={() => { resetAll(); setConfirm(false); }}
            data-testid="confirm-reset-all-btn"
            style={{
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: 4,
              color: "#f87171",
              fontSize: 9,
              letterSpacing: "0.15em",
              padding: "6px 14px",
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            YES, RESET EVERYTHING
          </button>
          <button
            onClick={() => setConfirm(false)}
            style={{
              background: "none",
              border: "1px solid rgba(100,116,139,0.3)",
              borderRadius: 4,
              color: "#cbd5e1",
              fontSize: 9,
              letterSpacing: "0.15em",
              padding: "6px 14px",
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            CANCEL
          </button>
        </div>
      )}
    </div>
  );
}

/** Capture row for a single remappable keyboard action. */
function KeyBindingCapture({
  action,
  conflictWith,
}: {
  action: ShortcutActionId;
  conflictWith: string[];
}) {
  const def = SHORTCUT_ACTIONS.find((a) => a.id === action)!;
  const code = useSettingsStore((s) => s.keyBindings[action] ?? def.defaultCode);
  const setKeyBinding = useSettingsStore((s) => s.setKeyBinding);
  const resetKeyBinding = useSettingsStore((s) => s.resetKeyBinding);
  const [capturing, setCapturing] = useState(false);
  const isDefault = code === def.defaultCode;
  const conflict = conflictWith.length > 0;

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapturing(false);
        return;
      }
      if (
        e.code === "ShiftLeft" || e.code === "ShiftRight" ||
        e.code === "ControlLeft" || e.code === "ControlRight" ||
        e.code === "AltLeft" || e.code === "AltRight" ||
        e.code === "MetaLeft" || e.code === "MetaRight"
      ) return;
      setKeyBinding(action, e.code);
      setCapturing(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, action, setKeyBinding]);

  return (
    <div style={S.row}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={S.label}>{def.label}</div>
        <div style={S.sublabel}>{def.description}</div>
        {conflict && (
          <div
            data-testid={`shortcut-conflict-${action.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`}
            style={{ fontSize: 10, color: "#fb923c", marginTop: 4, letterSpacing: "0.04em" }}
          >
            ⚠ Also bound to: {conflictWith.join(", ")}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          data-testid={`shortcut-${action.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}-key`}
          onClick={() => setCapturing((v) => !v)}
          style={{
            background: capturing
              ? "rgba(251,146,60,0.12)"
              : conflict
                ? "rgba(251,146,60,0.06)"
                : "rgba(0,229,255,0.08)",
            border: `1px solid ${
              capturing
                ? "rgba(251,146,60,0.5)"
                : conflict
                  ? "rgba(251,146,60,0.45)"
                  : "rgba(0,229,255,0.25)"
            }`,
            borderRadius: 3,
            color: capturing ? "#fb923c" : conflict ? "#fb923c" : "#67e8f9",
            fontFamily: FONT,
            fontSize: 10,
            padding: "4px 12px",
            minWidth: 110,
            cursor: "pointer",
            letterSpacing: "0.1em",
          }}
        >
          {capturing ? "PRESS ANY KEY…" : formatKeyCode(code).toUpperCase()}
        </button>
        <button
          type="button"
          data-testid={`shortcut-${action.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}-reset`}
          onClick={() => resetKeyBinding(action)}
          disabled={isDefault}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.15)",
            borderRadius: 3,
            color: isDefault ? "#64748b" : "#cbd5e1",
            fontSize: 9,
            letterSpacing: "0.15em",
            padding: "3px 8px",
            cursor: isDefault ? "default" : "pointer",
            fontFamily: FONT,
            opacity: isDefault ? 0.5 : 1,
          }}
        >
          RESET
        </button>
      </div>
    </div>
  );
}

function CrosshairMenuGamepadCapture() {
  const value = useSettingsStore((s) => s.crosshairMenuGamepadButton);
  const setValue = useSettingsStore((s) => s.setCrosshairMenuGamepadButton);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      return;
    }
    let raf = 0;
    let snapshot: boolean[][] | null = null;
    const poll = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const current = pads.map((p) => (p ? p.buttons.map((b) => !!b.pressed) : []));
      if (!snapshot) {
        snapshot = current;
      } else {
        for (let p = 0; p < current.length; p++) {
          const cur = current[p] ?? [];
          const prev = snapshot[p] ?? [];
          for (let b = 0; b < cur.length; b++) {
            if (cur[b] && !prev[b]) {
              setValue(b);
              setCapturing(false);
              return;
            }
          }
        }
        snapshot = current;
      }
      raf = window.requestAnimationFrame(poll);
    };
    raf = window.requestAnimationFrame(poll);
    return () => window.cancelAnimationFrame(raf);
  }, [capturing, setValue]);

  return (
    <div style={S.row}>
      <div>
        <div style={S.label}>Gamepad button</div>
        <div style={S.sublabel}>
          Controller button that opens the same crosshair action menu. Uses
          the Standard Gamepad mapping; defaults to Y / Triangle.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          data-testid="shortcut-crosshair-menu-gamepad"
          onClick={() => setCapturing((v) => !v)}
          style={{
            background: capturing ? "rgba(251,146,60,0.12)" : "rgba(0,229,255,0.08)",
            border: `1px solid ${capturing ? "rgba(251,146,60,0.5)" : "rgba(0,229,255,0.25)"}`,
            borderRadius: 3,
            color: capturing ? "#fb923c" : "#67e8f9",
            fontFamily: FONT,
            fontSize: 10,
            padding: "4px 12px",
            minWidth: 140,
            cursor: "pointer",
            letterSpacing: "0.08em",
          }}
        >
          {capturing ? "PRESS A BUTTON…" : formatGamepadButton(value).toUpperCase()}
        </button>
        <button
          type="button"
          onClick={() => setValue(null)}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.15)",
            borderRadius: 3,
            color: "#cbd5e1",
            fontSize: 9,
            letterSpacing: "0.15em",
            padding: "3px 8px",
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          DISABLE
        </button>
        <button
          type="button"
          onClick={() => setValue(DEFAULT_CROSSHAIR_MENU_GAMEPAD_BUTTON)}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.15)",
            borderRadius: 3,
            color: "#cbd5e1",
            fontSize: 9,
            letterSpacing: "0.15em",
            padding: "3px 8px",
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          RESET
        </button>
      </div>
    </div>
  );
}

function ShortcutsSection() {
  const keyBindings = useSettingsStore((s) => s.keyBindings);
  const resetAllKeyBindings = useSettingsStore((s) => s.resetAllKeyBindings);

  // Map each action id to the other actions that share its code, so each row
  // can render an inline conflict warning. Built once per render from the
  // current bindings snapshot.
  const conflictByAction = React.useMemo(() => {
    const byCode = findBindingConflicts(keyBindings);
    const out = new Map<ShortcutActionId, string[]>();
    for (const action of SHORTCUT_ACTIONS) {
      const code = keyBindings[action.id] ?? action.defaultCode;
      const sharing = (byCode.get(code) ?? []).filter((id) => id !== action.id);
      out.set(
        action.id,
        sharing.map((id) => SHORTCUT_ACTIONS.find((a) => a.id === id)?.label ?? id),
      );
    }
    return out;
  }, [keyBindings]);

  const allDefault = React.useMemo(
    () =>
      SHORTCUT_ACTIONS.every(
        (a) => (keyBindings[a.id] ?? a.defaultCode) === DEFAULT_KEY_BINDINGS[a.id],
      ),
    [keyBindings],
  );

  return (
    <>
      <SectionTitle helpId="keyboard-shortcuts" helpLabel="Keyboard Shortcuts">◈ KEYBOARD SHORTCUTS</SectionTitle>
      <SectionActionsRow section="shortcuts" />

      {SHORTCUT_GROUPS.map((group) => {
        const actions = SHORTCUT_ACTIONS.filter((a) => a.group === group.id);
        if (actions.length === 0) return null;
        return (
          <div key={group.id} style={S.card}>
            <div style={S.cardHeader}>{group.title}</div>
            {actions.map((a) => (
              <KeyBindingCapture
                key={a.id}
                action={a.id}
                conflictWith={conflictByAction.get(a.id) ?? []}
              />
            ))}
          </div>
        );
      })}

      <div style={S.card}>
        <div style={S.cardHeader}>GAMEPAD</div>
        <CrosshairMenuGamepadCapture />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0 16px" }}>
        <button
          type="button"
          data-testid="reset-all-bindings-btn"
          onClick={() => resetAllKeyBindings()}
          disabled={allDefault}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.2)",
            borderRadius: 3,
            color: allDefault ? "#64748b" : "#67e8f9",
            fontSize: 9,
            letterSpacing: "0.15em",
            padding: "4px 12px",
            cursor: allDefault ? "default" : "pointer",
            fontFamily: FONT,
            opacity: allDefault ? 0.5 : 1,
          }}
        >
          RESET ALL KEY BINDINGS
        </button>
      </div>

      <div style={S.card}>
        <div style={S.cardHeader}>FIXED CONTROLS</div>
        <div style={{ padding: "8px 16px" }}>
          {FIXED_SHORTCUTS.map((sh) => (
            <div
              key={sh.keys}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 0",
                borderBottom: "1px solid rgba(0,229,255,0.05)",
                fontSize: 11,
              }}
            >
              <span style={{ color: "#e2e8f0" }}>{sh.desc}</span>
              <kbd
                style={{
                  background: "rgba(0,229,255,0.08)",
                  border: "1px solid rgba(0,229,255,0.25)",
                  borderRadius: 3,
                  padding: "2px 8px",
                  fontFamily: FONT,
                  fontSize: 10,
                  color: "#67e8f9",
                }}
              >
                {sh.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
function formatCacheSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
function AccountSection() {
  const { user } = useUser();
  const qc = useQueryClient();
  const activeGrid = useTerrainStore((s) => s.activeGrid);
  const s = useSettingsStore();
  const { toast } = useToast();
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const deleteAllMarkers = useDeleteMarkersMine({
    mutation: {
      onSuccess: (data) => {
        setDeleteMsg(`✓ Deleted ${data.deleted} marker${data.deleted !== 1 ? "s" : ""}`);
        const datasetId = activeGrid?.datasetId ?? "";
        if (datasetId) {
          qc.invalidateQueries({ queryKey: getGetMarkersQueryKey({ datasetId }) });
        }
        setTimeout(() => setDeleteMsg(null), 4000);
      },
    },
  });
  // Pending bulk-delete undo state. While a window is open, the active
  // dataset's marker list is hidden from the cache and the actual mutation
  // hasn't fired yet — clicking "Undo" restores the snapshot and cancels
  // the pending DELETE. Flushed on unmount so the server eventually
  // receives the request even if the user navigates away.
  const pendingBulkDeleteRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    commit: () => void;
  } | null>(null);
  useEffect(() => {
    return () => {
      const entry = pendingBulkDeleteRef.current;
      if (entry) {
        pendingBulkDeleteRef.current = null;
        entry.commit();
      }
    };
  }, []);

  const requestBulkDeleteAllMarkers = useCallback(() => {
    // If a previous undo window is still open, flush it first so we don't
    // stack two deferred mutations.
    const prev = pendingBulkDeleteRef.current;
    if (prev) {
      pendingBulkDeleteRef.current = null;
      prev.commit();
    }

    const datasetId = activeGrid?.datasetId ?? "";
    const markersKey = datasetId ? getGetMarkersQueryKey({ datasetId }) : null;
    const snapshot = markersKey ? qc.getQueryData<Marker[]>(markersKey) : undefined;
    if (markersKey) {
      qc.setQueryData<Marker[] | undefined>(markersKey, (prevList) =>
        prevList ? [] : prevList,
      );
    }

    const commit = () => {
      pendingBulkDeleteRef.current = null;
      deleteAllMarkers.mutate(undefined, {
        onError: () => {
          if (markersKey && snapshot !== undefined) {
            qc.setQueryData(markersKey, snapshot);
          }
        },
      });
    };

    const undo = () => {
      const entry = pendingBulkDeleteRef.current;
      if (!entry) return;
      clearTimeout(entry.timer);
      pendingBulkDeleteRef.current = null;
      if (markersKey && snapshot !== undefined) {
        qc.setQueryData(markersKey, snapshot);
      }
    };

    const timer = setTimeout(commit, UNDO_DELETE_WINDOW_MS);
    pendingBulkDeleteRef.current = {
      timer,
      commit: () => {
        clearTimeout(timer);
        commit();
      },
    };

    const toastHandle = toast({
      title: "All markers deleted",
      description: "Your markers will be removed.",
      duration: UNDO_DELETE_WINDOW_MS,
      action: (
        <ToastAction
          altText="Undo delete"
          data-testid="undo-delete-all-markers"
          onClick={() => {
            undo();
            toastHandle.dismiss();
          }}
        >
          Undo
        </ToastAction>
      ),
    });
  }, [activeGrid, qc, deleteAllMarkers, toast]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [accountMsg, setAccountMsg] = useState<string | null>(null);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hydrateFromServerSettings = useSettingsStore((st) => st.hydrateFromServer);
  const { signOut } = useClerk();

  const showSettingsMsg = (msg: string, ms = 3500) => {
    setSettingsMsg(msg);
    setTimeout(() => setSettingsMsg(null), ms);
  };

  const handleExportSettings = () => {
    try {
      const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof SettingsState)[]) {
        if (k === "syncedSnapshot") continue;
        if (k in state) data[k] = state[k as string];
      }
      const payload = {
        type: "bathyscan-settings",
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        settings: data,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      triggerBlobDownload(blob, `bathyscan-settings-${Date.now()}.json`);
      showSettingsMsg("✓ Settings exported");
    } catch (err) {
      showSettingsMsg(`✗ ${(err as Error).message}`, 4500);
    }
  };

  const handleImportSettings = async (file: File) => {
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("File is not valid JSON");
      }
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid settings file");
      }
      const root = parsed as Record<string, unknown>;
      const rawSettings =
        root.settings && typeof root.settings === "object"
          ? (root.settings as Record<string, unknown>)
          : root;

      if (
        "type" in root &&
        root.type !== undefined &&
        root.type !== "bathyscan-settings"
      ) {
        throw new Error("Not a BathyScan settings file");
      }

      const validated: Partial<SettingsState> = {};
      let accepted = 0;
      let skipped = 0;
      for (const k of Object.keys(rawSettings)) {
        if (k === "syncedSnapshot" || k === "schemaVersion") continue;
        if (!(k in DEFAULT_SETTINGS)) { skipped++; continue; }
        const expected = DEFAULT_SETTINGS[k as keyof SettingsState];
        const value = rawSettings[k];
        const expectedType = Array.isArray(expected) ? "array" : typeof expected;
        const actualType = Array.isArray(value) ? "array" : typeof value;
        if (expectedType !== actualType) { skipped++; continue; }
        if (expectedType === "object" && expected !== null) {
          if (value === null || Array.isArray(value)) { skipped++; continue; }
        }
        (validated as Record<string, unknown>)[k] = value;
        accepted++;
      }
      if (accepted === 0) {
        throw new Error("No valid settings found in file");
      }
      hydrateFromServerSettings(validated);
      const suffix = skipped > 0 ? ` (${skipped} skipped)` : "";
      showSettingsMsg(`✓ Imported ${accepted} settings${suffix}`);
    } catch (err) {
      showSettingsMsg(`✗ ${(err as Error).message}`, 4500);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      const resp = await fetch(`${apiBase}/api/me/export`, { credentials: "include" });
      if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
      const blob = await resp.blob();
      triggerBlobDownload(blob, `bathyscan-export-${Date.now()}.json`);
      setAccountMsg("✓ Export downloaded");
      setTimeout(() => setAccountMsg(null), 3000);
    } catch (err) {
      setAccountMsg(`✗ ${(err as Error).message}`);
      setTimeout(() => setAccountMsg(null), 4000);
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
    const resp = await fetch(`${apiBase}/api/me`, {
      method: "DELETE",
      credentials: "include",
    });
    if (resp.ok) {
      // Clear all client-side persisted state and sign out.
      try { localStorage.clear(); } catch { /* ignore */ }
      try { sessionStorage.clear(); } catch { /* ignore */ }
      await signOut();
    } else {
      setAccountMsg(`✗ Delete failed: ${resp.status}`);
      setTimeout(() => setAccountMsg(null), 4000);
    }
  };

  const lastSyncedAt = useSettingsStore((st) => st.lastSyncedAt);
  return (
    <>
      <SectionTitle helpId="settings" helpLabel="Account & Privacy">◈ ACCOUNT &amp; PRIVACY</SectionTitle>
      <SectionResetRow section="account" />
      {user && (
        <div style={S.card}>
          <div style={S.cardHeader}>SIGNED IN AS</div>
          <div style={{ ...S.row, justifyContent: "space-between", alignItems: "center" }}>
            <span style={S.label}>{user.primaryEmailAddress?.emailAddress ?? user.username ?? "—"}</span>
            <button
              onClick={() => void signOut()}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                letterSpacing: "0.15em",
                color: "#e2e8f0",
                background: "rgba(100,116,139,0.08)",
                border: "1px solid rgba(100,116,139,0.25)",
                borderRadius: 3,
                padding: "3px 10px",
                cursor: "pointer",
              }}
            >
              SIGN OUT
            </button>
          </div>
          <div
            style={{
              padding: "6px 16px 12px",
              fontSize: 9,
              letterSpacing: "0.12em",
              color: "#cbd5e1",
              fontFamily: "'JetBrains Mono', monospace",
            }}
            data-testid="last-synced-row"
          >
            LAST SYNCED:{" "}
            <span style={{ color: lastSyncedAt ? "#e2e8f0" : "#94a3b8" }}>
              {lastSyncedAt ? formatLastSynced(lastSyncedAt) : "NEVER"}
            </span>
          </div>
        </div>
      )}
      <div style={S.card}>
        <div style={S.cardHeader}>PRIVACY</div>
        <ToggleRow
          label="Anonymous Telemetry"
          value={s.telemetryOptIn}
          onChange={s.setTelemetryOptIn}
          sublabel="Help improve BathyScan by sharing anonymised usage events"
        />
      </div>
      {s.showQueryPanel && (
        <div style={S.card}>
          <div style={S.cardHeader}>AI QUERY — DATA NOTICE</div>
          <div style={{ padding: "12px 16px" }}>
            <div
              data-testid="llm-disclosure-summary"
              style={{
                fontSize: 10,
                color: "#e2e8f0",
                lineHeight: 1.7,
                letterSpacing: "0.04em",
                marginBottom: 12,
              }}
            >
              When you submit a natural-language query, the following context is sent to a
              third-party AI service (OpenAI):{" "}
              <strong style={{ color: "#fbbf24" }}>approximate camera location &amp; depth</strong>,{" "}
              <strong style={{ color: "#fbbf24" }}>dataset name</strong>, dataset depth range,
              water type, and top habitat zone names. Raw sonar grid data is{" "}
              <strong style={{ color: "#e2e8f0" }}>not</strong> transmitted. Queries are not
              stored after processing.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                data-testid="llm-disclosure-status"
                style={{
                  fontSize: 9,
                  letterSpacing: "0.14em",
                  color: s.llmDisclosureAcknowledged ? "#4ade80" : "#fb923c",
                }}
              >
                {s.llmDisclosureAcknowledged
                  ? "✓ NOTICE ACKNOWLEDGED"
                  : "⚠ NOT YET ACKNOWLEDGED"}
              </div>
              {s.llmDisclosureAcknowledged && (
                <button
                  data-testid="llm-disclosure-reset-btn"
                  onClick={() => s.setLlmDisclosureAcknowledged(false)}
                  style={{
                    background: "rgba(251,146,60,0.08)",
                    border: "1px solid rgba(251,146,60,0.3)",
                    borderRadius: 3,
                    color: "#fb923c",
                    fontSize: 9,
                    letterSpacing: "0.14em",
                    padding: "4px 12px",
                    cursor: "pointer",
                    fontFamily: FONT,
                    transition: "background 0.1s",
                  }}
                >
                  RESET ACKNOWLEDGMENT
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div style={S.card}>
        <div style={S.cardHeader}>SETTINGS BACKUP</div>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 10, color: "#cbd5e1", marginBottom: 12 }}>
            Save all your BathyScan settings (colormaps, sensitivity, fog, lamp,
            marker visibility, and more) to a file, or restore them from a previous export.
          </div>
          {settingsMsg && (
            <div
              data-testid="settings-backup-msg"
              style={{
                fontSize: 9,
                color: settingsMsg.startsWith("✓") ? "#4ade80" : "#f87171",
                letterSpacing: "0.12em",
                marginBottom: 8,
              }}
            >
              {settingsMsg}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={handleExportSettings}
              data-testid="export-settings-btn"
              style={{
                background: "rgba(0,229,255,0.06)",
                border: "1px solid rgba(0,229,255,0.25)",
                borderRadius: 3,
                color: "#67e8f9",
                fontSize: 9,
                letterSpacing: "0.15em",
                padding: "6px 14px",
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              EXPORT SETTINGS
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              data-testid="import-settings-btn"
              style={{
                background: "rgba(100,116,139,0.08)",
                border: "1px solid rgba(100,116,139,0.3)",
                borderRadius: 3,
                color: "#cbd5e1",
                fontSize: 9,
                letterSpacing: "0.15em",
                padding: "6px 14px",
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              IMPORT SETTINGS
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              data-testid="import-settings-input"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportSettings(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.cardHeader}>YOUR DATA</div>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 10, color: "#cbd5e1", marginBottom: 12 }}>
            Export a copy of all your settings, markers, custom datasets, and GPS trails as JSON.
          </div>
          {accountMsg && (
            <div style={{ fontSize: 9, color: accountMsg.startsWith("✓") ? "#4ade80" : "#f87171", letterSpacing: "0.12em", marginBottom: 8, userSelect: "text" }}>
              {accountMsg}
            </div>
          )}
          <button
            onClick={() => void handleExport()}
            disabled={exporting}
            data-testid="export-data-btn"
            style={{
              background: "rgba(0,229,255,0.06)",
              border: "1px solid rgba(0,229,255,0.25)",
              borderRadius: 3,
              color: "#67e8f9",
              fontSize: 9,
              letterSpacing: "0.15em",
              padding: "6px 14px",
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            {exporting ? "EXPORTING…" : "EXPORT MY DATA"}
          </button>
        </div>
      </div>
      {/* ── DANGER ZONE ────────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 8,
          borderTop: "2px solid rgba(239,68,68,0.3)",
          paddingTop: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.25em",
              color: "#f87171",
              fontWeight: 700,
              fontFamily: FONT,
            }}
          >
            ⚠ DANGER ZONE
          </span>
          <span
            style={{
              fontSize: 9,
              color: "#64748b",
              letterSpacing: "0.05em",
            }}
          >
            — destructive actions, cannot be undone
          </span>
        </div>
        <div style={S.dangerCard}>
          <div style={S.dangerHeader}>DELETE ALL MY MARKERS</div>
          <div style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 12 }}>
              Permanently removes every marker you have created across all datasets.
              This cannot be undone.
            </div>
            {deleteMsg && (
              <div style={{ fontSize: 9, color: "#4ade80", letterSpacing: "0.12em", marginBottom: 8 }}>
                {deleteMsg}
              </div>
            )}
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                style={S.dangerBtn}
              >
                DELETE ALL MY MARKERS
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: "#f87171" }}>
                  ⚠ This will permanently delete all your markers. Are you sure?
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => {
                      requestBulkDeleteAllMarkers();
                      setConfirmDelete(false);
                    }}
                    disabled={deleteAllMarkers.isPending}
                    style={{ ...S.dangerBtn, background: "rgba(239,68,68,0.15)" }}
                  >
                    {deleteAllMarkers.isPending ? "DELETING…" : "YES, DELETE ALL"}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    style={{
                      ...S.dangerBtn,
                      color: "#cbd5e1",
                      border: "1px solid rgba(100,116,139,0.3)",
                      background: "none",
                    }}
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ ...S.dangerCard, marginTop: 12 }}>
          <div style={S.dangerHeader}>DELETE MY ACCOUNT DATA</div>
          <div style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 12 }}>
              Permanently deletes <strong style={{ color: "#f87171" }}>all</strong> of your data
              — settings, markers, custom datasets, and GPS trails. This cannot be undone.
            </div>
            {!confirmDeleteAccount ? (
              <button
                onClick={() => setConfirmDeleteAccount(true)}
                data-testid="delete-account-btn"
                style={S.dangerBtn}
              >
                DELETE MY ACCOUNT DATA
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: "#f87171" }}>
                  ⚠ This will permanently delete everything. Are you sure?
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => { void handleDeleteAccount(); setConfirmDeleteAccount(false); }}
                    data-testid="confirm-delete-account-btn"
                    style={{ ...S.dangerBtn, background: "rgba(239,68,68,0.15)" }}
                  >
                    YES, DELETE EVERYTHING
                  </button>
                  <button
                    onClick={() => setConfirmDeleteAccount(false)}
                    style={{
                      ...S.dangerBtn,
                      color: "#cbd5e1",
                      border: "1px solid rgba(100,116,139,0.3)",
                      background: "none",
                    }}
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
// ─── Combined sections ─────────────────────────────────────────────────────────

/**
 * General — Environment mode (Saltwater/Freshwater) + Units in one section.
 * Merges the old standalone "Environment" and "Units" sidebar entries.
 */
function GeneralSection() {
  const s = useSettingsStore();
  const [, setLocation] = useLocation();
  const setHasSeenOnboarding = useSettingsStore((st) => st.setHasSeenOnboarding);
  return (
    <>
      <SectionTitle>◈ GENERAL</SectionTitle>
      <SectionActionsRow sections={["environment", "hud"]} withReset={false} />
      {/* Environment card */}
      <div style={S.card}>
        <div style={S.cardHeader}>ENVIRONMENT</div>
        <div style={S.row}>
          <div>
            <div style={S.label}>Exploration Mode</div>
            <div style={S.sublabel}>
              Switches datasets, species, marker types, and AI guidance
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["saltwater", "freshwater"] as const).map((wt) => {
              const active = s.waterType === wt;
              const color = wt === "freshwater" ? "#4ade80" : "#00e5ff";
              return (
                <button
                  key={wt}
                  data-testid={`settings-water-type-${wt}`}
                  onClick={() => s.setWaterType(wt)}
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.15em",
                    padding: "4px 12px",
                    borderRadius: 4,
                    border: `1px solid ${active ? color : "rgba(0,229,255,0.18)"}`,
                    background: active ? `${color}14` : "transparent",
                    color: active ? color : "#94a3b8",
                    cursor: "pointer",
                    fontFamily: FONT,
                    transition: "all 0.12s",
                  }}
                >
                  {wt === "saltwater" ? "≈ SALTWATER" : "~ FRESHWATER"}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ padding: "10px 16px 12px", fontSize: 10, color: "#94a3b8", lineHeight: 1.6 }}>
          {s.waterType === "freshwater" ? (
            <span style={{ color: "#4ade80", fontSize: 9, letterSpacing: "0.08em" }}>
              ~ Freshwater mode: lakes, reservoirs, freshwater species, limnology AI context.
            </span>
          ) : (
            <span style={{ color: "#00e5ff", fontSize: 9, letterSpacing: "0.08em" }}>
              ≈ Saltwater mode: ocean datasets, marine species, marine geology AI context.
            </span>
          )}
        </div>
      </div>
      {/* Units card */}
      <div style={S.card}>
        <div style={S.cardHeader}>UNITS</div>
        <SelectRow
          label="Units"
          value={s.units}
          onChange={s.setUnits}
          options={[
            { value: "metric", label: "Metric (m, km/h)" },
            { value: "imperial", label: "Imperial (ft, mph)" },
            { value: "nautical", label: "Nautical (ft, kn)" },
          ]}
          sublabel="Switching also updates depth and temperature unless overridden below"
        />
        <SelectRow
          label="Depth Unit"
          value={s.depthUnit}
          onChange={s.setDepthUnit}
          options={[
            { value: "metres", label: "Metres" },
            { value: "feet", label: "Feet" },
          ]}
          sublabel="Override depth display unit independently of the global units system"
        />
        <SelectRow
          label="Temperature Unit"
          value={s.temperatureUnit}
          onChange={s.setTemperatureUnit}
          options={[
            { value: "auto", label: "Auto (follow Units)" },
            { value: "celsius", label: "Celsius (°C)" },
            { value: "fahrenheit", label: "Fahrenheit (°F)" },
          ]}
          sublabel="Override temperature display unit independently of the global units system"
        />
      </div>
      {/* Tour card */}
      <div style={S.card}>
        <div style={S.cardHeader}>GUIDED TOUR</div>
        <div style={S.row}>
          <div>
            <div style={S.label}>Replay App Tour</div>
            <div style={S.sublabel}>Reset the onboarding tour and restart it from the beginning</div>
          </div>
          <button
            data-testid="replay-tour-btn"
            onClick={() => { setHasSeenOnboarding(false); setLocation("/"); }}
            style={{
              fontSize: 9,
              letterSpacing: "0.15em",
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid rgba(0,229,255,0.3)",
              background: "transparent",
              color: "#00e5ff",
              cursor: "pointer",
              fontFamily: FONT,
              whiteSpace: "nowrap",
            }}
          >
            ▶ REPLAY TOUR
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Map & Overlays — Overview Map + Habitat Defaults in one section.
 */
function MapOverlaysSection() {
  const s = useSettingsStore();
  return (
    <>
      <SectionTitle helpId="ai-assistant" helpLabel="Map & Overlays">◈ MAP &amp; OVERLAYS</SectionTitle>
      <SectionActionsRow sections={["overview", "habitat"]} withReset={false} />
      {/* Overview Map card */}
      <div style={S.card}>
        <div style={S.cardHeader}>OVERVIEW MAP</div>
        <ToggleRow label="Show Grid Lines" value={s.overviewShowGrid} onChange={s.setOverviewShowGrid} />
        <ToggleRow label="Show Markers" value={s.overviewShowMarkers} onChange={s.setOverviewShowMarkers} />
        <ToggleRow label="Open on Load" value={s.overviewOpenOnLoad} onChange={s.setOverviewOpenOnLoad} sublabel="Auto-expand when a dataset loads" />
        <SliderRow
          label="Default Zoom"
          value={s.overviewDefaultZoom}
          min={0.5} max={5.0} step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={s.setOverviewDefaultZoom}
        />
      </div>
      {/* Habitat card */}
      <div style={S.card}>
        <div style={S.cardHeader}>HABITAT</div>
        <ToggleRow
          label="Auto-Show Zone Overlay"
          value={s.autoShowZoneOverlay}
          onChange={s.setAutoShowZoneOverlay}
          sublabel="Display habitat zones automatically on load"
        />
        <SliderRow
          label="Overlay Intensity"
          value={s.habitatOverlayIntensity}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={s.setHabitatOverlayIntensity}
          sublabel="Default strength of the amber habitat tint on terrain"
        />
      </div>
      <ZoneColourSwatches />
      <AdvancedDisclosure testId="habitat-advanced">
        <div style={S.card}>
          <div style={S.cardHeader}>HABITAT DEFAULTS</div>
          <div style={S.row}>
            <div>
              <div style={S.label}>Default Species</div>
              <div style={S.sublabel}>Pre-fills the habitat species filter</div>
            </div>
            <input
              type="text"
              value={s.defaultHabitatSpecies}
              onChange={(e) => s.setDefaultHabitatSpecies(e.target.value)}
              placeholder="(none)"
              style={{
                ...S.select, width: 160, fontFamily: FONT, fontSize: 10,
              }}
            />
          </div>
        </div>
      </AdvancedDisclosure>
    </>
  );
}

/**
 * Markers & Trails — Markers + GPS & Trail in one section.
 */
function MarkersTrailsSection() {
  const s = useSettingsStore();
  const MARKER_TYPE_OPTIONS =
    s.waterType === "freshwater"
      ? FRESHWATER_MARKER_TYPE_OPTIONS
      : SALTWATER_MARKER_TYPE_OPTIONS;

  const toggleMarkerType = (type: MarkerType) => {
    const current = s.visibleMarkerTypes;
    if (current.includes(type)) {
      s.setVisibleMarkerTypes(current.filter((t) => t !== type));
    } else {
      s.setVisibleMarkerTypes([...current, type]);
    }
  };

  return (
    <>
      <SectionTitle helpId="markers" helpLabel="Markers & Trails">◈ MARKERS &amp; TRAILS</SectionTitle>
      <SectionActionsRow sections={["markers", "gps"]} />
      {/* Markers card */}
      <div style={S.card}>
        <div style={S.cardHeader}>MARKERS</div>
        <ToggleRow label="Show Marker Labels" value={s.showMarkerLabels} onChange={s.setShowMarkerLabels} sublabel="Name text below marker sprites" />
        <ToggleRow label="Private Markers" value={s.privateMarkers} onChange={s.setPrivateMarkers} sublabel="Only show your own markers" />
        <SelectRow
          label="Default Marker Type"
          value={s.defaultMarkerType}
          onChange={s.setDefaultMarkerType}
          options={MARKER_TYPE_OPTIONS}
          sublabel="Pre-selected when opening the marker form"
        />
      </div>
      {/* Visible Types card */}
      <div style={S.card}>
        <div style={S.cardHeader}>VISIBLE TYPES</div>
        {MARKER_TYPE_OPTIONS.map((o) => (
          <ToggleRow
            key={o.value}
            label={o.label}
            value={s.visibleMarkerTypes.includes(o.value)}
            onChange={() => toggleMarkerType(o.value)}
          />
        ))}
      </div>
      {/* Trails card */}
      <div style={S.card}>
        <div style={S.cardHeader}>TRAILS</div>
        <ToggleRow
          label="Auto-Start Trail Recording"
          value={s.autoStartTrailRecording}
          onChange={s.setAutoStartTrailRecording}
          sublabel="Begin recording the moment a dataset loads"
        />
        <ColorRow
          label="Default Trail Color"
          value={s.defaultTrailColor}
          onChange={s.setDefaultTrailColor}
        />
        <SelectRow
          label="Sample Rate"
          value={String(s.gpsRecordingInterval) as "1000" | "2000" | "10000"}
          onChange={(v) => s.setGpsRecordingInterval(Number(v))}
          options={[
            { value: "1000", label: "1 Hz (1 / sec)" },
            { value: "2000", label: "0.5 Hz (every 2s)" },
            { value: "10000", label: "0.1 Hz (every 10s)" },
          ]}
          sublabel="How often GPS track points are recorded"
        />
      </div>
      <AdvancedDisclosure testId="markers-advanced">
        <div style={S.card}>
          <div style={S.cardHeader}>MARKER ADVANCED</div>
          <ColorRow
            label="Default Depth Pole Color"
            value={s.defaultDepthPoleColor}
            onChange={s.setDefaultDepthPoleColor}
            sublabel="Used when creating a new depth-pole marker"
          />
          <SliderRow
            label="Cluster Threshold"
            value={s.markerClusterThreshold}
            min={0} max={200} step={5}
            format={(v) => v === 0 ? "Off" : `${v}`}
            onChange={s.setMarkerClusterThreshold}
            sublabel="Markers within this pixel distance are grouped. 0 disables clustering."
          />
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}>TRAIL RETENTION</div>
          <SelectRow
            label="Keep Trails For"
            value={s.trailRetention}
            onChange={s.setTrailRetention}
            options={[
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
              { value: "all", label: "Forever" },
            ]}
            sublabel="Older trails are auto-purged on next sign-in"
          />
        </div>
      </AdvancedDisclosure>
    </>
  );
}

/**
 * Tides & Currents — Tidal Defaults + Bathymetric Currents in one section.
 */
function TidesCurrentsSection() {
  const s = useSettingsStore();
  return (
    <>
      <SectionTitle helpId="settings" helpLabel="Tides & Currents">◈ TIDES &amp; CURRENTS</SectionTitle>
      <SectionActionsRow sections={["tidal", "currents"]} />
      {/* Behaviour card */}
      <div style={S.card}>
        <div style={S.cardHeader}>BEHAVIOUR</div>
        <ToggleRow
          label="Auto-Load Tidal Data"
          value={s.autoLoadTidal}
          onChange={s.setAutoLoadTidal}
          sublabel="Fetch tide &amp; current data when a dataset opens"
        />
        <SelectRow
          label="Default Depth Layer"
          value={s.defaultTidalDepthLayer}
          onChange={s.setDefaultTidalDepthLayer}
          options={[
            { value: "surface", label: "Surface" },
            { value: "mid", label: "Mid-water" },
            { value: "near-bottom", label: "Near-bottom" },
          ]}
          sublabel="Which current layer is shown by default"
        />
      </div>
      {/* Simulation card */}
      <div style={S.card}>
        <div style={S.cardHeader}>SIMULATION</div>
        <ToggleRow
          label="Enable Currents Simulation"
          value={s.currentsEnabled}
          onChange={s.setCurrentsEnabled}
          sublabel="Bathymetry-shaped flow field with particles, arrows, and streamlines"
        />
        <SelectRow
          label="Ambient Source"
          value={s.currentsSource}
          onChange={s.setCurrentsSource}
          options={[
            { value: "manual", label: "Manual" },
            { value: "noaa", label: "NOAA (live)" },
          ]}
          sublabel="Manual uses the values below; NOAA uses the active tidal station current"
        />
        <SliderRow
          label="Direction (°)"
          value={s.currentsManualDirectionDeg}
          min={0} max={360} step={5}
          onChange={s.setCurrentsManualDirectionDeg}
          sublabel="Compass bearing the current flows toward (0 = south, 90 = east)"
        />
        <SliderRow
          label="Speed (kt)"
          value={s.currentsManualSpeedKt}
          min={0} max={5} step={0.1}
          onChange={s.setCurrentsManualSpeedKt}
        />
      </div>
      <AdvancedDisclosure testId="tidal-advanced">
        <div style={S.card}>
          <div style={S.cardHeader}>VISUALISATION</div>
          <SelectRow
            label="Global Arrow Density"
            value={s.currentArrowDensity}
            onChange={s.setCurrentArrowDensity}
            options={[
              { value: "sparse", label: "Sparse" },
              { value: "normal", label: "Normal" },
              { value: "dense", label: "Dense" },
            ]}
            sublabel="Default density used when no per-layer override is set"
          />
          <SelectRow
            label="Surface Layer Density"
            value={s.layerArrowDensity.surface}
            onChange={(v) => s.setLayerArrowDensity("surface", v)}
            options={[
              { value: "sparse" as const, label: "Sparse" },
              { value: "normal" as const, label: "Normal" },
              { value: "dense" as const, label: "Dense" },
            ]}
            sublabel="Arrow density for the surface current layer"
          />
          <SelectRow
            label="Mid-water Layer Density"
            value={s.layerArrowDensity.mid}
            onChange={(v) => s.setLayerArrowDensity("mid", v)}
            options={[
              { value: "sparse" as const, label: "Sparse" },
              { value: "normal" as const, label: "Normal" },
              { value: "dense" as const, label: "Dense" },
            ]}
            sublabel="Arrow density for the mid-water current layer"
          />
          <SelectRow
            label="Near-bottom Layer Density"
            value={s.layerArrowDensity["near-bottom"]}
            onChange={(v) => s.setLayerArrowDensity("near-bottom", v)}
            options={[
              { value: "sparse" as const, label: "Sparse" },
              { value: "normal" as const, label: "Normal" },
              { value: "dense" as const, label: "Dense" },
            ]}
            sublabel="Arrow density for the near-bottom current layer"
          />
          <SelectRow
            label="Wind Overlay Style"
            value={s.windOverlayStyle}
            onChange={s.setWindOverlayStyle}
            options={[
              { value: "arrows", label: "Arrows" },
              { value: "particles", label: "Particles" },
            ]}
            sublabel="How the Wind overlay is drawn"
          />
          <SelectRow
            label="Tide Overlay Style"
            value={s.tideOverlayStyle}
            onChange={s.setTideOverlayStyle}
            options={[
              { value: "arrows", label: "Arrows" },
              { value: "particles", label: "Particles" },
            ]}
            sublabel="How the Tide overlay is drawn"
          />
          <SelectRow
            label="Current Overlay Style"
            value={s.currentOverlayStyle}
            onChange={s.setCurrentOverlayStyle}
            options={[
              { value: "arrows", label: "Arrows" },
              { value: "particles", label: "Particles" },
            ]}
            sublabel="How the Current overlay is drawn"
          />
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}>ADVANCED LAYERS</div>
          <ToggleRow
            label="Animated Particles"
            value={s.currentsShowParticles}
            onChange={s.setCurrentsShowParticles}
          />
          <ToggleRow
            label="Speed-Coloured Arrows"
            value={s.currentsShowArrows}
            onChange={s.setCurrentsShowArrows}
          />
          <ToggleRow
            label="Streamlines"
            value={s.currentsShowStreamlines}
            onChange={s.setCurrentsShowStreamlines}
          />
          <ToggleRow
            label="Auto-Advance Tide Phase"
            value={s.currentsAutoAdvance}
            onChange={s.setCurrentsAutoAdvance}
            sublabel="Slowly cycle the tide-phase scrubber for visual demo"
          />
        </div>
      </AdvancedDisclosure>
    </>
  );
}

/**
 * Data & Storage — Dataset Defaults + Offline/Cache in one section.
 */
function DataStorageSection() {
  const s = useSettingsStore();
  const [cached, setCached] = useState<CachedDataset[]>([]);
  const [pending, setPending] = useState({ markers: 0, trails: 0 });
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState<string | null>(null);
  const [allClearedMsg, setAllClearedMsg] = useState(false);
  const [upscaleClearMsg, setUpscaleClearMsg] = useState(false);
  const [upscaleInfo, setUpscaleInfo] = useState<{ count: number; bytes: number } | null>(null);
  const [offlinePacks, setOfflinePacks] = useState<OfflinePack[]>([]);
  const [helpStatus, setHelpStatus] = useState<HelpPackStatus | null>(null);
  const [packClearing, setPackClearing] = useState<string | null>(null);
  const [helpClearing, setHelpClearing] = useState(false);
  const { toast } = useToast();

  const refreshUpscaleInfo = useCallback(async () => {
    const info = await getUpscaleCacheInfo();
    setUpscaleInfo(info);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, p] = await Promise.all([listCachedDatasets(), countPendingItems()]);
    setCached(c);
    setPending(p);
    setLoading(false);
  }, []);

  const refreshPacks = useCallback(async () => {
    const [packs, help] = await Promise.all([listOfflinePacks(), getHelpPackStatus()]);
    setOfflinePacks(packs);
    setHelpStatus(help);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void refreshUpscaleInfo(); }, [refreshUpscaleInfo]);
  useEffect(() => { void refreshPacks(); }, [refreshPacks]);

  const handleDeletePack = async (id: string) => {
    setPackClearing(id);
    await deleteOfflinePack(id);
    await refreshPacks();
    setPackClearing(null);
    toast({ title: "Offline pack deleted", duration: 3000 });
  };

  const handleDeleteHelp = async () => {
    setHelpClearing(true);
    await deleteHelpPack();
    await refreshPacks();
    setHelpClearing(false);
    toast({ title: "Help pack deleted", duration: 3000 });
  };

  const handleClearEntry = async (url: string) => {
    setClearing(url);
    await clearCacheEntry(url);
    await refresh();
    setClearing(null);
  };

  const handleClearAll = async () => {
    if (!("caches" in window)) return;
    setClearing("all");
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
    await idbClear();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("pending-")) localStorage.removeItem(k!);
    }
    setAllClearedMsg(true);
    await refresh();
    setClearing(null);
    setTimeout(() => setAllClearedMsg(false), 3000);
  };

  const handleClearUpscaleCache = async () => {
    setClearing("upscale");
    await clearUpscaleCache();
    await refreshUpscaleInfo();
    setClearing(null);
    setUpscaleClearMsg(true);
    setTimeout(() => setUpscaleClearMsg(false), 3000);
    toast({ title: "Enhanced image cache cleared", duration: 3000 });
  };

  return (
    <>
      <SectionTitle helpId="datasets-uploads" helpLabel="Data & Storage">◈ DATA &amp; STORAGE</SectionTitle>
      <SectionActionsRow section="data" />
      {/* Defaults card */}
      <div style={S.card}>
        <div style={S.cardHeader}>DEFAULTS</div>
        <div style={S.row}>
          <div>
            <div style={S.label}>Default Map Load</div>
            <div style={S.sublabel}>Dataset that opens automatically on every launch</div>
          </div>
          <DefaultMapLoadPicker
            value={s.defaultMapLoad}
            onChange={s.setDefaultMapLoad}
          />
        </div>
        <SelectRow
          label="Default Region"
          value={s.defaultRegion}
          onChange={s.setDefaultRegion}
          options={[
            { value: "", label: "None — start with no dataset loaded" },
          ]}
          sublabel="No bundled preset regions are available. Upload your own data or save a dataset from Find Data to use as a default."
        />
        <ToggleRow
          label="Auto-Load Last Dataset"
          value={s.autoLoadLastDataset}
          onChange={s.setAutoLoadLastDataset}
          sublabel="Reopen the dataset you used last session"
        />
      </div>
      {/* Cache card */}
      <div style={S.card}>
        <div style={S.cardHeader}>CACHED TERRAIN DATA</div>
        <div style={{ padding: "12px 16px" }}>
          {loading ? (
            <div style={{ fontSize: 10, color: "#64748b" }}>◌ Loading…</div>
          ) : cached.length === 0 ? (
            <div data-testid="no-cache-msg" style={{ fontSize: 10, color: "#64748b" }}>
              No terrain data cached. Load a dataset to cache it.
            </div>
          ) : (
            cached.map((entry) => (
              <div key={entry.url} data-testid="cache-entry" style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 0", borderBottom: "1px solid rgba(0,229,255,0.06)", fontSize: 10,
              }}>
                <div>
                  <span style={{ color: "#cbd5e1" }}>{entry.label}</span>
                  {entry.sizeKb !== null && (
                    <span style={{ color: "#64748b", marginLeft: 8 }}>
                      {entry.sizeKb >= 1024 ? `${(entry.sizeKb / 1024).toFixed(1)} MB` : `${entry.sizeKb} KB`}
                    </span>
                  )}
                </div>
                <button
                  data-testid="clear-cache-entry-btn"
                  onClick={() => void handleClearEntry(entry.url)}
                  disabled={clearing === entry.url}
                  style={S.dangerBtn}
                >
                  {clearing === entry.url ? "…" : "CLEAR"}
                </button>
              </div>
            ))
          )}
        </div>
        <div style={{ ...S.row, flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "#94a3b8" }}>PENDING SYNC</div>
          <div style={{ fontSize: 10 }}>
            <span style={{ color: "#cbd5e1" }}>Markers: </span>
            <span data-testid="pending-markers-count" style={{ color: pending.markers > 0 ? "#fbbf24" : "#64748b" }}>
              {pending.markers}
            </span>
            <span style={{ color: "#cbd5e1", marginLeft: 16 }}>Trails: </span>
            <span style={{ color: pending.trails > 0 ? "#fbbf24" : "#64748b" }}>
              {pending.trails}
            </span>
          </div>
        </div>
        <div style={{ padding: "12px 16px" }}>
          {allClearedMsg && (
            <div style={{ fontSize: 9, color: "#4ade80", letterSpacing: "0.12em", marginBottom: 8 }}>
              ✓ All cached data cleared
            </div>
          )}
          <button
            data-testid="clear-all-cache-btn"
            onClick={() => void handleClearAll()}
            disabled={clearing === "all"}
            style={S.dangerBtn}
          >
            {clearing === "all" ? "CLEARING…" : "CLEAR ALL CACHED DATA"}
          </button>
        </div>
      </div>
      {/* AI Upscale cache */}
      <div style={S.card}>
        <div style={S.cardHeader}>ENHANCED IMAGE CACHE</div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 10 }}>
            AI-upscaled heatmap images are stored locally (IndexedDB) for up to 7 days to avoid
            repeat processing. Clear this if you suspect a stale image is being shown or want to
            free up browser storage.
          </div>
          <div
            data-testid="upscale-cache-size"
            style={{ fontSize: 10, color: "#cbd5e1", marginBottom: 10 }}
          >
            {upscaleInfo === null
              ? "◌ Calculating…"
              : upscaleInfo.count === 0
                ? "Empty (0 entries)"
                : `${upscaleInfo.count} ${upscaleInfo.count === 1 ? "entry" : "entries"} · ${formatCacheSize(upscaleInfo.bytes)}`}
          </div>
          {upscaleClearMsg && (
            <div style={{ fontSize: 9, color: "#4ade80", letterSpacing: "0.12em", marginBottom: 8 }}>
              ✓ Enhanced image cache cleared
            </div>
          )}
          <button
            data-testid="clear-upscale-cache-btn"
            onClick={() => void handleClearUpscaleCache()}
            disabled={clearing === "upscale"}
            style={S.dangerBtn}
          >
            {clearing === "upscale" ? "CLEARING…" : "CLEAR ENHANCED IMAGE CACHE"}
          </button>
        </div>
      </div>
      {/* Offline packs */}
      <div style={S.card}>
        <div style={S.cardHeader}>SAVED OFFLINE PACKS</div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 10 }}>
            Terrain, tide predictions, and weather snapshots saved for offline use.
            Each pack covers 7 days of tide data and can be updated from the dataset panel.
          </div>
          {offlinePacks.length === 0 ? (
            <div style={{ fontSize: 10, color: "#64748b" }}>
              No offline packs saved. Load a dataset and tap "⬇ Save Offline" to create one.
            </div>
          ) : (
            offlinePacks.map((pack) => {
              const savedDate = new Date(pack.savedAt).toLocaleDateString(undefined, {
                month: "short", day: "numeric", year: "numeric",
              });
              const expiresDate = new Date(pack.tidePack.tidalExpiresAt).toLocaleDateString(undefined, {
                month: "short", day: "numeric",
              });
              const isExpired = new Date(pack.tidePack.tidalExpiresAt).getTime() < Date.now();
              const sizeStr = pack.storageBytesEstimate >= 1024 * 1024
                ? `${(pack.storageBytesEstimate / (1024 * 1024)).toFixed(1)} MB`
                : `${Math.round(pack.storageBytesEstimate / 1024)} KB`;
              return (
                <div
                  key={pack.id}
                  data-testid={`offline-pack-${pack.id}`}
                  style={{
                    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                    padding: "8px 0", borderBottom: "1px solid rgba(0,229,255,0.06)", gap: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: "#cbd5e1", fontWeight: 600, marginBottom: 2 }}>
                      {pack.datasetName}
                    </div>
                    <div style={{ fontSize: 9, color: "#64748b" }}>
                      Saved {savedDate} · {sizeStr}
                    </div>
                    <div style={{ fontSize: 9, color: isExpired ? "#f87171" : "#94a3b8", marginTop: 1 }}>
                      Tide data {isExpired ? "expired" : `expires ${expiresDate}`}
                    </div>
                  </div>
                  <button
                    data-testid={`delete-pack-${pack.id}`}
                    onClick={() => void handleDeletePack(pack.id)}
                    disabled={packClearing === pack.id}
                    style={{
                      ...S.dangerBtn,
                      padding: "3px 8px",
                      fontSize: 8,
                      flexShrink: 0,
                    }}
                  >
                    {packClearing === pack.id ? "…" : "DELETE"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
      {/* Help content pack */}
      <div style={S.card}>
        <div style={S.cardHeader}>HELP CONTENT</div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 10 }}>
            Tutorial GIFs and images are cached for offline viewing. Download once to access
            help articles without a network connection.
          </div>
          {helpStatus === null ? (
            <div style={{ fontSize: 10, color: "#64748b" }}>◌ Loading…</div>
          ) : helpStatus.saved ? (
            <div>
              <div style={{ fontSize: 10, color: "#4ade80", marginBottom: 8 }}>
                ✓ Help content saved ·{" "}
                {helpStatus.savedAt && new Date(helpStatus.savedAt).toLocaleDateString(undefined, {
                  month: "short", day: "numeric", year: "numeric",
                })}
                {helpStatus.totalBytes != null && ` · ${(helpStatus.totalBytes / 1024).toFixed(0)} KB`}
              </div>
              <button
                data-testid="delete-help-pack-btn"
                onClick={() => void handleDeleteHelp()}
                disabled={helpClearing}
                style={{ ...S.dangerBtn, fontSize: 8, padding: "3px 8px" }}
              >
                {helpClearing ? "…" : "DELETE HELP PACK"}
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: "#64748b" }}>
              No help content saved. Use the Help panel (? button) when online to cache it.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Nav tabs ─────────────────────────────────────────────────────────────────
type Tab =
  | "general" | "visuals" | "navigation" | "hud"
  | "map-overlays" | "markers-trails" | "tides-currents"
  | "data-storage" | "accessibility" | "shortcuts" | "account";

const NAV_TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "GENERAL" },
  { id: "visuals", label: "VISUALS & PERF" },
  { id: "navigation", label: "CAMERA & CTRL" },
  { id: "hud", label: "HUD & LAYOUT" },
  { id: "map-overlays", label: "MAP & OVERLAYS" },
  { id: "markers-trails", label: "MARKERS & TRAILS" },
  { id: "tides-currents", label: "TIDES & CURRENTS" },
  { id: "data-storage", label: "DATA & STORAGE" },
  { id: "accessibility", label: "ACCESSIBILITY" },
  { id: "shortcuts", label: "SHORTCUTS" },
  { id: "account", label: "ACCOUNT & PRIVACY" },
];

// ─── Main export ──────────────────────────────────────────────────────────────
export function Settings() {
  const [, setLocation] = useLocation();
  const { isSignedIn } = useUser();
  const [tab, setTab] = useState<Tab>("visuals");
  const [savedMsg, setSavedMsg] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSavedMsg = useCallback(() => {
    setSavedMsg(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedMsg(false), 2000);
  }, []);

  const markAllSaved = useSettingsStore((s) => s.markAllSaved);

  // Flush is delegated to the always-on root hook (useServerSettingsSync)
  // which handles GET hydration, debounced PUT, and panelCollapse sync.
  // The explicit section Save buttons here call flushServerSync() to cancel
  // any pending debounce and immediately PUT the current state.
  // Signed-out users get local-only persistence (zustand→localStorage); we
  // call markAllSaved(null) directly so the dirty flag clears without a PUT.
  const flushSync = useCallback(async (): Promise<void> => {
    if (!isSignedIn) {
      markAllSaved(null);
      flashSavedMsg();
      return;
    }
    await flushServerSync();
    flashSavedMsg();
  }, [isSignedIn, markAllSaved, flashSavedMsg]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      // Flush any pending debounced settings PUT when the page unmounts
      // (e.g. user navigates away before the debounce window elapses).
      void flushServerSync();
    };
  }, []);

  const syncCtx = React.useMemo(
    () => ({ flush: flushSync, isSignedIn: !!isSignedIn }),
    [flushSync, isSignedIn],
  );

  const showAdvancedEverywhere = useSettingsStore((s) => s.showAdvancedEverywhere);
  const setShowAdvancedEverywhere = useSettingsStore((s) => s.setShowAdvancedEverywhere);

  // ── Unsaved-changes guard ─────────────────────────────────────────────
  // Track any dirty section so we can warn before navigation/unload.
  // Signed-out users have their changes persisted to localStorage
  // synchronously by zustand, so no warning is needed for them.
  const anyDirty = useAnySectionDirty();
  const shouldGuard = !!isSignedIn && anyDirty;

  useEffect(() => {
    if (!shouldGuard) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for legacy browsers; modern browsers show a generic prompt.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [shouldGuard]);

  const handleBack = useCallback(async () => {
    if (shouldGuard) {
      try {
        await flushSync();
      } catch {
        // Swallow — user can retry via the section Save button. We still
        // navigate so they aren't trapped on the page.
      }
    }
    setLocation(basePath + "/");
  }, [shouldGuard, flushSync, setLocation]);

  return (
    <SyncContext.Provider value={syncCtx}>
    <div style={S.page} className="bs-settings-page">
      {/* Top bar */}
      <div style={S.topbar}>
        <button
          onClick={handleBack}
          title={shouldGuard ? "Saving unsaved changes before leaving…" : undefined}
          data-testid="settings-back-btn"
          data-unsaved={shouldGuard ? "true" : "false"}
          style={{ background: "none", border: "none", color: shouldGuard ? "#fbbf24" : "#94a3b8", cursor: "pointer", fontSize: 11, letterSpacing: "0.15em", padding: 0, fontFamily: FONT, display: "flex", alignItems: "center", gap: 8 }}
        >
          <span>← BACK</span>
          {shouldGuard && (
            <span
              data-testid="settings-back-unsaved-hint"
              style={{ fontSize: 9, letterSpacing: "0.15em", color: "#fbbf24", opacity: 0.8 }}
            >
              • UNSAVED
            </span>
          )}
        </button>
        <span style={{ fontSize: 10, letterSpacing: "0.3em", color: "#00e5ff", fontWeight: 700, textShadow: "0 0 8px rgba(0,229,255,0.5)", flex: 1 }}>
          SETTINGS
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 9 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#cbd5e1", letterSpacing: "0.1em", cursor: "pointer" }}>
            <span>SHOW ADVANCED</span>
            <span data-testid="show-advanced-toggle">
              <Toggle value={showAdvancedEverywhere} onChange={setShowAdvancedEverywhere} />
            </span>
          </label>
          {savedMsg && (
            <span
              data-testid="topbar-saved-indicator"
              style={{ color: "#4ade80", letterSpacing: "0.15em" }}
            >
              ✓ SAVED
            </span>
          )}
          {isSignedIn && !savedMsg && (
            <span style={{ color: "#64748b", letterSpacing: "0.1em" }}>synced to cloud</span>
          )}
          <span style={{ color: "#64748b", letterSpacing: "0.1em" }} title={`schema v${SETTINGS_SCHEMA_VERSION}`}>
            v{SETTINGS_SCHEMA_VERSION}
          </span>
        </div>
      </div>

      {/* Two-column layout */}
      <div style={S.layout}>
        {/* Sidebar */}
        <nav style={S.sidebar}>
          {NAV_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={S.navItem(tab === t.id)}
              data-nav-active={tab === t.id ? "true" : "false"}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div style={S.content}>
          {tab === "general" && <GeneralSection />}
          {tab === "visuals" && <VisualsSection />}
          {tab === "navigation" && <NavigationSection />}
          {tab === "hud" && <HUDSection />}
          {tab === "map-overlays" && <MapOverlaysSection />}
          {tab === "markers-trails" && <MarkersTrailsSection />}
          {tab === "tides-currents" && <TidesCurrentsSection />}
          {tab === "data-storage" && <DataStorageSection />}
          {tab === "accessibility" && <AccessibilitySection />}
          {tab === "shortcuts" && <ShortcutsSection />}
          {tab === "account" && <AccountSection />}

          {/* Footer: global reset */}
          <GlobalResetFooter />
        </div>
      </div>
    </div>
    </SyncContext.Provider>
  );
}

const FT_TO_M_SETTINGS = 0.3048;

const BAND_PRESET_SWATCHES = [
  { hex: "#00bcd4", label: "Turquoise" },
  { hex: "#1565c0", label: "Ocean Blue" },
  { hex: "#1a237e", label: "Navy" },
  { hex: "#4a148c", label: "Deep Violet" },
  { hex: "#000000", label: "Black" },
];

const HEX_RE_SETTINGS = /^#[0-9a-fA-F]{6}$/;

/**
 * Hex text input that keeps a local draft while the user types and only
 * commits a valid "#rrggbb" value to the store after a 300 ms debounce.
 * Syncs back to the external `value` whenever the parent changes it (e.g.
 * when a preset chip is clicked).
 */
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

/**
 * Per-band depth colour editor — shows 10 rows (one per depth band) with a
 * label, a native colour picker swatch, a debounced hex text input, and a
 * row of quick-pick preset swatches. Only rendered when the Ocean theme is
 * active. Edits flow through paletteStore and re-tint the terrain live.
 */
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

  // Convert a feet value to the current display unit for the boundary inputs.
  const isMetric = units === "metric";
  const ftToDisplay = (ft: number) =>
    isMetric ? +(ft * FT_TO_M_SETTINGS).toFixed(1) : ft;
  // Convert a display-unit value back to feet (integer).
  const displayToFt = (v: number) =>
    Math.round(isMetric ? v / FT_TO_M_SETTINGS : v);

  const inputUnit = isMetric ? "m" : "ft";

  return (
    <div data-testid="depth-band-color-editor" style={{ padding: "8px 16px 4px" }}>
      {/* ── Colour rows ───────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ ...labelStyle, fontSize: 9, letterSpacing: "0.15em" }}>
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
            fontSize: 8,
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
              <span style={{ ...labelStyle, fontSize: 9, letterSpacing: "0.05em", color: "#cbd5e1", whiteSpace: "nowrap" }}>
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

      {/* ── Band Boundaries ───────────────────────────────────────── */}
      <div style={{ marginTop: 14, borderTop: "1px solid rgba(0,229,255,0.08)", paddingTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ ...labelStyle, fontSize: 9, letterSpacing: "0.15em" }}>
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
              fontSize: 8,
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
          {/* Fixed start boundary (read-only) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "90px 1fr auto",
              alignItems: "center",
              gap: 8,
              padding: "3px 0",
            }}
          >
            <span style={{ ...labelStyle, fontSize: 9, color: "#64748b", whiteSpace: "nowrap" }}>
              START (FIXED)
            </span>
            <span style={{ fontSize: 9, color: "#64748b", fontFamily: "inherit" }}>
              {formatDepth(0, { units })}
            </span>
            <span style={{ fontSize: 9, color: "#475569", minWidth: 20 }} />
          </div>

          {/* Editable interior boundaries (indices 1–9) */}
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
                style={{
                  display: "grid",
                  gridTemplateColumns: "90px 1fr auto",
                  alignItems: "center",
                  gap: 8,
                  padding: "3px 0",
                  borderBottom: "1px solid rgba(0,229,255,0.04)",
                }}
              >
                <span style={{ ...labelStyle, fontSize: 9, color: "#94a3b8", whiteSpace: "nowrap" }}>
                  BOUNDARY {bIdx}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="range"
                    data-testid={`band-boundary-slider-${bIdx}`}
                    min={minDisplay}
                    max={maxDisplay}
                    step={stepDisplay}
                    value={displayVal}
                    onChange={(e) => setBandBoundary(bIdx, displayToFt(Number(e.target.value)))}
                    style={{ ...S.slider, width: "100%" }}
                    aria-label={`Band boundary ${bIdx} depth`}
                  />
                  <input
                    type="number"
                    data-testid={`band-boundary-input-${bIdx}`}
                    min={minDisplay}
                    max={maxDisplay}
                    step={stepDisplay}
                    value={displayVal}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) setBandBoundary(bIdx, displayToFt(v));
                    }}
                    style={{
                      ...hexStyle,
                      width: 58,
                      textAlign: "right",
                      color: changed ? "#00e5ff" : "#cbd5e1",
                    }}
                    aria-label={`Band boundary ${bIdx} value in ${inputUnit}`}
                  />
                  <span style={{ ...labelStyle, fontSize: 9, color: "#475569", minWidth: 14 }}>
                    {inputUnit}
                  </span>
                </div>
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: changed ? "#00e5ff" : "transparent",
                    border: changed ? "none" : "1px solid rgba(0,229,255,0.15)",
                    flexShrink: 0,
                  }}
                  title={changed ? "Modified" : "Default"}
                  aria-hidden
                />
              </div>
            );
          })}

          {/* Fixed end boundary (read-only) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "90px 1fr auto",
              alignItems: "center",
              gap: 8,
              padding: "3px 0",
            }}
          >
            <span style={{ ...labelStyle, fontSize: 9, color: "#64748b", whiteSpace: "nowrap" }}>
              END (FIXED)
            </span>
            <span style={{ fontSize: 9, color: "#64748b", fontFamily: "inherit" }}>
              {formatDepth(OCEAN_MAX_DEPTH_FT * FT_TO_M_SETTINGS, { units })}
            </span>
            <span style={{ fontSize: 9, color: "#475569", minWidth: 20 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Depth Color Palette card — lets the user customise the shallow and deep
 * endpoints of the depth colormap. Changes apply live to the 3D terrain,
 * minimap heatmap, overview map heatmap, and HUD depth scale bar, and are
 * persisted to localStorage under "bathyscan:palette".
 */
function PalettePickerCard() {
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
    // colormapCanvas paints top→bottom; rotate -90° so shallow is on the left.
    // Render the active theme so the preview matches the 3D mesh tint
    // (including live edits to the Custom stops, band colours, and band boundaries).
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
    fontSize: 11,
    borderBottom: "1px solid rgba(0,229,255,0.06)",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 9,
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
    fontSize: 10,
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
                  // Always seed band colours from the preset so the per-band
                  // editor and the Ocean legend look correct after one click.
                  // Custom mode now also renders from bandColors, so one call
                  // covers both themes.
                  setBandColors(bandColorsFromPreset(preset));
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 8px 4px 4px",
                  background: isActive
                    ? "rgba(0,229,255,0.12)"
                    : "rgba(0,0,0,0.3)",
                  border: isActive
                    ? "1px solid rgba(0,229,255,0.55)"
                    : "1px solid rgba(0,229,255,0.18)",
                  borderRadius: 3,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: isActive ? "#67e8f9" : "#e2e8f0",
                  fontSize: 9,
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
          {/* Shallow picker (Ocean theme) */}
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
                  else if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
                    // allow typing intermediate values without committing
                    const el = e.target;
                    el.value = v;
                  }
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

          {/* Deep picker (Ocean theme) */}
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

          {/* Per-band editor — only for Ocean theme */}
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
            fontSize: 9,
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

/**
 * Custom palette band-colour editor — 10 fixed rows, one per depth band,
 * labelled with their depth range and each holding a colour picker. Edits
 * flow through paletteStore.setBandColor and re-tint the 3D mesh live.
 *
 * Boundaries are the same fixed DEFAULT_BAND_BOUNDARIES used by the Ocean
 * theme; only the colour for each band is user-editable here.
 */
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
              style={{
                display: "grid",
                gridTemplateColumns: "90px auto 1fr",
                alignItems: "center",
                gap: 8,
                padding: "5px 0",
                borderBottom: "1px solid rgba(0,229,255,0.05)",
              }}
            >
              <span
                style={{
                  ...labelStyle,
                  fontSize: 9,
                  letterSpacing: "0.05em",
                  color: "#cbd5e1",
                  whiteSpace: "nowrap",
                }}
              >
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
                onCommit={(hex) => {
                  setBandColor(i, hex);
                  // Flush immediately so the updated bandColors reaches the
                  // server regardless of which colormapTheme is active.
                  // The global sync hook always includes bandColors in the
                  // PUT /api/settings payload, but an explicit flush here
                  // mirrors the DepthBandColorEditor reset behaviour and
                  // makes the intent unambiguous.
                  void flushServerSync();
                }}
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
