/**
 * arcgisPortals.ts — generic ArcGIS portal connector (factory) plus the
 * seeded state-portal configurations.
 *
 * Two portal modes:
 *
 *  "ago" — ArcGIS Online org search (verified live 2026-07-21):
 *     GET https://www.arcgis.com/sharing/rest/search
 *         ?f=json&num=10&q=<query> orgid:<orgId>[&bbox=minLon,minLat,maxLon,maxLat]
 *     Org ids resolved from urlkeys via
 *     https://www.arcgis.com/sharing/rest/portals/<urlkey>?f=json.
 *
 *  "static-services" — for enterprise ArcGIS Servers without a portal
 *     search API (MN DNR's enterprise.gisdata.mn.gov). Pre-declared service
 *     entries are matched locally against the query text.
 *
 * Seeded portals (all endpoints verified live 2026-07-21):
 *   NYSDEC (orgid DZHaqZm9cxOD4CWM), Michigan DNR (Jdnp1TjADvSDxMAX),
 *   WDFW (rcya3vExsaVBGUDp), MassGIS (hGdibHYSPO59RG1h),
 *   CT DEEP (FjPcSmEFuDYlIdKC), State of Maine (RbMX0mRVOFNTdLzd),
 *   Texas Parks & Wildlife (1mtXwieMId59thmg), plus the MN DNR static entry.
 */

import { MN_DNR_BATHY_FEATURE_SERVICE } from "../../terrain.js";
import { deriveImportability } from "../importable.js";
import type { FederatedBbox, FederatedConnector, FederatedResultItem } from "../types.js";

const AGO_SEARCH_URL = "https://www.arcgis.com/sharing/rest/search";
const MAX_RESULTS = 10;

/** Item types worth surfacing as data results (skip web maps, apps, PDFs). */
const AGO_DATA_TYPES = new Set([
  "Feature Service",
  "Map Service",
  "Image Service",
  "WMS",
  "KML",
]);

export interface StaticServiceEntry {
  /** Stable id fragment within the portal. */
  id: string;
  name: string;
  description: string;
  /** Machine endpoint (feature/image service URL). */
  endpointUrl: string;
  /** Human landing page. */
  url: string;
  coverageBbox: FederatedBbox;
  /** Lower-cased match terms for local query filtering. */
  keywords: string[];
}

export type ArcgisPortalConfig =
  | {
      mode: "ago";
      id: string;
      label: string;
      orgId: string;
    }
  | {
      mode: "static-services";
      id: string;
      label: string;
      services: StaticServiceEntry[];
    };

interface AgoSearchResult {
  id?: string;
  title?: string;
  snippet?: string;
  description?: string;
  type?: string;
  url?: string;
  extent?: number[][];
}

interface AgoSearchResponse {
  results?: AgoSearchResult[];
  error?: { message?: string };
}

function agoExtentToBbox(extent: number[][] | undefined): FederatedBbox | null {
  const ll = extent?.[0];
  const ur = extent?.[1];
  if (!ll || !ur || ll.length < 2 || ur.length < 2) return null;
  const [minLon, minLat] = ll;
  const [maxLon, maxLat] = ur;
  if (
    typeof minLon !== "number" || typeof minLat !== "number" ||
    typeof maxLon !== "number" || typeof maxLat !== "number" ||
    !isFinite(minLon) || !isFinite(minLat) || !isFinite(maxLon) || !isFinite(maxLat) ||
    maxLon <= minLon || maxLat <= minLat
  ) {
    return null;
  }
  return { minLon, minLat, maxLon, maxLat };
}

/** Strip HTML tags AGO descriptions often carry. */
function stripHtml(s: string | undefined): string | null {
  if (!s) return null;
  const text = s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
}

async function searchAgoPortal(
  config: Extract<ArcgisPortalConfig, { mode: "ago" }>,
  q: string,
  bbox: FederatedBbox | null,
  signal: AbortSignal,
): Promise<FederatedResultItem[]> {
  const params = new URLSearchParams({
    f: "json",
    num: String(MAX_RESULTS),
    q: `${q || "bathymetry"} orgid:${config.orgId}`,
  });
  if (bbox) {
    params.set("bbox", `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`);
  }
  const resp = await fetch(`${AGO_SEARCH_URL}?${params.toString()}`, { signal });
  if (!resp.ok) {
    throw new Error(`${config.label} portal search returned HTTP ${resp.status}`);
  }
  const raw = (await resp.json()) as AgoSearchResponse;
  if (raw.error) {
    throw new Error(`${config.label} portal search error: ${raw.error.message ?? "unknown"}`);
  }

  const out: FederatedResultItem[] = [];
  for (const item of raw.results ?? []) {
    const title = item.title?.trim();
    if (!item.id || !title) continue;
    if (item.type && !AGO_DATA_TYPES.has(item.type)) continue;

    const coverageBbox = agoExtentToBbox(item.extent);
    const endpointUrl = item.url ?? null;
    const { importable, importKind } = deriveImportability({
      id: `${config.id}-${item.id}`,
      endpointUrl,
      coverageBbox,
    });
    out.push({
      id: `${config.id}:${item.id}`,
      sourceId: config.id,
      sourceLabel: config.label,
      name: title,
      description: stripHtml(item.snippet || item.description),
      url: `https://www.arcgis.com/home/item.html?id=${encodeURIComponent(item.id)}`,
      endpointUrl,
      coverageBbox,
      resolutionMMin: null,
      resolutionMMax: null,
      importable,
      importKind,
    });
  }
  return out;
}

