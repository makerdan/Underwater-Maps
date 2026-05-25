import React, { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetDatasets } from "@workspace/api-client-react";
import { AppProvider, useAppState } from "@/lib/context";
import { TourScene } from "@/pages/TourScene";
import { HUD } from "@/components/HUD";
import { DatasetPicker } from "@/components/DatasetPicker";
import { FileUpload } from "@/components/FileUpload";
import { DepthLegend } from "@/components/DepthLegend";
import { AppHeader } from "@/components/AppHeader";

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
  const { data: datasets, isLoading: datasetsLoading } = useGetDatasets();
  const { datasetId, setDatasetId, terrain } = useAppState();

  useEffect(() => {
    if (datasets?.length && !datasetId) {
      setDatasetId(datasets[0]?.id ?? null);
    }
  }, [datasets, datasetId, setDatasetId]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#040810] flex flex-col">
      <AppHeader />
      <div className="relative flex-1 overflow-hidden" style={{ marginTop: 0 }}>
        <TourScene />

        <div className="absolute inset-0 pointer-events-none z-10">
          <HUD />
          {terrain && <DepthLegend />}
        </div>

        <div className="absolute top-4 right-4 z-20 w-80 space-y-4">
          <DatasetPicker datasets={datasets ?? []} isLoading={datasetsLoading} />
          <FileUpload />
        </div>
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

function HomeRoute() {
  return (
    <>
      <Show when="signed-in">
        <QueryClientProvider client={queryClient}>
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
