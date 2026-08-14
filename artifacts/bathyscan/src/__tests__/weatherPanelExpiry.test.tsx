/**
 * Tests for the WeatherPanel offline env-pack expiry chip and cached-date badge.
 *
 * Exercises two named exports from WeatherPanel:
 *   - EnvPackExpiryChip: amber "Weather data expired" chip
 *   - EnvPackCachedBadge: "Cached Mon DD" date badge from envPack.generatedAt
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { EnvPack } from "@/lib/envPackTypes";

// ── Hoisted mutable state ─────────────────────────────────────────────────────

const mockIsOnline = vi.hoisted(() => ({ value: true }));
const mockEnvPack = vi.hoisted(() => ({ value: null as EnvPack | null }));

// ── Store mocks ───────────────────────────────────────────────────────────────

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: mockIsOnline.value }),
}));

vi.mock("@/lib/envOfflineStore", () => ({
  useEnvOfflineStore: (sel: (s: { envPack: EnvPack | null }) => unknown) =>
    sel({ envPack: mockEnvPack.value }),
  haversineKm: () => 0,
  isEnvPackInRange: () => true,
  getEnvPackTideStation: () => null,
  getEnvPackWeatherStation: () => null,
  getEnvPackWeatherStationById: () => null,
  getEnvPackTideHeight: () => 0,
  deriveScheduleEvents: () => [],
  ENV_PACK_IDB_KEY: "env-pack-v1",
  ENV_PACK_DEFAULT_LAT: 57.05,
  ENV_PACK_DEFAULT_LON: -135.33,
}));

// ── Import components under test ──────────────────────────────────────────────

import {
  EnvPackExpiryChip,
  EnvPackCachedBadge,
} from "@/components/WeatherPanel";

// ── Fixture helpers ───────────────────────────────────────────────────────────

const NOW = Date.now();

function makeEnvPack(overrides: Partial<EnvPack> = {}): EnvPack {
  return {
    generatedAt: new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(NOW + 12 * 24 * 60 * 60 * 1000).toISOString(),
    centerLat: 57.0,
    centerLon: -135.0,
    coverageRadiusMiles: 50,
    tideStations: null,
    weatherStations: null,
    marineConditions: null,
    temperatureProfile: null,
    warnings: [],
    ...overrides,
  };
}

function makeExpiredPack(): EnvPack {
  return makeEnvPack({
    expiresAt: new Date(NOW - 1).toISOString(), // 1 ms in the past
  });
}

// ── EnvPackExpiryChip ─────────────────────────────────────────────────────────

describe("EnvPackExpiryChip", () => {
  beforeEach(() => {
    mockIsOnline.value = false;
    mockEnvPack.value = makeExpiredPack();
  });

  it("shows the expiry chip when offline and pack is expired", () => {
    render(<EnvPackExpiryChip />);
    const chip = screen.getByTestId("env-pack-expiry-chip");
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toMatch(/expired/i);
  });

  it("chip text mentions reconnect", () => {
    render(<EnvPackExpiryChip />);
    expect(screen.getByTestId("env-pack-expiry-chip").textContent).toMatch(
      /reconnect/i,
    );
  });

  it("does NOT show the chip when offline but pack is NOT yet expired", () => {
    mockEnvPack.value = makeEnvPack(); // expiresAt is 12 days from now
    render(<EnvPackExpiryChip />);
    expect(screen.queryByTestId("env-pack-expiry-chip")).not.toBeInTheDocument();
  });

  it("does NOT show the chip when online (even if pack is expired)", () => {
    mockIsOnline.value = true;
    render(<EnvPackExpiryChip />);
    expect(screen.queryByTestId("env-pack-expiry-chip")).not.toBeInTheDocument();
  });

  it("does NOT show the chip when there is no pack at all", () => {
    mockEnvPack.value = null;
    render(<EnvPackExpiryChip />);
    expect(screen.queryByTestId("env-pack-expiry-chip")).not.toBeInTheDocument();
  });

  describe("expiry timer — chip appears when expiresAt is crossed", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("transitions from hidden to visible at the exact expiresAt moment", async () => {
      vi.useFakeTimers();
      const base = Date.now();
      vi.setSystemTime(base);

      // Pack expires 500 ms from now — chip should NOT show yet.
      mockIsOnline.value = false;
      mockEnvPack.value = makeEnvPack({
        expiresAt: new Date(base + 500).toISOString(),
      });

      render(<EnvPackExpiryChip />);
      expect(screen.queryByTestId("env-pack-expiry-chip")).not.toBeInTheDocument();

      // Advance past expiry — the internal setTimeout fires and forceUpdate
      // triggers a re-render, which now evaluates Date.now() > expiresAt.
      await act(async () => {
        vi.advanceTimersByTime(501);
      });

      expect(screen.getByTestId("env-pack-expiry-chip")).toBeInTheDocument();
    });
  });
});

// ── EnvPackCachedBadge ────────────────────────────────────────────────────────

describe("EnvPackCachedBadge", () => {
  beforeEach(() => {
    mockIsOnline.value = false;
    mockEnvPack.value = makeEnvPack();
  });

  it("shows 'Cached' badge when offline and a pack is present", () => {
    render(<EnvPackCachedBadge />);
    const badge = screen.getByTestId("env-pack-cached-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/cached/i);
  });

  it("badge includes a formatted date string", () => {
    render(<EnvPackCachedBadge />);
    // The date is generatedAt = 2 days ago, formatted as "Mon DD"
    // Just verify it contains something date-like (a number)
    const badge = screen.getByTestId("env-pack-cached-badge");
    expect(badge.textContent).toMatch(/\d/);
  });

  it("does NOT show the cached badge when online", () => {
    mockIsOnline.value = true;
    render(<EnvPackCachedBadge />);
    expect(screen.queryByTestId("env-pack-cached-badge")).not.toBeInTheDocument();
  });

  it("does NOT show the cached badge when no pack is available", () => {
    mockEnvPack.value = null;
    render(<EnvPackCachedBadge />);
    expect(screen.queryByTestId("env-pack-cached-badge")).not.toBeInTheDocument();
  });

  it("shows badge even when the pack has expired (expiry is separate chip)", () => {
    mockEnvPack.value = makeExpiredPack();
    render(<EnvPackCachedBadge />);
    // Cached badge is still shown — expiry is communicated by EnvPackExpiryChip
    expect(screen.getByTestId("env-pack-cached-badge")).toBeInTheDocument();
  });
});
