// @vitest-environment node
/**
 * The API app must be importable when OpenAI fallback credentials are absent.
 * The OpenAI integration is intentionally lazy because Poe is the primary
 * provider and many deployments do not configure an OpenAI fallback.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

describe("API startup without OpenAI credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("imports the server app without throwing when all OpenAI vars are unset", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.stubEnv("OPENAI_CLASSIFY_MODEL", "");
    vi.stubEnv("OPENAI_HELP_MODEL", "");
    vi.stubEnv("OPENAI_QUERY_MODEL", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ADMIN_USER_IDS", "");
    vi.stubEnv("BUCKET_MONITOR_ADMIN", "");
    vi.stubEnv("REPLIT_DEPLOYMENT", "");

    vi.resetModules();
    await expect(import("../app.js")).resolves.toMatchObject({
      default: expect.anything(),
    });
  });
});