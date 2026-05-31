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
    id: "noaa-efh-alaska-pollock",
    name: "NOAA EFH — Walleye Pollock (Gulf of Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Walleye Pollock (Gadus chalcogrammus) in the Gulf of Alaska. One of the most commercially important groundfish species in Alaska — EFH covers mid-water and demersal spawning and feeding areas across all life stages.",
    keywords: "EFH,essential fish habitat,pollock,walleye pollock,Gadus chalcogrammus,Theragra,Alaska,GOA,groundfish,NOAA,NMFS,midwater,demersal",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-sablefish",
    name: "NOAA EFH — Sablefish (Gulf of Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Sablefish (Anoplopoma fimbria), also known as black cod, in the Gulf of Alaska. A high-value deepwater species; EFH covers deep-slope and canyon habitat from 200–2000 m as well as nearshore juvenile nursery areas.",
    keywords: "EFH,essential fish habitat,sablefish,black cod,Anoplopoma fimbria,Alaska,GOA,groundfish,deepwater,slope,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-arrowtooth",
    name: "NOAA EFH — Arrowtooth Flounder (Gulf of Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Arrowtooth Flounder (Atheresthes stomias) in the Gulf of Alaska. A dominant flatfish on the GOA shelf and slope; EFH includes shelf, slope, and inshore waters used across all life stages from larvae through adults.",
    keywords: "EFH,essential fish habitat,arrowtooth flounder,Atheresthes stomias,Alaska,GOA,flatfish,flounder,groundfish,shelf,slope,NOAA,NMFS",
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
  // -------------------------------------------------------------------------
  // New EFH species catalog entries
  // -------------------------------------------------------------------------
  {
    id: "noaa-efh-alaska-spotted-prawn",
    name: "NOAA EFH — Spotted Prawn (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -138, minLat: 54, maxLon: -130, maxLat: 60 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Spotted Prawn (Pandalus platyceros) in SE Alaska. Covers rocky and mixed-substrate slopes at 90–500 m used by all life stages. A target species in the SE Alaska pot prawn fishery managed by ADF&G.",
    keywords: "EFH,essential fish habitat,spotted prawn,prawn,Pandalus platyceros,shrimp,pandalid,Alaska,SE Alaska,pot fishery,habitat,NOAA,NMFS,ADF&G",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-turbot",
    name: "NOAA EFH — Greenland Turbot (Gulf of Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Greenland Turbot / Pacific Turbot (Reinhardtius hippoglossoides) in the Gulf of Alaska and SE Alaska. Occupies deep soft-mud habitat at 200–1000 m; managed under the GOA Groundfish FMP.",
    keywords: "EFH,essential fish habitat,turbot,Greenland turbot,Pacific turbot,Reinhardtius hippoglossoides,flatfish,Alaska,GOA,deepwater,groundfish,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-rex-sole",
    name: "NOAA EFH — Rex Sole (Gulf of Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Rex Sole (Glyptocephalus zachirus) in the Gulf of Alaska. One of the most abundant small flatfish on SE Alaska soft-mud shelves at 50–550 m; managed under the GOA Groundfish FMP.",
    keywords: "EFH,essential fish habitat,rex sole,sole,Dover sole,Glyptocephalus zachirus,flatfish,Alaska,GOA,groundfish,shelf,mud,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-tomcod",
    name: "NOAA EFH — Pacific Tomcod (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -138, minLat: 54, maxLon: -130, maxLat: 60 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Pacific Tomcod (Microgadus proximus) in SE Alaska. A nearshore-to-mid-depth gadid found over soft substrates and eelgrass at 0–200 m; spawns in winter in sheltered inshore areas.",
    keywords: "EFH,essential fish habitat,tomcod,Pacific tomcod,Microgadus proximus,cod,gadid,Alaska,SE Alaska,nearshore,eelgrass,habitat,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-juvenile-rockfish",
    name: "NOAA EFH — Juvenile Rockfish Complex (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -138, minLat: 54, maxLon: -130, maxLat: 60 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Distinct from adult rockfish EFH — represents shallow nursery habitat for the multi-species Sebastes complex.",
    description: "Essential Fish Habitat (EFH) for juvenile rockfish (Sebastes spp. complex) in SE Alaska. Kelp canopy and shallow rocky reef habitat at 0–150 m serve as critical nursery grounds for yelloweye, black, quillback, and other Sebastes species before they recruit to deeper adult habitat.",
    keywords: "EFH,essential fish habitat,juvenile rockfish,rockfish,Sebastes,yelloweye,black rockfish,quillback,kelp,nursery,reef,Alaska,SE Alaska,habitat,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  // -------------------------------------------------------------------------
  // Intertidal / shoreline catalog entries (catalog only — not 3D overlay)
  // -------------------------------------------------------------------------
  {
    id: "adfg-intertidal-clam-habitat-se-alaska",
    name: "Razor & Butter Clam Habitat — SE Alaska Intertidal",
    sourceAgency: "ADF&G / NOAA ShoreZone",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -138, minLat: 54, maxLon: -130, maxLat: 60 },
    endpointUrl: "https://alaskafisheries.noaa.gov/shorezone/",
    accessNotes: "General intertidal habitat designation. These are historic clamming area identifications, NOT real-time harvest advisories. Check ADF&G Shellfish Management for current harvest openings and biotoxin closures before harvesting.",
    description: "Intertidal sandy beach habitat supporting razor clam (Siliqua patula) and butter clam (Saxidomus gigantea) populations along SE Alaska shorelines. Mapped from ADF&G shellfish surveys and ShoreZone aerial photography. Clam beds occur primarily on exposed sandy beaches and protected gravel/sand flats. Harvest regulations and biotoxin (paralytic shellfish poisoning) closures apply; consult ADF&G before digging.",
    keywords: "clam,clamming,razor clam,butter clam,Siliqua patula,Saxidomus gigantea,shellfish,intertidal,beach,sandy beach,harvest,bivalve,Alaska,SE Alaska,ADF&G,ShoreZone,shoreline,tidal flat",
    lastUpdated: "2022-09-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-shorezone-tidal-pools-se-alaska",
    name: "Tidal Pool Zones — SE Alaska Rocky Intertidal",
    sourceAgency: "NOAA ShoreZone / ADF&G",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -138, minLat: 54, maxLon: -130, maxLat: 60 },
    endpointUrl: "https://alaskafisheries.noaa.gov/shorezone/",
    accessNotes: "General rocky intertidal habitat designation derived from ShoreZone aerial surveys and CMECS substrate mapping. Not a real-time biological survey; tidal pool communities vary by season and tidal exposure.",
    description: "Rocky intertidal areas supporting characteristic tidal pool communities along SE Alaska's island and mainland shorelines. Habitat features include barnacle, mussel, chiton, sea star, nudibranch, hermit crab, anemone, and algae assemblages stratified by tidal zone. Mapped from NOAA ShoreZone aerial photography and CMECS substrate classification.",
    keywords: "tidal pool,tide pool,rocky intertidal,intertidal,ShoreZone,CMECS,barnacle,mussel,sea star,starfish,chiton,anemone,urchin,Alaska,SE Alaska,NOAA,shoreline,marine invertebrate",
    lastUpdated: "2022-09-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-shorezone-beachcombing-se-alaska",
    name: "Beachcombing Shorelines — SE Alaska Accessible Coast",
    sourceAgency: "NOAA ShoreZone / Alaska Dept of Environmental Conservation",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -138, minLat: 54, maxLon: -130, maxLat: 60 },
    endpointUrl: "https://alaskafisheries.noaa.gov/shorezone/",
    accessNotes: "General habitat designation for accessible shoreline areas noted for invertebrate and marine debris observation. These represent general shoreline character — accessibility varies by tidal height, vessel access, and private land status. Always verify land ownership before landing.",
    description: "Accessible shorelines along SE Alaska's island and mainland coast noted for marine invertebrate observation, beachcombing, and intertidal exploration. Shoreline character includes mixed gravel/cobble beaches, kelp wrack zones, log-strewn tidelines, and sandy pockets. Derived from ShoreZone aerial survey substrate mapping and Alaska DEC coastal survey data.",
    keywords: "beachcombing,shoreline,beach,accessible,intertidal,kelp,wrack,cobble,gravel,marine debris,invertebrate,exploration,Alaska,SE Alaska,NOAA,ShoreZone,coast,tidal",
    lastUpdated: "2022-09-01",
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
const RETIRED_CATALOG_IDS: string[] = [
  "ncei-community-dem-juneau",
  "ncei-community-dem-sitka",
  "ncei-community-dem-ketchikan",
  "ncei-community-dem-craig",
  "ncei-community-dem-skagway",
  "ncei-community-dem-wrangell-petersburg",
];

export async function seedDatasetCatalog(opts: { force?: boolean } = {}): Promise<void> {
  if (seeded) return;
  seeded = true;

  // No-op under vitest: tests import route modules (which trigger this
  // seeder at module load) without a live database mock, so calling
  // `db.execute` here floods stderr with non-fatal errors and hides
  // real test failures. Tests that exercise the seeder directly pass
  // `{ force: true }` to bypass this guard.
  if (!opts.force && (process.env["VITEST"] || process.env["NODE_ENV"] === "test")) {
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
