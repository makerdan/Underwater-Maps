/**
 * localCatalog.ts — federated connector for BathyScan's own dataset catalog.
 *
 * Thin wrapper over searchCatalog() (the same MiniSearch pipeline behind
 * GET /api/datasets/catalog/search) so the curated catalog participates in
 * the federated fan-out with identical ranking.
 */

import { searchCatalog } from "../../catalogSeeder.js";
import { deriveCatalogFetchStrategy } from "../../catalogFetchStrategy.js";
import type { FederatedBbox, FederatedConnector, FederatedResultItem } from "../types.js";

const MAX_RESULTS = 20;

export const localCatalogConnector: FederatedConnector = {
  id: "local-catalog",
  label: "BathyScan Catalog",

  async search(q: string, bbox: FederatedBbox | null): Promise<FederatedResultItem[]> {
    const results = await searchCatalog({
      q,
      ...(bbox
        ? {
            minLon: bbox.minLon,
            minLat: bbox.minLat,
            maxLon: bbox.maxLon,
            maxLat: bbox.maxLat,
          }
        : {}),
    });

    return results.slice(0, MAX_RESULTS).map((e) => {
      // Real catalog entries carry their true dataType — use the full
      // derivation directly rather than the bathymetry-assuming helper.
      const strategy = deriveCatalogFetchStrategy(e);
      return {
        id: `local-catalog:${e.id}`,
        sourceId: "local-catalog",
        sourceLabel: "BathyScan Catalog",
        name: e.name,
        description: e.description ?? null,
        url: e.endpointUrl ?? null,
        endpointUrl: e.endpointUrl ?? null,
        coverageBbox: e.coverageBbox,
        resolutionMMin: e.resolutionMMin ?? null,
        resolutionMMax: e.resolutionMMax ?? null,
        importable: strategy !== null,
        importKind: strategy?.kind ?? null,
      };
    });
  },
};
