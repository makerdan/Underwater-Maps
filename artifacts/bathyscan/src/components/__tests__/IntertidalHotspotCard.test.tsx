/**
 * Component tests for IntertidalHotspotCard.
 *
 * Covers:
 * - Renders nothing when selectedHotspot is null.
 * - Renders the card when selectedHotspot is set.
 * - In tidepool mode: shows tidepool signals, whySummary, substrate, and
 *   the "Tidepool mode active" label; tidepool dial has full opacity,
 *   beachcombing dial is dimmed.
 * - In beachcombing mode: shows beachcombing signals, whySummary, substrate,
 *   and the "Beachcombing mode active" label; beachcombing dial has full
 *   opacity, tidepool dial is dimmed.
 * - Close button calls setSelectedHotspot(null).
 * - Signal chips appear only for non-null signal fields.
 */
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { IntertidalHotspotCard } from "@/components/IntertidalHotspotCard";
import { useUiStore } from "@/lib/uiStore";

const TIDEPOOL_HOTSPOT = {
  unitId: "u1",
  substrate: "mixed",
  shoreZoneClass: "B2 Rocky Shore",
  tidepoolScore: 82,
  beachcombingScore: 55,
  szMaterial: "rock",
  szForm: null,
  signals: {
    tidepool: {
      substrate: "rock",
      bioband: "barnacle belt",
      debris: null,
      energy: "high wave",
      humanUse: null,
      whySummary: "Excellent rocky barnacle zone.",
    },
    beachcombing: {
      substrate: "mixed sand",
      bioband: null,
      debris: "kelp wrack",
      energy: "moderate",
      humanUse: "recreation",
      whySummary: "Good kelp wrack beachcombing.",
    },
  },
  sourceName: "ShoreZone AK",
  creditUrl: "https://example.com",
};

function resetStore(overrides: Partial<ReturnType<typeof useUiStore.getState>> = {}) {
  useUiStore.setState({
    ...useUiStore.getState(),
    selectedHotspot: null,
    intertidalScoreMode: "tidepool",
    ...overrides,
  });
}

beforeEach(() => {
  resetStore();
});

describe("IntertidalHotspotCard — null state", () => {
  it("renders nothing when selectedHotspot is null", () => {
    resetStore({ selectedHotspot: null });
    const { container } = render(<IntertidalHotspotCard />);
    expect(container.firstChild).toBeNull();
  });
});

describe("IntertidalHotspotCard — tidepool mode", () => {
  beforeEach(() => {
    resetStore({ selectedHotspot: TIDEPOOL_HOTSPOT, intertidalScoreMode: "tidepool" });
  });

  it("renders the card with the correct testid", () => {
    render(<IntertidalHotspotCard />);
    expect(screen.getByTestId("intertidal-hotspot-card")).toBeInTheDocument();
  });

  it("shows the shoreZoneClass label", () => {
    render(<IntertidalHotspotCard />);
    expect(screen.getByText("B2 Rocky Shore")).toBeInTheDocument();
  });

  it("shows the tidepool whySummary", () => {
    render(<IntertidalHotspotCard />);
    expect(screen.getByText("Excellent rocky barnacle zone.")).toBeInTheDocument();
  });

  it("shows tidepool signal chips (bioband and energy)", () => {
    render(<IntertidalHotspotCard />);
    expect(screen.getByText("barnacle belt")).toBeInTheDocument();
    expect(screen.getByText("high wave")).toBeInTheDocument();
  });

  it("does NOT show beachcombing-only signal chips", () => {
    render(<IntertidalHotspotCard />);
    expect(screen.queryByText("kelp wrack")).not.toBeInTheDocument();
    expect(screen.queryByText("recreation")).not.toBeInTheDocument();
  });

  it("shows tidepool substrate", () => {
    render(<IntertidalHotspotCard />);
    expect(screen.getByText(/Substrate:.*rock/)).toBeInTheDocument();
  });

  it("shows 'Tidepool mode active' label", () => {
    render(<IntertidalHotspotCard />);
    expect(screen.getByText(/tidepool mode active/i)).toBeInTheDocument();
  });

  it("tidepool ScoreCircle has full opacity (active)", () => {
    render(<IntertidalHotspotCard />);
    const card = screen.getByTestId("intertidal-hotspot-card");
    const dials = card.querySelectorAll<HTMLElement>("svg");
    // Find the parent div of the tidepool SVG — should be opacity:1
    const tidepoolWrapper = dials[0]?.parentElement;
    expect(tidepoolWrapper?.style.opacity).toBe("1");
  });

  it("beachcombing ScoreCircle is dimmed (inactive)", () => {
    render(<IntertidalHotspotCard />);
    const card = screen.getByTestId("intertidal-hotspot-card");
    const dials = card.querySelectorAll<HTMLElement>("svg");
    // The beachcombing SVG wrapper should be at reduced opacity
    const beachWrapper = dials[1]?.parentElement;
    expect(beachWrapper?.style.opacity).toBe("0.35");
  });

  it("tidepool dial shows '▲ active' indicator", () => {
    render(<IntertidalHotspotCard />);
    const activeLabels = screen.getAllByText("▲ active");
    expect(activeLabels).toHaveLength(1);
  });
});

