/**
 * /substrate/:id — real SE Alaska substrate polygons (ShoreZone + NOAA ENC).
 *
 * Returns a GeoJSON FeatureCollection of substrate polygons sourced from two
 * complementary authoritative datasets that together cover the entire SE
 * Alaska Inside Passage:
 *
 *   1) Alaska ShoreZone Coastal Habitat Mapping Program (NOAA AKR / ADF&G,
 *      https://alaskafisheries.noaa.gov/shorezone/) — high-resolution
 *      intertidal-zone polygons for Glacier Bay / Icy Strait.
 *   2) NOAA Electronic Navigational Charts — Coastal.Seabed_Area (S-57
 *      SBDARE polygons, https://nauticalcharts.noaa.gov/charts/noaa-enc.html)
 *      — chart-derived seabed type polygons covering all US navigable
 *      waters, used to fill in the rest of SE Alaska (Sitka, Juneau,
 *      Ketchikan, Thorne Bay / Prince of Wales Island).
 *
 * The bundled regional datasets are filtered to each preset's AOI bbox at
 * request time, so all returned features lie within the dataset bbox. Each
 * feature carries `properties.source` (`alaska-shorezone` |
 * `noaa-enc-coastal`) so clients can render per-feature attribution, and
 * the response's `metadata.sources` array lists per-source feature counts.
 *
 * For the rare AOI that overlaps no published substrate polygons in either
 * source, the response is an honest empty FeatureCollection with the
 * nearest real coverage area and great-circle distance.
 *
 * Each returned feature includes:
 *   • substrate      — CMECS broad category (bedrock / gravel / sand / mud)
 *   • shoreZoneClass — original descriptive class (ShoreZone class or ENC NATSUR)
 *   • cmecsCode      — CMECS classification code
 *   • color          — rendering hint
 *   • unitId         — stable per-feature id
 *   • source         — provenance ("alaska-shorezone" | "noaa-enc-coastal")
 *   • szMaterial / szForm / areaSqM — ShoreZone-only attributes
 *   • natsur / natqua / encChart    — ENC-only attributes
 *
 * Credit: Alaska ShoreZone (NOAA AKR / ADF&G), NOAA Office of Coast Survey
 * ENC — both public domain.
 */

import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, customDatasetsTable, type StoredNoaaSubstrateSample } from "@workspace/db";
import { ALL_PRESET_DATASETS } from "../lib/terrain.js";
import {
  ALASKA_SHOREZONE,
  ENC_SE_ALASKA_SUBSTRATE,
  ENC_CONUS_SUBSTRATE,
  TX_LAKE_SUBSTRATE,
  AOOS_INTERTIDAL_POW,
  getSubstrateForDataset,
  type SubstrateSource,
  type ShoreZoneFeatureCollection,
} from "../lib/shoreZoneData.js";

// ---------------------------------------------------------------------------
// NOAA historical bottom-sample point → GeoJSON Feature conversion
// ---------------------------------------------------------------------------

/**
 * Hex fill colors for each normalised substrate category.
 * These mirror the palette used by the ShoreZone/ENC polygon renderer so that
 * historical sample points blend visually with the polygon overlay.
 */
const NOAA_SAMPLE_COLORS: Record<string, string> = {
  mud:    "#9e8c6a",
  rock:   "#6e7070",
  sand:   "#f5d58a",
  gravel: "#b8a088",
  kelp:   "#4a7c4e",
};

/** Map normalised BSText substrate types to the nearest SubstrateProperties enum value. */
function normaliseToSubstrateClass(substrateType: string): string {
  switch (substrateType) {
    case "rock":   return "bedrock";
    case "mud":    return "mud";
    case "sand":   return "sand";
    case "gravel": return "gravel";
    case "kelp":   return "kelp";
    default:       return substrateType.toLowerCase().slice(0, 32);
  }
}

/**
 * Convert an array of stored NOAA bottom-sample points into GeoJSON Point
 * features compatible with the SubstrateFeature schema.  Each feature carries
 * `properties.source = "noaa-historical-samples"` so clients can distinguish
 * polygon-source features from point-source observations.
 */
