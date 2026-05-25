import { pgTable, text, timestamp, uuid, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const datasetFoldersTable = pgTable(
  "dataset_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => datasetFoldersTable.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqSiblingName: uniqueIndex("dataset_folders_unique_sibling_name")
      .on(t.userId, t.parentId, sql`lower(${t.name})`),
  }),
);

export type DatasetFolder = typeof datasetFoldersTable.$inferSelect;
