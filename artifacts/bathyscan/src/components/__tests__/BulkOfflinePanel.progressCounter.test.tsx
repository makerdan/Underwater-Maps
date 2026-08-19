/**
 * BulkOfflinePanel — "Save All Offline" batch progress counter (Task 4219 / #4128 family).
 *
 * The counter must increment once per dataset reaching a terminal state and
 * read "N / N datasets complete" when every dataset has finished.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BulkRow, BatchPhase, BulkDataset } from "@/hooks/useBulkOfflinePack";

// Mutable hook return — set per test BEFORE render. The mock factory only
// closes over the holder function-call-time, so no vi.hoisted needed.
let hookReturn: Record<string, unknown> = {};

vi.mock("@/hooks/useBulkOfflinePack", () => ({
  useBulkOfflinePack: () => hookReturn,
}));

vi.mock("@/lib/offlinePackStore", () => ({
  listOfflinePacks: vi.fn().mockResolvedValue([]),
  deleteOfflinePack: vi.fn().mockResolvedValue(undefined),
  isPackExpired: vi.fn().mockReturnValue(false),
  estimatePackStorageBytesFromBbox: vi.fn().mockReturnValue(1_048_576),
}));

vi.mock("@/hooks/useReturnFocus", () => ({ useReturnFocus: vi.fn() }));

import { BulkOfflinePanel } from "@/components/BulkOfflinePanel";

function makeDataset(id: string): BulkDataset {
  return { id, name: `Dataset ${id}` };
}

function makeRow(id: string, status: BulkRow["status"]): BulkRow {
  return {
    dataset: makeDataset(id),
    status,
    progress: [],
    pack: null,
    error: null,
    existingPack: null,
    warning: null,
  };
}

function setBulk(rows: BulkRow[], phase: BatchPhase) {
  hookReturn = {
    rows,
    phase,
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
  };
}

const DATASETS = [makeDataset("a"), makeDataset("b"), makeDataset("c")];

describe("BulkOfflinePanel — batch progress counter", () => {
  it("counts one increment per completed dataset mid-run", () => {
    setBulk(
      [makeRow("a", "done"), makeRow("b", "saving"), makeRow("c", "pending")],
      "running",
    );
    render(<BulkOfflinePanel datasets={DATASETS} onClose={vi.fn()} />);

    expect(screen.getByTestId("bulk-progress-counter")).toHaveTextContent(
      /1\s*\/\s*3 datasets complete/,
    );
  });

  it("increments as more datasets complete (2 of 3)", () => {
    setBulk(
      [makeRow("a", "done"), makeRow("b", "done-warning"), makeRow("c", "saving")],
      "running",
    );
    render(<BulkOfflinePanel datasets={DATASETS} onClose={vi.fn()} />);

    expect(screen.getByTestId("bulk-progress-counter")).toHaveTextContent(
      /2\s*\/\s*3 datasets complete/,
    );
  });

  it("reaches the total (N / N) when every dataset has finished", () => {
    setBulk(
      [makeRow("a", "done"), makeRow("b", "done"), makeRow("c", "done")],
      "running",
    );
    render(<BulkOfflinePanel datasets={DATASETS} onClose={vi.fn()} />);

    expect(screen.getByTestId("bulk-progress-counter")).toHaveTextContent(
      /3\s*\/\s*3 datasets complete/,
    );
  });

  it("counts error and skipped rows as settled so the counter still reaches the total", () => {
    setBulk(
      [makeRow("a", "done"), makeRow("b", "error"), makeRow("c", "skipped")],
      "running",
    );
    render(<BulkOfflinePanel datasets={DATASETS} onClose={vi.fn()} />);

    expect(screen.getByTestId("bulk-progress-counter")).toHaveTextContent(
      /3\s*\/\s*3 datasets complete/,
    );
  });
});
