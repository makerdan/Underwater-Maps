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
  // Groups saves that originated from one area search (bbox / point-radius /
  // federated "find data" request). Client-generated id shared by every save
  // from the same search; when >2 saves carry the same id, the server
  // auto-creates a folder for the request and routes all of its saves into it.
  areaRequestId: text("area_request_id"),
  // When the save is materialized into the user's per-account dataset store,
  // this links back to the resulting custom_datasets row. Lets the client load
  // saved catalog datasets through the unified /user/datasets/:id/{terrain,overview}
  // read path instead of re-fetching from the preset/pipeline endpoints.
  datasetId: uuid("dataset_id").references(() => customDatasetsTable.id, {
    onDelete: "set null",
  }),
  // Optional bbox the user supplied at save-time (serialized JSON string:
  // { minLon, minLat, maxLon, maxLat }). For NCEI WCS entries this narrows
  // the WCS request to the user's actively loaded terrain area so the
  // materializer fetches a small, survey-covered tile instead of the full
  // multi-degree coverage bbox (which always times out or returns a flat grid).
  requestBboxJson: text("request_bbox_json"),
}, (table) => [
  index("user_catalog_saves_user_id_idx").on(table.userId),
  index("user_catalog_saves_area_request_idx").on(table.userId, table.areaRequestId),
  // Non-unique: allows multiple saves per (user, catalog) — each keyed to a
  // different requestBbox (area tile). Replaced the old uniqueIndex so users
  // can save the same NCEI entry for multiple terrain areas.
  index("user_catalog_saves_user_catalog_idx").on(table.userId, table.catalogId),
]);

export type UserCatalogSave = typeof userCatalogSavesTable.$inferSelect;
