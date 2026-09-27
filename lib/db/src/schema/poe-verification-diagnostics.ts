import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const poeVerificationDiagnosticsTable = pgTable(
  "poe_verification_diagnostics",
  {
    route: text("route").notNull(),
    code: text("code").notNull(),
    count: integer("count").notNull(),
    lastOccurredAt: timestamp("last_occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "poe_verification_diagnostics_pk",
      columns: [table.route, table.code],
    }),
    check(
      "poe_verification_diagnostics_route_check",
      sql`${table.route} IN ('classify', 'help', 'models', 'query', 'unknown', 'upscale')`,
    ),
    check(
      "poe_verification_diagnostics_code_check",
      sql`${table.code} IN ('model_registry_unavailable', 'model_unavailable')`,
    ),
    check(
      "poe_verification_diagnostics_count_check",
      sql`${table.count} > 0`,
    ),
  ],
);

export type PoeVerificationDiagnosticRow =
  typeof poeVerificationDiagnosticsTable.$inferSelect;