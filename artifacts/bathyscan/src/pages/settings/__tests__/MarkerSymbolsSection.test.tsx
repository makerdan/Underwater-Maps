/**
 * MarkerSymbolsSection unit tests.
 *
 * Covers:
 *   - Mode-aware rendering: only the current mode's species group is shown
 *     prominently; the other mode's group sits in a collapsed panel
 *   - Mode indicator reflects the current water type
 *   - Legacy symbols are listed in a labelled "LEGACY (SAVED MARKERS)" card
 *   - Section headers are derived from MARKER_CATEGORY_LABELS
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  MARKER_CATEGORY_LABELS,
  getMarkerPickerSections,
  SALMON_MARKER_TYPES,
  BOTTOMFISH_MARKER_TYPES,
  LEGACY_MARKER_TYPES,
} from "@/lib/markerConstants";

const h = vi.hoisted(() => ({
  waterType: "saltwater" as "saltwater" | "freshwater",
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({ waterType: h.waterType });

  const useSettingsStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof state>) => T): T => sel(state()),
    {
      getState: () => state(),
      setState: vi.fn(),
      persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );

  return { ...actual, useSettingsStore };
});

vi.mock("@/lib/markerIcons", () => ({
  MarkerIcon: ({ type }: { type: string }) => <span data-testid={`marker-icon-${type}`} />,
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { MarkerSymbolsSection } from "../MarkerSymbolsSection";

describe("MarkerSymbolsSection — saltwater mode (default)", () => {
  it("keeps every mode-specific picker section aligned with visible Settings guide headings", () => {
    const expectedSections = {
      saltwater: [
        ["salmon", "SALMON TARGETS"],
        ["bottomfish", "BOTTOMFISH"],
        ["natural", "NATURAL WORLD"],
        ["mariner", "MARINER"],
        ["special", "SPECIAL"],
      ],
      freshwater: [
        ["freshwater", "FRESHWATER"],
        ["natural", "NATURAL WORLD"],
        ["mariner", "MARINER"],
        ["special", "SPECIAL"],
      ],
    } as const;

    for (const [mode, expected] of Object.entries(expectedSections)) {
      h.waterType = mode as "saltwater" | "freshwater";
      const { unmount } = render(<MarkerSymbolsSection />);

      expect(
        getMarkerPickerSections(h.waterType).map((section) => section.category),
        `${mode} marker picker sections must match the Settings guide contract`,
      ).toEqual(expected.map(([category]) => category));

      for (const [category, label] of expected) {
        expect(
          screen.getByText(label, { exact: true }),
          `${mode} Settings guide is missing the ${category} section heading (${label})`,
        ).toBeInTheDocument();
      }

      unmount();
    }
  });

  it("shows the saltwater marker guide prominently and not FRESHWATER", () => {
    h.waterType = "saltwater";
    render(<MarkerSymbolsSection />);
    expect(screen.getByTestId("marker-symbols-salmon-targets")).toBeInTheDocument();
    expect(screen.getByTestId("marker-symbols-bottomfish")).toBeInTheDocument();
    expect(screen.getByText(SALMON_MARKER_TYPES[0].label)).toBeInTheDocument();
    expect(screen.getByText(BOTTOMFISH_MARKER_TYPES[0].label)).toBeInTheDocument();
    expect(screen.queryByTestId("marker-symbols-freshwater")).not.toBeInTheDocument();
  });

  it("shows a mode indicator naming the current mode", () => {
    h.waterType = "saltwater";
    render(<MarkerSymbolsSection />);
    expect(screen.getByTestId("marker-symbols-mode-indicator")).toHaveTextContent(/SALTWATER/);
  });

  it("puts the other mode's symbols in a collapsed panel with a switch-mode note", () => {
    h.waterType = "saltwater";
    render(<MarkerSymbolsSection />);
    const details = screen.getByTestId("marker-symbols-other-mode");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(MARKER_CATEGORY_LABELS.freshwater);
    expect(details).toHaveTextContent(/Switch to Freshwater mode/);
  });

  it("always shows the shared NATURAL WORLD, MARINER, and SPECIAL groups", () => {
    h.waterType = "saltwater";
    render(<MarkerSymbolsSection />);
    expect(screen.getByText(MARKER_CATEGORY_LABELS.natural)).toBeInTheDocument();
    expect(screen.getByText(MARKER_CATEGORY_LABELS.mariner)).toBeInTheDocument();
    expect(screen.getByText(MARKER_CATEGORY_LABELS.special)).toBeInTheDocument();
  });

  it("lists legacy symbols in a labelled LEGACY (SAVED MARKERS) card", () => {
    h.waterType = "saltwater";
    render(<MarkerSymbolsSection />);
    expect(
      screen.getByText(`${MARKER_CATEGORY_LABELS.legacy} (SAVED MARKERS)`),
    ).toBeInTheDocument();
    // Spot-check a legacy-only symbol is present.
    expect(screen.getByText(LEGACY_MARKER_TYPES[0].label)).toBeInTheDocument();
  });
});

describe("MarkerSymbolsSection — freshwater mode", () => {
  it("shows the FRESHWATER group prominently and not SALTWATER", () => {
    h.waterType = "freshwater";
    render(<MarkerSymbolsSection />);
    expect(screen.getByTestId("marker-symbols-freshwater")).toBeInTheDocument();
    expect(screen.queryByTestId("marker-symbols-saltwater")).not.toBeInTheDocument();
  });

  it("mode indicator and collapsed panel swap accordingly", () => {
    h.waterType = "freshwater";
    render(<MarkerSymbolsSection />);
    expect(screen.getByTestId("marker-symbols-mode-indicator")).toHaveTextContent(/FRESHWATER/);
    const details = screen.getByTestId("marker-symbols-other-mode");
    expect(details).toHaveTextContent(MARKER_CATEGORY_LABELS.saltwater);
    expect(details).toHaveTextContent(/Switch to Saltwater mode/);
  });
});
