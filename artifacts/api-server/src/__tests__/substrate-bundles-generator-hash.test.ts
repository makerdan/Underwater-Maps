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
  /** Builder source(s) whose SHA-256 is the source of truth. When more
   *  than one path is given, the digest is computed over the
   *  concatenation in array order — used when a thin spec wrapper
   *  delegates to a shared pipeline module and we want either file's
   *  edits to trip the drift check. */
  builderPath: string | string[];
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
  {
    name: "Lake Ray Roberts terrain (lakeRayRobertsTerrain.gen.json)",
    // Thin wrapper delegates to the shared Texas-reservoir pipeline; hash
    // both so an edit to either trips the drift check.
    builderPath: [
      "scripts/src/build-lake-ray-roberts-terrain.ts",
      "scripts/src/lib/texas-reservoir-terrain.ts",
    ],
    bundlePath: "artifacts/api-server/src/lib/lakeRayRobertsTerrain.gen.json",
    refreshCommand:
      "pnpm --filter @workspace/scripts run build-lake-ray-roberts-terrain",
  },
  {
    name: "TX freshwater EFH (txFreshwaterEfhData.gen.json)",
    builderPath: "scripts/src/build-tx-freshwater-efh.ts",
    bundlePath: "artifacts/api-server/src/lib/txFreshwaterEfhData.gen.json",
    refreshCommand:
      "pnpm --filter @workspace/scripts run build-tx-freshwater-efh",
  },
  {
    name: "AOOS Intertidal PoW (aoosIntertidalPow.gen.json)",
    builderPath: "scripts/src/build-aoos-intertidal-pow.ts",
    bundlePath: "artifacts/api-server/src/lib/aoosIntertidalPow.gen.json",
    refreshCommand:
      "pnpm --filter @workspace/scripts run build-aoos-intertidal-pow",
  },
];

function sha256Files(paths: string[]): string {
  const h = createHash("sha256");
  for (const p of paths) h.update(readFileSync(p));
  return h.digest("hex");
}

describe("substrate bundle generator hashes", () => {
  for (const c of CASES) {
    it(`${c.name} matches its builder source SHA-256`, () => {
      const builderPaths = Array.isArray(c.builderPath)
        ? c.builderPath
        : [c.builderPath];
      const builderAbs = builderPaths.map((p) => resolve(REPO_ROOT, p));
      const bundleAbs = resolve(REPO_ROOT, c.bundlePath);

      const expected = sha256Files(builderAbs);
      const bundle = JSON.parse(readFileSync(bundleAbs, "utf8")) as {
        metadata?: { generatorHash?: unknown };
      };
      const recorded = bundle.metadata?.generatorHash;

      if (recorded !== expected) {
        throw new Error(
          `Generator-hash drift for ${c.bundlePath}: ` +
            `bundle records "${String(recorded)}" but ${builderPaths.join(" + ")} ` +
            `currently hashes to "${expected}". ` +
            `Re-run the builder to refresh the bundle: ${c.refreshCommand}`,
        );
      }
      expect(recorded).toBe(expected);
    });
  }
});
