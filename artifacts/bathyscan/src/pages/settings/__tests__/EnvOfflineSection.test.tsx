/**
 * EnvOfflineSection unit tests.
 *
 * Covers: idle, fetching, loaded (active + expired), and error states.
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

// ── Store import (after mocks) ────────────────────────────────────────────────
import { useEnvOfflineStore } from "@/lib/envOfflineStore";
import type { EnvPack } from "@/lib/envPackTypes";
import { EnvOfflineSection } from "../EnvOfflineSection";

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
    ...overrides,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EnvOfflineSection", () => {
  beforeEach(() => {
    resetStore();
    mockToast.mockClear();
    vi.restoreAllMocks();
  });

  describe("idle state (no pack)", () => {
    it("renders the section header", () => {
      render(<EnvOfflineSection />);
      expect(screen.getByText(/WEATHER.*OCEAN DATA/i)).toBeInTheDocument();
    });

    it("shows the empty state message", () => {
      render(<EnvOfflineSection />);
      expect(screen.getByTestId("env-pack-empty")).toBeInTheDocument();
    });

    it("renders the download button", () => {
      render(<EnvOfflineSection />);
      expect(screen.getByTestId("env-pack-download-btn")).toBeInTheDocument();
    });

    it("does not show the delete button when no pack exists", () => {
      render(<EnvOfflineSection />);
      expect(screen.queryByTestId("env-pack-delete-btn")).toBeNull();
    });

    it("does not show an error message initially", () => {
      render(<EnvOfflineSection />);
      expect(screen.queryByTestId("env-pack-error")).toBeNull();
    });
  });

  describe("fetching state", () => {
    it("disables the download button while downloading", () => {
      resetStore({ isDownloading: true });
      render(<EnvOfflineSection />);
      const btn = screen.getByTestId("env-pack-download-btn");
      expect(btn).toBeDisabled();
    });

    it("shows DOWNLOADING… label while fetching", () => {
      resetStore({ isDownloading: true });
      render(<EnvOfflineSection />);
      expect(screen.getByTestId("env-pack-download-btn").textContent).toContain("DOWNLOADING");
    });
  });

  describe("loaded state (active pack)", () => {
    it("shows downloaded date and coverage info", () => {
      resetStore({ envPack: makePack() });
      render(<EnvOfflineSection />);
      expect(screen.getByTestId("env-pack-info")).toBeInTheDocument();
    });

    it("shows the CACHED chip", () => {
      resetStore({ envPack: makePack() });
      render(<EnvOfflineSection />);
      expect(screen.getByTestId("env-cached-chip")).toBeInTheDocument();
    });

    it("shows the delete button", () => {
      resetStore({ envPack: makePack() });
      render(<EnvOfflineSection />);
      expect(screen.getByTestId("env-pack-delete-btn")).toBeInTheDocument();
    });

    it("does not show expired warning when pack is fresh", () => {
      resetStore({ envPack: makePack() });
      render(<EnvOfflineSection />);
      expect(screen.queryByTestId("env-pack-expired-msg")).toBeNull();
    });

    it("renders pack warnings when present", () => {
      resetStore({ envPack: makePack({ warnings: ["Tides unavailable", "Weather partial"] }) });
      render(<EnvOfflineSection />);
      expect(screen.getByTestId("env-pack-warnings")).toBeInTheDocument();
      expect(screen.getByText(/Tides unavailable/)).toBeInTheDocument();
    });
  });

  describe("expired state", () => {
    it("shows expired warning when pack is past expiresAt", () => {
      const expired = makePack({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      resetStore({ envPack: expired });
      render(<EnvOfflineSection />);
      expect(screen.getByTestId("env-pack-expired-msg")).toBeInTheDocument();
      expect(screen.getByTestId("env-pack-expired-msg").textContent).toMatch(/expired/i);
    });
  });

  describe("error state", () => {
    it("displays downloadError text", () => {
      resetStore({ downloadError: "Server error 503" });
      render(<EnvOfflineSection />);
      expect(screen.getByTestId("env-pack-error").textContent).toContain("Server error 503");
    });
  });

  describe("download action", () => {
    it("calls downloadEnvPack and shows toast on success", async () => {
      const downloadMock = vi.fn().mockResolvedValue(undefined);
      useEnvOfflineStore.setState(
        (s) => ({ ...s, downloadEnvPack: downloadMock }),
      );

      render(<EnvOfflineSection centerLat={57.05} centerLon={-135.33} />);
      fireEvent.click(screen.getByTestId("env-pack-download-btn"));

      await waitFor(() => {
        expect(downloadMock).toHaveBeenCalledWith(57.05, -135.33, 15, 14);
      });
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Weather & ocean data downloaded" }),
        );
      });
    });

    it("does not toast on download failure (error shown in UI instead)", async () => {
      const downloadMock = vi.fn().mockRejectedValue(new Error("fail"));
      useEnvOfflineStore.setState(
        (s) => ({ ...s, downloadEnvPack: downloadMock }),
      );

      render(<EnvOfflineSection />);
      fireEvent.click(screen.getByTestId("env-pack-download-btn"));

      await waitFor(() => expect(downloadMock).toHaveBeenCalled());
      // Toast should NOT be called on failure
      await waitFor(() => expect(mockToast).not.toHaveBeenCalled());
    });
  });

  describe("delete action", () => {
    it("calls clearEnvPack and shows toast", async () => {
      const clearMock = vi.fn().mockResolvedValue(undefined);
      useEnvOfflineStore.setState(
        (s) => ({ ...s, envPack: makePack(), clearEnvPack: clearMock }),
      );

      render(<EnvOfflineSection />);
      fireEvent.click(screen.getByTestId("env-pack-delete-btn"));

      await waitFor(() => expect(clearMock).toHaveBeenCalled());
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Cached weather data deleted" }),
        ),
      );
    });
  });
});
