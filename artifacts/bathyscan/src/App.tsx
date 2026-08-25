import React, { useEffect, useMemo, useRef, useState } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from "@/lib/clerkCompat";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  queryClient,
  useIsConnecting,
  useIsServiceUnavailable,
  useHealthResponseTime,
  setClerkLoaded,
  signalSessionExpired,
  useIsSessionExpired,
} from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetDatasets, useGetUserDatasets, getGetDatasetsQueryKey, getGetUserDatasetsQueryKey, setAuthTokenGetter } from "@workspace/api-client-react";
import { AppProvider, useAppState } from "@/lib/context";
import { useTerrainStore } from "@/lib/terrainStore";
import NotFound from "@/pages/not-found";
import { Settings } from "@/pages/Settings";
import { HUD } from "@/components/HUD";
import { DepthScaleBar } from "@/components/DepthScaleBar";
import { OverlaysToolsPanel } from "@/components/OverlaysToolsPanel";
import { DatasetPanel } from "@/components/DatasetPanel";
import { SidebarSection, SidebarSectionGroup } from "@/components/SidebarSection";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import { SidebarModeTabs } from "@/components/SidebarModeTabs";
import { ToolbarRelocationHint } from "@/components/ToolbarRelocationHint";
import { LivePanel } from "@/components/LivePanel";
import { Minimap } from "@/components/Minimap";
import { ControlsLegend } from "@/components/ControlsLegend";
import { AppHeader } from "@/components/AppHeader";
import { TidePanel } from "@/components/TidePanel";
import { useTidalSchedule } from "@/hooks/useTidalSchedule";
import { TideStationPanel } from "@/components/TideStationPanel";
import { useTidalStore } from "@/lib/tidalStore";
import { interpolateTideHeightFt, FEET_TO_METERS } from "@/lib/tidePrediction";
import { CurrentsPanel } from "@/components/CurrentsPanel";
import { useCurrentsStore } from "@/lib/currentsStore";
import { ThrottlePanel } from "@/components/ThrottlePanel";
import { MarkerForm } from "@/components/MarkerForm";
import { QuickDropButton } from "@/components/QuickDropButton";
import { WakeLockManager } from "@/components/WakeLockManager";
import { useMarkerEditStore } from "@/lib/markerEditStore";
import { ContextMenu } from "@/components/ContextMenu";
import { MeasurementBanner } from "@/components/MeasurementBanner";
import { LandTerrainStatusBanner } from "@/components/LandTerrainStatusBanner";
import { DevApiDownBanner } from "@/components/DevApiDownBanner";
import { DepthProfilePanel } from "@/components/DepthProfilePanel";
import { MarkerDetailCard } from "@/components/MarkerDetailCard";
import { CatchJournalPanel } from "@/components/CatchJournalPanel";
import { OverviewMap } from "@/components/OverviewMap";
import { MarkersPanel } from "@/components/MarkersPanel";
import { EfhDetailPanel } from "@/components/EfhDetailPanel";
import { SubstrateDetailPanel } from "@/components/SubstrateDetailPanel";
import { IntertidalHotspotCard } from "@/components/IntertidalHotspotCard";
import { SeafloorClassificationPanel } from "@/components/SeafloorClassificationPanel";
import { FindDataPanel } from "@/components/FindDataPanel";
import { HabitatPanel } from "@/components/HabitatPanel";
import { HabitatLegend } from "@/components/HabitatLegend";
import { IntertidalBandLegend } from "@/components/IntertidalBandLegend";
import { QueryPanel } from "@/components/QueryPanel";
import { VirtualJoystick } from "@/components/VirtualJoystick";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { useTidalData } from "@/hooks/useTidalData";
import { useUiStore } from "@/lib/uiStore";
import { useHighlightStore } from "@/lib/highlightStore";
import { useTrailStore } from "@/lib/trailStore";
import { RecChip } from "@/components/RecChip";
import { useOfflineStore } from "@/lib/offlineStore";
import { getTokenWithRetry } from "@/lib/offlineDetection";
export { getTokenWithRetry, GET_TOKEN_RETRY_DELAY_MS } from "@/lib/offlineDetection";
import type { DepthLayer } from "@/components/TidalCurrentArrows";
import { toValidDepthLayer } from "@/lib/depthLayerGuard";
import { useSettingsStore } from "@/lib/settingsStore";
import { useToast } from "@/hooks/use-toast";
import { getBoundKey } from "@/lib/keyBindings";
import {
  flushPendingTrails,
  flushPendingMarkers,
  createFlushAllWithGuard,
} from "@/lib/offlineFlush";
import { useWaterTypeSideEffects } from "@/lib/useWaterTypeSideEffects";
import { useActiveDatasetSync } from "@/lib/useActiveDatasetSync";
import { VisibleDatasetsLoader } from "@/lib/VisibleDatasetsLoader";
import { waterLabels } from "@/lib/waterLabels";
import { useServerSettingsSync, requestSettingsSync } from "@/hooks/useServerSettingsSync";
import { useCrossTabSync } from "@/hooks/useCrossTabSync";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CopyButton } from "@/components/ui/CopyButton";
import { AccessGate } from "@/components/AccessGate";
import { useDriftStore } from "@/lib/driftStore";
import { useMarkerLayerStore } from "@/lib/markerLayerStore";
import { WeatherPanel } from "@/components/WeatherPanel";
import { DriftPlannerPanel } from "@/components/DriftPlannerPanel";
import { ManualConditionsChip } from "@/components/ManualConditionsChip";
import { DriftTimeline } from "@/components/DriftTimeline";
import { HelpButton } from "@/components/help/HelpButton";
import { HelpWindow } from "@/components/help/HelpWindow";
import { ZoneLegendChip } from "@/components/help/ZoneLegendChip";
import { RoutesPanel } from "@/components/RoutesPanel";
import "@/components/help/help.css";
import { ConditionsLegend } from "@/components/ConditionsLegend";
import { ForecastStrip } from "@/components/ForecastStrip";
import { TripWindowPanel } from "@/components/TripWindowPanel";
import { SimulatedDataConfirmDialog } from "@/components/SimulatedDataConfirmDialog";
import { SettingsSyncIndicator } from "@/components/SettingsSyncIndicator";
import { requestDatasetSwitch } from "@/lib/simulatedDataStore";
import { initialViewParams } from "@/lib/viewUrl";
import { resolveDefaultDataset } from "@/lib/defaultMapLoadLogic";
import { useUrlSync } from "@/hooks/useUrlSync";
import { usePaletteSuggestion } from "@/hooks/usePaletteSuggestion";
import { ShallowDatasetBanner } from "@/components/ShallowDatasetBanner";
import { lonLatToWorldXZ, MAX_DEPTH_WORLD } from "@/lib/terrain";
import { OnboardingOverlay } from "@/components/OnboardingOverlay";
import { useWebglContextStore } from "@/lib/webglContextStore";
import { useCameraStore } from "@/lib/cameraStore";
import { DEV_AUTH_BYPASS } from "@/lib/devAuth";
import { useTimelineStore } from "@/lib/timelineStore";
import { TimelineScrubBar } from "@/components/TimelineScrubBar";
import { WhatsHereCard } from "@/components/WhatsHereCard";
import { useWhatsHere } from "@/hooks/useWhatsHere";
import { OfflineReadOnlyBanner, persistOfflineIdentity } from "@/components/OfflineReadOnlyBanner";
// MOBILE-ONLY imports: synchronous mobile gate + the 2D Chart View shell that
// replaces the 3D scene on phones.

import { MobileChartShell } from "@/components/mobile/MobileChartShell";
import { useIsMobile, useIsMobileImmediate } from "@/hooks/use-mobile";
import { MobilePlanTab } from "@/components/mobile/MobilePlanTab";
import { ClosedForTestingBanner } from "@/components/ClosedForTestingBanner";
import { isSiteClosed } from "@/lib/siteStatus";
import { loadTourScene, SceneChunkFallback } from "@/lib/dynamicSceneLoader";

// The 3D renderer pulls in Three.js, React Three Fiber, and the scene-only
// layers. Keep it behind an async boundary so the signed-in shell, offline
// notice, and navigation are usable before the renderer finishes downloading.
// The service worker caches this chunk after first use (see sw.ts), preserving
// the core offline experience without forcing every PWA install to precache it.
const TourScene = React.lazy(loadTourScene);


function TestBridge(): null {
  const {
    setTerrain, setDatasetId, terrain, cameraPos, realisticMode, setRealisticMode,
    setTidalOverlay, setTidalDataOverride,
  } = useAppState();
  const cameraPosRef = useRef<[number, number, number]>(cameraPos);
  cameraPosRef.current = cameraPos;
  const terrainRef = useRef(terrain);
  terrainRef.current = terrain;
  const realisticModeRef = useRef(realisticMode);
  realisticModeRef.current = realisticMode;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void import("@/lib/testHelpers").then(
      ({ registerTestBridge, registerTestCameraPosRef }) => {
        registerTestBridge(
          setTerrain,
          setDatasetId,
          terrainRef,
          setRealisticMode,
          realisticModeRef,
          setTidalOverlay,
          setTidalDataOverride,
        );
        registerTestCameraPosRef(cameraPosRef);
      },
    );
  }, [setTerrain, setDatasetId, setRealisticMode, setTidalOverlay, setTidalDataOverride]);
  return null;
}

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#38bdf8",
    colorForeground: "#e2e8f0",
    colorMutedForeground: "#e2e8f0",
    colorDanger: "#f87171",
    colorBackground: "#0f172a",
    colorInput: "#1e293b",
    colorInputForeground: "#e2e8f0",
    colorNeutral: "#64748b",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#0f172a] border border-[#1e3a5f] rounded-xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-black/60",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#e2e8f0] font-mono tracking-wide",
    headerSubtitle: "text-[#e2e8f0] font-mono text-[21px]",
    socialButtonsBlockButtonText: "text-[#e2e8f0]",
    formFieldLabel: "text-[#e2e8f0] font-mono text-[18px] uppercase tracking-widest",
    footerActionLink: "text-[#38bdf8] hover:text-[#7dd3fc]",
    footerActionText: "text-[#cbd5e1]",
    dividerText: "text-[#94a3b8]",
    identityPreviewEditButton: "text-[#38bdf8]",
    formFieldSuccessText: "text-[#34d399]",
    alertText: "text-[#fbbf24]",
    logoBox: "flex justify-center py-2",
    logoImage: "h-10 w-auto",
    socialButtonsBlockButton: "border border-[#1e3a5f] bg-[#1e293b] hover:bg-[#162032] text-[#e2e8f0]",
    formButtonPrimary: "bg-[#0369a1] hover:bg-[#0284c7] text-white font-mono",
    formFieldInput: "bg-[#1e293b] border-[#64748b] text-[#e2e8f0] font-mono",
    footerAction: "border-t border-[#1e3a5f]",
    dividerLine: "bg-[#1e3a5f]",
    alert: "border border-[#92400e] bg-[#1c1008]",
    otpCodeFieldInput: "border-[#64748b] bg-[#1e293b] text-[#e2e8f0]",
    formFieldRow: "",
    main: "",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#040810] px-4">
      <div className="absolute inset-0 bg-gradient-to-b from-[#040810] via-[#061220] to-[#040810] pointer-events-none" />
      <div className="relative z-10 text-center">
        <div className="mb-8">
          <p className="text-[#94a3b8] font-mono text-[18px] tracking-[0.3em] uppercase mb-2">Deep Sea Explorer</p>
          <h1 className="text-[54px] font-mono font-bold text-[#e2e8f0] tracking-wider mb-1">BATHYSCAN</h1>
          <div className="h-px bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent mt-3" />
        </div>
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </div>
  );
}

