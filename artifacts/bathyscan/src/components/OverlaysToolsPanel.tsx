/**
 * OverlaysToolsPanel — single titled sidebar block grouping the overlay
 * and command toggles that used to live in the bottom-right HUD stack
 * (Overview, Find Data, Substrate, Wind, Tide, Current, EFH Zones).
 *
 * The Substrate Legend is rendered inline beneath the Substrate toggle
 * when substrate-tint mode is active, replacing its old bottom-right
 * floating placement.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useTerrainStore } from "@/lib/terrainStore";
import {
  useGetUserDatasetsIdHyd93Features,
  getGetUserDatasetsIdHyd93FeaturesQueryKey,
} from "@workspace/api-client-react";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import {
  useGetDatasets,
  getGetDatasetsQueryKey,
  useGetEfh,
  getGetEfhQueryKey,
  useGetEfhById,
  getGetEfhByIdQueryKey,
} from "@workspace/api-client-react";
import type { EfhFeature } from "@workspace/api-client-react";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { HelpIcon } from "@/components/help/HelpButton";
import { Spinner } from "@/components/ui/spinner";
import { useSurfaceConditions } from "@/hooks/useSurfaceConditions";
import { useWeatherStations } from "@/hooks/useWeatherStations";
import { useToast } from "@/hooks/use-toast";

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
  isLoading?: boolean;
}

const IS_TOUCH = typeof window !== "undefined" &&
  ("ontouchstart" in window || (navigator?.maxTouchPoints ?? 0) > 0);

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
  isLoading = false,
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
        color: active ? activeColor : "#e2e8f0",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        padding: "5px 10px",
        cursor: "pointer",
        letterSpacing: "0.12em",
        textShadow: active && activeGlow ? activeGlow : "none",
        transition: "all 0.15s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 4,
        ...(IS_TOUCH ? { minHeight: 44 } : {}),
      }}
    >
      <span>{label}</span>
      {isLoading && (
        <Spinner
          className="size-3 shrink-0"
          style={{ color: active ? activeColor : "#e2e8f0", opacity: 0.85 }}
        />
      )}
    </button>
  </ViewscreenTooltip>
);

export const OverlaysToolsPanel: React.FC = () => {
  const { terrain } = useAppState();
  const { toast } = useToast();
  const collapsed = usePanelCollapseStore((s) => s.collapsed.overlaysTools);
  const toggle = usePanelCollapseStore((s) => s.toggle);

  const visibleDatasets = useTerrainStore((s) => s.visibleDatasets);
  // Multi-primary: enable user-dataset overlays if ANY visible dataset is a user upload.
  const isUserDataset = visibleDatasets.some((v) => v.source === "user");

  const hyd93FeaturesEnabled = useUiStore((s) => s.hyd93FeaturesEnabled);
  const setHyd93FeaturesEnabled = useUiStore((s) => s.setHyd93FeaturesEnabled);
  const hyd93ActiveFeatureCodes = useUiStore((s) => s.hyd93ActiveFeatureCodes);
  const toggleHyd93FeatureCode = useUiStore((s) => s.toggleHyd93FeatureCode);

  const overviewOpen = useUiStore((s) => s.overviewOpen);
  const setOverviewOpen = useUiStore((s) => s.setOverviewOpen);
  const findDataPanelOpen = useUiStore((s) => s.findDataPanelOpen);
  const setFindDataPanelOpen = useUiStore((s) => s.setFindDataPanelOpen);
  const intertidalHotspotsEnabled = useUiStore((s) => s.intertidalHotspotsEnabled);
  const setIntertidalHotspotsEnabled = useUiStore((s) => s.setIntertidalHotspotsEnabled);
  const intertidalScoreMode = useUiStore((s) => s.intertidalScoreMode);
  const setIntertidalScoreMode = useUiStore((s) => s.setIntertidalScoreMode);
  const efhOverlayEnabled = useUiStore((s) => s.efhOverlayEnabled);
  const setEfhOverlayEnabled = useUiStore((s) => s.setEfhOverlayEnabled);
  const hiddenEfhSpecies = useUiStore((s) => s.hiddenEfhSpecies);
  const toggleEfhSpecies = useUiStore((s) => s.toggleEfhSpecies);
  const windOverlayActive = useUiStore((s) => s.windOverlayActive);
  const setWindOverlayActive = useUiStore((s) => s.setWindOverlayActive);
  const tideOverlayActive = useUiStore((s) => s.tideOverlayActive);
  const setTideOverlayActive = useUiStore((s) => s.setTideOverlayActive);
  const currentOverlayActive = useUiStore((s) => s.currentOverlayActive);
  const setCurrentOverlayActive = useUiStore((s) => s.setCurrentOverlayActive);
  const weatherStationsActive = useUiStore((s) => s.weatherStationsActive);
  const setWeatherStationsActive = useUiStore((s) => s.setWeatherStationsActive);
  const rawsOverlayActive = useUiStore((s) => s.rawsOverlayActive);
  const setRawsOverlayActive = useUiStore((s) => s.setRawsOverlayActive);

  const showWaterTempLayer = useSettingsStore((s) => s.showWaterTempLayer);
  const setShowWaterTempLayer = useSettingsStore((s) => s.setShowWaterTempLayer);
  const waterType = useSettingsStore((s) => s.waterType);
  const { data: datasets } = useGetDatasets(
    { waterType },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType }) } },
  );

  const datasetId = terrain?.datasetId ?? "";
  const embeddedPolygons = terrain?.habitatPolygons ?? null;

  const { data: hyd93FeaturesData } = useGetUserDatasetsIdHyd93Features(
    datasetId,
    {
      query: {
        enabled: !!datasetId && isUserDataset,
        queryKey: getGetUserDatasetsIdHyd93FeaturesQueryKey(datasetId),
        staleTime: 10 * 60 * 1000,
      },
    },
  );
  const hasHyd93Features = isUserDataset && Array.isArray(hyd93FeaturesData) && hyd93FeaturesData.length > 0;
  const hasEfh =
    !!datasets?.find((d) => d.id === datasetId)?.hasEfh ||
    !!embeddedPolygons ||
    isUserDataset;

  // Surface conditions loading/error state — shared across Wind, Tide, Current.
  // React Query dedupes with ConditionsOverlays so no extra network request.
  const anyConditionsActive =
    windOverlayActive || tideOverlayActive || currentOverlayActive;
  const {
    loading: surfaceLoading,
    error: surfaceError,
  } = useSurfaceConditions(anyConditionsActive);

  // Aviation weather stations — always fetch when terrain loaded so FAA button works
  // independently of the pin-overlay toggle.
  const {
    isLoading: wxLoading,
    isError: wxError,
    noaaUnavailable: wxNoaaUnavailable,
    faaWeatherCamsUrl,
  } = useWeatherStations();

  // User-uploaded datasets use the path-param route GET /efh/:id which performs
  // an auth + ownership check server-side and returns an empty FeatureCollection
  // (HTTP 200) when no EFH data is bundled for the upload area.
  const {
    isLoading: efhByIdLoading,
    isError: efhByIdError,
    data: efhByIdData,
  } = useGetEfhById(
    datasetId,
    undefined,
    {
      query: {
        enabled: isUserDataset && efhOverlayEnabled && !embeddedPolygons && !!datasetId,
        queryKey: getGetEfhByIdQueryKey(datasetId),
      },
    },
  );

  // EFH loading/error state + feature data — mirrors the enabled condition in EfhZoneLayer.
  // We also capture the feature data here to derive the per-species legend.
  const { isLoading: efhPresetLoading, isError: efhPresetError, data: efhData } = useGetEfh(
    { datasetId },
    {
      query: {
        enabled: hasEfh && efhOverlayEnabled && !embeddedPolygons && !isUserDataset && !!datasetId,
        queryKey: getGetEfhQueryKey({ datasetId }),
      },
    },
  );

  const efhLoading = isUserDataset ? efhByIdLoading : efhPresetLoading;
  const efhError = isUserDataset ? efhByIdError : efhPresetError;

  // Derive unique species entries for the per-species filter legend.
  // Prefer embedded polygons (user-saved datasets), then UUID-route data, then preset data.
  const activeEfhFeatures: EfhFeature[] = useMemo(
    () =>
      (embeddedPolygons?.features as EfhFeature[] | undefined) ??
      (efhByIdData?.features as EfhFeature[] | undefined) ??
      efhData?.features ??
      [],
    [embeddedPolygons, efhByIdData, efhData],
  );
  const efhSpeciesEntries = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of activeEfhFeatures) {
      const { commonName, color } = f.properties;
      if (!seen.has(commonName)) seen.set(commonName, color);
    }
    return Array.from(seen.entries());
  }, [activeEfhFeatures]);

  // --- Error recovery: revert overlays to inactive on fetch failure ---
  // Use refs to detect false→true transitions only (avoid re-triggering on
  // every render while the error persists).
  const prevSurfaceError = useRef(false);
  useEffect(() => {
    if (surfaceError && !prevSurfaceError.current) {
      // Revert every active surface-condition overlay.
      const affected: string[] = [];
      if (windOverlayActive) { setWindOverlayActive(false); affected.push("Wind"); }
      if (tideOverlayActive) { setTideOverlayActive(false); affected.push("Tide"); }
      if (currentOverlayActive) { setCurrentOverlayActive(false); affected.push("Current"); }
      if (affected.length > 0) {
        toast({
          title: `${affected.join(" / ")} overlay failed`,
          description: "Could not fetch conditions data. The overlay has been turned off.",
          variant: "destructive",
        });
      }
    }
    prevSurfaceError.current = surfaceError;
  }, [
    surfaceError,
    windOverlayActive, setWindOverlayActive,
    tideOverlayActive, setTideOverlayActive,
    currentOverlayActive, setCurrentOverlayActive,
    toast,
  ]);

  const prevEfhError = useRef(false);
  useEffect(() => {
    if (efhError && !prevEfhError.current) {
      if (efhOverlayEnabled) {
        setEfhOverlayEnabled(false);
        toast({
          title: "EFH overlay failed",
          description: "Could not fetch Essential Fish Habitat data. The overlay has been turned off.",
          variant: "destructive",
        });
      }
    }
    prevEfhError.current = efhError;
  }, [efhError, efhOverlayEnabled, setEfhOverlayEnabled, toast]);

  const prevWxError = useRef(false);
  useEffect(() => {
    if (wxError && !prevWxError.current) {
      // noaa_unavailable is a known, recoverable outage — keep the overlay on
      // so the user can retry without re-enabling it. Only unexpected errors
      // (network failures, server crashes, etc.) should disable the overlay.
      if (!wxNoaaUnavailable && weatherStationsActive) {
        setWeatherStationsActive(false);
        toast({
          title: "Weather stations failed",
          description: "Could not fetch NOAA station data. The overlay has been turned off.",
          variant: "destructive",
        });
      }
    }
    prevWxError.current = wxError;
  }, [wxError, wxNoaaUnavailable, weatherStationsActive, setWeatherStationsActive, toast]);

  return (
    <div
      data-testid="overlays-tools-panel"
      style={{ ...PANEL, pointerEvents: "auto" }}
      className="select-none"
    >
      <div
        onClick={() => toggle("overlaysTools")}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors rounded-t"
        style={{ cursor: "pointer" }}
      >
        <ViewscreenTooltip
          label={collapsed ? "Show overlays & tools" : "Hide overlays & tools"}
          side="right"
        >
          <span
            className="uppercase tracking-widest"
            style={{ fontSize: 11, ...CYAN, fontWeight: 700 }}
          >
            ▼ Overlays &amp; Tools
          </span>
        </ViewscreenTooltip>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <HelpIcon articleId="hud-overlays" label="HUD overlay toggles" />
          <span style={{ color: "#cbd5e1", fontSize: 24, lineHeight: 1 }}>
            {collapsed ? "▸" : "▾"}
          </span>
        </span>
      </div>

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
            testId="overlay-toggle-wind"
            active={windOverlayActive}
            onClick={() => setWindOverlayActive(!windOverlayActive)}
            label="💨 WIND"
            tooltip="Toggle wind direction arrows overlay"
            activeBg="rgba(0,229,255,0.10)"
            activeBorder="rgba(125,211,252,0.5)"
            activeColor="#7dd3fc"
            activeGlow="0 0 6px rgba(125,211,252,0.5)"
            isLoading={windOverlayActive && surfaceLoading}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
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
                isLoading={tideOverlayActive && surfaceLoading}
              />
            </div>
            <ViewscreenTooltip
              label="Draws tidal flow arrows using the surface-conditions feed (shared with Wind and Current). Does not open the Tide data panel — use the TIDAL 3D DATA button in the top bar for the animated water plane, NOAA station data, and depth-layer selector."
              side="right"
            >
              <button
                className="help-inline-icon"
                onClick={e => e.stopPropagation()}
                aria-label="About TIDE overlay"
              >
                ℹ
              </button>
            </ViewscreenTooltip>
          </div>

          <ToggleButton
            testId="overlay-toggle-current"
            active={currentOverlayActive}
            onClick={() => setCurrentOverlayActive(!currentOverlayActive)}
            label="↬ CURRENT"
            tooltip="Show real-time NOAA tidal current arrows — live surface-conditions data, not the seafloor simulation"
            activeBg="rgba(0,229,255,0.10)"
            activeBorder="rgba(34,211,238,0.5)"
            activeColor="#22d3ee"
            activeGlow="0 0 6px rgba(34,211,238,0.5)"
            isLoading={currentOverlayActive && surfaceLoading}
          />

          {/* Aviation Weather section — saltwater only, disabled when no terrain */}
          {waterType !== "freshwater" && (
            <>
              <div
                style={{
                  borderTop: "1px solid rgba(0,229,255,0.08)",
                  marginTop: 4,
                  paddingTop: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    color: "#64748b",
                    textTransform: "uppercase",
                  }}
                >
                  Aviation Weather
                </span>
              </div>

              <ViewscreenTooltip
                label={
                  !terrain
                    ? "Load a terrain dataset to enable weather stations"
                    : weatherStationsActive
                    ? "Hide NOAA ASOS/AWOS weather station pins"
                    : "Show NOAA aviation weather station pins on the Overview Map"
                }
                side="right"
              >
                <button
                  data-testid="overlay-toggle-weather-stations"
                  aria-pressed={weatherStationsActive}
                  disabled={!terrain}
                  onClick={() => {
                    const next = !weatherStationsActive;
                    setWeatherStationsActive(next);
                    // Auto-open Overview Map when enabling (matching tidal behavior)
                    if (next) setOverviewOpen(true);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: weatherStationsActive
                      ? "rgba(251,191,36,0.12)"
                      : "rgba(0,10,20,0.55)",
                    border: `1px solid ${
                      weatherStationsActive
                        ? "rgba(251,191,36,0.5)"
                        : "rgba(0,229,255,0.15)"
                    }`,
                    borderRadius: 4,
                    color: !terrain
                      ? "#475569"
                      : weatherStationsActive
                      ? "#fbbf24"
                      : "#e2e8f0",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    padding: "5px 10px",
                    cursor: !terrain ? "not-allowed" : "pointer",
                    letterSpacing: "0.12em",
                    textShadow:
                      weatherStationsActive
                        ? "0 0 6px rgba(251,191,36,0.5)"
                        : "none",
                    transition: "all 0.15s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 4,
                    opacity: !terrain ? 0.5 : 1,
                    ...(IS_TOUCH ? { minHeight: 44 } : {}),
                  }}
                >
                  <span>🛩 NOAA WEATHER STATIONS</span>
                  {weatherStationsActive && wxLoading && (
                    <Spinner
                      className="size-3 shrink-0"
                      style={{ color: "#fbbf24", opacity: 0.85 }}
                    />
                  )}
                </button>
              </ViewscreenTooltip>

              {wxNoaaUnavailable && (
                <div
                  data-testid="wx-noaa-unavailable-notice"
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.06em",
                    color: "#fbbf24",
                    background: "rgba(251,191,36,0.08)",
                    border: "1px solid rgba(251,191,36,0.25)",
                    borderRadius: 4,
                    padding: "5px 8px",
                    lineHeight: 1.5,
                  }}
                >
                  ⚠ Weather data temporarily unavailable — try again in a few minutes.
                </div>
              )}

              <ViewscreenTooltip
                label={
                  !terrain
                    ? "Load a terrain dataset to enable FAA WeatherCams"
                    : faaWeatherCamsUrl
                    ? "Open FAA WeatherCams for this region in a new tab"
                    : "FAA WeatherCams (available inside the US)"
                }
                side="right"
              >
                <a
                  href={faaWeatherCamsUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!terrain || !faaWeatherCamsUrl}
                  onClick={
                    !terrain || !faaWeatherCamsUrl
                      ? (e) => e.preventDefault()
                      : undefined
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    textAlign: "left",
                    background: "rgba(0,10,20,0.55)",
                    border: "1px solid rgba(0,229,255,0.15)",
                    borderRadius: 4,
                    color:
                      !terrain || !faaWeatherCamsUrl ? "#475569" : "#7dd3fc",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    padding: "5px 10px",
                    cursor:
                      !terrain || !faaWeatherCamsUrl
                        ? "not-allowed"
                        : "pointer",
                    letterSpacing: "0.12em",
                    textDecoration: "none",
                    transition: "all 0.15s ease",
                    opacity: !terrain || !faaWeatherCamsUrl ? 0.5 : 1,
                    ...(IS_TOUCH ? { minHeight: 44 } : {}),
                  }}
                >
                  <span>📷 FAA WEATHERCAMS ↗</span>
                </a>
              </ViewscreenTooltip>
            </>
          )}

          {/* RAWS Land Weather section — saltwater only, disabled when no terrain */}
          {waterType !== "freshwater" && (
            <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)", marginTop: 4, paddingTop: 6 }}>
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  color: "#64748b",
                  textTransform: "uppercase",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Land Weather (RAWS)
              </span>
              <ViewscreenTooltip
                label={
                  !terrain
                    ? "Load a terrain dataset to enable RAWS stations"
                    : rawsOverlayActive
                    ? "Hide AOOS RAWS land weather station pins"
                    : "Show AOOS RAWS land weather station pins on the Overview Map"
                }
                side="right"
              >
                <button
                  data-testid="overlay-toggle-raws"
                  aria-pressed={rawsOverlayActive}
                  disabled={!terrain}
                  onClick={() => {
                    const next = !rawsOverlayActive;
                    setRawsOverlayActive(next);
                    if (next) setOverviewOpen(true);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: rawsOverlayActive ? "rgba(52,211,153,0.12)" : "rgba(0,10,20,0.55)",
                    border: `1px solid ${rawsOverlayActive ? "rgba(52,211,153,0.5)" : "rgba(0,229,255,0.15)"}`,
                    borderRadius: 4,
                    color: !terrain ? "#475569" : rawsOverlayActive ? "#34d399" : "#e2e8f0",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    padding: "5px 10px",
                    cursor: !terrain ? "not-allowed" : "pointer",
                    letterSpacing: "0.12em",
                    textShadow: rawsOverlayActive ? "0 0 6px rgba(52,211,153,0.5)" : "none",
                    transition: "all 0.15s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 4,
                    opacity: !terrain ? 0.5 : 1,
                    ...(IS_TOUCH ? { minHeight: 44 } : {}),
                  }}
                >
                  <span>🌿 RAWS WEATHER STATIONS</span>
                </button>
              </ViewscreenTooltip>
            </div>
          )}

          <ToggleButton
            active={intertidalHotspotsEnabled}
            onClick={() => setIntertidalHotspotsEnabled(!intertidalHotspotsEnabled)}
            label="🌊 INTERTIDAL HOTSPOTS"
            tooltip="Score & display tidepool and beachcombing hotspots (SE Alaska ShoreZone)"
            activeBg="rgba(13,148,136,0.15)"
            activeBorder="rgba(13,148,136,0.55)"
            activeColor="#2dd4bf"
            activeGlow="rgba(13,148,136,0.4)"
          />
          {intertidalHotspotsEnabled && (
            <div
              style={{
                marginTop: 2,
                paddingLeft: 8,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  color: "#94a3b8",
                  textTransform: "uppercase",
                }}
              >
                Highlight mode
              </span>
              <div style={{ display: "flex", gap: 3 }}>
                <ViewscreenTooltip label="Show tidepool hotspot polygons (teal)" side="right">
                  <button
                    aria-pressed={intertidalScoreMode === "tidepool"}
                    onClick={() => setIntertidalScoreMode("tidepool")}
                    style={{
                      flex: 1,
                      padding: "4px 6px",
                      borderRadius: 3,
                      border: `1px solid ${intertidalScoreMode === "tidepool" ? "rgba(13,148,136,0.7)" : "rgba(255,255,255,0.1)"}`,
                      background: intertidalScoreMode === "tidepool" ? "rgba(13,148,136,0.2)" : "rgba(0,10,20,0.45)",
                      color: intertidalScoreMode === "tidepool" ? "#2dd4bf" : "#64748b",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.15s ease",
                      textShadow: intertidalScoreMode === "tidepool" ? "0 0 6px rgba(13,148,136,0.5)" : "none",
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 1, background: "#0d9488", flexShrink: 0 }} />
                    TIDEPOOL
                  </button>
                </ViewscreenTooltip>
                <ViewscreenTooltip label="Show beachcombing hotspot polygons (amber)" side="right">
                  <button
                    aria-pressed={intertidalScoreMode === "beachcombing"}
                    onClick={() => setIntertidalScoreMode("beachcombing")}
                    style={{
                      flex: 1,
                      padding: "4px 6px",
                      borderRadius: 3,
                      border: `1px solid ${intertidalScoreMode === "beachcombing" ? "rgba(217,119,6,0.7)" : "rgba(255,255,255,0.1)"}`,
                      background: intertidalScoreMode === "beachcombing" ? "rgba(217,119,6,0.18)" : "rgba(0,10,20,0.45)",
                      color: intertidalScoreMode === "beachcombing" ? "#fbbf24" : "#64748b",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.15s ease",
                      textShadow: intertidalScoreMode === "beachcombing" ? "0 0 6px rgba(217,119,6,0.4)" : "none",
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 1, background: "#d97706", flexShrink: 0 }} />
                    BEACH
                  </button>
                </ViewscreenTooltip>
              </div>
              <span style={{ fontSize: 9, color: "#64748b", lineHeight: 1.4 }}>
                Opacity ∝ score intensity. Click polygon for score card.
              </span>
            </div>
          )}

          <ToggleButton
            testId="overlay-toggle-water-temp"
            active={showWaterTempLayer}
            onClick={() => setShowWaterTempLayer(!showWaterTempLayer)}
            label="🌡 TEMP LAYER"
            tooltip={showWaterTempLayer ? "Hide water temperature volume" : "Show semi-transparent water temperature volume (thermal gradient by depth)"}
            activeBg="rgba(251,146,60,0.12)"
            activeBorder="rgba(251,146,60,0.55)"
            activeColor="#fb923c"
            activeGlow="0 0 6px rgba(251,146,60,0.5)"
          />

          {hasHyd93Features && (
            <>
              <ToggleButton
                active={hyd93FeaturesEnabled}
                onClick={() => setHyd93FeaturesEnabled(!hyd93FeaturesEnabled)}
                label="🗺 HYD93 FEATURES"
                tooltip="Show kelp, rocks, rocky reefs, ledges and obstructions from the HYD93 survey archive"
                activeBg="rgba(14,165,233,0.15)"
                activeBorder="rgba(14,165,233,0.55)"
                activeColor="#38bdf8"
                activeGlow="0 0 6px rgba(14,165,233,0.5)"
              />
              {hyd93FeaturesEnabled && (
                <div
                  style={{
                    marginTop: 2,
                    paddingLeft: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      color: "#94a3b8",
                      textTransform: "uppercase",
                      paddingBottom: 2,
                    }}
                  >
                    Filter by type
                  </span>
                  {([
                    { code: 89,  label: "Rocks",       color: "#ef4444" },
                    { code: 103, label: "Kelp",        color: "#22c55e" },
                    { code: 146, label: "Ledge",       color: "#eab308" },
                    { code: 530, label: "Rocky reef",  color: "#f97316" },
                    { code: 988, label: "Obstruction", color: "#a855f7" },
                  ] as const).map(({ code, label, color }) => {
                    const active = hyd93ActiveFeatureCodes.has(code);
                    return (
                      <ViewscreenTooltip
                        key={code}
                        label={active ? `Hide ${label}` : `Show ${label}`}
                        side="right"
                      >
                        <button
                          aria-pressed={active}
                          onClick={() => toggleHyd93FeatureCode(code)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            background: active ? "rgba(0,10,20,0.45)" : "transparent",
                            border: `1px solid ${active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`,
                            borderRadius: 3,
                            color: active ? "#cbd5e1" : "#64748b",
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 10,
                            padding: "3px 8px",
                            cursor: "pointer",
                            letterSpacing: "0.08em",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            transition: "all 0.12s ease",
                            opacity: active ? 1 : 0.5,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 2,
                              background: active ? color : "transparent",
                              border: `1px solid ${color}`,
                              flexShrink: 0,
                              transition: "background 0.12s ease",
                            }}
                          />
                          {label.toUpperCase()}
                        </button>
                      </ViewscreenTooltip>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {hasEfh && (
            <>
              <ToggleButton
                active={efhOverlayEnabled}
                onClick={() => setEfhOverlayEnabled(!efhOverlayEnabled)}
                label="🐟 ESSENTIAL FISH HABITAT"
                tooltip="Show Essential Fish Habitat zones overlay"
                activeBg="rgba(34,197,94,0.15)"
                activeBorder="rgba(34,197,94,0.5)"
                activeColor="#4ade80"
                isLoading={efhOverlayEnabled && efhLoading}
              />
              {efhOverlayEnabled && isUserDataset && !efhByIdLoading && activeEfhFeatures.length === 0 && (
                <div
                  style={{
                    marginTop: 4,
                    paddingLeft: 8,
                    fontSize: 9,
                    color: "#94a3b8",
                    fontStyle: "italic",
                    letterSpacing: "0.05em",
                  }}
                >
                  No EFH coverage for this upload area.
                </div>
              )}
              {efhOverlayEnabled && efhSpeciesEntries.length > 0 && (
                <div
                  style={{
                    marginTop: 2,
                    paddingLeft: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      color: "#94a3b8",
                      textTransform: "uppercase",
                      paddingBottom: 2,
                    }}
                  >
                    Filter by species
                  </span>
                  {efhSpeciesEntries.map(([name, color]) => {
                    const hidden = hiddenEfhSpecies.has(name);
                    return (
                      <ViewscreenTooltip
                        key={name}
                        label={hidden ? `Show ${name}` : `Hide ${name}`}
                        side="right"
                      >
                        <button
                          aria-pressed={!hidden}
                          title={hidden ? `Show ${name}` : `Hide ${name}`}
                          onClick={() => toggleEfhSpecies(name)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            background: hidden ? "transparent" : "rgba(0,10,20,0.45)",
                            border: `1px solid ${hidden ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.12)"}`,
                            borderRadius: 3,
                            color: hidden ? "#64748b" : "#cbd5e1",
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 10,
                            padding: "3px 8px",
                            cursor: "pointer",
                            letterSpacing: "0.08em",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            transition: "all 0.12s ease",
                            opacity: hidden ? 0.5 : 1,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 2,
                              background: hidden ? "transparent" : color,
                              border: `1px solid ${color}`,
                              flexShrink: 0,
                              transition: "background 0.12s ease",
                            }}
                          />
                          <span
                            style={{
                              textDecoration: hidden ? "line-through" : "none",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {name}
                          </span>
                        </button>
                      </ViewscreenTooltip>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
