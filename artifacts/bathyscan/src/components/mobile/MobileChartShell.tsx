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
import React, { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
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
import { startMobileGpsCameraMirror } from "@/lib/mobileMapFollow";
import { useProximityStreamingWiring } from "@/hooks/useProximityStreamingWiring";
import { MobileChartView } from "./MobileChartView";
import { MobileDatasetPicker, type MobilePickerMode } from "./MobileDatasetPicker";
import { MobileLiveOverlay } from "./MobileLiveOverlay";
import { BulkOfflinePanel } from "@/components/BulkOfflinePanel";
import type { BulkDataset } from "@/hooks/useBulkOfflinePack";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LivePanel } from "@/components/LivePanel";
import { CurrentsPanel } from "@/components/CurrentsPanel";
import { RoutesPanel } from "@/components/RoutesPanel";
import { HabitatPanel } from "@/components/HabitatPanel";
import { SeafloorClassificationPanel } from "@/components/SeafloorClassificationPanel";
import { ProximityHudChip } from "@/components/ProximityHudChip";

// Base path matches App.tsx — used for gear-button navigation.
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

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
const MobileBottomSheet: React.FC<{
  mode: SidebarMode;
  onClose: () => void;
  /** MOBILE-ONLY: Plan-tab content assembled by App (needs tide fetch state). */
  planContent?: React.ReactNode;
  /**
   * MOBILE-ONLY: when provided (Live tab), renders a minimize button that
   * hides the sheet WITHOUT leaving the tab — so the Live chart-plotter view
   * (chart + GPS dot + depth readout) can go full-screen while GPS, trail
   * recording, and follow keep running. The × close button still exits the
   * tab entirely (existing behaviour).
   */
  onCollapse?: () => void;
}> = ({ mode, onClose, planContent, onCollapse }) => {
  // Real mobile-tailored tab content is owned by follow-up tasks; for now the
  // sheet simply hosts the existing prop-light desktop panels.
  let content: React.ReactNode = null;
  let title = "";
  if (mode === "plan") {
    title = "PLAN";
    content = planContent ?? (
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
        <div style={{ display: "flex", alignItems: "center" }}>
          {onCollapse && (
            <button
              type="button"
              aria-label="Minimize panel"
              data-testid="mobile-sheet-collapse"
              onClick={onCollapse}
              style={{
                background: "none",
                border: "none",
                color: "#94a3b8",
                fontSize: "calc(18px * var(--bs-font-scale, 1))",
                minWidth: 44,
                minHeight: 44,
                cursor: "pointer",
              }}
            >
              ▾
            </button>
          )}
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
      </div>
      <div style={{ overflowY: "auto", padding: 12, flex: "1 1 auto" }}>
        <ErrorBoundary label="mobile panel">{content}</ErrorBoundary>
      </div>
    </div>
  );
};

interface MobileChartShellProps {
  /** MOBILE-ONLY: Plan-tab content assembled by App (needs tide fetch state). */
  planContent?: React.ReactNode;
  /** MOBILE-ONLY: show activity dot on the Chart/Explore tab (e.g. tidal overlay on). */
  exploreIndicator?: boolean;
  /** MOBILE-ONLY: show activity dot on the Live tab (e.g. realistic mode on). */
  liveIndicator?: boolean;
}
export const MobileChartShell: React.FC<MobileChartShellProps> = ({
  planContent,
  exploreIndicator,
  liveIndicator,
}) => {
  const [, setLocation] = useLocation();
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const setSidebarMode = useUiStore((s) => s.setSidebarMode);
  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);
  const waterType = useSettingsStore((s) => s.waterType);
  const { isLoaded, isSignedIn } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  // MOBILE-ONLY: dataset-picker tap semantics — "replace" (default) evicts,
  // "add" stacks alongside what's loaded. Reset to "replace" whenever the
  // picker closes so re-opening always starts in the familiar Replace mode.
  const [pickerMode, setPickerMode] = useState<MobilePickerMode>("replace");
  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerMode("replace");
  }, []);
  // MOBILE-ONLY: pending offline download — set by the dataset picker's per-dataset
  // or section-level download buttons; cleared when the panel is closed.
  const [offlinePanel, setOfflinePanel] = useState<{
    datasets: BulkDataset[];
    label: string;
  } | null>(null);
  const handleDownloadOffline = useCallback((datasets: BulkDataset[], label: string) => {
    setPickerOpen(false);
    setPickerMode("replace");
    setOfflinePanel({ datasets, label });
  }, []);
  // MOBILE-ONLY: Live-tab bottom sheet minimized state — lets the chart go
  // full-screen while GPS/trail/follow keep running. Reset on tab change so
  // re-entering Live always shows the controls first.
  const [liveSheetCollapsed, setLiveSheetCollapsed] = useState(false);
  useEffect(() => {
    setLiveSheetCollapsed(false);
  }, [sidebarMode]);

  // MOBILE-ONLY: mirror GPS fixes into cameraStore.cameraPosition. Proximity
  // streaming and the follow bounds check read the CAMERA position; with no
  // 3D camera mounted on mobile, the GPS fix is the camera.
  useEffect(() => startMobileGpsCameraMirror(), []);

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

  // MOBILE-ONLY host for the SAME proximity-streaming machinery DatasetPanel
  // runs on desktop (bbox map, pool auto-registration, activation fetches,
  // 500 ms sampling). DatasetPanel never mounts on mobile, so without this the
  // Live tab's dataset auto-switching would silently go dead.
  useProximityStreamingWiring({ datasets, userDatasets });

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

        {/* MOBILE-ONLY: floating gear icon → Settings (top-right, above dataset chip) */}
        <button
          type="button"
          data-testid="mobile-settings-gear"
          aria-label="Open Settings"
          onClick={() => setLocation(basePath + "/settings")}
          style={{
            position: "absolute",
            top: "calc(env(safe-area-inset-top, 0px) + 8px)",
            right: 10,
            zIndex: 40,
            width: 40,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,10,20,0.85)",
            border: "1px solid rgba(0,229,255,0.4)",
            borderRadius: 8,
            color: "#94a3b8",
            fontSize: "calc(22px * var(--bs-font-scale, 1))",
            backdropFilter: "blur(6px)",
            cursor: "pointer",
          }}
        >
          ⚙
        </button>

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

        {/* MOBILE-ONLY: left overlay column under the dataset chip — Live
            readout (depth/heading/speed) when the Live tab is active, plus
            the proximity-streaming HUD chip (same feedback as the desktop
            HUD's bottom-left chip; renders null when proximityMode is off). */}
        <div
          style={{
            position: "absolute",
            left: 10,
            top: 64,
            zIndex: 40,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            maxWidth: "70%",
            pointerEvents: "none",
          }}
        >
          {sidebarMode === "live" && <MobileLiveOverlay />}
          <div style={{ pointerEvents: "auto", width: "fit-content" }}>
            <ProximityHudChip />
          </div>
        </div>

        {sidebarMode !== "explore" && !(sidebarMode === "live" && liveSheetCollapsed) && (
          <MobileBottomSheet
            mode={sidebarMode}
            onClose={() => setSidebarMode("explore")}
            // MOBILE-ONLY: only the Live sheet can be minimized — Plan/Analyze
            // have no full-screen chart interaction to get back to.
            onCollapse={
              sidebarMode === "live" ? () => setLiveSheetCollapsed(true) : undefined
            }
            planContent={planContent}
          />
        )}

        {/* MOBILE-ONLY: floating pill to restore the minimized Live sheet. */}
        {sidebarMode === "live" && liveSheetCollapsed && (
          <button
            type="button"
            data-testid="mobile-live-sheet-restore"
            onClick={() => setLiveSheetCollapsed(false)}
            style={{
              position: "absolute",
              bottom: 10,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 45,
              background: "rgba(2,8,18,0.92)",
              border: "1px solid rgba(0,229,255,0.35)",
              borderRadius: 999,
              color: "#00e5ff",
              fontFamily: MONO,
              fontSize: "calc(11.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.1em",
              padding: "0 18px",
              minHeight: 44, // MOBILE-ONLY: thumb-sized touch target
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ▴ LIVE CONTROLS
          </button>
        )}

        {pickerOpen && (
          <MobileDatasetPicker
            onClose={closePicker}
            onDownloadOffline={handleDownloadOffline}
            mode={pickerMode}
            onModeChange={setPickerMode}
          />
        )}

        {/* MOBILE-ONLY: BulkOfflinePanel overlay — opened by the dataset picker's
            per-dataset "⬇" or section-level "⬇ All" buttons. */}
        {offlinePanel && (
          <div
            data-testid="mobile-offline-panel-overlay"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 70,
              background: "rgba(2,8,18,0.97)",
              overflowY: "auto",
            }}
          >
            <BulkOfflinePanel
              datasets={offlinePanel.datasets}
              scopeLabel={offlinePanel.label}
              onClose={() => setOfflinePanel(null)}
            />
          </div>
        )}
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
          const hasIndicator =
            (mode === "explore" && exploreIndicator) ||
            (mode === "live" && liveIndicator);
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
                position: "relative",
              }}
            >
              {label}
              {hasIndicator && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: 6,
                    right: "calc(50% - 14px)",
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "#00e5ff",
                    opacity: 0.75,
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
