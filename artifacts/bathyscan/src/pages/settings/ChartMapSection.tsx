/**
 * ChartMapSection.tsx
 *
 * MOBILE-ONLY: dedicated "2D Chart" settings section that gathers all contour-map
 * options in one place for phone users. Desktop Settings pages are unchanged —
 * this section is never mounted on desktop (tab "chart-map" is absent from the
 * desktop tab strip and from the Settings content switch).
 *
 * Controls bound here are the same settings-store fields used in their original
 * locations (DepthColorsCard, DisplayOverlaysSection) so values stay in sync
 * across devices. The original rows are hidden on mobile (useIsMobile guard in
 * those components) to avoid duplication.
 */
import React, { useEffect, useRef } from "react";
import { useSettingsStore } from "@/lib/settingsStore";
import { CONTOUR_DENSITY_VALUES, type ContourDensity } from "@/lib/contourDensity";
import { S } from "./styles";
import { SectionTitle } from "./components/SectionTitle";
import { SectionActionsRow } from "./components/SyncContext";
import { SliderRow, ToggleRow, SelectRow, clampSlider } from "./components/RowWidgets";
import { defaultContourInterval } from "./constants";

// MOBILE-ONLY: unit-aware contour interval slider, mirrors ContourIntervalRow
// inside DepthColorsCard.tsx (which is hidden on mobile). Binds to the same
// settingsStore fields: contourInterval / setContourInterval.
function MobileContourIntervalRow({ disabled }: { disabled?: boolean }) {
  const units = useSettingsStore((s) => s.units);
  const contourInterval = useSettingsStore((s) => s.contourInterval);
  const setContourInterval = useSettingsStore((s) => s.setContourInterval);
  const isMetric = units === "metric";
  const isNautical = units === "nautical";
  const sliderMin = isMetric ? 0.5 : isNautical ? 0.5 : 1;
  const sliderMax = isMetric ? 50 : isNautical ? 50 : 200;
  const sliderStep = isMetric ? 0.5 : isNautical ? 0.5 : 1;
  const formatInterval = (v: number) => {
    const n = v % 1 === 0 ? v.toFixed(0) : v.toFixed(1);
    return isMetric ? `${n} m` : isNautical ? `${n} fm` : `${n} ft`;
  };
  const prevUnitsRef = useRef(units);
  useEffect(() => {
    const prev = prevUnitsRef.current;
    prevUnitsRef.current = units;
    if (prev === units) return;
    setContourInterval(defaultContourInterval(units));
  }, [units, setContourInterval]);
  return (
    <SliderRow
      label="Contour Interval"
      value={clampSlider(contourInterval, sliderMin, sliderMax, defaultContourInterval(units))}
      min={sliderMin}
      max={sliderMax}
      step={sliderStep}
      format={formatInterval}
      onChange={(v) =>
        setContourInterval(clampSlider(v, sliderMin, sliderMax, defaultContourInterval(units)))
      }
      sublabel="Iso-depth spacing between contour lines"
      disabled={disabled}
    />
  );
}

// MOBILE-ONLY: contour density options match the 1×/2×/3× multipliers defined
// in contourDensity.ts. Stored in settingsStore.contourDensity.
const DENSITY_OPTIONS: { value: string; label: string }[] = CONTOUR_DENSITY_VALUES.map((v) => ({
  value: String(v),
  label: v === 1 ? "1× (default)" : v === 2 ? "2× (denser)" : "3× (densest)",
}));

export function ChartMapSection() {
  // MOBILE-ONLY: contour on/off and interval (same fields as DepthColorsCard)
  const contoursEnabled = useSettingsStore((s) => s.contoursEnabled);
  const setContoursEnabled = useSettingsStore((s) => s.setContoursEnabled);

  // MOBILE-ONLY: contour density (1×/2×/3× — introduced by task #4001)
  const contourDensity = useSettingsStore((s) => s.contourDensity);
  const setContourDensity = useSettingsStore((s) => s.setContourDensity);

  // MOBILE-ONLY: overview map grid / markers (same fields as DisplayOverlaysSection)
  const overviewShowGrid = useSettingsStore((s) => s.overviewShowGrid);
  const setOverviewShowGrid = useSettingsStore((s) => s.setOverviewShowGrid);
  const overviewShowMarkers = useSettingsStore((s) => s.overviewShowMarkers);
  const setOverviewShowMarkers = useSettingsStore((s) => s.setOverviewShowMarkers);

  return (
    <>
      {/* MOBILE-ONLY: section title for the 2D chart settings group */}
      <SectionTitle helpId="settings" helpLabel="2D Chart">◈ 2D CHART</SectionTitle>
      {/* MOBILE-ONLY: save/reset actions — covers palette (contours) + overview (grid/markers) */}
      <SectionActionsRow sections={["palette", "overview"]} withReset={false} />

      {/* MOBILE-ONLY: contour lines card */}
      <div style={S.card} data-testid="chart-map-contours-card">
        <div style={S.cardHeader}>CONTOUR LINES</div>
        <ToggleRow
          label="Show Contour Lines"
          value={contoursEnabled}
          onChange={setContoursEnabled}
          sublabel="Iso-depth lines on the 2D chart"
        />
        <div
          style={{
            opacity: contoursEnabled ? 1 : 0.4,
            pointerEvents: contoursEnabled ? "auto" : "none",
          }}
        >
          {/* MOBILE-ONLY: contour interval row — mirrors DepthColorsCard's hidden row */}
          <MobileContourIntervalRow disabled={!contoursEnabled} />
        </div>
        {/* MOBILE-ONLY: contour density stepper (1×/2×/3×) — mobile chart only */}
        <SelectRow
          label="Contour Density"
          value={String(contourDensity)}
          onChange={(v) => setContourDensity(Number(v) as ContourDensity)}
          options={DENSITY_OPTIONS}
          sublabel="How many contour lines to draw (multiplier on the interval)"
        />
      </div>

      {/* MOBILE-ONLY: chart display card — grid and marker toggles */}
      <div style={S.card} data-testid="chart-map-display-card">
        <div style={S.cardHeader}>CHART DISPLAY</div>
        {/* MOBILE-ONLY: grid lines and markers — same store fields as DisplayOverlaysSection */}
        <ToggleRow
          label="Show Grid Lines"
          value={overviewShowGrid}
          onChange={setOverviewShowGrid}
        />
        <ToggleRow
          label="Show Markers"
          value={overviewShowMarkers}
          onChange={setOverviewShowMarkers}
        />
      </div>
    </>
  );
}
