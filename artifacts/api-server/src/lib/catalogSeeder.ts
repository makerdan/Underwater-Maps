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

import MiniSearch from "minisearch";
import { db, datasetCatalogTable, disabledPresetsTable } from "@workspace/db";
import { inArray, notInArray, sql } from "drizzle-orm";
import type { CatalogSearchQuery } from "../routes/schemas.js";
import { ALL_PRESET_DATASETS, NCEI_DATASET_COVERAGES } from "./terrain.js";
import { logger } from "./logger.js";

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

/**
 * Static catalogue entries for known external public data sources.
 *
 * Exported so tests can verify EFH species coverage without a live DB.
 */
export const EXTRA_CATALOG_ENTRIES: CatalogSeedEntry[] = [
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
    keywords: "EFH,essential fish habitat,Pacific cod,cod,Gadus,Alaska,GOA,Gulf of Alaska,Kodiak,Kachemak Bay,Homer,Seward,Resurrection Bay,Valdez,Prince William Sound,fishing,habitat,NOAA,NMFS",
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
    keywords: "EFH,essential fish habitat,halibut,Hippoglossus,Alaska,GOA,Gulf of Alaska,Kodiak,Kachemak Bay,Homer,Seward,Resurrection Bay,Valdez,Prince William Sound,NOAA,NMFS,flatfish,habitat,fishing",
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
    keywords: "EFH,essential fish habitat,rockfish,yelloweye,black rockfish,Sebastes,Alaska,GOA,Gulf of Alaska,Kodiak,Kachemak Bay,Seward,Resurrection Bay,Prince William Sound,Valdez,NOAA,reef,kelp,habitat",
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
    keywords: "EFH,essential fish habitat,pollock,walleye pollock,Gadus chalcogrammus,Theragra,Alaska,GOA,Gulf of Alaska,Kodiak,Kachemak Bay,Seward,Resurrection Bay,Prince William Sound,Valdez,groundfish,NOAA,NMFS,midwater,demersal",
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
    keywords: "EFH,essential fish habitat,sablefish,black cod,Anoplopoma fimbria,Alaska,GOA,Gulf of Alaska,Kodiak,Seward,Resurrection Bay,Prince William Sound,Valdez,groundfish,deepwater,slope,NOAA,NMFS",
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
    keywords: "EFH,essential fish habitat,arrowtooth flounder,Atheresthes stomias,Alaska,GOA,Gulf of Alaska,Kodiak,Kachemak Bay,Seward,Resurrection Bay,Prince William Sound,Valdez,flatfish,flounder,groundfish,shelf,slope,NOAA,NMFS",
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
    keywords: "EFH,essential fish habitat,turbot,Greenland turbot,Pacific turbot,Reinhardtius hippoglossoides,flatfish,Alaska,GOA,Gulf of Alaska,Kodiak,Kachemak Bay,Seward,Resurrection Bay,Prince William Sound,Valdez,deepwater,groundfish,NOAA,NMFS",
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
    keywords: "EFH,essential fish habitat,rex sole,sole,Dover sole,Glyptocephalus zachirus,flatfish,Alaska,GOA,Gulf of Alaska,Kodiak,Kachemak Bay,Seward,Resurrection Bay,Prince William Sound,Valdez,groundfish,shelf,mud,NOAA,NMFS",
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
  // EFH species — salmon, crab, and rockfish entries
  // -------------------------------------------------------------------------
  {
    id: "noaa-efh-alaska-chinook-salmon",
    name: "NOAA EFH — Chinook Salmon (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Chinook Salmon (Oncorhynchus tshawytscha) in SE Alaska and the Gulf of Alaska. Covers nearshore migratory corridors, kelp-adjacent rearing habitat (0–60 m), and offshore feeding grounds used by juveniles and adults under the Pacific Coast Salmon FMP.",
    keywords: "EFH,essential fish habitat,Chinook salmon,king salmon,Oncorhynchus tshawytscha,salmon,Pacific salmon,Alaska,SE Alaska,GOA,Gulf of Alaska,Kodiak,Homer,Kachemak Bay,Seward,Resurrection Bay,Valdez,Prince William Sound,migration,rearing,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-pink-salmon",
    name: "NOAA EFH — Pink Salmon (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Pink Salmon (Oncorhynchus gorbuscha) in SE Alaska. The most abundant Pacific salmon species; EFH covers nearshore staging areas and shallow migratory corridors (0–40 m) used by adults en route to spawning streams, with large odd-year runs throughout the Inside Passage.",
    keywords: "EFH,essential fish habitat,pink salmon,humpback salmon,Oncorhynchus gorbuscha,salmon,Pacific salmon,Alaska,SE Alaska,GOA,Gulf of Alaska,Kodiak,Homer,Kachemak Bay,Seward,Resurrection Bay,Valdez,Prince William Sound,Inside Passage,migration,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-chum-salmon",
    name: "NOAA EFH — Chum Salmon (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Chum Salmon (Oncorhynchus keta) in SE Alaska. Covers nearshore migratory and rearing corridors (0–80 m) used by juveniles and adults, with important habitat in Glacier Bay and other glacial fjord systems managed under the Pacific Coast Salmon FMP.",
    keywords: "EFH,essential fish habitat,chum salmon,dog salmon,Oncorhynchus keta,salmon,Pacific salmon,Alaska,SE Alaska,GOA,Gulf of Alaska,Kodiak,Homer,Kachemak Bay,Seward,Resurrection Bay,Valdez,Prince William Sound,Glacier Bay,migration,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-sockeye-salmon",
    name: "NOAA EFH — Sockeye Salmon (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Sockeye Salmon (Oncorhynchus nerka) in SE Alaska. Covers nearshore staging areas and migratory corridors (0–40 m) in Lynn Canal and Icy Strait used by adults en route to Chilkoot and Chilkat lake systems; managed under the Pacific Coast Salmon FMP.",
    keywords: "EFH,essential fish habitat,sockeye salmon,red salmon,Oncorhynchus nerka,salmon,Pacific salmon,Alaska,SE Alaska,GOA,Gulf of Alaska,Kodiak,Homer,Kachemak Bay,Seward,Resurrection Bay,Valdez,Prince William Sound,Lynn Canal,Icy Strait,Chilkoot,Chilkat,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-coho-salmon",
    name: "NOAA EFH — Coho Salmon (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Coho Salmon (Oncorhynchus kisutch) in SE Alaska. Covers nearshore migratory corridors and rearing habitat (0–50 m) including Tongass Narrows and Revillagigedo Channel used by adults migrating to Revillagigedo Island and mainland streams; managed under the Pacific Coast Salmon FMP.",
    keywords: "EFH,essential fish habitat,coho salmon,silver salmon,Oncorhynchus kisutch,salmon,Pacific salmon,Alaska,SE Alaska,GOA,Gulf of Alaska,Kodiak,Homer,Kachemak Bay,Seward,Resurrection Bay,Valdez,Prince William Sound,Ketchikan,Tongass Narrows,Revillagigedo,migration,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-dungeness-crab",
    name: "NOAA EFH — Dungeness Crab (SE Alaska)",
    sourceAgency: "ADF&G / NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -138, minLat: 54, maxLon: -130, maxLat: 60 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Dungeness Crab (Metacarcinus magister) in SE Alaska. Covers sandy and muddy nearshore areas to 100 m including Thorne Bay, Ketchikan soft-bottom shelves, and Auke Bay — critical habitat across all life stages (larvae, juveniles, adults) managed by ADF&G.",
    keywords: "EFH,essential fish habitat,Dungeness crab,crab,Metacarcinus magister,Cancer magister,crustacean,shellfish,Alaska,SE Alaska,Thorne Bay,Ketchikan,nearshore,ADF&G,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-tanner-crab",
    name: "NOAA EFH — Tanner Crab (Gulf of Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Tanner Crab (Chionoecetes bairdi) in the Gulf of Alaska. Occupies soft-mud floors of deep inner-bay basins at 50–450 m, with important habitat in the glacial basins of Glacier Bay managed under the GOA King & Tanner Crab FMP.",
    keywords: "EFH,essential fish habitat,Tanner crab,snow crab,Chionoecetes bairdi,crab,crustacean,shellfish,Alaska,GOA,Gulf of Alaska,Kodiak,Kachemak Bay,Homer,Prince William Sound,Valdez,Glacier Bay,deepwater,mud,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-black-rockfish",
    name: "NOAA EFH — Black Rockfish (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Black Rockfish (Sebastes melanops) in SE Alaska. Schooling species found in nearshore rocky kelp-edge habitat from the surface to 100 m; a popular recreational target in Sitka Sound and throughout the Inside Passage, managed under the GOA Groundfish FMP.",
    keywords: "EFH,essential fish habitat,black rockfish,rockfish,Sebastes melanops,Sebastes,kelp,nearshore,rocky reef,Alaska,SE Alaska,Sitka,Inside Passage,groundfish,NOAA,NMFS",
    lastUpdated: "2023-01-01",
    waterType: "saltwater",
  },
  {
    id: "noaa-efh-alaska-quillback-rockfish",
    name: "NOAA EFH — Quillback Rockfish (SE Alaska)",
    sourceAgency: "NOAA Fisheries / NMFS Alaska Region",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -170, minLat: 47, maxLon: -130, maxLat: 72 },
    endpointUrl: "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles",
    accessNotes: "Freely available GeoJSON/Shapefile download. Polygon-based EFH designations under the Magnuson-Stevens Act.",
    description: "Essential Fish Habitat (EFH) for Quillback Rockfish (Sebastes maliger) in SE Alaska. A resident rocky-reef species occupying pinnacles and reef edges around islands at 40–270 m; found in Ketchikan area waters including around Gravina and Annette islands, managed under the GOA Groundfish FMP.",
    keywords: "EFH,essential fish habitat,quillback rockfish,rockfish,Sebastes maliger,Sebastes,rocky reef,pinnacle,Alaska,SE Alaska,Ketchikan,Gravina,Annette,groundfish,NOAA,NMFS",
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
    accessNotes:
      "Rocky intertidal habitat scored for tidepool exploration quality using the BathyScan Intertidal Scorer. " +
      "Scores 0–100 based on substrate (bedrock/rubble), zone relief, and bioband density. " +
      "Not a real-time biological survey; tidal pool communities vary by season and tidal exposure.",
    description:
      "Rocky intertidal areas supporting characteristic tidal pool communities along SE Alaska's island and " +
      "mainland shorelines. Each ShoreZone polygon is scored 0–100 for tidepool exploration quality using the " +
      "BathyScan Intertidal Scorer — bedrock/rubble substrates with high zone relief and dense invertebrate biobands " +
      "score highest. Habitat features include barnacle, mussel, chiton, sea star, nudibranch, hermit crab, anemone, " +
      "and algae assemblages stratified by tidal zone. Mapped from NOAA ShoreZone aerial photography and CMECS substrate classification.",
    keywords:
      "tidal pool,tide pool,rocky intertidal,intertidal,ShoreZone,CMECS,barnacle,mussel,sea star,starfish,chiton," +
      "anemone,urchin,Alaska,SE Alaska,NOAA,shoreline,marine invertebrate,intertidal scorer,hotspot",
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
    accessNotes:
      "Shorelines scored 0–100 for beachcombing quality using the BathyScan Intertidal Scorer. " +
      "Scores weight sand/cobble substrate, rounded stone, debris load, and wave energy. " +
      "Accessibility varies by tidal height, vessel access, and private land status. Always verify land ownership before landing.",
    description:
      "Accessible shorelines along SE Alaska's island and mainland coast scored for beachcombing quality. " +
      "Each ShoreZone polygon receives a 0–100 beachcombing score — sandy/cobble beaches with active debris wrack " +
      "lines and high wave energy score highest. Shoreline character includes mixed gravel/cobble beaches, kelp wrack " +
      "zones, log-strewn tidelines, and sandy pockets. Derived from ShoreZone aerial survey substrate mapping.",
    keywords:
      "beachcombing,shoreline,beach,accessible,intertidal,kelp,wrack,cobble,gravel,marine debris,invertebrate," +
      "exploration,Alaska,SE Alaska,NOAA,ShoreZone,coast,tidal,intertidal scorer,hotspot",
    lastUpdated: "2022-09-01",
    waterType: "saltwater",
  },
  // -------------------------------------------------------------------------
  // Southern Alaska Coastal Relief Model (DEM ID 703) — source + per-AOI
  // entries so users can discover these locations through catalog search.
  // -------------------------------------------------------------------------
  {
    id: "ncei-crm-s-alaska",
    name: "NCEI Southern Alaska Coastal Relief Model (DEM ID 703)",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 90,
    resolutionMMax: 90,
    coverageBbox: { minLon: -170, minLat: 54, maxLon: -130, maxLat: 62 },
    endpointUrl:
      "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/NOAA_Coastal_Relief_Model_Southern_Alaska/ImageServer/WCSServer",
    accessNotes:
      "Accessible via WCS. Purpose-built regional grid compiled from NOAA hydrographic surveys, " +
      "multibeam echosounder, and ship-track depth data. ~3 arc-second (~90 m) native resolution. " +
      "WCS coverage identifier: 1. NCEI geoportal metadata: gov.noaa.ngdc.mgg.dem:703.",
    description:
      "NOAA/NCEI Southern Alaska Coastal Relief Model (CRM) — a purpose-built ~90 m regional " +
      "bathymetric grid covering the Gulf of Alaska, Kodiak Island, Cook Inlet, Kachemak Bay, " +
      "Resurrection Bay, Prince William Sound, and Yakutat Bay (~130 °W – 170 °W, 54 °N – 62 °N). " +
      "Compiled from NOAA hydrographic surveys, multibeam echosounder composites, and supplemental " +
      "ship-track data. Provides consistently populated depth values across the southern Alaska " +
      "continental shelf and fjord systems where the general DEM Global Mosaic has gaps.",
    keywords:
      "Alaska,Southern Alaska,Gulf of Alaska,GOA,NCEI,CRM,Coastal Relief Model,DEM,bathymetry," +
      "Kodiak,Kodiak Island,Chiniak Bay,Homer,Kachemak Bay,Cook Inlet,Seward,Resurrection Bay," +
      "Kenai Fjords,Valdez,Prince William Sound,PWS,Yakutat,Yakutat Bay,shelf,fjord,multibeam,90m",
    lastUpdated: "2024-06-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-crm-kodiak-island",
    name: "Kodiak Island — Bathymetry (Southern Alaska CRM)",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 90,
    resolutionMMax: 400,
    coverageBbox: { minLon: -153.5, minLat: 57.0, maxLon: -151.5, maxLat: 58.6 },
    endpointUrl:
      "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/NOAA_Coastal_Relief_Model_Southern_Alaska/ImageServer/WCSServer",
    accessNotes:
      "Uses the NCEI Southern Alaska CRM (DEM ID 703) as primary bathymetry source.",
    description:
      "Bathymetric coverage for Kodiak Island and Chiniak Bay — premier halibut and rockfish grounds " +
      "on the eastern Gulf of Alaska shelf. The seafloor features rocky headlands, kelp-studded " +
      "passages, and deep submarine canyons reaching 300+ m. Served from the NCEI Southern Alaska " +
      "Coastal Relief Model (~90 m) as primary source, with NCEI BAG Mosaic and GEBCO as ranked " +
      "fallbacks. An essential area for Pacific halibut, Pacific cod, sablefish, and rockfish.",
    keywords:
      "Kodiak,Kodiak Island,Chiniak Bay,Gulf of Alaska,GOA,halibut,Pacific halibut,cod,Pacific cod," +
      "rockfish,sablefish,black cod,salmon,king crab,Tanner crab,Dungeness crab,Steller sea lion," +
      "NCEI,CRM,Southern Alaska,bathymetry,shelf,canyon,kelp,Alaska,fishing,sport fishing,charter",
    lastUpdated: "2024-06-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-crm-kachemak-bay",
    name: "Kachemak Bay & Homer — Bathymetry (Southern Alaska CRM)",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 90,
    resolutionMMax: 400,
    coverageBbox: { minLon: -152.5, minLat: 59.0, maxLon: -150.5, maxLat: 60.2 },
    endpointUrl:
      "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/NOAA_Coastal_Relief_Model_Southern_Alaska/ImageServer/WCSServer",
    accessNotes:
      "Uses the NCEI Southern Alaska CRM (DEM ID 703) as primary bathymetry source.",
    description:
      "Bathymetric coverage for Homer Spit, Kachemak Bay, and lower Cook Inlet approaches — one of " +
      "Alaska's most productive inshore fisheries. The seafloor includes halibut flats, salmon staging " +
      "corridors, and steep-walled fjord arms reaching 180 m. Served from the NCEI Southern Alaska " +
      "Coastal Relief Model (~90 m). Homer is a major charter fishing hub with world-class halibut " +
      "fishing on the outer Kachemak Bay shelf and upper Cook Inlet.",
    keywords:
      "Kachemak Bay,Homer,Homer Spit,Cook Inlet,lower Cook Inlet,Kenai Peninsula,halibut,Pacific halibut," +
      "salmon,Chinook salmon,king salmon,silver salmon,coho,pink salmon,Dungeness crab,razor clam," +
      "NCEI,CRM,Southern Alaska,bathymetry,fjord,Alaska,fishing,sport fishing,charter,Homer charter",
    lastUpdated: "2024-06-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-crm-resurrection-bay",
    name: "Resurrection Bay & Seward — Bathymetry (Southern Alaska CRM)",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 90,
    resolutionMMax: 400,
    coverageBbox: { minLon: -150.5, minLat: 59.4, maxLon: -148.5, maxLat: 60.6 },
    endpointUrl:
      "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/NOAA_Coastal_Relief_Model_Southern_Alaska/ImageServer/WCSServer",
    accessNotes:
      "Uses the NCEI Southern Alaska CRM (DEM ID 703) as primary bathymetry source.",
    description:
      "Bathymetric coverage for Seward, Resurrection Bay, and Kenai Fjords approaches — a glacially " +
      "carved fjord reaching 275 m depth at the mouth of the Gulf of Alaska. Renowned for halibut, " +
      "salmon, and lingcod fishing. Served from the NCEI Southern Alaska Coastal Relief Model (~90 m). " +
      "Seward is the gateway to Kenai Fjords National Park; strong runs of all five Pacific salmon " +
      "species return to the bay's tributaries seasonally.",
    keywords:
      "Resurrection Bay,Seward,Kenai Fjords,Kenai Fjords National Park,Gulf of Alaska,Kenai Peninsula," +
      "halibut,Pacific halibut,lingcod,salmon,Chinook salmon,king salmon,silver salmon,coho,pink salmon," +
      "rockfish,Dungeness crab,shrimp,spot prawn,NCEI,CRM,Southern Alaska,bathymetry,fjord,glacial fjord," +
      "Alaska,fishing,sport fishing,charter,Seward charter,deep sea fishing",
    lastUpdated: "2024-06-01",
    waterType: "saltwater",
  },
  {
    id: "ncei-crm-prince-william-sound",
    name: "Prince William Sound & Valdez — Bathymetry (Southern Alaska CRM)",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 90,
    resolutionMMax: 400,
    coverageBbox: { minLon: -148.5, minLat: 60.2, maxLon: -146.5, maxLat: 61.4 },
    endpointUrl:
      "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/NOAA_Coastal_Relief_Model_Southern_Alaska/ImageServer/WCSServer",
    accessNotes:
      "Uses the NCEI Southern Alaska CRM (DEM ID 703) as primary bathymetry source.",
    description:
      "Bathymetric coverage for Valdez Arm, Port Valdez, and western Prince William Sound approaches — " +
      "a sheltered deep-water fjord system with a sill depth of ~175 m and basin depths to 750 m. " +
      "Strong salmon, halibut, and spot shrimp fisheries among forested islands and glaciated valleys. " +
      "Served from the NCEI Southern Alaska Coastal Relief Model (~90 m). Prince William Sound supports " +
      "important pink and sockeye salmon hatchery production, plus a commercial shrimp pot fishery.",
    keywords:
      "Prince William Sound,PWS,Valdez,Valdez Arm,Port Valdez,Cordova,Whittier,western approaches," +
      "Gulf of Alaska,halibut,Pacific halibut,salmon,pink salmon,sockeye salmon,red salmon,silver salmon," +
      "coho,Chinook salmon,king salmon,spot shrimp,prawn,Dungeness crab,Tanner crab,rockfish,lingcod," +
      "NCEI,CRM,Southern Alaska,bathymetry,fjord,Alaska,fishing,sport fishing,charter,Valdez charter," +
      "hatchery,shrimp pot,deep water",
    lastUpdated: "2024-06-01",
    waterType: "saltwater",
  },
  // -------------------------------------------------------------------------
  // Freshwater lake catalog entries — Midwest US
  // -------------------------------------------------------------------------
  {
    id: "fw-lake-minnetonka-mn",
    name: "Lake Minnetonka (MN)",
    sourceAgency: "MN DNR",
    dataType: "bathymetry",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -93.65, minLat: 44.88, maxLon: -93.43, maxLat: 44.97 },
    endpointUrl: "https://resources.gis.mn.gov/services/glo/MapServer",
    accessNotes:
      "Custom MN DNR ArcGIS REST fetcher needed: query by geometry, return depth raster.",
    description:
      "Lake Minnetonka is a large recreational lake in Hennepin County, Minnesota, covering " +
      "~14,500 acres with a maximum depth of about 113 ft (34 m). A premier bass, walleye, and " +
      "northern pike fishery just west of Minneapolis.",
    keywords:
      "Lake Minnetonka,Minnesota,MN,Hennepin County,Midwest,freshwater,walleye,bass,northern pike," +
      "recreation,Wayzata,Excelsior,MN DNR",
    lastUpdated: null,
    waterType: "freshwater",
  },
  {
    id: "fw-mille-lacs-lake-mn",
    name: "Mille Lacs Lake (MN)",
    sourceAgency: "MN DNR",
    dataType: "bathymetry",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -93.83, minLat: 46.21, maxLon: -93.44, maxLat: 46.45 },
    endpointUrl: "https://resources.gis.mn.gov/services/glo/MapServer",
    accessNotes:
      "Custom MN DNR ArcGIS REST fetcher needed: query by geometry, return depth raster.",
    description:
      "Mille Lacs Lake is the second-largest lake entirely within Minnesota at ~132,500 acres, " +
      "with a maximum depth of 42 ft (13 m). Renowned nationally for its trophy walleye fishery " +
      "and ice fishing in Mille Lacs County.",
    keywords:
      "Mille Lacs,Mille Lacs Lake,Minnesota,MN,Aitkin County,Mille Lacs County,Midwest,freshwater," +
      "walleye,ice fishing,bass,perch,MN DNR,Isle,Garrison",
    lastUpdated: null,
    waterType: "freshwater",
  },
  {
    id: "fw-leech-lake-mn",
    name: "Leech Lake (MN)",
    sourceAgency: "MN DNR",
    dataType: "bathymetry",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -94.55, minLat: 47.1, maxLon: -94.15, maxLat: 47.4 },
    endpointUrl: "https://resources.gis.mn.gov/services/glo/MapServer",
    accessNotes:
      "Custom MN DNR ArcGIS REST fetcher needed: query by geometry, return depth raster.",
    description:
      "Leech Lake covers ~111,000 acres in Cass County, Minnesota, and is one of the state's " +
      "largest lakes at up to 150 ft (46 m) deep. Part of the Chippewa National Forest watershed; " +
      "known for walleye, muskellunge, and northern pike fishing.",
    keywords:
      "Leech Lake,Minnesota,MN,Cass County,Midwest,freshwater,walleye,muskie,muskellunge,northern pike," +
      "Chippewa National Forest,Walker,MN DNR",
    lastUpdated: null,
    waterType: "freshwater",
  },
  {
    id: "fw-red-lake-mn",
    name: "Red Lake (MN)",
    sourceAgency: "MN DNR",
    dataType: "bathymetry",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -95.6, minLat: 47.8, maxLon: -94.7, maxLat: 48.15 },
    endpointUrl: "https://resources.gis.mn.gov/services/glo/MapServer",
    accessNotes:
      "Custom MN DNR ArcGIS REST fetcher needed: query by geometry, return depth raster. " +
      "Upper Red Lake is on Red Lake Nation tribal land — access coordination may be required.",
    description:
      "Red Lake (Upper and Lower) is the largest lake entirely within Minnesota, covering " +
      "~288,000 acres in Beltrami and Clearwater counties, with a shallow maximum depth of " +
      "~24 ft (7 m). Upper Red Lake is managed by Red Lake Nation; Lower Red Lake supports a " +
      "significant walleye commercial and sport fishery.",
    keywords:
      "Red Lake,Upper Red Lake,Lower Red Lake,Minnesota,MN,Beltrami County,Clearwater County,Midwest," +
      "freshwater,walleye,Red Lake Nation,tribal,MN DNR",
    lastUpdated: null,
    waterType: "freshwater",
  },
  {
    id: "fw-lake-of-the-woods-mn",
    name: "Lake of the Woods (MN/ON)",
    sourceAgency: "MN DNR",
    dataType: "bathymetry",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -95.6, minLat: 48.5, maxLon: -94.4, maxLat: 49.5 },
    endpointUrl: "https://resources.gis.mn.gov/services/glo/MapServer",
    accessNotes:
      "Custom MN DNR ArcGIS REST fetcher needed: query by geometry, return depth raster. " +
      "Lake spans the US–Canada border; Canadian portion falls under Ontario MNR jurisdiction.",
    description:
      "Lake of the Woods straddles the Minnesota/Ontario/Manitoba border, covering over " +
      "~950,000 acres with thousands of islands and depths to 210 ft (64 m). A world-class " +
      "walleye and sauger fishery; the Rainy River drains into its south shore near Baudette, MN.",
    keywords:
      "Lake of the Woods,Minnesota,MN,Ontario,Manitoba,Roseau County,Lake of the Woods County,Midwest," +
      "freshwater,walleye,sauger,northern pike,smallmouth bass,Baudette,Kenora,MN DNR,Canada",
    lastUpdated: null,
    waterType: "freshwater",
  },
  {
    id: "fw-lake-winnebago-wi",
    name: "Lake Winnebago (WI)",
    sourceAgency: "USGS",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -88.52, minLat: 43.9, maxLon: -88.3, maxLat: 44.15 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Lake Winnebago is a shallow eutrophic lake; 3DEP lidar " +
      "covers the lakebed and surrounding watershed.",
    description:
      "Lake Winnebago is the largest lake entirely within Wisconsin at ~137,700 acres, with a " +
      "shallow maximum depth of 21 ft (6 m). Located in Winnebago, Calumet, and Fond du Lac " +
      "counties; the lake hosts one of the largest lake sturgeon populations in the world and a " +
      "celebrated winter spearfishing season.",
    keywords:
      "Lake Winnebago,Wisconsin,WI,Winnebago County,Fond du Lac,Calumet County,Midwest,freshwater," +
      "sturgeon,lake sturgeon,spearfishing,walleye,yellow perch,USGS,3DEP,Oshkosh,Neenah,Menasha",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-gull-lake-mi",
    name: "Gull Lake (MI)",
    sourceAgency: "USGS",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -85.48, minLat: 42.37, maxLon: -85.35, maxLat: 42.46 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Gull Lake is a kettle lake in Kalamazoo/Barry counties " +
      "with lidar-quality 3DEP coverage.",
    description:
      "Gull Lake in Kalamazoo and Barry counties, Michigan, covers ~2,030 acres with a " +
      "maximum depth of 110 ft (34 m) — one of the deepest inland lakes in Michigan. Known for " +
      "cisco, smallmouth bass, and lake trout; the lake is oligotrophic and crystal-clear.",
    keywords:
      "Gull Lake,Michigan,MI,Kalamazoo County,Barry County,Midwest,freshwater,cisco,smallmouth bass," +
      "lake trout,walleye,USGS,3DEP,Richland,Gull Lake Township",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  // -------------------------------------------------------------------------
  // Freshwater lake catalog entries — Western US
  // -------------------------------------------------------------------------
  {
    id: "fw-lake-tahoe-ca-nv",
    name: "Lake Tahoe (CA/NV)",
    sourceAgency: "USGS",
    dataType: "bathymetry",
    resolutionMMin: 2,
    resolutionMMax: 10,
    coverageBbox: { minLon: -120.22, minLat: 38.9, maxLon: -119.9, maxLat: 39.25 },
    endpointUrl:
      "https://www.sciencebase.gov/catalog/item/5306d3b4e4b0bbcd5acb5be1",
    accessNotes:
      "High-resolution dedicated survey available on USGS ScienceBase. Requires download-and-bundle fetcher.",
    description:
      "Lake Tahoe straddles the California–Nevada border in the Sierra Nevada at 6,225 ft " +
      "elevation, covering ~122,000 acres with a maximum depth of 1,645 ft (501 m) — the " +
      "second-deepest lake in the US. Renowned for exceptional water clarity and alpine scenery.",
    keywords:
      "Lake Tahoe,Tahoe,California,CA,Nevada,NV,Sierra Nevada,El Dorado County,Placer County," +
      "Washoe County,West,freshwater,deep,clarity,trout,Mackinaw lake trout,USGS,ScienceBase," +
      "South Lake Tahoe,Tahoe City",
    lastUpdated: "2023-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-powell-az-ut",
    name: "Lake Powell (AZ/UT)",
    sourceAgency: "USGS/USBR",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -111.6, minLat: 36.9, maxLon: -110.4, maxLat: 37.5 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Reservoir level fluctuates significantly; bathymetry " +
      "reflects pre-impoundment Glen Canyon terrain.",
    description:
      "Lake Powell is a reservoir on the Colorado River on the Arizona–Utah border, " +
      "covering up to ~254,000 acres at full pool with a maximum depth of ~560 ft (171 m). " +
      "Created by Glen Canyon Dam (1966); a major recreation destination on the Colorado Plateau " +
      "surrounded by dramatic sandstone canyon walls.",
    keywords:
      "Lake Powell,Powell,Colorado River,Glen Canyon,Arizona,AZ,Utah,UT,Colorado Plateau,West," +
      "reservoir,freshwater,USGS,3DEP,USBR,Bureau of Reclamation,Page,Glen Canyon Dam,houseboat",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-mead-nv-az",
    name: "Lake Mead (NV/AZ)",
    sourceAgency: "USGS/USBR",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -114.85, minLat: 35.9, maxLon: -114.1, maxLat: 36.5 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Lake Mead is subject to significant drawdown; " +
      "3DEP captures the full reservoir basin.",
    description:
      "Lake Mead is the largest reservoir in the United States by volume (when full) at " +
      "~247,000 acres on the Nevada–Arizona border, impounded by Hoover Dam (1936) with a " +
      "maximum depth of ~590 ft (180 m). Serves as the primary water supply for Las Vegas and " +
      "millions of downstream users.",
    keywords:
      "Lake Mead,Mead,Colorado River,Hoover Dam,Nevada,NV,Arizona,AZ,West,reservoir,freshwater," +
      "USGS,3DEP,USBR,Bureau of Reclamation,Boulder City,Las Vegas,water supply",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-crater-lake-or",
    name: "Crater Lake (OR)",
    sourceAgency: "USGS",
    dataType: "bathymetry",
    resolutionMMin: 2,
    resolutionMMax: 10,
    coverageBbox: { minLon: -122.2, minLat: 42.88, maxLon: -122.05, maxLat: 42.98 },
    endpointUrl:
      "https://www.sciencebase.gov/catalog/item/5306d3b4e4b0bbcd5acb5be2",
    accessNotes:
      "High-resolution dedicated survey available on USGS ScienceBase. Requires download-and-bundle fetcher.",
    description:
      "Crater Lake in Klamath County, Oregon, occupies the caldera of Mount Mazama in the " +
      "Cascade Range. At 1,949 ft (594 m) it is the deepest lake in the US. Famous for its " +
      "extraordinary deep blue color and pristine clarity; no inflow or outflow rivers.",
    keywords:
      "Crater Lake,Oregon,OR,Klamath County,Cascade Range,West,freshwater,caldera,volcanic lake," +
      "deepest,blue,Wizard Island,Crater Lake National Park,USGS,ScienceBase",
    lastUpdated: "2023-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-flathead-lake-mt",
    name: "Flathead Lake (MT)",
    sourceAgency: "USGS",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -114.45, minLat: 47.6, maxLon: -113.9, maxLat: 48.0 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Flathead Lake is the largest natural freshwater lake " +
      "west of the Mississippi.",
    description:
      "Flathead Lake in Lake and Flathead counties, Montana, covers ~197,000 acres with a " +
      "maximum depth of 371 ft (113 m) — the largest natural freshwater lake in the western " +
      "contiguous US. Fed by the Flathead River; supports bull trout, lake trout, and " +
      "westslope cutthroat trout.",
    keywords:
      "Flathead Lake,Montana,MT,Lake County,Flathead County,Rocky Mountains,West,freshwater," +
      "bull trout,lake trout,cutthroat trout,Flathead River,Polson,Kalispell,USGS,3DEP",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-shasta-lake-ca",
    name: "Shasta Lake (CA)",
    sourceAgency: "USGS/USBR",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -122.52, minLat: 40.7, maxLon: -122.2, maxLat: 40.95 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Shasta Lake is the largest reservoir in California.",
    description:
      "Shasta Lake in Shasta County, California, is the largest reservoir in California by " +
      "storage capacity at ~29,500 acres at full pool, with a maximum depth of ~517 ft (158 m). " +
      "Impounded by Shasta Dam (1945) on the Sacramento River; a major houseboat and bass " +
      "fishing destination in the Cascade Range foothills.",
    keywords:
      "Shasta Lake,Shasta,Shasta Dam,Sacramento River,California,CA,Shasta County,West,reservoir," +
      "freshwater,bass,largemouth bass,spotted bass,trout,USGS,3DEP,USBR,houseboat,Redding",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-chelan-wa",
    name: "Lake Chelan (WA)",
    sourceAgency: "USGS/USBR",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -120.65, minLat: 47.8, maxLon: -120.1, maxLat: 48.2 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Lake Chelan is a glacially carved fjord lake; " +
      "the lower 14 miles are managed as Chelan P.U.D. reservoir.",
    description:
      "Lake Chelan in Chelan County, Washington, is a glacially carved fjord lake stretching " +
      "~55 miles in the Cascade Range, covering ~33,800 acres with a maximum depth of 1,486 ft " +
      "(453 m) — the third deepest lake in the US. The lower reach is managed as a reservoir " +
      "by Chelan PUD; the upper reach leads to the remote Stehekin valley.",
    keywords:
      "Lake Chelan,Chelan,Washington,WA,Chelan County,Cascade Range,Pacific Northwest,West,freshwater," +
      "glacier,fjord lake,deep,lake trout,kokanee,chinook salmon,steelhead,Chelan PUD,Stehekin," +
      "USGS,3DEP,USBR",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-upper-klamath-lake-or",
    name: "Upper Klamath Lake (OR)",
    sourceAgency: "USGS",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -122.12, minLat: 42.2, maxLon: -121.72, maxLat: 42.6 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Upper Klamath Lake is shallow and subject to " +
      "significant seasonal level variation managed by Reclamation.",
    description:
      "Upper Klamath Lake in Klamath County, Oregon, is the largest lake in Oregon at " +
      "~64,000 acres, with a shallow maximum depth of ~50 ft (15 m). An important stopover for " +
      "Pacific Flyway waterfowl and habitat for the endangered Lost River and shortnose suckers; " +
      "part of the Klamath Basin Reclamation Project.",
    keywords:
      "Upper Klamath Lake,Klamath Lake,Oregon,OR,Klamath County,West,freshwater,sucker,Lost River sucker," +
      "shortnose sucker,waterfowl,Pacific Flyway,Klamath Basin,Klamath Falls,USGS,3DEP,USBR",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-flaming-gorge-ut-wy",
    name: "Flaming Gorge Reservoir (UT/WY)",
    sourceAgency: "USGS/USBR",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -109.95, minLat: 40.9, maxLon: -109.3, maxLat: 41.3 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Flaming Gorge is a USBR reservoir on the Green River; " +
      "3DEP captures the canyon terrain.",
    description:
      "Flaming Gorge Reservoir straddles the Utah–Wyoming border on the Green River, " +
      "covering ~42,000 acres with a maximum depth of ~436 ft (133 m). Impounded by " +
      "Flaming Gorge Dam (1964); world-class trophy lake trout and kokanee salmon fishery " +
      "set among dramatic red-rock canyon scenery on the Colorado Plateau.",
    keywords:
      "Flaming Gorge,Flaming Gorge Reservoir,Green River,Utah,UT,Wyoming,WY,Daggett County," +
      "Colorado Plateau,West,Southwest,reservoir,freshwater,lake trout,kokanee,USGS,3DEP,USBR," +
      "Bureau of Reclamation,Dutch John,Manila",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-havasu-az-ca",
    name: "Lake Havasu (AZ/CA)",
    sourceAgency: "USGS/USBR",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -114.65, minLat: 34.2, maxLon: -114.3, maxLat: 34.6 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Lake Havasu is a Colorado River reservoir " +
      "impounded by Parker Dam.",
    description:
      "Lake Havasu on the Arizona–California border is a Colorado River reservoir created " +
      "by Parker Dam (1938), covering ~19,300 acres with a maximum depth of ~90 ft (27 m). " +
      "A major desert recreation destination famous for watersports, striped bass fishing, " +
      "and the relocated London Bridge in Lake Havasu City.",
    keywords:
      "Lake Havasu,Havasu,Colorado River,Parker Dam,Arizona,AZ,California,CA,Mohave County," +
      "West,Southwest,reservoir,freshwater,striped bass,striper,largemouth bass,USGS,3DEP,USBR," +
      "London Bridge,Lake Havasu City",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  // -------------------------------------------------------------------------
  // Freshwater lake catalog entries — Southeast US
  // -------------------------------------------------------------------------
  {
    id: "fw-lake-okeechobee-fl",
    name: "Lake Okeechobee (FL)",
    sourceAgency: "USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -81.1, minLat: 26.75, maxLon: -80.6, maxLat: 27.2 },
    endpointUrl:
      "https://geospatial-usace.opendata.arcgis.com/api/search/v1/collections/items?f=json&source_agency=USACE+Jacksonville+District",
    accessNotes:
      "USACE Jacksonville District. Hydrographic surveys available via USACE Geospatial Hub.",
    description:
      "Lake Okeechobee in south-central Florida is the largest freshwater lake in the " +
      "contiguous US at ~730 sq mi, with a shallow maximum depth of ~12 ft (4 m). The " +
      "\"Big Lake\" anchors the Greater Everglades ecosystem and is a world-class largemouth bass " +
      "fishery managed by USACE and SFWMD.",
    keywords:
      "Lake Okeechobee,Okeechobee,Florida,FL,Glades County,Okeechobee County,Southeast,freshwater," +
      "largemouth bass,bass,crappie,catfish,Everglades,USACE,Jacksonville District,SFWMD," +
      "Herbert Hoover Dike,bass fishing",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-lanier-ga",
    name: "Lake Lanier (GA)",
    sourceAgency: "USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -84.22, minLat: 34.08, maxLon: -83.9, maxLat: 34.35 },
    endpointUrl:
      "https://geospatial-usace.opendata.arcgis.com/api/search/v1/collections/items?f=json&source_agency=USACE+Savannah+District",
    accessNotes:
      "USACE Savannah District. Buford Dam impoundment; hydrographic surveys via USACE Geospatial Hub.",
    description:
      "Lake Lanier (Lake Sidney Lanier) in Forsyth and Hall counties, Georgia, is a USACE " +
      "reservoir on the Chattahoochee River covering ~38,000 acres with a maximum depth of " +
      "~160 ft (49 m). The most visited USACE lake in the nation; major freshwater fishing, " +
      "watersports, and camping destination northeast of Atlanta.",
    keywords:
      "Lake Lanier,Sidney Lanier,Buford Dam,Chattahoochee River,Georgia,GA,Forsyth County,Hall County," +
      "Southeast,reservoir,freshwater,largemouth bass,spotted bass,striped bass,USACE,Savannah District," +
      "Atlanta,Gainesville",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-of-the-ozarks-mo",
    name: "Lake of the Ozarks (MO)",
    sourceAgency: "USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -93.1, minLat: 37.9, maxLon: -92.4, maxLat: 38.3 },
    endpointUrl:
      "https://geospatial-usace.opendata.arcgis.com/api/search/v1/collections/items?f=json&source_agency=USACE+Kansas+City+District",
    accessNotes:
      "USACE Kansas City District. Bagnell Dam impoundment on the Osage River; " +
      "hydrographic surveys via USACE Geospatial Hub.",
    description:
      "Lake of the Ozarks in central Missouri is one of the largest man-made lakes in the US " +
      "by shoreline (~1,150 miles), covering ~54,000 acres with a maximum depth of ~130 ft " +
      "(40 m). Impounded by Bagnell Dam (1931) on the Osage River; known for largemouth bass, " +
      "catfish, and a vibrant resort and watersports culture.",
    keywords:
      "Lake of the Ozarks,Ozarks,Bagnell Dam,Osage River,Missouri,MO,Camden County,Miller County," +
      "Southeast,Midwest,reservoir,freshwater,largemouth bass,catfish,crappie,USACE,Kansas City District," +
      "Camdenton,Osage Beach",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-table-rock-lake-mo",
    name: "Table Rock Lake (MO)",
    sourceAgency: "USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -93.55, minLat: 36.4, maxLon: -93.0, maxLat: 36.7 },
    endpointUrl:
      "https://geospatial-usace.opendata.arcgis.com/api/search/v1/collections/items?f=json&source_agency=USACE+Little+Rock+District",
    accessNotes:
      "USACE Little Rock District. Table Rock Dam on the White River; " +
      "hydrographic surveys via USACE Geospatial Hub.",
    description:
      "Table Rock Lake in Stone and Taney counties, Missouri, covers ~43,100 acres with a " +
      "maximum depth of ~220 ft (67 m). Impounded by Table Rock Dam (1958) on the White River " +
      "in the Ozark Mountains; an exceptionally clear, deep Ozark reservoir celebrated for " +
      "bass, trout, and trout fishing below the dam near Branson.",
    keywords:
      "Table Rock Lake,Table Rock Dam,White River,Missouri,MO,Stone County,Taney County,Ozarks," +
      "Southeast,reservoir,freshwater,largemouth bass,smallmouth bass,trout,USACE,Little Rock District," +
      "Branson,Kimberling City",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-kentucky-lake-ky-tn",
    name: "Kentucky Lake (KY/TN)",
    sourceAgency: "USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -88.35, minLat: 36.5, maxLon: -88.0, maxLat: 37.0 },
    endpointUrl:
      "https://geospatial-usace.opendata.arcgis.com/api/search/v1/collections/items?f=json&source_agency=USACE+Nashville+District",
    accessNotes:
      "USACE Nashville District / TVA. Kentucky Dam impoundment on the Tennessee River; " +
      "hydrographic surveys via USACE Geospatial Hub.",
    description:
      "Kentucky Lake on the Tennessee River in western Kentucky and Tennessee covers " +
      "~160,000 acres with a maximum depth of ~60 ft (18 m). Impounded by Kentucky Dam (1944) " +
      "and part of the Tennessee Valley Authority system; forms a twin with neighboring Lake " +
      "Barkley — together the largest double reservoir system east of the Mississippi.",
    keywords:
      "Kentucky Lake,Tennessee River,Kentucky Dam,Kentucky,KY,Tennessee,TN,Marshall County,TVA," +
      "Tennessee Valley Authority,Southeast,reservoir,freshwater,crappie,largemouth bass,striped bass," +
      "catfish,USACE,Nashville District,Land Between the Lakes,Murray",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-barkley-ky-tn",
    name: "Lake Barkley (KY/TN)",
    sourceAgency: "USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -88.02, minLat: 36.6, maxLon: -87.7, maxLat: 37.0 },
    endpointUrl:
      "https://geospatial-usace.opendata.arcgis.com/api/search/v1/collections/items?f=json&source_agency=USACE+Nashville+District",
    accessNotes:
      "USACE Nashville District. Barkley Dam impoundment on the Cumberland River; " +
      "hydrographic surveys via USACE Geospatial Hub.",
    description:
      "Lake Barkley on the Cumberland River in western Kentucky and Tennessee covers " +
      "~57,900 acres with a maximum depth of ~85 ft (26 m). Impounded by Barkley Dam (1966); " +
      "shares the Land Between the Lakes National Recreation Area with adjacent Kentucky Lake " +
      "and is managed jointly by USACE and TVA.",
    keywords:
      "Lake Barkley,Barkley Dam,Cumberland River,Kentucky,KY,Tennessee,TN,Trigg County,TVA," +
      "Tennessee Valley Authority,Southeast,reservoir,freshwater,crappie,largemouth bass,catfish," +
      "USACE,Nashville District,Land Between the Lakes,Cadiz",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-norris-lake-tn",
    name: "Norris Lake (TN)",
    sourceAgency: "USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -84.22, minLat: 36.2, maxLon: -83.72, maxLat: 36.5 },
    endpointUrl:
      "https://geospatial-usace.opendata.arcgis.com/api/search/v1/collections/items?f=json&source_agency=USACE+Nashville+District",
    accessNotes:
      "USACE Nashville District / TVA. Norris Dam was the first TVA dam; " +
      "hydrographic surveys via USACE Geospatial Hub.",
    description:
      "Norris Lake on the Clinch and Powell rivers in Union and Campbell counties, Tennessee, " +
      "covers ~33,840 acres with a maximum depth of ~175 ft (53 m). Impounded by Norris Dam " +
      "(1936) — the first TVA dam — and noted for its exceptional clarity, trophy walleye, " +
      "and largemouth and smallmouth bass.",
    keywords:
      "Norris Lake,Norris Dam,Clinch River,Powell River,Tennessee,TN,Union County,Campbell County," +
      "TVA,Tennessee Valley Authority,Southeast,reservoir,freshwater,walleye,smallmouth bass," +
      "largemouth bass,USACE,Nashville District,Norris,LaFollette",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-fontana-lake-nc",
    name: "Fontana Lake (NC)",
    sourceAgency: "USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -83.85, minLat: 35.38, maxLon: -83.3, maxLat: 35.55 },
    endpointUrl:
      "https://geospatial-usace.opendata.arcgis.com/api/search/v1/collections/items?f=json&source_agency=USACE+Savannah+District",
    accessNotes:
      "USACE Savannah District / TVA. Fontana Dam on the Little Tennessee River; " +
      "hydrographic surveys via USACE Geospatial Hub.",
    description:
      "Fontana Lake on the Little Tennessee River in Swain and Graham counties, North Carolina, " +
      "covers ~10,500 acres with a maximum depth of ~440 ft (134 m). Impounded by Fontana Dam " +
      "(1944) — the highest dam in the eastern US — bordering Great Smoky Mountains National " +
      "Park; supports lake trout, smallmouth bass, and muskie.",
    keywords:
      "Fontana Lake,Fontana Dam,Little Tennessee River,North Carolina,NC,Swain County,Graham County," +
      "TVA,Tennessee Valley Authority,Southeast,reservoir,freshwater,lake trout,smallmouth bass,muskie," +
      "Great Smoky Mountains,USACE,Savannah District,Robbinsville",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-smith-mountain-lake-va",
    name: "Smith Mountain Lake (VA)",
    sourceAgency: "USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -79.92, minLat: 37.0, maxLon: -79.5, maxLat: 37.2 },
    endpointUrl:
      "https://geospatial-usace.opendata.arcgis.com/api/search/v1/collections/items?f=json&source_agency=USACE+Wilmington+District",
    accessNotes:
      "USACE Wilmington District / Appalachian Power. Smith Mountain Dam on the Roanoke River; " +
      "hydrographic surveys via USACE Geospatial Hub.",
    description:
      "Smith Mountain Lake on the Roanoke (Staunton) River in Bedford, Franklin, and Pittsylvania " +
      "counties, Virginia, covers ~20,600 acres with a maximum depth of ~250 ft (76 m). " +
      "Impounded by Smith Mountain Dam (1966); a premier Southeast freshwater fishery known " +
      "for trophy striped bass and largemouth bass in the Blue Ridge foothills.",
    keywords:
      "Smith Mountain Lake,Smith Mountain Dam,Roanoke River,Virginia,VA,Bedford County," +
      "Franklin County,Pittsylvania County,Southeast,reservoir,freshwater,striped bass,striper," +
      "largemouth bass,smallmouth bass,USACE,Wilmington District,Appalachian Power,Moneta",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-clarks-hill-lake-sc-ga",
    name: "Clarks Hill / J. Strom Thurmond Lake (SC/GA)",
    sourceAgency: "USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -82.5, minLat: 33.7, maxLon: -82.0, maxLat: 34.0 },
    endpointUrl:
      "https://geospatial-usace.opendata.arcgis.com/api/search/v1/collections/items?f=json&source_agency=USACE+Savannah+District",
    accessNotes:
      "USACE Savannah District. J. Strom Thurmond Dam on the Savannah River; " +
      "hydrographic surveys via USACE Geospatial Hub.",
    description:
      "Clarks Hill Lake (officially J. Strom Thurmond Lake) on the Savannah River straddles " +
      "the South Carolina–Georgia border, covering ~71,000 acres with a maximum depth of " +
      "~90 ft (27 m). The largest USACE lake east of the Mississippi; renowned for bass, " +
      "crappie, and bream fishing.",
    keywords:
      "Clarks Hill Lake,Strom Thurmond Lake,J. Strom Thurmond,Savannah River,South Carolina,SC," +
      "Georgia,GA,McCormick County,Southeast,reservoir,freshwater,largemouth bass,crappie,bream," +
      "striped bass,USACE,Savannah District,Augusta,McCormick",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  // -------------------------------------------------------------------------
  // Freshwater lake catalog entries — Southwest US and Texas
  // -------------------------------------------------------------------------
  {
    id: "fw-lake-travis-tx",
    name: "Lake Travis (TX)",
    sourceAgency: "LCRA/USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -98.3, minLat: 30.2, maxLon: -97.7, maxLat: 30.5 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Lake Travis is part of the LCRA Highland Lakes chain " +
      "on the Colorado River of Texas; Mansfield Dam operated by LCRA.",
    description:
      "Lake Travis in Travis and Burnet counties, Texas, is the largest of the Highland Lakes, " +
      "covering ~18,600 acres at full pool with a maximum depth of ~210 ft (64 m). Impounded " +
      "by Mansfield Dam (1942) on the Colorado River of Texas; a major water supply and " +
      "recreational reservoir west of Austin.",
    keywords:
      "Lake Travis,Travis,Mansfield Dam,Colorado River Texas,Highland Lakes,Texas,TX,Travis County," +
      "Burnet County,Southwest,reservoir,freshwater,largemouth bass,striper,LCRA,USGS,3DEP,Austin,Lago Vista",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-canyon-lake-tx",
    name: "Canyon Lake (TX)",
    sourceAgency: "LCRA/USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -98.32, minLat: 29.8, maxLon: -98.1, maxLat: 29.95 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Canyon Lake Dam on the Guadalupe River; operated by USACE " +
      "Fort Worth District.",
    description:
      "Canyon Lake in Comal County, Texas, covers ~8,240 acres with a maximum depth of ~125 ft " +
      "(38 m). Impounded by Canyon Dam (1964) on the Guadalupe River; the dam's tailrace " +
      "supports a prized catch-and-release trout fishery and the lake itself hosts largemouth " +
      "and smallmouth bass.",
    keywords:
      "Canyon Lake,Canyon Dam,Guadalupe River,Texas,TX,Comal County,Southwest,reservoir,freshwater," +
      "largemouth bass,smallmouth bass,trout,USACE,Fort Worth District,USGS,3DEP,New Braunfels,San Antonio",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-lbj-tx",
    name: "Lake LBJ (TX)",
    sourceAgency: "LCRA/USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -98.55, minLat: 30.55, maxLon: -98.2, maxLat: 30.7 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Lake LBJ (Lyndon B. Johnson) is part of the LCRA " +
      "Highland Lakes chain; Wirtz Dam operated by LCRA.",
    description:
      "Lake LBJ (Lyndon B. Johnson Lake) on the Colorado River of Texas in Llano and Burnet " +
      "counties covers ~6,375 acres with a maximum depth of ~60 ft (18 m). Impounded by " +
      "Wirtz Dam (1951); a constant-level lake that is part of the Highland Lakes chain, " +
      "popular for waterskiing, bass fishing, and lakefront development.",
    keywords:
      "Lake LBJ,Lyndon B Johnson Lake,Wirtz Dam,Colorado River Texas,Highland Lakes,Texas,TX," +
      "Llano County,Burnet County,Southwest,reservoir,freshwater,largemouth bass,LCRA,USGS,3DEP," +
      "Horseshoe Bay,Marble Falls",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-inks-lake-tx",
    name: "Inks Lake (TX)",
    sourceAgency: "LCRA/USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -98.42, minLat: 30.72, maxLon: -98.35, maxLat: 30.78 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Inks Lake Dam (Roy Inks Dam) on the Colorado River of " +
      "Texas; operated by LCRA. A constant-level Highland Lake.",
    description:
      "Inks Lake in Burnet County, Texas, covers ~803 acres with a maximum depth of ~30 ft " +
      "(9 m). Impounded by Roy Inks Dam (1938) on the Colorado River of Texas; a constant-level " +
      "lake that anchors Inks Lake State Park — one of the most popular state parks in Texas " +
      "for fishing, kayaking, and scuba diving.",
    keywords:
      "Inks Lake,Roy Inks Dam,Colorado River Texas,Highland Lakes,Texas,TX,Burnet County,Southwest," +
      "reservoir,freshwater,largemouth bass,LCRA,USGS,3DEP,Inks Lake State Park,Burnet",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-buchanan-tx",
    name: "Lake Buchanan (TX)",
    sourceAgency: "LCRA/USACE",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -98.6, minLat: 30.8, maxLon: -98.3, maxLat: 30.92 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Buchanan Dam on the Colorado River of Texas; " +
      "the uppermost and largest of the Highland Lakes, operated by LCRA.",
    description:
      "Lake Buchanan in Burnet and Llano counties, Texas, is the largest of the Highland Lakes " +
      "at ~23,060 acres with a maximum depth of ~132 ft (40 m). Impounded by Buchanan Dam (1937) " +
      "on the Colorado River of Texas; home to one of the few inland American white pelican " +
      "rookeries in the US, along with striper and largemouth bass fishing.",
    keywords:
      "Lake Buchanan,Buchanan Dam,Colorado River Texas,Highland Lakes,Texas,TX,Burnet County," +
      "Llano County,Southwest,reservoir,freshwater,striped bass,striper,largemouth bass,white pelican," +
      "LCRA,USGS,3DEP,Burnet,Llano",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-elephant-butte-nm",
    name: "Elephant Butte Reservoir (NM)",
    sourceAgency: "USGS/USBR",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -107.32, minLat: 33.1, maxLon: -107.1, maxLat: 33.6 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Elephant Butte Dam on the Rio Grande; " +
      "operated by USBR Middle Rio Grande Project.",
    description:
      "Elephant Butte Reservoir in Sierra County, New Mexico, is the largest reservoir in the " +
      "state at ~36,500 acres at full pool with a maximum depth of ~200 ft (61 m). Impounded " +
      "by Elephant Butte Dam (1916) on the Rio Grande; a major recreation area in southern " +
      "New Mexico with striped bass and walleye fisheries.",
    keywords:
      "Elephant Butte,Elephant Butte Reservoir,Elephant Butte Dam,Rio Grande,New Mexico,NM," +
      "Sierra County,Southwest,reservoir,freshwater,striped bass,walleye,largemouth bass,USGS," +
      "3DEP,USBR,Bureau of Reclamation,Truth or Consequences,Hot Springs",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-cochiti-lake-nm",
    name: "Cochiti Lake (NM)",
    sourceAgency: "USGS/USBR",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -106.42, minLat: 35.6, maxLon: -106.3, maxLat: 35.7 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Cochiti Dam on the Rio Grande; operated by USACE " +
      "Albuquerque District. Lake lies within Cochiti Pueblo lands.",
    description:
      "Cochiti Lake in Sandoval County, New Mexico, is a flood-control reservoir on the " +
      "Rio Grande covering ~1,200 acres at full pool with a maximum depth of ~90 ft (27 m). " +
      "Cochiti Dam (1975) is the second-largest earthen dam in the US; the lake and surrounding " +
      "lands are part of Cochiti Pueblo's traditional territory.",
    keywords:
      "Cochiti Lake,Cochiti Dam,Rio Grande,New Mexico,NM,Sandoval County,Southwest,reservoir," +
      "freshwater,largemouth bass,USGS,3DEP,USACE,Albuquerque District,Cochiti Pueblo,Santa Fe," +
      "Albuquerque",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-navajo-lake-nm-co",
    name: "Navajo Lake (NM/CO)",
    sourceAgency: "USGS/USBR",
    dataType: "bathymetry",
    resolutionMMin: 1,
    resolutionMMax: 10,
    coverageBbox: { minLon: -107.72, minLat: 36.8, maxLon: -107.3, maxLat: 37.1 },
    endpointUrl:
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes:
      "Accessible via USGS 3DEP WCS. Navajo Dam on the San Juan River; " +
      "operated by USBR. The dam's tailwater produces one of the premier trophy trout " +
      "tailwaters in the Southwest.",
    description:
      "Navajo Lake on the San Juan River in San Juan County, New Mexico, and Archuleta County, " +
      "Colorado, covers ~15,600 acres with a maximum depth of ~400 ft (122 m). Impounded by " +
      "Navajo Dam (1962); the reservoir holds kokanee salmon and trophy bass while the tailwater " +
      "below the dam is a world-class trophy trout fishery.",
    keywords:
      "Navajo Lake,Navajo Dam,San Juan River,New Mexico,NM,Colorado,CO,San Juan County," +
      "Archuleta County,Southwest,Rio Grande,reservoir,freshwater,kokanee,trout,rainbow trout," +
      "largemouth bass,USGS,3DEP,USBR,Bureau of Reclamation,Aztec,Farmington",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  // -------------------------------------------------------------------------
  // AOOS Intertidal Habitats — Prince of Wales Island (pre-existing entry follows)
  // -------------------------------------------------------------------------
  {
    id: "aoos-intertidal-pow",
    name: "AOOS Intertidal Habitats — Prince of Wales Island",
    sourceAgency: "Alaska Ocean Observing System (AOOS)",
    dataType: "habitat",
    resolutionMMin: null,
    resolutionMMax: null,
    coverageBbox: { minLon: -134, minLat: 54.7, maxLon: -132, maxLat: 56.3 },
    endpointUrl: "https://portal.aoos.org/",
    accessNotes:
      "Intertidal habitat polygons from the AOOS Alaska Coastal Habitats service for Prince of Wales Island. " +
      "Scored using the BathyScan Intertidal Scorer for tidepool and beachcombing quality. " +
      "Bundle is refreshed periodically from the AOOS ArcGIS REST endpoint.",
    description:
      "Alaska Ocean Observing System (AOOS) intertidal habitat polygons for Prince of Wales Island (SE Alaska). " +
      "Covers the Clarence Strait / Craig / Hydaburg shoreline area. Each polygon is scored 0–100 for " +
      "tidepool and beachcombing quality. Data sourced from the AOOS AKCoastalHabitats FeatureServer; " +
      "refreshed offline via the BathyScan build-aoos-intertidal-pow script.",
    keywords:
      "AOOS,intertidal,habitat,Prince of Wales Island,POW,SE Alaska,Craig,Hydaburg,Clarence Strait," +
      "tidepool,beachcombing,coastal,shoreline,marine,intertidal scorer,hotspot",
    lastUpdated: "2026-05-31",
    waterType: "saltwater",
  },

  // ===========================================================================
  // US Freshwater Lake Catalog
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // Great Lakes — backed by NOAA NCEI Great Lakes DEM WCS
  // ---------------------------------------------------------------------------
  {
    id: "fw-lake-superior",
    name: "Lake Superior",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -92.2, minLat: 46.3, maxLon: -84.3, maxLat: 49.0 },
    endpointUrl: "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/NOAA_Great_Lakes_mosaics/ImageServer/WCSServer",
    accessNotes: "WCS coverage: superior_lld. NOAA NCEI Great Lakes DEM high-resolution bathymetric mosaic.",
    description: "Lake Superior — the largest of the Great Lakes by surface area and deepest on average. Max depth 406 m. Borders Minnesota, Wisconsin, Michigan, and Ontario. Fed by numerous rivers including the Nipigon. Drains east through the St. Marys River to Lake Huron.",
    keywords: "Lake Superior,Superior,Great Lakes,freshwater,Minnesota,Wisconsin,Michigan,Ontario,MN,WI,MI,NOAA,NCEI,bathymetry,Duluth,Marquette,Apostle Islands",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-michigan",
    name: "Lake Michigan",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -88.1, minLat: 41.6, maxLon: -84.7, maxLat: 46.1 },
    endpointUrl: "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/NOAA_Great_Lakes_mosaics/ImageServer/WCSServer",
    accessNotes: "WCS coverage: michigan_lld. NOAA NCEI Great Lakes DEM high-resolution bathymetric mosaic.",
    description: "Lake Michigan — the only Great Lake entirely within the United States. Max depth 281 m. Borders Illinois, Indiana, Michigan, and Wisconsin. Connected to Lake Huron via the Straits of Mackinac. Major cities on its shores include Chicago and Milwaukee.",
    keywords: "Lake Michigan,Michigan,Great Lakes,freshwater,Illinois,Indiana,Wisconsin,IL,IN,MI,WI,NOAA,NCEI,bathymetry,Chicago,Milwaukee,Green Bay,Traverse City",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-huron",
    name: "Lake Huron",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -84.6, minLat: 43.0, maxLon: -79.6, maxLat: 46.6 },
    endpointUrl: "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/NOAA_Great_Lakes_mosaics/ImageServer/WCSServer",
    accessNotes: "WCS coverage: huron_lld. NOAA NCEI Great Lakes DEM high-resolution bathymetric mosaic.",
    description: "Lake Huron — the second-largest Great Lake by surface area. Max depth 229 m. Borders Michigan and Ontario. Contains Georgian Bay and the North Channel. Connected to Lake Michigan via the Straits of Mackinac and drains to Lake Erie via the St. Clair River.",
    keywords: "Lake Huron,Huron,Great Lakes,freshwater,Michigan,Ontario,MI,NOAA,NCEI,bathymetry,Georgian Bay,Sault Ste. Marie,Mackinac,North Channel",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-erie",
    name: "Lake Erie",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -83.5, minLat: 41.4, maxLon: -78.8, maxLat: 43.0 },
    endpointUrl: "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/NOAA_Great_Lakes_mosaics/ImageServer/WCSServer",
    accessNotes: "WCS coverage: erie_lld. NOAA NCEI Great Lakes DEM high-resolution bathymetric mosaic.",
    description: "Lake Erie — the shallowest and southernmost of the Great Lakes. Max depth 64 m, average depth 19 m. Borders Ohio, Pennsylvania, New York, Michigan, and Ontario. Drains via Niagara River to Lake Ontario. Important for walleye, perch, and bass fisheries.",
    keywords: "Lake Erie,Erie,Great Lakes,freshwater,Ohio,Pennsylvania,New York,Michigan,Ontario,OH,PA,NY,MI,NOAA,NCEI,bathymetry,Cleveland,Toledo,Buffalo,Erie,walleye,perch",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-ontario",
    name: "Lake Ontario",
    sourceAgency: "NOAA/NCEI",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -79.9, minLat: 43.1, maxLon: -75.9, maxLat: 44.3 },
    endpointUrl: "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/NOAA_Great_Lakes_mosaics/ImageServer/WCSServer",
    accessNotes: "WCS coverage: ontario_lld. NOAA NCEI Great Lakes DEM high-resolution bathymetric mosaic.",
    description: "Lake Ontario — the smallest and easternmost Great Lake by surface area. Max depth 244 m. Borders New York and Ontario. Receives outflow from Lake Erie via Niagara River. Drains east via the St. Lawrence River to the Atlantic Ocean.",
    keywords: "Lake Ontario,Ontario,Great Lakes,freshwater,New York,Ontario,NY,NOAA,NCEI,bathymetry,Toronto,Rochester,Kingston,Niagara,St. Lawrence",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },

  // ---------------------------------------------------------------------------
  // Northeast lakes — NY (NYSDEC catalog stubs) and non-NY (USGS 3DEP)
  // ---------------------------------------------------------------------------
  {
    id: "fw-lake-george-ny",
    name: "Lake George, NY",
    sourceAgency: "NYSDEC",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -73.7, minLat: 43.4, maxLon: -73.4, maxLat: 43.8 },
    endpointUrl: "https://data.gis.ny.gov/datasets/nysdec-lake-bathymetry",
    accessNotes: "NYSDEC ArcGIS REST endpoint. Requires custom ArcGIS REST fetcher: query by geometry, return bathymetric raster or contour dataset.",
    description: "Lake George, Warren County, NY — a glacially carved oligotrophic lake in the Adirondacks. 51 km long, max depth 57 m. Drains north via the LaChute River to Lake Champlain. Renowned clarity; one of the cleanest large lakes in the US. Excellent smallmouth bass, lake trout, and landlocked salmon fishery.",
    keywords: "Lake George,George,New York,NY,Adirondacks,Warren County,freshwater,bathymetry,NYSDEC,trout,lake trout,smallmouth bass,landlocked salmon,clarity,Queen of American Lakes",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-champlain",
    name: "Lake Champlain, NY/VT",
    sourceAgency: "USGS / NYSDEC / Vermont DEC",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -73.45, minLat: 43.6, maxLon: -73.1, maxLat: 45.0 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation) as primary source. High-resolution NYSDEC/VT DEC bathymetric survey also available via state GIS portals.",
    description: "Lake Champlain — a large natural lake on the NY/VT border. 193 km long, max depth 122 m. Drains north via the Richelieu River to the St. Lawrence. Borders Vermont and New York with portions extending into Quebec. Important for salmon, trout, walleye, and bass fisheries.",
    keywords: "Lake Champlain,Champlain,New York,Vermont,NY,VT,Adirondacks,Green Mountains,freshwater,bathymetry,USGS,3DEP,NYSDEC,salmon,trout,walleye,bass,Burlington,Plattsburgh",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-seneca-lake-ny",
    name: "Seneca Lake, NY",
    sourceAgency: "NYSDEC",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -76.95, minLat: 42.5, maxLon: -76.7, maxLat: 43.0 },
    endpointUrl: "https://data.gis.ny.gov/datasets/nysdec-lake-bathymetry",
    accessNotes: "NYSDEC ArcGIS REST endpoint. Requires custom ArcGIS REST fetcher: query by geometry, return bathymetric raster or contour dataset.",
    description: "Seneca Lake — the largest of the Finger Lakes and the deepest lake in New York state. 61 km long, max depth 188 m. Never freezes due to its great depth. Located in Schuyler and Seneca counties. Exceptional lake trout and rainbow trout fishery; surrounds by world-class Finger Lakes wine country.",
    keywords: "Seneca Lake,Seneca,Finger Lakes,New York,NY,Schuyler,freshwater,bathymetry,NYSDEC,lake trout,rainbow trout,trout,wine,wine country,deepest lake New York",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-cayuga-lake-ny",
    name: "Cayuga Lake, NY",
    sourceAgency: "NYSDEC",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -76.9, minLat: 42.4, maxLon: -76.6, maxLat: 42.9 },
    endpointUrl: "https://data.gis.ny.gov/datasets/nysdec-lake-bathymetry",
    accessNotes: "NYSDEC ArcGIS REST endpoint. Requires custom ArcGIS REST fetcher.",
    description: "Cayuga Lake — one of the longest and widest Finger Lakes. 61 km long, max depth 133 m. Located in Tompkins and Seneca counties; home to Cornell University on its southern shore. Lake trout, rainbow trout, and landlocked Atlantic salmon. Notable for Ithaca Falls and Cornell Plantations.",
    keywords: "Cayuga Lake,Cayuga,Finger Lakes,New York,NY,Tompkins,Ithaca,Cornell,freshwater,bathymetry,NYSDEC,lake trout,rainbow trout,trout,salmon",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-oneida-lake-ny",
    name: "Oneida Lake, NY",
    sourceAgency: "NYSDEC",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -76.2, minLat: 43.1, maxLon: -75.9, maxLat: 43.25 },
    endpointUrl: "https://data.gis.ny.gov/datasets/nysdec-lake-bathymetry",
    accessNotes: "NYSDEC ArcGIS REST endpoint. Largest lake entirely within New York State.",
    description: "Oneida Lake — the largest lake lying entirely within New York State. 34 km long, shallow (avg 6.8 m, max 16.8 m). Located in Oswego, Madison, and Onondaga counties. One of the most productive walleye fisheries in the northeastern US; also known for yellow perch and bass.",
    keywords: "Oneida Lake,Oneida,New York,NY,Oswego,Madison,Onondaga,freshwater,bathymetry,NYSDEC,walleye,yellow perch,perch,bass,largest lake New York",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-canandaigua-lake-ny",
    name: "Canandaigua Lake, NY",
    sourceAgency: "NYSDEC",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -77.37, minLat: 42.73, maxLon: -77.24, maxLat: 42.98 },
    endpointUrl: "https://data.gis.ny.gov/datasets/nysdec-lake-bathymetry",
    accessNotes: "NYSDEC ArcGIS REST endpoint. Requires custom ArcGIS REST fetcher: query by geometry, return bathymetric raster or contour dataset.",
    description: "Canandaigua Lake — the westernmost of the five main Finger Lakes. 26 km long, max depth 84 m. Located in Ontario County. Anchors the historic resort city of Canandaigua. Part of the Finger Lakes wine country. Lake trout, smallmouth bass, and rainbow trout fishery.",
    keywords: "Canandaigua Lake,Canandaigua,Finger Lakes,New York,NY,Ontario County,freshwater,bathymetry,NYSDEC,lake trout,bass,rainbow trout,fishing,wine country,Canandaigua city,Bristol Hills,recreation",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-keuka-lake-ny",
    name: "Keuka Lake, NY",
    sourceAgency: "NYSDEC",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -77.17, minLat: 42.41, maxLon: -76.96, maxLat: 42.68 },
    endpointUrl: "https://data.gis.ny.gov/datasets/nysdec-lake-bathymetry",
    accessNotes: "NYSDEC ArcGIS REST endpoint. Requires custom ArcGIS REST fetcher. Y-shaped lake unique among the Finger Lakes.",
    description: "Keuka Lake — uniquely Y-shaped; the only Finger Lake with an outlet flowing into another Finger Lake (Seneca via the Keuka Lake Outlet). 57 km² total, max depth 57 m. Straddles Yates and Steuben counties. Renowned for Riesling wine production and lake trout fishing.",
    keywords: "Keuka Lake,Keuka,Finger Lakes,New York,NY,Yates County,Steuben County,freshwater,bathymetry,NYSDEC,lake trout,bass,fishing,wine country,Hammondsport,Penn Yan,Riesling,Y-shaped",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-placid-ny",
    name: "Lake Placid, NY",
    sourceAgency: "NYSDEC",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -74.0, minLat: 44.18, maxLon: -73.88, maxLat: 44.3 },
    endpointUrl: "https://data.gis.ny.gov/datasets/nysdec-lake-bathymetry",
    accessNotes: "NYSDEC ArcGIS REST endpoint. Requires custom ArcGIS REST fetcher.",
    description: "Lake Placid — a deep oligotrophic lake in the Adirondack High Peaks region. Max depth 61 m. Located in Essex County; home to the 1932 and 1980 Winter Olympics. Excellent lake trout fishery and renowned for its clean mountain water. Not to be confused with the village of Lake Placid on Mirror Lake.",
    keywords: "Lake Placid,Placid,Adirondacks,High Peaks,New York,NY,Essex County,freshwater,bathymetry,NYSDEC,Olympics,lake trout,trout,Whiteface Mountain",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-saranac-lake-ny",
    name: "Saranac Lake, NY",
    sourceAgency: "NYSDEC",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -74.2, minLat: 44.3, maxLon: -74.0, maxLat: 44.45 },
    endpointUrl: "https://data.gis.ny.gov/datasets/nysdec-lake-bathymetry",
    accessNotes: "NYSDEC ArcGIS REST endpoint. The Saranac Lakes chain (Upper, Middle, Lower) connects through the Saranac River.",
    description: "Saranac Lakes (Upper, Middle, Lower) — a chain of connected lakes in the Adirondacks near the village of Saranac Lake, NY. Essex and Franklin counties. Excellent smallmouth bass, lake trout, and landlocked salmon. The chain is popular for paddling and connects to a vast Adirondack paddling network.",
    keywords: "Saranac Lake,Saranac,Upper Saranac,Lower Saranac,Middle Saranac,Adirondacks,New York,NY,Essex,Franklin,freshwater,bathymetry,NYSDEC,lake trout,smallmouth bass,salmon,paddling",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-winnipesaukee-nh",
    name: "Lake Winnipesaukee, NH",
    sourceAgency: "USGS / NH DES",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -71.55, minLat: 43.5, maxLon: -71.15, maxLat: 43.75 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). NH DES bathymetric survey also available via GRANIT GIS portal.",
    description: "Lake Winnipesaukee — the largest lake in New Hampshire. 44 km long, max depth 55 m. Located in Belknap and Carroll counties; home to the Weirs Beach resort area. Major bass, salmon, and lake trout fishery. 274 islands and 480 km of shoreline.",
    keywords: "Lake Winnipesaukee,Winnipesaukee,New Hampshire,NH,Belknap,Carroll,White Mountains,freshwater,bathymetry,USGS,3DEP,bass,salmon,lake trout,trout,Laconia,Meredith,Wolfeboro",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-sebago-lake-me",
    name: "Sebago Lake, ME",
    sourceAgency: "USGS / Maine DEP",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -70.75, minLat: 43.8, maxLon: -70.5, maxLat: 44.05 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Maine DEP bathymetric survey available via Maine GeoLibrary.",
    description: "Sebago Lake — the second-largest lake in Maine and one of the deepest in New England. Max depth 101 m. Located in Cumberland County; provides drinking water for the Greater Portland area. World-renowned landlocked Atlantic salmon fishery; also lake trout, smallmouth bass, and togue (local term for lake trout).",
    keywords: "Sebago Lake,Sebago,Maine,ME,Cumberland,Portland,freshwater,bathymetry,USGS,3DEP,landlocked salmon,Atlantic salmon,salmon,lake trout,togue,smallmouth bass",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-moosehead-lake-me",
    name: "Moosehead Lake, ME",
    sourceAgency: "USGS / Maine DEP",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -69.85, minLat: 45.5, maxLon: -69.4, maxLat: 45.95 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Maine's largest lake.",
    description: "Moosehead Lake — the largest lake in Maine and the largest lake in the eastern United States entirely within one state. 56 km long, max depth 74 m. Located in Piscataquis County. Remote wilderness setting; excellent lake trout (togue), landlocked salmon, and smallmouth bass. Gateway to the Allagash wilderness.",
    keywords: "Moosehead Lake,Moosehead,Maine,ME,Piscataquis,Greenville,freshwater,bathymetry,USGS,3DEP,lake trout,togue,landlocked salmon,salmon,smallmouth bass,wilderness,Allagash",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-quabbin-reservoir-ma",
    name: "Quabbin Reservoir, MA",
    sourceAgency: "USGS / DCR Massachusetts",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -72.4, minLat: 42.15, maxLon: -72.1, maxLat: 42.5 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Massachusetts DCR manages access; fishing by permit.",
    description: "Quabbin Reservoir — the primary water supply for greater Boston and one of the largest unfiltered surface water supplies in the US. Max depth 43 m. Located in Hampshire and Worcester counties, created by flooding 4 towns in the 1930s. Managed by DCR for water supply and wildlife; limited public fishing by permit.",
    keywords: "Quabbin Reservoir,Quabbin,Massachusetts,MA,Hampshire,Worcester,Boston water supply,freshwater,bathymetry,USGS,3DEP,trout,bass,DCR",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-memphremagog-vt",
    name: "Lake Memphremagog, VT",
    sourceAgency: "USGS / Vermont DEC",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -72.3, minLat: 44.9, maxLon: -72.05, maxLat: 45.35 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Transboundary lake — US portion in Vermont; majority in Quebec, Canada.",
    description: "Lake Memphremagog — a transboundary lake straddling Vermont (US) and Quebec (Canada). 43 km long, max depth 107 m. Newport, VT is on its southern shore. One of the few US–Canada transboundary lakes in New England. Excellent trout, walleye, and yellow perch fishery; legendary 'Memphre' lake monster lore.",
    keywords: "Lake Memphremagog,Memphremagog,Vermont,VT,Newport,Green Mountains,freshwater,bathymetry,USGS,3DEP,trout,walleye,yellow perch,transboundary,Quebec,Canada,Memphre",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },

  // ---------------------------------------------------------------------------
  // Midwest lakes
  // ---------------------------------------------------------------------------
  {
    id: "fw-lake-minnetonka-mn",
    name: "Lake Minnetonka, MN",
    sourceAgency: "MN DNR",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -93.75, minLat: 44.88, maxLon: -93.35, maxLat: 44.98 },
    endpointUrl: "https://resources.gis.mn.gov/services/glo/MapServer",
    accessNotes: "MN DNR ArcGIS REST service. Requires custom MN DNR ArcGIS REST fetcher; bathymetric contours available via MN DNR LakeFinder.",
    description: "Lake Minnetonka — a large recreational lake in Hennepin County, MN, immediately west of Minneapolis. 15 interconnected bays; max depth 30 m. Famous for largemouth bass, walleye, northern pike, and panfish. Surrounded by affluent suburbs; one of the most-fished lakes in Minnesota.",
    keywords: "Lake Minnetonka,Minnetonka,Minnesota,MN,Hennepin,Minneapolis,Twin Cities,Midwest,freshwater,bathymetry,MN DNR,walleye,bass,northern pike,panfish,Wayzata,Excelsior",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-mille-lacs-lake-mn",
    name: "Mille Lacs Lake, MN",
    sourceAgency: "MN DNR",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -93.85, minLat: 46.05, maxLon: -93.45, maxLat: 46.45 },
    endpointUrl: "https://resources.gis.mn.gov/services/glo/MapServer",
    accessNotes: "MN DNR ArcGIS REST service. Requires custom MN DNR ArcGIS REST fetcher.",
    description: "Mille Lacs Lake — one of Minnesota's largest and most celebrated fishing lakes. 53,000 acres, max depth 13 m. Located in Aitkin, Crow Wing, and Mille Lacs counties. World-class walleye fishery; also known for northern pike, bass, and perch. Mille Lacs Band of Ojibwe exercise treaty fishing rights.",
    keywords: "Mille Lacs Lake,Mille Lacs,Minnesota,MN,Aitkin,Crow Wing,Midwest,freshwater,bathymetry,MN DNR,walleye,northern pike,bass,perch,Ojibwe,treaty fishing",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-leech-lake-mn",
    name: "Leech Lake, MN",
    sourceAgency: "MN DNR",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -94.65, minLat: 47.1, maxLon: -94.05, maxLat: 47.5 },
    endpointUrl: "https://resources.gis.mn.gov/services/glo/MapServer",
    accessNotes: "MN DNR ArcGIS REST service. Requires custom MN DNR ArcGIS REST fetcher.",
    description: "Leech Lake — the third-largest lake in Minnesota. 112,000 acres, max depth 12 m. Located in Cass County within Chippewa National Forest. Outstanding walleye and muskie (muskellunge) fishery; classic northern Minnesota lake surrounded by pine forests. Leech Lake Band of Ojibwe tribal lands.",
    keywords: "Leech Lake,Minnesota,MN,Cass County,Chippewa National Forest,Midwest,freshwater,bathymetry,MN DNR,walleye,muskie,muskellunge,northern pike,bass,Ojibwe,Walker,northern Minnesota",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-red-lake-mn",
    name: "Red Lake, MN",
    sourceAgency: "MN DNR / Red Lake Band of Chippewa",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -95.55, minLat: 47.7, maxLon: -94.65, maxLat: 48.15 },
    endpointUrl: "https://resources.gis.mn.gov/services/glo/MapServer",
    accessNotes: "MN DNR ArcGIS REST service. Upper and Lower Red Lake; partly on Red Lake Band of Chippewa reservation. Requires custom MN DNR ArcGIS REST fetcher.",
    description: "Red Lake — the largest lake entirely within Minnesota, comprising Upper and Lower Red Lake. 110,000 acres total, max depth 9 m in Lower Red Lake. Located in Beltrami County. Red Lake Band of Chippewa exercise exclusive rights over Upper Red Lake. Outstanding walleye recovery story — collapsed and rebounded through co-management.",
    keywords: "Red Lake,Minnesota,MN,Beltrami,Upper Red Lake,Lower Red Lake,Red Lake Band,Chippewa,Ojibwe,Midwest,freshwater,bathymetry,MN DNR,walleye,perch,Red Lake Nation",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-of-the-woods",
    name: "Lake of the Woods, MN/ON",
    sourceAgency: "USGS / MN DNR",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -95.4, minLat: 48.7, maxLon: -94.5, maxLat: 49.4 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation) for US portion. Transboundary: US portion in MN (Angle Inlet); remainder in Ontario and Manitoba, Canada.",
    description: "Lake of the Woods — a huge lake spanning Minnesota (US), Ontario, and Manitoba (Canada). Over 14,000 islands and 65,000 miles of shoreline. US portion (Angle Inlet) is accessible only through Canada. World-famous walleye and sauger fishery. The 49th parallel splits the US from Canada through the lake.",
    keywords: "Lake of the Woods,Minnesota,MN,Ontario,Canada,Angle Inlet,Northwest Angle,Midwest,freshwater,bathymetry,USGS,3DEP,walleye,sauger,northern pike,Baudette,International Falls,transboundary",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-winnebago-wi",
    name: "Lake Winnebago, WI",
    sourceAgency: "USGS / Wisconsin DNR",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -88.55, minLat: 43.75, maxLon: -88.25, maxLat: 44.2 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Wisconsin DNR bathymetric survey also available.",
    description: "Lake Winnebago — the largest lake entirely within Wisconsin. 215,000 acres, max depth 6.4 m. Located in Winnebago, Fond du Lac, and Calumet counties. Famous for its winter sturgeon spearing season (some of the few legal sturgeon spearing in the US). Also excellent walleye, white bass, and perch.",
    keywords: "Lake Winnebago,Winnebago,Wisconsin,WI,Fond du Lac,Calumet,Midwest,freshwater,bathymetry,USGS,3DEP,sturgeon,spearing,walleye,white bass,perch,Oshkosh,Neenah,Menasha",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-gull-lake-mi",
    name: "Gull Lake, MI",
    sourceAgency: "USGS / Michigan DNR",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -85.45, minLat: 42.35, maxLon: -85.3, maxLat: 42.5 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Michigan DNR bathymetric chart also available.",
    description: "Gull Lake — a clear, deep glacial lake in Kalamazoo and Barry counties, MI. 2,030 acres, max depth 34 m. One of the deepest and clearest lakes in SW Michigan. Excellent walleye, bass, perch, and panfish. Michigan State University's Kellogg Biological Station is on its western shore.",
    keywords: "Gull Lake,Michigan,MI,Kalamazoo,Barry,Midwest,freshwater,bathymetry,USGS,3DEP,walleye,bass,perch,panfish,MSU,Kellogg Biological Station,southwest Michigan",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },

  // ---------------------------------------------------------------------------
  // Western lakes
  // ---------------------------------------------------------------------------
  {
    id: "fw-lake-tahoe",
    name: "Lake Tahoe, CA/NV",
    sourceAgency: "USGS ScienceBase / USGS 3DEP",
    dataType: "bathymetry",
    resolutionMMin: 10,
    resolutionMMax: 30,
    coverageBbox: { minLon: -120.15, minLat: 38.9, maxLon: -119.9, maxLat: 39.25 },
    endpointUrl: "https://www.sciencebase.gov/catalog/item/5a8ea03fe4b00583a4ddae3b",
    accessNotes: "High-resolution USGS ScienceBase bathymetric survey (Schweitzer et al.); download-and-bundle path. Also available via USGS 3DEP WCS as fallback.",
    description: "Lake Tahoe — a large alpine lake in the Sierra Nevada on the CA/NV border. Max depth 501 m; 1,645 ft above sea level. Famous for its cobalt-blue clarity (Secchi depth exceeding 20 m). Straddling El Dorado and Placer counties (CA) and Washoe and Douglas counties (NV). Premier trout, kokanee salmon, and mackinaw (lake trout) fishery.",
    keywords: "Lake Tahoe,Tahoe,California,Nevada,CA,NV,Sierra Nevada,El Dorado,Placer,Washoe,Douglas,freshwater,bathymetry,USGS,ScienceBase,clarity,kokanee,mackinaw,lake trout,rainbow trout,alpine",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-powell",
    name: "Lake Powell, AZ/UT",
    sourceAgency: "USGS / USBR",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -111.6, minLat: 36.8, maxLon: -110.4, maxLat: 38.0 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Created by Glen Canyon Dam (USBR); water levels vary significantly by year.",
    description: "Lake Powell — a reservoir on the Colorado River in Glen Canyon, straddling Arizona and Utah. Max depth 171 m at full pool. Created by Glen Canyon Dam (1966). Part of Glen Canyon National Recreation Area. Dramatic red-rock canyon scenery; striped bass, largemouth bass, walleye, and catfish. Colorado Plateau location.",
    keywords: "Lake Powell,Powell,Arizona,Utah,AZ,UT,Colorado River,Glen Canyon,Colorado Plateau,Southwest,freshwater,bathymetry,USGS,3DEP,USBR,striped bass,largemouth bass,walleye,catfish,reservoir,dam",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-mead",
    name: "Lake Mead, NV/AZ",
    sourceAgency: "USGS / USBR / NPS",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -114.85, minLat: 35.75, maxLon: -113.9, maxLat: 36.65 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Created by Hoover Dam (USBR); water levels vary significantly.",
    description: "Lake Mead — the largest reservoir by volume in the United States when full. Created by Hoover Dam on the Colorado River. Max depth 162 m. Straddles Nevada and Arizona; managed as Lake Mead National Recreation Area (NPS). Striped bass, largemouth bass, catfish, and carp fishery. Las Vegas water supply.",
    keywords: "Lake Mead,Mead,Nevada,Arizona,NV,AZ,Colorado River,Hoover Dam,Las Vegas,Southwest,freshwater,bathymetry,USGS,3DEP,USBR,NPS,striped bass,largemouth bass,catfish,reservoir,largest reservoir US",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-crater-lake-or",
    name: "Crater Lake, OR",
    sourceAgency: "USGS ScienceBase / NPS",
    dataType: "bathymetry",
    resolutionMMin: 2,
    resolutionMMax: 10,
    coverageBbox: { minLon: -122.22, minLat: 42.84, maxLon: -121.93, maxLat: 43.0 },
    endpointUrl: "https://www.sciencebase.gov/catalog/item/5b28e9e7e4b0702d0e816a50",
    accessNotes: "High-resolution USGS ScienceBase bathymetric survey (Bacon et al.); download-and-bundle path. Deepest lake in the United States.",
    description: "Crater Lake — the deepest lake in the United States (592 m) and one of the clearest in the world. Formed in the caldera of collapsed volcano Mt. Mazama (~7,700 years ago). Located in Crater Lake National Park, Klamath County, OR. Famous for its deep blue color; Wizard Island cinder cone. Rainbow trout and kokanee salmon (both introduced).",
    keywords: "Crater Lake,Oregon,OR,Klamath,Cascade Range,caldera,volcano,Mt. Mazama,National Park,West,freshwater,bathymetry,USGS,ScienceBase,NPS,deepest lake US,rainbow trout,kokanee,blue,clarity",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-flathead-lake-mt",
    name: "Flathead Lake, MT",
    sourceAgency: "USGS / Montana FWP",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -114.45, minLat: 47.5, maxLon: -113.85, maxLat: 48.0 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Largest natural freshwater lake in the western US.",
    description: "Flathead Lake — the largest natural freshwater lake in the western United States. 487 km² surface area, max depth 113 m. Located in Lake and Flathead counties, MT, between Glacier National Park and the Mission Mountains. Outstanding cutthroat trout, bull trout, lake whitefish, and lake trout fishery. Part of the Flathead Indian Reservation.",
    keywords: "Flathead Lake,Flathead,Montana,MT,Glacier National Park,Mission Mountains,Flathead Indian Reservation,Northwest,freshwater,bathymetry,USGS,3DEP,bull trout,cutthroat trout,lake trout,whitefish,largest western US",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-shasta-lake-ca",
    name: "Shasta Lake, CA",
    sourceAgency: "USGS / USBR",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -122.55, minLat: 40.65, maxLon: -122.15, maxLat: 41.0 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Created by Shasta Dam (USBR); largest reservoir in California by capacity.",
    description: "Shasta Lake (Shasta Reservoir) — the largest reservoir in California by capacity. Created by Shasta Dam on the Sacramento River. Max depth 183 m at full pool. Located in Shasta County; managed as Shasta Lake National Recreation Area (USFS). Excellent bass, trout, kokanee, and catfish fishery.",
    keywords: "Shasta Lake,Shasta,California,CA,Shasta County,Sacramento River,Cascade Range,West,freshwater,bathymetry,USGS,3DEP,USBR,bass,trout,kokanee,catfish,reservoir,largest reservoir California,Redding",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-chelan-wa",
    name: "Lake Chelan, WA",
    sourceAgency: "USGS / Washington DNR",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -120.75, minLat: 47.8, maxLon: -119.85, maxLat: 48.25 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Third-deepest lake in the US.",
    description: "Lake Chelan — the third-deepest lake in the United States (453 m). A glacially carved fjord-like lake in north-central Washington. 88 km long. Located in Chelan County in the eastern Cascades. Excellent rainbow trout, lake trout (mackinaw), sockeye salmon, and kokanee fishery. Remote Stehekin community at its head is accessible only by boat or floatplane.",
    keywords: "Lake Chelan,Chelan,Washington,WA,Chelan County,Cascade Range,Stehekin,Pacific Northwest,Northwest,freshwater,bathymetry,USGS,3DEP,rainbow trout,mackinaw,lake trout,sockeye,kokanee,third deepest US",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-upper-klamath-lake-or",
    name: "Upper Klamath Lake, OR",
    sourceAgency: "USGS / USFWS",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -122.15, minLat: 42.15, maxLon: -121.75, maxLat: 42.55 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Largest lake in Oregon; critical habitat for C. coho salmon and Lost River suckers.",
    description: "Upper Klamath Lake — the largest lake in Oregon. ~250 km², avg depth 2.4 m, max depth 14 m. Located in Klamath County; fed by the Wood and Williamson rivers. Critical habitat for endangered Lost River sucker, shortnose sucker, and Klamath Basin coho salmon. Subject of major Klamath River dam removal project.",
    keywords: "Upper Klamath Lake,Klamath Lake,Klamath,Oregon,OR,Klamath County,Pacific Northwest,West,freshwater,bathymetry,USGS,3DEP,coho salmon,sucker,Lost River sucker,dam removal,Klamath River,Klamath Falls",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-flaming-gorge",
    name: "Flaming Gorge Reservoir, UT/WY",
    sourceAgency: "USGS / USBR",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -110.05, minLat: 40.85, maxLon: -109.25, maxLat: 41.45 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Created by Flaming Gorge Dam (USBR) on the Green River.",
    description: "Flaming Gorge Reservoir — a reservoir on the Green River straddling Utah and Wyoming. 151 km long, max depth 151 m. Located in Daggett County, UT and Sweetwater County, WY. Named for the brilliant red canyon walls. Excellent rainbow trout, lake trout (mackinaw), kokanee, and smallmouth bass fishery. Part of Flaming Gorge NRA.",
    keywords: "Flaming Gorge,Flaming Gorge Reservoir,Utah,Wyoming,UT,WY,Green River,Colorado Plateau,Southwest,freshwater,bathymetry,USGS,3DEP,USBR,rainbow trout,lake trout,mackinaw,kokanee,smallmouth bass,NRA",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-havasu",
    name: "Lake Havasu, AZ/CA",
    sourceAgency: "USGS / USBR",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -114.65, minLat: 34.15, maxLon: -114.15, maxLat: 34.95 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Created by Parker Dam (USBR) on the Colorado River.",
    description: "Lake Havasu — a reservoir on the Colorado River between Arizona and California. 62 km long, max depth 30 m. Created by Parker Dam (1938). Home to Lake Havasu City, AZ where the original London Bridge was reassembled. Popular for striped bass, largemouth bass, and catfish. Major boating and water sports destination.",
    keywords: "Lake Havasu,Havasu,Arizona,California,AZ,CA,Colorado River,Parker Dam,Southwest,freshwater,bathymetry,USGS,3DEP,USBR,striped bass,largemouth bass,catfish,London Bridge,Lake Havasu City",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },

  // ---------------------------------------------------------------------------
  // Southeast and TVA lakes
  // ---------------------------------------------------------------------------
  {
    id: "fw-lake-okeechobee-fl",
    name: "Lake Okeechobee, FL",
    sourceAgency: "USGS / USACE South Florida",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -81.2, minLat: 26.65, maxLon: -80.55, maxLat: 27.25 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). USACE operates the Herbert Hoover Dike surrounding the lake for flood control.",
    description: "Lake Okeechobee — the largest freshwater lake in Florida and the second-largest entirely within the contiguous US. 1,890 km², avg depth 2.7 m. Located in south-central Florida. Famed for its largemouth bass (Florida strain), crappie (speckled perch), and catfish fisheries. Central to the Everglades ecosystem; managed by USACE/SFWMD.",
    keywords: "Lake Okeechobee,Okeechobee,Florida,FL,South Florida,Southeast,freshwater,bathymetry,USGS,3DEP,USACE,largemouth bass,Florida bass,crappie,speckled perch,catfish,Everglades,largest Florida lake,Herbert Hoover Dike",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-lanier-ga",
    name: "Lake Lanier, GA",
    sourceAgency: "USGS / USACE South Atlantic",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -84.15, minLat: 34.05, maxLon: -83.65, maxLat: 34.45 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). USACE South Atlantic Division manages Buford Dam on the Chattahoochee River.",
    description: "Lake Lanier (Lake Sidney Lanier) — a reservoir on the Chattahoochee River in Hall and Forsyth counties, GA, northeast of Atlanta. Max depth 41 m. Created by Buford Dam (1957). One of the most visited USACE lakes in the US; 1,000 km of shoreline. Excellent striped bass, largemouth bass, and spotted bass fishery. Atlanta metro water supply.",
    keywords: "Lake Lanier,Lake Sidney Lanier,Lanier,Georgia,GA,Hall,Forsyth,Atlanta,Chattahoochee River,Southeast,freshwater,bathymetry,USGS,3DEP,USACE,striped bass,largemouth bass,spotted bass,Gainesville,Cumming",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-of-the-ozarks-mo",
    name: "Lake of the Ozarks, MO",
    sourceAgency: "USGS / Ameren Missouri",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -93.1, minLat: 37.85, maxLon: -92.25, maxLat: 38.35 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). Created by Bagnell Dam (AmerenUE) on the Osage River.",
    description: "Lake of the Ozarks — a large reservoir created by Bagnell Dam on the Osage River in central Missouri. 93,000 acres, max depth 39 m. One of the largest artificial lakes in the US by shoreline length (~2,400 km). Located in Morgan, Camden, Miller, and Benton counties. Major Missouri resort and recreation destination. Largemouth bass, white bass, crappie, and catfish.",
    keywords: "Lake of the Ozarks,Ozarks,Missouri,MO,Morgan,Camden,Miller,Benton,Midwest,freshwater,bathymetry,USGS,3DEP,Bagnell Dam,Osage River,largemouth bass,white bass,crappie,catfish,Lake Ozark",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-table-rock-lake-mo",
    name: "Table Rock Lake, MO",
    sourceAgency: "USGS / USACE Little Rock",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -93.75, minLat: 36.48, maxLon: -92.95, maxLat: 36.75 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). USACE Little Rock District manages Table Rock Dam on the White River.",
    description: "Table Rock Lake — a reservoir on the White River in the Ozark Mountains near Branson, MO, extending into Arkansas. Max depth 62 m. Created by Table Rock Dam (1958). Famous for its clear water and outstanding largemouth and smallmouth bass fishery. USACE Little Rock District. Branson, MO is a major nearby tourist destination.",
    keywords: "Table Rock Lake,Table Rock,Missouri,Arkansas,MO,AR,Ozarks,Branson,White River,Southeast,Midwest,freshwater,bathymetry,USGS,3DEP,USACE,Little Rock,largemouth bass,smallmouth bass,bass,crappie",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-kentucky-lake",
    name: "Kentucky Lake, KY/TN",
    sourceAgency: "USGS / TVA",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -88.35, minLat: 36.25, maxLon: -87.75, maxLat: 36.85 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). TVA manages Kentucky Dam on the Tennessee River.",
    description: "Kentucky Lake — the largest man-made lake in the eastern United States. Created by Kentucky Dam (TVA, 1944) on the Tennessee River. 160,000 acres, max depth 33 m. Straddles Marshall and Calloway counties (KY) and Stewart County (TN). Adjacent to Lake Barkley via the Land Between the Lakes National Recreation Area. Crappie, bass, and catfish.",
    keywords: "Kentucky Lake,Kentucky,Tennessee,KY,TN,Tennessee River,TVA,Land Between the Lakes,Southeast,freshwater,bathymetry,USGS,3DEP,Kentucky Dam,crappie,bass,catfish,Murray,Paris Landing",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-barkley",
    name: "Lake Barkley, KY/TN",
    sourceAgency: "USGS / USACE Nashville",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -88.2, minLat: 36.55, maxLon: -87.85, maxLat: 37.15 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). USACE Nashville District manages Barkley Dam on the Cumberland River.",
    description: "Lake Barkley — a reservoir on the Cumberland River adjacent to Kentucky Lake, separated by the Land Between the Lakes NRA. 57,900 acres. Created by Barkley Dam (USACE Nashville, 1966). Located in Lyon and Trigg counties (KY) and Stewart County (TN). Excellent crappie, bass, catfish, and sauger fishery.",
    keywords: "Lake Barkley,Barkley,Kentucky,Tennessee,KY,TN,Cumberland River,USACE,Nashville,Land Between the Lakes,Southeast,freshwater,bathymetry,USGS,3DEP,crappie,bass,catfish,sauger,Cadiz",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-norris-lake-tn",
    name: "Norris Lake, TN",
    sourceAgency: "USGS / TVA",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -84.2, minLat: 36.05, maxLon: -83.75, maxLat: 36.45 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). TVA's first completed dam (Norris Dam, 1936) on the Clinch River.",
    description: "Norris Lake — the first reservoir built by the Tennessee Valley Authority (TVA). Created by Norris Dam (1936) on the Clinch and Powell rivers in Anderson and Campbell counties, TN. 34,200 acres, max depth 55 m. Outstanding striped bass, largemouth bass, smallmouth bass, crappie, and walleye. Crystal-clear water.",
    keywords: "Norris Lake,Norris,Tennessee,TN,TVA,Anderson,Campbell,Clinch River,Southeast,freshwater,bathymetry,USGS,3DEP,striped bass,largemouth bass,smallmouth bass,crappie,walleye,Norris Dam",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-fontana-lake-nc",
    name: "Fontana Lake, NC",
    sourceAgency: "USGS / TVA",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -83.95, minLat: 35.28, maxLon: -83.5, maxLat: 35.52 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). TVA Fontana Dam (highest in eastern US) on the Little Tennessee River. Borders Great Smoky Mountains National Park.",
    description: "Fontana Lake — a TVA reservoir on the Little Tennessee River bordering Great Smoky Mountains National Park in Graham and Swain counties, NC. 10,530 acres, max depth 155 m. Fontana Dam (480 ft) is the highest dam in the eastern US. Excellent walleye, smallmouth bass, and trout. Dramatic mountain scenery in the southern Appalachians.",
    keywords: "Fontana Lake,Fontana,North Carolina,NC,Graham,Swain,Great Smoky Mountains,TVA,Appalachians,Southeast,freshwater,bathymetry,USGS,3DEP,walleye,smallmouth bass,trout,Fontana Dam,highest dam eastern US",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-smith-mountain-lake-va",
    name: "Smith Mountain Lake, VA",
    sourceAgency: "USGS / AEP / USACE",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -79.8, minLat: 36.88, maxLon: -79.15, maxLat: 37.18 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). AEP Smith Mountain Dam on the Roanoke (Staunton) River.",
    description: "Smith Mountain Lake — Virginia's largest inland body of fresh water. 32,700 acres, max depth 67 m. Created by Smith Mountain Dam (AEP, 1966) on the Roanoke River. Located in Bedford, Franklin, and Pittsylvania counties. Striper (striped bass) capital of Virginia; also largemouth and smallmouth bass, crappie, and walleye.",
    keywords: "Smith Mountain Lake,Smith Mountain,Virginia,VA,Bedford,Franklin,Pittsylvania,Roanoke River,Southeast,freshwater,bathymetry,USGS,3DEP,striped bass,striper,largemouth bass,smallmouth bass,crappie,walleye,Moneta,Huddleston",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-clarks-hill-reservoir",
    name: "Clarks Hill / Strom Thurmond Reservoir, SC/GA",
    sourceAgency: "USGS / USACE Savannah",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -82.55, minLat: 33.45, maxLon: -81.95, maxLat: 33.8 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). USACE Savannah District manages J. Strom Thurmond Dam on the Savannah River.",
    description: "J. Strom Thurmond Lake (Clarks Hill Reservoir) — the largest lake in Georgia and South Carolina. 71,000 acres, max depth 43 m. Created by Strom Thurmond Dam (USACE Savannah, 1954) on the Savannah River. Borders South Carolina and Georgia. Excellent striped bass, largemouth bass, crappie, catfish, and bream.",
    keywords: "Clarks Hill,Strom Thurmond,Strom Thurmond Lake,Clarks Hill Reservoir,South Carolina,Georgia,SC,GA,Savannah River,USACE,Savannah,Southeast,freshwater,bathymetry,USGS,3DEP,striped bass,largemouth bass,crappie,catfish",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },

  // ---------------------------------------------------------------------------
  // Southwest / Texas Highland Lakes
  // ---------------------------------------------------------------------------
  {
    id: "fw-lake-travis-tx",
    name: "Lake Travis, TX",
    sourceAgency: "LCRA / USACE",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -98.15, minLat: 30.28, maxLon: -97.65, maxLat: 30.62 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). LCRA-operated; part of the Highland Lakes chain on the Colorado River (Texas).",
    description: "Lake Travis — a large reservoir on the Colorado River (Texas) in Travis and Burnet counties, near Austin. Max depth ~58 m at full pool. Part of the Highland Lakes chain operated by the Lower Colorado River Authority (LCRA). Flood control reservoir serving Austin's water supply. Outstanding largemouth bass, striped bass, white bass, and catfish.",
    keywords: "Lake Travis,Travis,Texas,TX,Austin,Highland Lakes,Colorado River,LCRA,Mansfield Dam,Travis County,Burnet County,Southwest,freshwater,bathymetry,USGS,3DEP,largemouth bass,striped bass,white bass,catfish",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-canyon-lake-tx",
    name: "Canyon Lake, TX",
    sourceAgency: "USACE Fort Worth",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -98.4, minLat: 29.78, maxLon: -98.1, maxLat: 30.05 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). USACE Fort Worth District; Canyon Dam on the Guadalupe River.",
    description: "Canyon Lake — a reservoir on the Guadalupe River in Comal County, TX. Max depth ~47 m. Created by Canyon Dam (USACE Fort Worth, 1964). Northwest of San Antonio and New Braunfels. Clear water fed by spring-fed Guadalupe River. Renowned trout fishing below the dam; largemouth and smallmouth bass, white bass, and catfish in the lake.",
    keywords: "Canyon Lake,Texas,TX,Comal,Guadalupe River,USACE,Fort Worth,San Antonio,New Braunfels,Southwest,freshwater,bathymetry,USGS,3DEP,trout,largemouth bass,smallmouth bass,white bass,catfish,Hill Country",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-lbj-tx",
    name: "Lake LBJ, TX",
    sourceAgency: "LCRA",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -98.5, minLat: 30.48, maxLon: -98.2, maxLat: 30.68 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). LCRA-operated; Wirtz Dam creates Lake LBJ on the Colorado River (Texas).",
    description: "Lake LBJ (Lyndon B. Johnson Lake) — a Highland Lakes reservoir on the Colorado River in Burnet and Llano counties, TX. 6,375 acres; relatively constant water level (run-of-river configuration). Part of the LCRA Highland Lakes chain. Named for President Lyndon B. Johnson. Crappie, white bass, largemouth bass, and catfish.",
    keywords: "Lake LBJ,Lake Lyndon B. Johnson,Texas,TX,Burnet,Llano,Highland Lakes,Colorado River,LCRA,Wirtz Dam,Southwest,freshwater,bathymetry,USGS,3DEP,largemouth bass,white bass,crappie,catfish,Horseshoe Bay,Marble Falls",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-inks-lake-tx",
    name: "Inks Lake, TX",
    sourceAgency: "LCRA",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -98.45, minLat: 30.7, maxLon: -98.35, maxLat: 30.77 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). LCRA-operated; Inks Dam on the Colorado River (Texas). Adjacent to Inks Lake State Park.",
    description: "Inks Lake — a run-of-river Highland Lakes reservoir on the Colorado River in Burnet County, TX. 803 acres; nearly constant water level, crystal clear. Adjacent to Inks Lake State Park. Part of the LCRA Highland Lakes chain between Lake Buchanan and Lake LBJ. Largemouth bass, white bass, yellow catfish, and striped bass (hybrid).",
    keywords: "Inks Lake,Texas,TX,Burnet,Highland Lakes,Colorado River,LCRA,Inks Dam,Inks Lake State Park,Southwest,freshwater,bathymetry,USGS,3DEP,largemouth bass,white bass,catfish,striped bass,Hill Country",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-lake-buchanan-tx",
    name: "Lake Buchanan, TX",
    sourceAgency: "LCRA",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -98.65, minLat: 30.58, maxLon: -98.2, maxLat: 30.92 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). LCRA-operated; Buchanan Dam (Texas's largest multi-arch dam) on the Colorado River.",
    description: "Lake Buchanan — the largest of the Highland Lakes and the northernmost reservoir of the LCRA chain on the Colorado River (Texas). 23,060 acres, max depth ~34 m. Located in Burnet and Llano counties. Buchanan Dam (1937) was the largest multi-arch dam in the US when built. Excellent striped bass, largemouth bass, white bass, catfish, and crappie.",
    keywords: "Lake Buchanan,Buchanan,Texas,TX,Burnet,Llano,Highland Lakes,Colorado River,LCRA,Buchanan Dam,Southwest,freshwater,bathymetry,USGS,3DEP,striped bass,largemouth bass,white bass,catfish,crappie,Llano County",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-elephant-butte-nm",
    name: "Elephant Butte Reservoir, NM",
    sourceAgency: "USGS / USBR",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -107.35, minLat: 32.85, maxLon: -107.05, maxLat: 33.3 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). USBR Elephant Butte Dam on the Rio Grande; water levels vary substantially.",
    description: "Elephant Butte Reservoir — New Mexico's largest body of water. Created by Elephant Butte Dam (USBR, 1916) on the Rio Grande in Sierra County. When full, 36,500 acres. Named for an elephant-shaped rock formation nearby. Major water supply for southern NM and Texas. Striped bass, largemouth bass, white bass, and walleye.",
    keywords: "Elephant Butte Reservoir,Elephant Butte,New Mexico,NM,Sierra County,Rio Grande,USBR,Southwest,freshwater,bathymetry,USGS,3DEP,striped bass,largemouth bass,white bass,walleye,Truth or Consequences",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-cochiti-lake-nm",
    name: "Cochiti Lake, NM",
    sourceAgency: "USGS / USACE Albuquerque",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -106.42, minLat: 35.6, maxLon: -106.3, maxLat: 35.77 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). USACE Albuquerque District; Cochiti Dam on the Rio Grande — one of the largest earthen dams in the US.",
    description: "Cochiti Lake — a reservoir on the Rio Grande in Sandoval County, NM, created by Cochiti Dam (USACE Albuquerque, 1975). One of the largest earthen dams in the US by volume. Located on Cochiti Pueblo land. Primary flood and sediment control; small permanent pool. Northern pike, largemouth bass, walleye, and catfish.",
    keywords: "Cochiti Lake,Cochiti,New Mexico,NM,Sandoval,Rio Grande,USACE,Albuquerque,Cochiti Pueblo,Southwest,freshwater,bathymetry,USGS,3DEP,northern pike,largemouth bass,walleye,catfish,earthen dam",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
  },
  {
    id: "fw-navajo-lake-nm",
    name: "Navajo Lake, NM/CO",
    sourceAgency: "USGS / USBR",
    dataType: "bathymetry",
    resolutionMMin: 30,
    resolutionMMax: 90,
    coverageBbox: { minLon: -107.75, minLat: 36.58, maxLon: -107.25, maxLat: 36.92 },
    endpointUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
    accessNotes: "USGS 3DEP WCS (coverage: DEP3Elevation). USBR Navajo Dam on the San Juan River. Straddles New Mexico and Colorado.",
    description: "Navajo Lake — a USBR reservoir on the San Juan River, straddling New Mexico and Colorado. 35 km long, max depth 105 m. Located in Rio Arriba and San Juan counties (NM) and Archuleta County (CO). Navajo State Park on the NM side; Navajo Lake State Park. Outstanding northern pike, largemouth bass, crappie, catfish, and smallmouth bass. Below dam world-class San Juan River tailwater trout fishery.",
    keywords: "Navajo Lake,Navajo,New Mexico,Colorado,NM,CO,San Juan River,USBR,Rio Arriba,San Juan County,Archuleta,Southwest,freshwater,bathymetry,USGS,3DEP,northern pike,largemouth bass,crappie,catfish,smallmouth bass,trout,tailwater,San Juan River trout",
    lastUpdated: "2024-01-01",
    waterType: "freshwater",
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
    // Load disabled preset IDs so suppressed presets are not (re-)inserted.
    let disabledPresetIds = new Set<string>();
    try {
      const disabledRows = await db.select({ id: disabledPresetsTable.id }).from(disabledPresetsTable);
      disabledPresetIds = new Set(disabledRows.map((r) => r.id));
    } catch {
      // Table may not exist during initial boot — safe to ignore.
    }

    // Reconcile preset-* rows against the current registry on every boot so
    // that newly-added preset datasets show up in Find Data search for
    // existing deployments, and retired presets stop showing up. Suppress
    // disabled presets so they do not re-appear after a server restart.
    const allPresetEntries = buildPresetCatalogEntries();
    const presetEntries = allPresetEntries.filter((e) => {
      // e.id has the form "preset-<datasetId>"
      const datasetId = e.id.startsWith("preset-") ? e.id.slice(7) : e.id;
      return !disabledPresetIds.has(datasetId);
    });
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
      logger.info({ purgedCount }, `[catalog] Purged ${purgedCount} stale preset-* rows no longer in registry.`);
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
        logger.info({ retiredCount }, `[catalog] Purged ${retiredCount} retired non-preset row(s).`);
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
    logger.info({ entryCount: entries.length }, `[catalog] Reconciled ${entries.length} catalog entries.`);
  } catch (err) {
    logger.warn({ err }, `[catalog] Seed failed (non-fatal): ${(err as Error).message}`);
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

/**
 * Bust the in-memory catalog cache so the next call to getCatalogEntries()
 * re-fetches from the DB. Call this after inserting or updating catalog rows
 * (e.g. after upserting an ncei-portal-* entry from the /ncei/save endpoint).
 */
export function invalidateCatalogCache(): void {
  inMemoryCatalog = null;
  invalidateMiniSearchIndex();
}

// ---------------------------------------------------------------------------
// MiniSearch index for catalog search (Track C)
// ---------------------------------------------------------------------------

/**
 * Full mapping of US state abbreviations (both directions).
 * Used to expand search queries bidirectionally so "NY" finds entries with
 * "New York" in their keywords, and vice versa.
 */
const STATE_ABBREV_TO_FULL: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
  mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire",
  nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee",
  tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
  wv: "west virginia", wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};

