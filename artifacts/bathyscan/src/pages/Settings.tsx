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
import { useGetSettings, usePutSettings, useDeleteMarkersMine, getGetSettingsQueryKey } from "@workspace/api-client-react";
import type { Marker } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

// Undo window for "soft" bulk-marker deletes (ms). The active dataset's
// marker list is cleared from the cache immediately and the actual DELETE
// only fires when the window elapses, so a misclick can be reverted by
// clicking "Undo".
const UNDO_DELETE_WINDOW_MS = 5000;
import {
  useSettingsStore,
  useSectionDirty,
  useAnySectionDirty,
  getDataSnapshot,
  SETTINGS_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_CROSSHAIR_MENU_GAMEPAD_BUTTON,
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
import { AdvancedDisclosure } from "@/components/AdvancedDisclosure";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMarkersQueryKey } from "@workspace/api-client-react";
import { useTerrainStore } from "@/lib/terrainStore";
import { usePaletteStore, DEFAULT_SHALLOW, DEFAULT_DEEP, PALETTE_PRESETS, MID1_HEX, MID2_HEX, customStopsFromPreset, type CustomStop } from "@/lib/paletteStore";
import { colormapCanvas, colormapCssGradient } from "@/lib/colormap";
import type { ColormapTheme } from "@/lib/settingsStore";
import { HelpIcon } from "@/components/help/HelpButton";

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

