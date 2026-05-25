import React, { useEffect, useRef, useState } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetDatasets } from "@workspace/api-client-react";
import { AppProvider, useAppState } from "@/lib/context";
import { useTerrainStore } from "@/lib/terrainStore";
import { TourScene } from "@/pages/TourScene";
import { Settings } from "@/pages/Settings";
import { HUD } from "@/components/HUD";
import { DepthScaleBar } from "@/components/DepthScaleBar";
import { DatasetPanel } from "@/components/DatasetPanel";
import { Minimap } from "@/components/Minimap";
import { ControlsLegend } from "@/components/ControlsLegend";
import { AppHeader } from "@/components/AppHeader";
import { TidePanel } from "@/components/TidePanel";
import { ThrottlePanel } from "@/components/ThrottlePanel";
import { MarkerForm } from "@/components/MarkerForm";
import { ContextMenu } from "@/components/ContextMenu";
import { MeasurementBanner } from "@/components/MeasurementBanner";
import { MarkerDetailCard } from "@/components/MarkerDetailCard";
import { OverviewMap } from "@/components/OverviewMap";
import { ZoneOverlay } from "@/components/ZoneOverlay";
import { HabitatPanel } from "@/components/HabitatPanel";
import { QueryPanel } from "@/components/QueryPanel";
import { TrailRecorder } from "@/components/TrailRecorder";
import { VirtualJoystick } from "@/components/VirtualJoystick";
import { useTidalData } from "@/hooks/useTidalData";
import { useUiStore } from "@/lib/uiStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { useHighlightStore } from "@/lib/highlightStore";
import { useGpsStore } from "@/lib/gpsStore";
import { useOfflineStore } from "@/lib/offlineStore";
import type { DepthLayer } from "@/components/TidalCurrentArrows";
import { useSettingsStore } from "@/lib/settingsStore";
import { useGetSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";

const queryClient = new QueryClient();

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
    colorMutedForeground: "#94a3b8",
    colorDanger: "#f87171",
    colorBackground: "#0f172a",
    colorInput: "#1e293b",
    colorInputForeground: "#e2e8f0",
    colorNeutral: "#334155",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#0f172a] border border-[#1e3a5f] rounded-xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-black/60",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#e2e8f0] font-mono tracking-wide",
    headerSubtitle: "text-[#94a3b8] font-mono text-sm",
    socialButtonsBlockButtonText: "text-[#e2e8f0]",
    formFieldLabel: "text-[#94a3b8] font-mono text-xs uppercase tracking-widest",
    footerActionLink: "text-[#38bdf8] hover:text-[#7dd3fc]",
    footerActionText: "text-[#64748b]",
    dividerText: "text-[#475569]",
    identityPreviewEditButton: "text-[#38bdf8]",
    formFieldSuccessText: "text-[#34d399]",
    alertText: "text-[#fbbf24]",
    logoBox: "flex justify-center py-2",
    logoImage: "h-10 w-auto",
    socialButtonsBlockButton: "border border-[#1e3a5f] bg-[#1e293b] hover:bg-[#162032] text-[#e2e8f0]",
    formButtonPrimary: "bg-[#0369a1] hover:bg-[#0284c7] text-white font-mono",
    formFieldInput: "bg-[#1e293b] border-[#334155] text-[#e2e8f0] font-mono",
    footerAction: "border-t border-[#1e3a5f]",
    dividerLine: "bg-[#1e3a5f]",
    alert: "border border-[#92400e] bg-[#1c1008]",
    otpCodeFieldInput: "border-[#334155] bg-[#1e293b] text-[#e2e8f0]",
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
          <p className="text-[#475569] font-mono text-xs tracking-[0.3em] uppercase mb-2">Deep Sea Explorer</p>
          <h1 className="text-4xl font-mono font-bold text-[#e2e8f0] tracking-wider mb-1">BATHYSCAN</h1>
          <div className="h-px bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent mt-3" />
        </div>
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </div>
  );
}

