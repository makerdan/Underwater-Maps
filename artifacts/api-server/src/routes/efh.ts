/**
 * /efh — Essential Fish Habitat (EFH) zones.
 *
 * Returns GeoJSON feature collections for EFH zones in the requested area.
 * Covers the SE Alaska Inside Passage saltwater regions (NOAA federal EFH)
 * plus Texas freshwater reservoirs (TPWD priority habitat, EFH-equivalent —
 * NOT federal EFH; the source string makes that explicit).
 *
 * Data credits:
 *   Saltwater — NOAA Fisheries / NMFS Alaska Region
 *     https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles
 *   Freshwater — Texas Parks & Wildlife Department lake pages
 */

import { Router } from "express";
import {
  SALTWATER_EFH_BY_DATASET,
  type EfhFeatureCollection,
} from "../lib/efhData.js";
import { TX_FRESHWATER_EFH_BY_DATASET } from "../lib/txFreshwaterEfhData.js";

const router = Router();

/** Merged lookup of every dataset id that has bundled EFH data. */
export const EFH_BY_DATASET: Record<string, EfhFeatureCollection> = {
  ...SALTWATER_EFH_BY_DATASET,
  ...TX_FRESHWATER_EFH_BY_DATASET,
};

/** All dataset ids with bundled EFH data — exported for the dataset metadata. */
export const EFH_DATASET_IDS: ReadonlySet<string> = new Set(
  Object.keys(EFH_BY_DATASET),
);

/**
 * GET /efh
 * Query params:
 *   datasetId  — filter to the AOI matching a known preset dataset
 *   species    — comma-separated list to filter (optional)
 */
router.get("/efh", (req, res) => {
  const { datasetId, species } = req.query as { datasetId?: string; species?: string };

  // Default to Thorne Bay when no datasetId is provided (legacy behaviour).
  const lookupId = datasetId ?? "thorne-bay";
  const collection = EFH_BY_DATASET[lookupId];

  if (!collection) {
    res.json({
      type: "FeatureCollection",
      features: [],
      metadata: {
        note: `No EFH data bundled for dataset '${datasetId}'.`,
        creditUrl:
          "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
      },
    });
    return;
  }

  let features = collection.features;

  // Filter by species if requested
  if (species) {
    const requested = new Set(
      species
        .split(",")
        .map((s) => s.trim().toLowerCase())
    );

    features = features.filter((f) =>
      requested.has(f.properties.species.toLowerCase()) ||
      requested.has(f.properties.commonName.toLowerCase().replace(/ /g, "_")) ||
      requested.has(f.properties.commonName.toLowerCase())
    );
  }

  res.json({
    type: "FeatureCollection",
    features,
    metadata: collection.metadata,
  });
});

export default router;