const STATE_FULL_TO_ABBREV: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBREV_TO_FULL).map(([abbr, full]) => [full, abbr]),
);

/** Multi-word state names need special handling in query expansion. */
const MULTI_WORD_STATE_NAMES = new Set(Object.values(STATE_ABBREV_TO_FULL).filter((v) => v.includes(" ")));

/**
 * Expand a search query string to include state abbreviation↔full-name
 * aliases. "lake george, ny" becomes "lake george ny new york" so MiniSearch
 * can match entries whose keywords contain either form.
 */
function expandQuery(query: string): string {
  const lower = query.toLowerCase().replace(/[,;]/g, " ").trim();
  const tokens = lower.split(/\s+/).filter(Boolean);
  const expanded = new Set<string>(tokens);

  for (const token of tokens) {
    const full = STATE_ABBREV_TO_FULL[token];
    if (full) {
      full.split(" ").forEach((w) => expanded.add(w));
    }
    const abbr = STATE_FULL_TO_ABBREV[token];
    if (abbr) expanded.add(abbr);
  }

  // Handle two-word combos (e.g. "new york" → also add "ny")
  for (const stateName of MULTI_WORD_STATE_NAMES) {
    if (lower.includes(stateName)) {
      const abbr = STATE_FULL_TO_ABBREV[stateName];
      if (abbr) expanded.add(abbr);
    }
  }

  return [...expanded].join(" ");
}

