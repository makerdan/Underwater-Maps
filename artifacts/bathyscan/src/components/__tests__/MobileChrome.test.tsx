/**
 * MobileChrome regression guard.
 *
 * Two concerns tested here:
 *
 * 1. App-level chrome (AppChromeShell thin-shell mirrors App.tsx:Main logic):
 *    - Mobile: no header/title; floating Help button absent.
 *    - Desktop: header with BATHYSCAN title + settings-link; Help button present.
 *
 * 2. MobileChartShell (direct render with mocks):
 *    - Gear Settings button is present and carries the correct aria-label and
 *      safe-area top offset on mobile — this is the REAL component that renders
 *      on phones, not a thin shell.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ─── shared mocks ────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(),
}));

vi.mock("@/components/AppHeader", () => ({
  AppHeader: () => (
    <header data-testid="app-header">
      <span>BATHYSCAN</span>
      <button data-testid="settings-link">Settings</button>
    </header>
  ),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpButton: () => <button data-testid="help-button">? HELP</button>,
}));

// ─── MobileChartShell dependency mocks ───────────────────────────────────────

vi.mock("wouter", () => ({
  useLocation: vi.fn(() => ["/", vi.fn()]),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetDatasets: vi.fn(() => ({ data: [] })),
  getGetDatasetsQueryKey: vi.fn(() => ["datasets"]),
  useGetUserDatasets: vi.fn(() => ({ data: [] })),
  getGetUserDatasetsQueryKey: vi.fn(() => ["user-datasets"]),
}));

vi.mock("@/lib/uiStore", () => ({
  useUiStore: vi.fn((sel: (s: { sidebarMode: string; setSidebarMode: () => void }) => unknown) =>
    sel({ sidebarMode: "explore", setSidebarMode: vi.fn() }),
  ),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: vi.fn(
    (
      sel: (s: {
        waterType: string;
        contourDensity: number;
        setContourDensity: () => void;
        contoursEnabled: boolean;
      }) => unknown,
    ) => sel({ waterType: "salt", contourDensity: 1, setContourDensity: vi.fn(), contoursEnabled: false }),
  ),
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: vi.fn((sel: (s: { primaryDatasetId: null }) => unknown) =>
    sel({ primaryDatasetId: null }),
  ),
}));

vi.mock("@/lib/clerkCompat", () => ({
  useAuth: vi.fn(() => ({ isLoaded: true, isSignedIn: false })),
}));

vi.mock("@/components/mobile/MobileChartView", () => ({
  MobileChartView: () => <div data-testid="mobile-chart-view" />,
}));

vi.mock("@/components/mobile/MobileDatasetPicker", () => ({
  MobileDatasetPicker: () => <div />,
}));

vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/LivePanel", () => ({ LivePanel: () => <div /> }));
vi.mock("@/components/CurrentsPanel", () => ({ CurrentsPanel: () => <div /> }));
vi.mock("@/components/RoutesPanel", () => ({ RoutesPanel: () => <div /> }));
vi.mock("@/components/HabitatPanel", () => ({ HabitatPanel: () => <div /> }));
vi.mock("@/components/SeafloorClassificationPanel", () => ({
  SeafloorClassificationPanel: () => <div />,
}));

vi.mock("@/components/ProximityHudChip", () => ({
  ProximityHudChip: () => null,
}));

vi.mock("@/components/mobile/MobileLiveOverlay", () => ({
  MobileLiveOverlay: () => null,
}));

vi.mock("@/components/BulkOfflinePanel", () => ({
  BulkOfflinePanel: () => null,
}));

vi.mock("@/lib/mobileMapFollow", () => ({
  startMobileGpsCameraMirror: vi.fn(() => () => undefined),
}));

vi.mock("@/hooks/useProximityStreamingWiring", () => ({
  useProximityStreamingWiring: vi.fn(),
}));

// ─── imports (after mocks) ────────────────────────────────────────────────────

import { useIsMobile } from "@/hooks/use-mobile";
import { AppHeader } from "@/components/AppHeader";
import { HelpButton } from "@/components/help/HelpButton";
import { MobileChartShell } from "@/components/mobile/MobileChartShell";

// ─── AppChromeShell: thin shell mirrors App.tsx header/help gating ────────────

/** Mirrors the conditional chrome logic in App.tsx's Main() for header + help. */
function AppChromeShell() {
  const isMobile = useIsMobile();
  return (
    <div>
      {!isMobile && <AppHeader />}
      <div style={{ position: "relative" }}>
        {!isMobile && <HelpButton />}
      </div>
    </div>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AppChromeShell — mobile viewport", () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(true);
  });

  it("does not render the app header on mobile", () => {
    render(<AppChromeShell />);
    expect(screen.queryByTestId("app-header")).toBeNull();
  });

  it("does not render the BATHYSCAN title on mobile", () => {
    render(<AppChromeShell />);
    expect(screen.queryByText("BATHYSCAN")).toBeNull();
  });

  it("does not render the floating Help button on mobile", () => {
    render(<AppChromeShell />);
    expect(screen.queryByTestId("help-button")).toBeNull();
  });
});

describe("AppChromeShell — desktop viewport", () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(false);
  });

  it("renders the app header on desktop", () => {
    render(<AppChromeShell />);
    expect(screen.getByTestId("app-header")).toBeInTheDocument();
  });

  it("renders the BATHYSCAN title on desktop", () => {
    render(<AppChromeShell />);
    expect(screen.getByText("BATHYSCAN")).toBeInTheDocument();
  });

  it("renders the settings-link testid on desktop", () => {
    render(<AppChromeShell />);
    expect(screen.getByTestId("settings-link")).toBeInTheDocument();
  });

  it("renders the floating Help button on desktop", () => {
    render(<AppChromeShell />);
    expect(screen.getByTestId("help-button")).toBeInTheDocument();
  });

  it("does not render the mobile gear button on desktop AppHeader", () => {
    render(<AppChromeShell />);
    expect(screen.queryByTestId("mobile-settings-gear")).toBeNull();
  });
});

// ─── MobileChartShell — gear button lives here on mobile ─────────────────────

describe("MobileChartShell — gear Settings button", () => {
  it("renders the gear button with the correct aria-label", () => {
    render(<MobileChartShell />);
    const gear = screen.getByTestId("mobile-settings-gear");
    expect(gear).toBeInTheDocument();
    expect(gear).toHaveAttribute("aria-label", "Open Settings");
  });

  it("gear button has safe-area-inset-top offset in its style", () => {
    render(<MobileChartShell />);
    const gear = screen.getByTestId("mobile-settings-gear");
    // jsdom normalises env() expressions; check for the token regardless of form.
    expect(gear.style.top).toMatch(/safe-area-inset-top/i);
  });

  it("gear button displays the gear glyph", () => {
    render(<MobileChartShell />);
    const gear = screen.getByTestId("mobile-settings-gear");
    expect(gear.textContent).toContain("⚙");
  });
});