function noaaSamplesToGeoJson(
  samples: StoredNoaaSubstrateSample[],
): Array<{
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Point"; coordinates: [number, number] };
}> {
  return samples.map((s, i) => {
    const substrateClass = normaliseToSubstrateClass(s.substrateType);
    const color = NOAA_SAMPLE_COLORS[s.substrateType] ?? "#888888";
    return {
      type: "Feature" as const,
      properties: {
        unitId:        `noaa-sample-${i}`,
        substrate:     substrateClass,
        shoreZoneClass: s.rawLabel || s.substrateType,
        cmecsCode:     "NOAA Historical Bottom Sample",
        color,
        source:        "noaa-historical-samples",
        rawLabel:      s.rawLabel,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [s.lon, s.lat] as [number, number],
      },
    };
  });
}

const DatasetIdParamSchema = z.object({
  id: z.string().min(1, "Dataset ID is required"),
});

const router = Router();

/** Per-source provenance descriptor stamped into the response metadata. */
const SOURCE_PROVENANCE = {
  "alaska-shorezone": {
    sourceName:    ALASKA_SHOREZONE.metadata.sourceName,
    sourceLayer:   ALASKA_SHOREZONE.metadata.sourceLayer,
    sourceService: ALASKA_SHOREZONE.metadata.sourceService,
    sourceRegion:  ALASKA_SHOREZONE.metadata.region,
    sourceBbox:    ALASKA_SHOREZONE.metadata.bbox,
    creditUrl:     ALASKA_SHOREZONE.metadata.creditUrl,
    fetchedAt:     ALASKA_SHOREZONE.metadata.fetchedAt,
    credit:        "Alaska ShoreZone (NOAA AKR / ADF&G) — public domain",
  },
  "noaa-enc-coastal": {
    sourceName:    ENC_SE_ALASKA_SUBSTRATE.metadata.sourceName,
    sourceLayer:   ENC_SE_ALASKA_SUBSTRATE.metadata.sourceLayer,
    sourceService: ENC_SE_ALASKA_SUBSTRATE.metadata.sourceService,
    sourceRegion:  ENC_SE_ALASKA_SUBSTRATE.metadata.region,
    sourceBbox:    ENC_SE_ALASKA_SUBSTRATE.metadata.bbox,
    creditUrl:     ENC_SE_ALASKA_SUBSTRATE.metadata.creditUrl,
    fetchedAt:     ENC_SE_ALASKA_SUBSTRATE.metadata.fetchedAt,
    credit:        "NOAA Office of Coast Survey — Electronic Navigational Charts (public domain)",
  },
  "noaa-enc-conus": {
    sourceName:    ENC_CONUS_SUBSTRATE.metadata.sourceName,
    sourceLayer:   ENC_CONUS_SUBSTRATE.metadata.sourceLayer,
    sourceService: ENC_CONUS_SUBSTRATE.metadata.sourceService,
    sourceRegion:  ENC_CONUS_SUBSTRATE.metadata.region,
    sourceBbox:    ENC_CONUS_SUBSTRATE.metadata.bbox,
    creditUrl:     ENC_CONUS_SUBSTRATE.metadata.creditUrl,
    fetchedAt:     ENC_CONUS_SUBSTRATE.metadata.fetchedAt,
    credit:        "NOAA Office of Coast Survey — Electronic Navigational Charts (public domain)",
  },
  "tpwd-tx-reservoirs": {
    sourceName:    TX_LAKE_SUBSTRATE.metadata.sourceName,
    sourceLayer:   TX_LAKE_SUBSTRATE.metadata.sourceLayer,
    sourceService: TX_LAKE_SUBSTRATE.metadata.sourceService,
    sourceRegion:  TX_LAKE_SUBSTRATE.metadata.region,
    sourceBbox:    TX_LAKE_SUBSTRATE.metadata.bbox,
    creditUrl:     TX_LAKE_SUBSTRATE.metadata.creditUrl,
    fetchedAt:     TX_LAKE_SUBSTRATE.metadata.fetchedAt,
    credit:        "USGS National Hydrography Dataset + Texas Parks & Wildlife / TWDB lake-bottom surveys (public domain)",
  },
  "aoos-intertidal-pow": {
    sourceName:    AOOS_INTERTIDAL_POW.metadata.sourceName,
    sourceLayer:   AOOS_INTERTIDAL_POW.metadata.sourceLayer,
    sourceService: AOOS_INTERTIDAL_POW.metadata.sourceService,
    sourceRegion:  AOOS_INTERTIDAL_POW.metadata.region,
    sourceBbox:    AOOS_INTERTIDAL_POW.metadata.bbox,
    creditUrl:     AOOS_INTERTIDAL_POW.metadata.creditUrl,
    fetchedAt:     AOOS_INTERTIDAL_POW.metadata.fetchedAt,
    credit:        "AOOS Alaska Coastal Habitats — Prince of Wales Island intertidal (public domain)",
  },
} as const satisfies Record<SubstrateSource, unknown>;