/** Exported for unit testing (closed-for-testing redirect). */
export function SignUpPage() {
  const [, setLocationSignUp] = useLocation();
  const siteClosedSignUp = isSiteClosed();
  // Closed-for-testing gate: direct URL entry to /sign-up must not expose the
  // Clerk sign-up widget. Bounce to the landing page (which shows the banner).
  useEffect(() => {
    if (siteClosedSignUp) setLocationSignUp("/", { replace: true });
  }, [siteClosedSignUp, setLocationSignUp]);
  if (siteClosedSignUp) return null;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#040810] px-4">
      <div className="absolute inset-0 bg-gradient-to-b from-[#040810] via-[#061220] to-[#040810] pointer-events-none" />
      <div className="relative z-10">
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      </div>
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

// Always-mounted hook that debounce-syncs `lastSession` to the server for
// signed-in users. The Settings page sync only runs while Settings is open,
// so without this hook a user who flies without ever opening Settings would
// never persist their last session to the server (breaking cross-device resume).
function useLastSessionServerSync() {
  // Rather than issuing an independent PUT /api/settings, we call
  // requestSettingsSync() which enqueues through the same debounced flush path
  // used by useServerSettingsSync. This means lastSession is always written as
  // part of the full settings payload — no concurrent PUT writers, no TOCTOU
  // race, no last-writer-wins data loss.
  useEffect(() => {
    const unsub = useSettingsStore.subscribe((state, prevState) => {
      if (state.lastSession === prevState.lastSession) return;
      requestSettingsSync();
    });
    return unsub;
  }, []);
}

function Main() {
  const [, setLocation] = useLocation();
  const setPanelCollapsed = usePanelCollapseStore((s) => s.setCollapsed);
  const setShowDatasetPanel = useSettingsStore((s) => s.setShowDatasetPanel);
  const [uploadRequest, setUploadRequest] = useState(0);
  // MOBILE-ONLY gate flag: true on phones (≤767px). Computed SYNCHRONOUSLY on
  // the first render (useIsMobileImmediate, not useIsMobile) so the 3D
  // TourScene — and therefore any WebGL context — is never mounted on mobile,
  // not even for one frame. Mobile gets the 2D MobileChartShell instead.
  const isMobileChart = useIsMobileImmediate();
  // Two-way settings sync (GET on mount, debounced PUT on change). Also
  // exposes `settingsReady` so the startup auto-select waits for the server's
  // saved defaultMapLoad before committing to a dataset.
  const { settingsReady } = useServerSettingsSync();

  // Server-connectivity indicator: true from the first 502 / network error
  // until the health poll confirms the server is back (or any query succeeds).
  // Shown regardless of whether there are active in-flight queries so the
  // banner stays visible even after TanStack Query exhausts its retry budget.
  const serverWarmingUp = useIsConnecting();
  const isServiceUnavailable = useIsServiceUnavailable();
  const healthResponseMs = useHealthResponseTime();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const waterTypeForDatasets = useSettingsStore((s) => s.waterType);
  const { data: datasets } = useGetDatasets(
    { waterType: waterTypeForDatasets },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType: waterTypeForDatasets }) } },
  );
  const {
    datasetId, setDatasetId, terrain, setTerrain, tidalOverlay, setTidalOverlay,
    tidalDataOverride,
    realisticMode, setRealisticMode,
    pendingExternalUserDatasetId, setPendingExternalUserDatasetId,
  } = useAppState();
  const markerFormOpen = useUiStore((s) => s.markerFormOpen);
  const markerEditOpen = useMarkerEditStore((s) => s.marker !== null);
  const overviewOpen = useUiStore((s) => s.overviewOpen);
  const markersPanelOpen = useUiStore((s) => s.markersPanelOpen);
  const whatsHereOpen = useUiStore((s) => s.whatsHereOpen);

  const findDataPanelOpen = useUiStore((s) => s.findDataPanelOpen);
  const setFindDataPanelOpen = useUiStore((s) => s.setFindDataPanelOpen);
  const openFindDataCount = useUiStore((s) => s.openFindDataCount);
  const driftPlannerActive = useDriftStore((s) => s.driftPlannerActive);
  const setDriftPlannerActive = useDriftStore((s) => s.setDriftPlannerActive);
  const trailRecording = useTrailStore((s) => s.recording);
  const trailStartedAt = useTrailStore((s) => s.startedAt);
  const defaultMapLoad = useSettingsStore((st) => st.defaultMapLoad);
  const { isSignedIn, isLoaded } = useUser();
  const isMobile = useIsMobile();
  // Always-mounted sync: debounce-flush lastSession to server when signed in,
  // independent of whether the Settings page is currently open.
  useLastSessionServerSync();
  // Passive cross-tab storage sync: re-hydrate stores when another tab writes
  // to the same localStorage keys so all open tabs stay in sync.
  useCrossTabSync();
  // Fetch user datasets so we can verify a stored upload default still exists.
  const { data: userDatasets } = useGetUserDatasets({
    query: {
      enabled: isLoaded && isSignedIn === true && defaultMapLoad?.kind === "upload",
      queryKey: getGetUserDatasetsQueryKey(),
      staleTime: 60_000,
    },
  });
  // Settings-driven UI visibility + tidal defaults
  const defaultTidalDepthLayer = useSettingsStore((st) => st.defaultTidalDepthLayer);
  const showDepthScaleBar = useSettingsStore((st) => st.showDepthScaleBar);
  const showCompassMinimap = useSettingsStore((st) => st.showCompassMinimap);
  const showControlsLegend = useSettingsStore((st) => st.showControlsLegend);
  const showTidePanel = useSettingsStore((st) => st.showTidePanel);
  const showHabitatPanel = useSettingsStore((st) => st.showHabitatPanel);
  const showDatasetPanel = useSettingsStore((st) => st.showDatasetPanel);
  const showQueryPanel = useSettingsStore((st) => st.showQueryPanel);
  const showHealthBadge = useSettingsStore((st) => st.showHealthBadge);
  const joystickMode = useSettingsStore((st) => st.joystickMode);
  const showJoystickInOrbit = useSettingsStore((st) => st.showJoystickInOrbit);

  const [depthLayer, setDepthLayer] = useState<DepthLayer>(
    toValidDepthLayer(defaultTidalDepthLayer)
  );

  const timelineCurrentTime = useTimelineStore((s) => s.currentTime);
  const setTimelineTime = useTimelineStore((s) => s.setTime);
  const [showResumeHint, setShowResumeHint] = useState(false);
  const [showIosInstallHint, setShowIosInstallHint] = useState(false);
  const [queryOpen, setQueryOpen] = useState(false);
  const sidePaneCollapsed = useUiStore((s) => s.sidePaneCollapsed);
  const setSidePaneCollapsed = useUiStore((s) => s.setSidePaneCollapsed);
  // Ref + ResizeObserver to track the side panel's right edge for HUD
  // positioning. The Hide control is anchored to the panel's left edge.
  const sidePanelRef = useRef<HTMLDivElement>(null);
  const [panelRightEdge, setPanelRightEdge] = useState(280);
  useEffect(() => {
    const el = sidePanelRef.current;
    if (!el) return;
    const update = () => setPanelRightEdge(el.getBoundingClientRect().right);
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [sidePaneCollapsed]);
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const setSidebarMode = useUiStore((s) => s.setSidebarMode);
  const tideOverlayActive = useUiStore((s) => s.tideOverlayActive);
  const currentOverlayActive = useUiStore((s) => s.currentOverlayActive);
  const currentsEnabled = useSettingsStore((s) => s.currentsEnabled);
  const hasSeenOrbitTouchHint = useUiStore((s) => s.hasSeenOrbitTouchHint);
  const setHasSeenOrbitTouchHint = useUiStore((s) => s.setHasSeenOrbitTouchHint);
  const prevOverviewOpenRef = useRef(false);
  const { toast } = useToast();

  const centerLat = terrain
    ? (terrain.minLat + terrain.maxLat) / 2
    : null;
  const centerLon = terrain
    ? (terrain.minLon + terrain.maxLon) / 2
    : null;

  // Multi-primary: compute center coords for secondary visible datasets.
  const visibleDatasets = useTerrainStore((s) => s.visibleDatasets);

  // When the user removes all datasets from view, clear the context terrain and
  // datasetId so TourScene stops rendering the last mesh. terrainStore already
  // nulls its own primaryDatasetId / activeGrid via syncPrimaryGrids, but
  // useAppState().terrain and .datasetId are independent React state and are not
  // automatically cleared — this effect bridges that gap.
  const visibleCount = visibleDatasets.length;
  useEffect(() => {
    if (visibleCount === 0) {
      setTerrain(null);
      setDatasetId(null);
    }
  }, [visibleCount, setTerrain, setDatasetId]);

  const ds0 = visibleDatasets[0];
  const ds1 = visibleDatasets[1];
  const ds2 = visibleDatasets[2];
  const ds3 = visibleDatasets[3];
  const center1Lat = ds1?.activeGrid ? (ds1.activeGrid.minLat + ds1.activeGrid.maxLat) / 2 : null;
  const center1Lon = ds1?.activeGrid ? (ds1.activeGrid.minLon + ds1.activeGrid.maxLon) / 2 : null;
  const center2Lat = ds2?.activeGrid ? (ds2.activeGrid.minLat + ds2.activeGrid.maxLat) / 2 : null;
  const center2Lon = ds2?.activeGrid ? (ds2.activeGrid.minLon + ds2.activeGrid.maxLon) / 2 : null;
  const center3Lat = ds3?.activeGrid ? (ds3.activeGrid.minLat + ds3.activeGrid.maxLat) / 2 : null;
  const center3Lon = ds3?.activeGrid ? (ds3.activeGrid.minLon + ds3.activeGrid.maxLon) / 2 : null;

  const currentsSource = useSettingsStore((st) => st.currentsSource);
  const autoLoadTidal = useSettingsStore((st) => st.autoLoadTidal);

  // Tracks which terrain object we last auto-enabled the tidal overlay for.
  // Using the terrain reference as a key means the auto-enable fires exactly
  // once per terrain load (i.e. per dataset switch), so a manual toggle-off
  // by the user is not immediately overridden on the next render cycle.
  const autoLoadTidalFiredForRef = useRef<typeof terrain>(null);

  // Auto-enable the tidal overlay when terrain loads and the user has
  // "Auto-Load Tidal Data" turned on in Settings.
  // NOTE: `tidalOverlay` is intentionally NOT in the dependency array —
  // including it would cause this effect to re-fire when the user manually
  // turns the overlay off, immediately re-enabling it against their intent.
  useEffect(() => {
    if (!autoLoadTidal || !terrain) return;
    if (autoLoadTidalFiredForRef.current === terrain) return;
    autoLoadTidalFiredForRef.current = terrain;
    setTidalOverlay(true);
  }, [autoLoadTidal, terrain, setTidalOverlay]);

  // Auto-disable the tidal overlay when "Auto-Load Tidal Data" is toggled OFF.
  // We only fire on the true→false transition (tracked via ref) so that a user
  // who manually turned the overlay on is not affected by unrelated re-renders.
  const prevAutoLoadTidalRef = useRef(autoLoadTidal);
  useEffect(() => {
    const prev = prevAutoLoadTidalRef.current;
    prevAutoLoadTidalRef.current = autoLoadTidal;
    if (prev === true && autoLoadTidal === false) {
      setTidalOverlay(false);
    }
  }, [autoLoadTidal, setTidalOverlay]);

  // Tracks the previous currentsSource so we can detect the transition TO
  // "noaa" and auto-enable the tidal overlay exactly once per transition.
  // `tidalOverlay` is intentionally NOT in the dependency array — including it
  // would cause this effect to re-fire whenever the user manually toggles the
  // overlay off (while still on "noaa"), immediately re-enabling it against
  // their intent.
  const prevCurrentsSourceRef = useRef<string>(currentsSource);
  useEffect(() => {
    const prev = prevCurrentsSourceRef.current;
    prevCurrentsSourceRef.current = currentsSource;
    if (currentsSource === "noaa" && prev !== "noaa") {
      setTidalOverlay(true);
    }
  }, [currentsSource, setTidalOverlay]);

  // Fetch tidal data whenever the 3D overlay is active OR the NOAA currents
  // source is selected. `tidalOverlay` controls only the 3D visual; the
  // Conditions panel needs the data independently of whether the visual is on.
  // Decoupling fixes the case where `currentsSource` is persisted as "noaa"
  // (the default) and `tidalOverlay` never gets set because no transition
  // fires on a fresh page load — without this, `tidalStatus` stays "idle"
  // and the panel shows "Connecting to NOAA…" forever.
  const noaaCurrentsActive = currentsSource === "noaa";
  const tidalFetchActive = tidalOverlay || noaaCurrentsActive;
  const { data: tidalData, loading: tidalLoading, retry: retryTidal } = useTidalData(
    tidalFetchActive ? centerLat : null,
    tidalFetchActive ? centerLon : null,
    tidalOverlay ? timelineCurrentTime : null,
    waterTypeForDatasets,
  );

  // Multi-primary: tidal data for secondary visible datasets.
  const { data: tidalData1 } = useTidalData(
    tidalOverlay ? center1Lat : null,
    tidalOverlay ? center1Lon : null,
    tidalOverlay ? timelineCurrentTime : null,
    waterTypeForDatasets,
  );
  const { data: tidalData2 } = useTidalData(
    tidalOverlay ? center2Lat : null,
    tidalOverlay ? center2Lon : null,
    tidalOverlay ? timelineCurrentTime : null,
    waterTypeForDatasets,
  );
  const { data: tidalData3 } = useTidalData(
    tidalOverlay ? center3Lat : null,
    tidalOverlay ? center3Lon : null,
    tidalOverlay ? timelineCurrentTime : null,
    waterTypeForDatasets,
  );

  // E2E test bridge: when non-null, overrides live tidal fetch data so tests
  // can inject tidal state without going through the useTidalData HTTP path.
  const effectiveTidalDataRaw = (tidalDataOverride as typeof tidalData) ?? tidalData;

  // ── NOAA tide-prediction engine ──────────────────────────────────────────
  // Nearest station + 31-day 6-minute prediction window (feet above MLLW),
  // resolved from the primary dataset centroid and cached server-side 24 h.
  const tideSamples = useTidalStore((s) => s.samples);
  const resolveTideStation = useTidalStore((s) => s.resolveStation);
  const resetTidalStore = useTidalStore((s) => s.reset);

  // Real-time clock: ticks every minute, paused while the tab is hidden and
  // refreshed immediately when the tab becomes visible again.
  const [tideNowMs, setTideNowMs] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") setTideNowMs(Date.now());
    };
    const interval = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  // Resolve the nearest tide station whenever the tidal overlay is active for
  // a dataset centroid; clear the store when the overlay/dataset goes away.
  useEffect(() => {
    if (!tidalOverlay || centerLat === null || centerLon === null) {
      resetTidalStore();
      return;
    }
    void resolveTideStation(centerLat, centerLon);
  }, [tidalOverlay, centerLat, centerLon, resolveTideStation, resetTidalStore]);

  // Trip-planning scrub time for the tide-station panel. Null means live
  // ("Tide now") mode. Kept separate from the global timeline store, whose
  // currentTime is always a Date and has no notion of "live".
  const [tidePlanTime, setTidePlanTime] = useState<Date | null>(null);

  // Interpolated prediction at the active time (planning scrub when set,
  // otherwise the real-time minute clock).
  const tideActiveMs = tidePlanTime ? tidePlanTime.getTime() : tideNowMs;
  const predictedTideFt = useMemo(
    () => (tideSamples ? interpolateTideHeightFt(tideSamples, tideActiveMs) : null),
    [tideSamples, tideActiveMs],
  );

  // When the prediction engine has data, it overrides the coarse tideHeight
  // from /api/tidal (converted feet → metres) so the 3D water plane and tide
  // panel shift with the interpolated 6-minute prediction curve.
  const effectiveTidalData = useMemo(() => {
    if (
      predictedTideFt === null ||
      !effectiveTidalDataRaw ||
      !("available" in effectiveTidalDataRaw) ||
      !effectiveTidalDataRaw.available
    ) {
      return effectiveTidalDataRaw;
    }
    return { ...effectiveTidalDataRaw, tideHeight: predictedTideFt * FEET_TO_METERS };
  }, [effectiveTidalDataRaw, predictedTideFt]);

  // Aggregate crosshair data for the "What's Here?" card.
  const whatsHereData = useWhatsHere(effectiveTidalData, tidalOverlay, terrain);

  // Build tidal data map for multi-primary rendering in TourScene.
  // The primary (slot 0) uses effectiveTidalData (which may be the test override).
  const tidalDataMap = useMemo(() => {
    const map = new Map<string, NonNullable<typeof tidalData>>();
    if (ds0 && effectiveTidalData) map.set(ds0.datasetId, effectiveTidalData);
    if (ds1 && tidalData1) map.set(ds1.datasetId, tidalData1);
    if (ds2 && tidalData2) map.set(ds2.datasetId, tidalData2);
    if (ds3 && tidalData3) map.set(ds3.datasetId, tidalData3);
    return map;
  }, [ds0, effectiveTidalData, ds1, tidalData1, ds2, tidalData2, ds3, tidalData3]);

  // Publish NOAA-derived ambient current to the currents runtime store so
  // the bathymetric currents simulation (Task #136) can use it as the
  // ambient vector when the user picks `source: "noaa"`.
  const setNoaaAmbient = useCurrentsStore((s) => s.setNoaaAmbient);
  const tidalStatus = useCurrentsStore((s) => s.tidalStatus);
  const setTidalStatus = useCurrentsStore((s) => s.setTidalStatus);
  const setRetryTidal = useCurrentsStore((s) => s.setRetryTidal);

  // Keep the retry function in the store in sync with the hook's retry.
  useEffect(() => {
    setRetryTidal(retryTidal);
  }, [retryTidal, setRetryTidal]);

  // Derive and publish tidalStatus so CurrentsPanel can show proper states.
  useEffect(() => {
    if (tidalLoading) {
      setTidalStatus("loading");
    } else if (effectiveTidalData && "available" in effectiveTidalData && effectiveTidalData.available) {
      setTidalStatus("ok");
    } else if (effectiveTidalData && "available" in effectiveTidalData && !effectiveTidalData.available) {
      setTidalStatus("unavailable");
    } else {
      setTidalStatus("idle");
    }
  }, [tidalLoading, effectiveTidalData, setTidalStatus]);

  useEffect(() => {
    // Always publish the ambient when /api/tidal returns a usable current,
    // so the CurrentsLayer NOAA simulation mode keeps a real flow field
    // even when no CO-OPS station was in range. The `source` flag carries
    // through whether the value came from a real station or the
    // tide-derived sinusoidal estimate so the panel can label it honestly
    // and only surface the station id/name when it's actually NOAA-backed.
    if (effectiveTidalData && "available" in effectiveTidalData && effectiveTidalData.available) {
      const isStation = effectiveTidalData.currentsSource === "noaa";
      setNoaaAmbient({
        directionDeg: effectiveTidalData.currentDirection,
        speedKt: effectiveTidalData.currentSpeed,
        source: isStation ? "noaa" : "estimated",
        stationId: isStation ? effectiveTidalData.currentsStation?.id : undefined,
        stationName: isStation ? effectiveTidalData.currentsStation?.name : undefined,
      });
    } else {
      setNoaaAmbient(null);
    }
  }, [effectiveTidalData, setNoaaAmbient]);

  // ── Timeline range auto-population ─────────────────────────────────────────
  // Primary: fire whenever the tidal/currents data-load event resolves —
  // i.e. when effectiveTidalData transitions to an `available: true` result.
  // We prefer the real forecast extent from useTidalSchedule (first/last event
  // timestamps) when events are available; falls back to now ± 12 h otherwise.
  // Secondary fallback: fire when terrain loads and no tidal data is available
  // yet (e.g. tidal overlay is disabled), so the bar is ready as soon as an
  // overlay is enabled.
  const setTimelineRange = useTimelineStore((s) => s.setRange);

  // Fetch the 7-day tidal schedule at the App level so the timeline range can
  // use real event timestamps rather than a hardcoded ±12 h window.
  const { schedule: tidalScheduleForRange } = useTidalSchedule(
    centerLat,
    centerLon,
    7,
    waterTypeForDatasets,
  );

  const prevTidalAvailableRef = useRef<boolean | null>(null);
  // Track whether we've already applied real schedule events so that when the
  // schedule loads after `available` is already true we still update the range.
  const prevScheduleHadEventsRef = useRef<boolean>(false);
  useEffect(() => {
    const available =
      effectiveTidalData && "available" in effectiveTidalData
        ? effectiveTidalData.available
        : null;
    const events = tidalScheduleForRange?.available
      ? tidalScheduleForRange.events
      : undefined;
    const hasEvents = Boolean(events && events.length > 0);

    // Skip if neither availability nor schedule-event presence has changed.
    const availabilityUnchanged = available === prevTidalAvailableRef.current;
    const scheduleUnchanged = hasEvents === prevScheduleHadEventsRef.current;
    if (availabilityUnchanged && scheduleUnchanged) return;

    prevTidalAvailableRef.current = available;
    prevScheduleHadEventsRef.current = hasEvents;
    if (available === null) return;

    // Use real forecast window when schedule events are present.
    const firstEvent = events?.[0];
    const lastEvent = events?.[events.length - 1];
    if (firstEvent && lastEvent) {
      setTimelineRange({
        start: new Date(firstEvent.time),
        end: new Date(lastEvent.time),
      });
    } else if (waterTypeForDatasets !== "freshwater") {
      const now = new Date();
      setTimelineRange({
        start: new Date(now.getTime() - 12 * 3_600_000),
        end: new Date(now.getTime() + 12 * 3_600_000),
      });
    }
  }, [effectiveTidalData, tidalScheduleForRange, waterTypeForDatasets, setTimelineRange]);

  // Fallback: set range when a new terrain dataset loads and the above effect
  // hasn't fired yet (tidal overlay off, no data fetched).
  const prevTerrainForRangeRef = useRef<typeof terrain>(null);
  useEffect(() => {
    if (!terrain || terrain === prevTerrainForRangeRef.current) return;
    prevTerrainForRangeRef.current = terrain;
    // Don't override a range that was already set from tidal data.
    if (prevTidalAvailableRef.current !== null) return;
    const now = new Date();
    setTimelineRange({
      start: new Date(now.getTime() - 12 * 3_600_000),
      end: new Date(now.getTime() + 12 * 3_600_000),
    });
  }, [terrain, setTimelineRange]);

  // ── Auto-retry NOAA fetch when the user flies to a new area ────────────────
  // Minimum centre-point shift (degrees, either axis) that triggers an
  // automatic re-fetch when the last result was "unavailable".  0.5° ≈ 55 km
  // at mid-latitudes — large enough to plausibly cross into a new station's
  // coverage zone, small enough to fire without an extreme pan.
  const TIDAL_RETRY_THRESHOLD_DEG = 0.5;
  // Tracks the map centre at which "unavailable" was last recorded so we can
  // compare subsequent moves against that baseline.
  const unavailableAtRef = useRef<{ lat: number; lon: number } | null>(null);
  // Tracks the previous tidalStatus so we can detect the transition INTO
  // "unavailable" vs. just staying there while the user pans.
  const prevTidalStatusRef = useRef<string>("idle");

  useEffect(() => {
    const prev = prevTidalStatusRef.current;
    prevTidalStatusRef.current = tidalStatus;

    if (tidalStatus === "unavailable") {
      if (prev !== "unavailable") {
        // Record where the user was when the "unavailable" response arrived.
        unavailableAtRef.current =
          centerLat !== null && centerLon !== null
            ? { lat: centerLat, lon: centerLon }
            : null;
        return;
      }
      // Status is still "unavailable" — check whether the centre has moved
      // past the threshold since the baseline was recorded.
      const baseline = unavailableAtRef.current;
      if (
        baseline !== null &&
        centerLat !== null &&
        centerLon !== null &&
        (Math.abs(centerLat - baseline.lat) > TIDAL_RETRY_THRESHOLD_DEG ||
          Math.abs(centerLon - baseline.lon) > TIDAL_RETRY_THRESHOLD_DEG)
      ) {
        // Advance the baseline so a single large pan fires exactly one retry
        // rather than spamming retries on every subsequent small move.
        unavailableAtRef.current = { lat: centerLat, lon: centerLon };
        retryTidal();
      }
    } else {
      // Once we're no longer unavailable (loading / ok / idle) reset so the
      // next unavailable transition starts fresh.
      unavailableAtRef.current = null;
    }
  }, [tidalStatus, centerLat, centerLon, retryTidal]);

  // Keep URL in sync with current camera + dataset (debounced, no-op until
  // terrain is loaded so we never write partial initialisation state).
  useUrlSync(datasetId, !!terrain);

  // Debounced last-session save: write the camera position + active datasetId
  // to settingsStore whenever the camera settles (2 s after the last move).
  // This is separate from the URL sync (which throttles to 800 ms) so the
  // two can be tuned independently. Only fires when terrain is loaded and the
  // camera has valid geo coordinates.
  const lastSessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!terrain || !datasetId) return;

    const saveLastSession = () => {
      const { cameraPosition, cameraDepth, heading } =
        useCameraStore.getState();
      if (!cameraPosition.known || cameraDepth === null) return;
      useSettingsStore.getState().setLastSession({
        lon: cameraPosition.lon,
        lat: cameraPosition.lat,
        depth: cameraDepth,
        heading,
        datasetId,
        headingConvention: "north-up",
      });
    };

    const schedule = () => {
      if (lastSessionTimerRef.current !== null) {
        clearTimeout(lastSessionTimerRef.current);
      }
      lastSessionTimerRef.current = setTimeout(saveLastSession, 2000);
    };

    const unsub = useCameraStore.subscribe((state, prevState) => {
      if (
        state.cameraPosition !== prevState.cameraPosition ||
        state.cameraDepth !== prevState.cameraDepth ||
        state.heading !== prevState.heading
      ) {
        schedule();
      }
    });

    // Save once immediately when terrain/dataset changes so even a user
    // who loads a dataset and doesn't move gets their position recorded.
    saveLastSession();

    return () => {
      unsub();
      if (lastSessionTimerRef.current !== null) {
        clearTimeout(lastSessionTimerRef.current);
        lastSessionTimerRef.current = null;
      }
    };
  }, [terrain, datasetId]);

  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    if (hasAutoSelectedRef.current) return;
    // Wait for server settings to hydrate before committing to a dataset.
    // Without this guard, a signed-in user whose GET /api/settings response
    // arrives after the datasets list would always get datasets[0] instead of
    // their saved defaultMapLoad preference.
    if (isSignedIn && !settingsReady) return;
    if (datasets?.length && !datasetId) {
      const { cameraSpawnBehaviour, lastSession } = useSettingsStore.getState();
      const action = resolveDefaultDataset({
        datasets,
        defaultMapLoad,
        userDatasets,
        isSignedIn,
        urlDatasetId: initialViewParams?.datasetId,
        pendingExternalUserDatasetId,
        cameraSpawnBehaviour,
        lastSession,
      });

      if (action.type === "wait") return;

      hasAutoSelectedRef.current = true;

      switch (action.type) {
        case "url-switch":
        case "switch":
          void requestDatasetSwitch({
            datasetId: action.datasetId,
            datasetName: action.name,
            isStartup: true,
            onConfirm: () => setDatasetId(action.datasetId),
            silent: true,
          });
          break;
        case "upload-pending":
          setPendingExternalUserDatasetId(action.uploadId);
          break;
        case "none":
          setDatasetId(null);
          break;
      }
    }
  }, [datasets, datasetId, setDatasetId, defaultMapLoad, isSignedIn, userDatasets,
      pendingExternalUserDatasetId, setPendingExternalUserDatasetId, settingsReady]);

  // Side-effects on water-type switch (see useWaterTypeSideEffects):
  //   1) Clear derived state computed for the previous environment
  //      (terrain grids, zone classifications, habitat cache).
  //   2) Auto-switch the depth colormap to the mode-appropriate default,
  //      but only if the user hasn't manually picked a non-default theme.
  //   3) Auto-load the first preset of the new water type.
  // Resetting hasAutoSelectedRef here keeps the mount-time auto-select
  // path armed for the next dataset list refresh in the new mode.
  useWaterTypeSideEffects(
    datasets,
    setDatasetId,
    () => {
      hasAutoSelectedRef.current = false;
    },
    // onBeforeSwitch — runs only on a CONFIRMED water-type switch, before the
    // new dataset id is set. Synchronously unmounts the previous environment's
    // dataset (e.g. the pre-loaded Lake Ray Roberts demo) so no stale mesh
    // remains visible while the replacement loads — or indefinitely, if the
    // new water type has no preset available.
    () => {
      setTerrain(null);
      setDatasetId(null);
    },
  );

  // Always-mounted orchestrator that owns terrain + overview fetches for the
  // active preset dataset and commits them atomically. Keeps overviewGrid in
  // sync even when DatasetPanel is hidden (e.g. when the user picks a dataset
  // from FindDataPanel while the side pane is collapsed).
  useActiveDatasetSync();

  // Follow-mode dataset handoff: when the out-of-bounds suggestion toast's
  // "Load & follow" action fires (datasetHandoff.tsx), it stores the target
  // dataset id in uiStore. Switch the active dataset once, then re-enable GPS
  // follow mode as soon as that dataset's terrain is committed to context.
  const pendingFollowHandoff = useUiStore((s) => s.pendingFollowHandoff);
  const followHandoffRequestedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingFollowHandoff) {
      followHandoffRequestedRef.current = null;
      return;
    }
    if (followHandoffRequestedRef.current !== pendingFollowHandoff) {
      followHandoffRequestedRef.current = pendingFollowHandoff;
      setDatasetId(pendingFollowHandoff);
      return;
    }
    if (terrain?.datasetId === pendingFollowHandoff) {
      useCameraStore.getState().setGpsFollowMode(true);
      useUiStore.getState().clearFollowHandoff();
    }
  }, [pendingFollowHandoff, terrain, setDatasetId]);

  useEffect(() => {
    if (terrain) {
      useTerrainStore.getState().setGrids({ activeGrid: terrain });
    }
  }, [terrain]);

  // Stale manual-conditions lifecycle: when the active dataset changes, drop
  // session-only manual conditions for every OTHER dataset so values from a
  // previous lake never resurface later in the same session. Persisted
  // per-lake conditions ("Remember for this lake") are untouched.
  const activeDatasetIdForConditions = terrain?.datasetId ?? null;
  useEffect(() => {
    if (activeDatasetIdForConditions) {
      useUiStore.getState().pruneSessionManualConditions(activeDatasetIdForConditions);
    }
  }, [activeDatasetIdForConditions]);

  // One-shot camera spawn from share-link params. Fires the first time the
  // terrain matching the URL dataset is loaded, then never again.
  const didApplyUrlSpawnRef = useRef(false);
  useEffect(() => {
    if (didApplyUrlSpawnRef.current) return;
    if (!terrain || !initialViewParams) return;
    // Only apply if this terrain belongs to the dataset in the URL.
    if (terrain.datasetId !== initialViewParams.datasetId) return;

    didApplyUrlSpawnRef.current = true;
    const { lon, lat, depth, heading } = initialViewParams;
    try {
      const { x: worldX, z: worldZ } = lonLatToWorldXZ(lon, lat, terrain);
      // Convert the encoded seafloor depth (metres) to a world-Y coordinate so
      // the camera spawns at the correct depth, not just surface+3.
      const depthRange = (terrain.maxDepth - terrain.minDepth) || 1;
      const t = Math.max(0, Math.min(1, (depth - terrain.minDepth) / depthRange));
      const worldY = -t * MAX_DEPTH_WORLD;
      useUiStore.getState().setPendingDropIn({ worldX, worldZ, headingDeg: heading, worldY });
    } catch {
      // If conversion fails (e.g. coords outside dataset bounds), skip silently.
    }
  }, [terrain]);

  // online/offline listeners are registered once at module-load time in
  // offlineStore.ts — no duplicate useEffect needed here.

  // iOS Safari "Add to Home Screen" hint (once per session)
  useEffect(() => {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = "standalone" in navigator && (navigator as Record<string, unknown>)["standalone"] === true;
    const hintShown = sessionStorage.getItem("bs-ios-hint");
    if (!isIos || isStandalone || hintShown) return;
    sessionStorage.setItem("bs-ios-hint", "1");
    setShowIosInstallHint(true);
    const t = setTimeout(() => setShowIosInstallHint(false), 10000);
    return () => clearTimeout(t);
  }, []);

  // On mount, warn the user about offline packs that are expiring soon (< 48 h).
  // Runs once; the pack store is lazy-imported so it doesn't bloat the initial bundle.
  useEffect(() => {
    import("@/lib/offlinePackStore").then(async ({ getExpiringPacks }) => {
      const expiring = await getExpiringPacks(48);
      for (const p of expiring) {
        // Guard against a malformed pack record where both tidalExpiresAt and
        // savedAt are absent/undefined, which would produce new Date(undefined)
        // → NaN and cause Math.round(NaN) to silently pass through to the toast.
        const rawDate = p.tidePack?.tidalExpiresAt ?? p.savedAt;
        if (rawDate == null) continue;
        const expiresAt = new Date(rawDate);
        if (isNaN(expiresAt.getTime())) continue;
        const hoursLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 3_600_000));
        toast({
          title: "Offline pack expiring soon",
          description: `"${p.datasetName}" pack expires in ${hoursLeft}h — tap Update in Settings to refresh.`,
          duration: 8000,
        });
      }
    }).catch((err) => {
      if (import.meta.env.DEV) {
        console.warn("[App] Failed to check offline pack expiry:", err);
      }
    });
  }, [toast]);

  // Flush offline-buffered trails/markers when connection is restored.
  // The guard and flush implementations live in offlineFlush.ts so they can
  // be unit-tested independently of the full component tree.
  useEffect(() => {
    const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
    const flushAll = createFlushAllWithGuard(
      () => flushPendingTrails(apiBase),
      () => flushPendingMarkers(apiBase),
    );

    const onlineHandler = () => { void flushAll(); };
    window.addEventListener("online", onlineHandler);
    void flushAll();
    return () => window.removeEventListener("online", onlineHandler);
  }, []);

  // Swipe-to-close/open side pane on touch devices.
  // Left-swipe anywhere on the side pane closes it.
  // Right-swipe from within 32px of the left screen edge opens it.
  useEffect(() => {
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    // Approximate width of the open side pane in pixels. Gestures that start
    // outside this region cannot be intended to close it.
    const SIDE_PANE_WIDTH = 280;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dy) > Math.abs(dx) * 1.5) return;
      if (Math.abs(dx) < 40) return;

      const collapsed = useUiStore.getState().sidePaneCollapsed;
      // Close: only trigger if the gesture started within the side pane area.
      if (dx < -40 && !collapsed && startX <= SIDE_PANE_WIDTH) {
        useUiStore.getState().setSidePaneCollapsed(true);
      // Open: only trigger from the left screen edge (collapsed handle zone).
      } else if (dx > 40 && collapsed && startX <= 32) {
        useUiStore.getState().setSidePaneCollapsed(false);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // One-time orbit-touch hint: show a toast the first time a user on a touch
  // device places two fingers down (i.e. starts a two-finger orbit gesture),
  // explaining two-finger orbit navigation.
  useEffect(() => {
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice || hasSeenOrbitTouchHint) return;

    const onTwoFingerTouch = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      setHasSeenOrbitTouchHint(true);
      window.removeEventListener("touchstart", onTwoFingerTouch);
      toast({
        title: "Two-finger orbit",
        description: "Drag with two fingers to orbit around a point. Pinch to zoom.",
        duration: 5000,
      });
    };
    window.addEventListener("touchstart", onTwoFingerTouch, { passive: true });
    return () => window.removeEventListener("touchstart", onTwoFingerTouch);
  }, [hasSeenOrbitTouchHint, setHasSeenOrbitTouchHint, toast]);

  // O key — toggle overview map
  // Slash key — open query panel
  // Comma key — open settings
  // Escape — close query panel and clear highlights
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const bindings = useSettingsStore.getState().keyBindings;
      if (e.code === getBoundKey(bindings, "toggleOverview") && !e.repeat) {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName ?? "";
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && !el?.isContentEditable) {
          const store = useUiStore.getState();
          store.setOverviewOpen(!store.overviewOpen);
        }
      }
      if (e.code === getBoundKey(bindings, "openQuery") && !e.repeat) {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName ?? "";
        if (tag !== "INPUT" && tag !== "TEXTAREA" && !el?.isContentEditable) {
          e.preventDefault();
          setQueryOpen(true);
        }
      }
      if (
        e.code === getBoundKey(bindings, "openSettings") &&
        !e.repeat && !e.ctrlKey && !e.metaKey
      ) {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName ?? "";
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && !el?.isContentEditable) {
          setLocation(basePath + "/settings");
        }
      }
      if (e.code === "KeyH" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName ?? "";
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && !el?.isContentEditable) {
          const store = useUiStore.getState();
          store.setWhatsHereOpen(!store.whatsHereOpen);
        }
      }
      if (e.key === "Escape" && !e.repeat) {
        // Guard: don't close panels when the user is typing in an input,
        // textarea, select, or contenteditable — Escape should dismiss the
        // field/dropdown first, not blow away the whole panel.
        const activeEl = document.activeElement as HTMLElement | null;
        const activeTag = activeEl?.tagName ?? "";
        if (
          activeTag === "INPUT" ||
          activeTag === "TEXTAREA" ||
          activeTag === "SELECT" ||
          activeEl?.isContentEditable
        ) {
          // Let the browser handle Escape for the focused element (clears
          // input, closes a <select> popup, etc.) without closing panels.
        } else {
          setQueryOpen(false);
          useHighlightStore.getState().clearHighlight();
          const store = useUiStore.getState();
          if (store.overviewOpen) store.setOverviewOpen(false);
          if (store.whatsHereOpen) store.setWhatsHereOpen(false);
        }
      }
      // M — cycle sidebar modes: Explore → Plan → Analyze → Live → Explore
      if (e.code === "KeyM" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName ?? "";
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && !el?.isContentEditable) {
          const store = useUiStore.getState();
          const MODES = ['explore', 'plan', 'analyze', 'live'] as const;
          const idx = MODES.indexOf(store.sidebarMode);
          const next = MODES[(idx + 1) % MODES.length] as typeof MODES[number];
          store.setSidebarMode(next);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setLocation]);

  // Service-unavailable banner dismiss state.
  // Resets automatically when isServiceUnavailable flips back to false so the
  // banner reappears if the server goes away again after a recovery.
  const [serviceUnavailableDismissed, setServiceUnavailableDismissed] = useState(false);
  const prevIsServiceUnavailable = useRef(isServiceUnavailable);
  useEffect(() => {
    if (prevIsServiceUnavailable.current && !isServiceUnavailable) {
      // Server recovered — clear the dismiss so the banner shows next time.
      setServiceUnavailableDismissed(false);
    }
    prevIsServiceUnavailable.current = isServiceUnavailable;
  }, [isServiceUnavailable]);

  // Show "click to resume" hint when overview closes
  useEffect(() => {
    const wasOpen = prevOverviewOpenRef.current;
    prevOverviewOpenRef.current = overviewOpen;
    if (!wasOpen || overviewOpen) return;
    setShowResumeHint(true);
    const t = setTimeout(() => setShowResumeHint(false), 3000);
    return () => clearTimeout(t);
  }, [overviewOpen]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#040810] flex flex-col">
      <VisibleDatasetsLoader />

      {/* Offline banner — device has no internet connection. Clears automatically
          when navigator comes back online. No spinner (no point retrying). */}
      {!isOnline && (
        <div
          data-testid="offline-banner"
          role="status"
          aria-live="polite"
          aria-label="You are offline"
          className="absolute inset-x-0 top-0 z-[200] flex items-center justify-center gap-2 h-7 bg-red-950/90 backdrop-blur-sm border-b border-red-800/40 text-red-400 text-[16.5px] font-mono tracking-wide select-text pointer-events-auto"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          ● You're offline
          <CopyButton text="You're offline" className="text-red-300/70 hover:text-red-200" />
        </div>
      )}

      {/* Connecting / service-unavailable banner — shown from the first 502 /
          network error until the health poll confirms the server is back.
          Only shown when the device has internet (isOnline) — if the device
          is fully offline the "offline" banner above already covers the user.
          After SERVICE_UNAVAILABLE_POLL_THRESHOLD consecutive failed health
          probes (~30 s) we escalate from the transient spinner to a more
          specific amber "Service unavailable" message so the user has
          actionable feedback rather than an infinite spinner. */}
      {serverWarmingUp && isOnline && !isServiceUnavailable && (
        <div
          role="status"
          aria-live="polite"
          aria-label="Connecting to server"
           className="absolute inset-x-0 top-0 z-[200] flex items-center justify-center gap-2 h-7 bg-sky-950/90 backdrop-blur-sm border-b border-sky-800/40 text-sky-400 text-[16.5px] font-mono tracking-wide select-text pointer-events-auto"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <svg
            aria-hidden="true"
            className="animate-spin"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          Reconnecting to server…
        </div>
      )}
      {isServiceUnavailable && isOnline && !serviceUnavailableDismissed && (
        <div
          role="alert"
          aria-live="assertive"
          aria-label="Service unavailable"
          data-testid="service-unavailable-banner"
           className="absolute inset-x-0 top-0 z-[200] flex items-center justify-between gap-2 px-3 h-9 bg-amber-950/90 backdrop-blur-sm border-b border-amber-700/40 text-amber-400 text-[13.5px] font-mono tracking-wide select-text"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {/* spacer so the message stays centred when buttons are present */}
          <span className="w-16 shrink-0" aria-hidden="true" />
          <span className="flex items-center gap-1.5 min-w-0 truncate">
            <span aria-hidden="true">⚠</span>
            <span>Service unavailable</span>
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <CopyButton
              text="Service unavailable"
              className="text-amber-400/70 hover:text-amber-300"
            />
            <button
              type="button"
              onClick={() => window.location.reload()}
              aria-label="Reload the page"
              className="px-2 py-0.5 rounded border border-amber-700/60 bg-amber-900/40 hover:bg-amber-800/60 active:bg-amber-700/60 text-amber-300 text-[12px] font-mono leading-none transition-colors"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => setServiceUnavailableDismissed(true)}
              aria-label="Dismiss service unavailable banner"
              className="flex items-center justify-center w-6 h-6 rounded hover:bg-amber-900/60 active:bg-amber-800/60 text-amber-500 hover:text-amber-300 transition-colors"
            >
              ×
            </button>
          </span>
        </div>
      )}

      {/* Dev-only health probe response-time badge — bottom-right corner.
          Shows the round-trip latency of the most recent GET /health probe
          so developers can verify connectivity without opening DevTools.
          Stripped from production builds via import.meta.env.DEV. */}
      {import.meta.env.DEV && healthResponseMs !== null && showHealthBadge && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            bottom: 8,
            right: 8,
            zIndex: 9999,
            background: "rgba(0,10,20,0.82)",
            border: "1px solid rgba(0,229,255,0.22)",
            borderRadius: 4,
            padding: "2px 7px",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
            letterSpacing: "0.08em",
            color: healthResponseMs < 200 ? "#34d399" : healthResponseMs < 600 ? "#fbbf24" : "#f87171",
            pointerEvents: "none",
            userSelect: "none",
            backdropFilter: "blur(4px)",
          }}
        >
          /health {healthResponseMs} ms
        </div>
      )}

      {!isMobile && <AppHeader />}

      <div className="relative flex-1 overflow-hidden">
        {/* MOBILE-ONLY gate: on phones, the ENTIRE scene area (3D TourScene
            plus every desktop map overlay below) is replaced by the 2D
            MobileChartShell. The R3F/WebGL canvas must never mount on mobile
            — that is the product decision this branch enforces. Desktop JSX
            in the else-branch is untouched. */}
        {isMobileChart ? (
          <MobileChartShell
            // MOBILE-ONLY: the full Plan-tab stack needs Main()'s tide fetch
            // state and scrub times, so App assembles it and hands it down.
            planContent={
              <MobilePlanTab
                tidalOverlay={tidalOverlay}
                tidalData={effectiveTidalData}
                tidalLoading={tidalLoading}
                depthLayer={depthLayer}
                onDepthLayerChange={setDepthLayer}
                tidePlanTime={tidePlanTime}
                onTidePlanTimeChange={setTidePlanTime}
                tideNowMs={tideNowMs}
                centerLat={centerLat}
                centerLon={centerLon}
              />
            }
            // MOBILE-ONLY: explore/live tab dots mirror the desktop
            // SidebarModeTabs indicators (these two flags live in AppState).
            exploreIndicator={tidalOverlay}
            liveIndicator={realisticMode}
          />
        ) : (
          <>
        {/* 3D Scene — fills everything. Wrapped in an ErrorBoundary so a
            render error in the Canvas subtree (R3F components rethrow into
            the parent React tree) degrades to a contained fallback instead
            of white-screening the whole app. */}
        <ErrorBoundary label="the 3D scene" fallback={<SceneChunkFallback />}>
          <React.Suspense
            fallback={
              <div
                role="status"
                aria-label="Loading 3D map"
                className="absolute inset-0 flex items-center justify-center bg-[#040810] text-sky-200 font-mono text-sm"
              >
                Loading 3D map…
              </div>
            }
          >
            <TourScene
              tidalData={effectiveTidalData}
              tidalDataMap={tidalDataMap}
              tidalOverlay={tidalOverlay}
              depthLayer={depthLayer}
            />
          </React.Suspense>
        </ErrorBoundary>

        {/* HUD + depth scale — pointer-events:none overlay.
            z-30 so the HUD's interactive button clusters sit above the
            Minimap (z-20). The container itself is pointer-events:none,
            so the minimap underneath stays clickable wherever no HUD
            child is overlapping. */}
        <div
          className="absolute inset-0 pointer-events-none z-30"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: isMobile ? "16px 16px 16px 16px" : "80px 16px 16px 16px",
          }}
        >
          <div className="flex-1 relative">
            <ErrorBoundary label="HUD">
              <HUD panelRightEdge={sidePaneCollapsed ? 0 : panelRightEdge} />
            </ErrorBoundary>
          </div>
        </div>

        {/* Top-right depth legend dropdown — sits just under the app
            header, outside the HUD overlay container so the new
            collapsible legend is anchored to the scene edge rather
            than to the HUD's padded inset. */}
        {showDepthScaleBar && <DepthScaleBar />}

        {/* Floating habitat suitability legend — pinned to the 3D scene so
            the amber-gradient key stays visible even when the HabitatPanel
            (top-left HUD) is collapsed or hidden. Renders nothing unless a
            species is active. */}
        <HabitatLegend />

        {/* Floating intertidal band key — shows MHW/MHHW elevation boundaries
            in the user's active units. Renders nothing until datums resolve. */}
        <IntertidalBandLegend />

        {/* Help launch button — upper-left of main interactive area (desktop only) */}
        {!isMobile && <HelpButton />}

        {/* Zone color legend chip — anchored below the Help button.
            Renders only when the zone overlay is active. */}
        <ZoneLegendChip />

        {/* Help floating window — desktop only; on mobile the help store trigger
            is in Settings; see MobileChartShell for the gear-button entry point */}

        {/* Combined side pane — Datasets, Camera Position, Keyboard, and
            Tidal Overlay all live inside one vertically-scrollable container
            pinned to the left side. Can also be collapsed horizontally to
            give the user a full view of the scene. */}
        {sidePaneCollapsed ? (
          <ViewscreenTooltip label="Show side pane (datasets, habitat, tides)" side="right">
            <button
              onClick={() => setSidePaneCollapsed(false)}
              aria-label="Show side pane"
              className="absolute top-24 left-4 z-20"
              style={{
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: "calc(36px * var(--bs-font-scale, 1))",
                lineHeight: 1,
                padding: "6px 10px",
                borderRadius: 4,
                border: "1px solid rgba(0,229,255,0.35)",
                background: "rgba(2,8,18,0.94)",
                color: "#00e5ff",
                cursor: "pointer",
                backdropFilter: "blur(6px)",
                textShadow: "0 0 6px rgba(0,229,255,0.5)",
                letterSpacing: "0.1em",
              }}
            >
              ▸
            </button>
          </ViewscreenTooltip>
        ) : (
          <>
            {/* Hide button — fixed at the sidebar's left edge so it remains
                reachable even when the panel is wider than the viewport.
                Kept outside the ErrorBoundary so the pane can still be
                collapsed when the sidebar content throws. */}
            <div style={{ position: "fixed", top: 96, left: 16, zIndex: 21 }}>
              <ViewscreenTooltip label="Hide side pane to free up screen space" side="right">
                <button
                  onClick={() => setSidePaneCollapsed(true)}
                  aria-label="Hide side pane"
                  style={{
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
                    padding: "2px 8px",
                    borderRadius: 4,
                    border: "1px solid rgba(0,229,255,0.35)",
                    background: "rgb(2,8,18)",
                    color: "#00e5ff",
                    cursor: "pointer",
                    letterSpacing: "0.1em",
                  }}
                >
                  <span style={{ fontSize: "calc(33px * var(--bs-font-scale, 1))", lineHeight: 1, verticalAlign: "middle" }}>◂</span> HIDE
                </button>
              </ViewscreenTooltip>
            </div>
            <div
              ref={sidePanelRef}
              className="absolute top-24 left-4 z-20 overflow-y-auto overscroll-contain space-y-2"
              style={{
                maxHeight: "calc(100vh - 7rem)",
                paddingRight: 4,
                scrollbarWidth: "thin",
                scrollbarColor: "rgba(0,229,255,0.35) transparent",
                touchAction: "pan-y",
              }}
            >
            {/* ── Sidebar shell boundary: a render error in tab logic or any
                panel not covered by its own boundary collapses to a contained
                fallback (with retry) instead of white-screening the app. ── */}
            <ErrorBoundary label="the sidebar">
            {/* ── Mode tabs (always visible, above all panels) ── */}
            <SidebarModeTabs />

            {/* ── Persistent manual-conditions chip (visible on every tab) ── */}
            <ManualConditionsChip />

            {/* ══════════════════════════════════════════════════
                EXPLORE MODE — DatasetPanel + OverlaysToolsPanel
                display:none keeps all panel state alive when
                the user switches away.
            ══════════════════════════════════════════════════ */}
            <div style={{ display: sidebarMode === 'explore' ? 'flex' : 'none', flexDirection: 'column', gap: 8 }}>
              <SidebarSectionGroup wide>
                <SidebarSection
                  id="mapData"
                  title="Your Data"
                  headerAction={
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <ViewscreenTooltip label="Drop a file here or click to browse" side="right">
                        <button
                          type="button"
                          data-testid="btn-header-upload-dataset"
                          aria-label="Upload Dataset(s)"
                          title="Upload your own dataset file"
                          onClick={(event) => {
                            event.stopPropagation();
                            setShowDatasetPanel(true);
                            setPanelCollapsed("mapData", false);
                            setPanelCollapsed("uploadTerrainAccordion", false);
                            setUploadRequest((request) => request + 1);
                          }}
                          style={{
                            alignSelf: "center",
                            margin: "0 5px 0 4px",
                            padding: "4px 6px",
                            color: "#00e5ff",
                            background: "transparent",
                            border: "1px solid rgba(0,229,255,0.35)",
                            borderRadius: 3,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            fontSize: "calc(12px * var(--bs-font-scale, 1))",
                            letterSpacing: "0.06em",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Upload Dataset(s)
                        </button>
                      </ViewscreenTooltip>
                      <ViewscreenTooltip
                        label="Accepted formats: .csv, .xyz, .txt, .tif, .tiff, .bag, .las, .laz, .nc, .gpx, .xml, .nmea, .gz, .pdf"
                        side="right"
                      >
                        <button
                          type="button"
                          aria-label="Show accepted upload formats"
                          data-testid="btn-upload-format-info"
                          style={{
                            width: 20,
                            height: 20,
                            padding: 0,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#7dd3fc",
                            background: "rgba(0,229,255,0.08)",
                            border: "1px solid rgba(0,229,255,0.3)",
                            borderRadius: "50%",
                            cursor: "help",
                            fontFamily: "inherit",
                            fontSize: "calc(12px * var(--bs-font-scale, 1))",
                            fontWeight: 700,
                          }}
                        >
                          i
                        </button>
                      </ViewscreenTooltip>
                    </div>
                  }
                >
                  {(!terrain || showDatasetPanel) ? <DatasetPanel embedded uploadRequest={uploadRequest} /> : null}
                </SidebarSection>
              </SidebarSectionGroup>

              <OverlaysToolsPanel />

              {/* "Switch to Plan" nudge — appears when a conditions or drift overlay is active */}
              {(tideOverlayActive || currentOverlayActive || driftPlannerActive) && (
                <button
                  data-testid="switch-to-plan-nudge"
                  onClick={() => setSidebarMode('plan')}
                  style={{
                    width: "100%",
                    minWidth: "min(460px, 100vw - 32px)",
                    maxWidth: 520,
                    padding: "7px 12px",
                    background: "rgb(2,8,18)",
                    border: "1px solid rgba(52,211,153,0.25)",
                    borderRadius: 6,
                    color: "#34d399",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    opacity: 0.85,
                    transition: "opacity 0.15s",
                    pointerEvents: "auto",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "0.85")}
                >
                  <span style={{ fontSize: "calc(18px * var(--bs-font-scale, 1))" }}>⇄</span>
                  Switch to Plan to configure conditions
                </button>
              )}
            </div>

            {/* ══════════════════════════════════════════════════
                PLAN MODE — Tides, Currents, Routes, Forecast
            ══════════════════════════════════════════════════ */}
            <div style={{ display: sidebarMode === 'plan' ? 'flex' : 'none', flexDirection: 'column', gap: 8 }}>
              {/* (1) Conditions — Tides + Currents stacked under one collapse */}
              <SidebarSectionGroup>
                <SidebarSection id="conditions" title="Conditions">
                  {tidalOverlay && (
                    <ErrorBoundary label="tide station panel">
                      <TideStationPanel
                        scrubDatetime={tidePlanTime}
                        onScrubChange={setTidePlanTime}
                        nowMs={tideNowMs}
                      />
                    </ErrorBoundary>
                  )}
                  {showTidePanel && tidalOverlay && effectiveTidalData !== null ? (
                    <ErrorBoundary label="tide panel">
                      <TidePanel
                        data={effectiveTidalData}
                        loading={tidalLoading}
                        depthLayer={depthLayer}
                        onDepthLayerChange={setDepthLayer}
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
                </SidebarSection>
              </SidebarSectionGroup>

              {/* Timeline hint — shown when tidal overlay or currents simulation is active */}
              {(tidalOverlay || currentsEnabled) && (
                <div
                  data-testid="plan-timeline-hint"
                  style={{
                    minWidth: "min(460px, 100vw - 32px)",
                    maxWidth: 520,
                    padding: "7px 10px",
                    background: "rgba(0,229,255,0.04)",
                    border: "1px dashed rgba(0,229,255,0.18)",
                    borderRadius: 4,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.13em",
                    color: "#64748b",
                    pointerEvents: "none",
                  }}
                >
                  <span style={{ color: "#00e5ff", marginRight: 5 }}>▸</span>
                  Use the timeline bar below to preview conditions over time.
                </div>
              )}

              {/* (2) Drift & Route — drift planner */}
              <SidebarSectionGroup>
                <SidebarSection id="driftRoute" title="Drift & Route">
                  <DriftPlannerPanel />
                  {!driftPlannerActive ? (
                    <div
                      data-testid="drift-empty-state"
                      style={{
                        padding: "14px 10px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        alignItems: "flex-start",
                      }}
                    >
                      <div style={{
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                        letterSpacing: "0.13em",
                        color: "#64748b",
                        lineHeight: 1.55,
                      }}>
                        Predict where your boat and fishing line will drift based on tidal currents and wind over a 24-hour window.
                      </div>
                      <button
                        data-testid="start-planning-button"
                        onClick={() => setDriftPlannerActive(true)}
                        style={{
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                          letterSpacing: "0.18em",
                          padding: "5px 12px",
                          borderRadius: 3,
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
                </SidebarSection>
              </SidebarSectionGroup>

              {/* Routes list — standalone card, appears between Drift and Forecast */}
              <RoutesPanel />

              <SidebarSectionGroup>
                <SidebarSection id="forecast" title="Forecast">
                  <ForecastStrip />
                </SidebarSection>
              </SidebarSectionGroup>

              <SidebarSectionGroup>
                <SidebarSection id="tripWindows" title="Trip Windows">
                  <ErrorBoundary label="trip window panel">
                    <TripWindowPanel />
                  </ErrorBoundary>
                </SidebarSection>
              </SidebarSectionGroup>

              {/* Back to Explore shortcut */}
              <button
                data-testid="plan-back-to-explore"
                onClick={() => setSidebarMode('explore')}
                style={{
                  background: "none",
                  border: "none",
                  color: "#475569",
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.15em",
                  cursor: "pointer",
                  padding: "4px 0",
                  textAlign: "left",
                  alignSelf: "flex-start",
                }}
              >
                ◂ Back to Explore
              </button>
            </div>

            {/* ══════════════════════════════════════════════════
                ANALYZE MODE — Habitat, Seafloor Classification,
                QueryPanel trigger
            ══════════════════════════════════════════════════ */}
            <div style={{ display: sidebarMode === 'analyze' ? 'flex' : 'none', flexDirection: 'column', gap: 8 }}>
              {!terrain ? (
                <div
                  data-testid="analyze-empty-state"
                  style={{
                    padding: "14px 12px",
                    textAlign: "center",
                    color: "#475569",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "calc(15px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.1em",
                    lineHeight: 1.6,
                    background: "rgb(2,8,18)",
                    border: "1px solid rgba(0,229,255,0.22)",
                    borderRadius: 6,
                  }}
                >
                  <div style={{ fontSize: "calc(30px * var(--bs-font-scale, 1))", marginBottom: 6, opacity: 0.5 }}>◈</div>
                  <div style={{ color: "#64748b", marginBottom: 8 }}>
                    Load a dataset to begin analysis.
                  </div>
                  <button
                    onClick={() => { setSidebarMode('explore'); useUiStore.getState().setFindDataPanelOpen(true); }}
                    style={{
                      fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                      letterSpacing: "0.12em",
                      padding: "4px 10px",
                      background: "rgba(0,229,255,0.06)",
                      border: "1px solid rgba(0,229,255,0.28)",
                      borderRadius: 3,
                      color: "#00e5ff",
                      cursor: "pointer",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    GO TO EXPLORE →
                  </button>
                </div>
              ) : (
                <>
                  <SidebarSectionGroup>
                    <SidebarSection id="habitat" title="Species Habitat">
                      {showHabitatPanel ? <HabitatPanel embedded /> : null}
                    </SidebarSection>
                  </SidebarSectionGroup>

                  <SidebarSectionGroup>
                    <SidebarSection id="seafloorClassification" title="Seafloor">
                      <SeafloorClassificationPanel />
                    </SidebarSection>
                  </SidebarSectionGroup>
                </>
              )}

              {showQueryPanel && (
                <ViewscreenTooltip label='Open AI query panel (press "/")' side="right">
                  <button
                    data-testid="ask-ai-trigger"
                    onClick={() => setQueryOpen(true)}
                    style={{
                      width: "100%",
                      minWidth: "min(460px, 100vw - 32px)",
                      maxWidth: 520,
                      padding: "9px 14px",
                      background: "rgb(2,8,18)",
                      border: "1px solid rgba(0,229,255,0.22)",
                      borderRadius: 6,
                      color: "#64748b",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "calc(15px * var(--bs-font-scale, 1))",
                      letterSpacing: "0.2em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ color: "#00e5ff", marginRight: 8 }}>⌕</span>
                    Ask AI
                    <span style={{ float: "right", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", letterSpacing: "0.1em", color: "#475569" }}>
                      press /
                    </span>
                  </button>
                </ViewscreenTooltip>
              )}
            </div>

            {/* ══════════════════════════════════════════════════
                LIVE MODE — on-the-water panel: GPS status,
                depth below position, trail recording, Follow Me
                and Dive-to-GPS actions.
            ══════════════════════════════════════════════════ */}
            <div style={{ display: sidebarMode === 'live' ? 'flex' : 'none', flexDirection: 'column', gap: 8 }}>
              <LivePanel />
            </div>

            {/* ── Footer: Conditions Legend (pinned bottom, all modes) ──
                Only renders when at least one of Wind / Tide / Current
                overlays is active (returns null otherwise). */}
            <div className="sidebar-footer-wrap" style={{ flexShrink: 0 }}>
              <ConditionsLegend />
            </div>
            </ErrorBoundary>
            <div style={{ height: "2in", flexShrink: 0 }} aria-hidden="true" />
          </div>
          </>
        )}

        {/* The Drive Boat / Tidal 3D / Drift toggles that used to live here
            (top-right toolbar) have moved into the left sidebar:
            Tidal 3D → Explore › Overlays & Tools, Drive Boat → Live panel,
            Drift → Plan › Drift & Route "Start Planning". A one-time
            relocation hint is shown in their old spot. */}
        <ToolbarRelocationHint />

        {/* One-tap GPS catch quick-drop — floating thumb-reachable button,
            bottom-right above the minimap. Renders only while GPS tracking
            is active with a fix and terrain is loaded. */}
        <QuickDropButton />

        {/* Screen wake lock while Live mode / GPS follow is active. */}
        <WakeLockManager />

        {/* Throttle panel — bottom-right above minimap, visible when realistic mode is on */}
        {realisticMode && (
          <div className="absolute z-20" style={{ bottom: 90, right: 16 }}>
            <ThrottlePanel onClose={() => setRealisticMode(false)} />
          </div>
        )}

        {/* Marker form overlay — centred, z-30 (create or edit) */}
        {(markerFormOpen || markerEditOpen) && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <div style={{ pointerEvents: "auto" }}>
              <MarkerForm />
            </div>
          </div>
        )}

        {/* Depth-profile chart — bottom-centre, z-36 */}
        <DepthProfilePanel />

        {/* Timeline scrubber bar — fixed at bottom, z-34, visible when a
            time-sensitive overlay is active. Depth-profile (z-36) renders
            on top when both are open so the bar never obscures the chart. */}
        <TimelineScrubBar />

        {/* Full-screen overview map — z-40, rendered above all HUD elements */}
        {overviewOpen && <OverviewMap />}

        {/* Markers panel — fixed right-side overlay */}
        {markersPanelOpen && <MarkersPanel />}

        {/* EFH species detail panel — z-60, lives above both the 3D scene
            and the overview map so clicking an EFH zone in either view
            shows the same card. Reads from uiStore.selectedEfh. */}
        <EfhDetailPanel />
        <SubstrateDetailPanel />
        <IntertidalHotspotCard />

        {/* Find Data slide-in panel — z-50, right side */}
        {findDataPanelOpen && (
          <FindDataPanel key={openFindDataCount} onClose={() => setFindDataPanelOpen(false)} />
        )}

        {/* Drift Planner timeline — bottom-centre, always shown when planner is active */}
        {driftPlannerActive && <DriftTimeline onClose={() => setDriftPlannerActive(false)} />}

        {/* ConditionsLegend has moved into the left sidebar (rendered above
            inside the side-pane flex column, after CurrentsPanel). Leaving
            this comment as a breadcrumb for anyone searching for the old
            bottom-left mount. */}

        {/*
          NOTE: <ContextMenu />, <MeasurementBanner /> and <MarkerDetailCard />
          are mounted globally in HomeRoute so they remain reachable from the
          dev-only window.__bathyTest helper used by e2e tests, and so the
          right-click portal lifecycle is identical in signed-in / signed-out
          flows.
        */}

        {/* iOS "Add to Home Screen" install hint */}
        {showIosInstallHint && (
          <div
            style={{
              position: "absolute",
              bottom: 80,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 60,
              background: "rgba(2,8,24,0.94)",
              border: "1px solid rgba(0,229,255,0.25)",
              borderRadius: 8,
              padding: "12px 18px",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(15px * var(--bs-font-scale, 1))",
              color: "#e2e8f0",
              letterSpacing: "0.08em",
              backdropFilter: "blur(12px)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              whiteSpace: "nowrap",
              pointerEvents: "auto",
            }}
          >
            <div style={{ color: "#00e5ff", fontWeight: 700, marginBottom: 4, fontSize: "calc(13.5px * var(--bs-font-scale, 1))", letterSpacing: "0.2em" }}>
              INSTALL BATHYSCAN
            </div>
            <div>Tap <span style={{ color: "#38bdf8" }}>Share ↑</span> → <span style={{ color: "#38bdf8" }}>Add to Home Screen</span></div>
            <button
              onClick={() => setShowIosInstallHint(false)}
              style={{
                position: "absolute",
                top: 6,
                right: 8,
                background: "none",
                border: "none",
                color: "#94a3b8",
                fontSize: "calc(21px * var(--bs-font-scale, 1))",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* "Click to resume" hint — appears briefly after closing overview */}
        {showResumeHint && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 35,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
                letterSpacing: "0.25em",
                color: "#00e5ff",
                textShadow: "0 0 12px rgba(0,229,255,0.6)",
                background: "rgba(2,8,24,0.75)",
                border: "1px solid rgba(0,229,255,0.2)",
                borderRadius: 4,
                padding: "8px 20px",
                backdropFilter: "blur(6px)",
              }}
            >
              CLICK TO RESUME FLY MODE
            </div>
          </div>
        )}

        {/* Active-recording safeguard chip — only visible when a recording is
            running and the user has navigated away from the Live tab.
            Clicking it switches back to Live so the full recorder UI is
            accessible. Nothing renders when GPS is merely active but not
            recording, avoiding the old "floating popup on every other tab"
            problem. */}
        {trailRecording && sidebarMode !== "live" && (
          <RecChip startedAt={trailStartedAt} onClick={() => setSidebarMode("live")} />
        )}

        {/* Minimap + controls legend — bottom-right and bottom-left */}
        {showCompassMinimap && (
          <div data-testid="minimap-container" className="absolute bottom-4 right-4 z-20">
            <Minimap />
          </div>
        )}

        {showControlsLegend && (
          <div className="absolute bottom-4 left-4 z-20">
            <ControlsLegend />
          </div>
        )}

        {/* Virtual joystick — gated by settings (auto/always/off), z-30 */}
        {(joystickMode !== "off" || showJoystickInOrbit) && (
          <div className="absolute inset-0 z-30 pointer-events-none">
            <div style={{ pointerEvents: "none", width: "100%", height: "100%", position: "relative" }}>
              <VirtualJoystick
                forceVisible={joystickMode === "always"}
                showInOrbit={showJoystickInOrbit}
              />
            </div>
          </div>
        )}

        {/* Query panel — slides up from the bottom, z-50 */}
        {showQueryPanel && (
          <QueryPanel
            open={queryOpen}
            onClose={() => { setQueryOpen(false); useHighlightStore.getState().clearHighlight(); }}
            setDatasetId={setDatasetId}
          />
        )}

        {/* Marker subsampling notice — bottom-right, shown when markers are capped */}
        <MarkerSubsampleBadge />

        {/* Query panel toggle hint — bottom-centre, visible when panel is closed */}
        {!queryOpen && (
          <ViewscreenTooltip label='Open natural-language query panel (press "/")' side="top">
          <button
            data-testid="query-panel-trigger"
            onClick={() => setQueryOpen(true)}
            style={{
              position: "absolute",
              bottom: 16,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
              background: "rgba(0,229,255,0.06)",
              border: "1px solid rgba(0,229,255,0.15)",
              borderRadius: 4,
              color: "#64748b",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.2em",
              padding: "4px 14px",
              cursor: "pointer",
              backdropFilter: "blur(4px)",
            }}
          >
            / QUERY
          </button>
          </ViewscreenTooltip>
        )}
          </>
        )}
        {/* MOBILE-ONLY: end of the desktop-only scene-area branch. */}
      </div>

      {/* Help floating window — mounted outside the isMobileChart branch so the
          help store trigger in Settings (mobile) can open it on both platforms. */}
      <HelpWindow />

      {/* What's Here card — floating summary of crosshair data */}
      {whatsHereOpen && (
        <WhatsHereCard data={whatsHereData} />
      )}

      {/* Onboarding overlay — shown to new users after the scene is ready.
          Suppressed while the WebGL context is lost/recovering so a recovery
          remount doesn't re-trigger the tour mid-session.
          MOBILE-ONLY branch: skipped on mobile — the tour targets desktop UI
          elements that don't exist in the mobile Chart View, and its overlay
          would block chart gestures. */}
      {!isMobileChart && (
        <OnboardingGuard terrain={terrain} settingsReady={settingsReady} />
      )}
    </div>
  );
}

/**
 * Renders the onboarding overlay once the 3D scene has a terrain loaded.
 * The overlay is kept mounted (not unmounted) while WebGL context is lost so
 * that the current tour step is preserved in component state — preventing the
 * tour from restarting at step 1 after a context-loss recovery remount.
 * Before the first terrain loads we don't mount at all so the overlay doesn't
 * flash during the initial data-load phase.
 */
function OnboardingGuard({
  terrain,
  settingsReady,
}: {
  terrain: unknown;
  settingsReady: boolean;
}) {
  const contextLost = useWebglContextStore((s) => s.contextLost);
  if (!terrain) return null;
  // Never mount before the server settings have settled: a signed-in user
  // whose hasSeenOnboarding=true lives server-side must not see the tour
  // flash (and intercept clicks) during the pre-hydration window.
  if (!settingsReady) return null;
  return <OnboardingOverlay suppressed={contextLost} />;
}

/**
 * MarkerSubsampleBadge — renders a small floating notice at the bottom-right
 * of the scene viewport when MarkerLayer is actively subsampling (the total
 * marker count exceeds the user's cluster threshold). Instructs the user to
 * zoom in to see more markers.
 */
function MarkerSubsampleBadge() {
  const isSubsampled = useMarkerLayerStore((s) => s.isSubsampled);
  const totalVisible = useMarkerLayerStore((s) => s.totalVisible);
  const renderedCount = useMarkerLayerStore((s) => s.renderedCount);
  const [dismissed, setDismissed] = useState(false);

  // Re-show the badge whenever subsampling becomes active again after being off
  // so new subsampling episodes aren't silently swallowed by a stale dismiss.
  const prevIsSubsampled = React.useRef(false);
  useEffect(() => {
    if (isSubsampled && !prevIsSubsampled.current) {
      setDismissed(false);
    }
    prevIsSubsampled.current = isSubsampled;
  }, [isSubsampled]);

  if (!isSubsampled || dismissed) return null;

  return (
    <div
      data-testid="marker-subsample-badge"
      style={{
        position: "absolute",
        bottom: 56,
        right: 16,
        zIndex: 25,
        background: "rgba(2,8,18,0.92)",
        border: "1px solid rgba(251,146,60,0.4)",
        borderRadius: 4,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: "calc(15px * var(--bs-font-scale, 1))",
        color: "#fb923c",
        padding: "5px 10px",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        pointerEvents: "auto",
        letterSpacing: "0.06em",
      }}
    >
      <span>
        Showing <strong>{renderedCount}</strong> of <strong>{totalVisible}</strong> markers — zoom in to see more
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss marker notice"
        style={{
          background: "none",
          border: "none",
          color: "#cbd5e1",
          cursor: "pointer",
          fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
          lineHeight: 1,
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

/** Exported for unit testing (closed-for-testing banner + hidden sign-up). */
export function LandingPage() {
  const [, setLocation] = useLocation();
  const siteClosed = isSiteClosed();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#040810] px-4 text-center">
      {siteClosed && <ClosedForTestingBanner />}
      <div className="absolute inset-0 bg-gradient-to-b from-[#040810] via-[#061220] to-[#040810] pointer-events-none" />
      <div className="relative z-10">
        <p className="text-[#94a3b8] font-mono text-[14px] sm:text-[18px] tracking-[0.3em] uppercase mb-4">Deep Sea Explorer</p>
        <h1 className="text-[42px] sm:text-[72px] font-mono font-bold text-[#e2e8f0] tracking-wider mb-2">BATHYSCAN</h1>
        <div className="h-px bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent mb-8" />
        <p className="text-[#cbd5e1] font-mono text-[16px] sm:text-[21px] mb-10 w-full max-w-sm mx-auto leading-relaxed">
          Explore 3D bathymetric seafloor maps. Upload sonar data, drop markers, and dive in.
        </p>
        <button
          onClick={() => setLocation("/sign-in")}
          className="px-8 py-3 bg-[#0369a1] hover:bg-[#0284c7] text-white font-mono text-[16px] sm:text-[21px] tracking-widest uppercase rounded transition-colors"
        >
          Sign In to Explore
        </button>
        {/* Closed-for-testing: the Create-account entry point is omitted
            entirely (not just disabled) while the site is closed. */}
        {!siteClosed && (
          <div className="mt-4">
            <button
              onClick={() => setLocation("/sign-up")}
              className="text-[#38bdf8] font-mono text-[14px] sm:text-[18px] hover:text-[#7dd3fc] transition-colors"
            >
              Create account
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ServerSettingsSyncMount() {
  // Mounts the always-on GET/PUT settings sync at the app root so that
  // panel collapse (and all other preferences) are hydrated on sign-in and
  // pushed to the server on every change — without requiring the user to
  // open the Settings page. See hooks/useServerSettingsSync.ts for details.
  useServerSettingsSync();
  return null;
}

function PaletteSuggestionMount() {
  // Runs the adaptive-palette suggestion pipeline whenever a new dataset
  // grid loads. Auto-applies silently for first-time users; surfaces a
  // banner in Settings for users with a customised palette.
  usePaletteSuggestion();
  return null;
}

function HomeRoute() {
  // QueryClientProvider wraps everything (including the global UI surfaces
  // below) so components like MarkerDetailCard — which intentionally mount
  // outside AppProvider so they keep working on the signed-out landing page
  // and in e2e — can still use React Query hooks (e.g. useSurfaceTemperature
  // to fetch live SST for the marker's coords).
  return (
    <QueryClientProvider client={queryClient}>
      <Show when="signed-in">
        {/* AccessGate is the outermost wrapper inside the signed-in branch so
            pending/banned users are intercepted BEFORE any data fetch fires
            (settings sync, dataset queries, etc. all mount inside it). */}
        <AccessGate>
          <TooltipProvider>
            <AppProvider>
              <TestBridge />
              <Main />
              <SimulatedDataConfirmDialog />
            </AppProvider>
            <Toaster />
          </TooltipProvider>
          <PaletteSuggestionMount />
          <ShallowDatasetBanner />
        </AccessGate>
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
      {/*
        Global UI surfaces (context menu, measurement banner, marker detail
        card) are mounted regardless of auth state so their stores can be
        driven independently. They render nothing unless their store has
        active state, so they're harmless on the signed-out landing page,
        and this also makes them reachable from e2e tests via the dev-only
        window.__bathyTest helper.
      */}
      <ContextMenu />
      <LandTerrainStatusBanner />
      <MeasurementBanner />
      <MarkerDetailCard />
      <CatchJournalPanel />
    </QueryClientProvider>
  );
}

/**
 * Fallback shown when the Settings component tree crashes at the top level
 * (outside the inner AdminSection boundary).  Preserves the dark background
 * so the user never sees a white flash; the Back button exits without a reload.
 */
function SettingsOuterFallback() {
  return (
    <div
      data-testid="settings-outer-error-fallback"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "#040810",
        color: "#e2e8f0",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        gap: 16,
        padding: "0 24px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "calc(12px * var(--bs-font-scale, 1))",
          color: "#94a3b8",
          letterSpacing: "0.08em",
        }}
      >
        Settings could not be displayed.
      </div>
      <div
        style={{
          fontSize: "calc(9px * var(--bs-font-scale, 1))",
          color: "rgba(148,163,184,0.55)",
          letterSpacing: "0.06em",
        }}
      >
        Reload to try again.
      </div>
      <button
        onClick={() => window.history.back()}
        style={{
          background: "transparent",
          border: "1px solid rgba(0,229,255,0.35)",
          borderRadius: 3,
          color: "#00e5ff",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "calc(9px * var(--bs-font-scale, 1))",
          letterSpacing: "0.12em",
          padding: "5px 16px",
          cursor: "pointer",
          marginTop: 4,
        }}
      >
        GO BACK
      </button>
    </div>
  );
}

// Exported for the route-level access-gate regression test
// (settingsRouteAccessGate.test.tsx).
export function SettingsRoute() {
  // On mobile, signed-out users land here via the gear button and need to see
  // the auth block (Sign In entry) rather than LandingPage.  Desktop keeps the
  // existing behaviour of showing LandingPage when signed out.
  // NOTE: named isMobileSettings (not isMobile) to avoid a false-positive from
  // the duplicate-hooks brace-counting parser, which may misattribute this
  // standalone function's hook declarations to the preceding Main() scope when
  // JSX braces throw off the depth counter.
  const isMobileSettings = useIsMobile();
  return (
    <QueryClientProvider client={queryClient}>
      <Show when="signed-in">
        {/* Same access gate as HomeRoute: a pending/banned user navigating
            straight to /settings must see the approval/suspension screen,
            not the settings UI (and must not trigger protected requests
            like the settings sync). */}
        <AccessGate>
          <ServerSettingsSyncMount />
          <PaletteSuggestionMount />
          <ShallowDatasetBanner />
          <ErrorBoundary fallback={<SettingsOuterFallback />}>
            <Settings />
          </ErrorBoundary>
        </AccessGate>
      </Show>
      <Show when="signed-out">
        {isMobileSettings ? (
          <ErrorBoundary fallback={<SettingsOuterFallback />}>
            <Settings />
          </ErrorBoundary>
        ) : (
          <LandingPage />
        )}
      </Show>
    </QueryClientProvider>
  );
}

// ─── Clerk load-error boundary ────────────────────────────────────────────────

/**
 * Number of ms to wait before each retry attempt when Clerk's JS bundle fails
 * to load from the CDN.  Exported so unit tests can control timing.
 */
export const CLERK_RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;

/** Maximum number of CDN-load retry attempts before showing the final fallback. */
export const MAX_CLERK_LOAD_RETRIES = CLERK_RETRY_DELAYS_MS.length;

/**
 * Returns true for the specific error Clerk throws when its JS bundle cannot
 * be fetched from the CDN.  All other render errors are NOT handled here —
 * they are re-thrown from render() so they propagate to the nearest parent
 * error boundary (or React's default unhandled-error path).
 *
 * Exported for unit testing.
 */
export function isClerkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return (
    msg.includes("failed_to_load_clerk_js") ||
    // Older Clerk SDK versions use a different string:
    msg.includes("ClerkJS could not be loaded") ||
    msg.includes("Failed to load Clerk")
  );
}

interface ClerkLoadErrorBoundaryState {
  /** Number of consecutive CDN-load failures already attempted. */
  failureCount: number;
  /** True while the error boundary is holding an unrecovered error. */
  hasError: boolean;
  /** True while the retry timer is running (waiting to remount children). */
  retrying: boolean;
  /** The raw error caught — used in render() to decide whether to re-throw. */
  caughtError: Error | null;
}

/**
 * Final fallback shown when all CDN-load retry attempts are exhausted.
 * Exported for unit testing.
 */
export function ClerkLoadFailedFallback() {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center h-screen bg-[#040810] text-sky-100 gap-4 p-8 text-center select-text"
    >
      <p className="text-[24px] font-medium">
        Authentication service failed to load.
      </p>
      <p className="text-[21px] text-sky-400">
        This may be a temporary network issue. Try reloading the page.
      </p>
      <CopyButton
        text={
          "Authentication service failed to load.\n" +
          "This may be a temporary network issue. Try reloading the page."
        }
        className="border border-cyan-400/30 text-cyan-300 hover:bg-cyan-400/10"
      />
      <button
        onClick={() => window.location.reload()}
        className="mt-2 px-4 py-2 bg-sky-700 hover:bg-sky-600 rounded text-[21px] font-medium text-white transition-colors"
      >
        Reload page
      </button>
    </div>
  );
}

/**
 * Error boundary that wraps ClerkProvider and catches CDN-load failures
 * (`failed_to_load_clerk_js`).  On failure it retries with exponential
 * back-off (2 s → 4 s → 8 s).  After exhausting retries it renders
 * ClerkLoadFailedFallback with a manual "Reload page" button.
 */
export class ClerkLoadErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ClerkLoadErrorBoundaryState
> {
  override state: ClerkLoadErrorBoundaryState = {
    failureCount: 0,
    hasError: false,
    retrying: false,
    caughtError: null,
  };

  private _retryTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<ClerkLoadErrorBoundaryState> {
    return { hasError: true, caughtError: error };
  }

  /**
   * componentDidCatch fires on every new error (including errors thrown during
   * retries), unlike componentDidUpdate whose prevState.hasError check would
   * be true → true after the first failure and therefore never re-schedule.
   *
   * Only Clerk CDN load errors are retried here.  Any other render error is
   * not handled — it propagates via render() re-throwing to the nearest parent
   * boundary.
   */
  override componentDidCatch(error: Error, _info: React.ErrorInfo): void {
    if (!isClerkLoadError(error)) return;
    // Guard: don't stack a second timer if one is already running.
    if (this._retryTimer !== null) return;
    const { failureCount } = this.state;
    if (failureCount < MAX_CLERK_LOAD_RETRIES) {
      const delay = CLERK_RETRY_DELAYS_MS[failureCount] ?? 8_000;
      this.setState({ retrying: true });
      this._retryTimer = setTimeout(() => {
        this._retryTimer = null;
        this.setState((s) => ({
          hasError: false,
          caughtError: null,
          failureCount: s.failureCount + 1,
          retrying: false,
        }));
      }, delay);
    }
  }

  override componentWillUnmount() {
    if (this._retryTimer !== null) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  override render() {
    const { hasError, caughtError, failureCount, retrying } = this.state;
    if (!hasError) return this.props.children;

    // Non-Clerk render errors are not our responsibility — re-throw so the
    // nearest parent error boundary (or React's unhandled-error path) handles
    // them.  This keeps the Clerk boundary tightly scoped.
    if (caughtError && !isClerkLoadError(caughtError)) throw caughtError;

    if (retrying || failureCount < MAX_CLERK_LOAD_RETRIES) {
      return (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center h-screen bg-[#040810] text-sky-400 text-[21px] gap-2"
        >
          <svg
            aria-hidden="true"
            className="animate-spin"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          Connecting…
        </div>
      );
    }

    return <ClerkLoadFailedFallback />;
  }
}

// ─── Session-expired banner ────────────────────────────────────────────────────

/**
 * Non-dismissable fixed banner shown when the Clerk session expires during
 * active use (persistent post-load 401s or getToken() consistently returning
 * null).  Rendered inside ClerkProvider so it's always in the tree.
 */
function SessionExpiredBanner() {
  const expired = useIsSessionExpired();
  if (!expired) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-center gap-3 h-9 bg-amber-950/95 backdrop-blur-sm border-b border-amber-800/50 text-amber-300 text-[18px] font-medium select-text"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      Session expired — please reload to continue
      <CopyButton
        text="Session expired — please reload to continue"
        className="text-amber-300/70 hover:text-amber-200"
      />
      <button
        onClick={() => window.location.reload()}
        className="ml-2 px-2 py-0.5 bg-amber-700 hover:bg-amber-600 rounded text-[16.5px] text-white transition-colors"
      >
        Reload
      </button>
    </div>
  );
}

/**
 * Wires Clerk's session token into the API client so every fetch carries
 * `Authorization: Bearer <token>` instead of relying on the __session cookie.
 * Cookie-based auth does not work in the Replit proxied-iframe environment
 * because Clerk's handshake 307 redirect cannot be followed by XHR/fetch.
 * Using short-lived JWTs from `session.getToken()` bypasses the handshake
 * entirely and works in any proxy or iframe setup.
 *
 * Resilience additions:
 * - Calls setClerkLoaded(true/false) so queryClient can distinguish startup
 *   401s from post-load 401s.
 * - Wraps getToken() with getTokenWithRetry() to catch one-off null returns
 *   (token-refresh hiccups) before triggering the session-expired banner.
 */
export function ClerkAuthTokenWirer() {
  const { session } = useClerk();
  const { user } = useUser();

  // Persist display name to localStorage on each successful sign-in so the
  // OfflineReadOnlyBanner can show it while the device is offline.
  useEffect(() => {
    if (!user) return;
    const firstName = user.firstName ?? "";
    const lastInitial = user.lastName ? ` ${user.lastName[0]}.` : "";
    const emailPrefix =
      user.primaryEmailAddress?.emailAddress?.split("@")[0] ?? "";
    const displayName = firstName ? `${firstName}${lastInitial}` : emailPrefix;
    persistOfflineIdentity({ displayName, userId: user.id });
  }, [user]);

  // Wire token getter into the API client.
  useEffect(() => {
    if (session) {
      setClerkLoaded(true);
      setAuthTokenGetter(() =>
        getTokenWithRetry(
          () => session.getToken(),
          // In dev-auth-bypass mode getToken() always returns null (the stub
          // has no real Clerk session), but API calls succeed via the
          // x-e2e-user-id header patch.  Don't fire the session-expired banner
          // for an expected null; use a no-op so the banner is never shown.
          DEV_AUTH_BYPASS ? () => {} : signalSessionExpired,
        ),
      );
    } else {
      setClerkLoaded(false);
      setAuthTokenGetter(null);
    }
    return () => {
      setAuthTokenGetter(null);
    };
  }, [session]);

  // When connectivity is restored while in offline read-only mode, clear the
  // banner and re-attempt the token.  If the token is still null (genuine
  // expiry), the normal session-expired path fires.  If it succeeds, the app
  // resumes silently without a page reload.
  useEffect(() => {
    if (!session) return;
    const onExpired = DEV_AUTH_BYPASS ? () => {} : signalSessionExpired;
    const unsubscribe = useOfflineStore.subscribe((state, prevState) => {
      if (state.isOnline && !prevState.isOnline) {
        useOfflineStore.getState().setOfflineReadOnly(false);
        // Re-attempt immediately — network is back; 0 delay still does one
        // retry internally before calling onExpired.
        void getTokenWithRetry(() => session.getToken(), onExpired, 0);
      }
    });
    return unsubscribe;
  }, [session]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  const waterType = useSettingsStore((s) => s.waterType);
  const labels = waterLabels(waterType);

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: `Sign in to explore the ${labels.floor}`,
          },
        },
        signUp: {
          start: {
            title: "Create account",
            subtitle: "Start exploring bathymetric data",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      {/* Session-expired banner — fixed overlay, non-dismissable. Fires when
          persistent post-load 401s or getToken() null retries exhaust.
          Mutually exclusive with OfflineReadOnlyBanner: isOfflineReadOnly and
          isSessionExpired should never both be true simultaneously. */}
      <SessionExpiredBanner />
      {/* Offline read-only banner — shown instead of SessionExpiredBanner when
          the token returns null because the device is offline rather than
          because the session genuinely expired. Clears on reconnect. */}
      <OfflineReadOnlyBanner />
      {/* Dev-only "API server down" warning banner. Mounted at the router
          root (not inside Main) so it is visible on every screen. The
          import.meta.env.DEV gate is statically false in production builds,
          so the component and its restart client are tree-shaken away. */}
      {import.meta.env.DEV && <DevApiDownBanner />}
      <SettingsSyncIndicator />
      <ClerkAuthTokenWirer />
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
      </QueryClientProvider>
      <Switch>
        <Route path="/" component={HomeRoute} />
        <Route path="/settings" component={SettingsRoute} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route component={NotFound} />
      </Switch>
    </ClerkProvider>
  );
}

/**
 * Always-mounted effect that mirrors a few accessibility preferences from
 * settingsStore onto document.body as CSS classes so they apply immediately
 * across every route (Home, Settings, Sign-in, etc.) — not just inside Main().
 *
 * Exported so unit tests can mount the real component in isolation.
 */
/** Maps each FontSizeLevel to a `--bs-font-scale` multiplier value. */
const FONT_SCALE_VALUES: Record<import("@/lib/settingsStore").FontSizeLevel, number> = {
  smallest: 0.80,
  small: 0.875,
  medium: 1.0,
  large: 1.15,
  "x-large": 1.30,
  largest: 1.45,
};

export function AccessibilityClassesEffect() {
  const reducedMotion = useSettingsStore((st) => st.reducedMotion);
  const globalFontSize = useSettingsStore((st) => st.globalFontSize);
  const highContrastHud = useSettingsStore((st) => st.highContrastHud);
  const colorBlindSafePalette = useSettingsStore((st) => st.colorBlindSafePalette);
  const brightDaylight = useSettingsStore((st) => st.brightDaylight);
  useEffect(() => {
    const b = document.body;
    b.classList.toggle("bs-reduced-motion", reducedMotion);
    b.classList.toggle("bs-high-contrast-hud", highContrastHud);
    b.classList.toggle("bs-cb-palette", colorBlindSafePalette);
    b.classList.toggle("bs-daylight", brightDaylight);
    const scale = FONT_SCALE_VALUES[globalFontSize] ?? 1;
    // --bs-font-scale is the single source of truth for the Text Size
    // setting. Body font-size, daylight-mode base sizes, and all inline
    // component sizes derive from it via calc() — no inline px override.
    b.style.setProperty("--bs-font-scale", String(scale));
    b.style.fontSize = "";
  }, [reducedMotion, globalFontSize, highContrastHud, colorBlindSafePalette, brightDaylight]);
  return null;
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AccessibilityClassesEffect />
      <ClerkLoadErrorBoundary>
        <ClerkProviderWithRoutes />
      </ClerkLoadErrorBoundary>
    </WouterRouter>
  );
}

export default App;
