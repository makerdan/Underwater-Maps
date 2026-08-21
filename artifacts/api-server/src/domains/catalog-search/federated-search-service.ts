/**
 * Provider-neutral federated-search use cases.
 *
 * Connector registration and upstream-specific importability rules stay behind
 * the federated-search adapters. HTTP routes consume only this domain facade.
 */

import {
  deriveImportability,
  listFederatedSources,
  runFederatedSearch,
  type FederatedBbox,
  type FederatedConnector,
  type FederatedSearchResponse,
} from "../../lib/federatedSearch/index.js";

export type { FederatedBbox, FederatedConnector, FederatedSearchResponse };

export const federatedSearchService = Object.freeze({
  run: (
    query: string,
    bbox: FederatedBbox | null,
    options?: {
      connectors?: FederatedConnector[];
      timeoutMs?: number;
      sourceIds?: string[];
    },
  ): Promise<FederatedSearchResponse> => runFederatedSearch(query, bbox, options),
  listSources: listFederatedSources,
  deriveImportability,
});
