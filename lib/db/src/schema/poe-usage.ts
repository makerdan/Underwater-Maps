import { pgTable, text, integer, timestamp, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const poeUsageLogTable = pgTable("poe_usage_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: text("user_id").notNull(),
  model: text("model").notNull(),
  endpoint: text("endpoint").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedPoints: integer("estimated_points").notNull().default(0),
  provider: text("provider"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPoeUsageLogSchema = createInsertSchema(poeUsageLogTable).omit({ createdAt: true });
export type InsertPoeUsageLog = z.infer<typeof insertPoeUsageLogSchema>;
export type PoeUsageLog = typeof poeUsageLogTable.$inferSelect;
