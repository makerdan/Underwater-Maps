/**
 * clerkProxyMiddleware.test.ts
 *
 * Tests for getClerkProxyHost() and buildTrustedHostSet():
 *   - Trusted x-forwarded-host is returned as-is.
 *   - Untrusted x-forwarded-host falls back to req.headers.host.
 *   - Multi-value and comma-delimited x-forwarded-host handled correctly.
 *   - Trusted set is built from ALLOWED_ORIGINS, REPLIT_DEV_DOMAIN, and Host.
 *   - No x-forwarded-host → returns Host header directly.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getClerkProxyHost,
  buildTrustedHostSet,
} from "../clerkProxyMiddleware.js";

// Snapshot and restore env around each test.
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    ALLOWED_ORIGINS: process.env["ALLOWED_ORIGINS"],
    REPLIT_DEV_DOMAIN: process.env["REPLIT_DEV_DOMAIN"],
  };
  delete process.env["ALLOWED_ORIGINS"];
  delete process.env["REPLIT_DEV_DOMAIN"];
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
});

// ── buildTrustedHostSet ────────────────────────────────────────────────────────

describe("buildTrustedHostSet", () => {
  it("includes the req host (port stripped)", () => {
    const set = buildTrustedHostSet("myserver.example.com:3000");
    expect(set.has("myserver.example.com")).toBe(true);
  });

  it("includes hostnames from ALLOWED_ORIGINS", () => {
    process.env["ALLOWED_ORIGINS"] =
      "https://app.example.com,https://other.example.org:8080";
    const set = buildTrustedHostSet(undefined);
    expect(set.has("app.example.com")).toBe(true);
    expect(set.has("other.example.org")).toBe(true);
  });

  it("includes REPLIT_DEV_DOMAIN", () => {
    process.env["REPLIT_DEV_DOMAIN"] = "abc123.replit.dev";
    const set = buildTrustedHostSet(undefined);
    expect(set.has("abc123.replit.dev")).toBe(true);
  });

  it("ignores malformed ALLOWED_ORIGINS entries silently", () => {
    process.env["ALLOWED_ORIGINS"] = "not-a-url,,https://good.example.com";
    const set = buildTrustedHostSet(undefined);
    expect(set.has("good.example.com")).toBe(true);
    // malformed entry should not throw and should not be in the set
    expect(set.has("not-a-url")).toBe(false);
  });

  it("returns empty set when no sources are provided", () => {
    const set = buildTrustedHostSet(undefined);
    expect(set.size).toBe(0);
  });
});

// ── getClerkProxyHost ──────────────────────────────────────────────────────────

describe("getClerkProxyHost", () => {
  it("returns host header when no x-forwarded-host is present", () => {
    const result = getClerkProxyHost({
      headers: { host: "internal.local" },
    });
    expect(result).toBe("internal.local");
  });

  it("returns trusted x-forwarded-host (matches ALLOWED_ORIGINS)", () => {
    process.env["ALLOWED_ORIGINS"] = "https://trusted.example.com";
    const result = getClerkProxyHost({
      headers: {
        host: "internal.local",
        "x-forwarded-host": "trusted.example.com",
      },
    });
    expect(result).toBe("trusted.example.com");
  });

  it("returns trusted x-forwarded-host (matches REPLIT_DEV_DOMAIN)", () => {
    process.env["REPLIT_DEV_DOMAIN"] = "abc123.replit.dev";
    const result = getClerkProxyHost({
      headers: {
        host: "internal.local",
        "x-forwarded-host": "abc123.replit.dev",
      },
    });
    expect(result).toBe("abc123.replit.dev");
  });

  it("returns trusted x-forwarded-host when it matches the server Host header", () => {
    const result = getClerkProxyHost({
      headers: {
        host: "myapp.replit.app",
        "x-forwarded-host": "myapp.replit.app",
      },
    });
    expect(result).toBe("myapp.replit.app");
  });

  it("falls back to Host header when x-forwarded-host is NOT trusted (injection protection)", () => {
    // No ALLOWED_ORIGINS, no REPLIT_DEV_DOMAIN — only server host is trusted.
    const result = getClerkProxyHost({
      headers: {
        host: "legitimate.example.com",
        "x-forwarded-host": "attacker-controlled.evil.com",
      },
    });
    // Must NOT return the attacker host.
    expect(result).toBe("legitimate.example.com");
    expect(result).not.toBe("attacker-controlled.evil.com");
  });

  it("falls back to Host header for untrusted host even with ALLOWED_ORIGINS set", () => {
    process.env["ALLOWED_ORIGINS"] = "https://trusted.example.com";
    const result = getClerkProxyHost({
      headers: {
        host: "legitimate.example.com",
        "x-forwarded-host": "evil.com",
      },
    });
    expect(result).toBe("legitimate.example.com");
  });

  it("takes the leftmost entry from a comma-delimited x-forwarded-host", () => {
    process.env["ALLOWED_ORIGINS"] = "https://original.example.com";
    const result = getClerkProxyHost({
      headers: {
        host: "internal.local",
        "x-forwarded-host": "original.example.com, proxy.internal",
      },
    });
    expect(result).toBe("original.example.com");
  });

  it("takes the first entry from an array x-forwarded-host", () => {
    process.env["ALLOWED_ORIGINS"] = "https://original.example.com";
    const result = getClerkProxyHost({
      headers: {
        host: "internal.local",
        "x-forwarded-host": ["original.example.com", "proxy.internal"],
      },
    });
    expect(result).toBe("original.example.com");
  });

  it("falls back for untrusted array x-forwarded-host", () => {
    const result = getClerkProxyHost({
      headers: {
        host: "legitimate.example.com",
        "x-forwarded-host": ["evil.com", "proxy.internal"],
      },
    });
    expect(result).toBe("legitimate.example.com");
  });

  it("returns undefined when both x-forwarded-host and host are absent", () => {
    const result = getClerkProxyHost({ headers: {} });
    expect(result).toBeUndefined();
  });

  it("handles host header with port in the trusted-host comparison", () => {
    // The server Host includes a port; the forwarded-host should still be recognised as trusted.
    const result = getClerkProxyHost({
      headers: {
        host: "myapp.example.com:3000",
        "x-forwarded-host": "myapp.example.com",
      },
    });
    expect(result).toBe("myapp.example.com");
  });
});
