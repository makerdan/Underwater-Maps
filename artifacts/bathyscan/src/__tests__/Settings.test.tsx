/**
 * Settings page smoke test — verifies all sections render for a signed-in
 * user and that the "Show Advanced" global toggle + per-section
 * AdvancedDisclosure both expose advanced controls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

// ---- Heavy module mocks (Clerk, react-query, API hooks, wouter, idb) ----
vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat();
});

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
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
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetSettings: () => ({ data: null }),
  }),
);

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: { activeGrid: null }) => unknown) => sel({ activeGrid: null }),
}));

const mockIdbClear = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("idb-keyval", () => ({
  keys: () => Promise.resolve([]),
  clear: mockIdbClear,
  get: () => Promise.resolve(null),
  del: () => Promise.resolve(),
}));

const mockClearUpscaleCache = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/hooks/useUpscaledHeatmap", () => ({
  clearUpscaleCache: mockClearUpscaleCache,
  getUpscaleCacheInfo: vi.fn(() => Promise.resolve({ count: 1, bytes: 2048 })),
}));

const mockToast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ---- Imports under test ----
import { Settings } from "@/pages/Settings";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

const mockCachesDelete = vi.fn(() => Promise.resolve(true));
const mockCachesKeys = vi.fn(() => Promise.resolve(["terrain-v1", "tiles-v1"]));
const mockCachesOpen = vi.fn(() =>
  Promise.resolve({
    keys: () =>
      Promise.resolve([{ url: "https://example.com/api/datasets/demo/terrain" }]),
    match: () => Promise.resolve(undefined),
    delete: () => Promise.resolve(true),
  }),
);

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
  mockClearUpscaleCache.mockClear();
  mockToast.mockClear();
  mockIdbClear.mockClear();
  mockCachesDelete.mockClear();
  mockCachesKeys.mockClear();
  mockCachesOpen.mockClear();
  Object.defineProperty(window, "caches", {
    value: { keys: mockCachesKeys, delete: mockCachesDelete, open: mockCachesOpen },
    writable: true,
    configurable: true,
  });
});

describe("Settings page", () => {
  it("renders all section tabs in the sidebar", () => {
    render(<Settings />);
    const expected = [
      "GENERAL",
      "VISUALS & PERF",
      "NAVIGATION",
      "DISPLAY & OVERLAYS",
      "MAP LAYERS",
      "DATA & STORAGE",
      "ACCESSIBILITY",
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

  it("HUD section exposes the Show UI tooltips toggle (default ON)", () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("DISPLAY & OVERLAYS"));
    // Toggle lives inside the HUD AdvancedDisclosure (collapsed by default).
    const disclosure = screen.getByTestId("hud-advanced");
    fireEvent.click(within(disclosure).getByRole("button"));
    const label = screen.getByText("Show UI tooltips");
    expect(label).toBeInTheDocument();
    // ToggleRow: <row><labelWrap><label/><sublabel/></labelWrap><Toggle/></row>
    const row = label.parentElement?.parentElement as HTMLElement;
    const sw = within(row).getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(useSettingsStore.getState().showUiTooltips).toBe(false);
  });

  it("renders the global Reset ALL Settings footer", () => {
    render(<Settings />);
    expect(screen.getByTestId("reset-all-btn")).toBeInTheDocument();
  });

  it("exposes mouse / touchpad / pinch zoom sensitivity sliders defaulting to 1×", () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("NAVIGATION"));
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

  it("Accessibility tab: Bright Daylight toggle is visible and toggleable", () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("ACCESSIBILITY"));

    const label = screen.getByText("Bright Daylight");
    expect(label).toBeInTheDocument();

    // The toggle row wraps label + switch; climb up to the row root.
    const row = label.parentElement?.parentElement as HTMLElement;
    const sw = within(row).getByRole("switch");

    // Default is off.
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(useSettingsStore.getState().brightDaylight).toBe(false);

    // Toggle on.
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(useSettingsStore.getState().brightDaylight).toBe(true);

    // Toggle off again.
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(useSettingsStore.getState().brightDaylight).toBe(false);
  });

  it("OFFLINE CACHE section: clear-upscale-cache-btn is rendered", async () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("DATA & STORAGE"));
    await waitFor(() =>
      expect(screen.getByTestId("clear-upscale-cache-btn")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("clear-upscale-cache-btn")).toHaveTextContent(
      "CLEAR ENHANCED IMAGE CACHE",
    );
  });

  it("OFFLINE CACHE section: clicking the button calls clearUpscaleCache", async () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("DATA & STORAGE"));
    const btn = await screen.findByTestId("clear-upscale-cache-btn");
    fireEvent.click(btn);
    await waitFor(() => expect(mockClearUpscaleCache).toHaveBeenCalledOnce());
  });

  it("OFFLINE CACHE section: confirmation message appears after clearing", async () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("DATA & STORAGE"));
    const btn = await screen.findByTestId("clear-upscale-cache-btn");
    fireEvent.click(btn);
    await waitFor(() =>
      expect(
        screen.getByText("✓ Enhanced image cache cleared"),
      ).toBeInTheDocument(),
    );
  });

  it("OFFLINE CACHE section: toast is fired with the correct title after clearing", async () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("DATA & STORAGE"));
    const btn = await screen.findByTestId("clear-upscale-cache-btn");
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Enhanced image cache cleared" }),
      ),
    );
  });

  it("OFFLINE CACHE section: clear-all-cache-btn is rendered", async () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("DATA & STORAGE"));
    await waitFor(() =>
      expect(screen.getByTestId("clear-all-cache-btn")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("clear-all-cache-btn")).toHaveTextContent(
      "CLEAR ALL CACHE",
    );
  });

  it("OFFLINE CACHE section: clicking clear-all-cache-btn calls Cache API and idb-keyval clear", async () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("DATA & STORAGE"));
    const btn = await screen.findByTestId("clear-all-cache-btn");
    fireEvent.click(btn);
    await waitFor(() => expect(mockCachesKeys).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockCachesDelete).toHaveBeenCalledWith("terrain-v1"),
    );
    await waitFor(() =>
      expect(mockCachesDelete).toHaveBeenCalledWith("tiles-v1"),
    );
    await waitFor(() => expect(mockIdbClear).toHaveBeenCalled());
  });

  it("OFFLINE CACHE section: confirmation message appears after clearing all cached data", async () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("DATA & STORAGE"));
    const btn = await screen.findByTestId("clear-all-cache-btn");
    fireEvent.click(btn);
    await waitFor(() =>
      expect(
        screen.getByText("✓ All cached data cleared"),
      ).toBeInTheDocument(),
    );
  });
});
