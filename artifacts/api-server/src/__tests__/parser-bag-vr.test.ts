/**
 * parser-bag-vr.test.ts
 *
 * Tests the VR BAG (Variable-Resolution BAG) parser path in bag_parser.py / parseBag.
 *
 * Scenario: a VR BAG whose metadata XML contains a valid geographic bounding box
 * but no EPSG code or WKT, and whose super-cell sw_corner values are clearly
 * projected (UTM-like, e.g. 500 000 m easting).
 *
 * Expected behaviour: parseBag rejects with a descriptive error that explicitly
 * mentions the CRS problem, rather than silently returning no points or throwing
 * the generic "BAG file produced no valid depth points" fallback.
 *
 * The fixture is generated on demand by gen_vr_bag.py (uses h5py + numpy, which
 * are already installed as dependencies of bag_parser.py itself).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { parseBag } from "../lib/uploadParsers.js";

const __dir      = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dir, "fixtures");
const GEN_SCRIPT  = join(FIXTURE_DIR, "gen_vr_bag.py");

// Write to a system temp directory so the fixture doesn't appear in the
// project fixture folder (which is checked for uncommitted extras by
// check-fixture-freshness.sh).
const FIXTURE_PATH = join(tmpdir(), `survey_vr_projected_${Date.now()}.bag`);

let projectedVrBagBuf: Buffer;

beforeAll(() => {
  const pythonUserBase =
    process.env.PYTHONUSERBASE ??
    join(__dir, "../../../../.pythonlibs");
  execFileSync("python3", [GEN_SCRIPT, "--out", FIXTURE_PATH], {
    stdio: "pipe",
    env: { ...process.env, PYTHONUSERBASE: pythonUserBase },
  });
  projectedVrBagBuf = readFileSync(FIXTURE_PATH);
}, 30_000);

afterAll(() => {
  try { if (existsSync(FIXTURE_PATH)) rmSync(FIXTURE_PATH); } catch { /* ignore */ }
});

describe("VR BAG parser — projected CRS without resolvable metadata", () => {
  it(
    "rejects with a CRS error when sw_corner values indicate projected coordinates",
    async () => {
      const err = await parseBag(projectedVrBagBuf).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;

      expect(msg).toMatch(/CRS/i);
      expect(msg).not.toMatch(/produced no valid depth points/i);
    },
    30_000,
  );
});
