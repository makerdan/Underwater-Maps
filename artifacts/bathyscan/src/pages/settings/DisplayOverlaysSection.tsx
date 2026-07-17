import React from "react";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/lib/settingsStore";
import { AdvancedDisclosure } from "@/components/AdvancedDisclosure";
import { S } from "./styles";
import { SectionTitle } from "./components/SectionTitle";
import { SectionActionsRow } from "./components/SyncContext";
import { SliderRow, ToggleRow, SelectRow } from "./components/RowWidgets";
import { ZoneColourSwatches } from "./components/ZoneColourSwatches";
import { FONT } from "./styles";

export function DisplayOverlaysSection() {
  const s = useSettingsStore(useShallow((s) => s));
  return (
    <>
      <SectionTitle helpId="interface-tour" helpLabel="Display & Overlays">◈ DISPLAY &amp; OVERLAYS</SectionTitle>
      <SectionActionsRow sections={["hud", "overview", "habitat"]} withReset={false} />

      {/* HUD & Layout */}
      <div style={S.card}>
        <div style={S.cardHeader}>HUD &amp; LAYOUT</div>
      </div>
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
          <ToggleRow
            label="Health Badge"
            value={s.showHealthBadge}
            onChange={s.setShowHealthBadge}
            sublabel="Latency readout in the bottom-right corner (dev builds only)"
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

      {/* Map & Overlays */}
      <div style={{ ...S.card, marginTop: 16 }}>
        <div style={S.cardHeader}>MAP &amp; OVERLAYS</div>
      </div>
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
