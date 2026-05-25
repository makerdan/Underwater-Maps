/**
 * /efh — Essential Fish Habitat (EFH) zones.
 *
 * Returns GeoJSON feature collections for EFH zones in the requested area.
 * Currently covers the Thorne Bay / Clarence Strait / SE Alaska region.
 *
 * Species supported: halibut, pacific_cod, yelloweye_rockfish,
 *                    dungeness_crab, chinook_salmon
 *
 * Data credit: NOAA Fisheries / NMFS Alaska Region
 *   https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles
 */

import { Router } from "express";
import { THORNE_BAY_EFH } from "../lib/efhData.js";

const router = Router();

/**
 * GET /efh
 * Query params:
 *   datasetId  — filter to the AOI matching a known preset dataset
 *   species    — comma-separated list to filter (optional)
 */
router.get("/efh", (req, res) => {
  const { datasetId, species } = req.query as { datasetId?: string; species?: string };

  // Only the Thorne Bay region is currently bundled
  if (datasetId && datasetId !== "thorne-bay") {
    res.json({
      type: "FeatureCollection",
      features: [],
      metadata: {
        note: `No EFH data bundled for dataset '${datasetId}'. Only 'thorne-bay' is currently supported.`,
        creditUrl:
          "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
      },
    });
    return;
  }

  let features = THORNE_BAY_EFH.features;

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
    metadata: THORNE_BAY_EFH.metadata,
  });
});

export default router;
