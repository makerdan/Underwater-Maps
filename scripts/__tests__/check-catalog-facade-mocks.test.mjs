/**
 * Self-test for scripts/check-catalog-facade-mocks.mjs.
 *
 * Run via: node --test scripts/__tests__/check-catalog-facade-mocks.test.mjs
 *
 * These fixtures intentionally stay source-only. Importing an API-server test
 * file would execute Vitest setup and make this guard depend on the application
 * runtime it is meant to protect.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatCatalogMockFailures,
  scanCatalogMockSource,
} from "../check-catalog-facade-mocks.mjs";

const facadeExports = [
  "getCatalogEntries",
  "searchCatalog",
  "invalidateCatalogCache",
];
const seederTerrainExports = ["ALL_PRESET_DATASETS", "NCEI_DATASET_COVERAGES"];
const fetchStrategyTerrainExports = [
  "ALL_PRESET_DATASETS",
  "BUNDLED_TERRAIN",
  "NYSDEC_BATHY_FEATURE_SERVICE",
  "MN_DNR_BATHY_FEATURE_SERVICE",
];

const scanOptions = {
  facadeExports,
  seederTerrainExports,
  fetchStrategyTerrainExports,
};

function scan(source, fileName = "fixture.test.ts") {
  return scanCatalogMockSource(source, { ...scanOptions, fileName });
}

describe("scanCatalogMockSource", () => {
  it("accepts complete catalog seeder and terrain mocks", () => {
    const failures = scan(`
      import { searchCatalog } from "../lib/catalogSeeder.js";
      vi.mock("../lib/catalogSeeder.js", () => ({
        getCatalogEntries: vi.fn(),
        searchCatalog: vi.fn(),
        invalidateCatalogCache: vi.fn(),
      }));
      vi.mock("../lib/terrain.js", () => ({
        fixture: { label: "nested object with braces" },
        ALL_PRESET_DATASETS: [],
        NCEI_DATASET_COVERAGES: [],
      }));
    `);

    assert.deepEqual(failures, []);
  });

  it("reports missing catalog seeder exports from a wholesale mock", () => {
    const failures = scan(`
      import { searchCatalog } from "../lib/catalogSeeder.js";
      vi.mock("../lib/catalogSeeder.js", () => ({
        getCatalogEntries: vi.fn(),
        searchCatalog: vi.fn(),
      }));
    `, "src/routes/__tests__/catalog-bbox.test.ts");

    assert.deepEqual(failures, [
      {
        kind: "catalogSeeder",
        fileName: "src/routes/__tests__/catalog-bbox.test.ts",
        missing: ["invalidateCatalogCache"],
      },
    ]);
  });

  it("reports missing terrain module-init constants", () => {
    const failures = scan(`
      import { searchCatalog } from "../lib/catalogSeeder.js";
      vi.mock("../lib/catalogSeeder.js", () => ({
        getCatalogEntries: vi.fn(),
        searchCatalog: vi.fn(),
        invalidateCatalogCache: vi.fn(),
      }));
      vi.mock("../lib/terrain.js", () => ({
        ALL_PRESET_DATASETS: [],
        fixture: { NCEI_DATASET_COVERAGES: [] },
      }));
    `);

    assert.deepEqual(failures, [
      {
        kind: "terrain",
        fileName: "fixture.test.ts",
        missing: ["NCEI_DATASET_COVERAGES"],
      },
    ]);
  });

  it("keeps nested fixture keys from satisfying top-level exports", () => {
    const failures = scan(`
      import { searchCatalog } from "../lib/catalogSeeder.js";
      vi.mock("../lib/catalogSeeder.js", () => ({
        fixtures: {
          getCatalogEntries: vi.fn(),
          searchCatalog: vi.fn(),
          invalidateCatalogCache: vi.fn(),
        },
      }));
    `);

    assert.deepEqual(failures, [
      {
        kind: "catalogSeeder",
        fileName: "fixture.test.ts",
        missing: [
          "getCatalogEntries",
          "searchCatalog",
          "invalidateCatalogCache",
        ],
      },
    ]);
  });
});

describe("formatCatalogMockFailures", () => {
  it("includes the affected file, mock kind, and missing exports", () => {
    const report = formatCatalogMockFailures([
      {
        kind: "terrain",
        fileName: "src/routes/__tests__/catalog-bbox.test.ts",
        missing: ["NCEI_DATASET_COVERAGES"],
      },
    ]);

    assert.match(
      report,
      /src\/routes\/__tests__\/catalog-bbox\.test\.ts \(terrain\): missing NCEI_DATASET_COVERAGES/,
    );
  });
});