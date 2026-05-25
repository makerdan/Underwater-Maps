/**
 * catalogSeeder.ts
 *
 * Seeds the `dataset_catalog` table from a static list of known public data
 * sources on API server startup. Runs only when the table is empty — safe to
 * call on every boot.
 *
 * Data sources indexed:
 *   - All BathyScan preset bathymetry datasets (NCEI/GEBCO/synthetic)
 *   - NOAA EFH shapefiles by species (Thorne Bay / SE Alaska)
 *   - Alaska CMECS substrate layer (ShoreZone-derived)
 *   - GEBCO 2024 global bathymetry grid
 *   - USGS Coastal National Elevation Database (CoNED) lidar for SE Alaska
 *   - NOAA Electronic Navigational Charts (ENC) — bathymetric chart type
 */

import { db, datasetCatalogTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ALL_PRESET_DATASETS } from "./terrain.js";

export interface CatalogSeedEntry {
  id: string;
  name: string;
  sourceAgency: string;
  dataType: "bathymetry" | "substrate" | "habitat" | "lidar" | "chart";
  resolutionMMin: number | null;
  resolutionMMax: number | null;
  coverageBbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  endpointUrl: string | null;
  accessNotes: string | null;
  description: string | null;
  keywords: string | null;
  lastUpdated: string | null;
  waterType: "saltwater" | "freshwater";
}

/** Static catalogue entries for known external public data sources. */
const EXTRA_CATALOG_ENTRIES: CatalogSeedEntry[] = [
  {
    id: "gebco-2024-global",
    name: "GEBCO 2024 Global Bathymetric Grid",
    sourceAgency: "GEBCO / BODC",
    dataType: "bathymetry",
    resolutionMMin: 400,
    resolutionMMax: 400,
    coverageBbox: { minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 },
    endpointUrl: "https://www.gebco.net/data_and_products/gebco_web_services/web_map_service/",
    accessNotes: "Freely available via WCS/WMS. Global coverage at ~400 m resolution.",
    description: "The General Bathymetric Chart of the Oceans (GEBCO) 2024 release — a continuous global terrain model compiled from multibeam surveys and satellite altimetry.",
    keywords: "global,ocean,bathymetry,GEBCO,seabed,depth,terrain",
    lastUpdated: "2024-03-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-bag-mosaic-alaska",
    name: "NCEI Multibeam Bag Mosaic — SE Alaska",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 50,
    coverageBbox: { minLon: -170, minLat: 54, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://gis.ngdc.noaa.gov/arcgis/services/bag_mosaic/ImageServer/WCSServer",
    accessNotes: "Requires WCS query. Coverage limited to surveyed coastal corridors.",
    description: "High-resolution multibeam echosounder survey composite from NOAA National Centers for Environmental Information (NCEI). Covers Inside Passage and Alaskan coastal waters at 1–50 m resolution where surveys exist.",
    keywords: "Alaska,NCEI,multibeam,inside passage,high resolution,survey,bathymetry,SE Alaska,Thorne Bay,Clarence Strait",
    lastUpdated: "2024-06-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-pcod",
    name: "NOAA EFH — Pacific Cod (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) zones for Pacific Cod (Gadus macrocephalus) in Alaskan waters. Designates areas necessary for spawning, breeding, feeding, and growth to maturity.",
    keywords: "EFH,essential fish habitat,Pacific cod,cod,Gadus,Alaska,fishing,habitat,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-halibut",
    name: "NOAA EFH — Pacific Halibut (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download.",
    description: "Essential Fish Habitat (EFH) for Pacific Halibut (Hippoglossus stenolepis). Covers shelf and slope waters used for juvenile nursery habitat and adult feeding grounds.",
    keywords: "EFH,essential fish habitat,halibut,Hippoglossus,Alaska,NOAA,NMFS,flatfish,habitat,fishing",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-rockfish",
    name: "NOAA EFH — Rockfish Complex (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download.",
    description: "Essential Fish Habitat (EFH) for SE Alaska rockfish complex including yelloweye, black, and canary rockfish. Rocky reef and kelp-bed habitats.",
    keywords: "EFH,essential fish habitat,rockfish,yelloweye,black rockfish,Sebastes,Alaska,NOAA,reef,kelp,habitat",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "alaska-shorezone-substrate",
    name: "Alaska ShoreZone — Intertidal Substrate",
    sourceAgency: "Alaska Dept of Fish & Game / NOAA",
    dataType: "substrate",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 54, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://alaskafisheries.noaa.gov/shorezone/",
    accessNotes: "GIS data available through NOAA/ADF&G. Covers intertidal zone — not subtidal/bathymetric substrate.",
    description: "CMECS-compatible substrate classification for Alaska's intertidal shorezone. Mapped from aerial photography and field surveys. Useful for nearshore habitat studies and EFH assessments.",
    keywords: "substrate,ShoreZone,intertidal,CMECS,Alaska,nearshore,habitat,sediment,rocky,gravel,sand",
    lastUpdated: "2022-09-01",
    waterType: "saltwater",
  },
  {
    id: "usgs-coned-lidar-alaska",
    name: "USGS CoNED — Coastal Lidar (SE Alaska)",
    sourceAgency: "USGS / NOAA Office for Coastal Management",
    dataType: "lidar",
    resolutionMMin: 1,
    resolutionMMax: 5,
    coverageBbox: { minLon: -138, minLat: 55, maxLon: -130, maxLat: 60 },
    endpointUrl: "https://coast.noaa.gov/htdata/lidar1_z/geoid12b/data/",
    accessNotes: "Topographic lidar — covers land and intertidal zones, not subtidal seafloor. Requires NOAA Digital Coast data portal download.",
    description: "USGS Coastal National Elevation Database (CoNED) lidar-derived topography for SE Alaska coastal areas. 1–5 m resolution DEMs for shoreline change analysis and coastal zone management.",
    keywords: "lidar,LiDAR,topography,coastal,elevation,DEM,USGS,Alaska,SE Alaska,CoNED,nearshore",
    lastUpdated: "2021-04-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-enc-se-alaska",
    name: "NOAA ENC — SE Alaska Electronic Navigational Charts",
    sourceAgency: "NOAA/OCS",
    dataType: "chart",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -138, minLat: 55, maxLon: -130, maxLat: 60 },
    endpointUrl: "https://charts.noaa.gov/ENCs/ENCs.shtml",
    accessNotes: "Freely downloadable as S-57 ENCs. Contains sounding data, obstruction features, and nautical chart layers.",
    description: "NOAA Electronic Navigational Charts (ENCs) for SE Alaska waters including Inside Passage, Prince of Wales Island, and Dixon Entrance. Contains bathymetric soundings, shoreline, and marine hazards.",
    keywords: "chart,navigational,ENC,S-57,soundings,nautical,NOAA,Alaska,inside passage,Prince of Wales,Dixon Entrance",
    lastUpdated: "2024-01-01",
    waterType: "saltwater",
  },
];

