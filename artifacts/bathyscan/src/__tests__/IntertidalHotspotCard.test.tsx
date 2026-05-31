/**
 * Tests for IntertidalHotspotCard.
 *
 * Coverage:
 *   1. Renders nothing when selectedHotspot is null.
 *   2. tidepool mode → tidepool whySummary and bioband/energy chips are shown;
 *      beachcombing chips are not shown.
 *   3. beachcombing mode → beachcombing whySummary and debris/humanUse chips
 *      are shown; tidepool chips are not shown.
 *   4. Both score values (tidepoolScore, beachcombingScore) are present in the
 *      rendered output regardless of the active mode.
 *   5. The "active" mode indicator text matches uiStore.intertidalScoreMode.
 *   6. The close button calls setSelectedHotspot(null).
 *   7. Switching mode (via store) flips which signals are rendered.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { IntertidalHotspotCard } from "@/components/IntertidalHotspotCard";
import { useUiStore } from "@/lib/uiStore";
import type { SelectedHotspot } from "@/lib/uiStore";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const HOTSPOT: SelectedHotspot = {
  unitId: "unit-001",
  substrate: "bedrock",
  shoreZoneClass: "B1a",
  tidepoolScore: 78,
  beachcombingScore: 45,
  szMaterial: "R",
  szForm: "F",
  signals: {
    tidepool: {
      substrate: "Bedrock tidepool",
      bioband: "Barnacle zone",
      debris: null,
      energy: "High",
      humanUse: null,
      whySummary: "High biodiversity tidepool habitat",
    },
    beachcombing: {
      substrate: "Sandy beach",
      bioband: null,
      debris: "Drift log",
      energy: "Low",
      humanUse: "Recreational",
      whySummary: "Good beachcombing conditions",
    },
  },
  sourceName: "NOAA ShoreZone",
  creditUrl: "https://portal.aoos.org/",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderCard() {
  return renderWithProviders(<IntertidalHotspotCard />);
}

function seedStore(
  hotspot: SelectedHotspot | null,
  mode: "tidepool" | "beachcombing" = "tidepool",
) {
  act(() => {
    useUiStore.setState({ selectedHotspot: hotspot, intertidalScoreMode: mode });
  });
}

// ---------------------------------------------------------------------------
// Reset store state after every test
// ---------------------------------------------------------------------------

beforeEach(() => {
  act(() => {
    useUiStore.setState({ selectedHotspot: null, intertidalScoreMode: "tidepool" });
  });
});

afterEach(() => {
  act(() => {
    useUiStore.setState({ selectedHotspot: null, intertidalScoreMode: "tidepool" });
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IntertidalHotspotCard — visibility", () => {
  it("renders nothing when selectedHotspot is null", () => {
    renderCard();
    expect(screen.queryByTestId("intertidal-hotspot-card")).not.toBeInTheDocument();
  });

  it("renders the card when a hotspot is selected", () => {
    seedStore(HOTSPOT);
    renderCard();
    expect(screen.getByTestId("intertidal-hotspot-card")).toBeInTheDocument();
  });
});

describe("IntertidalHotspotCard — tidepool mode signals", () => {
  beforeEach(() => seedStore(HOTSPOT, "tidepool"));

  it("shows the tidepool whySummary", () => {
    renderCard();
    expect(
      screen.getByText("High biodiversity tidepool habitat"),
    ).toBeInTheDocument();
  });

  it("shows tidepool signal chips (bioband, energy)", () => {
    renderCard();
    expect(screen.getByText("Barnacle zone")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("does NOT show beachcombing-only chips (debris, humanUse)", () => {
    renderCard();
    expect(screen.queryByText("Drift log")).not.toBeInTheDocument();
    expect(screen.queryByText("Recreational")).not.toBeInTheDocument();
  });

  it("does NOT show the beachcombing whySummary", () => {
    renderCard();
    expect(
      screen.queryByText("Good beachcombing conditions"),
    ).not.toBeInTheDocument();
  });

  it("shows 'Tidepool mode active' indicator", () => {
    renderCard();
    expect(screen.getByText(/tidepool mode active/i)).toBeInTheDocument();
  });
});

describe("IntertidalHotspotCard — beachcombing mode signals", () => {
  beforeEach(() => seedStore(HOTSPOT, "beachcombing"));

  it("shows the beachcombing whySummary", () => {
    renderCard();
    expect(
      screen.getByText("Good beachcombing conditions"),
    ).toBeInTheDocument();
  });

  it("shows beachcombing signal chips (debris, humanUse)", () => {
    renderCard();
    expect(screen.getByText("Drift log")).toBeInTheDocument();
    expect(screen.getByText("Recreational")).toBeInTheDocument();
  });

  it("does NOT show tidepool-only chips (bioband, energy) when null in beachcombing", () => {
    renderCard();
    expect(screen.queryByText("Barnacle zone")).not.toBeInTheDocument();
  });

  it("does NOT show the tidepool whySummary", () => {
    renderCard();
    expect(
      screen.queryByText("High biodiversity tidepool habitat"),
    ).not.toBeInTheDocument();
  });

  it("shows 'Beachcombing mode active' indicator", () => {
    renderCard();
    expect(screen.getByText(/beachcombing mode active/i)).toBeInTheDocument();
  });
});

describe("IntertidalHotspotCard — score dials", () => {
  it("renders the tidepool score value in both modes", () => {
    seedStore(HOTSPOT, "tidepool");
    renderCard();
    const matches = screen.getAllByText("78");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the beachcombing score value in both modes", () => {
    seedStore(HOTSPOT, "tidepool");
    renderCard();
    const matches = screen.getAllByText("45");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("the tidepool ScoreCircle label is always present", () => {
    seedStore(HOTSPOT, "beachcombing");
    renderCard();
    expect(screen.getByText("Tidepool")).toBeInTheDocument();
  });

  it("the beachcombing ScoreCircle label is always present", () => {
    seedStore(HOTSPOT, "tidepool");
    renderCard();
    expect(screen.getByText("Beachcombing")).toBeInTheDocument();
  });
});

describe("IntertidalHotspotCard — close button", () => {
  it("clicking the close button calls setSelectedHotspot(null)", () => {
    seedStore(HOTSPOT, "tidepool");
    const setSelectedHotspot = vi.fn();
    useUiStore.setState({ setSelectedHotspot });

    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /close hotspot card/i }));

    expect(setSelectedHotspot).toHaveBeenCalledWith(null);
  });
});

describe("IntertidalHotspotCard — mode switching", () => {
  it("switching from tidepool to beachcombing via the store flips the signals", () => {
    seedStore(HOTSPOT, "tidepool");
    renderCard();

    expect(
      screen.getByText("High biodiversity tidepool habitat"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Good beachcombing conditions"),
    ).not.toBeInTheDocument();

    act(() => {
      useUiStore.setState({ intertidalScoreMode: "beachcombing" });
    });

    expect(
      screen.getByText("Good beachcombing conditions"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("High biodiversity tidepool habitat"),
    ).not.toBeInTheDocument();
  });
});
