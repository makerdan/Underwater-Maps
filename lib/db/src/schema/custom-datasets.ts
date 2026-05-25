import { pgTable, text, real, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";

export const customDatasetsTable = pgTable("custom_datasets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  minDepth: real("min_depth").notNull(),
  maxDepth: real("max_depth").notNull(),
  terrainJson: jsonb("terrain_json").notNull(),
  overviewJson: jsonb("overview_json").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CustomDataset = typeof customDatasetsTable.$inferSelect;
