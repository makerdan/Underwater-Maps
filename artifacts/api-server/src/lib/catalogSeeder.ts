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
import { inArray, notInArray, sql } from "drizzle-orm";
import { ALL_PRESET_DATASETS, NCEI_DATASET_COVERAGES } from "./terrain.js";

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
    keywords: "Alaska,NCEI,multibeam,inside passage,high resolution,survey,bathymetry,SE Alaska,Thorne Bay,Clarence Strait,Ketchikan,Sitka,Juneau",
    lastUpdated: "2024-06-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-dem-global-mosaic",
    name: "NCEI DEM Global Mosaic — SE Alaska Coverage",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 8,
    resolutionMMax: 90,
    coverageBbox: { minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 },
    endpointUrl: "https://gis.ngdc.noaa.gov/arcgis/services/DEM_global_mosaic/ImageServer/WCSServer",
    accessNotes: "WCS endpoint serving NCEI's best-available DEM mosaic. Integrates community/tsunami DEMs for Juneau, Sitka, Ketchikan, Craig, Skagway, Wrangell, and Petersburg at 8–30 m where they exist.",
    description: "NCEI's integrated best-available DEM. In SE Alaska it blends multiple community DEMs (1/3 and 8/15 arc-second tsunami models) into a seamless 8–30 m bathy/topo grid, falling back to coarser regional grids elsewhere.",
    keywords: "Alaska,NCEI,DEM,community DEM,tsunami DEM,Juneau,Sitka,Ketchikan,Craig,Skagway,Wrangell,Petersburg,SE Alaska,high resolution,bathymetry,topography",
    lastUpdated: "2024-06-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-community-dem-juneau",
    name: "NCEI Community DEM — Juneau, AK (1/3 arc-second)",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 10,
    coverageBbox: { minLon: -135.2, minLat: 57.9, maxLon: -133.8, maxLat: 58.7 },
    endpointUrl: "https://www.ncei.noaa.gov/products/coastal-elevation-models",
    accessNotes: "Integrated bathy/topo DEM built for tsunami inundation modelling. Accessed via the NCEI DEM Global Mosaic WCS in BathyScan.",
    description: "Juneau, Alaska 1/3 arc-second (~10 m) integrated bathy/topo DEM. Covers Stephens Passage, Lynn Canal approaches, Gastineau Channel, and the Juneau road system.",
    keywords: "Juneau,Alaska,NCEI,community DEM,tsunami,bathymetry,topography,Stephens Passage,Lynn Canal,Gastineau,SE Alaska",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-community-dem-sitka",
    name: "NCEI Community DEM — Sitka, AK (8/15 arc-second)",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 16,
    resolutionMMax: 16,
    coverageBbox: { minLon: -136.0, minLat: 56.7, maxLon: -135.0, maxLat: 57.25 },
    endpointUrl: "https://www.ncei.noaa.gov/products/coastal-elevation-models",
    accessNotes: "Accessed via the NCEI DEM Global Mosaic WCS in BathyScan.",
    description: "Sitka, Alaska 8/15 arc-second (~16 m) integrated bathy/topo DEM covering Sitka Sound and the outer Baranof Island coast.",
    keywords: "Sitka,Alaska,NCEI,community DEM,tsunami,bathymetry,topography,Sitka Sound,Baranof,SE Alaska",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-community-dem-ketchikan",
    name: "NCEI Community DEM — Ketchikan, AK (8/15 arc-second)",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 16,
    resolutionMMax: 16,
    coverageBbox: { minLon: -132.3, minLat: 55.0, maxLon: -131.0, maxLat: 55.7 },
    endpointUrl: "https://www.ncei.noaa.gov/products/coastal-elevation-models",
    accessNotes: "Accessed via the NCEI DEM Global Mosaic WCS in BathyScan.",
    description: "Ketchikan, Alaska 8/15 arc-second (~16 m) integrated bathy/topo DEM covering Tongass Narrows, Revillagigedo Channel, and Clarence Strait approaches.",
    keywords: "Ketchikan,Alaska,NCEI,community DEM,tsunami,bathymetry,topography,Tongass Narrows,Revillagigedo,SE Alaska",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-community-dem-craig",
    name: "NCEI Community DEM — Craig, AK (1/3 arc-second)",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 10,
    coverageBbox: { minLon: -133.7, minLat: 55.2, maxLon: -132.6, maxLat: 55.8 },
    endpointUrl: "https://www.ncei.noaa.gov/products/coastal-elevation-models",
    accessNotes: "Accessed via the NCEI DEM Global Mosaic WCS in BathyScan.",
    description: "Craig, Alaska 1/3 arc-second (~10 m) integrated bathy/topo DEM covering Craig, Klawock, Bucareli Bay, and the west side of Prince of Wales Island.",
    keywords: "Craig,Klawock,Alaska,NCEI,community DEM,tsunami,bathymetry,topography,Prince of Wales,Bucareli Bay,SE Alaska",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-community-dem-skagway",
    name: "NCEI Community DEM — Skagway, AK (1/3 arc-second)",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 10,
    coverageBbox: { minLon: -135.85, minLat: 58.95, maxLon: -134.85, maxLat: 59.55 },
    endpointUrl: "https://www.ncei.noaa.gov/products/coastal-elevation-models",
    accessNotes: "Accessed via the NCEI DEM Global Mosaic WCS in BathyScan.",
    description: "Skagway / Haines, Alaska 1/3 arc-second (~10 m) integrated bathy/topo DEM covering upper Lynn Canal at the head of the Inside Passage.",
    keywords: "Skagway,Haines,Alaska,NCEI,community DEM,tsunami,bathymetry,topography,Lynn Canal,SE Alaska",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-community-dem-wrangell-petersburg",
    name: "NCEI Community DEM — Wrangell & Petersburg, AK",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 16,
    resolutionMMax: 30,
    coverageBbox: { minLon: -133.5, minLat: 56.2, maxLon: -132.0, maxLat: 57.0 },
    endpointUrl: "https://www.ncei.noaa.gov/products/coastal-elevation-models",
    accessNotes: "Accessed via the NCEI DEM Global Mosaic WCS in BathyScan.",
    description: "Wrangell and Petersburg community DEMs covering Wrangell Narrows, Frederick Sound, and the central Inside Passage between Wrangell and Petersburg at ~16–30 m resolution.",
    keywords: "Wrangell,Petersburg,Alaska,NCEI,community DEM,bathymetry,topography,Wrangell Narrows,Frederick Sound,SE Alaska",
    lastUpdated: "2023-01-01",
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
  return ALL_PRESET_DATASETS.map((d) => {
    const usesNcei = d.waterType === "saltwater" && d.id in NCEI_DATASET_COVERAGES;
    return {
      id: `preset-${d.id}`,
      name: d.name,
      sourceAgency: usesNcei
        ? "NOAA/NCEI + GEBCO"
        : d.waterType === "saltwater"
          ? "GEBCO"
          : "GEBCO / Synthetic",
      dataType: "bathymetry" as const,
      // NCEI-preferred SE Alaska presets reach 1–24 m where multibeam / community
      // DEM coverage exists; everything else falls through to GEBCO's ~400 m grid.
      resolutionMMin: usesNcei ? 1 : 400,
      resolutionMMax: 400,
      coverageBbox: d.bbox,
      endpointUrl: null,
      accessNotes: "Available directly in BathyScan viewer — select from the Datasets panel.",
      description: d.description,
      keywords: [d.name, d.waterType, "bathymetry", "terrain", d.id].join(","),
      lastUpdated: "2024-01-01",
      waterType: d.waterType,
    };
  });
}

