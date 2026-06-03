/**
 * txFreshwaterEfhData.test.ts
 *
 * Unit tests for the source-normalisation logic in explodeToPolygons().
 *
 * The module reads txFreshwaterEfhData.gen.json via readFileSync at module-init
 * time, so we mock node:fs to intercept that read and inject a controlled
 * fixture.  The fixture is defined INSIDE the vi.mock factory (vi.mock calls
 * are hoisted before imports by Vitest's transform step, so the factory runs
 * before the module under test is evaluated).
 *
 * Expected output values used in test assertions are declared as plain string
 * constants at module scope — they do not reference the fixture object, which
 * avoids the temporal-dead-zone / scope-boundary issue that arises when trying
 * to share mutable objects between the mock factory and test bodies via
 * vi.hoisted().
 */
import { describe, expect, it, vi } from "vitest";

// ─── Expected output values ────────────────────────────────────────────────

const TPWD_LAKE_URL =
  "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/rayroberts/";
const NHD_URL =
  "https://www.usgs.gov/national-hydrography/national-hydrography-dataset";
const NHD_SOURCE_RAW = "USGS National Hydrography Dataset (NHD)";
const TPWD_SOURCE_NATIVE = "TPWD Texas Fish Habitat Structures";
const EXPECTED_NHD_NORMALISED_SOURCE = `TPWD (geometry from ${NHD_SOURCE_RAW})`;

// ─── Fixture injected into the mocked readFileSync ────────────────────────
//
// The fixture must include every dataset key that the module accesses at
// the top level (currently only "lake-ray-roberts").  It contains:
//   • one NHD Polygon feature   — should be source-normalised
//   • one NHD MultiPolygon (2 rings) — should be exploded AND normalised
//   • one natively-TPWD Polygon — should be left unchanged

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  const fixture = {
    datasets: {
      "lake-ray-roberts": {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              species: "micropterus_salmoides",
              commonName: "Largemouth Bass (spawning flats)",
              fmp: "TPWD Priority Spawning Habitat",
              depthRangeM: [1, 4],
              habitatDescription: "Shallow flats on Ray Roberts.",
              lifeStage: "Adults (spawning)",
              season: "Late Feb–Apr",
              color: "#22c55e",
              source: "USGS National Hydrography Dataset (NHD)",
              creditUrl:
                "https://www.usgs.gov/national-hydrography/national-hydrography-dataset",
              sourceLayer: "nhd-waterbody",
            },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-97.1, 33.4],
                  [-97.0, 33.4],
                  [-97.0, 33.5],
                  [-97.1, 33.4],
                ],
              ],
            },
          },
          {
            type: "Feature",
            properties: {
              species: "micropterus_salmoides",
              commonName: "Largemouth Bass (channel)",
              fmp: "TPWD Priority Creek Channel",
              depthRangeM: [2, 8],
              habitatDescription: "Creek channel on Ray Roberts.",
              color: "#3b82f6",
              source: "USGS National Hydrography Dataset (NHD)",
              creditUrl:
                "https://www.usgs.gov/national-hydrography/national-hydrography-dataset",
              sourceLayer: "nhd-flowline",
            },
            geometry: {
              type: "MultiPolygon",
              coordinates: [
                [
                  [
                    [-97.2, 33.5],
                    [-97.1, 33.5],
                    [-97.1, 33.6],
                    [-97.2, 33.5],
                  ],
                ],
                [
                  [
                    [-97.3, 33.6],
                    [-97.2, 33.6],
                    [-97.2, 33.7],
                    [-97.3, 33.6],
                  ],
                ],
              ],
            },
          },
          {
            type: "Feature",
            properties: {
              species: "micropterus_salmoides",
              commonName: "Largemouth Bass (brushpile)",
              fmp: "TPWD Priority Habitat Structures",
              depthRangeM: [2, 6],
              habitatDescription: "Brushpile cluster on Ray Roberts.",
              color: "#f59e0b",
              source: "TPWD Texas Fish Habitat Structures",
              creditUrl:
                "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/rayroberts/",
              sourceLayer: "tpwd-fish-habitat-structures",
            },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-97.4, 33.3],
                  [-97.3, 33.3],
                  [-97.3, 33.4],
                  [-97.4, 33.3],
                ],
              ],
            },
          },
        ],
        metadata: {
          region: "TX Freshwater",
          bbox: [-97.5, 33.3, -96.8, 33.8],
          creditUrl:
            "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/rayroberts/",
          lastUpdated: "2025-01-01",
          sources: ["TPWD", "NHD"],
        },
      },
    },
    metadata: { generatorHash: "test-fixture-hash" },
  };

  return {
    ...actual,
    readFileSync: (path: unknown, encoding: unknown) => {
      if (
        typeof path === "string" &&
        path.includes("txFreshwaterEfhData.gen.json")
      ) {
        return JSON.stringify(fixture);
      }
      return actual.readFileSync(
        path as Parameters<typeof actual.readFileSync>[0],
        encoding as BufferEncoding,
      );
    },
  };
});

