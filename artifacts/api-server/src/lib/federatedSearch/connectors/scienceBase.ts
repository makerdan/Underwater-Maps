/**
 * scienceBase.ts — federated connector for the USGS ScienceBase catalog.
 *
 * Upstream (verified live 2026-07-21):
 *   GET https://www.sciencebase.gov/catalog/items
 *       ?q=<query>&format=json&max=20&fields=title,summary,spatial,webLinks
 *
 * Response: { items: [{ id, title, summary?, link: {url},
 *   spatial?: { boundingBox: { minX, maxX, minY, maxY } },
 *   webLinks?: [{ uri, type?, title? }] }] }
 *
 * ScienceBase items are metadata records — they rarely expose a direct
 * raster endpoint we can fetch, so importability is derived from the first
 * web link URL (usually null strategy ⇒ link-only badge).
 */

import { deriveImportability } from "../importable.js";
import type { FederatedBbox, FederatedConnector, FederatedResultItem } from "../types.js";

const SCIENCEBASE_URL = "https://www.sciencebase.gov/catalog/items";
const MAX_RESULTS = 20;

interface ScienceBaseItem {
  id?: string;
  title?: string;
  summary?: string;
  link?: { url?: string };
  spatial?: {
    boundingBox?: { minX?: number; maxX?: number; minY?: number; maxY?: number };
  };
  webLinks?: Array<{ uri?: string; type?: string; title?: string }>;
}

interface ScienceBaseResponse {
  items?: ScienceBaseItem[];
}

function itemBbox(item: ScienceBaseItem): FederatedBbox | null {
  const bb = item.spatial?.boundingBox;
  if (
    !bb ||
    typeof bb.minX !== "number" ||
    typeof bb.maxX !== "number" ||
    typeof bb.minY !== "number" ||
    typeof bb.maxY !== "number" ||
    bb.maxX <= bb.minX ||
    bb.maxY <= bb.minY
  ) {
    return null;
  }
  return { minLon: bb.minX, minLat: bb.minY, maxLon: bb.maxX, maxLat: bb.maxY };
}

function bboxIntersects(a: FederatedBbox, b: FederatedBbox): boolean {
  return (
    a.maxLon >= b.minLon &&
    a.minLon <= b.maxLon &&
    a.maxLat >= b.minLat &&
    a.minLat <= b.maxLat
  );
}

export const scienceBaseConnector: FederatedConnector = {
  id: "usgs-sciencebase",
  label: "USGS ScienceBase",

  async search(
    q: string,
    bbox: FederatedBbox | null,
    signal: AbortSignal,
  ): Promise<FederatedResultItem[]> {
    const params = new URLSearchParams({
      q: q || "bathymetry",
      format: "json",
      max: String(MAX_RESULTS),
      fields: "title,summary,spatial,webLinks",
    });
    const resp = await fetch(`${SCIENCEBASE_URL}?${params.toString()}`, { signal });
    if (!resp.ok) {
      throw new Error(`ScienceBase returned HTTP ${resp.status}`);
    }
    const raw = (await resp.json()) as ScienceBaseResponse;
    const items = raw.items ?? [];

    const out: FederatedResultItem[] = [];
    for (const item of items) {
      const title = item.title?.trim();
      if (!item.id || !title) continue;
      const coverageBbox = itemBbox(item);
      // When a viewport bbox is given, drop items that carry a bbox which
      // definitively does not intersect it; keep bbox-less items (unknown).
      if (bbox && coverageBbox && !bboxIntersects(coverageBbox, bbox)) continue;

      const endpointUrl = item.webLinks?.find((l) => l.uri)?.uri ?? null;
      const { importable, importKind } = deriveImportability({
        id: `sciencebase-${item.id}`,
        endpointUrl,
        coverageBbox,
      });
      out.push({
        id: `usgs-sciencebase:${item.id}`,
        sourceId: "usgs-sciencebase",
        sourceLabel: "USGS ScienceBase",
        name: title,
        description: item.summary?.trim() || null,
        url: item.link?.url ?? `https://www.sciencebase.gov/catalog/item/${item.id}`,
        endpointUrl,
        coverageBbox,
        resolutionMMin: null,
        resolutionMMax: null,
        importable,
        importKind,
      });
    }
    return out;
  },
};
