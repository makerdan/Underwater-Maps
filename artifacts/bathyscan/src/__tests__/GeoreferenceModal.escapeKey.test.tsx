/**
 * GeoreferenceModal.escapeKey.test.tsx
 *
 * Verifies that pressing Escape while the GeoreferenceModal is open calls onClose.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import type { UserDatasetMeta } from "@workspace/api-client-react";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  usePostUserDatasetsIdGeoref: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  getGetUserDatasetsQueryKey: () => ["userDatasets"],
  getUserDatasetsIdRasterImage: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/useReturnFocus", () => ({
  useReturnFocus: () => {},
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

import { GeoreferenceModal } from "@/components/GeoreferenceModal";

const DATASET: UserDatasetMeta = {
  id: "ds-1",
  name: "Test Raster",
  status: "ready",
} as unknown as UserDatasetMeta;

function fireEscape() {
  fireEvent.keyDown(window, { key: "Escape", bubbles: true });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GeoreferenceModal — Escape key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(<GeoreferenceModal dataset={DATASET} onClose={onClose} onSuccess={onSuccess} />);

    fireEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onSuccess when Escape is pressed", () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(<GeoreferenceModal dataset={DATASET} onClose={onClose} onSuccess={onSuccess} />);

    fireEscape();

    expect(onSuccess).not.toHaveBeenCalled();
  });
});
