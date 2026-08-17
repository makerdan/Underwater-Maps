/**
 * Unit tests for the HelpOfflineControl states rendered inside HelpWindow.
 *
 * Tests each of the five UI states:
 *  - not-downloaded  → shows "Download for offline" button
 *  - downloading     → shows progress label
 *  - downloaded      → shows "Help available offline" + re-download button
 *  - update-available → shows "Help update available" + update button
 *  - unavailable     → shows disabled indicator with explanation
 *
 * Mocks idb-keyval and the global `caches` so no real IndexedDB or Cache
 * Storage is required.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// idb-keyval
vi.mock("idb-keyval", () => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));

// helpContent — only needs HELP_ARTICLES and a few other named exports
vi.mock("@/lib/helpContent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/helpContent")>(
    "@/lib/helpContent",
  );
  return {
    ...actual,
    HELP_ARTICLES: [
      {
        id: "test-article",
        title: "Test Article",
        section: "Getting Started",
        order: 1,
        body: "![img](/help/a.png)",
        searchText: "test article",
        showQA: false,
      },
    ],
    HELP_SECTIONS: [
      {
        name: "Getting Started",
        articles: [
          {
            id: "test-article",
            title: "Test Article",
            section: "Getting Started",
            order: 1,
            body: "![img](/help/a.png)",
            searchText: "test article",
            showQA: false,
          },
        ],
      },
    ],
    getArticleById: () => ({
      id: "test-article",
      title: "Test Article",
      section: "Getting Started",
      order: 1,
      body: "![img](/help/a.png)",
      searchText: "test article",
      showQA: false,
    }),
    searchArticles: () => [],
  };
});

// settingsStore
vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: vi.fn((selector: (s: { setHasSeenOnboarding: () => void }) => unknown) =>
    selector({ setHasSeenOnboarding: vi.fn() }),
  ),
}));

// useServerSettingsSync
vi.mock("@/hooks/useServerSettingsSync", () => ({
  flushServerSync: vi.fn().mockResolvedValue(undefined),
}));

// HelpQA
vi.mock("@/components/help/HelpQA", () => ({
  HelpQA: () => null,
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import * as idb from "idb-keyval";
import { HelpWindow } from "../HelpWindow";
import { useHelpStore } from "@/lib/helpStore";
import {
  computeManifestFingerprint,
  extractHelpMediaUrls,
  type HelpPackRecord,
} from "@/lib/helpPackStore";
import { HELP_ARTICLES } from "@/lib/helpContent";

const idbGet = vi.mocked(idb.get);
const idbSet = vi.mocked(idb.set);

// ── Helpers ───────────────────────────────────────────────────────────────────

function openHelpWindow() {
  act(() => {
    useHelpStore.setState({ open: true });
  });
}

function makeCachesMock(options: { available: boolean; putFails?: boolean } = { available: true }) {
  if (!options.available) return undefined;
  return {
    open: vi.fn().mockResolvedValue({
      put: options.putFails
        ? vi.fn().mockRejectedValue(new Error("put failed"))
        : vi.fn().mockResolvedValue(undefined),
    }),
  };
}

// Build a "downloaded" record with the current manifest fingerprint
function makeCurrentRecord(): HelpPackRecord {
  const urls = extractHelpMediaUrls(HELP_ARTICLES, "");
  return {
    savedAt: new Date().toISOString(),
    assets: urls.map((u) => ({ url: u, sizeBytes: 100 })),
    totalBytes: 100 * urls.length,
    fingerprint: computeManifestFingerprint(urls),
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("HelpOfflineControl — status rendering", () => {
  beforeEach(() => {
    idbGet.mockReset();
    idbSet.mockReset().mockResolvedValue(undefined);
    vi.unstubAllGlobals();
    // Reset help store
    act(() => {
      useHelpStore.setState({ open: false });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows "Download for offline" button in not-downloaded state', async () => {
    vi.stubGlobal("caches", makeCachesMock());
    idbGet.mockResolvedValue(undefined);

    render(<HelpWindow />);
    openHelpWindow();

    await waitFor(() => {
      expect(screen.getByTestId("help-offline-download-btn")).toBeInTheDocument();
    });
    expect(screen.getByTestId("help-offline-download-btn")).toHaveTextContent(
      "Download for offline",
    );
  });

  it('shows "Help available offline" in downloaded state', async () => {
    vi.stubGlobal("caches", makeCachesMock());
    idbGet.mockResolvedValue(makeCurrentRecord());

    render(<HelpWindow />);
    openHelpWindow();

    await waitFor(() => {
      expect(screen.getByTestId("help-offline-downloaded")).toBeInTheDocument();
    });
    expect(screen.getByTestId("help-offline-downloaded")).toHaveTextContent(
      "Help available offline",
    );
  });

  it('shows re-download button in downloaded state', async () => {
    vi.stubGlobal("caches", makeCachesMock());
    idbGet.mockResolvedValue(makeCurrentRecord());

    render(<HelpWindow />);
    openHelpWindow();

    await waitFor(() => {
      expect(screen.getByTestId("help-offline-redownload")).toBeInTheDocument();
    });
  });

  it('shows "Help update available" in update-available state', async () => {
    vi.stubGlobal("caches", makeCachesMock());
    const staleRecord: HelpPackRecord = {
      savedAt: new Date().toISOString(),
      assets: [],
      totalBytes: 0,
      fingerprint: "stale0001",
    };
    idbGet.mockResolvedValue(staleRecord);

    render(<HelpWindow />);
    openHelpWindow();

    await waitFor(() => {
      expect(screen.getByTestId("help-offline-update")).toBeInTheDocument();
    });
    expect(screen.getByTestId("help-offline-update")).toHaveTextContent("Help update available");
  });

  it('shows "Update offline help" button in update-available state', async () => {
    vi.stubGlobal("caches", makeCachesMock());
    idbGet.mockResolvedValue({
      savedAt: new Date().toISOString(),
      assets: [],
      totalBytes: 0,
      fingerprint: "stale0002",
    });

    render(<HelpWindow />);
    openHelpWindow();

    await waitFor(() => {
      expect(screen.getByTestId("help-offline-update-btn")).toBeInTheDocument();
    });
  });

  it('shows "Offline download unavailable" when Cache Storage is absent', async () => {
    vi.stubGlobal("caches", undefined);

    render(<HelpWindow />);
    openHelpWindow();

    await waitFor(() => {
      expect(screen.getByTestId("help-offline-unavailable")).toBeInTheDocument();
    });
    expect(screen.getByTestId("help-offline-unavailable")).toHaveTextContent(
      "Offline download unavailable",
    );
  });

  it("unavailable state shows a secure context explanation", async () => {
    vi.stubGlobal("caches", undefined);

    render(<HelpWindow />);
    openHelpWindow();

    await waitFor(() => {
      expect(screen.getByTestId("help-offline-unavailable")).toBeInTheDocument();
    });
    expect(screen.getByTestId("help-offline-unavailable")).toHaveTextContent("secure");
  });
});

describe("HelpOfflineControl — download interaction", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    idbGet.mockReset();
    idbSet.mockReset().mockResolvedValue(undefined);
    vi.unstubAllGlobals();
    act(() => {
      useHelpStore.setState({ open: false });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clicking Download shows the downloading state", async () => {
    vi.stubGlobal("caches", makeCachesMock());
    idbGet.mockResolvedValue(undefined);

    // Stall the fetch so we can observe the downloading state
    let resolveFetch!: (v: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((res) => {
            resolveFetch = res;
          }),
      ),
    );

    render(<HelpWindow />);
    openHelpWindow();

    await waitFor(() => expect(screen.getByTestId("help-offline-download-btn")).toBeInTheDocument());

    await user.click(screen.getByTestId("help-offline-download-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("help-offline-downloading")).toBeInTheDocument();
    });

    // Unblock fetch
    resolveFetch(new Response(new Uint8Array([1]), { status: 200 }));
  });

  it("after successful download shows downloaded state", async () => {
    vi.stubGlobal("caches", makeCachesMock());
    idbGet.mockResolvedValue(undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]), { status: 200 })),
    );

    render(<HelpWindow />);
    openHelpWindow();

    await waitFor(() => expect(screen.getByTestId("help-offline-download-btn")).toBeInTheDocument());

    await user.click(screen.getByTestId("help-offline-download-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("help-offline-downloaded")).toBeInTheDocument();
    });
  });
});
