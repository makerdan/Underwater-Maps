import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generator-hash drift check for every substrate bundle consumed by
 * `artifacts/api-server/src/lib/shoreZoneData.ts`.
 *
 * Each builder under `scripts/src/build-*-substrate.ts` (and the Alaska
 * ShoreZone builder) hashes its own source file with SHA-256 and embeds
 * the digest in the produced bundle's `metadata.generatorHash`. This
 * test recomputes the hash on every run and fails — with a clear
 * "re-run the builder" message — whenever the committed JSON disagrees
 * with the current builder source, which is how we detect a stale
 * bundle that needs to be regenerated.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");

interface BundleCase {
  /** Short name used in test descriptions. */
  name: string;
  /** Builder source whose SHA-256 is the source of truth. */
  builderPath: string;
  /** Generated JSON bundle to verify. */
  bundlePath: string;
  /** pnpm script the operator should run to refresh the bundle. */
  refreshCommand: string;
}

const CASES: BundleCase[] = [
  {
    name: "Alaska ShoreZone (shoreZoneData.alaska.gen.json)",
    builderPath: "scripts/src/build-shorezone-data.ts",
    bundlePath: "artifacts/api-server/src/lib/shoreZoneData.alaska.gen.json",
    refreshCommand: "pnpm --filter @workspace/scripts run build-shorezone",
  },
  {
    name: "SE Alaska NOAA ENC (encSubstrateData.alaska.gen.json)",
    builderPath: "scripts/src/build-enc-substrate.ts",
    bundlePath: "artifacts/api-server/src/lib/encSubstrateData.alaska.gen.json",
    refreshCommand: "pnpm --filter @workspace/scripts run build-enc-substrate",
  },
  {
    name: "CONUS NOAA ENC (usSeabedSubstrate.gen.json)",
    builderPath: "scripts/src/build-usseabed-substrate.ts",
    bundlePath: "artifacts/api-server/src/lib/usSeabedSubstrate.gen.json",
    refreshCommand:
      "pnpm --filter @workspace/scripts run build-usseabed-substrate",
  },
  {
    name: "Texas reservoirs (txLakeSubstrate.gen.json)",
    builderPath: "scripts/src/build-tx-lake-substrate.ts",
    bundlePath: "artifacts/api-server/src/lib/txLakeSubstrate.gen.json",
    refreshCommand:
      "pnpm --filter @workspace/scripts run build-tx-lake-substrate",
  },
];

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("substrate bundle generator hashes", () => {
  for (const c of CASES) {
    it(`${c.name} matches its builder source SHA-256`, () => {
      const builderAbs = resolve(REPO_ROOT, c.builderPath);
      const bundleAbs = resolve(REPO_ROOT, c.bundlePath);

      const expected = sha256File(builderAbs);
      const bundle = JSON.parse(readFileSync(bundleAbs, "utf8")) as {
        metadata?: { generatorHash?: unknown };
      };
      const recorded = bundle.metadata?.generatorHash;

      if (recorded !== expected) {
        throw new Error(
          `Generator-hash drift for ${c.bundlePath}: ` +
            `bundle records "${String(recorded)}" but ${c.builderPath} ` +
            `currently hashes to "${expected}". ` +
            `Re-run the builder to refresh the bundle: ${c.refreshCommand}`,
        );
      }
      expect(recorded).toBe(expected);
    });
  }
});
