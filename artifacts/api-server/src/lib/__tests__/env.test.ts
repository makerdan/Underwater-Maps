/**
 * env.test.ts — startup env validation regression tests.
 *
 * Guards against silent NaN behaviour from malformed numeric env vars and
 * malformed ADMIN_USER_IDS / ALLOWED_ORIGINS lists slipping through unnoticed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock("../logger.js", () => ({
  logger: {
    warn: mockWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { parsePositiveIntEnv, validateStartupEnv } from "../env.js";

beforeEach(() => {
  mockWarn.mockClear();
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
});
