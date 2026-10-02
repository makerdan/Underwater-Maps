// @vitest-environment node
/**
 * Build-contract regression for the parser worker.
 *
 * build.mjs emits both index.mjs and lib/parseWorker.mjs into DIST_DIR. The
 * terrain service must resolve that sibling worker in both the regular and
 * dist-e2e layouts, rather than resolving it relative to the source module's
 * directory.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";

const artifactDir = path.resolve(__dirname, "..", "..");

function runEmittedWorker(workerPath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: {
        filePath: "",
        fileName: "worker-test.xyz",
        resolution: 8,
        gridId: "worker-build-test",
        datasetName: "worker build test",
        smoothing: false,
        prePoints: Array.from({ length: 10 }, (_, index) => ({
          lon: index,
          lat: index % 2,
          depth: index + 1,
        })),
      },
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => undefined);
      fn();
    };

    worker.on("message", (message) => {
      if (message?.type === "result") finish(() => resolve(message));
      if (message?.type === "error") {
        finish(() => reject(new Error(message.message)));
      }
    });
    worker.on("error", (error) => finish(() => reject(error)));
    worker.on("exit", (code) => {
      if (code !== 0) {
        finish(() => reject(new Error(`worker exited with code ${code}`)));
      }
    });
  });
}

describe("emitted parser worker build contract", () => {
  for (const distName of ["dist", "dist-e2e"]) {
    it(`resolves and starts the worker from ${distName}`, async () => {
      execFileSync(process.execPath, [path.join(artifactDir, "build.mjs")], {
        cwd: artifactDir,
        env: { ...process.env, DIST_DIR: distName },
        stdio: "pipe",
        timeout: 120_000,
      });

      const workerPath = path.join(artifactDir, distName, "lib", "parseWorker.mjs");
      expect(fs.existsSync(workerPath)).toBe(true);
      const result = await runEmittedWorker(workerPath) as {
        type: string;
        terrain: { width: number };
        overview: { width: number };
      };
      expect(result.type).toBe("result");
      expect(result.terrain.width).toBe(32);
      expect(result.overview.width).toBe(64);
    }, 150_000);
  }
});