const S = {
  page: {
    minHeight: "100dvh",
    background: "#040810",
    color: "#94a3b8",
    fontFamily: FONT,
    display: "flex",
    flexDirection: "column",
  } as React.CSSProperties,

  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "10px 20px",
    borderBottom: "1px solid rgba(0,229,255,0.12)",
    background: "rgba(4,8,16,0.9)",
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
    borderRight: "1px solid rgba(0,229,255,0.1)",
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
    background: active ? "rgba(0,229,255,0.08)" : "none",
    border: "none",
    borderLeft: active ? "2px solid #00e5ff" : "2px solid transparent",
    padding: "8px 16px",
    fontSize: 9,
    letterSpacing: "0.2em",
    color: active ? "#00e5ff" : "#475569",
    cursor: "pointer",
    fontFamily: FONT,
    transition: "color 0.1s, background 0.1s",
  }),

  sectionTitle: {
    fontSize: 9,
    letterSpacing: "0.25em",
    color: "#00e5ff",
    fontWeight: 700,
    textShadow: "0 0 6px rgba(0,229,255,0.4)",
    marginBottom: 16,
    marginTop: 0,
  } as React.CSSProperties,

  card: {
    background: "rgba(0,10,20,0.7)",
    border: "1px solid rgba(0,229,255,0.12)",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 16,
  } as React.CSSProperties,

  cardHeader: {
    padding: "10px 16px",
    borderBottom: "1px solid rgba(0,229,255,0.08)",
    fontSize: 8,
    letterSpacing: "0.2em",
    color: "#64748b",
    fontWeight: 700,
  } as React.CSSProperties,

  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderBottom: "1px solid rgba(0,229,255,0.05)",
    fontSize: 11,
    gap: 12,
  } as React.CSSProperties,

  label: { color: "#94a3b8", flexShrink: 0 } as React.CSSProperties,

  sublabel: {
    fontSize: 9,
    color: "#475569",
    marginTop: 2,
    letterSpacing: "0.05em",
  } as React.CSSProperties,

  select: {
    background: "rgba(0,10,20,0.8)",
    border: "1px solid rgba(0,229,255,0.2)",
    borderRadius: 4,
    color: "#e2e8f0",
    fontSize: 10,
    padding: "4px 8px",
    fontFamily: FONT,
    cursor: "pointer",
    outline: "none",
  } as React.CSSProperties,

  slider: {
    accentColor: "#00e5ff",
    cursor: "pointer",
    width: 120,
  } as React.CSSProperties,

  toggle: (on: boolean): React.CSSProperties => ({
    position: "relative",
    display: "inline-block",
    width: 36,
    height: 20,
    background: on ? "rgba(0,229,255,0.3)" : "rgba(30,58,95,0.4)",
    border: `1px solid ${on ? "rgba(0,229,255,0.5)" : "rgba(0,229,255,0.15)"}`,
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
    background: on ? "#00e5ff" : "#475569",
    borderRadius: "50%",
    transition: "left 0.15s, background 0.15s",
    boxShadow: on ? "0 0 6px rgba(0,229,255,0.6)" : "none",
  }),

  dangerCard: {
    background: "rgba(239,68,68,0.04)",
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
    color: "#f87171",
    fontWeight: 700,
  } as React.CSSProperties,

  dangerBtn: {
    background: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: 4,
    color: "#f87171",
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
  const paletteVersion = usePaletteStore((s) => `${s.shallow}|${s.deep}`);
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
          <span style={{ color: "#64748b", fontSize: 16, lineHeight: 1 }}>{open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <ul
            role="listbox"
            aria-label={label}
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              zIndex: 50,
              listStyle: "none",
              margin: 0,
              padding: 4,
              background: "rgba(0,10,20,0.96)",
              border: "1px solid rgba(0,229,255,0.25)",
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
        <span style={{ color: "#64748b", fontSize: 10, minWidth: 64, textAlign: "right" }}>
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

function SectionSaveButton({ section }: { section: SettingsSection }) {
  const dirty = useSectionDirty(section);
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
          data-testid={`save-section-${section}-error`}
          style={{ fontSize: 9, color: "#f87171", letterSpacing: "0.1em" }}
        >
          {errMsg}
        </span>
      )}
      <button
        data-testid={`save-section-${section}-btn`}
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
  withReset = true,
  withSave = true,
}: {
  section: SettingsSection;
  withReset?: boolean;
  withSave?: boolean;
}) {
  const resetSection = useSettingsStore((s) => s.resetSection);
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
      {withReset && (
        <button
          onClick={() => resetSection(section)}
          data-testid={`reset-section-${section}-btn`}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.15)",
            borderRadius: 3,
            color: "#64748b",
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
      {withSave && <SectionSaveButton section={section} />}
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

// ─── Section components ───────────────────────────────────────────────────────
function VisualsSection() {
  const s = useSettingsStore();
  return (
    <>
      <SectionTitle helpId="settings" helpLabel="Visuals & Performance">◈ VISUALS &amp; PERFORMANCE</SectionTitle>
      <SectionActionsRow section="visuals" />
      <div style={S.card}>
        <div style={S.cardHeader}>QUALITY PRESET</div>
        <SelectRow
          label="Preset"
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
          sublabel="Applies a bundle of visual settings. Tweaking individual knobs switches to Custom."
        />
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
        <ToggleRow
          label="Caustics Effect"
          value={s.enableCaustics}
          onChange={s.setEnableCaustics}
          sublabel="Light refraction pattern overlay"
        />
        <ColormapSelectRow
          label="Depth Colormap"
          value={s.colormapTheme}
          onChange={s.setColormapTheme}
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
      </div>
      <PalettePickerCard />
      <AdvancedDisclosure testId="visuals-advanced">
        <div style={S.card}>
          <div style={S.cardHeader}>PARTICLES &amp; TEXTURES</div>
          <SelectRow
            label="Marine Snow Density"
            value={s.particleDensity}
            onChange={s.setParticleDensity}
            options={[{ value: "off", label: "Off" }, { value: "sparse", label: "Sparse (500)" }, { value: "dense", label: "Dense (2000)" }]}
          />
          <SelectRow
            label="Texture Quality"
            value={s.textureQuality}
            onChange={s.setTextureQuality}
            options={[{ value: "off", label: "Off" }, { value: "low", label: "Low" }, { value: "high", label: "High" }]}
          />
          <ToggleRow
            label="Antialiasing"
            value={s.antialiasing}
            onChange={s.setAntialiasing}
            sublabel="MSAA edge smoothing (page reload to apply)"
          />
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}>LIGHTING &amp; FOG</div>
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
          <SliderRow
            label="Ambient Light Intensity"
            value={s.ambientLightIntensity}
            min={0} max={1} step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={s.setAmbientLightIntensity}
          />
          <SliderRow
            label="Directional Light Intensity"
            value={s.directionalLightIntensity}
            min={0} max={1.5} step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={s.setDirectionalLightIntensity}
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
            label="Spawn Position"
            value={s.cameraSpawnBehaviour}
            onChange={s.setCameraSpawnBehaviour}
            options={[
              { value: "deepest", label: "Deepest point" },
              { value: "home", label: "Saved home position" },
              { value: "last", label: "Last position" },
            ]}
            sublabel="Where to place camera when loading a dataset"
          />
          <SelectRow
            label="On-Screen Joystick (touch)"
            value={s.joystickMode}
            onChange={s.setJoystickMode}
            options={[
              { value: "auto", label: "Auto (touch only)" },
              { value: "always", label: "Always on" },
              { value: "off", label: "Off" },
            ]}
            sublabel="Virtual joystick visibility"
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
          <ToggleRow label="Compass / Minimap" value={s.showCompassMinimap} onChange={s.setShowCompassMinimap} />
          <ToggleRow label="Controls Legend" value={s.showControlsLegend} onChange={s.setShowControlsLegend} sublabel="Keyboard/mouse cheat sheet overlay" />
          <ToggleRow label="Tide &amp; Currents Panel" value={s.showTidePanel} onChange={s.setShowTidePanel} />
          <ToggleRow label="Habitat Panel" value={s.showHabitatPanel} onChange={s.setShowHabitatPanel} />
          <ToggleRow label="Dataset Selector" value={s.showDatasetPanel} onChange={s.setShowDatasetPanel} />
          <ToggleRow label="Natural-Language Query" value={s.showQueryPanel} onChange={s.setShowQueryPanel} />
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
          />
        </div>
      </AdvancedDisclosure>
    </>
  );
}

function UnitsSection() {
  const s = useSettingsStore();

  return (
    <>
      <h2 style={S.sectionTitle}>◈ UNITS</h2>
      <SectionActionsRow section="hud" />
      <div style={S.card}>
        <div style={S.cardHeader}>MEASUREMENT SYSTEM</div>
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
    </>
  );
}

function OverviewSection() {
  const s = useSettingsStore();
  return (
    <>
      <h2 style={S.sectionTitle}>◈ OVERVIEW MAP</h2>
      <SectionActionsRow section="overview" withReset={false} />
      <div style={S.card}>
        <div style={S.cardHeader}>MAP DISPLAY</div>
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

function MarkersSection() {
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
      <SectionTitle helpId="markers" helpLabel="Markers">◈ MARKERS</SectionTitle>
      <SectionActionsRow section="markers" />
      <div style={S.card}>
        <div style={S.cardHeader}>VISIBILITY</div>
        <ToggleRow label="Show Marker Labels" value={s.showMarkerLabels} onChange={s.setShowMarkerLabels} sublabel="Name text below marker sprites" />
        <ToggleRow label="Private Markers" value={s.privateMarkers} onChange={s.setPrivateMarkers} sublabel="Only show your own markers" />
      </div>
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
      <div style={S.card}>
        <div style={S.cardHeader}>DEFAULTS</div>
        <SelectRow
          label="Default Marker Type"
          value={s.defaultMarkerType}
          onChange={s.setDefaultMarkerType}
          options={MARKER_TYPE_OPTIONS}
          sublabel="Pre-selected when opening the marker form"
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
      </AdvancedDisclosure>
    </>
  );
}

function TidalSection() {
  const s = useSettingsStore();
  return (
    <>
      <h2 style={S.sectionTitle}>◈ TIDAL DEFAULTS</h2>
      <SectionActionsRow section="tidal" />
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
      <AdvancedDisclosure testId="tidal-advanced">
        <div style={S.card}>
          <div style={S.cardHeader}>VISUALISATION</div>
          <SelectRow
            label="Current Arrow Density"
            value={s.currentArrowDensity}
            onChange={s.setCurrentArrowDensity}
            options={[
              { value: "sparse", label: "Sparse" },
              { value: "normal", label: "Normal" },
              { value: "dense", label: "Dense" },
            ]}
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
      </AdvancedDisclosure>
    </>
  );
}

function CurrentsSection() {
  const s = useSettingsStore();
  return (
    <>
      <h2 style={S.sectionTitle}>◈ BATHYMETRIC CURRENTS</h2>
      <SectionActionsRow section="currents" />
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
      </div>
      <div style={S.card}>
        <div style={S.cardHeader}>MANUAL AMBIENT</div>
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
      <AdvancedDisclosure testId="currents-advanced">
        <div style={S.card}>
          <div style={S.cardHeader}>VISUALISATION LAYERS</div>
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

function HabitatSection() {
  const s = useSettingsStore();
  return (
    <>
      <SectionTitle helpId="ai-assistant" helpLabel="Habitat Defaults">◈ HABITAT DEFAULTS</SectionTitle>
      <SectionActionsRow section="habitat" />
      <div style={S.card}>
        <div style={S.cardHeader}>BEHAVIOUR</div>
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
      <AdvancedDisclosure testId="habitat-advanced">
        <div style={S.card}>
          <div style={S.cardHeader}>DEFAULTS</div>
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

function GpsSection() {
  const s = useSettingsStore();
  return (
    <>
      <h2 style={S.sectionTitle}>◈ GPS &amp; TRAIL</h2>
      <SectionActionsRow section="gps" />
      <div style={S.card}>
        <div style={S.cardHeader}>RECORDING</div>
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
      <AdvancedDisclosure testId="gps-advanced">
        <div style={S.card}>
          <div style={S.cardHeader}>RETENTION</div>
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
        <ToggleRow
          label="Large HUD Text"
          value={s.largeHudText}
          onChange={s.setLargeHudText}
          sublabel="Increase HUD font size"
        />
        <ToggleRow
          label="High-Contrast HUD"
          value={s.highContrastHud}
          onChange={s.setHighContrastHud}
          sublabel="Stronger text/background contrast"
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
      <div style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.15em", marginBottom: 8 }}>
        GLOBAL RESET
      </div>
      <div style={{ fontSize: 10, color: "#475569", marginBottom: 12 }}>
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
              color: "#64748b",
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
            color: isDefault ? "#334155" : "#64748b",
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
            color: "#64748b",
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
            color: "#64748b",
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
            color: allDefault ? "#334155" : "#67e8f9",
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
              <span style={{ color: "#94a3b8" }}>{sh.desc}</span>
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

function DatasetSection() {
  const s = useSettingsStore();
  return (
    <>
      <SectionTitle helpId="datasets-uploads" helpLabel="Data & Storage">◈ DATA &amp; STORAGE</SectionTitle>
      <SectionActionsRow section="data" />
      <div style={S.card}>
        <div style={S.cardHeader}>DEFAULTS</div>
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
    </>
  );
}

function EnvironmentSection() {
  const s = useSettingsStore();
  return (
    <>
      <h2 style={S.sectionTitle}>≈ ENVIRONMENT</h2>
      <SectionActionsRow section="environment" withReset={false} />
      <div style={S.card}>
        <div style={S.cardHeader}>WATER TYPE</div>
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
                    color: active ? color : "#475569",
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
      </div>
      <div style={S.card}>
        <div style={S.cardHeader}>CURRENT MODE</div>
        <div style={{ padding: "12px 16px", fontSize: 10, color: "#64748b", lineHeight: 1.7 }}>
          {s.waterType === "freshwater" ? (
            <>
              <div style={{ color: "#4ade80", fontWeight: 700, marginBottom: 6, fontSize: 9, letterSpacing: "0.1em" }}>
                ~ FRESHWATER MODE
              </div>
              <div>Freshwater datasets (lakes, reservoirs) are shown in the dataset list.</div>
              <div>Habitat panel shows freshwater species (Rainbow Trout, Walleye, Bass, Crayfish…).</div>
              <div>Marker types include vegetation and submerged log options.</div>
              <div>AI assistant uses freshwater limnology context.</div>
            </>
          ) : (
            <>
              <div style={{ color: "#00e5ff", fontWeight: 700, marginBottom: 6, fontSize: 9, letterSpacing: "0.1em" }}>
                ≈ SALTWATER MODE
              </div>
              <div>Ocean datasets (trenches, ridges, basins) are shown in the dataset list.</div>
              <div>Habitat panel shows marine species (Dungeness Crab, Rockfish…).</div>
              <div>Marker types include coral, hydrothermal vent, and shipwreck options.</div>
              <div>AI assistant uses marine geology context.</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function OfflineSection() {
  const [cached, setCached] = useState<CachedDataset[]>([]);
  const [pending, setPending] = useState({ markers: 0, trails: 0 });
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState<string | null>(null);
  const [allClearedMsg, setAllClearedMsg] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, p] = await Promise.all([listCachedDatasets(), countPendingItems()]);
    setCached(c);
    setPending(p);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

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

  return (
    <>
      <SectionTitle helpId="troubleshooting" helpLabel="Offline & Storage">◈ OFFLINE &amp; STORAGE</SectionTitle>
      <div style={S.card}>
        <div style={S.cardHeader}>CACHED TERRAIN DATA</div>
        <div style={{ padding: "12px 16px" }}>
          {loading ? (
            <div style={{ fontSize: 10, color: "#334155" }}>◌ Loading…</div>
          ) : cached.length === 0 ? (
            <div data-testid="no-cache-msg" style={{ fontSize: 10, color: "#334155" }}>
              No terrain data cached. Load a dataset to cache it.
            </div>
          ) : (
            cached.map((entry) => (
              <div key={entry.url} data-testid="cache-entry" style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 0", borderBottom: "1px solid rgba(0,229,255,0.06)", fontSize: 10,
              }}>
                <div>
                  <span style={{ color: "#64748b" }}>{entry.label}</span>
                  {entry.sizeKb !== null && (
                    <span style={{ color: "#334155", marginLeft: 8 }}>
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
          <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "#475569" }}>PENDING SYNC</div>
          <div style={{ fontSize: 10 }}>
            <span style={{ color: "#64748b" }}>Markers: </span>
            <span data-testid="pending-markers-count" style={{ color: pending.markers > 0 ? "#fbbf24" : "#334155" }}>
              {pending.markers}
            </span>
            <span style={{ color: "#64748b", marginLeft: 16 }}>Trails: </span>
            <span style={{ color: pending.trails > 0 ? "#fbbf24" : "#334155" }}>
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
    </>
  );
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bathyscan-settings-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bathyscan-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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
                color: "#94a3b8",
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
              color: "#64748b",
              fontFamily: "'JetBrains Mono', monospace",
            }}
            data-testid="last-synced-row"
          >
            LAST SYNCED:{" "}
            <span style={{ color: lastSyncedAt ? "#94a3b8" : "#475569" }}>
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
      <div style={S.card}>
        <div style={S.cardHeader}>SETTINGS BACKUP</div>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 12 }}>
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
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 12 }}>
            Export a copy of all your settings, markers, custom datasets, and GPS trails as JSON.
          </div>
          {accountMsg && (
            <div style={{ fontSize: 9, color: accountMsg.startsWith("✓") ? "#4ade80" : "#f87171", letterSpacing: "0.12em", marginBottom: 8 }}>
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
      <div style={S.dangerCard}>
        <div style={S.dangerHeader}>⚠ DANGER ZONE</div>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 12 }}>
            Permanently delete all markers you have created. This cannot be undone.
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
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 10, color: "#f87171" }}>Are you sure?</span>
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
                  color: "#64748b",
                  border: "1px solid rgba(100,116,139,0.3)",
                  background: "none",
                }}
              >
                CANCEL
              </button>
            </div>
          )}
        </div>
        <div style={{ padding: "14px 16px", borderTop: "1px solid rgba(239,68,68,0.12)" }}>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 12 }}>
            Permanently delete <strong style={{ color: "#f87171" }}>all</strong> of your data
            — settings, markers, custom datasets, GPS trails. This cannot be undone.
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
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 10, color: "#f87171" }}>Permanently delete everything?</span>
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
                  color: "#64748b",
                  border: "1px solid rgba(100,116,139,0.3)",
                  background: "none",
                }}
              >
                CANCEL
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Nav tabs ─────────────────────────────────────────────────────────────────
type Tab =
  | "visuals" | "navigation" | "hud" | "units" | "overview" | "markers"
  | "tidal" | "currents" | "habitat" | "gps" | "dataset" | "offline"
  | "accessibility" | "shortcuts" | "account" | "environment";

