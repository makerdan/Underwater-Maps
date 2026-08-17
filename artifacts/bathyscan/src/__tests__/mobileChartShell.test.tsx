/**
 * mobileChartShell.test.tsx — regression guard for the MOBILE-ONLY scene gate
 * (task: mobile Chart View shell).
 *
 * Guards the two failure modes called out in the task's Regression Guard:
 *   1. A refactor silently re-mounts the 3D/R3F canvas on mobile (reverting
 *      to the old heavy default). → The shell must render with NO WebGL
 *      context ever created, and useIsMobileImmediate must be true on the
 *      VERY FIRST render (a deferred-initial-value hook would flash-mount
 *      TourScene before the effect flips the flag).
 *   2. The mobile gate leaks into the desktop path. → useIsMobileImmediate
 *      must be false on desktop, and the App.tsx wiring must keep TourScene
 *      strictly inside the desktop branch of the gate (source-integrity
 *      assertions — full-App renders are not this repo's test pattern).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

vi.mock("three");

// The bottom sheet hosts existing desktop panels; they are irrelevant to the
// gate guard and heavy to mount, so stub them.
vi.mock("@/components/LivePanel", () => ({ LivePanel: () => <div data-testid="stub-live" /> }));
vi.mock("@/components/CurrentsPanel", () => ({ CurrentsPanel: () => <div data-testid="stub-currents" /> }));
vi.mock("@/components/RoutesPanel", () => ({ RoutesPanel: () => <div data-testid="stub-routes" /> }));
vi.mock("@/components/HabitatPanel", () => ({ HabitatPanel: () => <div data-testid="stub-habitat" /> }));
vi.mock("@/components/SeafloorClassificationPanel", () => ({
  SeafloorClassificationPanel: () => <div data-testid="stub-seafloor" />,
}));

// Auto-stubbing api-client mock — pattern copied from src/__tests__/apiClientMock.ts.
// NOTE: keep data:undefined — never data:[] (useEffect([data]) loop hazard).
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook()    { return { data: undefined, isLoading: false, isError: false }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${a.filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () => makeApiClientMock());

vi.mock("@/lib/clerkCompat", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({ isLoaded: true, isSignedIn: false }),
  };
});

import { useIsMobileImmediate } from "@/hooks/use-mobile";
import { MobileChartShell } from "@/components/mobile/MobileChartShell";
import { useSettingsStore } from "@/lib/settingsStore";
import { useUiStore } from "@/lib/uiStore";
import { useTerrainStore } from "@/lib/terrainStore";

/** Install a matchMedia stub whose max-width query matches (or not). */
function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/** Probe that records every value useIsMobileImmediate returns per render. */
function makeProbe(record: boolean[]) {
  return function Probe() {
    record.push(useIsMobileImmediate());
    return null;
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useIsMobileImmediate — synchronous first-render gate", () => {
  it("is TRUE on the very first render when the mobile media query matches (no WebGL flash-mount window)", () => {
    stubMatchMedia(true);
    const values: boolean[] = [];
    const Probe = makeProbe(values);
    render(<Probe />);
    expect(values.length).toBeGreaterThan(0);
    // Every render — including the first — must already be mobile.
    expect(values.every((v) => v === true)).toBe(true);
  });

  it("is FALSE on desktop, so the 3D scene branch still mounts", () => {
    stubMatchMedia(false);
    const values: boolean[] = [];
    const Probe = makeProbe(values);
    render(<Probe />);
    expect(values.every((v) => v === false)).toBe(true);
  });
});

