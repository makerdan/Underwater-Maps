/**
 * nceiGeoportal.ts — federated connector for the NCEI Bathymetry Geoportal.
 *
 * Reuses searchNceiGeoportal() from the existing /api/ncei/search proxy so
 * the two code paths share one fetch/normalise implementation (memory rule:
 * omit the `f` param — the geoportal returns ES hits.hits by default).
 *
 * Importability: NCEI portal results are materialised via the NCEI WCS
 * mosaics, so an available result's endpoint is the DEM Global Mosaic WCS —
 * deriveCatalogFetchStrategy maps it to `ncei-wcs`, keeping the derivation
 * as the single source of truth for the importable badge.
 */

import { searchNceiGeoportal } from "../../../routes/ncei.js";
import { deriveImportability } from "../importable.js";
import type { FederatedBbox, FederatedConnector, FederatedResultItem } from "../types.js";

/** WCS endpoint used to materialise wcsAvailable portal results. */
const NCEI_DEM_GLOBAL_MOSAIC_WCS =
  "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/DEM_global_mosaic/ImageServer/WCSServer";

const MAX_RESULTS = 20;

export const nceiGeoportalConnector: FederatedConnector = {
  id: "ncei-geoportal",
  label: "NOAA NCEI Geoportal",

  async search(
    q: string,
    bbox: FederatedBbox | null,
    signal: AbortSignal,
  ): Promise<FederatedResultItem[]> {
    const results = await searchNceiGeoportal(
      {
        q,
        bbox: bbox
          ? `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`
          : "",
        from: 1,
        max: MAX_RESULTS,
        broad: false,
      },
      signal,
    );

    return results.map((r) => {
      const endpointUrl = r.wcsAvailable ? NCEI_DEM_GLOBAL_MOSAIC_WCS : null;
      const { importable, importKind } = deriveImportability({
        id: `ncei-portal-${r.id}`,
        endpointUrl,
        coverageBbox: r.coverageBbox,
      });
      return {
        id: `ncei-geoportal:${r.id}`,
        sourceId: "ncei-geoportal",
        sourceLabel: "NOAA NCEI Geoportal",
        name: r.name,
        description: r.description,
        url: r.metadataUrl,
        endpointUrl,
        coverageBbox: r.coverageBbox,
        resolutionMMin: r.resolutionMMin,
        resolutionMMax: r.resolutionMMax,
        importable,
        importKind,
      };
    });
  },
};
