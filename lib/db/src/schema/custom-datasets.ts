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
}, (table) => [
  index("custom_datasets_user_id_idx").on(table.userId),
]);

export type CustomDataset = typeof customDatasetsTable.$inferSelect;
