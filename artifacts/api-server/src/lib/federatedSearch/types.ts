/**
 * federatedSearch/types.ts — shared types for the multi-source Find Data
 * federated search framework.
 *
 * A "connector" wraps one upstream source (local catalog, NCEI Geoportal,
 * USGS ScienceBase, ArcGIS Online state portals, GitHub allowlist, …). The
 * runner fans out to all connectors concurrently with a per-source timeout,
 * merges the partial results, and reports per-source status so one slow or
 * broken upstream never sinks the whole search.
 */

export interface FederatedBbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** One merged search result from any connector. */
export interface FederatedResultItem {
  /** Globally unique id: `<sourceId>:<upstream id>`. */
  id: string;
  /** Connector id this result came from (e.g. "ncei-geoportal"). */
  sourceId: string;
  /** Human-readable source label (e.g. "NOAA NCEI Geoportal"). */
  sourceLabel: string;
  name: string;
  description: string | null;
  /** Human landing page / metadata link (link-only results open this). */
  url: string | null;
  /**
   * Machine endpoint used for import-strategy derivation (WCS / ArcGIS
   * feature service / ImageServer URL). Null for link-only results.
   */
  endpointUrl: string | null;
  coverageBbox: FederatedBbox | null;
  resolutionMMin: number | null;
  resolutionMMax: number | null;
  /**
   * True when deriveCatalogFetchStrategy() maps this result to a working
   * fetcher — i.e. BathyScan can materialise it as 3-D terrain.
   */
  importable: boolean;
  /** FetchStrategy kind when importable (e.g. "ncei-wcs"), else null. */
  importKind: string | null;
}

export type FederatedSourceState = "ok" | "error" | "timeout";

/** Per-source outcome for the "sources checked" summary. */
export interface FederatedSourceStatus {
  sourceId: string;
  label: string;
  status: FederatedSourceState;
  resultCount: number;
  tookMs: number;
  error: string | null;
}

export interface FederatedSearchResponse {
  results: FederatedResultItem[];
  sources: FederatedSourceStatus[];
}

/** Contract every source connector implements. */
export interface FederatedConnector {
  id: string;
  label: string;
  /**
   * Run the search. Must respect `signal` (per-source timeout abort) and
   * throw on upstream failure — the runner converts throws into a non-fatal
   * per-source error status.
   */
  search(
    q: string,
    bbox: FederatedBbox | null,
    signal: AbortSignal,
  ): Promise<FederatedResultItem[]>;
}
