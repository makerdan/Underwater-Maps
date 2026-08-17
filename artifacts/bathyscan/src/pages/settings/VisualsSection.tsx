import React, { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { useUiStore } from "@/lib/uiStore";
import { useIntertidal } from "@/lib/useIntertidal";
import { AdvancedDisclosure } from "@/components/AdvancedDisclosure";
import { S } from "./styles";
import { SectionTitle } from "./components/SectionTitle";
import { SectionActionsRow } from "./components/SyncContext";
import { SliderRow, ToggleRow, SelectRow, ColorRow, clampSlider } from "./components/RowWidgets";
import { Select } from "./components/Toggle";

function formatFt(v: number): string {
  return v % 1 === 0 ? v.toFixed(0) : v.toFixed(2);
}

function DatumOverrideRow({
  label,
  testId,
  overrideValue,
  stationValue,
  stationName,
  datumsStatus,
  onCommit,
}: {
  label: string;
  testId: string;
  overrideValue: number | null;
  stationValue: number | null;
  stationName: string | null;
  datumsStatus: string;
  onCommit: (v: number | null) => void;
}) {
  const [text, setText] = useState<string>(overrideValue === null ? "" : String(overrideValue));
  // Keep the input in sync when the override changes externally (reset, server sync).
  const prevOverride = useRef(overrideValue);
  useEffect(() => {
    if (prevOverride.current !== overrideValue) {
      prevOverride.current = overrideValue;
      setText(overrideValue === null ? "" : String(overrideValue));
    }
  }, [overrideValue]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      onCommit(null);
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n)) onCommit(n);
    else setText(overrideValue === null ? "" : String(overrideValue));
  };

  const sublabel =
    stationValue !== null && stationName
      ? `Station value: ${formatFt(stationValue)} ft above MLLW (${stationName}). Leave blank to use it.`
      : datumsStatus === "loading"
        ? "Resolving station datum from NOAA…"
        : stationName
          ? `No NOAA datum available for ${stationName} — enter a value manually.`
          : "No tide station selected — load a dataset to resolve one, or enter a value manually.";

  return (
    <div style={S.row}>
      <div>
        <div style={S.label}>{label}</div>
        <div style={S.sublabel} data-testid={`${testId}-sublabel`}>{sublabel}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          data-testid={testId}
          type="number"
          step="0.1"
          inputMode="decimal"
          value={text}
          placeholder={stationValue !== null ? formatFt(stationValue) : "—"}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          aria-label={label}
          style={{
            width: 88,
            background: "rgba(0,10,20,0.6)",
            border: "1px solid rgba(0,229,255,0.25)",
            borderRadius: 3,
            color: overrideValue !== null ? "#00e5ff" : "#e2e8f0",
            fontSize: "calc(11px * var(--bs-font-scale, 1))",
            padding: "4px 6px",
            textAlign: "right",
          }}
        />
        <span style={{ color: "#64748b", fontSize: "calc(10px * var(--bs-font-scale, 1))" }}>ft</span>
      </div>
    </div>
  );
}

function IntertidalDatumsCard() {
  const setMhw = useSettingsStore((s) => s.setIntertidalMhwOverrideFt);
  const setMhhw = useSettingsStore((s) => s.setIntertidalMhhwOverrideFt);
  const mhwOverride = useSettingsStore((s) => s.intertidalMhwOverrideFt);
  const mhhwOverride = useSettingsStore((s) => s.intertidalMhhwOverrideFt);
  const it = useIntertidal();
  return (
    <div style={S.card} data-testid="intertidal-datums-card">
      <div style={S.cardHeader}>INTERTIDAL BANDS (MHW / MHHW)</div>
      <div style={{ ...S.sublabel, padding: "8px 16px 4px" }}>
        Intertidal band boundaries are defined by the Mean High Water and Mean
        Higher High Water tidal datums, in feet above MLLW.
        {it.stationName && it.datumsStatus === "ready"
          ? ` Values below are resolved from NOAA station ${it.stationName}; enter a number to override.`
          : " When a tide station is selected, its NOAA datum values appear below; enter a number to override."}
      </div>
      <DatumOverrideRow
        label="MHW Override"
        testId="intertidal-mhw-override"
        overrideValue={mhwOverride}
        stationValue={it.stationMhwFt}
        stationName={it.stationName}
        datumsStatus={it.datumsStatus}
        onCommit={setMhw}
      />
      <DatumOverrideRow
        label="MHHW Override"
        testId="intertidal-mhhw-override"
        overrideValue={mhhwOverride}
        stationValue={it.stationMhhwFt}
        stationName={it.stationName}
        datumsStatus={it.datumsStatus}
        onCommit={setMhhw}
      />
    </div>
  );
}

