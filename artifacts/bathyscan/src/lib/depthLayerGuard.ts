/**
 * Runtime guard for the DepthLayer union type.
 *
 * Extracted into its own module so it can be imported and tested independently
 * from App.tsx (which requires a full React + Three.js environment to load).
 */

import type { DepthLayer } from "@/components/TidalCurrentArrows";

const VALID_DEPTH_LAYERS: readonly string[] = ["surface", "mid", "near-bottom"];

/**
 * Returns `value` when it is a recognised DepthLayer, otherwise `"surface"`.
 *
 * Used during `useState` initialisation in App.tsx to prevent a bad stored
 * value (e.g. from a future schema migration or corrupted storage) from
 * silently propagating as an unrecognised layer key.
 */
export function toValidDepthLayer(value: unknown): DepthLayer {
  if (typeof value === "string" && VALID_DEPTH_LAYERS.includes(value)) {
    return value as DepthLayer;
  }
  return "surface";
}
