/**
 * BulkOfflinePanel — storage estimate rendering tests
 *
 * Confirms that:
 *  1. The per-batch storage-size estimate line is rendered when at least one
 *     dataset has a `bbox` field (the filter path that was previously untested).
 *  2. The estimate is absent when no datasets carry a `bbox`.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { BulkOfflinePanel } from "@/components/BulkOfflinePanel";
import type { BulkDataset } from "@/hooks/useBulkOfflinePack";

// ── Module mocks ──────────────────────────────────────────────────────────────

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
  // Return a fixed, predictable value so the test can assert on exact text.
  estimatePackStorageBytesFromBbox: vi.fn().mockReturnValue(1_048_576), // exactly 1.0 MB
}));

vi.mock("@/hooks/useReturnFocus", () => ({ useReturnFocus: vi.fn() }));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DATASET_WITH_BBOX: BulkDataset = {
  id: "ds-bbox",
  name: "Bathymetry Survey A",
  bbox: { minLon: -135.0, maxLon: -134.5, minLat: 57.0, maxLat: 57.5 },
  resolutionM: 10,
};

const DATASET_WITHOUT_BBOX: BulkDataset = {
  id: "ds-no-bbox",
  name: "Survey No Location",
  // bbox intentionally omitted
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BulkOfflinePanel — storage estimate line", () => {
  it("renders the estimate when all datasets have bbox", () => {
    render(
      <BulkOfflinePanel
        datasets={[DATASET_WITH_BBOX]}
        onClose={vi.fn()}
      />,
    );

    // formatBytes(1_048_576) → "1.0 MB"
    const estimate = screen.getByText(/estimated for all datasets/i);
    expect(estimate).toBeDefined();
    expect(estimate.textContent).toMatch(/1\.0 MB/i);
  });

  it("renders a partial estimate mentioning the count when only some datasets have bbox", () => {
    render(
      <BulkOfflinePanel
        datasets={[DATASET_WITH_BBOX, DATASET_WITHOUT_BBOX]}
        onClose={vi.fn()}
      />,
    );

    // 1 of 2 datasets has bbox → partial label
    const estimate = screen.getByText(/estimated for 1 of 2 datasets/i);
    expect(estimate).toBeDefined();
    expect(estimate.textContent).toMatch(/1\.0 MB/i);
  });

  it("does NOT render the estimate when no datasets have bbox", () => {
    render(
      <BulkOfflinePanel
        datasets={[DATASET_WITHOUT_BBOX]}
        onClose={vi.fn()}
      />,
    );

    // Neither "estimated for all" nor "estimated for N of M" should appear.
    expect(screen.queryByText(/estimated for/i)).toBeNull();
  });

  it("does NOT render the estimate when the datasets array is empty", () => {
    render(
      <BulkOfflinePanel datasets={[]} onClose={vi.fn()} />,
    );

    expect(screen.queryByText(/estimated for/i)).toBeNull();
  });
});
