/**
 * Verifies that MarkerSymbolsSection never renders the string "undefined"
 * when a section's category has no entry in CATEGORY_SUBLABELS.
 *
 * This file uses its own vi.mock for @/lib/markerConstants so that
 * getMarkerPickerSections can inject a fabricated unknown category without
 * affecting the other MarkerSymbolsSection test suite.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Hoist state so both the mock factory and the test body share it ──────────
const h = vi.hoisted(() => ({
  waterType: "saltwater" as "saltwater" | "freshwater",
}));

// ── settingsStore mock (same pattern as the main test file) ──────────────────
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

// ── markerConstants mock — injects one section with an unknown category ───────
vi.mock("@/lib/markerConstants", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/markerConstants")>();

  // Return a single section whose category does NOT exist in CATEGORY_SUBLABELS
  // so that the lookup returns undefined at runtime.
  const getMarkerPickerSections = () => [
    {
      // Cast forces the unknown string through the typed interface.
      category: "__unknown_test_category__" as unknown as import("@/lib/markerConstants").MarkerCategory,
      label: "Unknown Category",
      types: [],
    },
  ];

  return { ...actual, getMarkerPickerSections };
});

vi.mock("@/lib/markerIcons", () => ({
  MarkerIcon: ({ type }: { type: string }) => (
    <span data-testid={`marker-icon-${type}`} />
  ),
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

import { MarkerSymbolsSection } from "../MarkerSymbolsSection";

describe("MarkerSymbolsSection — CATEGORY_SUBLABELS fallback", () => {
  it("does not render the string 'undefined' when a section category has no sublabel entry", () => {
    h.waterType = "saltwater";
    render(<MarkerSymbolsSection />);
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
  });
});