describe("MobileChartShell — mobile scene replacement", () => {
  beforeEach(() => {
    stubMatchMedia(true);
    useSettingsStore.getState().resetAll();
    useUiStore.setState({ sidebarMode: "explore" });
    useTerrainStore.getState().clear();
  });

  it("renders the 2D chart shell and NEVER creates a WebGL context", () => {
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");

    render(<MobileChartShell />);

    expect(screen.getByTestId("mobile-chart-shell")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-chart-view")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-tab-bar")).toBeInTheDocument();

    // The heart of the regression guard: no WebGL context of any kind.
    for (const call of getContextSpy.mock.calls) {
      expect(String(call[0])).not.toMatch(/webgl/i);
    }
  });

  it("shows the bottom tab bar wired to the persisted sidebarMode (Plan opens the bottom sheet)", () => {
    render(<MobileChartShell />);
    expect(screen.queryByTestId("mobile-bottom-sheet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mobile-tab-plan"));
    expect(useUiStore.getState().sidebarMode).toBe("plan");
    expect(screen.getByTestId("mobile-bottom-sheet")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mobile-sheet-close"));
    expect(useUiStore.getState().sidebarMode).toBe("explore");
    expect(screen.queryByTestId("mobile-bottom-sheet")).not.toBeInTheDocument();
  });

  it("density stepper writes the settings-synced contourDensity key", () => {
    render(<MobileChartShell />);
    expect(useSettingsStore.getState().contourDensity).toBe(1);
    fireEvent.click(screen.getByTestId("mobile-density-2x"));
    expect(useSettingsStore.getState().contourDensity).toBe(2);
    fireEvent.click(screen.getByTestId("mobile-density-3x"));
    expect(useSettingsStore.getState().contourDensity).toBe(3);
  });

  it("dataset chip opens the compact picker", () => {
    render(<MobileChartShell />);
    expect(screen.queryByTestId("mobile-dataset-picker")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mobile-dataset-chip"));
    expect(screen.getByTestId("mobile-dataset-picker")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mobile-dataset-picker-close"));
    expect(screen.queryByTestId("mobile-dataset-picker")).not.toBeInTheDocument();
  });
});

describe("mobileMapTiltEnabled — settings key regression guard", () => {
  it("DEFAULT_SETTINGS contains mobileMapTiltEnabled: false", async () => {
    const { DEFAULT_SETTINGS } = await import("@/lib/settingsStore");
    expect(DEFAULT_SETTINGS).toHaveProperty("mobileMapTiltEnabled", false);
  });

  it("PutSettingsBody parses { mobileMapTiltEnabled: true } without error", async () => {
    const { PutSettingsBody } = await import("@workspace/api-zod");
    const result = PutSettingsBody.safeParse({ mobileMapTiltEnabled: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mobileMapTiltEnabled).toBe(true);
    }
  });

  it("MobileChartShell renders without throwing when mobileMapTiltEnabled is true", () => {
    stubMatchMedia(true);
    useSettingsStore.getState().resetAll();
    useSettingsStore.getState().setMobileMapTiltEnabled(true);
    expect(() => render(<MobileChartShell />)).not.toThrow();
    expect(screen.getByTestId("mobile-chart-view")).toBeInTheDocument();
    cleanup();
  });
});

describe("App.tsx wiring — source-integrity guard for the mobile gate", () => {
  // Full-App renders are not this repo's test pattern (App requires the whole
  // provider/AppState stack), so the gate wiring is asserted on the source
  // itself: TourScene must live strictly inside the desktop branch of the
  // isMobileChart ternary, and the gate must use the SYNCHRONOUS hook.
  // Vitest normally runs from the package root, but be robust to a repo-root
  // cwd too: pick the first candidate path that exists.
  const appPath = ["src/App.tsx", "artifacts/bathyscan/src/App.tsx"]
    .map((p) => path.resolve(process.cwd(), p))
    .find((p) => fs.existsSync(p));
  if (!appPath) throw new Error("mobileChartShell guard: could not locate src/App.tsx");
  const appSource = fs.readFileSync(appPath, "utf8");

  it("computes the gate with useIsMobileImmediate (synchronous first render)", () => {
    expect(appSource).toMatch(/const isMobileChart = useIsMobileImmediate\(\)/);
  });

  it("mounts MobileChartShell in the mobile branch BEFORE the 3D scene in the desktop branch", () => {
    const gateIdx = appSource.indexOf("{isMobileChart ? (");
    // Task 4003 added props to the shell usage, so match the opening tag only.
    const shellIdx = appSource.indexOf("<MobileChartShell");
    const tourIdx = appSource.indexOf("<TourScene");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(shellIdx).toBeGreaterThan(gateIdx);
    expect(tourIdx).toBeGreaterThan(shellIdx);
  });

  it("TourScene is mounted exactly once (desktop branch only)", () => {
    expect(appSource.match(/<TourScene/g)).toHaveLength(1);
  });

  it("the onboarding overlay is skipped on mobile", () => {
    expect(appSource).toMatch(/\{!isMobileChart && \(\s*<OnboardingGuard/);
  });
});
