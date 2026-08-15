import React from "react";
import { useShallow } from "zustand/react/shallow";
import {
  useSettingsStore,
  DEFAULT_SETTINGS,
  type MarkerType,
  type TidalDepthLayer,
  type CurrentArrowDensity,
} from "@/lib/settingsStore";
import { AdvancedDisclosure } from "@/components/AdvancedDisclosure";
import { S } from "./styles";
import { SectionTitle } from "./components/SectionTitle";
import { SectionActionsRow } from "./components/SyncContext";
import { SliderRow, ToggleRow, SelectRow, ColorRow } from "./components/RowWidgets";
import { SALTWATER_MARKER_TYPE_OPTIONS, FRESHWATER_MARKER_TYPE_OPTIONS } from "./constants";

/** The only Sample Rate values offered by the select below. */
const GPS_INTERVAL_OPTIONS: readonly number[] = [1000, 2000, 10000];

/**
 * Snap an arbitrary persisted GPS interval to the nearest allowed option so
 * the controlled select never renders blank. Non-finite input falls back to
 * the field default.
 */
function nearestGpsInterval(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_SETTINGS.gpsRecordingInterval;
  return GPS_INTERVAL_OPTIONS.reduce((best, opt) =>
    Math.abs(opt - ms) < Math.abs(best - ms) ? opt : best,
  );
}

/**
 * Clamp a slider value into [min, max]; NaN / non-finite persisted values
 * fall back to the field's default so range inputs never show invalid state.
 */
function clampSlider(v: number, min: number, max: number, fallback: number): number {
  const n = Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

export function MapLayersSection() {
  const s = useSettingsStore(useShallow((s) => s));
  const MARKER_TYPE_OPTIONS =
    s.waterType === "freshwater"
      ? FRESHWATER_MARKER_TYPE_OPTIONS
      : SALTWATER_MARKER_TYPE_OPTIONS;

  const toggleMarkerType = (type: MarkerType) => {
    // Read at call time — not from the render snapshot — so two rapid
    // toggles before a re-render each see the other's update instead of
    // the second overwriting the first.
    const { visibleMarkerTypes, setVisibleMarkerTypes } = useSettingsStore.getState();
    if (visibleMarkerTypes.includes(type)) {
      setVisibleMarkerTypes(visibleMarkerTypes.filter((t) => t !== type));
    } else {
      setVisibleMarkerTypes([...visibleMarkerTypes, type]);
    }
  };

  // Older schemas / partial migrations can leave layerArrowDensity absent or
  // missing keys; fall back to the global density like the 3D renderer does.
  const layerDensity: Partial<Record<TidalDepthLayer, CurrentArrowDensity>> =
    s.layerArrowDensity ?? {};

  // Normalise the persisted GPS sample rate to a valid select option.
  const gpsInterval = s.gpsRecordingInterval;
  const displayGpsInterval = GPS_INTERVAL_OPTIONS.includes(gpsInterval)
    ? gpsInterval
    : nearestGpsInterval(gpsInterval);

  // 360° is the same compass bearing as 0°; normalise so equality checks and
  // persistence don't churn between the two representations.
  const storedDirection = s.currentsManualDirectionDeg;
  const displayDirection = clampSlider(
    storedDirection === 360 ? 0 : storedDirection,
    0, 355, DEFAULT_SETTINGS.currentsManualDirectionDeg,
  );

  const { setGpsRecordingInterval, setCurrentsManualDirectionDeg } = s;
  React.useEffect(() => {
    // Write the normalised value back so the store never keeps an
    // out-of-range interval (e.g. a persisted 3000 ms from an older schema).
    if (displayGpsInterval !== gpsInterval) setGpsRecordingInterval(displayGpsInterval);
  }, [displayGpsInterval, gpsInterval, setGpsRecordingInterval]);
  React.useEffect(() => {
    // Correct any persisted 360° (or out-of-range) bearing to its 0–355 form.
    if (displayDirection !== storedDirection) setCurrentsManualDirectionDeg(displayDirection);
  }, [displayDirection, storedDirection, setCurrentsManualDirectionDeg]);

  return (
    <>
      <SectionTitle helpId="markers" helpLabel="Map Layers">◈ MAP LAYERS</SectionTitle>
      <SectionActionsRow sections={["markers", "gps", "tidal", "currents"]} />

      {/* Markers & Trails — group heading lives inside the first card of the
          group (no standalone header-only card). */}
      <div style={S.card}>
        <div style={S.cardGroupHeader}>MARKERS &amp; TRAILS</div>
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
          value={String(displayGpsInterval) as "1000" | "2000" | "10000"}
          onChange={(v) => s.setGpsRecordingInterval(Number(v))}
          options={[
            { value: "1000", label: "1 Hz (1 / sec)" },
            { value: "2000", label: "0.5 Hz (every 2s)" },
            { value: "10000", label: "0.1 Hz (every 10s)" },
          ]}
          sublabel="How often GPS track points are recorded"
        />
        <SliderRow
          label="Follow Resume Delay"
          value={clampSlider(s.followResumeDelaySec, 5, 120, DEFAULT_SETTINGS.followResumeDelaySec)}
          min={5} max={120} step={5}
          format={(v) => `${v}s`}
          onChange={(v) => s.setFollowResumeDelaySec(clampSlider(v, 5, 120, DEFAULT_SETTINGS.followResumeDelaySec))}
          sublabel="After you move the camera in Follow Me mode, following resumes after this many seconds of inactivity"
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
            value={clampSlider(s.markerClusterThreshold, 0, 200, DEFAULT_SETTINGS.markerClusterThreshold)}
            min={0} max={200} step={5}
            format={(v) => v === 0 ? "Off" : `${v}`}
            onChange={(v) => s.setMarkerClusterThreshold(clampSlider(v, 0, 200, DEFAULT_SETTINGS.markerClusterThreshold))}
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

      {/* Tides & Currents — group heading lives inside the first card of the
          group (no standalone header-only card). */}
      <div style={{ ...S.card, marginTop: 16 }}>
        <div style={S.cardGroupHeader}>TIDES &amp; CURRENTS</div>
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
          value={displayDirection}
          min={0} max={355} step={5}
          onChange={(v) =>
            s.setCurrentsManualDirectionDeg(
              clampSlider(v === 360 ? 0 : v, 0, 355, DEFAULT_SETTINGS.currentsManualDirectionDeg),
            )
          }
          sublabel="Compass bearing the current flows toward (0 = south, 90 = east)"
        />
        <SliderRow
          label="Speed (kt)"
          value={clampSlider(s.currentsManualSpeedKt, 0, 5, DEFAULT_SETTINGS.currentsManualSpeedKt)}
          min={0} max={5} step={0.1}
          onChange={(v) => s.setCurrentsManualSpeedKt(clampSlider(v, 0, 5, DEFAULT_SETTINGS.currentsManualSpeedKt))}
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
            value={layerDensity.surface ?? s.currentArrowDensity}
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
            value={layerDensity.mid ?? s.currentArrowDensity}
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
            value={layerDensity["near-bottom"] ?? s.currentArrowDensity}
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