const NAV_TABS: { id: Tab; label: string }[] = [
  { id: "visuals", label: "VISUALS & PERF" },
  { id: "navigation", label: "CAMERA & CTRL" },
  { id: "hud", label: "HUD & LAYOUT" },
  { id: "units", label: "UNITS" },
  { id: "overview", label: "OVERVIEW MAP" },
  { id: "markers", label: "MARKERS" },
  { id: "tidal", label: "TIDAL" },
  { id: "currents", label: "CURRENTS" },
  { id: "habitat", label: "HABITAT" },
  { id: "gps", label: "GPS & TRAIL" },
  { id: "dataset", label: "DATA & STORAGE" },
  { id: "environment", label: "ENVIRONMENT" },
  { id: "offline", label: "OFFLINE CACHE" },
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrateFromServer = useSettingsStore((s) => s.hydrateFromServer);

  // Load settings from server on mount (authenticated only). Force a fresh
  // fetch on every mount so opening Settings on a different device pulls the
  // latest server state instead of relying on react-query's in-memory cache.
  const { data: serverSettings } = useGetSettings({
    query: {
      enabled: !!isSignedIn,
      retry: false,
      queryKey: getGetSettingsQueryKey(),
      refetchOnMount: "always",
      staleTime: 0,
    },
  });

  useEffect(() => {
    if (!serverSettings) return;
    // Recency check matches settingsStore.hydrateFromServer: the server wins
    // only when its `__updatedAt` is newer than the last local sync (or when
    // we've never synced). We evaluate it here BEFORE calling the settings
    // hydrator (which mutates lastSyncedAt) so we can apply the same rule to
    // the separate paletteStore.
    const serverRec = serverSettings as Record<string, unknown>;
    const serverUpdatedAt =
      typeof serverRec.__updatedAt === "string" ? (serverRec.__updatedAt as string) : undefined;
    const lastSyncedAt = useSettingsStore.getState().lastSyncedAt;
    const serverIsNewer =
      !lastSyncedAt || (serverUpdatedAt !== undefined && serverUpdatedAt > lastSyncedAt);

    hydrateFromServer(serverSettings as Parameters<typeof hydrateFromServer>[0]);

    if (serverIsNewer) {
      usePaletteStore.getState().hydrateFromServer({
        paletteShallow: serverRec.paletteShallow,
        paletteDeep: serverRec.paletteDeep,
        customStops: serverRec.customStops,
      });
    }
  }, [serverSettings, hydrateFromServer]);

  // Debounced PUT /api/settings
  const { mutateAsync: saveSettingsAsync } = usePutSettings();
  const markAllSaved = useSettingsStore((s) => s.markAllSaved);

  const buildPayload = useCallback(() => {
    const { hydrateFromServer: _h, resetSection: _rs, resetAll: _ra,
      markAllSaved: _mas,
      setDatasetHome: _sd, clearDatasetHome: _cd, datasetHomePositions: _dhp,
      syncedSnapshot: _ss,
      ...rest } = useSettingsStore.getState();
    const dataOnly: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (typeof v !== "function") dataOnly[k] = v;
    }
    // Palette state lives in a separate zustand store but syncs through the
    // same /api/settings endpoint so users get one canonical record of their
    // visual preferences across devices.
    const palette = usePaletteStore.getState();
    dataOnly.paletteShallow = palette.shallow;
    dataOnly.paletteDeep = palette.deep;
    dataOnly.customStops = palette.customStops;
    return dataOnly;
  }, []);

  const flashSavedMsg = useCallback(() => {
    setSavedMsg(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedMsg(false), 2000);
  }, []);

  /**
   * Force-flush any pending debounced sync. Returns a promise that resolves
   * on a successful PUT (or immediately when signed out — localStorage
   * persistence already happened synchronously via zustand). Rejects on
   * network/server errors so the caller can show an error state.
   */
  const flushSync = useCallback(async (): Promise<void> => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!isSignedIn) {
      // Local-only save — already persisted to localStorage by zustand.
      // Pass `null` so the "Last synced" indicator stays empty for
      // signed-out users (there's no server to sync with).
      markAllSaved(null);
      flashSavedMsg();
      return;
    }
    const data = buildPayload();
    const resp = await saveSettingsAsync({
      data: data as Parameters<typeof saveSettingsAsync>[0]["data"],
    });
    const serverStamp = (resp as Record<string, unknown> | undefined)?.__updatedAt;
    markAllSaved(typeof serverStamp === "string" ? serverStamp : undefined);
    flashSavedMsg();
  }, [isSignedIn, saveSettingsAsync, markAllSaved, flashSavedMsg, buildPayload]);

  const scheduleSync = useCallback(() => {
    if (!isSignedIn) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Auto-sync swallows errors here — manual Save surfaces them.
      void flushSync().catch(() => { /* keep dirty so user sees Save button */ });
    }, 300);
  }, [isSignedIn, flushSync]);

  // Subscribe to data-only changes (ignore syncedSnapshot updates) to avoid
  // an infinite save loop once markAllSaved fires inside flushSync. Also
  // watch the separate paletteStore so palette edits ride the same debounced
  // PUT /api/settings as the rest of the visual preferences.
  useEffect(() => {
    const palSnap = () => {
      const p = usePaletteStore.getState();
      return JSON.stringify({ s: p.shallow, d: p.deep, c: p.customStops });
    };
    let lastSettings = JSON.stringify(getDataSnapshot());
    let lastPalette = palSnap();
    const unsubSettings = useSettingsStore.subscribe(() => {
      const cur = JSON.stringify(getDataSnapshot());
      if (cur !== lastSettings) {
        lastSettings = cur;
        scheduleSync();
      }
    });
    const unsubPalette = usePaletteStore.subscribe(() => {
      const cur = palSnap();
      if (cur !== lastPalette) {
        lastPalette = cur;
        scheduleSync();
      }
    });
    return () => {
      unsubSettings();
      unsubPalette();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, [scheduleSync]);

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
    <div style={S.page}>
      {/* Top bar */}
      <div style={S.topbar}>
        <button
          onClick={handleBack}
          title={shouldGuard ? "Saving unsaved changes before leaving…" : undefined}
          data-testid="settings-back-btn"
          data-unsaved={shouldGuard ? "true" : "false"}
          style={{ background: "none", border: "none", color: shouldGuard ? "#fbbf24" : "#475569", cursor: "pointer", fontSize: 11, letterSpacing: "0.15em", padding: 0, fontFamily: FONT, display: "flex", alignItems: "center", gap: 8 }}
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
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b", letterSpacing: "0.1em", cursor: "pointer" }}>
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
            <span style={{ color: "#334155", letterSpacing: "0.1em" }}>synced to cloud</span>
          )}
          <span style={{ color: "#334155", letterSpacing: "0.1em" }} title={`schema v${SETTINGS_SCHEMA_VERSION}`}>
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
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div style={S.content}>
          {tab === "visuals" && <VisualsSection />}
          {tab === "navigation" && <NavigationSection />}
          {tab === "hud" && <HUDSection />}
          {tab === "units" && <UnitsSection />}
          {tab === "overview" && <OverviewSection />}
          {tab === "markers" && <MarkersSection />}
          {tab === "tidal" && <TidalSection />}
          {tab === "currents" && <CurrentsSection />}
          {tab === "habitat" && <HabitatSection />}
          {tab === "gps" && <GpsSection />}
          {tab === "dataset" && <DatasetSection />}
          {tab === "environment" && <EnvironmentSection />}
          {tab === "offline" && <OfflineSection />}
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
  const customStops = usePaletteStore((s) => s.customStops);
  const setCustomStops = usePaletteStore((s) => s.setCustomStops);
  const addCustomStop = usePaletteStore((s) => s.addCustomStop);
  const removeCustomStop = usePaletteStore((s) => s.removeCustomStop);
  const updateCustomStop = usePaletteStore((s) => s.updateCustomStop);
  const resetCustomStops = usePaletteStore((s) => s.resetCustomStops);

  const colormapTheme = useSettingsStore((s) => s.colormapTheme);
  const isCustom = colormapTheme === "custom";

  const previewRef = React.useRef<HTMLImageElement>(null);
  React.useEffect(() => {
    if (!previewRef.current) return;
    // colormapCanvas paints top→bottom; rotate -90° so shallow is on the left.
    // Render the active theme so the preview matches the 3D mesh tint
    // (including live edits to the Custom stops).
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
  }, [shallow, deep, customStops, colormapTheme]);

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
    color: "#475569",
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
    color: "#64748b",
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
                  // In Custom mode, seed the editable stops with the preset's
                  // shape so the user can fine-tune from there.
                  if (isCustom) setCustomStops(customStopsFromPreset(preset));
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
                  color: isActive ? "#67e8f9" : "#94a3b8",
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
        </>
      )}

      {isCustom && (
        <CustomStopsEditor
          stops={customStops}
          onUpdate={updateCustomStop}
          onRemove={removeCustomStop}
          onAdd={addCustomStop}
          labelStyle={labelStyle}
          hexStyle={hexStyle}
          colorInputStyle={colorInputStyle}
        />
      )}

      {/* Reset */}
      <div style={{ padding: "10px 16px 14px", display: "flex", justifyContent: "flex-end" }}>
        <button
          data-testid="palette-reset-btn"
          onClick={() => {
            if (isCustom) resetCustomStops();
            else reset();
          }}
          disabled={!isCustom && isDefault}
          style={{
            background: "rgba(0,229,255,0.06)",
            border: "1px solid rgba(0,229,255,0.25)",
            borderRadius: 3,
            color: (!isCustom && isDefault) ? "#334155" : "#67e8f9",
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
 * Custom palette stop editor — list of rows with colour swatch + position
 * slider + remove button, plus an "Add stop" button. Edits flow through
 * paletteStore and re-tint the 3D mesh and preview gradient live.
 */
function CustomStopsEditor({
  stops, onUpdate, onRemove, onAdd, labelStyle, hexStyle, colorInputStyle,
}: {
  stops: CustomStop[];
  onUpdate: (i: number, patch: Partial<CustomStop>) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
  labelStyle: React.CSSProperties;
  hexStyle: React.CSSProperties;
  colorInputStyle: React.CSSProperties;
}) {
  const canRemove = stops.length > 2;
  return (
    <div style={{ padding: "6px 16px 8px" }} data-testid="palette-custom-editor">
      <div style={{ ...labelStyle, marginBottom: 6 }}>STOPS ({stops.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {stops.map((stop, i) => (
          <div
            key={i}
            data-testid={`palette-custom-stop-${i}`}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto auto auto",
              alignItems: "center",
              gap: 8,
              padding: "6px 0",
              borderBottom: "1px solid rgba(0,229,255,0.06)",
            }}
          >
            <input
              type="color"
              data-testid={`palette-custom-stop-${i}-color`}
              value={stop.hex}
              onChange={(e) => onUpdate(i, { hex: e.target.value })}
              style={colorInputStyle}
              aria-label={`Stop ${i + 1} colour`}
            />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              data-testid={`palette-custom-stop-${i}-position`}
              value={stop.position}
              onChange={(e) => onUpdate(i, { position: Number(e.target.value) })}
              style={{ width: "100%" }}
              aria-label={`Stop ${i + 1} position`}
            />
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              data-testid={`palette-custom-stop-${i}-percent`}
              value={Math.round(stop.position * 100)}
              onChange={(e) => {
                const pct = Number(e.target.value);
                if (Number.isFinite(pct)) {
                  onUpdate(i, { position: Math.max(0, Math.min(1, pct / 100)) });
                }
              }}
              style={{ ...hexStyle, width: 48 }}
              aria-label={`Stop ${i + 1} position percent`}
            />
            <span style={{ ...labelStyle, fontFamily: "inherit", color: "#64748b", minWidth: 22 }}>%</span>
            <button
              type="button"
              data-testid={`palette-custom-stop-${i}-remove`}
              onClick={() => onRemove(i)}
              disabled={!canRemove}
              title={canRemove ? "Remove stop" : "Minimum of 2 stops"}
              style={{
                background: "transparent",
                border: "1px solid rgba(0,229,255,0.2)",
                borderRadius: 3,
                color: canRemove ? "#67e8f9" : "#334155",
                fontSize: 11,
                width: 24,
                height: 24,
                cursor: canRemove ? "pointer" : "not-allowed",
                fontFamily: "inherit",
              }}
              aria-label={`Remove stop ${i + 1}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 8 }}>
        <button
          type="button"
          data-testid="palette-custom-add"
          onClick={onAdd}
          style={{
            background: "rgba(0,229,255,0.06)",
            border: "1px solid rgba(0,229,255,0.25)",
            borderRadius: 3,
            color: "#67e8f9",
            fontSize: 9,
            letterSpacing: "0.15em",
            padding: "4px 12px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          + ADD STOP
        </button>
      </div>
    </div>
  );
}
