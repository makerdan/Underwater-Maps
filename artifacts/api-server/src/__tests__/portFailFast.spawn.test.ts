// @vitest-environment node
/**
 * Regression tests for the api-server's port handling:
 *
 *  1. Fails fast with a clear error when PORT is missing.
 *  2. Fails fast with a clear error when PORT is invalid.
 *  3. Exits with an error on EADDRINUSE instead of silently rebinding to a
 *     neighboring port (the old behavior drifted to port + 1, which could
 *     collide with another artifact's platform-assigned port).
 *
 * Each test spawns the real built server (dist-porttest/, built once in
 * beforeAll so it never races the dev workflow's dist/ or the E2E suite's
 * dist-e2e/).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";

const artifactDir = path.resolve(__dirname, "..", "..");
const distDir = path.join(artifactDir, "dist-porttest");
const serverEntry = path.join(distDir, "index.mjs");

function makeEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["PORT"];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

function runServer(
  env: NodeJS.ProcessEnv,
  timeoutMs = 30_000,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverEntry], { env });
    let output = "";
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `Server did not exit within ${timeoutMs}ms (it likely bound a port instead of failing).\nOutput:\n${output}`,
        ),
      );
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function occupyPort(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const blocker = net.createServer();
    blocker.on("error", reject);
    blocker.listen(0, "127.0.0.1", () => {
      const addr = blocker.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("Unexpected blocker address"));
        return;
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res) => {
            blocker.close(() => res());
          }),
      });
    });
  });
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

describe("api-server port fail-fast behavior", () => {
  beforeAll(() => {
    execFileSync(process.execPath, [path.join(artifactDir, "build.mjs")], {
      cwd: artifactDir,
      env: { ...process.env, DIST_DIR: "dist-porttest" },
      stdio: "pipe",
      timeout: 120_000,
    });
    expect(fs.existsSync(serverEntry)).toBe(true);
  }, 150_000);

  it("exits with a clear error when PORT is missing", async () => {
    const { code, output } = await runServer(makeEnv({ PORT: undefined }));
    expect(code).not.toBe(0);
    expect(output).toContain("PORT environment variable is required");
  }, 60_000);

  it("exits with a clear error when PORT is invalid", async () => {
    const { code, output } = await runServer(makeEnv({ PORT: "not-a-port" }));
    expect(code).not.toBe(0);
    expect(output).toContain('Invalid PORT value: "not-a-port"');
  }, 60_000);

  it("exits on EADDRINUSE instead of rebinding to a neighboring port", async () => {
    const blocker = await occupyPort();
    try {
      const { code, output } = await runServer(
        makeEnv({ PORT: String(blocker.port) }),
      );
      expect(code).toBe(1);
      expect(output).toContain("already in use");
      expect(output).toContain("refusing to rebind");
      // The old behavior drifted to port + 1 — assert nothing is listening
      // there after the server exits.
      expect(await isPortListening(blocker.port + 1)).toBe(false);
    } finally {
      await blocker.close();
    }
  }, 60_000);
});
