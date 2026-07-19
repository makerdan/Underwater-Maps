import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { datasetFoldersTable } from "./dataset-folders.js";
import { customDatasetsTable } from "./custom-datasets.js";

export const userCatalogSavesTable = pgTable("user_catalog_saves", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  catalogId: text("catalog_id").notNull(),
  status: text("status").notNull().default("queued"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  readyAt: timestamp("ready_at"),
  cacheKey: text("cache_key"),
  errorMessage: text("error_message"),
  // User-defined display label for this save. Overrides the catalog's own
  // `name` in the My Saves list. Null means "use the catalog name".
  displayLabel: text("display_label"),
  folderId: uuid("folder_id").references(() => datasetFoldersTable.id, { onDelete: "set null" }),
  // When the save is materialized into the user's per-account dataset store,
  // this links back to the resulting custom_datasets row. Lets the client load
  // saved catalog datasets through the unified /user/datasets/:id/{terrain,overview}
  // read path instead of re-fetching from the preset/pipeline endpoints.
  datasetId: uuid("dataset_id").references(() => customDatasetsTable.id, {
    onDelete: "set null",
  }),
}, (table) => [
  index("user_catalog_saves_user_id_idx").on(table.userId),
]);

export type UserCatalogSave = typeof userCatalogSavesTable.$inferSelect;
