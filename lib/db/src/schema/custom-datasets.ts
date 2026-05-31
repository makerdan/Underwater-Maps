import { pgTable, text, real, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { datasetFoldersTable } from "./dataset-folders.js";

export const customDatasetsTable = pgTable("custom_datasets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  minDepth: real("min_depth").notNull(),
  maxDepth: real("max_depth").notNull(),
  terrainJson: jsonb("terrain_json").notNull(),
  overviewJson: jsonb("overview_json").notNull(),
  folderId: uuid("folder_id").references(() => datasetFoldersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("custom_datasets_user_id_idx").on(table.userId),
]);

export type CustomDataset = typeof customDatasetsTable.$inferSelect;
