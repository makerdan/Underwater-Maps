/**
 * zoneMap.ts — zone definitions, label parsing, and upsampling.
 *
 * The AI returns 1024 zone labels (32×32 coarse grid).
 * These are parsed into a Uint8Array and upsampled to the terrain's NxN resolution
 * via nearest-neighbour interpolation.
 *
 * Each zone label maps to one of the four terrain texture slots:
 *   0 = sand      (sandy / reef / vegetation)
 *   1 = sediment  (coarse sediment / seamount / gravel / wood)
 *   2 = silt      (silt / clay)
 *   3 = basalt    (basalt / volcanic / rock / trench wall)
 */

// ---------------------------------------------------------------------------
// Zone label sets (must match the server's zone arrays in poe.ts)
// ---------------------------------------------------------------------------

export const SALTWATER_ZONES = [
  "sandy_shelf",           // 0
  "coarse_sediment",       // 1
  "silt_plain",            // 2
  "basalt_rock",           // 3
  "volcanic_vent_field",   // 4
  "trench_wall",           // 5
  "seamount_flank",        // 6
  "coral_reef_potential",  // 7
] as const;

export const FRESHWATER_ZONES = [
  "aquatic_vegetation",    // 0
  "sandy_lake_bed",        // 1
  "rocky_shoreline",       // 2
  "silt_deep",             // 3
  "gravel_bed",            // 4
  "bedrock_shelf",         // 5
  "submerged_wood",        // 6
  "clay_flat",             // 7
] as const;

export type SaltwaterZone  = typeof SALTWATER_ZONES[number];
export type FreshwaterZone = typeof FRESHWATER_ZONES[number];
export type ZoneLabel      = SaltwaterZone | FreshwaterZone;

// ---------------------------------------------------------------------------
// Human-readable names (by texture slot)
// ---------------------------------------------------------------------------

export const SLOT_NAMES_SALTWATER = [
  "Sandy Shelf / Reef",
  "Coarse Sediment / Seamount",
  "Silt Plain",
  "Basalt / Volcanic",
] as const;

export const SLOT_NAMES_FRESHWATER = [
  "Vegetation / Sandy Bed",
  "Gravel / Submerged Wood",
  "Silt / Clay",
  "Rock / Bedrock",
] as const;

// ---------------------------------------------------------------------------
// Zone index → texture slot mapping
// ---------------------------------------------------------------------------

/** Saltwater zone index (0–7) → texture slot (0–3) */
export const SALTWATER_ZONE_TO_SLOT: readonly number[] = [
  0, // sandy_shelf → sand
  1, // coarse_sediment → sediment
  2, // silt_plain → silt
  3, // basalt_rock → basalt
  3, // volcanic_vent_field → basalt
  3, // trench_wall → basalt
  1, // seamount_flank → sediment
  0, // coral_reef_potential → sand
];

/** Freshwater zone index (0–7) → texture slot (0–3) */
export const FRESHWATER_ZONE_TO_SLOT: readonly number[] = [
  0, // aquatic_vegetation → sand
  0, // sandy_lake_bed → sand
  3, // rocky_shoreline → basalt
  2, // silt_deep → silt
  1, // gravel_bed → sediment
  3, // bedrock_shelf → basalt
  1, // submerged_wood → sediment
  2, // clay_flat → silt
];

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const SALTWATER_LABEL_TO_INDEX = new Map<string, number>(
  SALTWATER_ZONES.map((z, i) => [z, i]),
);
const FRESHWATER_LABEL_TO_INDEX = new Map<string, number>(
  FRESHWATER_ZONES.map((z, i) => [z, i]),
);

/**
 * Parse an array of 1024 zone label strings (32×32 coarse grid) into a Uint8Array
 * of zone indices, then upsample to `targetN × targetN` via bilinear interpolation.
 *
 * Bilinear interpolation is used so zone boundaries blend smoothly rather than
 * showing hard nearest-neighbour block edges. Because zone indices are discrete
 * categorical values, the weighted sum is rounded to the nearest integer — this
 * keeps boundary pixels snapped to a real zone label while still producing
 * smoother transitions than nearest-neighbour.
 *
 * @param labels    — 1024 zone label strings from the AI response
 * @param waterType — "saltwater" | "freshwater"
 * @param targetN   — output grid resolution (e.g. 256 for a 256×256 terrain)
 */
export function parseAndUpsampleZones(
  labels: string[],
  waterType: "saltwater" | "freshwater",
  targetN: number,
): Uint8Array {
  const COARSE = 32;
  const labelToIndex = waterType === "freshwater"
    ? FRESHWATER_LABEL_TO_INDEX
    : SALTWATER_LABEL_TO_INDEX;

  // Build the 32×32 coarse index map
  const coarse = new Uint8Array(COARSE * COARSE);
  for (let i = 0; i < Math.min(labels.length, COARSE * COARSE); i++) {
    coarse[i] = labelToIndex.get(labels[i] ?? "") ?? 0;
  }

  // Upsample to targetN × targetN via bilinear interpolation
  const out = new Uint8Array(targetN * targetN);
  const norm = targetN > 1 ? (COARSE - 1) / (targetN - 1) : 0;

  for (let row = 0; row < targetN; row++) {
    for (let col = 0; col < targetN; col++) {
      const srcRow = row * norm;
      const srcCol = col * norm;

      const r0 = Math.floor(srcRow);
      const r1 = Math.min(r0 + 1, COARSE - 1);
      const c0 = Math.floor(srcCol);
      const c1 = Math.min(c0 + 1, COARSE - 1);

      const dr = srcRow - r0;
      const dc = srcCol - c0;

      const v00 = coarse[r0 * COARSE + c0] ?? 0;
      const v01 = coarse[r0 * COARSE + c1] ?? 0;
      const v10 = coarse[r1 * COARSE + c0] ?? 0;
      const v11 = coarse[r1 * COARSE + c1] ?? 0;

      const value =
        v00 * (1 - dr) * (1 - dc) +
        v01 * (1 - dr) * dc +
        v10 * dr * (1 - dc) +
        v11 * dr * dc;

      out[row * targetN + col] = Math.round(value);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// SessionStorage helpers
// ---------------------------------------------------------------------------

export function zoneMapToStorage(zoneMap: Uint8Array): string {
  let str = "";
  for (let i = 0; i < zoneMap.length; i++) {
    str += String.fromCharCode(zoneMap[i] ?? 0);
  }
  return btoa(str);
}

export function zoneMapFromStorage(stored: string): Uint8Array {
  const decoded = atob(stored);
  const arr = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    arr[i] = decoded.charCodeAt(i);
  }
  return arr;
}
