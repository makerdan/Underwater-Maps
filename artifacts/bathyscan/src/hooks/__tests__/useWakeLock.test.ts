/**
 * useWakeLock — screen wake lock lifecycle.
 *
 * Covers:
 *  - acquires a wake lock sentinel when active becomes true
 *  - releases the sentinel when active flips false / on unmount
 *  - re-acquires after a visibilitychange back to visible
 *  - degrades silently when navigator.wakeLock is missing or request rejects
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWakeLock } from "@/hooks/useWakeLock";

interface MockSentinel {
  release: ReturnType<typeof vi.fn>;
}

let requestSpy: ReturnType<typeof vi.fn>;
let sentinels: MockSentinel[];

function installWakeLock(rejects = false) {
  sentinels = [];
  requestSpy = vi.fn(async () => {
    if (rejects) throw new DOMException("denied", "NotAllowedError");
    const sentinel: MockSentinel = { release: vi.fn(async () => {}) };
    sentinels.push(sentinel);
    return sentinel;
  });
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: { request: requestSpy },
  });
}

function removeWakeLock() {
  delete (navigator as unknown as Record<string, unknown>)["wakeLock"];
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useWakeLock", () => {
  beforeEach(() => {
    installWakeLock();
  });

  afterEach(() => {
    removeWakeLock();
    vi.restoreAllMocks();
  });

  it("acquires a screen wake lock when active is true", async () => {
    const { unmount } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: true },
    });
    await flush();
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith("screen");
    unmount();
  });

  it("does not acquire when active is false", async () => {
    const { unmount } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: false },
    });
    await flush();
    expect(requestSpy).not.toHaveBeenCalled();
    unmount();
  });

  it("releases the sentinel when active flips to false", async () => {
    const { rerender, unmount } = renderHook(
      ({ active }) => useWakeLock(active),
      { initialProps: { active: true } },
    );
    await flush();
    expect(sentinels).toHaveLength(1);

    rerender({ active: false });
    await flush();
    expect(sentinels[0]!.release).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("releases the sentinel on unmount", async () => {
    const { unmount } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: true },
    });
    await flush();
    unmount();
    await Promise.resolve();
    expect(sentinels[0]!.release).toHaveBeenCalledTimes(1);
  });

  it("re-acquires the lock when the tab becomes visible again", async () => {
    const { unmount } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: true },
    });
    await flush();
    expect(requestSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    // jsdom reports visibilityState 'visible', so the handler re-requests.
    expect(requestSpy).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("degrades silently when the request is rejected", async () => {
    installWakeLock(true);
    const { unmount } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: true },
    });
    await flush();
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(() => unmount()).not.toThrow();
  });

  it("is a no-op when navigator.wakeLock is unavailable", async () => {
    removeWakeLock();
    const { unmount } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: true },
    });
    await flush();
    expect(() => unmount()).not.toThrow();
  });
});