function SignUpPage() {
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

function Main() {
  const [, setLocation] = useLocation();
  const { data: datasets } = useGetDatasets();
  const {
    datasetId, setDatasetId, terrain, tidalOverlay, setTidalOverlay,
    realisticMode, setRealisticMode,
  } = useAppState();
  const markerFormOpen = useUiStore((s) => s.markerFormOpen);
  const overviewOpen = useUiStore((s) => s.overviewOpen);
  const gpsActive = useGpsStore((s) => s.active);
  const [depthLayer, setDepthLayer] = useState<DepthLayer>("surface");
  const [scrubDatetime, setScrubDatetime] = useState<Date | null>(null);
  const [showResumeHint, setShowResumeHint] = useState(false);
  const [showIosInstallHint, setShowIosInstallHint] = useState(false);
  const [queryOpen, setQueryOpen] = useState(false);
  const prevOverviewOpenRef = useRef(false);

  const centerLat = terrain
    ? (terrain.minLat + terrain.maxLat) / 2
    : null;
  const centerLon = terrain
    ? (terrain.minLon + terrain.maxLon) / 2
    : null;

  const { data: tidalData, loading: tidalLoading } = useTidalData(
    tidalOverlay ? centerLat : null,
    tidalOverlay ? centerLon : null,
    tidalOverlay ? scrubDatetime : null,
  );

  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    if (hasAutoSelectedRef.current) return;
    if (datasets?.length && !datasetId) {
      hasAutoSelectedRef.current = true;
      setDatasetId(datasets[0]?.id ?? null);
    }
  }, [datasets, datasetId, setDatasetId]);

  useEffect(() => {
    if (terrain) {
      useTerrainStore.getState().setGrids({ activeGrid: terrain });
    }
  }, [terrain]);

  // Catch-all: trigger classification whenever terrain changes, regardless of
  // which code path loaded it (DatasetPanel, auto-select, background refetch, etc.).
  // classify() is idempotent — it returns immediately on sessionStorage/server cache hit.
  useEffect(() => {
    if (terrain) {
      void useClassificationStore.getState().classify(terrain);
    }
  }, [terrain]);

  // Sync online/offline state into offlineStore
  useEffect(() => {
    const setOnline = useOfflineStore.getState().setOnline;
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // iOS Safari "Add to Home Screen" hint (once per session)
  useEffect(() => {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = ("standalone" in navigator) && (navigator as unknown as { standalone: boolean }).standalone;
    const hintShown = sessionStorage.getItem("bs-ios-hint");
    if (!isIos || isStandalone || hintShown) return;
    sessionStorage.setItem("bs-ios-hint", "1");
    setShowIosInstallHint(true);
    const t = setTimeout(() => setShowIosInstallHint(false), 10000);
    return () => clearTimeout(t);
  }, []);

  // Flush offline-buffered trails when connection is restored
  useEffect(() => {
    const flushPendingTrails = async () => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith("pending-trail-")) keys.push(k);
      }
      if (!keys.length) return;

      const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      for (const key of keys) {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const payload = JSON.parse(raw) as {
            datasetId: string; name: string; colour?: string;
            startedAt: number; endedAt: number;
            points: { lon: number; lat: number; accuracy: number; timestamp: number; seq: number }[];
          };
          const res = await fetch(`${apiBase}/api/trails`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              datasetId: payload.datasetId,
              name: payload.name,
              colour: payload.colour ?? "#ff6600",
              startedAt: new Date(payload.startedAt).toISOString(),
              endedAt: new Date(payload.endedAt).toISOString(),
              points: payload.points,
            }),
          });
          if (res.ok) localStorage.removeItem(key);
        } catch {
          // leave key for next retry
        }
      }
    };

    // Flush offline-buffered markers when connection is restored
    const flushPendingMarkers = async () => {
      const { keys, get, del } = await import("idb-keyval");
      const allKeys = await keys();
      const markerKeys = allKeys.filter(
        (k): k is string => typeof k === "string" && k.startsWith("pending-marker-")
      );
      if (!markerKeys.length) return;

      const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      for (const key of markerKeys) {
        try {
          const payload = await get(key);
          if (!payload) continue;
          const res = await fetch(`${apiBase}/api/markers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (res.ok) await del(key);
        } catch {
          // leave for next retry
        }
      }
    };

    const onlineHandler = () => {
      void flushPendingTrails();
      void flushPendingMarkers();
    };
    window.addEventListener("online", onlineHandler);
    void flushPendingTrails();
    void flushPendingMarkers();
    return () => window.removeEventListener("online", onlineHandler);
  }, []);

  // O key — toggle overview map
  // Slash key — open query panel
  // Comma key — open settings
  // Escape — close query panel and clear highlights
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "KeyO" && !e.repeat) {
        const store = useUiStore.getState();
        store.setOverviewOpen(!store.overviewOpen);
      }
      if (e.key === "/" && !e.repeat) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault();
          setQueryOpen(true);
        }
      }
      if (e.key === "," && !e.repeat && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
          setLocation(basePath + "/settings");
        }
      }
      if (e.key === "Escape" && !e.repeat) {
        setQueryOpen(false);
        useHighlightStore.getState().clearHighlight();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setLocation]);

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
      <AppHeader />

      <div className="relative flex-1 overflow-hidden">
        {/* 3D Scene — fills everything */}
        <TourScene
          tidalData={tidalData}
          tidalOverlay={tidalOverlay}
          depthLayer={depthLayer}
        />

        {/* HUD + depth scale — pointer-events:none overlay */}
        <div className="absolute inset-0 pointer-events-none z-10">
          <HUD />
          <DepthScaleBar />
        </div>

        {/* Dataset panel — top-left, vertically scrollable when content overflows */}
        <div
          className="absolute top-12 left-4 z-20 flex flex-col gap-2 overflow-y-auto overscroll-contain"
          style={{
            maxHeight: "calc(100vh - 7rem)",
            paddingRight: 4,
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(0,229,255,0.35) transparent",
          }}
        >
          <DatasetPanel />
          <ZoneOverlay />
          <HabitatPanel />
        </div>

        {/* Tidal + Realistic toggle buttons — top-right of scene */}
        <div className="absolute top-3 right-16 z-20 flex gap-2">
          <button
            onClick={() => setRealisticMode(!realisticMode)}
            title={realisticMode ? "Disable Realistic Mode" : "Enable Realistic Mode (boat throttle)"}
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: 10,
              letterSpacing: "0.18em",
              padding: "4px 10px",
              borderRadius: 3,
              border: `1px solid ${realisticMode ? "rgba(34,211,238,0.5)" : "rgba(0,229,255,0.15)"}`,
              background: realisticMode ? "rgba(34,211,238,0.12)" : "rgba(0,10,20,0.75)",
              color: realisticMode ? "#22d3ee" : "#475569",
              textShadow: realisticMode ? "0 0 8px rgba(34,211,238,0.5)" : "none",
              cursor: "pointer",
              userSelect: "none",
              backdropFilter: "blur(4px)",
              transition: "all 0.15s ease",
            }}
          >
            {realisticMode ? "◉" : "○"} REALISTIC
          </button>
          <button
            onClick={() => setTidalOverlay(!tidalOverlay)}
            title={tidalOverlay ? "Disable Tidal Overlay" : "Enable Tidal Overlay"}
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: 10,
              letterSpacing: "0.18em",
              padding: "4px 10px",
              borderRadius: 3,
              border: `1px solid ${tidalOverlay ? "rgba(0,229,255,0.45)" : "rgba(0,229,255,0.15)"}`,
              background: tidalOverlay ? "rgba(0,229,255,0.1)" : "rgba(0,10,20,0.75)",
              color: tidalOverlay ? "#00e5ff" : "#475569",
              textShadow: tidalOverlay ? "0 0 8px rgba(0,229,255,0.5)" : "none",
              cursor: "pointer",
              userSelect: "none",
              backdropFilter: "blur(4px)",
              transition: "all 0.15s ease",
            }}
          >
            {tidalOverlay ? "◉" : "○"} TIDAL
          </button>
        </div>

        {/* Tide HUD panel — bottom-left, above controls legend */}
        {tidalOverlay && tidalData !== null && (
          <div className="absolute z-20" style={{ bottom: 52, left: 16 }}>
            <TidePanel
              data={tidalData}
              loading={tidalLoading}
              depthLayer={depthLayer}
              onDepthLayerChange={setDepthLayer}
              scrubDatetime={scrubDatetime}
              onScrubChange={setScrubDatetime}
            />
          </div>
        )}

        {/* Throttle panel — bottom-right above minimap, visible when realistic mode is on */}
        {realisticMode && (
          <div className="absolute z-20" style={{ bottom: 90, right: 16 }}>
            <ThrottlePanel onClose={() => setRealisticMode(false)} />
          </div>
        )}

        {/* Marker form overlay — centred, z-30 */}
        {markerFormOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <div style={{ pointerEvents: "auto" }}>
              <MarkerForm />
            </div>
          </div>
        )}

        {/* Measurement banner — z-25, below crosshair */}
        <MeasurementBanner />

        {/* Marker detail card — z-35, right side */}
        <MarkerDetailCard />

        {/* Full-screen overview map — z-40, rendered above all HUD elements */}
        {overviewOpen && <OverviewMap />}

        {/* Global right-click context menu — rendered into document.body via portal */}
        <ContextMenu />

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
              fontSize: 10,
              color: "#94a3b8",
              letterSpacing: "0.08em",
              backdropFilter: "blur(12px)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              whiteSpace: "nowrap",
              pointerEvents: "auto",
            }}
          >
            <div style={{ color: "#00e5ff", fontWeight: 700, marginBottom: 4, fontSize: 9, letterSpacing: "0.2em" }}>
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
                color: "#475569",
                fontSize: 14,
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
                fontSize: 11,
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

        {/* GPS Trail Recorder — bottom-right above minimap */}
        {gpsActive && (
          <div className="absolute z-20" style={{ bottom: 60, right: 16 }}>
            <TrailRecorder />
          </div>
        )}

        {/* Minimap + controls legend — bottom-right and bottom-left */}
        <div className="absolute bottom-4 right-4 z-20">
          <Minimap />
        </div>

        <div className="absolute bottom-4 left-4 z-20">
          <ControlsLegend />
        </div>

        {/* Virtual joystick — touch devices only, z-30 */}
        <div className="absolute inset-0 z-30 pointer-events-none">
          <div style={{ pointerEvents: "none", width: "100%", height: "100%", position: "relative" }}>
            <VirtualJoystick />
          </div>
        </div>

        {/* Query panel — slides up from the bottom, z-50 */}
        <QueryPanel
          open={queryOpen}
          onClose={() => { setQueryOpen(false); useHighlightStore.getState().clearHighlight(); }}
          setDatasetId={setDatasetId}
        />

        {/* Query panel toggle hint — bottom-centre, visible when panel is closed */}
        {!queryOpen && (
          <button
            data-testid="query-panel-trigger"
            onClick={() => setQueryOpen(true)}
            title='Open query panel (press "/")'
            style={{
              position: "absolute",
              bottom: 16,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
              background: "rgba(0,229,255,0.06)",
              border: "1px solid rgba(0,229,255,0.15)",
              borderRadius: 4,
              color: "#334155",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              letterSpacing: "0.2em",
              padding: "4px 14px",
              cursor: "pointer",
              backdropFilter: "blur(4px)",
            }}
          >
            / QUERY
          </button>
        )}
      </div>
    </div>
  );
}

function LandingPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#040810] px-4 text-center">
      <div className="absolute inset-0 bg-gradient-to-b from-[#040810] via-[#061220] to-[#040810] pointer-events-none" />
      <div className="relative z-10">
        <p className="text-[#475569] font-mono text-xs tracking-[0.3em] uppercase mb-4">Deep Sea Explorer</p>
        <h1 className="text-5xl font-mono font-bold text-[#e2e8f0] tracking-wider mb-2">BATHYSCAN</h1>
        <div className="h-px bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent mb-8" />
        <p className="text-[#64748b] font-mono text-sm mb-10 max-w-sm mx-auto leading-relaxed">
          Explore 3D bathymetric seafloor maps. Upload sonar data, drop markers, and dive in.
        </p>
        <button
          onClick={() => setLocation("/sign-in")}
          className="px-8 py-3 bg-[#0369a1] hover:bg-[#0284c7] text-white font-mono text-sm tracking-widest uppercase rounded transition-colors"
        >
          Sign In to Explore
        </button>
        <div className="mt-4">
          <button
            onClick={() => setLocation("/sign-up")}
            className="text-[#38bdf8] font-mono text-xs hover:text-[#7dd3fc] transition-colors"
          >
            Create account
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsHydrator() {
  const { data: serverSettings } = useGetSettings({
    query: { enabled: true, queryKey: getGetSettingsQueryKey() },
  });
  const hydrateFromServer = useSettingsStore((s) => s.hydrateFromServer);
  useEffect(() => {
    if (serverSettings) hydrateFromServer(serverSettings);
  }, [serverSettings, hydrateFromServer]);
  return null;
}

function HomeRoute() {
  return (
    <>
      <Show when="signed-in">
        <QueryClientProvider client={queryClient}>
          <SettingsHydrator />
          <TooltipProvider>
            <AppProvider>
              <Main />
            </AppProvider>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function SettingsRoute() {
  return (
    <QueryClientProvider client={queryClient}>
      <Show when="signed-in">
        <Settings />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </QueryClientProvider>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

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
            subtitle: "Sign in to explore the seafloor",
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
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
      </QueryClientProvider>
      <Switch>
        <Route path="/" component={HomeRoute} />
        <Route path="/settings" component={SettingsRoute} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
      </Switch>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
