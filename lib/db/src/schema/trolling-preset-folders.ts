import { pgTable, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const trollingPresetFoldersTable = pgTable(
  "trolling_preset_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    sortOrder: text("sort_order").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx: index("trolling_preset_folders_user_id_idx").on(t.userId),
    uniqUserName: uniqueIndex("trolling_preset_folders_unique_user_name")
      .on(t.userId, sql`lower(${t.name})`),
  }),
);

export type TrollingPresetFolder = typeof trollingPresetFoldersTable.$inferSelect;
