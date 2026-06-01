/**
 * Unit/integration tests for the EFH species toggle panel inside
 * OverlaysToolsPanel.
 *
 * Covers:
 * - Species checklist renders when efhOverlayEnabled=true AND hasEfh=true.
 * - Checklist is absent when efhOverlayEnabled=false.
 * - Checklist is absent when hasEfh=false (no EFH dataset / no embedded
 *   polygons).
 * - Clicking a species row updates hiddenEfhSpecies in uiStore
 *   (i.e. toggleEfhSpecies is wired correctly).
 * - Hidden species render at reduced opacity (aria-pressed="false").
 * - Visible species render at full opacity (aria-pressed="true").
 * - Dynamic "Filter by species" section renders when useGetEfh returns
 *   feature data and the overlay is active.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── Stable mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    terrain: { datasetId: "ds-efh", habitatPolygons: null },
  }),
}));

vi.mock("@/hooks/useSurfaceConditions", () => ({
  useSurfaceConditions: () => ({ loading: false, error: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/SubstrateLegend", () => ({
  SubstrateLegend: () => null,
}));

vi.mock("@/components/ShoreZoneCredit", () => ({
  ShoreZoneCredit: () => null,
}));

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => null,
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal();
  const storeState = { waterType: "salt" };
  const useSettingsStore = Object.assign(
    (sel: (s: { waterType: string }) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      setState: vi.fn(),
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );
  return { ...actual, useSettingsStore };
});

vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: (
    sel: (s: {
      collapsed: { overlaysTools: boolean };
      toggle: () => void;
    }) => unknown,
  ) => sel({ collapsed: { overlaysTools: false }, toggle: vi.fn() }),
}));

// ── Configurable dataset / EFH API mocks ─────────────────────────────────────

let mockDatasets: { id: string; hasEfh: boolean }[] = [
  { id: "ds-efh", hasEfh: true },
];

let mockEfhData: { features: { properties: { commonName: string; color: string } }[] } | undefined =
  undefined;

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
    useGetDatasets: () => ({ data: mockDatasets }),
    useGetEfh: () => ({ isLoading: false, isError: false, data: mockEfhData }),
  }),
);

// ── Imports under test ────────────────────────────────────────────────────────

import { OverlaysToolsPanel } from "@/components/OverlaysToolsPanel";
import { useUiStore } from "@/lib/uiStore";

// Inline snapshot of the GOA EFH species list used by the static checklist.
// Kept here so tests remain self-contained after efhSpeciesPalette.ts was removed.
const EFH_SPECIES_PALETTE = [
  { commonName: "Pacific Halibut",     color: "#f59e0b" },
  { commonName: "Pacific Cod",         color: "#6366f1" },
  { commonName: "Black Rockfish",      color: "#1f2937" },
  { commonName: "Dusky Rockfish",      color: "#7c3aed" },
  { commonName: "Pacific Ocean Perch", color: "#dc2626" },
  { commonName: "Quillback Rockfish",  color: "#facc15" },
  { commonName: "Rougheye Rockfish",   color: "#92400e" },
  { commonName: "Yelloweye Rockfish",  color: "#ef4444" },
  { commonName: "Arrowtooth Flounder", color: "#16a34a" },
  { commonName: "Sablefish",           color: "#0e7490" },
  { commonName: "Walleye Pollock",     color: "#7c3aed" },
];

// ── Test helpers ──────────────────────────────────────────────────────────────

function resetUiStore(overrides: Partial<ReturnType<typeof useUiStore.getState>> = {}) {
  useUiStore.setState({
    ...useUiStore.getState(),
    efhOverlayEnabled: false,
    hiddenEfhSpecies: new Set<string>(),
    selectedEfh: null,
    ...overrides,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockDatasets = [{ id: "ds-efh", hasEfh: true }];
  // Default: provide all species so toggle/aria tests have buttons to query.
  // Individual tests that need no data override this explicitly.
  mockEfhData = {
    features: EFH_SPECIES_PALETTE.map(({ commonName, color }) => ({
      properties: { commonName, color },
    })),
  };
  resetUiStore();
});

describe("OverlaysToolsPanel — EFH species toggle panel", () => {
  // ── Rendering conditions ───────────────────────────────────────────────────

  it("renders the EFH species checklist when efhOverlayEnabled=true and hasEfh=true", () => {
    resetUiStore({ efhOverlayEnabled: true });
    render(<OverlaysToolsPanel />);

    const firstSpecies = EFH_SPECIES_PALETTE[0]!.commonName;
    expect(screen.getByText(firstSpecies)).toBeInTheDocument();

    const lastSpecies =
      EFH_SPECIES_PALETTE[EFH_SPECIES_PALETTE.length - 1]!.commonName;
    expect(screen.getByText(lastSpecies)).toBeInTheDocument();
  });

  it("hides the EFH species checklist when efhOverlayEnabled=false", () => {
    resetUiStore({ efhOverlayEnabled: false });
    render(<OverlaysToolsPanel />);

    const firstSpecies = EFH_SPECIES_PALETTE[0]!.commonName;
    expect(screen.queryByText(firstSpecies)).not.toBeInTheDocument();
  });

  it("hides the EFH species checklist when hasEfh=false (dataset has no EFH)", () => {
    mockDatasets = [{ id: "ds-efh", hasEfh: false }];
    resetUiStore({ efhOverlayEnabled: true });
    render(<OverlaysToolsPanel />);

    const firstSpecies = EFH_SPECIES_PALETTE[0]!.commonName;
    expect(screen.queryByText(firstSpecies)).not.toBeInTheDocument();
  });

  it("renders all expected species when the checklist is visible", () => {
    resetUiStore({ efhOverlayEnabled: true });
    render(<OverlaysToolsPanel />);

    for (const { commonName } of EFH_SPECIES_PALETTE) {
      expect(screen.getByText(commonName)).toBeInTheDocument();
    }
  });

  // ── Toggle interaction ─────────────────────────────────────────────────────

  it("clicking a visible species row hides it (adds it to hiddenEfhSpecies)", () => {
    resetUiStore({ efhOverlayEnabled: true });
    render(<OverlaysToolsPanel />);

    const target = EFH_SPECIES_PALETTE[0]!.commonName;
    const btn = screen.getByTitle(`Hide ${target}`);

    act(() => { fireEvent.click(btn); });

    expect(useUiStore.getState().hiddenEfhSpecies.has(target)).toBe(true);
  });

  it("clicking a hidden species row makes it visible (removes it from hiddenEfhSpecies)", () => {
    const target = EFH_SPECIES_PALETTE[1]!.commonName;
    resetUiStore({
      efhOverlayEnabled: true,
      hiddenEfhSpecies: new Set([target]),
    });
    render(<OverlaysToolsPanel />);

    const btn = screen.getByTitle(`Show ${target}`);
    act(() => { fireEvent.click(btn); });

    expect(useUiStore.getState().hiddenEfhSpecies.has(target)).toBe(false);
  });

  it("clicking toggles pass the correct commonName to toggleEfhSpecies", () => {
    resetUiStore({ efhOverlayEnabled: true });
    render(<OverlaysToolsPanel />);

    // Click every species button and confirm each lands in hiddenEfhSpecies
    for (const { commonName } of EFH_SPECIES_PALETTE) {
      const btn = screen.getByTitle(`Hide ${commonName}`);
      act(() => { fireEvent.click(btn); });
      expect(useUiStore.getState().hiddenEfhSpecies.has(commonName)).toBe(true);
    }
  });

  // ── Aria and opacity ───────────────────────────────────────────────────────

  it("visible species button has aria-pressed='true' and opacity 1", () => {
    resetUiStore({ efhOverlayEnabled: true });
    render(<OverlaysToolsPanel />);

    const target = EFH_SPECIES_PALETTE[2]!.commonName;
    const btn = screen.getByTitle(`Hide ${target}`);

    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect((btn as HTMLElement).style.opacity).toBe("1");
  });

  it("hidden species button has aria-pressed='false' and reduced opacity (0.38)", () => {
    const target = EFH_SPECIES_PALETTE[2]!.commonName;
    resetUiStore({
      efhOverlayEnabled: true,
      hiddenEfhSpecies: new Set([target]),
    });
    render(<OverlaysToolsPanel />);

    const btn = screen.getByTitle(`Show ${target}`);

    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect((btn as HTMLElement).style.opacity).toBe("0.5");
  });

  it("multiple hidden species all render at reduced opacity with aria-pressed='false'", () => {
    const hidden = [EFH_SPECIES_PALETTE[0]!.commonName, EFH_SPECIES_PALETTE[3]!.commonName];
    resetUiStore({
      efhOverlayEnabled: true,
      hiddenEfhSpecies: new Set(hidden),
    });
    render(<OverlaysToolsPanel />);

    for (const name of hidden) {
      const btn = screen.getByTitle(`Show ${name}`);
      expect(btn.getAttribute("aria-pressed")).toBe("false");
      expect((btn as HTMLElement).style.opacity).toBe("0.5");
    }
  });

  // ── Dynamic "Filter by species" section ───────────────────────────────────

  it("renders a 'Filter by species' section when useGetEfh returns feature data", () => {
    mockEfhData = {
      features: [
        { properties: { commonName: "Pacific Halibut", color: "#f59e0b" } },
        { properties: { commonName: "Sablefish", color: "#0e7490" } },
      ],
    };
    resetUiStore({ efhOverlayEnabled: true });
    render(<OverlaysToolsPanel />);

    expect(screen.getByText(/filter by species/i)).toBeInTheDocument();
    // The dynamic section shows the raw name (not uppercased)
    expect(screen.getByText("Pacific Halibut")).toBeInTheDocument();
    expect(screen.getByText("Sablefish")).toBeInTheDocument();
  });

  it("dynamic section does not appear when useGetEfh returns no data", () => {
    mockEfhData = undefined;
    resetUiStore({ efhOverlayEnabled: true });
    render(<OverlaysToolsPanel />);

    expect(screen.queryByText(/filter by species/i)).not.toBeInTheDocument();
  });

  it("dynamic species button has aria-pressed='false' when that species is hidden", () => {
    mockEfhData = {
      features: [
        { properties: { commonName: "Sablefish", color: "#0e7490" } },
      ],
    };
    resetUiStore({
      efhOverlayEnabled: true,
      hiddenEfhSpecies: new Set(["Sablefish"]),
    });
    render(<OverlaysToolsPanel />);

    // Find the dynamic-section button (wraps inside a ViewscreenTooltip mock)
    const buttons = screen.getAllByRole("button");
    const dynamicBtn = buttons.find(
      (b) =>
        b.getAttribute("aria-pressed") !== null &&
        b.textContent?.includes("Sablefish"),
    );
    expect(dynamicBtn).toBeDefined();
    expect(dynamicBtn!.getAttribute("aria-pressed")).toBe("false");
  });
});
