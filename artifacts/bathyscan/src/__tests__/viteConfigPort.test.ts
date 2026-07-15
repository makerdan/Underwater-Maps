// @vitest-environment node
/**
 * Regression tests: both Vite configs (bathyscan and mockup-sandbox) must
 * fail fast with a clear error when PORT is missing or invalid — no
 * fallback values anywhere.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import path from "path";

const bathyscanConfig = path.resolve(__dirname, "..", "..", "vite.config.ts");
const mockupConfig = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "mockup-sandbox",
  "vite.config.ts",
);

const savedPort = process.env.PORT;
const savedBasePath = process.env.BASE_PATH;

beforeEach(() => {
  vi.resetModules();
  process.env.BASE_PATH = "/";
});

afterAll(() => {
  if (savedPort === undefined) delete process.env.PORT;
  else process.env.PORT = savedPort;
  if (savedBasePath === undefined) delete process.env.BASE_PATH;
  else process.env.BASE_PATH = savedBasePath;
});

describe.each([
  ["bathyscan", bathyscanConfig],
  ["mockup-sandbox", mockupConfig],
])("%s vite.config.ts", (_name, configPath) => {
  it("throws a clear error when PORT is missing", async () => {
    delete process.env.PORT;
    await expect(import(/* @vite-ignore */ configPath)).rejects.toThrow(
      /PORT environment variable is required/,
    );
  }, 60_000);

  it("throws a clear error when PORT is not a number", async () => {
    process.env.PORT = "not-a-port";
    await expect(import(/* @vite-ignore */ configPath)).rejects.toThrow(
      /Invalid PORT value: "not-a-port"/,
    );
  }, 60_000);

  it("throws a clear error when PORT is zero or negative", async () => {
    process.env.PORT = "0";
    await expect(import(/* @vite-ignore */ configPath)).rejects.toThrow(
      /Invalid PORT value: "0"/,
    );
  }, 60_000);
});
