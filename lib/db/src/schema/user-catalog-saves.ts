import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { datasetFoldersTable } from "./dataset-folders.js";

export const userCatalogSavesTable = pgTable("user_catalog_saves", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  catalogId: text("catalog_id").notNull(),
  status: text("status").notNull().default("queued"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  readyAt: timestamp("ready_at"),
  cacheKey: text("cache_key"),
  errorMessage: text("error_message"),
  folderId: uuid("folder_id").references(() => datasetFoldersTable.id, { onDelete: "set null" }),
});

export type UserCatalogSave = typeof userCatalogSavesTable.$inferSelect;
