import { pgTable, text, real, jsonb, timestamp } from "drizzle-orm/pg-core";

export const datasetCatalogTable = pgTable("dataset_catalog", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceAgency: text("source_agency").notNull(),
  dataType: text("data_type").notNull(),
  resolutionMMin: real("resolution_m_min"),
  resolutionMMax: real("resolution_m_max"),
  coverageBbox: jsonb("coverage_bbox").notNull(),
  endpointUrl: text("endpoint_url"),
  accessNotes: text("access_notes"),
  description: text("description"),
  keywords: text("keywords"),
  lastUpdated: text("last_updated"),
  waterType: text("water_type").notNull().default("saltwater"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DatasetCatalogEntry = typeof datasetCatalogTable.$inferSelect;
