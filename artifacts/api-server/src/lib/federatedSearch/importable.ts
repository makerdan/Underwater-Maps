/**
 * importable.ts — single source of truth for the importable / link-only
 * badge on federated search results.
 *
 * A result is importable when deriveCatalogFetchStrategy() (the exact same
 * derivation POST /api/terrain/bundles uses) maps its endpoint URL to a
 * working fetcher. Connectors must NOT hand-roll their own importability
 * heuristics — they build a strategy source and call this helper.
 */

import { deriveCatalogFetchStrategy } from "../catalogFetchStrategy.js";
import type { FederatedBbox } from "./types.js";

export interface Importability {
  importable: boolean;
  importKind: string | null;
}

/**
 * Derive importability for a federated result. `id` should be the upstream
 * id (used only for preset/bundled matching, which external results never
 * hit). A null bbox is replaced with a far-south sentinel that cannot fall
 * inside any bundled-terrain footprint.
 */
export function deriveImportability(args: {
  id: string;
  endpointUrl: string | null;
  coverageBbox: FederatedBbox | null;
}): Importability {
  const strategy = deriveCatalogFetchStrategy({
    id: args.id,
    dataType: "bathymetry",
    endpointUrl: args.endpointUrl,
    coverageBbox:
      args.coverageBbox ?? { minLon: 0, minLat: -89, maxLon: 0, maxLat: -89 },
  });
  return {
    importable: strategy !== null,
    importKind: strategy?.kind ?? null,
  };
}
