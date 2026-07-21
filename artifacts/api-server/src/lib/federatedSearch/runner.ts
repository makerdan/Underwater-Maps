/**
 * runner.ts — concurrent fan-out engine for federated search.
 *
 * Every connector runs in parallel with its own AbortController + timeout.
 * A slow / failing / rate-limited source degrades to a per-source status
 * entry ("timeout" / "error") — it never fails the whole search. Results
 * are merged in connector-registration order (local catalog first, then
 * NCEI, then the remaining externals).
 */

import { logger } from "../logger.js";
import type {
  FederatedBbox,
  FederatedConnector,
  FederatedResultItem,
  FederatedSearchResponse,
  FederatedSourceStatus,
} from "./types.js";
import { localCatalogConnector } from "./connectors/localCatalog.js";
import { nceiGeoportalConnector } from "./connectors/nceiGeoportal.js";
import { scienceBaseConnector } from "./connectors/scienceBase.js";
import { usgs3depCoverageConnector } from "./connectors/usgs3depCoverage.js";
import { statePortalConnectors } from "./connectors/arcgisPortals.js";
import { githubAllowlistConnector } from "./connectors/githubAllowlist.js";

export const DEFAULT_SOURCE_TIMEOUT_MS = 8_000;

/** Hard cap per source so one chatty upstream can't flood the merged list. */
const MAX_RESULTS_PER_SOURCE = 20;

/** First-wave connector registry, in merge order. */
export function getDefaultConnectors(): FederatedConnector[] {
  return [
    localCatalogConnector,
    nceiGeoportalConnector,
    scienceBaseConnector,
    usgs3depCoverageConnector,
    ...statePortalConnectors,
    githubAllowlistConnector,
  ];
}

interface ConnectorOutcome {
  status: FederatedSourceStatus;
  results: FederatedResultItem[];
}

async function runConnector(
  connector: FederatedConnector,
  q: string,
  bbox: FederatedBbox | null,
  timeoutMs: number,
): Promise<ConnectorOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const results = (await connector.search(q, bbox, controller.signal)).slice(
      0,
      MAX_RESULTS_PER_SOURCE,
    );
    return {
      results,
      status: {
        sourceId: connector.id,
        label: connector.label,
        status: "ok",
        resultCount: results.length,
        tookMs: Date.now() - started,
        error: null,
      },
    };
  } catch (err) {
    const timedOut = controller.signal.aborted;
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.warn(
      { source: connector.id, timedOut, err: message },
      "federated search — source failed (non-fatal)",
    );
    return {
      results: [],
      status: {
        sourceId: connector.id,
        label: connector.label,
        status: timedOut ? "timeout" : "error",
        resultCount: 0,
        tookMs: Date.now() - started,
        error: timedOut ? `Timed out after ${timeoutMs} ms` : message,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Static id+label registry so clients can fan out per source. */
export function listFederatedSources(): Array<{ id: string; label: string }> {
  return getDefaultConnectors().map((c) => ({ id: c.id, label: c.label }));
}

export async function runFederatedSearch(
  q: string,
  bbox: FederatedBbox | null,
  options?: {
    connectors?: FederatedConnector[];
    timeoutMs?: number;
    /** When non-empty, only run connectors whose id is in this set. */
    sourceIds?: string[];
  },
): Promise<FederatedSearchResponse> {
  let connectors = options?.connectors ?? getDefaultConnectors();
  if (options?.sourceIds && options.sourceIds.length > 0) {
    const wanted = new Set(options.sourceIds);
    connectors = connectors.filter((c) => wanted.has(c.id));
  }
  const timeoutMs = options?.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;

  const outcomes = await Promise.all(
    connectors.map((c) => runConnector(c, q, bbox, timeoutMs)),
  );

  return {
    results: outcomes.flatMap((o) => o.results),
    sources: outcomes.map((o) => o.status),
  };
}
