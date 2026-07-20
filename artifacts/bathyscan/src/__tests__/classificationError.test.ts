import { describe, it, expect } from "vitest";
import { categorizeClassificationError } from "@/lib/classificationStore";

describe("categorizeClassificationError", () => {
  it("maps a missing-key server error to category 'missing_key'", () => {
    const err = {
      status: 500,
      data: {
        error: "poe_error",
        details:
          "POE_API_KEY environment variable is not set. Add it to Secrets and restart.",
      },
      message: "Internal Server Error",
    };
    const out = categorizeClassificationError(err);
    expect(out.category).toBe("missing_key");
    expect(out.reason).toMatch(/POE_API_KEY/);
    expect(out.reason).toMatch(/Secrets/);
    expect(out.detail).toContain("POE_API_KEY environment variable");
  });

  it("maps a 401 ApiError (auth_error) to category 'unauthorized' with session message", () => {
    const err = {
      status: 401,
      data: { error: "auth_error", details: "AI service authentication failed" },
      message: "Unauthorized",
    };
    const out = categorizeClassificationError(err);
    expect(out.category).toBe("unauthorized");
    expect(out.reason).toMatch(/sign|session/i);
    expect(out.reason).not.toContain("POE_API_KEY");
  });

  it("maps a 401 with requireAuth body (Unauthorized) to 'unauthorized' with session message", () => {
    const err = {
      status: 401,
      data: { error: "Unauthorized" },
      message: "Unauthorized",
    };
    const out = categorizeClassificationError(err);
    expect(out.category).toBe("unauthorized");
    expect(out.reason).toMatch(/sign|session/i);
    expect(out.reason).not.toContain("POE_API_KEY");
  });

  it("maps a 429 ApiError to category 'rate_limited'", () => {
    const err = {
      status: 429,
      data: { error: "rate_limit", details: "Rate limit exceeded" },
      message: "Too Many Requests",
    };
    const out = categorizeClassificationError(err);
    expect(out.category).toBe("rate_limited");
    expect(out.reason).toMatch(/rate-limited/i);
    expect(out.reason).toMatch(/try again/i);
  });

  it("falls back to 'other' for a generic error and truncates to one line", () => {
    const err = new Error("Network connection lost\nstack trace line 1\nstack trace line 2");
    const out = categorizeClassificationError(err);
    expect(out.category).toBe("other");
    expect(out.reason.startsWith("Classification unavailable — ")).toBe(true);
    expect(out.reason).toContain("Network connection lost");
    expect(out.reason).not.toContain("\n");
    expect(out.reason).not.toContain("stack trace");
  });

  it("handles a completely unknown thrown value without throwing", () => {
    const out = categorizeClassificationError(undefined);
    expect(out.category).toBe("other");
    expect(out.reason).toContain("Classification failed");
  });
});
