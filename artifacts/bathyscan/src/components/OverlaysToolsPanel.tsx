/**
 * OverlaysToolsPanel — single titled sidebar block grouping the overlay
 * and command toggles that used to live in the bottom-right HUD stack
 * (Overview, Find Data, Substrate, Wind, Tide, Current, EFH Zones).
 *
 * The Substrate Legend is rendered inline beneath the Substrate toggle
 * when substrate-tint mode is active, replacing its old bottom-right
 * floating placement.
 */
import React from "react";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import { useGetDatasets, getGetDatasetsQueryKey } from "@workspace/api-client-react";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { HelpIcon } from "@/components/help/HelpButton";
import { SubstrateLegend } from "@/components/SubstrateLegend";
import { ShoreZoneCredit } from "@/components/ShoreZoneCredit";

const PANEL: React.CSSProperties = {
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.28)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#cbd5e1",
  fontSize: 12,
  minWidth: 220,
  maxWidth: 260,
  backdropFilter: "blur(6px)",
};

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.5)",
};

interface ToggleButtonProps {
  testId?: string;
  active: boolean;
  onClick: () => void;
  label: string;
  tooltip: string;
  activeBg: string;
  activeBorder: string;
  activeColor: string;
  activeGlow?: string;
}

const ToggleButton: React.FC<ToggleButtonProps> = ({
  testId,
  active,
  onClick,
  label,
  tooltip,
  activeBg,
  activeBorder,
  activeColor,
  activeGlow,
}) => (
  <ViewscreenTooltip label={tooltip} side="right">
    <button
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        background: active ? activeBg : "rgba(0,10,20,0.55)",
        border: `1px solid ${active ? activeBorder : "rgba(0,229,255,0.15)"}`,
        borderRadius: 4,
        color: active ? activeColor : "#94a3b8",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        padding: "5px 10px",
        cursor: "pointer",
        letterSpacing: "0.12em",
        textShadow: active && activeGlow ? activeGlow : "none",
        transition: "all 0.15s ease",
      }}
    >
      {label}
    </button>
  </ViewscreenTooltip>
);