interface IndexableEntry {
  id: string;
  name: string;
  keywords: string;
  sourceAgency: string;
  description: string;
  dataType: string;
}

let miniSearchIndex: MiniSearch<IndexableEntry> | null = null;
let miniSearchEntryIds: Set<string> | null = null;

/** Build (or rebuild) the MiniSearch index from a catalog entry list. */
function buildMiniSearchIndex(entries: CatalogSeedEntry[]): MiniSearch<IndexableEntry> {
  const ms = new MiniSearch<IndexableEntry>({
    fields: ["name", "keywords", "sourceAgency", "description", "dataType"],
    storeFields: ["id"],
    tokenize: (text: string) =>
      text.split(/[\s,;/&()[\]{}|+\-.!?_]+/).filter((t) => t.length > 0),
    processTerm: (term: string) => term.toLowerCase(),
    searchOptions: {
      boost: { name: 10, keywords: 5, sourceAgency: 2, description: 1, dataType: 1 },
      fuzzy: (term: string) => (term.length > 4 ? 0.2 : false),
      prefix: true,
    },
  });

  ms.addAll(
    entries.map((e) => ({
      id: e.id,
      name: e.name,
      keywords: e.keywords ?? "",
      sourceAgency: e.sourceAgency,
      description: e.description ?? "",
      dataType: e.dataType,
    })),
  );

  return ms;
}

