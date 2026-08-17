/**
 * MobileAnalyzeTab — MOBILE-ONLY: the Analyze-mode content of the mobile
 * bottom sheet. Hosts the existing Habitat + Seafloor Classification panels
 * (their overlays render on the 2D chart via useMobileChartOverlays — no 3D
 * scene involved), and adapts the desktop "load a dataset" empty state to
 * mobile: instead of routing to the desktop Explore sidebar (which does not
 * exist on phones), the CTA opens the mobile dataset picker.
 */
import React from "react";
import { useTerrainStore } from "@/lib/terrainStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { HabitatPanel } from "@/components/HabitatPanel";
import { SeafloorClassificationPanel } from "@/components/SeafloorClassificationPanel";

const MONO = "'JetBrains Mono', monospace";

export const MobileAnalyzeTab: React.FC<{
  /** Opens the mobile dataset picker (owned by the shell). */
  onOpenPicker: () => void;
}> = ({ onOpenPicker }) => {
  // The 2D chart renders the overview grid, so its presence is the mobile
  // equivalent of the desktop `!terrain` gate.
  const overviewGrid = useTerrainStore((s) => s.overviewGrid);
  const showHabitatPanel = useSettingsStore((s) => s.showHabitatPanel);

  if (!overviewGrid) {
    return (
      <div
        data-testid="mobile-analyze-empty"
        style={{
          padding: "18px 12px",
          textAlign: "center",
          color: "#64748b",
          fontFamily: MONO,
          fontSize: "calc(13px * var(--bs-font-scale, 1))",
          letterSpacing: "0.1em",
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontSize: "calc(28px * var(--bs-font-scale, 1))", marginBottom: 6, opacity: 0.5 }}>
          ◈
        </div>
        <div style={{ marginBottom: 12 }}>Load a dataset to begin analysis.</div>
        <button
          type="button"
          data-testid="mobile-analyze-choose-dataset"
          // MOBILE-ONLY routing: open the mobile picker, not the desktop
          // Explore sidebar / Find Data panel.
          onClick={onOpenPicker}
          style={{
            fontFamily: MONO,
            fontSize: "calc(13px * var(--bs-font-scale, 1))",
            letterSpacing: "0.1em",
            padding: "12px 20px",
            minHeight: 44, // MOBILE-ONLY: thumb-sized touch target
            background: "rgba(0,229,255,0.08)",
            border: "1px solid rgba(0,229,255,0.35)",
            borderRadius: 6,
            color: "#00e5ff",
            cursor: "pointer",
          }}
        >
          CHOOSE A DATASET
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="mobile-analyze-tab"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {/* Same showHabitatPanel settings gate as the desktop Analyze stack. */}
      {showHabitatPanel ? <HabitatPanel embedded /> : null}
      <SeafloorClassificationPanel />
    </div>
  );
};
