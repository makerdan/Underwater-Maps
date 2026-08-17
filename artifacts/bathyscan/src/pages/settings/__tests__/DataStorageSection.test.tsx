/**
 * DataStorageSection unit tests.
 *
 * Covers:
 *   - Renders without crashing
 *   - Key controls present (Auto-Load Last Dataset toggle, clear upscale cache button, data cache card)
 *   - Save and reset buttons (SectionActionsRow section="data") are present
 *   - Clicking reset calls resetSection("data")
 *   - Empty cache state shows the no-cache message
 *   - Help media row hidden when no pack saved
 *   - Help media row shows asset count and size when pack is saved
 *   - Clicking REMOVE calls deleteHelpPack
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => {
  const resetSection = vi.fn();
  return { resetSection };
});

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    autoLoadLastDataset: true,
    setAutoLoadLastDataset: vi.fn(),
    syncedSnapshot: null,
    lastSyncedAt: null,
    resetSection: h.resetSection,
  });

  const useSettingsStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof state>) => T): T => sel(state()),
    {
      getState: () => state(),
      setState: vi.fn(),
      persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );

  return { ...actual, useSettingsStore };
});

vi.mock("idb-keyval", () => ({
  clear: vi.fn().mockResolvedValue(undefined),
  keys: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/hooks/useUpscaledHeatmap", () => ({
  clearUpscaleCache: vi.fn().mockResolvedValue(undefined),
  getUpscaleCacheInfo: vi.fn().mockResolvedValue({ count: 0, bytes: 0 }),
}));

vi.mock("@/lib/offlinePackStore", () => ({
  listOfflinePacks: vi.fn().mockResolvedValue([]),
  deleteOfflinePack: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/helpPackStore", () => ({
  getHelpPackRecord: vi.fn().mockResolvedValue(null),
  deleteHelpPack: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/pages/settings/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pages/settings/constants")>();
  return {
    ...actual,
    listCachedDatasets: vi.fn().mockResolvedValue([]),
    countPendingItems: vi.fn().mockResolvedValue({ markers: 0, trails: 0 }),
    clearCacheEntry: vi.fn().mockResolvedValue(undefined),
  };
});

import { DataStorageSection } from "../DataStorageSection";
import * as helpPackStore from "@/lib/helpPackStore";

const MOCK_HELP_RECORD: helpPackStore.HelpPackRecord = {
  savedAt: "2026-01-15T12:00:00.000Z",
  assets: [
    { url: "/bathyscan/help/img/a.gif", sizeBytes: 102400 },
    { url: "/bathyscan/help/img/b.gif", sizeBytes: 204800 },
  ],
  totalBytes: 307200,
  fingerprint: "abc12345",
};

describe("DataStorageSection", () => {
  beforeEach(() => {
    h.resetSection.mockClear();
    vi.mocked(helpPackStore.getHelpPackRecord).mockResolvedValue(null);
    vi.mocked(helpPackStore.deleteHelpPack).mockResolvedValue(undefined);
  });

  it("renders without crashing", () => {
    const { container } = render(<DataStorageSection />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the DATA & STORAGE heading text", () => {
    render(<DataStorageSection />);
    expect(screen.getByRole("heading", { name: /DATA/i })).toBeInTheDocument();
  });

  it("renders DEFAULTS card header", () => {
    render(<DataStorageSection />);
    expect(screen.getByText("DEFAULTS")).toBeInTheDocument();
  });

  it("renders Auto-Load Last Dataset label", () => {
    render(<DataStorageSection />);
    expect(screen.getByText("Auto-Load Last Dataset")).toBeInTheDocument();
  });

  it("renders CACHED TERRAIN DATA card header", () => {
    render(<DataStorageSection />);
    expect(screen.getByText("CACHED TERRAIN DATA")).toBeInTheDocument();
  });

  it("renders ENHANCED IMAGE CACHE card header", () => {
    render(<DataStorageSection />);
    expect(screen.getByText("ENHANCED IMAGE CACHE")).toBeInTheDocument();
  });

  it("renders SAVED OFFLINE PACKS card header", () => {
    render(<DataStorageSection />);
    expect(screen.getByText("SAVED OFFLINE PACKS")).toBeInTheDocument();
  });

  it("renders the clear upscale cache button", () => {
    render(<DataStorageSection />);
    expect(screen.getByTestId("clear-upscale-cache-btn")).toBeInTheDocument();
  });

  it("renders the save button for data section", () => {
    render(<DataStorageSection />);
    expect(screen.getByTestId("save-section-data-btn")).toBeInTheDocument();
  });

  it("renders the reset button for data section", () => {
    render(<DataStorageSection />);
    expect(screen.getByTestId("reset-section-data-btn")).toBeInTheDocument();
  });

  it("clicking the reset button calls resetSection('data')", () => {
    render(<DataStorageSection />);
    fireEvent.click(screen.getByTestId("reset-section-data-btn"));
    expect(h.resetSection).toHaveBeenCalledWith("data");
  });

  it("shows no-cache message when cache is empty (after async load)", async () => {
    render(<DataStorageSection />);
    const msg = await screen.findByTestId("no-cache-msg");
    expect(msg).toBeInTheDocument();
  });

  it("hides the help media row when no pack is saved", async () => {
    render(<DataStorageSection />);
    // wait for async loads to settle
    await screen.findByTestId("no-cache-msg");
    expect(screen.queryByTestId("help-media-row")).not.toBeInTheDocument();
  });

  it("shows HELP MEDIA card with asset count and size when pack is saved", async () => {
    vi.mocked(helpPackStore.getHelpPackRecord).mockResolvedValue(MOCK_HELP_RECORD);
    render(<DataStorageSection />);
    const row = await screen.findByTestId("help-media-row");
    expect(row).toBeInTheDocument();
    // asset count
    expect(row).toHaveTextContent("2 assets cached");
    // size — 307200 bytes = 300 KB
    expect(row).toHaveTextContent("300 KB");
  });

  it("shows HELP MEDIA card header when pack is saved", async () => {
    vi.mocked(helpPackStore.getHelpPackRecord).mockResolvedValue(MOCK_HELP_RECORD);
    render(<DataStorageSection />);
    await screen.findByTestId("help-media-row");
    expect(screen.getByText("HELP MEDIA")).toBeInTheDocument();
  });

  it("calls deleteHelpPack when REMOVE is clicked", async () => {
    vi.mocked(helpPackStore.getHelpPackRecord).mockResolvedValue(MOCK_HELP_RECORD);
    render(<DataStorageSection />);
    const btn = await screen.findByTestId("delete-help-pack-btn");
    fireEvent.click(btn);
    await waitFor(() => expect(helpPackStore.deleteHelpPack).toHaveBeenCalledTimes(1));
  });

  it("hides the help media row after REMOVE completes", async () => {
    vi.mocked(helpPackStore.getHelpPackRecord)
      .mockResolvedValueOnce(MOCK_HELP_RECORD) // initial load
      .mockResolvedValue(null);                // after delete + refresh
    render(<DataStorageSection />);
    const btn = await screen.findByTestId("delete-help-pack-btn");
    fireEvent.click(btn);
    await waitFor(() => expect(screen.queryByTestId("help-media-row")).not.toBeInTheDocument());
  });
});
