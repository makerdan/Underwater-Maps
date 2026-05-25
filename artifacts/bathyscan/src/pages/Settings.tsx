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
import { useUser, useClerk } from "@clerk/react";
import { keys as idbKeys, clear as idbClear } from "idb-keyval";
import { useGetSettings, usePutSettings, useDeleteMarkersMine, getGetSettingsQueryKey } from "@workspace/api-client-react";
import {
  useSettingsStore,
  DEFAULT_SETTINGS,
  type MarkerType,
} from "@/lib/settingsStore";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMarkersQueryKey } from "@workspace/api-client-react";
import { useTerrainStore } from "@/lib/terrainStore";
import { usePaletteStore, DEFAULT_SHALLOW, DEFAULT_DEEP } from "@/lib/paletteStore";
import { colormapCanvas } from "@/lib/colormap";

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
    padding: "20px 0",
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
      <h2 style={S.sectionTitle}>◈ VISUALS</h2>
      <div style={S.card}>
        <div style={S.cardHeader}>SCENE APPEARANCE</div>
        <SelectRow
          label="Texture Quality"
          value={s.textureQuality}
          onChange={s.setTextureQuality}
          options={[{ value: "off", label: "Off" }, { value: "low", label: "Low" }, { value: "high", label: "High" }]}
          sublabel="Affects mesh detail quality"
        />
        <ToggleRow
          label="Caustics Effect"
          value={s.enableCaustics}
          onChange={s.setEnableCaustics}
          sublabel="Light refraction pattern overlay"
        />
        <SelectRow
          label="Marine Snow"
          value={s.particleDensity}
          onChange={s.setParticleDensity}
          options={[{ value: "off", label: "Off" }, { value: "sparse", label: "Sparse (500)" }, { value: "dense", label: "Dense (2000)" }]}
          sublabel="Floating particle density"
        />
        <SelectRow
          label="Depth Colormap"
          value={s.colormapTheme}
          onChange={s.setColormapTheme}
          options={[
            { value: "ocean", label: "Ocean (blue)" },
            { value: "thermal", label: "Thermal (purple→white)" },
            { value: "grayscale", label: "Grayscale" },
            { value: "viridis", label: "Viridis (purple→yellow)" },
          ]}
          sublabel="Terrain surface colour gradient"
        />
      </div>
      <PalettePickerCard />
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
        <SliderRow
          label="Lamp Intensity"
          value={s.lampIntensity}
          min={0} max={5} step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={s.setLampIntensity}
          sublabel="Camera-attached point light"
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
      </div>
    </>
  );
}

function NavigationSection() {
  const s = useSettingsStore();
  const { setDefaultSpeedTier, setInvertMouseY, setMouseSensitivity, setCameraSpawnBehaviour } = s;
  return (
    <>
      <h2 style={S.sectionTitle}>◈ NAVIGATION</h2>
      <div style={S.card}>
        <div style={S.cardHeader}>FLY MODE</div>
        <SliderRow
          label="Mouse Sensitivity"
          value={s.mouseSensitivity}
          min={0.1} max={3.0} step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={setMouseSensitivity}
          sublabel="Multiplier applied to look rotation"
        />
        <ToggleRow
          label="Invert Mouse Y"
          value={s.invertMouseY}
          onChange={setInvertMouseY}
          sublabel="Flip vertical look direction"
        />
        <div style={S.row}>
          <div>
            <div style={S.label}>Default Speed Tier</div>
            <div style={S.sublabel}>0 = slowest, 4 = fastest</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="range" min={0} max={4} step={1} value={s.defaultSpeedTier}
              onChange={(e) => setDefaultSpeedTier(Number(e.target.value))}
              style={S.slider}
            />
            <span style={{ color: "#00e5ff", fontSize: 10, minWidth: 24, textAlign: "center" }}>
              {s.defaultSpeedTier}
            </span>
          </div>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.cardHeader}>CAMERA SPAWN</div>
        <SelectRow
          label="Spawn Position"
          value={s.cameraSpawnBehaviour}
          onChange={setCameraSpawnBehaviour}
          options={[
            { value: "deepest", label: "Deepest point" },
            { value: "home", label: "Saved home position" },
            { value: "last", label: "Last position" },
          ]}
          sublabel="Where to place camera when loading a dataset"
        />
      </div>
    </>
  );
}

