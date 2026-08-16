/**
 * DataStorageSection async-error regression tests (task: Data Storage async
 * error handling & ClearAll safety).
 *
 * Covers:
 *   (a) loader failure → error state + Retry rendered, not a permanent "Loading…"
 *   (b) mutation failure → error shown inline and the button re-enables
 *   (c) clear-all orchestration uses the targeted helpers (never a broad wipe)
 *   (d) upscale info is refreshed after clear-all
 *   (e) clear-all still clears independent stores when Cache Storage is
 *       unavailable, with an informational note
 *   (f) no state updates / React errors after unmount mid-flight
 *   (g) per-pack-id delete locking + serialized (de-duplicated) pack refreshes
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const h = vi.hoisted(() => ({
  resetSection: vi.fn(),
  listCachedDatasets: vi.fn(),
  countPendingItems: vi.fn(),
  clearCacheEntry: vi.fn(),
  clearTerrainCaches: vi.fn(),
  clearPendingSyncQueue: vi.fn(),
  getUpscaleCacheInfo: vi.fn(),
  clearUpscaleCache: vi.fn(),
  listOfflinePacks: vi.fn(),
  deleteOfflinePack: vi.fn(),
  getHelpPackStatus: vi.fn(),
  deleteHelpPack: vi.fn(),
  toast: vi.fn(),
}));

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
  del: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/useUpscaledHeatmap", () => ({
  clearUpscaleCache: h.clearUpscaleCache,
  getUpscaleCacheInfo: h.getUpscaleCacheInfo,
}));

vi.mock("@/lib/offlinePackStore", () => ({
  listOfflinePacks: h.listOfflinePacks,
  deleteOfflinePack: h.deleteOfflinePack,
}));

vi.mock("@/lib/helpPackStore", () => ({
  getHelpPackStatus: h.getHelpPackStatus,
  deleteHelpPack: h.deleteHelpPack,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: h.toast }),
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/pages/settings/EnvOfflineSection", () => ({
  EnvOfflineSection: () => null,
}));

vi.mock("@/pages/settings/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pages/settings/constants")>();
  return {
    ...actual,
    listCachedDatasets: h.listCachedDatasets,
    countPendingItems: h.countPendingItems,
    clearCacheEntry: h.clearCacheEntry,
    clearTerrainCaches: h.clearTerrainCaches,
    clearPendingSyncQueue: h.clearPendingSyncQueue,
  };
});

import { DataStorageSection } from "../DataStorageSection";

const CACHE_ENTRY = { url: "https://x.test/api/datasets/demo/terrain", label: "demo (terrain)", sizeKb: 12 };

function makePack(id: string) {
  return {
    id,
    datasetName: `Pack ${id}`,
    savedAt: "2026-08-01T00:00:00.000Z",
    storageBytesEstimate: 2048,
    tidePack: { tidalExpiresAt: "2099-01-01T00:00:00.000Z" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Green-path defaults; individual tests override with rejections/deferreds.
  h.listCachedDatasets.mockResolvedValue([CACHE_ENTRY]);
  h.countPendingItems.mockResolvedValue({ markers: 0, trails: 0 });
  h.clearCacheEntry.mockResolvedValue(undefined);
  h.clearTerrainCaches.mockResolvedValue(true);
  h.clearPendingSyncQueue.mockResolvedValue(undefined);
  h.getUpscaleCacheInfo.mockResolvedValue({ count: 2, bytes: 2048 });
  h.clearUpscaleCache.mockResolvedValue(undefined);
  h.listOfflinePacks.mockResolvedValue([]);
  h.deleteOfflinePack.mockResolvedValue(undefined);
  h.getHelpPackStatus.mockResolvedValue({ saved: false });
  h.deleteHelpPack.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loader error states", () => {
  it("cache list load failure renders an error with Retry, not 'Loading…', and Retry recovers", async () => {
    h.listCachedDatasets.mockRejectedValueOnce(new Error("idb down"));
    render(<DataStorageSection />);

    const err = await screen.findByTestId("cache-load-error");
    expect(err).toHaveTextContent(/failed to load/i);
    expect(screen.queryByTestId("no-cache-msg")).not.toBeInTheDocument();

    // Retry uses the default (successful) mock and recovers.
    fireEvent.click(screen.getByTestId("retry-cache-load"));
    expect(await screen.findByTestId("cache-entry")).toBeInTheDocument();
    expect(screen.queryByTestId("cache-load-error")).not.toBeInTheDocument();
  });

  it("upscale info load failure renders an error with Retry and recovers", async () => {
    h.getUpscaleCacheInfo.mockRejectedValueOnce(new Error("idb down"));
    render(<DataStorageSection />);

    expect(await screen.findByTestId("upscale-load-error")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("retry-upscale-load"));
    await waitFor(() =>
      expect(screen.queryByTestId("upscale-load-error")).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/2 images cached/)).toBeInTheDocument();
  });

  it("packs load failure renders errors with Retry in both pack cards and recovers", async () => {
    h.listOfflinePacks.mockRejectedValueOnce(new Error("idb down"));
    render(<DataStorageSection />);

    expect(await screen.findByTestId("packs-load-error")).toBeInTheDocument();
    expect(screen.getByTestId("help-load-error")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("retry-packs-load"));
    await waitFor(() =>
      expect(screen.queryByTestId("packs-load-error")).not.toBeInTheDocument(),
    );
  });
});

describe("mutation error handling", () => {
  it("failed pack delete shows an error and re-enables the button", async () => {
    h.listOfflinePacks.mockResolvedValue([makePack("a")]);
    h.deleteOfflinePack.mockRejectedValueOnce(new Error("boom"));
    render(<DataStorageSection />);

    const btn = await screen.findByTestId("delete-pack-a");
    fireEvent.click(btn);

    expect(await screen.findByTestId("pack-delete-error")).toBeInTheDocument();
    expect(screen.getByTestId("delete-pack-a")).toBeEnabled();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("failed help pack delete shows an error and re-enables the button", async () => {
    h.getHelpPackStatus.mockResolvedValue({ saved: true, savedAt: "2026-08-01T00:00:00.000Z", totalBytes: 1024 });
    h.deleteHelpPack.mockRejectedValueOnce(new Error("boom"));
    render(<DataStorageSection />);

    const btn = await screen.findByTestId("delete-help-pack-btn");
    fireEvent.click(btn);

    expect(await screen.findByTestId("help-delete-error")).toBeInTheDocument();
    expect(screen.getByTestId("delete-help-pack-btn")).toBeEnabled();
  });

  it("failed single-entry clear shows an error and re-enables the button", async () => {
    h.clearCacheEntry.mockRejectedValueOnce(new Error("boom"));
    render(<DataStorageSection />);

    const entry = await screen.findByTestId("cache-entry");
    fireEvent.click(entry.querySelector("button")!);

    expect(await screen.findByTestId("clear-entry-error")).toBeInTheDocument();
    expect(entry.querySelector("button")).toBeEnabled();
  });

  it("failed clear-all shows an error and re-enables the button", async () => {
    h.clearTerrainCaches.mockRejectedValueOnce(new Error("boom"));
    render(<DataStorageSection />);

    fireEvent.click(await screen.findByTestId("clear-all-cache-btn"));

    expect(await screen.findByTestId("clear-all-error")).toBeInTheDocument();
    expect(screen.getByTestId("clear-all-cache-btn")).toBeEnabled();
  });

  it("failed upscale-cache clear shows an error and re-enables the button", async () => {
    h.clearUpscaleCache.mockRejectedValueOnce(new Error("boom"));
    render(<DataStorageSection />);

    const btn = await screen.findByTestId("clear-upscale-cache-btn");
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);

    expect(await screen.findByTestId("upscale-clear-error")).toBeInTheDocument();
    expect(screen.getByTestId("clear-upscale-cache-btn")).toBeEnabled();
  });
});

describe("clear-all orchestration", () => {
  it("uses the targeted helpers and refreshes both cache list and upscale info", async () => {
    render(<DataStorageSection />);
    await screen.findByTestId("cache-entry");
    const upscaleCallsBefore = h.getUpscaleCacheInfo.mock.calls.length;
    const listCallsBefore = h.listCachedDatasets.mock.calls.length;

    fireEvent.click(screen.getByTestId("clear-all-cache-btn"));

    await waitFor(() => {
      expect(h.clearTerrainCaches).toHaveBeenCalledOnce();
      expect(h.clearPendingSyncQueue).toHaveBeenCalledOnce();
      // (d) upscale info refreshed after clear-all, alongside the cache list
      expect(h.getUpscaleCacheInfo.mock.calls.length).toBeGreaterThan(upscaleCallsBefore);
      expect(h.listCachedDatasets.mock.calls.length).toBeGreaterThan(listCallsBefore);
    });
    expect(await screen.findByText("✓ Cached data cleared")).toBeInTheDocument();
  });

  it("discloses the exact clear scope next to the button", async () => {
    render(<DataStorageSection />);
    await screen.findByTestId("cache-entry");
    const note = screen.getByTestId("clear-all-scope-note");
    expect(note).toHaveTextContent(/pending\s*sync queue/i);
    expect(note).toHaveTextContent(/offline packs, help content, weather packs and enhanced images\s*are kept/i);
  });

  it("still clears independent stores and shows a note when Cache Storage is unavailable", async () => {
    h.clearTerrainCaches.mockResolvedValue(false);
    render(<DataStorageSection />);

    fireEvent.click(await screen.findByTestId("clear-all-cache-btn"));

    expect(await screen.findByTestId("clear-all-note")).toHaveTextContent(/tile cache could not be cleared/i);
    expect(h.clearPendingSyncQueue).toHaveBeenCalledOnce();
  });
});

describe("unmount safety", () => {
  it("does not error or set state when async work resolves after unmount", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const del = deferred<void>();
    h.listOfflinePacks.mockResolvedValue([makePack("a")]);
    h.deleteOfflinePack.mockReturnValue(del.promise);

    const { unmount } = render(<DataStorageSection />);
    fireEvent.click(await screen.findByTestId("delete-pack-a"));
    unmount();

    await act(async () => {
      del.resolve();
      // let the resumed handler chain (refreshPacks → setters) flush
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("does not error when a loader rejects after unmount", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const load = deferred<never[]>();
    h.listCachedDatasets.mockReturnValue(load.promise);

    const { unmount } = render(<DataStorageSection />);
    unmount();

    await act(async () => {
      load.reject(new Error("late failure"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("concurrent pack deletes", () => {
  it("locks per pack id — deleting one pack leaves the others' buttons enabled", async () => {
    const delA = deferred<void>();
    h.listOfflinePacks.mockResolvedValue([makePack("a"), makePack("b")]);
    h.deleteOfflinePack.mockImplementation((id: string) =>
      id === "a" ? delA.promise : Promise.resolve(),
    );
    render(<DataStorageSection />);

    fireEvent.click(await screen.findByTestId("delete-pack-a"));
    await waitFor(() => expect(screen.getByTestId("delete-pack-a")).toBeDisabled());
    expect(screen.getByTestId("delete-pack-b")).toBeEnabled();

    await act(async () => {
      delA.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("delete-pack-a")).toBeEnabled());
  });

  it("serializes overlapping refreshPacks calls so the last result wins", async () => {
    // Initial load resolves immediately with two packs.
    h.listOfflinePacks.mockResolvedValueOnce([makePack("a"), makePack("b")]);
    render(<DataStorageSection />);
    await screen.findByTestId("delete-pack-a");
    expect(h.listOfflinePacks).toHaveBeenCalledTimes(1);

    // Subsequent refreshes are manually controlled.
    const r1 = deferred<ReturnType<typeof makePack>[]>();
    const r2 = deferred<ReturnType<typeof makePack>[]>();
    h.listOfflinePacks.mockReturnValueOnce(r1.promise).mockReturnValueOnce(r2.promise);

    // Two deletes complete back-to-back → two refreshPacks calls overlap.
    fireEvent.click(screen.getByTestId("delete-pack-a"));
    fireEvent.click(screen.getByTestId("delete-pack-b"));

    // Only ONE in-flight list call: the second refresh is queued, not raced.
    await waitFor(() => expect(h.listOfflinePacks).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.listOfflinePacks).toHaveBeenCalledTimes(2);

    // First (stale) result resolves → queued refresh starts.
    await act(async () => {
      r1.resolve([makePack("b")]);
    });
    await waitFor(() => expect(h.listOfflinePacks).toHaveBeenCalledTimes(3));

    // Latest result resolves last and is the one applied.
    await act(async () => {
      r2.resolve([]);
    });
    await waitFor(() =>
      expect(screen.queryByTestId("delete-pack-a")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("delete-pack-b")).not.toBeInTheDocument();
    expect(screen.getByText(/No offline packs saved/)).toBeInTheDocument();
  });
});

describe("concurrent clear handler mutex", () => {
  it("a second clear handler fired while another is in flight is a no-op", async () => {
    // Keep clearTerrainCaches (handleClearAll) pending so it stays in-flight.
    const clearAllDeferred = deferred<boolean>();
    h.clearTerrainCaches.mockReturnValue(clearAllDeferred.promise);

    render(<DataStorageSection />);
    // Wait for the cache entry to appear so both buttons are rendered.
    await screen.findByTestId("cache-entry");

    // Fire Clear All — this handler acquires the mutex.
    fireEvent.click(screen.getByTestId("clear-all-cache-btn"));

    // Immediately fire the per-entry clear — must be a no-op.
    const entryBtn = screen.getByTestId("cache-entry").querySelector("button")!;
    fireEvent.click(entryBtn);

    // clearCacheEntry must never have been called while Clear All was in-flight.
    expect(h.clearCacheEntry).not.toHaveBeenCalled();

    // Buttons are visually disabled while the operation is in-flight.
    expect(screen.getByTestId("clear-all-cache-btn")).toBeDisabled();
    expect(entryBtn).toBeDisabled();

    // Resolve Clear All so the component cleans up properly.
    await act(async () => {
      clearAllDeferred.resolve(true);
    });

    // After completion both buttons re-enable.
    await waitFor(() => expect(screen.getByTestId("clear-all-cache-btn")).toBeEnabled());
    expect(h.clearCacheEntry).not.toHaveBeenCalled();
  });

  it("handleClearUpscaleCache cannot start while handleClearAll is in flight", async () => {
    const clearAllDeferred = deferred<boolean>();
    h.clearTerrainCaches.mockReturnValue(clearAllDeferred.promise);
    // Give upscale count > 0 so its button is enabled when not clearing.
    h.getUpscaleCacheInfo.mockResolvedValue({ count: 3, bytes: 3072 });

    render(<DataStorageSection />);
    await screen.findByTestId("cache-entry");
    // Wait for upscale button to become enabled (count > 0 loaded).
    const upscaleBtn = await screen.findByTestId("clear-upscale-cache-btn");
    await waitFor(() => expect(upscaleBtn).toBeEnabled());

    // Fire Clear All — acquires mutex.
    fireEvent.click(screen.getByTestId("clear-all-cache-btn"));

    // Fire upscale clear — must be blocked by the mutex.
    fireEvent.click(upscaleBtn);

    expect(h.clearUpscaleCache).not.toHaveBeenCalled();

    // Resolve Clear All.
    await act(async () => {
      clearAllDeferred.resolve(true);
    });

    // Still never called — the button click was a no-op.
    expect(h.clearUpscaleCache).not.toHaveBeenCalled();
  });
});
