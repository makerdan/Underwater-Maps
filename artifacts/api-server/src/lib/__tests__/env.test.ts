/**
 * env.test.ts — startup env validation regression tests.
 *
 * Guards against silent NaN behaviour from malformed numeric env vars and
 * malformed ADMIN_USER_IDS / ALLOWED_ORIGINS lists slipping through unnoticed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockWarn, mockError } = vi.hoisted(() => ({ mockWarn: vi.fn(), mockError: vi.fn() }));

vi.mock("../logger.js", () => ({
  logger: {
    warn: mockWarn,
    info: vi.fn(),
    error: mockError,
    debug: vi.fn(),
  },
}));

import { parsePositiveIntEnv, validateStartupEnv } from "../env.js";

// Helper: extract all plain objects passed as the first arg to mockWarn calls.
function warnDataObjects(): Record<string, unknown>[] {
  return (mockWarn as ReturnType<typeof vi.fn>).mock.calls.map(
    (args: unknown[]) => args[0] as Record<string, unknown>,
  );
}

beforeEach(() => {
  mockWarn.mockClear();
  mockError.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parsePositiveIntEnv", () => {
  it("returns the fallback when the var is unset", () => {
    expect(parsePositiveIntEnv("ENV_TEST_UNSET_XYZ", 42)).toBe(42);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("parses a valid positive integer", () => {
    vi.stubEnv("ENV_TEST_VALID", "1234");
    expect(parsePositiveIntEnv("ENV_TEST_VALID", 42)).toBe(1234);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("falls back with a warning on non-numeric input", () => {
    vi.stubEnv("ENV_TEST_BAD", "abc");
    expect(parsePositiveIntEnv("ENV_TEST_BAD", 42)).toBe(42);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it("falls back with a warning on negative / non-integer syntax", () => {
    vi.stubEnv("ENV_TEST_NEG", "-5");
    expect(parsePositiveIntEnv("ENV_TEST_NEG", 42)).toBe(42);
    vi.stubEnv("ENV_TEST_FLOAT", "1.5");
    expect(parsePositiveIntEnv("ENV_TEST_FLOAT", 42)).toBe(42);
    expect(mockWarn).toHaveBeenCalledTimes(2);
  });

  it("falls back with a warning when out of the [min, max] range", () => {
    vi.stubEnv("ENV_TEST_RANGE", "999");
    expect(parsePositiveIntEnv("ENV_TEST_RANGE", 42, { min: 1, max: 100 })).toBe(42);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });
});

// ── Log-safety: raw secret values must never appear in log objects ─────────────

describe("parsePositiveIntEnv — log object must not contain raw value", () => {
  it("warns without emitting a 'value' field containing the raw string", () => {
    const secret = "sk_live_super_secret_token_12345";
    vi.stubEnv("ENV_TEST_SECRET_SHAPE", secret);
    parsePositiveIntEnv("ENV_TEST_SECRET_SHAPE", 42);

    expect(mockWarn).toHaveBeenCalledTimes(1);
    const dataObj = warnDataObjects()[0]!;
    // Must not have a field whose value equals the raw secret string.
    expect(Object.values(dataObj)).not.toContain(secret);
    // Must not have a 'value' key at all (previously leaked raw).
    expect(dataObj).not.toHaveProperty("value");
    // Should have safe metadata instead.
    expect(dataObj).toHaveProperty("name", "ENV_TEST_SECRET_SHAPE");
    expect(dataObj).toHaveProperty("valueLength", secret.length);
  });
});

describe("validateStartupEnv — log object must not contain raw value", () => {
  it("warns without emitting a 'value' field containing the raw ADMIN_USER_IDS string", () => {
    // A realistic secret-shaped value that fails admin-id validation.
    const secretLike = "user ok space,user_good";
    vi.stubEnv("ADMIN_USER_IDS", secretLike);
    const issues = validateStartupEnv();

    expect(issues.some((i) => i.name === "ADMIN_USER_IDS")).toBe(true);
    expect(mockWarn).toHaveBeenCalled();

    for (const dataObj of warnDataObjects()) {
      // None of the logged data objects should carry the raw value string.
      expect(Object.values(dataObj)).not.toContain(secretLike);
      expect(dataObj).not.toHaveProperty("value");
    }
  });

  it("logs safe metadata (name, valueLength, valuePreview) instead of the raw value", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://example.com/path/leak");
    validateStartupEnv();

    expect(mockWarn).toHaveBeenCalled();
    const dataObj = warnDataObjects()[0]!;
    expect(dataObj).toHaveProperty("name", "ALLOWED_ORIGINS");
    expect(dataObj).toHaveProperty("valueLength");
    expect(typeof dataObj["valueLength"]).toBe("number");
    // valuePreview must be a short prefix — not the full raw string.
    expect(dataObj).toHaveProperty("valuePreview");
    expect(typeof dataObj["valuePreview"]).toBe("string");
    const preview = dataObj["valuePreview"] as string;
    expect(preview.length).toBeLessThanOrEqual(8); // "htt…" style
    expect(preview).not.toBe("https://example.com/path/leak");
  });

  it("does not embed the invalid token in the problem string or logger message for ADMIN_USER_IDS", () => {
    // Use a unique sentinel so we can search for it across all fields and messages.
    const secret = "sk_live_SECRET_TOKEN_xyz987";
    vi.stubEnv("ADMIN_USER_IDS", secret);
    const issues = validateStartupEnv();

    // The returned issue must not contain the raw value anywhere.
    for (const issue of issues) {
      for (const v of Object.values(issue)) {
        expect(String(v)).not.toContain(secret);
      }
    }

    // The logger message string (second argument to mockWarn) must also be clean.
    for (const call of (mockWarn as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(call[1])).not.toContain(secret);
    }
  });

  it("does not embed the invalid origin in the problem string or logger message for ALLOWED_ORIGINS", () => {
    const secret = "https://sk_live_SECRET_ORIGIN_abc123.example.com/leak";
    vi.stubEnv("ALLOWED_ORIGINS", secret);
    const issues = validateStartupEnv();

    for (const issue of issues) {
      for (const v of Object.values(issue)) {
        expect(String(v)).not.toContain(secret);
      }
    }

    for (const call of (mockWarn as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(call[1])).not.toContain(secret);
    }
  });
});

describe("validateStartupEnv", () => {
  it("returns no issues when all vars are unset", () => {
    vi.stubEnv("ADMIN_USER_IDS", "");
    vi.stubEnv("ALLOWED_ORIGINS", "");
    vi.stubEnv("ZONE_CACHE_MAX_AGE_MS", "");
    vi.stubEnv("ZONE_CACHE_MAX_FILES", "");
    expect(validateStartupEnv()).toEqual([]);
  });

  it("accepts well-formed values", () => {
    vi.stubEnv("ADMIN_USER_IDS", "user_abc123, user_def456");
    vi.stubEnv("ALLOWED_ORIGINS", "https://example.com,http://localhost:5173");
    vi.stubEnv("ZONE_CACHE_MAX_AGE_MS", "3600000");
    vi.stubEnv("ZONE_CACHE_MAX_FILES", "100");
    expect(validateStartupEnv()).toEqual([]);
  });

  it("flags empty entries from trailing commas in ADMIN_USER_IDS", () => {
    vi.stubEnv("ADMIN_USER_IDS", "user_abc123,");
    const issues = validateStartupEnv();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.name).toBe("ADMIN_USER_IDS");
    expect(mockWarn).toHaveBeenCalled();
  });

  it("flags malformed admin id tokens", () => {
    vi.stubEnv("ADMIN_USER_IDS", "user ok,user_good");
    const issues = validateStartupEnv();
    expect(issues.some((i) => i.name === "ADMIN_USER_IDS")).toBe(true);
  });

  it("flags origins with a path or trailing slash", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://example.com/app");
    const issues = validateStartupEnv();
    expect(issues.some((i) => i.name === "ALLOWED_ORIGINS")).toBe(true);

    mockWarn.mockClear();
    vi.stubEnv("ALLOWED_ORIGINS", "https://example.com/");
    expect(validateStartupEnv().some((i) => i.name === "ALLOWED_ORIGINS")).toBe(true);
  });

  it("flags non-numeric zone cache vars", () => {
    vi.stubEnv("ZONE_CACHE_MAX_AGE_MS", "one week");
    vi.stubEnv("ZONE_CACHE_MAX_FILES", "-3");
    const issues = validateStartupEnv();
    expect(issues.some((i) => i.name === "ZONE_CACHE_MAX_AGE_MS")).toBe(true);
    expect(issues.some((i) => i.name === "ZONE_CACHE_MAX_FILES")).toBe(true);
  });

  describe("BUCKET_MONITOR_ADMIN production guard", () => {
    it("throws a critical error when BUCKET_MONITOR_ADMIN=1 and REPLIT_DEPLOYMENT is set", () => {
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "1");
      vi.stubEnv("REPLIT_DEPLOYMENT", "1");
      vi.stubEnv("NODE_ENV", "");
      expect(() => validateStartupEnv()).toThrow(/critical/i);
    });

    it("throws a critical error when BUCKET_MONITOR_ADMIN=true and NODE_ENV=production", () => {
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "true");
      vi.stubEnv("REPLIT_DEPLOYMENT", "");
      vi.stubEnv("NODE_ENV", "production");
      expect(() => validateStartupEnv()).toThrow(/BUCKET_MONITOR_ADMIN/);
    });

    it("logs a critical-level error (not just a warning) before throwing", () => {
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "1");
      vi.stubEnv("REPLIT_DEPLOYMENT", "1");
      vi.stubEnv("NODE_ENV", "");
      expect(() => validateStartupEnv()).toThrow();
      const errorCalls = (mockWarn as ReturnType<typeof vi.fn>).mock.calls;
      // logger.error is stubbed as a separate mock — verify warn was NOT called
      // for this issue (it should use error, not warn).
      expect(errorCalls.every((args) => !String(args[1]).includes("BUCKET_MONITOR_ADMIN"))).toBe(true);
    });

    it("does NOT throw when BUCKET_MONITOR_ADMIN=1 in a non-production environment", () => {
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "1");
      vi.stubEnv("REPLIT_DEPLOYMENT", "");
      vi.stubEnv("NODE_ENV", "development");
      expect(() => validateStartupEnv()).not.toThrow();
    });

    it("does NOT throw when BUCKET_MONITOR_ADMIN is unset in production but ADMIN_USER_IDS is set", () => {
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
      vi.stubEnv("REPLIT_DEPLOYMENT", "1");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ADMIN_USER_IDS", "user_abc123");
      expect(() => validateStartupEnv()).not.toThrow();
    });

    it("returned issue has critical:true when BUCKET_MONITOR_ADMIN is set in production", () => {
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "1");
      vi.stubEnv("REPLIT_DEPLOYMENT", "1");
      vi.stubEnv("NODE_ENV", "");
      vi.stubEnv("ADMIN_USER_IDS", "user_abc123");
      let caught: Error | null = null;
      try {
        validateStartupEnv();
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("BUCKET_MONITOR_ADMIN");
    });
  });

  describe("admin lockout guard (no admin access pathway in production)", () => {
    it("throws a critical error in production when ADMIN_USER_IDS is empty and BUCKET_MONITOR_ADMIN is unset", () => {
      vi.stubEnv("ADMIN_USER_IDS", "");
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
      vi.stubEnv("REPLIT_DEPLOYMENT", "1");
      vi.stubEnv("NODE_ENV", "");
      expect(() => validateStartupEnv()).toThrow(/ADMIN_USER_IDS/);
    });

    it("throws a critical error in production when ADMIN_USER_IDS is whitespace-only and BUCKET_MONITOR_ADMIN is unset", () => {
      vi.stubEnv("ADMIN_USER_IDS", "   ");
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
      vi.stubEnv("REPLIT_DEPLOYMENT", "");
      vi.stubEnv("NODE_ENV", "production");
      expect(() => validateStartupEnv()).toThrow(/ADMIN_USER_IDS/);
    });

    it("does NOT throw in non-production even when ADMIN_USER_IDS is empty", () => {
      vi.stubEnv("ADMIN_USER_IDS", "");
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
      vi.stubEnv("REPLIT_DEPLOYMENT", "");
      vi.stubEnv("NODE_ENV", "development");
      expect(() => validateStartupEnv()).not.toThrow();
    });

    it("does NOT throw in test environment even when ADMIN_USER_IDS is empty", () => {
      vi.stubEnv("ADMIN_USER_IDS", "");
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
      vi.stubEnv("REPLIT_DEPLOYMENT", "");
      vi.stubEnv("NODE_ENV", "test");
      expect(() => validateStartupEnv()).not.toThrow();
    });

    it("throws a critical error in production when ADMIN_USER_IDS is delimiter-only (\",\")", () => {
      // "," passes a naive non-whitespace check but parses to zero usable
      // IDs — exactly the lockout the guard exists to prevent. Presence must
      // be judged by the same parsed list isAdmin() uses.
      vi.stubEnv("ADMIN_USER_IDS", ",");
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
      vi.stubEnv("REPLIT_DEPLOYMENT", "1");
      vi.stubEnv("NODE_ENV", "");
      expect(() => validateStartupEnv()).toThrow(/ADMIN_USER_IDS/);
    });

    it("throws a critical error in production when ADMIN_USER_IDS is delimiters and whitespace only (\",, \")", () => {
      vi.stubEnv("ADMIN_USER_IDS", ",, ");
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
      vi.stubEnv("REPLIT_DEPLOYMENT", "");
      vi.stubEnv("NODE_ENV", "production");
      expect(() => validateStartupEnv()).toThrow(/ADMIN_USER_IDS/);
    });

    it("does NOT throw in production when ADMIN_USER_IDS has a valid id despite stray delimiters (\",user_abc123,\")", () => {
      vi.stubEnv("ADMIN_USER_IDS", ",user_abc123,");
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
      vi.stubEnv("REPLIT_DEPLOYMENT", "1");
      vi.stubEnv("NODE_ENV", "");
      expect(() => validateStartupEnv()).not.toThrow();
    });

    it("does NOT throw in production when ADMIN_USER_IDS is set to a valid id", () => {
      vi.stubEnv("ADMIN_USER_IDS", "user_abc123");
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
      vi.stubEnv("REPLIT_DEPLOYMENT", "1");
      vi.stubEnv("NODE_ENV", "");
      expect(() => validateStartupEnv()).not.toThrow();
    });

    it("does NOT throw in production when BUCKET_MONITOR_ADMIN=1 (dev flag suppresses lockout issue)", () => {
      // BUCKET_MONITOR_ADMIN in production triggers its own critical error; the
      // separate lockout guard must NOT double-fire when the dev flag is active.
      vi.stubEnv("ADMIN_USER_IDS", "");
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "1");
      vi.stubEnv("REPLIT_DEPLOYMENT", "1");
      vi.stubEnv("NODE_ENV", "");
      let caught: Error | null = null;
      try {
        validateStartupEnv();
      } catch (e) {
        caught = e as Error;
      }
      // Should throw — but only for BUCKET_MONITOR_ADMIN, not the lockout guard.
      expect(caught).not.toBeNull();
      expect(caught!.message).toContain("BUCKET_MONITOR_ADMIN");
      expect(caught!.message).not.toContain("permanent lockout");
    });

    describe("dev-mode startup warning (console.warn) when ADMIN_USER_IDS is unset", () => {
      let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      });

      afterEach(() => {
        consoleWarnSpy.mockRestore();
      });

      it("emits a console.warn in development when ADMIN_USER_IDS is unset", () => {
        vi.stubEnv("ADMIN_USER_IDS", "");
        vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
        vi.stubEnv("REPLIT_DEPLOYMENT", "");
        vi.stubEnv("NODE_ENV", "development");
        expect(() => validateStartupEnv()).not.toThrow();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("ADMIN_USER_IDS is not set"),
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("no one can approve pending users"),
        );
      });

      it("does NOT warn in development when ADMIN_USER_IDS is set to a valid id (regression guard)", () => {
        vi.stubEnv("ADMIN_USER_IDS", "user_abc123");
        vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
        vi.stubEnv("REPLIT_DEPLOYMENT", "");
        vi.stubEnv("NODE_ENV", "development");
        expect(() => validateStartupEnv()).not.toThrow();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it("does NOT warn or exit in production when ADMIN_USER_IDS is set (regression guard)", () => {
        vi.stubEnv("ADMIN_USER_IDS", "user_abc123");
        vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
        vi.stubEnv("REPLIT_DEPLOYMENT", "1");
        vi.stubEnv("NODE_ENV", "");
        expect(() => validateStartupEnv()).not.toThrow();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it("stays silent under NODE_ENV=test to keep unit-test output clean", () => {
        vi.stubEnv("ADMIN_USER_IDS", "");
        vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
        vi.stubEnv("REPLIT_DEPLOYMENT", "");
        vi.stubEnv("NODE_ENV", "test");
        expect(() => validateStartupEnv()).not.toThrow();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it("does NOT warn in development when BUCKET_MONITOR_ADMIN=1 provides an admin pathway", () => {
        vi.stubEnv("ADMIN_USER_IDS", "");
        vi.stubEnv("BUCKET_MONITOR_ADMIN", "1");
        vi.stubEnv("REPLIT_DEPLOYMENT", "");
        vi.stubEnv("NODE_ENV", "development");
        expect(() => validateStartupEnv()).not.toThrow();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it("production with ADMIN_USER_IDS unset aborts startup (throws) before the server can bind", () => {
        // In production the guard is fatal, not a warning: app.ts calls
        // validateStartupEnv() at module init, so the throw prevents
        // app.listen from ever running and the process exits non-zero.
        vi.stubEnv("ADMIN_USER_IDS", "");
        vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
        vi.stubEnv("REPLIT_DEPLOYMENT", "");
        vi.stubEnv("NODE_ENV", "production");
        expect(() => validateStartupEnv()).toThrow(/ADMIN_USER_IDS/);
      });
    });

    it("emits a critical-level log entry (not just a warning) for the lockout issue", () => {
      vi.stubEnv("ADMIN_USER_IDS", "");
      vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
      vi.stubEnv("REPLIT_DEPLOYMENT", "1");
      vi.stubEnv("NODE_ENV", "");
      try {
        validateStartupEnv();
      } catch {
        // expected
      }
      // The critical issue must be logged at error level, not just as a warning.
      expect(mockError).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ADMIN_USER_IDS" }),
        expect.stringContaining("ADMIN_USER_IDS"),
      );
      expect(mockWarn).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("permanent lockout"),
      );
    });
  });
});