/** Get or build the cached MiniSearch index. Rebuilds when entry set changes. */
function getMiniSearchIndex(entries: CatalogSeedEntry[]): MiniSearch<IndexableEntry> {
  const currentIds = new Set(entries.map((e) => e.id));
  const sameSet =
    miniSearchIndex !== null &&
    miniSearchEntryIds !== null &&
    miniSearchEntryIds.size === currentIds.size &&
    [...currentIds].every((id) => miniSearchEntryIds!.has(id));

  if (!sameSet) {
    miniSearchIndex = buildMiniSearchIndex(entries);
    miniSearchEntryIds = currentIds;
  }
  return miniSearchIndex!;
}

/** Invalidate the MiniSearch index cache (call when catalog entries change). */
export function invalidateMiniSearchIndex(): void {
  miniSearchIndex = null;
  miniSearchEntryIds = null;
}

/**
 * Legacy compatibility shim. The old scoreEntry function is preserved so
 * existing callers compile; it now delegates to a simple substring check.
 * New callers should use searchCatalog which uses the full MiniSearch pipeline.
 */
export function scoreEntry(entry: CatalogSeedEntry, terms: string[]): number {
  if (terms.length === 0) return 1;
  const haystack = [entry.name, entry.description ?? "", entry.keywords ?? "", entry.sourceAgency, entry.dataType]
    .join(" ")
    .toLowerCase();
  const hits = terms.filter((t) => haystack.includes(t.toLowerCase())).length;
  return hits / terms.length;
}

