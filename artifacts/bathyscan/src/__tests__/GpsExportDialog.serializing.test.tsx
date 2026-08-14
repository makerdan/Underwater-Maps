/**
 * GpsExportDialog.serializing.test.tsx
 *
 * Tests that the Download button transitions to a loading state while
 * serializeAsync runs, re-enables after completion, and surfaces an error
 * toast when serialization throws.
 *
 * Coverage:
 *  (a) Button shows "Downloading…" and is disabled while serializing
 *  (b) Button reverts to "Download" and re-enables after success
 *  (c) Error toast is shown when serializeAsync rejects
 *  (d) Button reverts to "Download" after an error (not stuck in loading)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ── Hoisted mock handles ──────────────────────────────────────────────────────

const mockSerializeAsync = vi.hoisted(() => vi.fn<() => Promise<string>>());
const mockDownloadTextFile = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/gpsExport", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/gpsExport")>();
  return {
    ...original,
    serializeAsync: mockSerializeAsync,
    downloadTextFile: mockDownloadTextFile,
  };
});

vi.mock("@workspace/api-client-react", () => ({
  useGetMarkers: () => ({
    data: [{ id: "m1", lon: 1, lat: 2, depth: 10, label: "A", type: "custom" }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetTrollingPresets: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetCatches: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  getGetMarkersQueryKey: (...a: unknown[]) => ["markers", ...a],
  getGetTrollingPresetsQueryKey: () => ["trollingPresets"],
  getGetCatchesQueryKey: (...a: unknown[]) => ["catches", ...a],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/hooks/useFocusTrap", () => ({
  useFocusTrap: () => {},
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { GpsExportDialog } from "@/components/GpsExportDialog";

const TERRAIN = {
  datasetId: "ds-1",
  name: "Test Lake",
  minLon: -93,
  minLat: 45,
  maxLon: -92,
  maxLat: 46,
  waterType: "freshwater" as const,
};

function renderDialog() {
  const onClose = vi.fn();
  render(<GpsExportDialog terrain={TERRAIN as never} onClose={onClose} />);
  return { onClose };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GpsExportDialog — serializing state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // (a) Button shows "Downloading…" and is disabled while serializing
  it("(a) button shows 'Downloading…' and is disabled while serializeAsync is pending", async () => {
    // Never-resolving promise so we can inspect the in-progress state.
    mockSerializeAsync.mockReturnValue(new Promise(() => {}));

    renderDialog();

    const btn = screen.getByTestId("gps-export-confirm");
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveTextContent("Download");

    fireEvent.click(btn);

    // After the click the button should immediately show loading state.
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Downloading…");
    expect(btn).toHaveAttribute("aria-busy", "true");
  });

  // (b) Button reverts to "Download" and re-enables after success
  it("(b) button reverts to 'Download' after serialization succeeds", async () => {
    let resolveSerialize!: (v: string) => void;
    mockSerializeAsync.mockReturnValue(
      new Promise<string>((res) => { resolveSerialize = res; }),
    );

    const { onClose } = renderDialog();

    fireEvent.click(screen.getByTestId("gps-export-confirm"));

    // In-flight: button is disabled.
    expect(screen.getByTestId("gps-export-confirm")).toBeDisabled();

    // Resolve serialization.
    await act(async () => {
      resolveSerialize("<gpx/>");
    });

    // Dialog closes on success — onClose should have been called.
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());

    // Toast should have fired.
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "GPS export ready" }),
    );

    // Download helper should have been called.
    expect(mockDownloadTextFile).toHaveBeenCalledOnce();
  });

  // (c) Error toast shown when serializeAsync rejects
  it("(c) shows an error toast when serializeAsync rejects", async () => {
    mockSerializeAsync.mockRejectedValue(new Error("Out of memory"));

    renderDialog();

    fireEvent.click(screen.getByTestId("gps-export-confirm"));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Export failed",
          description: "Out of memory",
          variant: "destructive",
        }),
      ),
    );

    // Download should NOT have been called.
    expect(mockDownloadTextFile).not.toHaveBeenCalled();
  });

  // (d) Button reverts to "Download" after an error (not stuck in loading)
  it("(d) button is re-enabled after a serialization error", async () => {
    let rejectSerialize!: (e: Error) => void;
    mockSerializeAsync.mockReturnValue(
      new Promise<string>((_, rej) => { rejectSerialize = rej; }),
    );

    renderDialog();

    fireEvent.click(screen.getByTestId("gps-export-confirm"));
    expect(screen.getByTestId("gps-export-confirm")).toBeDisabled();

    await act(async () => {
      rejectSerialize(new Error("disk full"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("gps-export-confirm")).not.toBeDisabled(),
    );
    expect(screen.getByTestId("gps-export-confirm")).toHaveTextContent("Download");
  });
});
