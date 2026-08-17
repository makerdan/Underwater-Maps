/**
 * backfill-water-type-helpers.ts
 *
 * Pure resolution helpers extracted from backfill-water-type-and-datasource.ts
 * so the water-type resolution logic can be unit-tested without a database
 * connection (same pattern as audit-marker-dataset-bbox-helpers.ts).
 */

export type WaterType = "saltwater" | "freshwater";

export const VALID_WATER_TYPES = new Set(["saltwater", "freshwater"]);

/**
 * Mirror of the api-server in-code preset registry's water types
 * (`ALL_PRESET_DATASETS` in artifacts/api-server/src/lib/terrain.ts), keyed
 * by preset dataset id — i.e. the catalog id minus its "preset-" prefix.
 *
 * @workspace/db cannot import api-server code (api-server already depends on
 * this package, so that would be a circular workspace dependency), hence the
 * values are mirrored here. The guard test
 * artifacts/api-server/src/lib/__tests__/backfill-preset-registry-sync.test.ts
 * compares this map against the live registry and fails the moment they
 * drift — update both in the same commit.
 */
export const PRESET_REGISTRY_WATER_TYPES: Readonly<Record<string, WaterType>> = {
  "lake-ray-roberts": "freshwater",
};

/**
 * Water type from the mirrored preset registry. Preset catalog ids have the
 * form `preset-<datasetId>` (see api-server catalogSeeder); strip the prefix
 * and look the id up. Returns null for non-preset ids.
 */
export function presetRegistryWaterType(catalogId: string): WaterType | null {
  const presetId = catalogId.startsWith("preset-")
    ? catalogId.slice("preset-".length)
    : catalogId;
  return PRESET_REGISTRY_WATER_TYPES[presetId] ?? null;
}

/**
 * Resolve the water type to write into a legacy row's stored JSON:
 *
 *   1. The linked catalog entry's water type wins when the row is linked via
 *      user_catalog_saves and the dataset_catalog row carries a valid value.
 *   2. Otherwise (catalog row purged/pre-seed/invalid), preset-backed ids
 *      fall back to the mirrored preset registry — Lake Ray Roberts is
 *      always freshwater.
 *   3. Genuinely unlinked legacy rows (pre-freshwater uploads) default to
 *      "saltwater" — every upload that predates the freshwater feature is a
 *      saltwater/ocean dataset.
 */
export function resolveLegacyWaterType(
  catalogId: string | null | undefined,
  catalogWaterTypeById: ReadonlyMap<string, string>,
): WaterType {
  if (!catalogId) return "saltwater";
  const fromCatalog = catalogWaterTypeById.get(catalogId);
  if (fromCatalog === "saltwater" || fromCatalog === "freshwater") return fromCatalog;
  return presetRegistryWaterType(catalogId) ?? "saltwater";
}

/** True when a stored blob still needs the backfill (missing/invalid waterType or removed "synthetic" dataSource). */
export function needsBackfill(blob: unknown): boolean {
  const obj = (blob ?? {}) as Record<string, unknown>;
  if (!VALID_WATER_TYPES.has(obj["waterType"] as string)) return true;
  if (obj["dataSource"] === "synthetic") return true;
  return false;
}

/**
 * Patch a stored blob: inject `waterType` (only when missing/invalid — an
 * existing valid value is never overwritten) and strip the removed
 * `dataSource: "synthetic"` enum value.
 */
export function patchBlob(blob: unknown, waterType: WaterType): Record<string, unknown> {
  const obj = (blob ?? {}) as Record<string, unknown>;
  const patched: Record<string, unknown> = { ...obj };

  if (!VALID_WATER_TYPES.has(patched["waterType"] as string)) {
    patched["waterType"] = waterType;
  }

  if (patched["dataSource"] === "synthetic") {
    delete patched["dataSource"];
  }

  return patched;
}
