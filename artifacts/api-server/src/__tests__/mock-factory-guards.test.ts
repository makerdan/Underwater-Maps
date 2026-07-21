/**
 * mock-factory-guards.test.ts — mock-completeness guards for the shared
 * vi.mock factories of lib/tileClassify.js, lib/shoreZoneData.js and
 * lib/bucketMonitor.js (terrain.js has its own guard in
 * terrain-mock-guard.test.ts, whose header documents this pattern).
 *
 * Why: many suites replace these modules wholesale. If a real module gains
 * an export that any module reads at init time, every mocking suite crashes
 * at collection time with an opaque "No export is defined on the mock"
 * error. These tests fail FIRST, with an actionable message naming the
 * missing keys. Runtime-only comparison is intentional: type-only exports
 * don't exist at runtime and never break mocks.
 */
import { describe, it, expect } from "vitest";
import { createTileClassifyMock } from "./helpers/tileClassifyMock.js";
import { createShoreZoneDataMock } from "./helpers/shoreZoneDataMock.js";
import { createBucketMonitorMock } from "./helpers/bucketMonitorMock.js";

interface GuardCase {
  moduleLabel: string;
  helperPath: string;
  factoryName: string;
  loadReal: () => Promise<Record<string, unknown>>;
  createMock: () => Record<string, unknown>;
}

const CASES: GuardCase[] = [
  {
    moduleLabel: "lib/tileClassify.js",
    helperPath: "src/__tests__/helpers/tileClassifyMock.ts",
    factoryName: "createTileClassifyMock",
    loadReal: () => import("../lib/tileClassify.js") as Promise<Record<string, unknown>>,
    createMock: () => createTileClassifyMock(),
  },
  {
    moduleLabel: "lib/shoreZoneData.js",
    helperPath: "src/__tests__/helpers/shoreZoneDataMock.ts",
    factoryName: "createShoreZoneDataMock",
    loadReal: () => import("../lib/shoreZoneData.js") as Promise<Record<string, unknown>>,
    createMock: () => createShoreZoneDataMock(),
  },
  {
    moduleLabel: "lib/bucketMonitor.js",
    helperPath: "src/__tests__/helpers/bucketMonitorMock.ts",
    factoryName: "createBucketMonitorMock",
    loadReal: () => import("../lib/bucketMonitor.js") as Promise<Record<string, unknown>>,
    createMock: () => createBucketMonitorMock(),
  },
];

describe.each(CASES)(
  "shared $moduleLabel mock factory completeness",
  ({ moduleLabel, helperPath, factoryName, loadReal, createMock }) => {
    it(`stubs every runtime export of ${moduleLabel}`, async () => {
      // Dynamic import of the REAL module (no vi.mock in this file).
      const real = await loadReal();
      const mock = createMock();

      const missing = Object.keys(real)
        .sort()
        .filter((k) => !(k in mock));

      expect(
        missing,
        `${moduleLabel} has export(s) missing from ${factoryName}() in ` +
          `${helperPath}: [${missing.join(", ")}]. Add stub(s) for them to ` +
          `the factory — otherwise every suite that mocks ${moduleLabel} ` +
          `will fail at collection time with "No export is defined on the ` +
          `mock" as soon as any module reads the new export at init time.`,
      ).toEqual([]);
    });

    it(`does not stub keys that no longer exist in ${moduleLabel}`, async () => {
      const real = await loadReal();
      const mock = createMock();

      const stale = Object.keys(mock).filter((k) => !(k in real));

      expect(
        stale,
        `${factoryName}() stubs key(s) that ${moduleLabel} no longer ` +
          `exports: [${stale.join(", ")}]. Remove them from ${helperPath} ` +
          `so the factory stays in lock-step with the real module.`,
      ).toEqual([]);
    });
  },
);
