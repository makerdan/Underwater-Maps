import { pgTable, text, real, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { datasetFoldersTable } from "./dataset-folders.js";

/**
 * Shape of the terrain/overview JSON blobs stored in custom_datasets.
 * Mirrors the TerrainData schema in openapi.yaml — only the fields that are
 * always present (required) are non-optional here; supplementary provenance
 * and topography fields remain optional to allow forward compatibility.
 */
export interface StoredTerrainJson {
  datasetId: string;
  name: string;
  waterType: "saltwater" | "freshwater";
  resolution: number;
  width: number;
  height: number;
  depths: number[];
  minDepth: number;
  maxDepth: number;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  centerLon: number;
  centerLat: number;
  topography?: number[];
  hasTopography?: boolean;
  synthetic?: boolean;
  dataSource?: "ncei" | "gebco" | "synthetic" | "twdb" | "usace" | "usgs-3dep";
  bathymetrySource?: "ncei" | "gebco" | "synthetic" | "twdb" | "usace" | "usgs-3dep";
  topographySource?: "ncei" | "gebco" | "synthetic" | "twdb" | "usace" | "usgs-3dep";
  bathymetrySourceLabel?: string;
  topographySourceLabel?: string;
  bathymetryCreditUrl?: string;
  topographyCreditUrl?: string;
  habitatPolygons?: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      properties: Record<string, unknown>;
      geometry: Record<string, unknown>;
    }>;
    metadata?: Record<string, unknown>;
  };
}

/** A single HYD93 cartographic annotation point stored alongside a dataset. */
export interface StoredHyd93Feature {
  lon: number;
  lat: number;
  featureCode: number;
}

/**
 * A single NOAA historical bottom-sample point extracted from a
 * `Bottom_Samples/*_BSText.txt` file inside a NOAA tar.gz archive.
 */
export interface StoredNoaaSubstrateSample {
  lat: number;
  lon: number;
  /** Normalised substrate category (mud / rock / sand / gravel / kelp / <raw>) */
  substrateType: string;
  /** Unmodified COLOUR+NAT string from the source file */
  rawLabel: string;
}

export const customDatasetsTable = pgTable("custom_datasets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  minDepth: real("min_depth").notNull(),
  maxDepth: real("max_depth").notNull(),
  terrainJson: jsonb("terrain_json").notNull().$type<StoredTerrainJson>(),
  overviewJson: jsonb("overview_json").notNull().$type<StoredTerrainJson>(),
  folderId: uuid("folder_id").references(() => datasetFoldersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /**
   * HYD93 cartographic annotation points extracted from .a93.gz files during
   * upload (feature codes 89=rocks, 103=kelp, 146=ledges, 530=rocky reefs,
   * 988=obstructions). Null when the dataset was not sourced from a HYD93 archive
   * or the archive contained no annotation rows.
   */
  hyd93FeaturesJson: jsonb("hyd93_features_json").$type<StoredHyd93Feature[]>(),
  /**
   * NOAA historical bottom-sample points extracted from
   * `Bottom_Samples/*_BSText.txt` files inside a NOAA tar.gz archive.
   * Each entry carries a geolocated substrate observation with a normalised
   * category label.  Null when the archive contained no BSText file.
   */
  noaaSubstrateSamplesJson: jsonb("noaa_substrate_samples_json").$type<StoredNoaaSubstrateSample[]>(),
}, (table) => [
  index("custom_datasets_user_id_idx").on(table.userId),
]);

export type CustomDataset = typeof customDatasetsTable.$inferSelect;
