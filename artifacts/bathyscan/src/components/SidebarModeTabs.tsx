/**
 * SidebarModeTabs — mode tabs for Explore / Plan / Analyze / Live.
 *
 * Desktop: text-only labels. Mobile (useIsMobile): icon-only with aria-label.
 *
 * Placed at the top of the left sidebar, above the panel groups.
 * Active mode is stored in uiStore (mirrored to settingsStore for persistence).
 * Pressing a tab switches the mode immediately; the panels below use CSS
 * display:none gating so all panel state is preserved across mode switches.
 */
import React from "react";
import { useUiStore } from "@/lib/uiStore";
import { useAppState } from "@/lib/context";
import { useDriftStore } from "@/lib/driftStore";
import { useIsMobile } from "@/hooks/use-mobile";
import type { SidebarMode } from "@/lib/settingsStore";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";

interface ModeTab {
  mode: SidebarMode;
  label: string;
  tooltip: string;
  icon: React.ReactNode;
}

const ICON_SIZE = 20;

const CompassIcon = () => (
  <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

const RouteIcon = () => (
  <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="19" r="3" />
    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
    <circle cx="18" cy="5" r="3" />
  </svg>
);

const ChartIcon = () => (
  <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const LiveIcon = () => (
  <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="2" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
    <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
  </svg>
);

const TABS: ModeTab[] = [
  {
    mode: 'explore',
    label: 'Explore',
    tooltip: 'Explore mode — datasets and overlays',
    icon: <CompassIcon />,
  },
  {
    mode: 'plan',
    label: 'Plan',
    tooltip: 'Plan mode — tides, currents and route planning',
    icon: <RouteIcon />,
  },
  {
    mode: 'analyze',
    label: 'Analyze',
    tooltip: 'Analyze mode — habitat, seafloor classification and queries',
    icon: <ChartIcon />,
  },
  {
    mode: 'live',
    label: 'Live',
    tooltip: 'Live mode — GPS follow and trail recording on the water',
    icon: <LiveIcon />,
  },
];

export const SidebarModeTabs: React.FC = () => {
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const setSidebarMode = useUiStore((s) => s.setSidebarMode);
  const isMobile = useIsMobile();
  const { tidalOverlay, realisticMode } = useAppState();
  const driftPlannerActive = useDriftStore((s) => s.driftPlannerActive);

  // Per-tab "feature active" indicator dots: a tab shows a dot when a
  // feature homed under it is currently enabled, so relocated toggles
  // (Tidal 3D, Drive Boat, Drift) stay discoverable while the sidebar is
  // on another tab.
  const tabIndicator: Partial<Record<SidebarMode, boolean>> = {
    explore: tidalOverlay,
    live: realisticMode,
    plan: driftPlannerActive,
  };

  return (
    <div
      data-testid="sidebar-mode-tabs"
      style={{
        display: "flex",
        width: "100%",
        minWidth: 230,
        maxWidth: 260,
        background: "rgba(2,8,18,0.94)",
        border: "1px solid rgba(0,229,255,0.22)",
        borderRadius: 6,
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        backdropFilter: "blur(6px)",
      }}
    >
      {TABS.map((tab, i) => {
        const isActive = sidebarMode === tab.mode;
        return (
          <ViewscreenTooltip key={tab.mode} label={tab.tooltip} side="bottom">
            <button
              type="button"
              data-testid={`sidebar-mode-tab-${tab.mode}`}
              aria-pressed={isActive}
              aria-label={tab.label}
              onClick={() => setSidebarMode(tab.mode)}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: isMobile ? "12px 4px" : "8px 2px",
                minHeight: isMobile ? 44 : undefined,
                background: isActive
                  ? "rgba(0,229,255,0.12)"
                  : "transparent",
                border: "none",
                borderRight: i < TABS.length - 1
                  ? "1px solid rgba(0,229,255,0.12)"
                  : "none",
                borderBottom: isActive
                  ? "2px solid rgba(0,229,255,0.80)"
                  : "2px solid transparent",
                cursor: "pointer",
                color: isActive ? "#00e5ff" : "#64748b",
                fontSize: "calc(11.5px * var(--bs-font-scale, 1))",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                fontWeight: isActive ? 700 : 400,
                textShadow: isActive ? "0 0 6px rgba(0,229,255,0.5)" : "none",
                transition: "background 0.15s, color 0.15s, border-color 0.15s",
                whiteSpace: "nowrap",
                position: "relative",
              }}
            >
              {isMobile ? tab.icon : tab.label}
              {tabIndicator[tab.mode] && (
                <span
                  data-testid={`sidebar-mode-tab-${tab.mode}-indicator`}
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 5,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#00e5ff",
                    boxShadow: "0 0 5px rgba(0,229,255,0.8)",
                    pointerEvents: "none",
                  }}
                />
              )}
            </button>
          </ViewscreenTooltip>
        );
      })}
    </div>
  );
};
