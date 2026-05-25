/**
 * Settings page smoke test — verifies all sections render for a signed-in
 * user and that the "Show Advanced" global toggle + per-section
 * AdvancedDisclosure both expose advanced controls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// ---- Heavy module mocks (Clerk, react-query, API hooks, wouter, idb) ----
vi.mock("@clerk/react", () => ({
  useUser: () => ({
    user: { primaryEmailAddress: { emailAddress: "test@example.com" }, username: "test" },
    isSignedIn: true,
  }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetSettings: () => ({ data: null }),
  usePutSettings: () => ({ mutate: vi.fn() }),
  useDeleteMarkersMine: () => ({ mutate: vi.fn(), isPending: false }),
  getGetSettingsQueryKey: () => ["/api/settings"],
  getGetMarkersQueryKey: () => ["/api/markers"],
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: { activeGrid: null }) => unknown) => sel({ activeGrid: null }),
}));

vi.mock("idb-keyval", () => ({
  keys: () => Promise.resolve([]),
  clear: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  del: () => Promise.resolve(),
}));

// ---- Imports under test ----
import { Settings } from "@/pages/Settings";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
});

describe("Settings page", () => {
  it("renders all section tabs in the sidebar", () => {
    render(<Settings />);
    const expected = [
      "VISUALS & PERF",
      "CAMERA & CTRL",
      "HUD & LAYOUT",
      "OVERVIEW MAP",
      "MARKERS",
      "TIDAL",
      "HABITAT",
      "GPS & TRAIL",
      "DATA & STORAGE",
      "OFFLINE CACHE",
      "ACCESSIBILITY",
      "SHORTCUTS",
      "ACCOUNT & PRIVACY",
    ];
    for (const label of expected) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders the visuals section by default with quality preset control", () => {
    render(<Settings />);
    expect(screen.getByText(/VISUALS & PERFORMANCE/i)).toBeInTheDocument();
    expect(screen.getByText("QUALITY PRESET")).toBeInTheDocument();
  });

  it("exposes the global Show Advanced toggle and schema version badge", () => {
    render(<Settings />);
    expect(screen.getByText("SHOW ADVANCED")).toBeInTheDocument();
    expect(screen.getByText(/^v\d+$/)).toBeInTheDocument();
  });

  it("AdvancedDisclosure stays collapsed by default and opens when toggled", () => {
    render(<Settings />);
    const disclosureRoot = screen.getByTestId("visuals-advanced");
    expect(disclosureRoot).toBeInTheDocument();
    // Advanced cards (e.g. LIGHTING & FOG) not visible until disclosure opens.
    expect(screen.queryByText(/LIGHTING/)).not.toBeInTheDocument();
    const btn = within(disclosureRoot).getByRole("button");
    fireEvent.click(btn);
    expect(screen.getByText(/LIGHTING/)).toBeInTheDocument();
  });

  it("global Show Advanced toggle reveals advanced cards without per-section click", () => {
    render(<Settings />);
    expect(screen.queryByText(/LIGHTING/)).not.toBeInTheDocument();
    const toggleWrap = screen.getByTestId("show-advanced-toggle");
    const sw = within(toggleWrap).getByRole("switch");
    fireEvent.click(sw);
    expect(screen.getByText(/LIGHTING/)).toBeInTheDocument();
  });

  it("renders the global Reset ALL Settings footer", () => {
    render(<Settings />);
    expect(screen.getByTestId("reset-all-btn")).toBeInTheDocument();
  });

  it("exposes mouse / touchpad / pinch zoom sensitivity sliders defaulting to 1×", () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("CAMERA & CTRL"));
    expect(screen.getByText("Mouse Wheel Zoom Sensitivity")).toBeInTheDocument();
    expect(screen.getByText("Touchpad Zoom Sensitivity")).toBeInTheDocument();
    expect(screen.getByText("Mobile Pinch Zoom Sensitivity")).toBeInTheDocument();
    const s = useSettingsStore.getState();
    expect(s.mouseZoomSensitivity).toBe(1.0);
    expect(s.touchpadZoomSensitivity).toBe(1.0);
    expect(s.pinchZoomSensitivity).toBe(1.0);
  });

  it("setters and resetSection('camera') update / restore zoom sensitivities", () => {
    const s = useSettingsStore.getState();
    s.setMouseZoomSensitivity(2.5);
    s.setTouchpadZoomSensitivity(0.3);
    s.setPinchZoomSensitivity(1.8);
    expect(useSettingsStore.getState().mouseZoomSensitivity).toBe(2.5);
    expect(useSettingsStore.getState().touchpadZoomSensitivity).toBe(0.3);
    expect(useSettingsStore.getState().pinchZoomSensitivity).toBe(1.8);
    useSettingsStore.getState().resetSection("camera");
    expect(useSettingsStore.getState().mouseZoomSensitivity).toBe(1.0);
    expect(useSettingsStore.getState().touchpadZoomSensitivity).toBe(1.0);
    expect(useSettingsStore.getState().pinchZoomSensitivity).toBe(1.0);
  });
});