export const OverlaysToolsPanel: React.FC = () => {
  const { terrain } = useAppState();
  const collapsed = usePanelCollapseStore((s) => s.collapsed.overlaysTools);
  const toggle = usePanelCollapseStore((s) => s.toggle);

  const overviewOpen = useUiStore((s) => s.overviewOpen);
  const setOverviewOpen = useUiStore((s) => s.setOverviewOpen);
  const findDataPanelOpen = useUiStore((s) => s.findDataPanelOpen);
  const setFindDataPanelOpen = useUiStore((s) => s.setFindDataPanelOpen);
  const substrateColorMode = useUiStore((s) => s.substrateColorMode);
  const setSubstrateColorMode = useUiStore((s) => s.setSubstrateColorMode);
  const efhOverlayEnabled = useUiStore((s) => s.efhOverlayEnabled);
  const setEfhOverlayEnabled = useUiStore((s) => s.setEfhOverlayEnabled);
  const windOverlayActive = useUiStore((s) => s.windOverlayActive);
  const setWindOverlayActive = useUiStore((s) => s.setWindOverlayActive);
  const tideOverlayActive = useUiStore((s) => s.tideOverlayActive);
  const setTideOverlayActive = useUiStore((s) => s.setTideOverlayActive);
  const currentOverlayActive = useUiStore((s) => s.currentOverlayActive);
  const setCurrentOverlayActive = useUiStore((s) => s.setCurrentOverlayActive);

  const waterType = useSettingsStore((s) => s.waterType);
  const { data: datasets } = useGetDatasets(
    { waterType },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType }) } },
  );
  const hasEfh = !!datasets?.find((d) => d.id === (terrain?.datasetId ?? ""))?.hasEfh;

  if (!terrain) return null;

  return (
    <div
      data-testid="overlays-tools-panel"
      style={{ ...PANEL, pointerEvents: "auto" }}
      className="select-none"
    >
      <ViewscreenTooltip
        label={collapsed ? "Show overlays & tools" : "Hide overlays & tools"}
        side="right"
      >
        <button
          onClick={() => toggle("overlaysTools")}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors rounded-t"
          style={{ cursor: "pointer" }}
        >
          <span
            className="uppercase tracking-widest"
            style={{ fontSize: 11, ...CYAN, fontWeight: 700 }}
          >
            ▼ Overlays &amp; Tools
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <HelpIcon articleId="hud-overlays" label="HUD overlay toggles" />
            <span style={{ color: "#cbd5e1", fontSize: 24, lineHeight: 1 }}>
              {collapsed ? "▸" : "▾"}
            </span>
          </span>
        </button>
      </ViewscreenTooltip>

      {!collapsed && (
        <div
          className="px-3 py-2 flex flex-col gap-1.5"
          style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}
        >
          <ToggleButton
            testId="hud-toggle-overview"
            active={overviewOpen}
            onClick={() => setOverviewOpen(!overviewOpen)}
            label="🗺 OVERVIEW"
            tooltip={overviewOpen ? "Close the 2D Overview Map (O)" : "Open the 2D Overview Map (O)"}
            activeBg="rgba(0,229,255,0.15)"
            activeBorder="rgba(0,229,255,0.6)"
            activeColor="#00e5ff"
            activeGlow="0 0 6px rgba(0,229,255,0.5)"
          />

          <ToggleButton
            active={findDataPanelOpen}
            onClick={() => setFindDataPanelOpen(!findDataPanelOpen)}
            label="🔍 FIND DATA"
            tooltip="Browse datasets, markers and habitats"
            activeBg="rgba(0,229,255,0.12)"
            activeBorder="rgba(0,229,255,0.5)"
            activeColor="#00e5ff"
            activeGlow="0 0 6px rgba(0,229,255,0.4)"
          />

          <ToggleButton
            active={substrateColorMode}
            onClick={() => setSubstrateColorMode(!substrateColorMode)}
            label="◼ SUBSTRATE"
            tooltip="Tint seafloor by substrate type (sand, mud, rock)"
            activeBg="rgba(226,213,160,0.15)"
            activeBorder="rgba(226,213,160,0.5)"
            activeColor="#e2d5a0"
          />

          {substrateColorMode && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <SubstrateLegend />
              <ShoreZoneCredit style={{ textAlign: "left", maxWidth: 260 }} />
            </div>
          )}

          <ToggleButton
            testId="overlay-toggle-wind"
            active={windOverlayActive}
            onClick={() => setWindOverlayActive(!windOverlayActive)}
            label="💨 WIND"
            tooltip="Toggle wind direction arrows overlay"
            activeBg="rgba(0,229,255,0.10)"
            activeBorder="rgba(125,211,252,0.5)"
            activeColor="#7dd3fc"
            activeGlow="0 0 6px rgba(125,211,252,0.5)"
          />

          <ToggleButton
            testId="overlay-toggle-tide"
            active={tideOverlayActive}
            onClick={() => setTideOverlayActive(!tideOverlayActive)}
            label="🌊 TIDE"
            tooltip="Toggle tidal flow arrows overlay"
            activeBg="rgba(0,229,255,0.10)"
            activeBorder="rgba(52,211,153,0.5)"
            activeColor="#34d399"
            activeGlow="0 0 6px rgba(52,211,153,0.5)"
          />

          <ToggleButton
            testId="overlay-toggle-current"
            active={currentOverlayActive}
            onClick={() => setCurrentOverlayActive(!currentOverlayActive)}
            label="↬ CURRENT"
            tooltip="Toggle sub-surface current arrows overlay"
            activeBg="rgba(0,229,255,0.10)"
            activeBorder="rgba(34,211,238,0.5)"
            activeColor="#22d3ee"
            activeGlow="0 0 6px rgba(34,211,238,0.5)"
          />

          {hasEfh && (
            <ToggleButton
              active={efhOverlayEnabled}
              onClick={() => setEfhOverlayEnabled(!efhOverlayEnabled)}
              label="🐟 ESSENTIAL FISH HABITAT"
              tooltip="Show Essential Fish Habitat zones overlay"
              activeBg="rgba(34,197,94,0.15)"
              activeBorder="rgba(34,197,94,0.5)"
              activeColor="#4ade80"
            />
          )}
        </div>
      )}
    </div>
  );
};
