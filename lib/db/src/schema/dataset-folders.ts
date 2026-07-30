import { pgTable, text, timestamp, uuid, index, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
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
  (t) => [
    index("dataset_folders_user_id_idx").on(t.userId),
    // Root-level folders (parent_id IS NULL): unique by (user_id, lower(name))
    // using a partial index so NULL is not treated as distinct from itself.
    uniqueIndex("dataset_folders_root_name_uniq")
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`${t.parentId} IS NULL`),
    // Non-root folders: unique by (user_id, parent_id, lower(name)).
    uniqueIndex("dataset_folders_child_name_uniq")
      .on(t.userId, t.parentId, sql`lower(${t.name})`)
      .where(sql`${t.parentId} IS NOT NULL`),
  ],
);

export type DatasetFolder = typeof datasetFoldersTable.$inferSelect;