let seeded = false;

/**
 * IDs of catalog entries that were seeded by previous versions of this file
 * and have since been retired. Listed explicitly so reconciliation never
 * touches user-saved catalog rows (which use other id prefixes).
 *
 * NOTE: `preset-*` rows are reconciled via the live `buildPresetCatalogEntries()`
 * output below — any preset that disappears from the registry is pruned
 * automatically, no entry needed here.
 */
const RETIRED_CATALOG_IDS: string[] = [];

export async function seedDatasetCatalog(): Promise<void> {
  if (seeded) return;
  seeded = true;

  // No-op under vitest: tests import route modules (which trigger this
  // seeder at module load) without a live database mock, so calling
  // `db.execute` here floods stderr with non-fatal errors and hides
  // real test failures. Tests that exercise the seeder mock it explicitly.
  if (process.env["VITEST"] || process.env["NODE_ENV"] === "test") {
    return;
  }

  try {
    // Reconcile preset-* rows against the current registry on every boot so
    // that newly-added preset datasets show up in Find Data search for
    // existing deployments, and retired presets stop showing up.
    const presetEntries = buildPresetCatalogEntries();
    const desiredPresetIds = presetEntries.map((e) => e.id);

    const purged = await db
      .delete(datasetCatalogTable)
      .where(
        desiredPresetIds.length > 0
          ? sql`${datasetCatalogTable.id} LIKE 'preset-%' AND ${notInArray(datasetCatalogTable.id, desiredPresetIds)}`
          : sql`${datasetCatalogTable.id} LIKE 'preset-%'`,
      );
    const purgedCount = Number(
      (purged as { rowCount?: number | null }).rowCount ?? 0,
    );
    if (purgedCount > 0) {
      console.info(
        `[catalog] Purged ${purgedCount} stale preset-* rows no longer in registry.`,
      );
    }

    let retiredCount = 0;
    if (RETIRED_CATALOG_IDS.length > 0) {
      const retired = await db
        .delete(datasetCatalogTable)
        .where(inArray(datasetCatalogTable.id, RETIRED_CATALOG_IDS));
      retiredCount = Number(
        (retired as unknown as { rowCount?: number | null }).rowCount ?? 0,
      );
      if (retiredCount > 0) {
        console.info(
          `[catalog] Purged ${retiredCount} retired non-preset row(s).`,
        );
      }
    }

    const entries: CatalogSeedEntry[] = [
      ...presetEntries,
      ...EXTRA_CATALOG_ENTRIES,
    ];

    // Upsert every static entry by id so additions and edits in the source
    // file flow to existing installs on the next boot. onConflictDoUpdate
    // refreshes all mutable fields from `excluded.*` while leaving
    // user-saved catalog rows (different id prefixes) untouched.
    await db
      .insert(datasetCatalogTable)
      .values(entries)
      .onConflictDoUpdate({
        target: datasetCatalogTable.id,
        set: {
          name: sql`excluded.name`,
          sourceAgency: sql`excluded.source_agency`,
          dataType: sql`excluded.data_type`,
          resolutionMMin: sql`excluded.resolution_m_min`,
          resolutionMMax: sql`excluded.resolution_m_max`,
          coverageBbox: sql`excluded.coverage_bbox`,
          endpointUrl: sql`excluded.endpoint_url`,
          accessNotes: sql`excluded.access_notes`,
          description: sql`excluded.description`,
          keywords: sql`excluded.keywords`,
          lastUpdated: sql`excluded.last_updated`,
          waterType: sql`excluded.water_type`,
        },
      });

    inMemoryCatalog = null;
    console.info(`[catalog] Reconciled ${entries.length} catalog entries.`);
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
