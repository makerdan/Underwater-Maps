/**
 * Unit tests for uiStore.intertidalScoreMode / setIntertidalScoreMode.
 *
 * Covers:
 * - Default value is 'tidepool'.
 * - setIntertidalScoreMode('beachcombing') updates the field.
 * - setIntertidalScoreMode('tidepool') updates the field.
 * - Switching mode clears selectedHotspot regardless of which direction.
 * - Switching to the already-active mode still clears selectedHotspot.
 */
import { describe, it, expect, beforeEach } from "vitest";

const HOTSPOT_FIXTURE = {
  unitId: "u1",
  substrate: "mixed",
  shoreZoneClass: "B2",
  tidepoolScore: 82,
  beachcombingScore: 55,
  szMaterial: "rock",
  szForm: null,
  signals: {
    tidepool: {
      substrate: "rock",
      bioband: "barnacle",
      debris: null,
      energy: "high",
      humanUse: null,
      whySummary: "Rocky barnacle zone.",
    },
    beachcombing: {
      substrate: "mixed",
      bioband: null,
      debris: "kelp",
      energy: "moderate",
      humanUse: null,
      whySummary: "Kelp wrack zone.",
    },
  },
  sourceName: "ShoreZone AK",
  creditUrl: "https://example.com",
};

describe("uiStore — intertidalScoreMode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults intertidalScoreMode to 'tidepool'", async () => {
    const { useUiStore } = await import("../uiStore");
    expect(useUiStore.getState().intertidalScoreMode).toBe("tidepool");
  });

  it("setIntertidalScoreMode('beachcombing') updates the field to 'beachcombing'", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.getState().setIntertidalScoreMode("beachcombing");
    expect(useUiStore.getState().intertidalScoreMode).toBe("beachcombing");
  });

  it("setIntertidalScoreMode('tidepool') updates the field back to 'tidepool'", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.getState().setIntertidalScoreMode("beachcombing");
    useUiStore.getState().setIntertidalScoreMode("tidepool");
    expect(useUiStore.getState().intertidalScoreMode).toBe("tidepool");
  });

  it("setIntertidalScoreMode clears selectedHotspot when switching tidepool → beachcombing", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.setState({ selectedHotspot: HOTSPOT_FIXTURE, intertidalScoreMode: "tidepool" });
    expect(useUiStore.getState().selectedHotspot).not.toBeNull();

    useUiStore.getState().setIntertidalScoreMode("beachcombing");
    expect(useUiStore.getState().selectedHotspot).toBeNull();
  });

  it("setIntertidalScoreMode clears selectedHotspot when switching beachcombing → tidepool", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.setState({ selectedHotspot: HOTSPOT_FIXTURE, intertidalScoreMode: "beachcombing" });
    expect(useUiStore.getState().selectedHotspot).not.toBeNull();

    useUiStore.getState().setIntertidalScoreMode("tidepool");
    expect(useUiStore.getState().selectedHotspot).toBeNull();
  });

  it("setIntertidalScoreMode clears selectedHotspot even when staying on the same mode", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.setState({ selectedHotspot: HOTSPOT_FIXTURE, intertidalScoreMode: "tidepool" });

    useUiStore.getState().setIntertidalScoreMode("tidepool");
    expect(useUiStore.getState().selectedHotspot).toBeNull();
  });

  it("selectedHotspot remains null when no hotspot was open before switching mode", async () => {
    const { useUiStore } = await import("../uiStore");
    useUiStore.setState({ selectedHotspot: null, intertidalScoreMode: "tidepool" });

    useUiStore.getState().setIntertidalScoreMode("beachcombing");
    expect(useUiStore.getState().selectedHotspot).toBeNull();
    expect(useUiStore.getState().intertidalScoreMode).toBe("beachcombing");
  });
});