import {
  LAKE_RAY_ROBERTS_EFH,
  TX_FRESHWATER_EFH_BY_DATASET,
} from "../txFreshwaterEfhData.js";

// ─── Tests ────────────────────────────────────────────────────────────────

describe("txFreshwaterEfhData — source normalisation", () => {
  it("exports at least one dataset", () => {
    expect(Object.keys(TX_FRESHWATER_EFH_BY_DATASET).length).toBeGreaterThan(0);
  });

  it("every feature in every dataset has source starting with 'TPWD'", () => {
    for (const [datasetId, fc] of Object.entries(TX_FRESHWATER_EFH_BY_DATASET)) {
      for (const feature of fc.features) {
        expect(
          feature.properties.source,
          `Dataset "${datasetId}": source "${feature.properties.source}" must start with "TPWD"`,
        ).toMatch(/^TPWD/);
      }
    }
  });

  it("NHD-sourced features have creditUrl rewritten to the TPWD lake page", () => {
    const nhdFeatures = LAKE_RAY_ROBERTS_EFH.features.filter((f) =>
      f.properties.source.includes("NHD"),
    );
    expect(nhdFeatures.length).toBeGreaterThan(0);
    for (const f of nhdFeatures) {
      expect(f.properties.creditUrl).toBe(TPWD_LAKE_URL);
      expect(f.properties.creditUrl).not.toBe(NHD_URL);
    }
  });

  it("NHD-sourced features have source rewritten to 'TPWD (geometry from …)'", () => {
    const nhdFeatures = LAKE_RAY_ROBERTS_EFH.features.filter((f) =>
      f.properties.source.includes("NHD"),
    );
    expect(nhdFeatures.length).toBeGreaterThan(0);
    for (const f of nhdFeatures) {
      expect(f.properties.source).toBe(EXPECTED_NHD_NORMALISED_SOURCE);
    }
  });

  it("natively-TPWD-sourced features keep their original source string unchanged", () => {
    const tpwdFeature = LAKE_RAY_ROBERTS_EFH.features.find(
      (f) => f.properties.source === TPWD_SOURCE_NATIVE,
    );
    expect(tpwdFeature).toBeDefined();
    expect(tpwdFeature!.properties.source).toBe(TPWD_SOURCE_NATIVE);
  });

  it("natively-TPWD-sourced features keep their original creditUrl unchanged", () => {
    const tpwdFeature = LAKE_RAY_ROBERTS_EFH.features.find(
      (f) => f.properties.source === TPWD_SOURCE_NATIVE,
    );
    expect(tpwdFeature).toBeDefined();
    expect(tpwdFeature!.properties.creditUrl).toBe(TPWD_LAKE_URL);
  });

  it("MultiPolygon input features are exploded into individual Polygon features", () => {
    // All output geometries must be Polygon (never MultiPolygon).
    for (const feature of LAKE_RAY_ROBERTS_EFH.features) {
      expect(feature.geometry.type).toBe("Polygon");
    }

    // The fixture has: 1 NHD Polygon + 1 NHD MultiPolygon (2 rings) + 1 TPWD Polygon
    // Expected output: 1 + 2 + 1 = 4 Polygon features.
    expect(LAKE_RAY_ROBERTS_EFH.features.length).toBe(4);
  });

  it("natively-TPWD features appear before NHD-normalised features (sort order)", () => {
    const lastNativeIdx = LAKE_RAY_ROBERTS_EFH.features.reduce(
      (idx, f, i) => (f.properties.source === TPWD_SOURCE_NATIVE ? i : idx),
      -1,
    );
    const firstNormalisedIdx = LAKE_RAY_ROBERTS_EFH.features.findIndex(
      (f) => f.properties.source !== TPWD_SOURCE_NATIVE,
    );

    if (lastNativeIdx !== -1 && firstNormalisedIdx !== -1) {
      expect(lastNativeIdx).toBeLessThan(firstNormalisedIdx);
    }
  });
});
