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

import { db, datasetCatalogTable, disabledPresetsTable } from "@workspace/db";
import { inArray, notInArray, sql } from "drizzle-orm";
import type { CatalogSearchQuery } from "../routes/schemas.js";
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
      "Available in BathyScan as the 'Kodiak Island — Gulf of Alaska' preset. " +
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
      "Available in BathyScan as the 'Kachemak Bay — Homer / Cook Inlet' preset. " +
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
      "Available in BathyScan as the 'Resurrection Bay — Seward / Kenai Fjords' preset. " +
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
      "Available in BathyScan as the 'Prince William Sound — Valdez / Western Approaches' preset. " +
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

/**
 * Bust the in-memory catalog cache so the next call to getCatalogEntries()
 * re-fetches from the DB. Call this after inserting or updating catalog rows
 * (e.g. after upserting an ncei-portal-* entry from the /ncei/save endpoint).
 */
export function invalidateCatalogCache(): void {
  inMemoryCatalog = null;
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
