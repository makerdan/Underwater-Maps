/**
 * MobileChartShell — MOBILE-ONLY: the full-screen shell that replaces the 3D
 * scene (and all desktop map overlays) on phones (≤767px). Composes:
 *
 *   - MobileChartView   — full-screen 2D contour chart (the map surface)
 *   - dataset chip      — current dataset name; opens the compact picker
 *   - density stepper   — floating 1×/2×/3× contour-density control
 *                         (settings-synced via the contourDensity key)
 *   - bottom tab bar    — Chart / Plan / Analyze / Live, wired to the
 *                         existing persisted uiStore sidebarMode
 *   - bottom sheet      — hosts existing panels for Plan / Analyze / Live
 *                         (real mobile tab content lands in follow-up tasks)
 *
 * The desktop layout renders none of this — see the mobile gate in App.tsx.
 */
import React, { useState } from "react";
import {
  useGetDatasets,
  getGetDatasetsQueryKey,
  useGetUserDatasets,
  getGetUserDatasetsQueryKey,
} from "@workspace/api-client-react";
import { useUiStore } from "@/lib/uiStore";
import { useSettingsStore, type SidebarMode } from "@/lib/settingsStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useAuth } from "@/lib/clerkCompat";
import {
  CONTOUR_DENSITY_VALUES,
  toValidContourDensity,
  type ContourDensity,
} from "@/lib/contourDensity";
import { MobileChartView } from "./MobileChartView";
import { MobileDatasetPicker } from "./MobileDatasetPicker";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LivePanel } from "@/components/LivePanel";
import { CurrentsPanel } from "@/components/CurrentsPanel";
import { RoutesPanel } from "@/components/RoutesPanel";
import { HabitatPanel } from "@/components/HabitatPanel";
import { SeafloorClassificationPanel } from "@/components/SeafloorClassificationPanel";

// MOBILE-ONLY: shared monospace font stack used across the shell chrome.
const MONO = "'JetBrains Mono', monospace";

// MOBILE-ONLY: bottom tab definitions. "Chart" maps to the persisted
// 'explore' sidebarMode (the map itself); the other three open the bottom
// sheet with the corresponding existing panels.
const TABS: Array<{ mode: SidebarMode; label: string }> = [
  { mode: "explore", label: "Chart" },
  { mode: "plan", label: "Plan" },
  { mode: "analyze", label: "Analyze" },
  { mode: "live", label: "Live" },
];

/** MOBILE-ONLY: floating 1×/2×/3× contour-density segmented control. */
const DensityStepper: React.FC = () => {
  const contourDensity = useSettingsStore((s) => s.contourDensity);
  const setContourDensity = useSettingsStore((s) => s.setContourDensity);
  const contoursEnabled = useSettingsStore((s) => s.contoursEnabled);
  if (!contoursEnabled) return null;

  const active = toValidContourDensity(contourDensity);
  return (
    <div
      data-testid="mobile-density-stepper"
      role="group"
      aria-label="Contour density"
      style={{
        position: "absolute",
        right: 10,
        top: 64,
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        background: "rgba(2,8,18,0.85)",
        border: "1px solid rgba(0,229,255,0.25)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {CONTOUR_DENSITY_VALUES.map((d: ContourDensity) => (
        <button
          key={d}
          type="button"
          data-testid={`mobile-density-${d}x`}
          aria-pressed={active === d}
          onClick={() => setContourDensity(d)}
          style={{
            background: active === d ? "rgba(0,229,255,0.18)" : "transparent",
            border: "none",
            borderBottom: d !== 3 ? "1px solid rgba(0,229,255,0.12)" : "none",
            color: active === d ? "#00e5ff" : "#94a3b8",
            fontFamily: MONO,
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            minWidth: 44, // MOBILE-ONLY: thumb-sized touch target
            minHeight: 44,
            cursor: "pointer",
          }}
        >
          {d}×
        </button>
      ))}
    </div>
  );
};