describe("IntertidalHotspotCard — beachcombing mode", () => {
  beforeEach(() => {
    resetStore({ selectedHotspot: TIDEPOOL_HOTSPOT, intertidalScoreMode: "beachcombing" });
  });

  it("shows the beachcombing whySummary", () => {
    render(<IntertidalHotspotCard />);
    expect(screen.getByText("Good kelp wrack beachcombing.")).toBeInTheDocument();
  });

  it("shows beachcombing signal chips (debris and humanUse)", () => {
    render(<IntertidalHotspotCard />);
    expect(screen.getByText("kelp wrack")).toBeInTheDocument();
    expect(screen.getByText("recreation")).toBeInTheDocument();
  });

  it("does NOT show tidepool-only signal chips", () => {
    render(<IntertidalHotspotCard />);
    expect(screen.queryByText("barnacle belt")).not.toBeInTheDocument();
    expect(screen.queryByText("high wave")).not.toBeInTheDocument();
  });

  it("shows beachcombing substrate", () => {
    render(<IntertidalHotspotCard />);
    expect(screen.getByText(/Substrate:.*mixed sand/)).toBeInTheDocument();
  });

  it("shows 'Beachcombing mode active' label", () => {
    render(<IntertidalHotspotCard />);
    expect(screen.getByText(/beachcombing mode active/i)).toBeInTheDocument();
  });

  it("beachcombing ScoreCircle has full opacity (active)", () => {
    render(<IntertidalHotspotCard />);
    const card = screen.getByTestId("intertidal-hotspot-card");
    const dials = card.querySelectorAll<HTMLElement>("svg");
    const beachWrapper = dials[1]?.parentElement;
    expect(beachWrapper?.style.opacity).toBe("1");
  });

  it("tidepool ScoreCircle is dimmed (inactive)", () => {
    render(<IntertidalHotspotCard />);
    const card = screen.getByTestId("intertidal-hotspot-card");
    const dials = card.querySelectorAll<HTMLElement>("svg");
    const tidepoolWrapper = dials[0]?.parentElement;
    expect(tidepoolWrapper?.style.opacity).toBe("0.35");
  });
});

describe("IntertidalHotspotCard — close button", () => {
  it("clicking the close button calls setSelectedHotspot(null)", () => {
    resetStore({ selectedHotspot: TIDEPOOL_HOTSPOT, intertidalScoreMode: "tidepool" });
    render(<IntertidalHotspotCard />);

    const closeBtn = screen.getByRole("button", { name: /close hotspot card/i });
    act(() => { fireEvent.click(closeBtn); });

    expect(useUiStore.getState().selectedHotspot).toBeNull();
  });
});

describe("IntertidalHotspotCard — partial signals (null fields omitted)", () => {
  it("only renders chips for non-null signal fields", () => {
    const sparse = {
      ...TIDEPOOL_HOTSPOT,
      signals: {
        tidepool: {
          substrate: "gravel",
          bioband: null,
          debris: null,
          energy: null,
          humanUse: null,
          whySummary: "Sparse signals.",
        },
        beachcombing: TIDEPOOL_HOTSPOT.signals.beachcombing,
      },
    };
    resetStore({ selectedHotspot: sparse, intertidalScoreMode: "tidepool" });
    render(<IntertidalHotspotCard />);

    // No chips should appear for null fields
    expect(screen.queryByText("barnacle belt")).not.toBeInTheDocument();
    expect(screen.queryByText("high wave")).not.toBeInTheDocument();
    // Summary still shows
    expect(screen.getByText("Sparse signals.")).toBeInTheDocument();
  });
});
