/**
 * EnvOfflineSection — delete failure regression tests.
 *
 * Covers Step 27: when clearEnvPack() throws, an inline error message must
 * appear in the UI instead of silently doing nothing.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── idb-keyval mock ───────────────────────────────────────────────────────────
vi.mock("idb-keyval", () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}));

// ── useToast mock ─────────────────────────────────────────────────────────────
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Store import ──────────────────────────────────────────────────────────────
import { useEnvOfflineStore } from "@/lib/envOfflineStore";
import type { EnvPack } from "@/lib/envPackTypes";
import { EnvOfflineSection } from "../EnvOfflineSection";

function makePack(overrides: Partial<EnvPack> = {}): EnvPack {
  return {
    generatedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    centerLat: 57.05,
    centerLon: -135.33,
    coverageRadiusMiles: 15,
    tideStations: null,
    weatherStations: null,
    marineConditions: null,
    temperatureProfile: null,
    warnings: [],
    ...overrides,
  };
}

function resetStore(overrides = {}) {
  useEnvOfflineStore.setState({
    envPack: null,
    isDownloading: false,
    downloadError: null,
    idbHydrationError: false,
    ...overrides,
  });
}

describe("EnvOfflineSection — delete failure", () => {
  beforeEach(() => {
    resetStore();
    mockToast.mockClear();
    vi.restoreAllMocks();
  });

  it("shows an inline error message when clearEnvPack() throws", async () => {
    const clearMock = vi.fn().mockRejectedValue(new Error("IDB delete failed"));
    useEnvOfflineStore.setState((s) => ({
      ...s,
      envPack: makePack(),
      clearEnvPack: clearMock,
    }));

    render(<EnvOfflineSection />);
    fireEvent.click(screen.getByTestId("env-pack-delete-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("env-pack-delete-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("env-pack-delete-error").textContent).toMatch(/IDB delete failed/);
  });

  it("does not show a success toast when clearEnvPack() throws", async () => {
    const clearMock = vi.fn().mockRejectedValue(new Error("IDB delete failed"));
    useEnvOfflineStore.setState((s) => ({
      ...s,
      envPack: makePack(),
      clearEnvPack: clearMock,
    }));

    render(<EnvOfflineSection />);
    fireEvent.click(screen.getByTestId("env-pack-delete-btn"));

    await waitFor(() => expect(clearMock).toHaveBeenCalled());
    // Allow any pending microtasks to settle
    await new Promise((r) => setTimeout(r, 0));
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does not show delete error when clearEnvPack() succeeds", async () => {
    const clearMock = vi.fn().mockResolvedValue(undefined);
    useEnvOfflineStore.setState((s) => ({
      ...s,
      envPack: makePack(),
      clearEnvPack: clearMock,
    }));

    render(<EnvOfflineSection />);
    fireEvent.click(screen.getByTestId("env-pack-delete-btn"));

    await waitFor(() => expect(clearMock).toHaveBeenCalled());
    expect(screen.queryByTestId("env-pack-delete-error")).toBeNull();
  });

  it("shows the IDB hydration error warning when idbHydrationError is true", () => {
    resetStore({ idbHydrationError: true });
    render(<EnvOfflineSection />);
    expect(screen.getByTestId("env-idb-hydration-error")).toBeInTheDocument();
    expect(screen.getByTestId("env-idb-hydration-error").textContent).toMatch(/could not be loaded/i);
  });

  it("does not show the IDB hydration error warning when idbHydrationError is false", () => {
    resetStore({ idbHydrationError: false });
    render(<EnvOfflineSection />);
    expect(screen.queryByTestId("env-idb-hydration-error")).toBeNull();
  });
});