function bboxIntersects(a: FederatedBbox, b: FederatedBbox): boolean {
  return (
    a.maxLon >= b.minLon &&
    a.minLon <= b.maxLon &&
    a.maxLat >= b.minLat &&
    a.minLat <= b.maxLat
  );
}

function searchStaticServices(
  config: Extract<ArcgisPortalConfig, { mode: "static-services" }>,
  q: string,
  bbox: FederatedBbox | null,
): FederatedResultItem[] {
  const tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  const out: FederatedResultItem[] = [];
  for (const svc of config.services) {
    if (bbox && !bboxIntersects(svc.coverageBbox, bbox)) continue;
    if (tokens.length > 0) {
      const haystack = `${svc.name} ${svc.description} ${svc.keywords.join(" ")}`.toLowerCase();
      const matches = tokens.some((t) => haystack.includes(t));
      if (!matches) continue;
    }
    const { importable, importKind } = deriveImportability({
      id: `${config.id}-${svc.id}`,
      endpointUrl: svc.endpointUrl,
      coverageBbox: svc.coverageBbox,
    });
    out.push({
      id: `${config.id}:${svc.id}`,
      sourceId: config.id,
      sourceLabel: config.label,
      name: svc.name,
      description: svc.description,
      url: svc.url,
      endpointUrl: svc.endpointUrl,
      coverageBbox: svc.coverageBbox,
      resolutionMMin: null,
      resolutionMMax: null,
      importable,
      importKind,
    });
  }
  return out;
}

/** Build a FederatedConnector from a portal config. */
export function makeArcgisPortalConnector(config: ArcgisPortalConfig): FederatedConnector {
  return {
    id: config.id,
    label: config.label,
    async search(q, bbox, signal): Promise<FederatedResultItem[]> {
      if (config.mode === "ago") {
        return searchAgoPortal(config, q, bbox, signal);
      }
      return searchStaticServices(config, q, bbox);
    },
  };
}

// ---------------------------------------------------------------------------
// Seeded portal configurations
// ---------------------------------------------------------------------------

export const STATE_PORTAL_CONFIGS: ArcgisPortalConfig[] = [
  { mode: "ago", id: "portal-nysdec", label: "NYSDEC (New York)", orgId: "DZHaqZm9cxOD4CWM" },
  {
    mode: "static-services",
    id: "portal-mndnr",
    label: "MN DNR (Minnesota)",
    services: [
      {
        id: "lake-bathymetry",
        name: "MN DNR Lake Bathymetry (statewide contours)",
        description:
          "Statewide lake bathymetry / depth contours from the Minnesota DNR Lakes database, served from the MN Geospatial Commons enterprise ArcGIS Server.",
        endpointUrl: MN_DNR_BATHY_FEATURE_SERVICE,
        url: "https://gisdata.mn.gov/dataset/water-lake-bathymetry",
        coverageBbox: { minLon: -97.24, minLat: 43.5, maxLon: -89.48, maxLat: 49.38 },
        keywords: ["bathymetry", "lake", "depth", "contour", "minnesota", "mn", "dnr"],
      },
    ],
  },
  { mode: "ago", id: "portal-midnr", label: "Michigan DNR", orgId: "Jdnp1TjADvSDxMAX" },
  { mode: "ago", id: "portal-wdfw", label: "WDFW (Washington)", orgId: "rcya3vExsaVBGUDp" },
  { mode: "ago", id: "portal-massgis", label: "MassGIS (Massachusetts)", orgId: "hGdibHYSPO59RG1h" },
  { mode: "ago", id: "portal-ctdeep", label: "CT DEEP (Connecticut)", orgId: "FjPcSmEFuDYlIdKC" },
  { mode: "ago", id: "portal-maine", label: "State of Maine", orgId: "RbMX0mRVOFNTdLzd" },
  { mode: "ago", id: "portal-tpwd", label: "Texas Parks & Wildlife", orgId: "1mtXwieMId59thmg" },
];

export const statePortalConnectors: FederatedConnector[] =
  STATE_PORTAL_CONFIGS.map(makeArcgisPortalConnector);