export interface CatalogSearchParams {
  q?: string;
  dataType?: CatalogSearchQuery["dataType"];
  waterType?: CatalogSearchQuery["waterType"];
  minLon?: number;
  minLat?: number;
  maxLon?: number;
  maxLat?: number;
}

export interface CatalogSearchResult extends CatalogSeedEntry {
  relevanceScore: number;
  createdAt: string;
}

/**
 * Search the catalog using MiniSearch.
 *
 * Pipeline:
 *  1. Pre-filter: waterType, dataType, bbox intersection (unchanged from before)
 *  2. MiniSearch query with AND combineWith (all tokens must match); falls back
 *     to OR if AND returns zero results so a partial match still surfaces.
 *  3. Post-process: exact/prefix name match is boosted to position 1.
 *
 * Improvements over the old scorer:
 *  - Tokenises on whitespace AND punctuation — "ny" no longer matches "canyon"
 *  - Field-weighted BM25 (name ×10, keywords ×5) — lake name beats description noise
 *  - Fuzzy 0.2 on terms >4 chars — mild typos ("champlian") still find the entry
 *  - prefix:true — "champl" finds "Champlain"
 *  - State abbreviation bidirectional expansion (NY ↔ New York)
 *  - AND-first / OR-fallback — "lake george ny" requires all three to match
 */
