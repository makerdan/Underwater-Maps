/**
 * OfflinePackModal.idbError.test.tsx
 *
 * Verifies that OfflinePackModal shows a "Could not load packs" error banner
 * when listOfflinePacks or getHelpPackStatus rejects (e.g. IDB unavailable).
 *
 * Strategy:
 * - Mock @/lib/offlinePackStore to return a rejecting listOfflinePacks.
 * - Mock @/lib/helpPackStore to return a rejecting getHelpPackStatus.
 * - Render OfflinePackModal with a minimal dataset prop.
 * - Assert the role="alert" banner containing "Could not load packs" appears.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { OfflinePackModal } from "@/components/OfflinePackModal";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const offlinePackMock = vi.hoisted(() => ({
  listOfflinePacks: vi.fn<() => Promise<unknown[]>>(),
  saveOfflinePack: vi.fn(),
}));

const helpPackMock = vi.hoisted(() => ({
  getHelpPackStatus: vi.fn<() => Promise<{ saved: boolean }>>(),
  saveHelpPack: vi.fn(),
  HELP_ASSETS: [] as string[],
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/offlinePackStore", () => ({
  listOfflinePacks: offlinePackMock.listOfflinePacks,
  saveOfflinePack: offlinePackMock.saveOfflinePack,
}));

vi.mock("@/lib/helpPackStore", () => ({
  getHelpPackStatus: helpPackMock.getHelpPackStatus,
  saveHelpPack: helpPackMock.saveHelpPack,
  HELP_ASSETS: helpPackMock.HELP_ASSETS,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const dataset = {
  id: "ds-offline-test",
  name: "Test Survey",
  bbox: { minLon: -135, maxLon: -134, minLat: 57, maxLat: 58 },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("OfflinePackModal — IDB unavailable error state", () => {
  beforeEach(() => {
    offlinePackMock.listOfflinePacks.mockReset();
    helpPackMock.getHelpPackStatus.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows 'Could not load packs' banner when listOfflinePacks rejects", async () => {
    offlinePackMock.listOfflinePacks.mockRejectedValue(
      new DOMException("An attempt was made to break through the security policy", "SecurityError"),
    );
    helpPackMock.getHelpPackStatus.mockResolvedValue({ saved: false });

    render(<OfflinePackModal dataset={dataset} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Could not load packs/i),
      ).toBeInTheDocument();
    });

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toMatch(/storage may be unavailable/i);
  });

  it("shows 'Could not load packs' banner when getHelpPackStatus rejects", async () => {
    offlinePackMock.listOfflinePacks.mockResolvedValue([]);
    helpPackMock.getHelpPackStatus.mockRejectedValue(
      new DOMException("The operation failed for reasons unrelated to the database itself", "UnknownError"),
    );

    render(<OfflinePackModal dataset={dataset} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Could not load packs/i),
      ).toBeInTheDocument();
    });
  });

  it("shows 'Could not load packs' banner when both IDB calls reject", async () => {
    offlinePackMock.listOfflinePacks.mockRejectedValue(new Error("IDB quota exceeded"));
    helpPackMock.getHelpPackStatus.mockRejectedValue(new Error("IDB quota exceeded"));

    render(<OfflinePackModal dataset={dataset} onClose={vi.fn()} />);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
    });
  });

  it("does NOT show the error banner when both IDB calls succeed", async () => {
    offlinePackMock.listOfflinePacks.mockResolvedValue([]);
    helpPackMock.getHelpPackStatus.mockResolvedValue({ saved: false });

    render(<OfflinePackModal dataset={dataset} onClose={vi.fn()} />);

    // Allow the async effect to settle.
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Could not load packs/i)).toBeNull();
  });
});