/** MOBILE-ONLY: bottom sheet hosting existing panels per sidebar mode. */
const MobileBottomSheet: React.FC<{ mode: SidebarMode; onClose: () => void }> = ({
  mode,
  onClose,
}) => {
  // Real mobile-tailored tab content is owned by follow-up tasks; for now the
  // sheet simply hosts the existing prop-light desktop panels.
  let content: React.ReactNode = null;
  let title = "";
  if (mode === "plan") {
    title = "PLAN";
    content = (
      <>
        <CurrentsPanel embedded />
        <RoutesPanel />
      </>
    );
  } else if (mode === "analyze") {
    title = "ANALYZE";
    content = (
      <>
        <HabitatPanel embedded />
        <SeafloorClassificationPanel />
      </>
    );
  } else if (mode === "live") {
    title = "LIVE";
    content = <LivePanel />;
  }
  if (!content) return null;

  return (
    <div
      data-testid="mobile-bottom-sheet"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        maxHeight: "62%",
        display: "flex",
        flexDirection: "column",
        background: "rgba(2,8,18,0.97)",
        borderTop: "1px solid rgba(0,229,255,0.25)",
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          borderBottom: "1px solid rgba(0,229,255,0.15)",
          flex: "0 0 auto",
        }}
      >
        <span
          style={{
            color: "#00e5ff",
            fontFamily: MONO,
            fontSize: "calc(12.5px * var(--bs-font-scale, 1))",
            letterSpacing: "0.2em",
          }}
        >
          {title}
        </span>
        <button
          type="button"
          aria-label="Close panel"
          data-testid="mobile-sheet-close"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#94a3b8",
            fontSize: "calc(22px * var(--bs-font-scale, 1))",
            minWidth: 44,
            minHeight: 44,
            cursor: "pointer",
          }}
        >
          ×
        </button>
      </div>
      <div style={{ overflowY: "auto", padding: 12, flex: "1 1 auto" }}>
        <ErrorBoundary label="mobile panel">{content}</ErrorBoundary>
      </div>
    </div>
  );
};

export const MobileChartShell: React.FC = () => {
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const setSidebarMode = useUiStore((s) => s.setSidebarMode);
  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);
  const waterType = useSettingsStore((s) => s.waterType);
  const { isLoaded, isSignedIn } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Dataset name lookup for the chip (React Query dedupes these against the
  // picker's identical queries).
  const { data: datasets } = useGetDatasets(
    { waterType },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType }) } },
  );
  const { data: userDatasets } = useGetUserDatasets({
    query: {
      enabled: isLoaded && isSignedIn === true,
      queryKey: getGetUserDatasetsQueryKey(),
    },
  });
  const currentName =
    (primaryDatasetId &&
      ([...(datasets ?? []), ...(userDatasets ?? [])].find((d) => d.id === primaryDatasetId)
        ?.name ??
        primaryDatasetId)) ||
    "Choose dataset";

  return (
    <div
      data-testid="mobile-chart-shell"
      // MOBILE-ONLY layout: map area fills everything above the bottom tab bar.
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "#020817",
      }}
    >
      <div style={{ position: "relative", flex: "1 1 auto", overflow: "hidden" }}>
        <MobileChartView onOpenPicker={() => setPickerOpen(true)} />

        {/* MOBILE-ONLY: current-dataset chip → compact picker */}
        <button
          type="button"
          data-testid="mobile-dataset-chip"
          onClick={() => setPickerOpen(true)}
          style={{
            position: "absolute",
            left: 10,
            top: 10,
            zIndex: 40,
            maxWidth: "70%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            background: "rgba(2,8,18,0.85)",
            border: "1px solid rgba(0,229,255,0.25)",
            borderRadius: 8,
            color: "#00e5ff",
            fontFamily: MONO,
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            letterSpacing: "0.06em",
            padding: "0 14px",
            minHeight: 44, // MOBILE-ONLY: thumb-sized touch target
            cursor: "pointer",
          }}
        >
          {currentName} ▾
        </button>

        <DensityStepper />

        {sidebarMode !== "explore" && (
          <MobileBottomSheet mode={sidebarMode} onClose={() => setSidebarMode("explore")} />
        )}

        {pickerOpen && <MobileDatasetPicker onClose={() => setPickerOpen(false)} />}
      </div>

      {/* MOBILE-ONLY: thumb-reachable bottom tab bar (Chart/Plan/Analyze/Live).
          Writes through the existing persisted sidebarMode so the choice
          survives reloads and cross-device sync, and so Live-mode GPS
          orchestration (uiStore.setSidebarMode side effects) still runs. */}
      <nav
        data-testid="mobile-tab-bar"
        aria-label="Mobile navigation"
        style={{
          flex: "0 0 auto",
          display: "flex",
          background: "rgba(2,8,18,0.97)",
          borderTop: "1px solid rgba(0,229,255,0.25)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {TABS.map(({ mode, label }) => {
          const active = sidebarMode === mode;
          return (
            <button
              key={mode}
              type="button"
              data-testid={`mobile-tab-${mode}`}
              aria-pressed={active}
              onClick={() => setSidebarMode(mode)}
              style={{
                flex: "1 1 0",
                background: "none",
                border: "none",
                borderTop: active ? "2px solid #00e5ff" : "2px solid transparent",
                color: active ? "#00e5ff" : "#94a3b8",
                fontFamily: MONO,
                fontSize: "calc(11.5px * var(--bs-font-scale, 1))",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                minHeight: 52, // MOBILE-ONLY: thumb-sized touch target
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
