/**
 * Unit tests for helpPackStore.ts
 *
 * Covers:
 *  - extractHelpMediaUrls: scanning article bodies for image refs
 *  - computeManifestFingerprint: stable hashing and change detection
 *  - isCacheStorageAvailable: feature detection
 *  - getHelpOfflineStatus: all five status values
 *  - saveHelpPack: success, partial failure, and unavailable-cache paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractHelpMediaUrls,
  computeManifestFingerprint,
  isCacheStorageAvailable,
  getHelpOfflineStatus,
  saveHelpPack,
  type HelpPackRecord,
} from "../helpPackStore";
import type { HelpArticle } from "../helpContent";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeArticle(overrides: Partial<HelpArticle> & { body: string }): HelpArticle {
  return {
    id: "test-article",
    title: "Test",
    section: "Test",
    order: 1,
    body: overrides.body,
    searchText: overrides.body.toLowerCase(),
    ...overrides,
  };
}

// ── extractHelpMediaUrls ──────────────────────────────────────────────────────

describe("extractHelpMediaUrls", () => {
  it("extracts a single absolute-path image reference", () => {
    const articles = [makeArticle({ body: "![alt](/help/image.png)" })];
    expect(extractHelpMediaUrls(articles, "")).toEqual(["/help/image.png"]);
  });

  it("prepends the basePath to each URL", () => {
    const articles = [makeArticle({ body: "![alt](/help/image.png)" })];
    expect(extractHelpMediaUrls(articles, "/bathyscan")).toEqual(["/bathyscan/help/image.png"]);
  });

  it("extracts multiple images from a single article", () => {
    const body = "![a](/help/a.gif)\nSome text.\n![b](/help/b.png)";
    const articles = [makeArticle({ body })];
    expect(extractHelpMediaUrls(articles, "")).toEqual(["/help/a.gif", "/help/b.png"]);
  });

  it("deduplicates the same URL appearing in multiple articles", () => {
    const articles = [
      makeArticle({ id: "a", body: "![x](/help/x.png)" }),
      makeArticle({ id: "b", body: "![x](/help/x.png)" }),
    ];
    expect(extractHelpMediaUrls(articles, "")).toHaveLength(1);
  });

  it("returns a sorted list", () => {
    const body = "![z](/help/z.png)\n![a](/help/a.png)\n![m](/help/m.gif)";
    const articles = [makeArticle({ body })];
    const urls = extractHelpMediaUrls(articles, "");
    expect(urls).toEqual([...urls].sort());
  });

  it("ignores http and https URLs (not relative to the app)", () => {
    const articles = [makeArticle({ body: "![ext](https://example.com/img.png)" })];
    expect(extractHelpMediaUrls(articles, "")).toEqual([]);
  });

  it("returns an empty array when no images are present", () => {
    const articles = [makeArticle({ body: "# Just text\n\nNo images here." })];
    expect(extractHelpMediaUrls(articles, "")).toEqual([]);
  });

  it("handles images embedded within paragraph text", () => {
    const articles = [
      makeArticle({ body: "Before ![alt](/help/inline.png) after the image." }),
    ];
    expect(extractHelpMediaUrls(articles, "")).toEqual(["/help/inline.png"]);
  });

  it("scans across multiple articles", () => {
    const articles = [
      makeArticle({ id: "a", body: "![a](/help/a.png)" }),
      makeArticle({ id: "b", body: "![b](/help/b.png)" }),
    ];
    expect(extractHelpMediaUrls(articles, "")).toEqual(["/help/a.png", "/help/b.png"]);
  });
});

// ── computeManifestFingerprint ────────────────────────────────────────────────

describe("computeManifestFingerprint", () => {
  it("returns a non-empty hex string", () => {
    expect(computeManifestFingerprint(["/help/a.png"])).toMatch(/^[0-9a-f]+$/);
  });

  it("is stable — same input always produces the same output", () => {
    const urls = ["/help/a.png", "/help/b.gif"];
    expect(computeManifestFingerprint(urls)).toBe(computeManifestFingerprint(urls));
  });

  it("changes when a URL is added", () => {
    const fp1 = computeManifestFingerprint(["/help/a.png"]);
    const fp2 = computeManifestFingerprint(["/help/a.png", "/help/b.png"]);
    expect(fp1).not.toBe(fp2);
  });

  it("changes when a URL is removed", () => {
    const fp1 = computeManifestFingerprint(["/help/a.png", "/help/b.png"]);
    const fp2 = computeManifestFingerprint(["/help/a.png"]);
    expect(fp1).not.toBe(fp2);
  });

  it("changes when a URL is renamed", () => {
    const fp1 = computeManifestFingerprint(["/help/a.png"]);
    const fp2 = computeManifestFingerprint(["/help/b.png"]);
    expect(fp1).not.toBe(fp2);
  });

  it("returns a consistent value for an empty array", () => {
    expect(computeManifestFingerprint([])).toBe(computeManifestFingerprint([]));
  });
});

// ── isCacheStorageAvailable ───────────────────────────────────────────────────

describe("isCacheStorageAvailable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when the caches global is present with an open method", () => {
    vi.stubGlobal("caches", { open: vi.fn() });
    expect(isCacheStorageAvailable()).toBe(true);
  });

  it("returns false when the caches global is undefined", () => {
    vi.stubGlobal("caches", undefined);
    expect(isCacheStorageAvailable()).toBe(false);
  });

  it("returns false when caches.open is not a function", () => {
    vi.stubGlobal("caches", { open: null });
    expect(isCacheStorageAvailable()).toBe(false);
  });
});

// ── getHelpOfflineStatus ──────────────────────────────────────────────────────

vi.mock("idb-keyval", () => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));

import * as idb from "idb-keyval";
const idbGet = vi.mocked(idb.get);
const idbSet = vi.mocked(idb.set);

const SAMPLE_ARTICLES = [
  makeArticle({ id: "a", body: "![img](/help/a.png)" }),
];

describe("getHelpOfflineStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    idbGet.mockReset();
  });

  it('returns "unavailable" when Cache Storage is absent', async () => {
    vi.stubGlobal("caches", undefined);
    const status = await getHelpOfflineStatus(SAMPLE_ARTICLES, "");
    expect(status).toBe("unavailable");
  });

  it('returns "not-downloaded" when no IDB record exists', async () => {
    vi.stubGlobal("caches", { open: vi.fn() });
    idbGet.mockResolvedValue(undefined);
    const status = await getHelpOfflineStatus(SAMPLE_ARTICLES, "");
    expect(status).toBe("not-downloaded");
  });

  it('returns "downloaded" when record fingerprint matches current manifest', async () => {
    vi.stubGlobal("caches", { open: vi.fn() });
    const urls = ["/help/a.png"];
    const fingerprint = computeManifestFingerprint(urls);
    const record: HelpPackRecord = {
      savedAt: new Date().toISOString(),
      assets: [{ url: "/help/a.png", sizeBytes: 1000 }],
      totalBytes: 1000,
      fingerprint,
    };
    idbGet.mockResolvedValue(record);
    const status = await getHelpOfflineStatus(SAMPLE_ARTICLES, "");
    expect(status).toBe("downloaded");
  });

  it('returns "update-available" when record fingerprint differs from current manifest', async () => {
    vi.stubGlobal("caches", { open: vi.fn() });
    const record: HelpPackRecord = {
      savedAt: new Date().toISOString(),
      assets: [{ url: "/help/old.png", sizeBytes: 500 }],
      totalBytes: 500,
      fingerprint: "stale0000",
    };
    idbGet.mockResolvedValue(record);
    const status = await getHelpOfflineStatus(SAMPLE_ARTICLES, "");
    expect(status).toBe("update-available");
  });

  it('returns "downloaded" when record has no fingerprint (legacy record)', async () => {
    vi.stubGlobal("caches", { open: vi.fn() });
    // A record without a fingerprint field (saved by old code)
    const record = {
      savedAt: new Date().toISOString(),
      assets: [],
      totalBytes: 0,
      fingerprint: undefined as unknown as string,
    };
    idbGet.mockResolvedValue(record);
    const status = await getHelpOfflineStatus(SAMPLE_ARTICLES, "");
    // No fingerprint → falsy → treated as downloaded (no stale detection without data)
    expect(status).toBe("downloaded");
  });
});

// ── saveHelpPack ──────────────────────────────────────────────────────────────

describe("saveHelpPack — success path", () => {
  let mockCache: { put: ReturnType<typeof vi.fn> };
  let mockCachesOpen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCache = { put: vi.fn().mockResolvedValue(undefined) };
    mockCachesOpen = vi.fn().mockResolvedValue(mockCache);
    vi.stubGlobal("caches", { open: mockCachesOpen });

    idbGet.mockReset();
    idbSet.mockReset().mockResolvedValue(undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string) => {
        const body = new Uint8Array([1, 2, 3]);
        const response = new Response(body, { status: 200 });
        return Promise.resolve(response);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the correct cache", async () => {
    const articles = [makeArticle({ body: "![a](/help/a.png)" })];
    const onProgress = vi.fn();
    await saveHelpPack(articles, onProgress, "");
    expect(mockCachesOpen).toHaveBeenCalledWith("bathyscan-pack-help");
  });

  it("fetches each asset URL with cache:no-store", async () => {
    const articles = [
      makeArticle({ id: "a", body: "![a](/help/a.png)" }),
      makeArticle({ id: "b", body: "![b](/help/b.gif)" }),
    ];
    const fetchMock = vi.mocked(fetch);
    const onProgress = vi.fn();
    await saveHelpPack(articles, onProgress, "");
    expect(fetchMock).toHaveBeenCalledWith("/help/a.png", { cache: "no-store" });
    expect(fetchMock).toHaveBeenCalledWith("/help/b.gif", { cache: "no-store" });
  });

  it("writes the record to IndexedDB with a fingerprint", async () => {
    const articles = [makeArticle({ body: "![a](/help/a.png)" })];
    const onProgress = vi.fn();
    await saveHelpPack(articles, onProgress, "");
    expect(idbSet).toHaveBeenCalledOnce();
    const [, record] = idbSet.mock.calls[0]!;
    expect((record as HelpPackRecord).fingerprint).toBeTruthy();
    expect((record as HelpPackRecord).fingerprint).toMatch(/^[0-9a-f]+$/);
  });

  it("calls onProgress twice per asset (start + done)", async () => {
    const articles = [
      makeArticle({ id: "a", body: "![a](/help/a.png)" }),
      makeArticle({ id: "b", body: "![b](/help/b.png)" }),
    ];
    const onProgress = vi.fn();
    await saveHelpPack(articles, onProgress, "");
    // 2 assets × 2 calls each = 4
    expect(onProgress).toHaveBeenCalledTimes(4);
    // Check start call
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ done: false, index: 1, total: 2 }),
    );
    // Check done call
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ done: true, index: 1, total: 2 }),
    );
  });

  it("reports the total assets count in progress events", async () => {
    const articles = [
      makeArticle({ id: "a", body: "![a](/help/a.png)\n![b](/help/b.png)\n![c](/help/c.gif)" }),
    ];
    const onProgress = vi.fn();
    await saveHelpPack(articles, onProgress, "");
    const totals = onProgress.mock.calls.map((c) => (c[0] as HelpPackProgress).total);
    expect(new Set(totals)).toEqual(new Set([3]));
  });

  it("aborts the active fetch without writing a late help record", async () => {
    const cache = {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(true),
    };
    vi.stubGlobal("caches", { open: vi.fn().mockResolvedValue(cache) });
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          receivedSignal = init?.signal ?? undefined;
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
        }),
      ),
    );
    const controller = new AbortController();
    const pending = saveHelpPack(
      [makeArticle({ body: "![a](/help/a.png)" })],
      vi.fn(),
      "",
      controller.signal,
    );
    await vi.waitFor(() => expect(receivedSignal).toBe(controller.signal));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(idbSet).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });
});

describe("saveHelpPack — partial failure", () => {
  let mockCache: { put: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockCache = { put: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("caches", { open: vi.fn().mockResolvedValue(mockCache) });
    idbSet.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports error progress on a failing asset but continues and writes IDB record", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 })) // first asset fails
        .mockResolvedValue(
          (() => {
            const body = new Uint8Array([1]);
            return new Response(body, { status: 200 });
          })(),
        ),
    );

    const articles = [
      makeArticle({ id: "a", body: "![a](/help/a.png)" }),
      makeArticle({ id: "b", body: "![b](/help/b.png)" }),
    ];
    const onProgress = vi.fn();
    await saveHelpPack(articles, onProgress, "");

    const errorCall = onProgress.mock.calls.find(
      (c) => (c[0] as HelpPackProgress).error !== undefined,
    );
    expect(errorCall).toBeDefined();
    // IDB write still happens despite partial failure
    expect(idbSet).toHaveBeenCalledOnce();
  });
});