function HUDSection() {
  const s = useSettingsStore();
  return (
    <>
      <h2 style={S.sectionTitle}>◈ HUD</h2>
      <div style={S.card}>
        <div style={S.cardHeader}>VISIBILITY</div>
        <ToggleRow label="Crosshair GPS" value={s.showCrosshairGps} onChange={s.setShowCrosshairGps} sublabel="Centre-screen target coordinates" />
        <ToggleRow label="Camera Position" value={s.showCameraPosition} onChange={s.setShowCameraPosition} sublabel="Bottom-left LON/LAT/DEPTH panel" />
        <ToggleRow label="Speed Indicator" value={s.showSpeedIndicator} onChange={s.setShowSpeedIndicator} sublabel="Speed dots or MPH display" />
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
        <SelectRow
          label="Depth Unit"
          value={s.depthUnit}
          onChange={s.setDepthUnit}
          options={[{ value: "metres", label: "Metres (m)" }, { value: "feet", label: "Feet (ft)" }]}
        />
        <SliderRow
          label="HUD Opacity"
          value={s.hudOpacity}
          min={0.3} max={1.0} step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={s.setHudOpacity}
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

const MARKER_TYPE_OPTIONS: { value: MarkerType; label: string }[] = [
  { value: "fish", label: "🐟 Fish" },
  { value: "shipwreck", label: "⚓ Shipwreck" },
  { value: "coral", label: "🪸 Coral" },
  { value: "vent", label: "🌋 Vent" },
  { value: "custom", label: "📍 Custom" },
];

function MarkersSection() {
  const s = useSettingsStore();

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
      <h2 style={S.sectionTitle}>◈ MARKERS</h2>
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
    </>
  );
}

function DatasetSection() {
  const s = useSettingsStore();
  return (
    <>
      <h2 style={S.sectionTitle}>◈ DATASET</h2>
      <div style={S.card}>
        <div style={S.cardHeader}>DEFAULTS</div>
        <SelectRow
          label="Default Region"
          value={s.defaultRegion}
          onChange={s.setDefaultRegion}
          options={[
            { value: "mariana-trench", label: "Mariana Trench" },
            { value: "mid-atlantic-ridge", label: "Mid-Atlantic Ridge" },
            { value: "monterey-canyon", label: "Monterey Canyon" },
          ]}
          sublabel="Dataset loaded when the app starts"
        />
      </div>
      <div style={S.card}>
        <div style={S.cardHeader}>GPS RECORDING</div>
        <SliderRow
          label="Recording Interval"
          value={s.gpsRecordingInterval / 1000}
          min={1} max={60} step={1}
          format={(v) => `${v}s`}
          onChange={(v) => s.setGpsRecordingInterval(v * 1000)}
          sublabel="Time between GPS track points"
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
              <div>Habitat panel shows freshwater species (Lake Trout, Walleye, Bass…).</div>
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
      <h2 style={S.sectionTitle}>◈ OFFLINE &amp; STORAGE</h2>
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
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { signOut } = useClerk();

  return (
    <>
      <h2 style={S.sectionTitle}>◈ ACCOUNT</h2>
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
        </div>
      )}
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
                  deleteAllMarkers.mutate();
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
      </div>
    </>
  );
}

// ─── Nav tabs ─────────────────────────────────────────────────────────────────
type Tab = "visuals" | "navigation" | "hud" | "overview" | "markers" | "dataset" | "offline" | "account" | "environment";