function buildPresetCatalogEntries(): CatalogSeedEntry[] {
  return ALL_PRESET_DATASETS.map((d) => ({
    id: `preset-${d.id}`,
    name: d.name,
    sourceAgency: d.waterType === "saltwater" ? "NOAA/NCEI + GEBCO" : "GEBCO / Synthetic",
    dataType: "bathymetry" as const,
    resolutionMMin: d.waterType === "saltwater" && d.id === "thorne-bay" ? 1 : 400,
    resolutionMMax: 400,
    coverageBbox: d.bbox,
    endpointUrl: null,
    accessNotes: "Available directly in BathyScan viewer — select from the Datasets panel.",
    description: d.description,
    keywords: [d.name, d.waterType, "bathymetry", "terrain", d.id].join(","),
    lastUpdated: "2024-01-01",
    waterType: d.waterType,
  }));
}

let seeded = false;

export async function seedDatasetCatalog(): Promise<void> {
  if (seeded) return;
  seeded = true;

  try {
    const count = await db.execute(sql`SELECT COUNT(*) FROM dataset_catalog`);
    const existing = Number((count.rows[0] as { count: string }).count ?? "0");
    if (existing > 0) {
      console.info(`[catalog] Already seeded (${existing} rows) — skipping.`);
      return;
    }

    const entries: CatalogSeedEntry[] = [
      ...buildPresetCatalogEntries(),
      ...EXTRA_CATALOG_ENTRIES,
    ];

    await db.insert(datasetCatalogTable).values(entries);
    console.info(`[catalog] Seeded ${entries.length} catalog entries.`);
  } catch (err) {
    console.warn(`[catalog] Seed failed (non-fatal): ${(err as Error).message}`);
    seeded = false;
  }
}

// ---------------------------------------------------------------------------
// In-memory catalog search (avoids round-tripping to DB for every query)
// ---------------------------------------------------------------------------

let inMemoryCatalog: CatalogSeedEntry[] | null = null;

export async function getCatalogEntries(): Promise<CatalogSeedEntry[]> {
  if (inMemoryCatalog) return inMemoryCatalog;
  await seedDatasetCatalog();
  const rows = await db.select().from(datasetCatalogTable);
  inMemoryCatalog = rows as unknown as CatalogSeedEntry[];
  return inMemoryCatalog;
}

/** Simple TF-IDF-style keyword scorer. Returns 0–1 relevance. */
export function scoreEntry(entry: CatalogSeedEntry, terms: string[]): number {
  if (terms.length === 0) return 1;
  const haystack = [
    entry.name,
    entry.description ?? "",
    entry.keywords ?? "",
    entry.sourceAgency,
    entry.dataType,
  ]
    .join(" ")
    .toLowerCase();

  const hits = terms.filter((t) => haystack.includes(t.toLowerCase())).length;
  return hits / terms.length;
}

export interface CatalogSearchParams {
  q?: string;
  dataType?: string;
  waterType?: string;
  minLon?: number;
  minLat?: number;
  maxLon?: number;
  maxLat?: number;
}

export interface CatalogSearchResult extends CatalogSeedEntry {
  relevanceScore: number;
  createdAt: string;
}

/** Search the catalog. Returns results sorted by relevance. */
export async function searchCatalog(
  params: CatalogSearchParams,
  _entries?: CatalogSeedEntry[],
): Promise<CatalogSearchResult[]> {
  const entries = _entries ?? await getCatalogEntries();
  const terms = (params.q ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  let results = entries
    .filter((e) => {
      if (params.dataType && e.dataType !== params.dataType) return false;
      if (params.waterType && e.waterType !== params.waterType) return false;
      if (
        params.minLon !== undefined &&
        params.minLat !== undefined &&
        params.maxLon !== undefined &&
        params.maxLat !== undefined
      ) {
        const bbox = e.coverageBbox;
        const overlaps =
          bbox.minLon < params.maxLon &&
          bbox.maxLon > params.minLon &&
          bbox.minLat < params.maxLat &&
          bbox.maxLat > params.minLat;
        if (!overlaps) return false;
      }
      return true;
    })
    .map((e) => ({
      ...e,
      createdAt: new Date().toISOString(),
      relevanceScore: scoreEntry(e, terms),
    }))
    .filter((r) => terms.length === 0 || r.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  return results;
}
