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
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, customDatasetsTable } from "@workspace/db";
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
router.get("/substrate/:id", async (req, res) => {
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
      .select({ userId: customDatasetsTable.userId })
      .from(customDatasetsTable)
      .where(and(eq(customDatasetsTable.id, datasetId), eq(customDatasetsTable.userId, callerId)));
    if (!ownRow) {
      res.status(404).json({ error: "not_found", details: `Dataset '${datasetId}' not found` });
      return;
    }
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
});

export default router;
