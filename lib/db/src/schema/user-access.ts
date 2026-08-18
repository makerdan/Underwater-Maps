import { pgTable, pgEnum, text, timestamp } from "drizzle-orm/pg-core";

/**
 * user_access — per-Clerk-user approval status gating access to all
 * authenticated API endpoints.
 *
 * Lifecycle:
 *   - A `pending` row is auto-upserted the first time a Clerk user hits any
 *     protected route (requireApproved middleware, ON CONFLICT DO NOTHING).
 *   - An admin approves / bans / restores the user via /api/admin/users.
 *   - Hard-deleting the row returns the user to `pending` on next login.
 *
 * Admin users (isAdmin()) bypass this table entirely and never need a row.
 */
export const userAccessStatusEnum = pgEnum("user_access_status", [
  "pending",
  "approved",
  "banned",
]);

export const userAccessTable = pgTable("user_access", {
  /** Clerk user ID (e.g. "user_2abc…") — natural primary key. */
  clerkUserId: text("clerk_user_id").primaryKey(),
  status: userAccessStatusEnum("status").notNull().default("pending"),
  /** Optional profile fields for the admin UI; nullable because the
   *  auto-upsert at first login has no profile data available. */
  email: text("email"),
  displayName: text("display_name"),
  /** Free-form admin note (e.g. ban reason). */
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserAccessRow = typeof userAccessTable.$inferSelect;
export type InsertUserAccessRow = typeof userAccessTable.$inferInsert;
export type UserAccessStatus = UserAccessRow["status"];
