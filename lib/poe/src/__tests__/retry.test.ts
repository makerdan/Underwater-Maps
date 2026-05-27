import { describe, it, expect, vi, afterEach } from "vitest";
import { withRetry } from "../retry.js";
import { PoeCreditsError, PoeRateLimitError, PoeAuthError, ZoneParseError } from "../errors.js";

function makeOpenAIError(status: number, message = "error"): { status: number; message: string } {
  return { status, message };
}

describe("withRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns value on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 3);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws PoeCreditsError immediately on 402 without retrying", async () => {
    const fn = vi.fn().mockRejectedValue(makeOpenAIError(402));
    await expect(withRetry(fn, 3)).rejects.toBeInstanceOf(PoeCreditsError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws PoeAuthError immediately on 401", async () => {
    const fn = vi.fn().mockRejectedValue(makeOpenAIError(401));
    await expect(withRetry(fn, 3)).rejects.toBeInstanceOf(PoeAuthError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws ZoneParseError immediately without any retries", async () => {
    const fn = vi.fn().mockRejectedValue(new ZoneParseError("content-filtered or empty response from Poe"));
    await expect(withRetry(fn, 3)).rejects.toBeInstanceOf(ZoneParseError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and eventually succeeds", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls++;
      if (calls < 3) return Promise.reject(makeOpenAIError(429));
      return Promise.resolve("recovered");
    });

    const resultPromise = withRetry(fn, 3);
    resultPromise.catch(() => {});
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws PoeRateLimitError after exhausting retries on 429", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(makeOpenAIError(429));
    const resultPromise = withRetry(fn, 3);
    resultPromise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(resultPromise).rejects.toBeInstanceOf(PoeRateLimitError);
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
