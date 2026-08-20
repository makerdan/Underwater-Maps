// @vitest-environment node
/**
 * Regression tests: both Vite configs (bathyscan and mockup-sandbox) must
 * load cleanly without preview-only environment variables, while still
 * rejecting invalid PORT overrides.
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
const savedNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.resetModules();
  delete process.env.PORT;
  delete process.env.BASE_PATH;
  process.env.NODE_ENV = "production";
});

afterAll(() => {
  if (savedPort === undefined) delete process.env.PORT;
  else process.env.PORT = savedPort;
  if (savedBasePath === undefined) delete process.env.BASE_PATH;
  else process.env.BASE_PATH = savedBasePath;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

describe.each([
  ["bathyscan", bathyscanConfig, 23993, "/"],
  ["mockup-sandbox", mockupConfig, 8081, "/__mockup"],
])("%s vite.config.ts", (_name, configPath, expectedPort, expectedBase) => {
  it("uses the artifact defaults when preview variables are absent", async () => {
    const { default: config } = await import(/* @vite-ignore */ configPath);
    expect(config.base).toBe(expectedBase);
    expect(config.server?.port).toBe(expectedPort);
    expect(config.preview?.port).toBe(expectedPort);
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

describe("normalizePwaBasePath", () => {
  async function normalize(basePath: string | undefined): Promise<string> {
    if (basePath === undefined) delete process.env.BASE_PATH;
    else process.env.BASE_PATH = basePath;
    vi.resetModules();
    const { normalizePwaBasePath } = await import(/* @vite-ignore */ bathyscanConfig);
    return normalizePwaBasePath(basePath);
  }

  it.each([
    [undefined, "/"],
    ["/", "/"],
    ["/bathyscan", "/bathyscan/"],
    ["/bathyscan/", "/bathyscan/"],
  ])("normalizes %j to %j", async (input, expected) => {
    await expect(normalize(input)).resolves.toBe(expected);
  });

  it("rejects paths that could generate an off-origin worker URL", async () => {
    await expect(normalize("//other-origin")).rejects.toThrow(/single-origin path/i);
  });
});
