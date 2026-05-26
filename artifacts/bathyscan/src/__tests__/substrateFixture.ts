/**
 * Shared substrate FeatureCollection fixture.
 *
 * Used by both the 2D OverviewMap click test and the 3D SubstrateLayer click
 * test so that adding or renaming a property in the fixture forces both tests
 * to be updated — preventing the two views from silently diverging.
 *
 * Typed as SubstrateFeatureCollection so the TypeScript compiler enforces
 * the contract: adding a required field to the schema must also be reflected
 * here, or the typecheck step will fail before any test runs.
 */
import type { SubstrateFeatureCollection } from "@workspace/api-client-react";

export const substrateCollection: SubstrateFeatureCollection = {
  type: "FeatureCollection",
  metadata: {
    sourceName: "Test Substrate Source",
    creditUrl: "https://example.test/credit",
  },
  features: [
    {
      type: "Feature",
      properties: {
        unitId: "poly-1",
        substrate: "sand",
        shoreZoneClass: "SAND",
        cmecsCode: "SBS_SA",
        color: "#e2d5a0",
        szMaterial: "sand",
        szForm: "flat",
        areaSqM: 1234,
        natsur: "Sandy bottom per S-57 NATSUR.",
        encChart: "US5AK4DM",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-119.8, 47.3],
            [-119.7, 47.3],
            [-119.7, 47.4],
            [-119.8, 47.4],
            [-119.8, 47.3],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        unitId: "poly-2",
        substrate: "gravel",
        shoreZoneClass: "GRAVEL",
        cmecsCode: "SBS_GR",
        color: "#9ab5c4",
        szMaterial: "gravel",
        szForm: "ramp",
        areaSqM: 5678,
        natsur: "TPWD lake-survey: gravel substrate near boat ramp.",
        encChart: "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/example",
      },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [-119.5, 47.6],
              [-119.4, 47.6],
              [-119.4, 47.7],
              [-119.5, 47.7],
              [-119.5, 47.6],
            ],
          ],
        ],
      },
    },
  ],
};