export async function searchCatalog(
  params: CatalogSearchParams,
  _entries?: CatalogSeedEntry[],
): Promise<CatalogSearchResult[]> {
  const entries = _entries ?? await getCatalogEntries();
  const rawQuery = (params.q ?? "").trim();
  const now = new Date().toISOString();

  // Step 1 — pre-filter by waterType, dataType, bbox
  const prefiltered = entries.filter((e) => {
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
  });

  // No query — return all pre-filtered entries with score 1
  if (!rawQuery) {
    return prefiltered.map((e) => ({ ...e, createdAt: now, relevanceScore: 1 }));
  }

  // Step 2 — MiniSearch with state abbreviation expansion
  const expandedQuery = expandQuery(rawQuery);
  const ms = getMiniSearchIndex(prefiltered);

  let msResults = ms.search(expandedQuery, { combineWith: "AND" });
  if (msResults.length === 0) {
    msResults = ms.search(expandedQuery, { combineWith: "OR" });
  }

  if (msResults.length === 0) {
    return [];
  }

  const entryById = new Map(prefiltered.map((e) => [e.id, e]));

  // Normalise scores to 0–1 relative to the highest-scoring result
  const maxScore = msResults[0]?.score ?? 1;
  const scored: CatalogSearchResult[] = msResults
    .filter((r) => entryById.has(r.id))
    .map((r) => ({
      ...entryById.get(r.id)!,
      createdAt: now,
      relevanceScore: maxScore > 0 ? r.score / maxScore : 1,
    }));

  // Step 3 — exact / prefix name bonus: if any entry name starts with the
  // trimmed query string (case-insensitive), pull it to position 1.
  const qLower = rawQuery.toLowerCase().replace(/[,;]+$/, "").trim();
  const exactIdx = scored.findIndex(
    (r) => r.name.toLowerCase().startsWith(qLower) || r.name.toLowerCase() === qLower,
  );
  if (exactIdx > 0) {
    const [exact] = scored.splice(exactIdx, 1);
    scored.unshift(exact!);
  }

  return scored;
}
