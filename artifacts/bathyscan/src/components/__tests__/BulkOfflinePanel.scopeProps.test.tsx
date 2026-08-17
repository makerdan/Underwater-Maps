/**
 * BulkOfflinePanel — scope props rendering tests
 *
 * Covers the new optional props added for scoped offline downloads
 * (library / folder / selection / collection):
 *  1. `scopeLabel` prefixes the subheader; absent → legacy subheader unchanged.
 *  2. `skippedItems` renders the amber not-downloadable list with per-item
 *     reasons; absent/empty → block not rendered (legacy layout untouched).
 *  3. `title` overrides the header; absent → legacy "⬇ SAVE ALL OFFLINE".
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { BulkOfflinePanel } from "@/components/BulkOfflinePanel";
import type { BulkDataset } from "@/hooks/useBulkOfflinePack";

// ── Module mocks (same pattern as the storageEstimate tests) ─────────────────

vi.mock("@/hooks/useBulkOfflinePack", () => ({
  useBulkOfflinePack: () => ({
    rows: [],
    phase: "idle" as const,
    preflightError: null,
    quotaWarning: null,
    storageQuota: null,
    forceUpdateIds: new Set<string>(),
    toggleForceUpdate: vi.fn(),
    days: 7,
    setDays: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    refreshQuota: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/lib/offlinePackStore", () => ({
  listOfflinePacks: vi.fn().mockResolvedValue([]),
  deleteOfflinePack: vi.fn().mockResolvedValue(undefined),
  isPackExpired: vi.fn().mockReturnValue(false),
  estimatePackStorageBytesFromBbox: vi.fn().mockReturnValue(1_048_576),
}));

vi.mock("@/hooks/useReturnFocus", () => ({ useReturnFocus: vi.fn() }));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DS: BulkDataset = { id: "d1", name: "Survey A" };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BulkOfflinePanel — scope label", () => {
  it("prefixes the subheader with the scope label when provided", () => {
    render(
      <BulkOfflinePanel datasets={[DS]} scopeLabel="Trip North" onClose={vi.fn()} />,
    );
    expect(screen.getByText(/Trip North — /)).toBeDefined();
  });

  it("renders the legacy subheader without a prefix when absent", () => {
    render(<BulkOfflinePanel datasets={[DS]} onClose={vi.fn()} />);
    expect(screen.queryByText(/ — /)).toBeNull();
  });
});

describe("BulkOfflinePanel — custom title", () => {
  it("uses the legacy title by default", () => {
    render(<BulkOfflinePanel datasets={[DS]} onClose={vi.fn()} />);
    expect(screen.getByText(/SAVE ALL OFFLINE/)).toBeDefined();
  });

  it("uses the provided title when set", () => {
    render(
      <BulkOfflinePanel datasets={[DS]} title="⬇ DOWNLOAD FOLDER" onClose={vi.fn()} />,
    );
    expect(screen.getByText(/DOWNLOAD FOLDER/)).toBeDefined();
    expect(screen.queryByText(/SAVE ALL OFFLINE/)).toBeNull();
  });
});

describe("BulkOfflinePanel — skipped items block", () => {
  const SKIPPED = [
    { id: "s1", name: "Queued Save", reason: "Waiting to process — not downloadable yet" },
    { id: "s2", name: "Cooking", reason: "Still processing — not downloadable yet" },
  ];

  it("renders each skipped item with its reason", () => {
    render(
      <BulkOfflinePanel datasets={[DS]} skippedItems={SKIPPED} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId("bulk-offline-skipped")).toBeDefined();
    expect(screen.getByTestId("bulk-offline-skipped-s1").textContent).toMatch(/Queued Save/);
    expect(screen.getByTestId("bulk-offline-skipped-s1").textContent).toMatch(/Waiting to process/);
    expect(screen.getByTestId("bulk-offline-skipped-s2").textContent).toMatch(/Still processing/);
  });

  it("does not render the block when skippedItems is empty", () => {
    render(
      <BulkOfflinePanel datasets={[DS]} skippedItems={[]} onClose={vi.fn()} />,
    );
    expect(screen.queryByTestId("bulk-offline-skipped")).toBeNull();
  });

  it("does not render the block when skippedItems is absent (legacy callers)", () => {
    render(<BulkOfflinePanel datasets={[DS]} onClose={vi.fn()} />);
    expect(screen.queryByTestId("bulk-offline-skipped")).toBeNull();
  });
});