const NAV_TABS: { id: Tab; label: string }[] = [
  { id: "visuals", label: "VISUALS" },
  { id: "navigation", label: "NAVIGATION" },
  { id: "hud", label: "HUD" },
  { id: "overview", label: "OVERVIEW MAP" },
  { id: "markers", label: "MARKERS" },
  { id: "dataset", label: "DATASET" },
  { id: "environment", label: "ENVIRONMENT" },
  { id: "offline", label: "OFFLINE" },
  { id: "account", label: "ACCOUNT" },
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

  // Load settings from server on mount (authenticated only)
  const { data: serverSettings } = useGetSettings({
    query: {
      enabled: !!isSignedIn,
      retry: false,
      queryKey: getGetSettingsQueryKey(),
    },
  });

  useEffect(() => {
    if (serverSettings) {
      hydrateFromServer(serverSettings as Parameters<typeof hydrateFromServer>[0]);
    }
  }, [serverSettings, hydrateFromServer]);

  // Debounced PUT /api/settings
  const { mutate: saveSettings } = usePutSettings();

  const scheduleSync = useCallback(() => {
    if (!isSignedIn) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const state = useSettingsStore.getState();
      saveSettings(
        {
          data: {
            textureQuality: state.textureQuality,
            enableCaustics: state.enableCaustics,
            particleDensity: state.particleDensity,
            fogDensity: state.fogDensity,
            colormapTheme: state.colormapTheme === "freshwater" ? undefined : state.colormapTheme,
            lampIntensity: state.lampIntensity,
            defaultSpeedTier: state.defaultSpeedTier,
            invertMouseY: state.invertMouseY,
            mouseSensitivity: state.mouseSensitivity,
            cameraSpawnBehaviour: state.cameraSpawnBehaviour,
            showCrosshairGps: state.showCrosshairGps,
            showCameraPosition: state.showCameraPosition,
            showSpeedIndicator: state.showSpeedIndicator,
            showHeading: state.showHeading,
            coordinateFormat: state.coordinateFormat,
            depthUnit: state.depthUnit,
            hudOpacity: state.hudOpacity,
            overviewDefaultZoom: state.overviewDefaultZoom,
            overviewShowGrid: state.overviewShowGrid,
            overviewShowMarkers: state.overviewShowMarkers,
            overviewOpenOnLoad: state.overviewOpenOnLoad,
            visibleMarkerTypes: state.visibleMarkerTypes,
            showMarkerLabels: state.showMarkerLabels,
            privateMarkers: state.privateMarkers,
            defaultMarkerType: state.defaultMarkerType,
            defaultRegion: state.defaultRegion,
            gpsRecordingInterval: state.gpsRecordingInterval,
          },
        },
        {
          onSuccess: () => {
            setSavedMsg(true);
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
            savedTimerRef.current = setTimeout(() => setSavedMsg(false), 2000);
          },
        },
      );
    }, 300);
  }, [isSignedIn, saveSettings]);

  // Subscribe to store changes to trigger sync
  useEffect(() => {
    const unsub = useSettingsStore.subscribe(() => scheduleSync());
    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, [scheduleSync]);

  const handleReset = () => {
    const { hydrateFromServer: _, datasetHomePositions: _h, ...defaults } = {
      ...DEFAULT_SETTINGS,
      hydrateFromServer: null,
    };
    useSettingsStore.getState().hydrateFromServer(defaults as Partial<typeof DEFAULT_SETTINGS>);
    scheduleSync();
  };

  return (
    <div style={S.page}>
      {/* Top bar */}
      <div style={S.topbar}>
        <button
          onClick={() => setLocation(basePath + "/")}
          style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 11, letterSpacing: "0.15em", padding: 0, fontFamily: FONT }}
        >
          ← BACK
        </button>
        <span style={{ fontSize: 10, letterSpacing: "0.3em", color: "#00e5ff", fontWeight: 700, textShadow: "0 0 8px rgba(0,229,255,0.5)", flex: 1 }}>
          SETTINGS
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 9 }}>
          {savedMsg && (
            <span style={{ color: "#4ade80", letterSpacing: "0.15em" }}>✓ SAVED</span>
          )}
          {isSignedIn && !savedMsg && (
            <span style={{ color: "#334155", letterSpacing: "0.1em" }}>synced to cloud</span>
          )}
          <button
            onClick={handleReset}
            style={{ background: "none", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 3, color: "#475569", cursor: "pointer", fontSize: 9, letterSpacing: "0.15em", padding: "3px 10px", fontFamily: FONT }}
          >
            RESET DEFAULTS
          </button>
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
          {tab === "overview" && <OverviewSection />}
          {tab === "markers" && <MarkersSection />}
          {tab === "dataset" && <DatasetSection />}
          {tab === "environment" && <EnvironmentSection />}
          {tab === "offline" && <OfflineSection />}
          {tab === "account" && <AccountSection />}
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

  const previewRef = React.useRef<HTMLImageElement>(null);
  React.useEffect(() => {
    if (!previewRef.current) return;
    // colormapCanvas paints top→bottom; rotate -90° so shallow is on the left.
    const vert = colormapCanvas(14, 240);
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
  }, [shallow, deep]);

  const isDefault = shallow.toLowerCase() === DEFAULT_SHALLOW.toLowerCase()
    && deep.toLowerCase() === DEFAULT_DEEP.toLowerCase();

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

      {/* Reset */}
      <div style={{ padding: "10px 16px 14px", display: "flex", justifyContent: "flex-end" }}>
        <button
          data-testid="palette-reset-btn"
          onClick={reset}
          disabled={isDefault}
          style={{
            background: "rgba(0,229,255,0.06)",
            border: "1px solid rgba(0,229,255,0.25)",
            borderRadius: 3,
            color: isDefault ? "#334155" : "#67e8f9",
            fontSize: 9,
            letterSpacing: "0.15em",
            padding: "4px 12px",
            cursor: isDefault ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          RESET TO DEFAULTS
        </button>
      </div>
    </div>
  );
}
