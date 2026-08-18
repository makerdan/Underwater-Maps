import { pgTable, text, timestamp, uuid, index, uniqueIndex, check, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customDatasetsTable } from "./custom-datasets.js";
import { userCatalogSavesTable } from "./user-catalog-saves.js";

/** Collection kinds — 'special' collections carry puzzle-layout metadata. */
export const COLLECTION_KINDS = ["standard", "special"] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

/**
 * A geo-registration control point mapping an image pixel to a geographic
 * coordinate. Two anchors fully register a background image to the map.
 */
export interface CollectionGeoAnchor {
  lon: number;
  lat: number;
  imgX: number;
  imgY: number;
}

/** One puzzle tile transform inside a saved layout revision. */
export interface LayoutTile {
  datasetId: string;
  tx: number;
  ty: number;
  angleDeg: number;
  locked: boolean;
  annotation?: string | null;
}

/** A named group of tiles inside a layout revision. */
export interface LayoutGroup {
  id: string;
  name: string;
  datasetIds: string[];
}

/** A named, timestamped snapshot of the puzzle layout. */
export interface LayoutRevision {
  id: string;
  name: string;
  savedAt: string; // ISO timestamp
  tiles: LayoutTile[];
  groups: LayoutGroup[];
}

/**
 * SpecialCollectionMeta — JSONB payload stored on special collections.
 * Imported by both the API route and (indirectly, via the OpenAPI-generated
 * client types) the frontend.
 */
export interface SpecialCollectionMeta {
  /** Server storage key for the reference background image (null = none). */
  bgImageKey: string | null;
  /** Background image opacity, 0–1. Default 0.5. */
  bgOpacity: number;
  /** Exactly two control points once registered; null until then. */
  bgGeoAnchors: [CollectionGeoAnchor, CollectionGeoAnchor] | null;
  /** Named layout revision history (max 20, oldest dropped). */
  layoutRevisions: LayoutRevision[];
  /** Which revision is currently active (null = none). */
  activeRevisionId: string | null;
}

/** Fresh meta object for a newly created special collection. */
export function emptySpecialCollectionMeta(): SpecialCollectionMeta {
  return {
    bgImageKey: null,
    bgOpacity: 0.5,
    bgGeoAnchors: null,
    layoutRevisions: [],
    activeRevisionId: null,
  };
}

/**
 * dataset_collections — user-defined, named groups of library datasets.
 *
 * Collections span folders: a dataset can belong to any number of
 * collections, and membership is independent of folder location. Names are
 * unique per user, case-insensitively (same convention as dataset_folders).
 *
 * `collection_kind` distinguishes plain groups ('standard') from special
 * collections ('special') that carry puzzle-layout metadata in
 * `special_collection_meta` (NULL for standard rows).
 */
export const datasetCollectionsTable = pgTable(
  "dataset_collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    collectionKind: text("collection_kind").notNull().default("standard"),
    specialMeta: jsonb("special_collection_meta").$type<SpecialCollectionMeta>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("dataset_collections_user_id_idx").on(t.userId),
    uniqueIndex("dataset_collections_user_name_uniq").on(t.userId, sql`lower(${t.name})`),
    check(
      "dataset_collections_kind_check",
      sql`${t.collectionKind} IN ('standard', 'special')`,
    ),
  ],
);

export type DatasetCollectionRow = typeof datasetCollectionsTable.$inferSelect;

/**
 * dataset_collection_members — membership rows linking a collection to
 * either an uploaded dataset (custom_datasets) or a saved catalog entry
 * (user_catalog_saves) — exactly one of the two references is set (CHECK
 * constraint). Cascade rules:
 *   - collection deleted  → members deleted (never the datasets)
 *   - dataset deleted     → its membership rows deleted
 *   - catalog save deleted → its membership rows deleted
 */
export const datasetCollectionMembersTable = pgTable(
  "dataset_collection_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => datasetCollectionsTable.id, { onDelete: "cascade" }),
    datasetId: uuid("dataset_id").references(() => customDatasetsTable.id, {
      onDelete: "cascade",
    }),
    catalogSaveId: uuid("catalog_save_id").references(() => userCatalogSavesTable.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("dataset_collection_members_collection_idx").on(t.collectionId),
    index("dataset_collection_members_dataset_idx").on(t.datasetId),
    index("dataset_collection_members_save_idx").on(t.catalogSaveId),
    // A given dataset / catalog save appears at most once per collection.
    // Partial indexes because the other reference column is NULL.
    uniqueIndex("dataset_collection_members_dataset_uniq")
      .on(t.collectionId, t.datasetId)
      .where(sql`${t.datasetId} IS NOT NULL`),
    uniqueIndex("dataset_collection_members_save_uniq")
      .on(t.collectionId, t.catalogSaveId)
      .where(sql`${t.catalogSaveId} IS NOT NULL`),
    // Exactly one of dataset_id / catalog_save_id must be set.
    check(
      "dataset_collection_members_exactly_one_ref",
      sql`(${t.datasetId} IS NOT NULL) <> (${t.catalogSaveId} IS NOT NULL)`,
    ),
  ],
);

export type DatasetCollectionMemberRow = typeof datasetCollectionMembersTable.$inferSelect;
