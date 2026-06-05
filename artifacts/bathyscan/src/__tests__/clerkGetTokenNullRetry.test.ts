/**
 * clerkGetTokenNullRetry.test.ts
 *
 * Unit tests for the getTokenWithRetry() helper exported from App.tsx.
 *
 * This function is the extraction of the null-token retry logic from
 * ClerkAuthTokenWirer.  It receives a getToken function and an onExpired
 * callback, attempts the token call once, and if null is returned it waits
 * a short delay then tries once more.  If the second attempt also returns
 * null it calls onExpired().
 *
 * Testing this pure async helper avoids the need to mount the full App.tsx
 * component tree (which would require mocking dozens of imports).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTokenWithRetry } from "@/App";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getTokenWithRetry — token returned on first call", () => {
  it("returns the token without retrying", async () => {
    const getToken = vi.fn().mockResolvedValue("tok-abc");
    const onExpired = vi.fn();

    const promise = getTokenWithRetry(getToken, onExpired, 500);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("tok-abc");
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe("getTokenWithRetry — first call null, second call succeeds", () => {
  it("returns the token from the retry and does not call onExpired", async () => {
    const getToken = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue("tok-retry");
    const onExpired = vi.fn();

    const promise = getTokenWithRetry(getToken, onExpired, 500);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("tok-retry");
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("waits the specified retryDelay before the second call", async () => {
    const callTimes: number[] = [];
    const getToken = vi.fn().mockImplementation(async () => {
      callTimes.push(Date.now());
      return callTimes.length === 1 ? null : "tok-ok";
    });
    const onExpired = vi.fn();

    const DELAY = 1_200;
    const promise = getTokenWithRetry(getToken, onExpired, DELAY);

    await vi.advanceTimersByTimeAsync(DELAY);
    await promise;

    expect(callTimes).toHaveLength(2);
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(DELAY);
  });
});

describe("getTokenWithRetry — both calls return null", () => {
  it("calls onExpired and returns null", async () => {
    const getToken = vi.fn().mockResolvedValue(null);
    const onExpired = vi.fn();

    const promise = getTokenWithRetry(getToken, onExpired, 500);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("calls onExpired exactly once even if called multiple times", async () => {
    const getToken = vi.fn().mockResolvedValue(null);
    const onExpired = vi.fn();

    const promise1 = getTokenWithRetry(getToken, onExpired, 100);
    const promise2 = getTokenWithRetry(getToken, onExpired, 100);
    await vi.runAllTimersAsync();
    await Promise.all([promise1, promise2]);

    expect(onExpired).toHaveBeenCalledTimes(2);
  });
});

describe("getTokenWithRetry — getToken rejects", () => {
  it("propagates the rejection without calling onExpired", async () => {
    const err = new Error("network failure");
    const getToken = vi.fn().mockRejectedValue(err);
    const onExpired = vi.fn();

    await expect(getTokenWithRetry(getToken, onExpired, 500)).rejects.toThrow("network failure");
    expect(onExpired).not.toHaveBeenCalled();
  });
});
