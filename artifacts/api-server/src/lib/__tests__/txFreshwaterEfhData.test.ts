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

const TPWD_RAY_ROBERTS_URL =
  "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/rayroberts/";
const TPWD_LAKE_FORK_URL =
  "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/fork/";
const TPWD_SAM_RAYBURN_URL =
  "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/samrayburn/";
const TPWD_TOLEDO_BEND_URL =
  "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/toledobend/";

const NHD_URL =
  "https://www.usgs.gov/national-hydrography/national-hydrography-dataset";
const NHD_SOURCE_RAW = "USGS National Hydrography Dataset (NHD)";
const TPWD_SOURCE_NATIVE = "TPWD Texas Fish Habitat Structures";
const EXPECTED_NHD_NORMALISED_SOURCE = `TPWD (geometry from ${NHD_SOURCE_RAW})`;

// ─── Fixture injected into the mocked readFileSync ────────────────────────
//
// Each dataset contains:
//   • one NHD Polygon feature   — should be source-normalised
//   • one NHD MultiPolygon (2 rings) — should be exploded AND normalised
//   • one natively-TPWD Polygon — should be left unchanged
//
// Expected output per dataset: 1 + 2 + 1 = 4 Polygon features.

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  function makeDataset(
    lakeName: string,
    tpwdUrl: string,
    coords: {
      poly: number[][];
      multiA: number[][];
      multiB: number[][];
      tpwd: number[][];
    },
  ) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            species: "micropterus_salmoides",
            commonName: `Largemouth Bass (spawning flats) — ${lakeName}`,
            fmp: "TPWD Priority Spawning Habitat",
            depthRangeM: [1, 4],
            habitatDescription: `Shallow flats on ${lakeName}.`,
            lifeStage: "Adults (spawning)",
            season: "Late Feb–Apr",
            color: "#22c55e",
            source: "USGS National Hydrography Dataset (NHD)",
            creditUrl:
              "https://www.usgs.gov/national-hydrography/national-hydrography-dataset",
            sourceLayer: "nhd-waterbody",
          },
          geometry: { type: "Polygon", coordinates: [coords.poly] },
        },
        {
          type: "Feature",
          properties: {
            species: "micropterus_salmoides",
            commonName: `Largemouth Bass (channel) — ${lakeName}`,
            fmp: "TPWD Priority Creek Channel",
            depthRangeM: [2, 8],
            habitatDescription: `Creek channel on ${lakeName}.`,
            color: "#3b82f6",
            source: "USGS National Hydrography Dataset (NHD)",
            creditUrl:
              "https://www.usgs.gov/national-hydrography/national-hydrography-dataset",
            sourceLayer: "nhd-flowline",
          },
          geometry: {
            type: "MultiPolygon",
            coordinates: [[coords.multiA], [coords.multiB]],
          },
        },
        {
          type: "Feature",
          properties: {
            species: "micropterus_salmoides",
            commonName: `Largemouth Bass (brushpile) — ${lakeName}`,
            fmp: "TPWD Priority Habitat Structures",
            depthRangeM: [2, 6],
            habitatDescription: `Brushpile cluster on ${lakeName}.`,
            color: "#f59e0b",
            source: "TPWD Texas Fish Habitat Structures",
            creditUrl: tpwdUrl,
            sourceLayer: "tpwd-fish-habitat-structures",
          },
          geometry: { type: "Polygon", coordinates: [coords.tpwd] },
        },
      ],
      metadata: {
        region: `TX Freshwater — ${lakeName}`,
        bbox: [-97.5, 33.3, -96.8, 33.8],
        creditUrl: tpwdUrl,
        lastUpdated: "2025-01-01",
        sources: ["TPWD", "NHD"],
      },
    };
  }

  const fixture = {
    datasets: {
      "lake-ray-roberts": makeDataset(
        "Ray Roberts",
        "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/rayroberts/",
        {
          poly: [
            [-97.1, 33.4],
            [-97.0, 33.4],
            [-97.0, 33.5],
            [-97.1, 33.4],
          ],
          multiA: [
            [-97.2, 33.5],
            [-97.1, 33.5],
            [-97.1, 33.6],
            [-97.2, 33.5],
          ],
          multiB: [
            [-97.3, 33.6],
            [-97.2, 33.6],
            [-97.2, 33.7],
            [-97.3, 33.6],
          ],
          tpwd: [
            [-97.4, 33.3],
            [-97.3, 33.3],
            [-97.3, 33.4],
            [-97.4, 33.3],
          ],
        },
      ),
      "lake-fork": makeDataset(
        "Lake Fork",
        "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/fork/",
        {
          poly: [
            [-95.6, 32.8],
            [-95.5, 32.8],
            [-95.5, 32.9],
            [-95.6, 32.8],
          ],
          multiA: [
            [-95.55, 32.85],
            [-95.45, 32.85],
            [-95.45, 32.95],
            [-95.55, 32.85],
          ],
          multiB: [
            [-95.65, 32.9],
            [-95.55, 32.9],
            [-95.55, 33.0],
            [-95.65, 32.9],
          ],
          tpwd: [
            [-95.62, 32.82],
            [-95.52, 32.82],
            [-95.52, 32.92],
            [-95.62, 32.82],
          ],
        },
      ),
      "sam-rayburn": makeDataset(
        "Sam Rayburn",
        "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/samrayburn/",
        {
          poly: [
            [-94.2, 31.1],
            [-94.1, 31.1],
            [-94.1, 31.2],
            [-94.2, 31.1],
          ],
          multiA: [
            [-94.25, 31.15],
            [-94.15, 31.15],
            [-94.15, 31.25],
            [-94.25, 31.15],
          ],
          multiB: [
            [-94.3, 31.2],
            [-94.2, 31.2],
            [-94.2, 31.3],
            [-94.3, 31.2],
          ],
          tpwd: [
            [-94.22, 31.12],
            [-94.12, 31.12],
            [-94.12, 31.22],
            [-94.22, 31.12],
          ],
        },
      ),
      "toledo-bend": makeDataset(
        "Toledo Bend",
        "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/toledobend/",
        {
          poly: [
            [-93.9, 31.2],
            [-93.8, 31.2],
            [-93.8, 31.3],
            [-93.9, 31.2],
          ],
          multiA: [
            [-93.85, 31.25],
            [-93.75, 31.25],
            [-93.75, 31.35],
            [-93.85, 31.25],
          ],
          multiB: [
            [-93.95, 31.3],
            [-93.85, 31.3],
            [-93.85, 31.4],
            [-93.95, 31.3],
          ],
          tpwd: [
            [-93.92, 31.22],
            [-93.82, 31.22],
            [-93.82, 31.32],
            [-93.92, 31.22],
          ],
        },
      ),
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
  LAKE_FORK_EFH,
  LAKE_RAY_ROBERTS_EFH,
  SAM_RAYBURN_EFH,
  TOLEDO_BEND_EFH,
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

  // ─── Lake Ray Roberts ──────────────────────────────────────────────────

  it("NHD-sourced features have creditUrl rewritten to the TPWD lake page", () => {
    const nhdFeatures = LAKE_RAY_ROBERTS_EFH.features.filter((f) =>
      f.properties.source.includes("NHD"),
    );
    expect(nhdFeatures.length).toBeGreaterThan(0);
    for (const f of nhdFeatures) {
      expect(f.properties.creditUrl).toBe(TPWD_RAY_ROBERTS_URL);
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
    expect(tpwdFeature!.properties.creditUrl).toBe(TPWD_RAY_ROBERTS_URL);
  });

  it("MultiPolygon input features are exploded into individual Polygon features", () => {
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

// ─── Parameterised suite for the remaining three TX freshwater lakes ───────

const LAKE_CASES = [
  {
    label: "Lake Fork",
    datasetKey: "lake-fork",
    efh: () => LAKE_FORK_EFH,
    tpwdUrl: TPWD_LAKE_FORK_URL,
  },
  {
    label: "Sam Rayburn",
    datasetKey: "sam-rayburn",
    efh: () => SAM_RAYBURN_EFH,
    tpwdUrl: TPWD_SAM_RAYBURN_URL,
  },
  {
    label: "Toledo Bend",
    datasetKey: "toledo-bend",
    efh: () => TOLEDO_BEND_EFH,
    tpwdUrl: TPWD_TOLEDO_BEND_URL,
  },
] as const;

for (const { label, datasetKey, efh, tpwdUrl } of LAKE_CASES) {
  describe(`txFreshwaterEfhData — ${label} (${datasetKey})`, () => {
    it("is present in TX_FRESHWATER_EFH_BY_DATASET", () => {
      expect(TX_FRESHWATER_EFH_BY_DATASET[datasetKey]).toBeDefined();
    });

    it("NHD-sourced features have source rewritten to 'TPWD (geometry from …)'", () => {
      const nhdFeatures = efh().features.filter((f) =>
        f.properties.source.includes("NHD"),
      );
      expect(nhdFeatures.length).toBeGreaterThan(0);
      for (const f of nhdFeatures) {
        expect(f.properties.source).toBe(EXPECTED_NHD_NORMALISED_SOURCE);
      }
    });

    it("NHD-sourced features have creditUrl rewritten to the TPWD lake page", () => {
      const nhdFeatures = efh().features.filter((f) =>
        f.properties.source.includes("NHD"),
      );
      expect(nhdFeatures.length).toBeGreaterThan(0);
      for (const f of nhdFeatures) {
        expect(f.properties.creditUrl).toBe(tpwdUrl);
        expect(f.properties.creditUrl).not.toBe(NHD_URL);
      }
    });

    it("natively-TPWD-sourced features keep their original source string unchanged", () => {
      const tpwdFeature = efh().features.find(
        (f) => f.properties.source === TPWD_SOURCE_NATIVE,
      );
      expect(tpwdFeature).toBeDefined();
      expect(tpwdFeature!.properties.source).toBe(TPWD_SOURCE_NATIVE);
    });

    it("natively-TPWD-sourced features keep their original creditUrl unchanged", () => {
      const tpwdFeature = efh().features.find(
        (f) => f.properties.source === TPWD_SOURCE_NATIVE,
      );
      expect(tpwdFeature).toBeDefined();
      expect(tpwdFeature!.properties.creditUrl).toBe(tpwdUrl);
    });

    it("MultiPolygon features are exploded — all output geometries are Polygon", () => {
      for (const feature of efh().features) {
        expect(feature.geometry.type).toBe("Polygon");
      }
    });

    it("MultiPolygon (2 rings) is exploded to two separate Polygon features", () => {
      // Fixture: 1 NHD Polygon + 1 NHD MultiPolygon (2 rings) + 1 TPWD Polygon → 4 total
      expect(efh().features.length).toBe(4);
    });

    it("natively-TPWD features appear before NHD-normalised features (sort order)", () => {
      const features = efh().features;
      const lastNativeIdx = features.reduce(
        (idx, f, i) => (f.properties.source === TPWD_SOURCE_NATIVE ? i : idx),
        -1,
      );
      const firstNormalisedIdx = features.findIndex(
        (f) => f.properties.source !== TPWD_SOURCE_NATIVE,
      );

      if (lastNativeIdx !== -1 && firstNormalisedIdx !== -1) {
        expect(lastNativeIdx).toBeLessThan(firstNormalisedIdx);
      }
    });
  });
}