// UUID pattern for custom (user-uploaded) dataset IDs.
const CUSTOM_DATASET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /substrate/:id
 *
 * Responds 404 for unknown dataset ids, otherwise 200 with a merged
 * ShoreZone + ENC substrate FeatureCollection clipped to the dataset bbox.
 *
 * Auth rules (mirrors the zones/terrain pattern):
 *  - Preset/catalog dataset IDs → public, no auth required.
 *  - UUID-format (custom) dataset IDs → require auth + ownership check.
 *    Non-owner / non-existent custom datasets return 404 (not 403) to avoid
 *    confirming existence to unauthenticated or cross-user callers.
 */
router.get("/substrate/:id", asyncHandler(async (req, res) => {
  const paramParsed = DatasetIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    res.status(400).json({
      error: "invalid_params",
      details: paramParsed.error.issues.map((i) => i.message).join("; "),
    });
    return;
  }
  const datasetId = paramParsed.data.id;

  // Auth + ownership guard for custom (UUID-format) dataset IDs.
  if (CUSTOM_DATASET_UUID_RE.test(datasetId) && !ALL_PRESET_DATASETS.some((d) => d.id === datasetId)) {
    const callerId = getAuth(req)?.userId ?? null;
    if (!callerId) {
      res.status(401).json({ error: "unauthenticated", details: "Authentication required" });
      return;
    }
    const [ownRow] = await db
      .select({
        userId:                  customDatasetsTable.userId,
        terrainJson:             customDatasetsTable.terrainJson,
        noaaSubstrateSamplesJson: customDatasetsTable.noaaSubstrateSamplesJson,
      })
      .from(customDatasetsTable)
      .where(and(eq(customDatasetsTable.id, datasetId), eq(customDatasetsTable.userId, callerId)));
    if (!ownRow) {
      res.status(404).json({ error: "not_found", details: `Dataset '${datasetId}' not found` });
      return;
    }

    // Convert any stored NOAA historical bottom-sample points to GeoJSON Point features.
    const noaaSampleFeatures = ownRow.noaaSubstrateSamplesJson
      ? noaaSamplesToGeoJson(ownRow.noaaSubstrateSamplesJson)
      : [];

    // Resolve the custom dataset's bbox from its stored terrainJson and return
    // substrate coverage using the same spatial index as preset datasets.
    const tj = ownRow.terrainJson;
    const customBbox = {
      minLon: tj.minLon,
      minLat: tj.minLat,
      maxLon: tj.maxLon,
      maxLat: tj.maxLat,
    };
    const customSlice = getSubstrateForDataset(datasetId, customBbox);
    const customSources = customSlice.sources
      .filter((s) => s.featureCount > 0)
      .map((s) => ({ ...SOURCE_PROVENANCE[s.source], source: s.source, featureCount: s.featureCount }));

    // Merge NOAA sample point features with any regional polygon features.
    // Sample points are appended after polygon features so they draw on top.
    const mergedFeatures = [...customSlice.features, ...noaaSampleFeatures];

    const customBaseMetadata = {
      datasetId,
      datasetBbox: customBbox,
      source:        "alaska-shorezone" as const,
      sourceName:    ALASKA_SHOREZONE.metadata.sourceName,
      sourceLayer:   ALASKA_SHOREZONE.metadata.sourceLayer,
      sourceService: ALASKA_SHOREZONE.metadata.sourceService,
      sourceRegion:  ALASKA_SHOREZONE.metadata.region,
      sourceBbox:    ALASKA_SHOREZONE.metadata.bbox,
      creditUrl:     ALASKA_SHOREZONE.metadata.creditUrl,
      fetchedAt:     ALASKA_SHOREZONE.metadata.fetchedAt,
      featureCount:  mergedFeatures.length,
      totalFeatures: mergedFeatures.length,
      region:        customSlice.region,
      coverageBbox:  customSlice.coverageBbox,
      sources:       customSources,
      noaaSampleCount: noaaSampleFeatures.length,
      methodology:
        "Substrate polygons merged from two authoritative sources: " +
        "(1) Alaska ShoreZone AK_SZ_ITZ_Polygons (NOAA AKR / ADF&G) — " +
        "intertidal-zone polygons classified into CMECS broad substrate " +
        "categories (bedrock / gravel / sand / mud) via Mat_Desc + Form_Desc; " +
        "(2) NOAA ENC Coastal.Seabed_Area (S-57 SBDARE) — chart-derived " +
        "seabed polygons classified via the NATSUR attribute. Both regional " +
        "bundles are clipped to the dataset AOI bbox at request time, and " +
        "each feature carries `properties.source` for per-feature attribution.",
      credit:
        "Alaska ShoreZone (NOAA AKR / ADF&G) and NOAA Office of Coast Survey " +
        "Electronic Navigational Charts — both public domain.",
    };

    // When no regional polygon coverage exists but NOAA sample points are
    // present, return those sample points with a metadata note rather than
    // the "no coverage" early-exit, so the substrate overlay populates.
    if (!customSlice.hasCoverage && noaaSampleFeatures.length === 0) {
      const distanceKm = Math.round(customSlice.nearestCoverageKm);
      const NEAREST_BUNDLE_BY_SOURCE: Record<SubstrateSource, ShoreZoneFeatureCollection> = {
        "alaska-shorezone":    ALASKA_SHOREZONE,
        "noaa-enc-coastal":    ENC_SE_ALASKA_SUBSTRATE,
        "noaa-enc-conus":      ENC_CONUS_SUBSTRATE,
        "tpwd-tx-reservoirs":  TX_LAKE_SUBSTRATE,
        "aoos-intertidal-pow": AOOS_INTERTIDAL_POW,
      };
      const nearestBundle =
        (customSlice.nearestSource && NEAREST_BUNDLE_BY_SOURCE[customSlice.nearestSource]) ||
        ALASKA_SHOREZONE;
      res.json({
        type: "FeatureCollection",
        features: [],
        metadata: {
          ...customBaseMetadata,
          nearestCoverage: {
            source:     nearestBundle.metadata.source,
            region:     nearestBundle.metadata.region,
            bbox:       nearestBundle.metadata.bbox,
            distanceKm,
          },
          note:
            `No published substrate polygons (ShoreZone or ENC) intersect the ` +
            `uploaded dataset '${datasetId}' AOI bbox. Nearest real coverage is the ` +
            `${nearestBundle.metadata.region}, ~${distanceKm} km away.`,
        },
      });
      return;
    }

    res.json({
      type: "FeatureCollection",
      features: mergedFeatures,
      metadata: customBaseMetadata,
    });
    return;
  }

  const meta = ALL_PRESET_DATASETS.find((d) => d.id === datasetId);
  if (!meta) {
    res.status(404).json({ error: "not_found", details: `Dataset '${datasetId}' not found` });
    return;
  }

  const slice = getSubstrateForDataset(datasetId, meta.bbox);
  // Per-source provenance for the sources that actually contributed
  // features to this slice (priority order preserved).
  const sources = slice.sources
    .filter((s) => s.featureCount > 0)
    .map((s) => ({ ...SOURCE_PROVENANCE[s.source], source: s.source, featureCount: s.featureCount }));

  // Back-compat: keep top-level `source`/`sourceLayer`/etc. pointing at the
  // ShoreZone bundle (the original source for this route). Existing clients
  // that read those scalar fields continue to work; new clients should
  // read `metadata.sources` for per-feature provenance.
  const baseMetadata = {
    datasetId,
    datasetBbox: meta.bbox,
    source:        "alaska-shorezone" as const,
    sourceName:    ALASKA_SHOREZONE.metadata.sourceName,
    sourceLayer:   ALASKA_SHOREZONE.metadata.sourceLayer,
    sourceService: ALASKA_SHOREZONE.metadata.sourceService,
    sourceRegion:  ALASKA_SHOREZONE.metadata.region,
    sourceBbox:    ALASKA_SHOREZONE.metadata.bbox,
    creditUrl:     ALASKA_SHOREZONE.metadata.creditUrl,
    fetchedAt:     ALASKA_SHOREZONE.metadata.fetchedAt,
    featureCount:  slice.features.length,
    totalFeatures: slice.features.length,
    /** Per-dataset region label describing what the slice represents. */
    region:        slice.region,
    /** Tight bbox of the returned slice, or null when empty. */
    coverageBbox:  slice.coverageBbox,
    /** Per-source counts + provenance for sources that contributed features. */
    sources,
    methodology:
      "Substrate polygons merged from two authoritative sources: " +
      "(1) Alaska ShoreZone AK_SZ_ITZ_Polygons (NOAA AKR / ADF&G) — " +
      "intertidal-zone polygons classified into CMECS broad substrate " +
      "categories (bedrock / gravel / sand / mud) via Mat_Desc + Form_Desc; " +
      "(2) NOAA ENC Coastal.Seabed_Area (S-57 SBDARE) — chart-derived " +
      "seabed polygons classified via the NATSUR attribute. Both regional " +
      "bundles are clipped to the dataset AOI bbox at request time, and " +
      "each feature carries `properties.source` for per-feature attribution.",
    credit:
      "Alaska ShoreZone (NOAA AKR / ADF&G) and NOAA Office of Coast Survey " +
      "Electronic Navigational Charts — both public domain.",
  };

  if (!slice.hasCoverage) {
    const distanceKm = Math.round(slice.nearestCoverageKm);
    // Attribute the "nearest coverage" hint to whichever bundle actually
    // contains the nearest polygon, rather than always pointing at the
    // ShoreZone bundle.
    const NEAREST_BUNDLE_BY_SOURCE: Record<SubstrateSource, ShoreZoneFeatureCollection> = {
      "alaska-shorezone":    ALASKA_SHOREZONE,
      "noaa-enc-coastal":    ENC_SE_ALASKA_SUBSTRATE,
      "noaa-enc-conus":      ENC_CONUS_SUBSTRATE,
      "tpwd-tx-reservoirs":  TX_LAKE_SUBSTRATE,
      "aoos-intertidal-pow": AOOS_INTERTIDAL_POW,
    };
    const nearestBundle =
      (slice.nearestSource && NEAREST_BUNDLE_BY_SOURCE[slice.nearestSource]) ||
      ALASKA_SHOREZONE;
    res.json({
      type: "FeatureCollection",
      features: [],
      metadata: {
        ...baseMetadata,
        nearestCoverage: {
          source:     nearestBundle.metadata.source,
          region:     nearestBundle.metadata.region,
          bbox:       nearestBundle.metadata.bbox,
          distanceKm,
        },
        note:
          `No published substrate polygons (ShoreZone or ENC) intersect the ` +
          `'${datasetId}' AOI bbox. Nearest real coverage is the ` +
          `${nearestBundle.metadata.region}, ~${distanceKm} km away.`,
      },
    });
    return;
  }

  res.json({
    type: "FeatureCollection",
    features: slice.features,
    metadata: baseMetadata,
  });
}));

export default router;
