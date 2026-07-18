import React, { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/lib/settingsStore";
import { AdvancedDisclosure } from "@/components/AdvancedDisclosure";
import { PaletteSuggestionBanner } from "@/components/PaletteSuggestionBanner";
import { S } from "./styles";
import { SectionTitle } from "./components/SectionTitle";
import { SectionActionsRow } from "./components/SyncContext";
import { SliderRow, ToggleRow, SelectRow, ColorRow, ColormapSelectRow } from "./components/RowWidgets";
import { Select } from "./components/Toggle";
import { PalettePickerCard } from "./components/PalettePickerCard";
import { ZoneColourSwatches } from "./components/ZoneColourSwatches";
import { defaultContourInterval } from "./constants";

function ContourIntervalRow() {
  const s = useSettingsStore(useShallow((s) => s));
  const isMetric = s.units === "metric";
  const isNautical = s.units === "nautical";
  // Fine intervals (0.5 m / 0.5 fm / 1 ft) make shallow inshore surveys
  // readable; buildContourLines has a MAX_CONTOUR_SEGMENTS guard so small
  // intervals cannot generate unbounded geometry.
  const sliderMin  = isMetric ? 0.5 : isNautical ? 0.5 : 1;
  const sliderMax  = isMetric ? 50  : isNautical ? 50  : 200;
  const sliderStep = isMetric ? 0.5 : isNautical ? 0.5 : 1;
  const formatInterval = (v: number) => {
    const n = v % 1 === 0 ? v.toFixed(0) : v.toFixed(1);
    return isMetric ? `${n} m` : isNautical ? `${n} fm` : `${n} ft`;
  };
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

export function VisualsSection() {
  const s = useSettingsStore(useShallow((s) => s));
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
          label="Vertical Exaggeration"
          value={s.terrainExaggeration}
          min={1} max={20} step={0.5}
          format={(v) => `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}× vertical exaggeration`}
          onChange={s.setTerrainExaggeration}
          sublabel={
            s.terrainExaggeration > 1
              ? "Scale is exaggerated — not true-to-life"
              : "Vertical stretch applied to terrain"
          }
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

      {/* Depth Display */}
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

      <PaletteSuggestionBanner />
      <PalettePickerCard />
      <ZoneColourSwatches />
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