export function VisualsSection() {
  const s = useSettingsStore(useShallow((s) => s));
  // showNodataBoundary is read by uiStore-dependent 3D components (TourScene,
  // Minimap).  Write through uiStore so the auto-mirror subscription keeps
  // both stores in sync; direct settingsStore writes bypass uiStore and leave
  // the 3D scene stale until the next hydration.
  const setShowNodataBoundaryViaUi = useUiStore((s) => s.setShowNodataBoundary);

  // Antialiasing is baked into the WebGL context at page load; capture the
  // value the live context was created with so the reload hint only shows
  // when the displayed value differs from the active runtime state.
  const antialiasingAtLoad = useRef(s.antialiasing);
  const antialiasingPending = s.antialiasing !== antialiasingAtLoad.current;

  // One-time mount repair: null/invalid persisted values would otherwise
  // display a fallback in the UI while the store (and every downstream
  // consumer) still holds the invalid value.
  useEffect(() => {
    const st = useSettingsStore.getState();
    const maxDs: unknown = st.maxActiveDatasets;
    if (typeof maxDs !== "number" || !Number.isFinite(maxDs) || maxDs < 1 || maxDs > 6) {
      st.setMaxActiveDatasets(DEFAULT_SETTINGS.maxActiveDatasets);
    }
    const prox: unknown = st.proximityMode;
    if (typeof prox !== "boolean") {
      st.setProximityMode(DEFAULT_SETTINGS.proximityMode);
    }
  }, []);

  return (
    <>
      <SectionTitle helpId="settings" helpLabel="Visuals & Performance">◈ VISUALS &amp; PERFORMANCE</SectionTitle>
      <SectionActionsRow section="visuals" />

      {/* Quality Preset */}
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
          <div style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", letterSpacing: "0.2em", color: "var(--bs-s-card-header-fg, #cbd5e1)", fontWeight: 700, marginBottom: 2 }}>
            QUALITY PRESET
          </div>
          <div style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#64748b", letterSpacing: "0.05em" }}>
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

      {/* Performance — Dataset Limit */}
      <div style={S.card}>
        <div style={S.cardHeader}>PERFORMANCE</div>
        <SelectRow
          label="Max active datasets"
          sublabel="How many datasets render simultaneously in the 3D scene. Lower this on slow devices to reduce GPU load."
          value={String(s.maxActiveDatasets ?? 3)}
          onChange={(v) => s.setMaxActiveDatasets(Number(v))}
          options={[
            { value: "1", label: "1" },
            { value: "2", label: "2" },
            { value: "3", label: "3  (default)" },
            { value: "4", label: "4" },
            { value: "5", label: "5" },
            { value: "6", label: "6" },
          ]}
        />
        <ToggleRow
          label="Proximity Mode"
          sublabel="Automatically add all your datasets to the proximity pool on startup. The nearest 1–3 load automatically as you move between surveys; far-away surveys stay evicted."
          value={s.proximityMode ?? true}
          onChange={s.setProximityMode}
        />
      </div>

      {/* Effects */}
      <div style={S.card}>
        <div style={S.cardHeader}>EFFECTS</div>
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

      <IntertidalDatumsCard />
      <AdvancedDisclosure testId="visuals-advanced">
        {/* Terrain shading — water surface, landmass, and exaggeration controls */}
        <div style={S.card}>
          <div style={S.cardHeader}>TERRAIN SHADING</div>
          <SliderRow
            label="Vertical Exaggeration"
            value={clampSlider(s.terrainExaggeration, 1, 20, DEFAULT_SETTINGS.terrainExaggeration)}
            min={1} max={20} step={0.5}
            format={(v) => `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}× vertical exaggeration`}
            onChange={(v) => s.setTerrainExaggeration(clampSlider(v, 1, 20, DEFAULT_SETTINGS.terrainExaggeration))}
            sublabel={
              s.terrainExaggeration > 1
                ? "Scale is exaggerated — not true-to-life"
                : "Vertical stretch applied to terrain"
            }
          />
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
            label="Show survey-gap boundary rings"
            value={s.showNodataBoundary}
            onChange={setShowNodataBoundaryViaUi}
            sublabel="Outline rings that mark the edges of survey coverage gaps in the terrain mesh."
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
            sublabel="MSAA edge smoothing — WebGL context-creation parameter"
          />
          {/* Antialiasing is baked into the WebGL context at creation time,
              so toggling it has no visible effect until the page is reloaded.
              Show the inline note only while a change is actually pending —
              i.e. the setting differs from the value active at page load. */}
          {antialiasingPending && (
            <div style={{ padding: "0 16px 10px", marginTop: -2 }}>
              <span
                data-testid="antialiasing-reload-hint"
                style={{
                  display: "inline-block",
                  fontSize: "calc(9px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.06em",
                  color: "#f59e0b",
                  background: "rgba(245,158,11,0.08)",
                  border: "1px solid rgba(245,158,11,0.28)",
                  borderRadius: 3,
                  padding: "2px 7px",
                }}
              >
                ⟳ takes effect after reload
              </span>
            </div>
          )}
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}>ATMOSPHERE</div>
          <SliderRow
            label="Fog Density"
            value={clampSlider(s.fogDensity, 0.004, 0.030, DEFAULT_SETTINGS.fogDensity)}
            min={0.004} max={0.030} step={0.001}
            format={(v) => v.toFixed(3)}
            onChange={(v) => s.setFogDensity(clampSlider(v, 0.004, 0.030, DEFAULT_SETTINGS.fogDensity))}
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
            value={clampSlider(s.ambientLightIntensity, 0, 1, DEFAULT_SETTINGS.ambientLightIntensity)}
            min={0} max={1} step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(v) => s.setAmbientLightIntensity(clampSlider(v, 0, 1, DEFAULT_SETTINGS.ambientLightIntensity))}
            sublabel="Uniform baseline brightness applied to the entire underwater scene."
          />
          <SliderRow
            label="Directional Light Intensity"
            value={clampSlider(s.directionalLightIntensity, 0, 1.5, DEFAULT_SETTINGS.directionalLightIntensity)}
            min={0} max={1.5} step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(v) => s.setDirectionalLightIntensity(clampSlider(v, 0, 1.5, DEFAULT_SETTINGS.directionalLightIntensity))}
            sublabel="Brightness of the sun-like light that casts shading and depth shadows across terrain."
          />
          <SliderRow
            label="Lamp Intensity"
            value={clampSlider(s.lampIntensity, 0, 5, DEFAULT_SETTINGS.lampIntensity)}
            min={0} max={5} step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={(v) => s.setLampIntensity(clampSlider(v, 0, 5, DEFAULT_SETTINGS.lampIntensity))}
            sublabel="Camera-attached point light"
          />
          <SliderRow
            label="Lamp Range"
            value={clampSlider(s.lampRange, 10, 150, DEFAULT_SETTINGS.lampRange)}
            min={10} max={150} step={5}
            format={(v) => `${v} m`}
            onChange={(v) => s.setLampRange(clampSlider(v, 10, 150, DEFAULT_SETTINGS.lampRange))}
            sublabel="Radius in metres of the camera-attached point light that illuminates nearby terrain."
          />
        </div>
      </AdvancedDisclosure>
    </>
  );
}
