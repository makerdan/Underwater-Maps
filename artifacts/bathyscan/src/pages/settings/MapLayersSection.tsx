import React from "react";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/lib/settingsStore";
import { AdvancedDisclosure } from "@/components/AdvancedDisclosure";
import { S } from "./styles";
import { SectionTitle } from "./components/SectionTitle";
import { SectionActionsRow } from "./components/SyncContext";
import { SliderRow, ToggleRow, SelectRow, ColorRow } from "./components/RowWidgets";
import { SALTWATER_MARKER_TYPE_OPTIONS, FRESHWATER_MARKER_TYPE_OPTIONS } from "./constants";
import type { MarkerType } from "@/lib/settingsStore";

export function MapLayersSection() {
  const s = useSettingsStore(useShallow((s) => s));
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
      <SectionTitle helpId="markers" helpLabel="Map Layers">◈ MAP LAYERS</SectionTitle>
      <SectionActionsRow sections={["markers", "gps", "tidal", "currents"]} />

      {/* Markers & Trails */}
      <div style={S.card}>
        <div style={S.cardHeader}>MARKERS &amp; TRAILS</div>
      </div>
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

      {/* Tides & Currents */}
      <div style={{ ...S.card, marginTop: 16 }}>
        <div style={S.cardHeader}>TIDES &amp; CURRENTS</div>
      </div>
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
