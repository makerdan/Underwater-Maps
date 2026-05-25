/**
 * /substrate/:id — real Alaska ShoreZone substrate polygons.
 *
 * Returns a GeoJSON FeatureCollection of substrate polygons sourced from the
 * Alaska ShoreZone Coastal Habitat Mapping Program (NOAA AKR / ADF&G,
 * https://alaskafisheries.noaa.gov/shorezone/). The bundled regional dataset
 * is filtered to each preset dataset's AOI bbox at request time, so the
 * features returned for `/api/substrate/:id` are guaranteed to lie within
 * the dataset's bbox.
 *
 * For datasets whose AOI does not overlap published ShoreZone polygon
 * coverage (e.g. Thorne Bay / Prince of Wales Island), the response is an
 * honest empty FeatureCollection together with metadata describing the
 * nearest real ShoreZone coverage area and great-circle distance.
 *
 * Each returned feature carries:
 *   • substrate      — CMECS broad category (bedrock / gravel / sand / mud)
 *   • shoreZoneClass — original ShoreZone descriptive class
 *   • cmecsCode      — CMECS classification code
 *   • color          — rendering hint (same palette as the client expects)
 *   • unitId         — ShoreZone PHY_IDENT
 *   • szMaterial / szForm — raw ShoreZone Mat_Desc / Form_Desc
 *   • areaSqM        — polygon area (m²)
 *
 * The response includes `source: "alaska-shorezone"` so clients can attribute
 * the data correctly.
 *
 * Credit: Alaska ShoreZone (NOAA Alaska Regional Office / ADF&G) — public domain.
 */

import { Router } from "express";
import { ALL_PRESET_DATASETS } from "../lib/terrain.js";
import {
  ALASKA_SHOREZONE,
  getShoreZoneIntersectingBbox,
  nearestCoverageKm,
} from "../lib/shoreZoneData.js";

const router = Router();

/**
 * GET /substrate/:id
 *
 * Returns the ShoreZone substrate FeatureCollection for the dataset.
 * Responds 404 if the dataset id is unknown, or 200 with an empty
 * collection if no published ShoreZone polygons overlap the dataset bbox.
 */
router.get("/substrate/:id", (req, res) => {
  const datasetId = req.params["id"]!;
  const meta = ALL_PRESET_DATASETS.find((d) => d.id === datasetId);
  if (!meta) {
    res.status(404).json({ error: "not_found", details: `Dataset '${datasetId}' not found` });
    return;
  }

  const features = getShoreZoneIntersectingBbox(meta.bbox);
  const baseMetadata = {
    datasetId,
    datasetBbox: meta.bbox,
    source: "alaska-shorezone" as const,
    sourceName: ALASKA_SHOREZONE.metadata.sourceName,
    sourceLayer: ALASKA_SHOREZONE.metadata.sourceLayer,
    sourceService: ALASKA_SHOREZONE.metadata.sourceService,
    sourceRegion: ALASKA_SHOREZONE.metadata.region,
    sourceBbox: ALASKA_SHOREZONE.metadata.bbox,
    creditUrl: ALASKA_SHOREZONE.metadata.creditUrl,
    fetchedAt: ALASKA_SHOREZONE.metadata.fetchedAt,
    featureCount: features.length,
    totalFeatures: features.length,
    methodology:
      "Substrate polygons from the Alaska ShoreZone coastal mapping " +
      "AK_SZ_ITZ_Polygons layer (NOAA AKR / ADF&G). Each feature is a " +
      "ShoreZone intertidal-zone unit classified into CMECS broad substrate " +
      "categories (bedrock / gravel / sand / mud) via its Mat_Desc + " +
      "Form_Desc attributes. The regional bundle is filtered to the dataset " +
      "AOI bbox at request time.",
    credit: "Alaska ShoreZone (NOAA AKR / ADF&G) — public domain",
  };

  if (features.length === 0) {
    const distanceKm = nearestCoverageKm(meta.bbox);
    res.json({
      type: "FeatureCollection",
      features: [],
      metadata: {
        ...baseMetadata,
        nearestCoverage: {
          region: ALASKA_SHOREZONE.metadata.region,
          bbox: ALASKA_SHOREZONE.metadata.bbox,
          distanceKm: Math.round(distanceKm),
        },
        note:
          `No published Alaska ShoreZone polygons intersect the '${datasetId}' AOI bbox. ` +
          `Nearest real ShoreZone coverage is the ${ALASKA_SHOREZONE.metadata.region}, ` +
          `~${Math.round(distanceKm)} km from this dataset's centre.`,
      },
    });
    return;
  }

  res.json({
    type: "FeatureCollection",
    features,
    metadata: baseMetadata,
  });
});

export default router;
