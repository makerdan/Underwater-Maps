import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const userCatalogSavesTable = pgTable("user_catalog_saves", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  catalogId: text("catalog_id").notNull(),
  status: text("status").notNull().default("queued"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  readyAt: timestamp("ready_at"),
  cacheKey: text("cache_key"),
  errorMessage: text("error_message"),
});

export type UserCatalogSave = typeof userCatalogSavesTable.$inferSelect;
