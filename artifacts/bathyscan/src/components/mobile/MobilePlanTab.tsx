/**
 * MobilePlanTab — MOBILE-ONLY: the full Plan-mode panel stack presented in
 * the mobile bottom sheet over the 2D chart. Mirrors the desktop Plan
 * sidebar section-for-section (Conditions → Drift & Route → Routes →
 * Forecast → Trip Windows) but with flat mobile section headers instead of
 * the desktop SidebarSection collapse chrome, and no timeline-bar hint
 * (the desktop timeline bar does not exist on mobile).
 *
 * None of the hosted panels require the 3D scene — they are DOM panels fed
 * by stores/HTTP. Tide state that lives in App's Main() (fetch results,
 * scrub times) arrives via props; store-backed state is read directly.
 */
import React from "react";
import { useDriftStore } from "@/lib/driftStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useTimelineStore } from "@/lib/timelineStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TideStationPanel } from "@/components/TideStationPanel";
import { TidePanel } from "@/components/TidePanel";
import { CurrentsPanel } from "@/components/CurrentsPanel";
import { DriftPlannerPanel } from "@/components/DriftPlannerPanel";
import { WeatherPanel } from "@/components/WeatherPanel";
import { RoutesPanel } from "@/components/RoutesPanel";
import { ForecastStrip } from "@/components/ForecastStrip";
import { TripWindowPanel } from "@/components/TripWindowPanel";
import type { TidalDataResult } from "@/hooks/useTidalData";
import type { DepthLayer } from "@/components/TidalCurrentArrows";

const MONO = "'JetBrains Mono', monospace";

/** MOBILE-ONLY: flat section header replacing the desktop collapse chrome. */
const SectionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      color: "#64748b",
      fontFamily: MONO,
      fontSize: "calc(11px * var(--bs-font-scale, 1))",
      letterSpacing: "0.22em",
      textTransform: "uppercase",
      padding: "10px 2px 4px",
      borderBottom: "1px solid rgba(0,229,255,0.12)",
      marginBottom: 6,
    }}
  >
    {children}
  </div>
);

export interface MobilePlanTabProps {
  /** Tidal 3D overlay flag from AppState (gates tide station/panel, as on desktop). */
  tidalOverlay: boolean;
  tidalData: TidalDataResult | null;
  tidalLoading: boolean;
  depthLayer: DepthLayer;
  onDepthLayerChange: (l: DepthLayer) => void;
  /** Trip-planning scrub time for the tide-station curve, or null for "now". */
  tidePlanTime: Date | null;
  onTidePlanTimeChange: (d: Date | null) => void;
  /** Real-time clock tick (epoch ms). */
  tideNowMs: number;
  centerLat: number | null;
  centerLon: number | null;
}

export const MobilePlanTab: React.FC<MobilePlanTabProps> = ({
  tidalOverlay,
  tidalData,
  tidalLoading,
  depthLayer,
  onDepthLayerChange,
  tidePlanTime,
  onTidePlanTimeChange,
  tideNowMs,
  centerLat,
  centerLon,
}) => {
  const showTidePanel = useSettingsStore((s) => s.showTidePanel);
  const driftPlannerActive = useDriftStore((s) => s.driftPlannerActive);
  const setDriftPlannerActive = useDriftStore((s) => s.setDriftPlannerActive);
  const timelineCurrentTime = useTimelineStore((s) => s.currentTime);
  const setTimelineTime = useTimelineStore((s) => s.setTime);

  return (
    <div
      data-testid="mobile-plan-tab"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {/* (1) Conditions — Tides + Currents, mirroring the desktop stack. */}
      <SectionHeader>Conditions</SectionHeader>
      {tidalOverlay && (
        <ErrorBoundary label="tide station panel">
          <TideStationPanel
            scrubDatetime={tidePlanTime}
            onScrubChange={onTidePlanTimeChange}
            nowMs={tideNowMs}
          />
        </ErrorBoundary>
      )}
      {showTidePanel && tidalOverlay && tidalData !== null ? (
        <ErrorBoundary label="tide panel">
          <TidePanel
            data={tidalData}
            loading={tidalLoading}
            depthLayer={depthLayer}
            onDepthLayerChange={onDepthLayerChange}
            scrubDatetime={timelineCurrentTime}
            onScrubChange={(d) => setTimelineTime(d ?? new Date())}
            lat={centerLat}
            lon={centerLon}
            embedded
          />
        </ErrorBoundary>
      ) : null}
      <ErrorBoundary label="currents panel">
        <CurrentsPanel embedded />
      </ErrorBoundary>

      {/* (2) Drift & Route — planner plus weather, same gating as desktop. */}
      <SectionHeader>Drift &amp; Route</SectionHeader>
      <DriftPlannerPanel />
      {!driftPlannerActive ? (
        <div
          data-testid="mobile-drift-empty-state"
          style={{
            padding: "8px 2px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: "calc(12.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.08em",
              color: "#64748b",
              lineHeight: 1.55,
            }}
          >
            Predict where your boat and fishing line will drift based on tidal currents and wind
            over a 24-hour window.
          </div>
          <button
            type="button"
            data-testid="mobile-start-planning-button"
            onClick={() => setDriftPlannerActive(true)}
            style={{
              fontFamily: MONO,
              fontSize: "calc(13px * var(--bs-font-scale, 1))",
              letterSpacing: "0.14em",
              padding: "10px 16px",
              minHeight: 44, // MOBILE-ONLY: thumb-sized touch target
              borderRadius: 6,
              border: "1px solid rgba(251,191,36,0.45)",
              background: "rgba(251,191,36,0.08)",
              color: "#fbbf24",
              cursor: "pointer",
            }}
          >
            ⛵ START PLANNING
          </button>
        </div>
      ) : (
        <ErrorBoundary label="weather panel">
          <WeatherPanel onClose={() => setDriftPlannerActive(false)} embedded />
        </ErrorBoundary>
      )}

      {/* Routes list — standalone card, as on desktop. */}
      <RoutesPanel />

      <SectionHeader>Forecast</SectionHeader>
      <ForecastStrip />

      <SectionHeader>Trip Windows</SectionHeader>
      <ErrorBoundary label="trip window panel">
        <TripWindowPanel />
      </ErrorBoundary>
    </div>
  );
};
