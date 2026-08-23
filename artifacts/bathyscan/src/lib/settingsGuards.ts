/**
 * Runtime guards for union-typed settings fields.
 *
 * Extracted into their own module so they can be imported and tested
 * independently from settingsStore.ts (which carries heavy Zustand / persist
 * middleware at module-init time).
 *
 * Each guard returns the value unchanged when it is already a valid member of
 * the target union, and falls back to the documented default otherwise.  They
 * accept `unknown` so callers can pass raw localStorage / server payloads
 * without a prior type-cast.
 */

import type { ColormapTheme, JoystickMode, WaterType } from "@/lib/settingsStore";
import { FLY_DEFAULT_SPEED_TIER, FLY_SPEEDS_MPH } from "@/lib/boatSpeed";

const VALID_JOYSTICK_MODES: readonly string[] = ["auto", "always", "off"];
const VALID_COLORMAP_THEMES: readonly string[] = [
  "ocean",
  "thermal",
  "grayscale",
  "viridis",
  "freshwater",
  "pastel",
  "custom",
];
const VALID_WATER_TYPES: readonly string[] = ["saltwater", "freshwater"];

/**
 * Returns `value` when it is a recognised JoystickMode, otherwise `"auto"`.
 */
export function toValidJoystickMode(value: unknown): JoystickMode {
  if (typeof value === "string" && VALID_JOYSTICK_MODES.includes(value)) {
    return value as JoystickMode;
  }
  return "auto";
}

/**
 * Returns `value` when it is a recognised ColormapTheme, otherwise `"ocean"`.
 */
export function toValidColormapTheme(value: unknown): ColormapTheme {
  if (typeof value === "string" && VALID_COLORMAP_THEMES.includes(value)) {
    return value as ColormapTheme;
  }
  return "ocean";
}

/**
 * Returns `value` when it is a recognised WaterType, otherwise `"saltwater"`.
 */
export function toValidWaterType(value: unknown): WaterType {
  if (typeof value === "string" && VALID_WATER_TYPES.includes(value)) {
    return value as WaterType;
  }
  return "saltwater";
}

/**
 * Returns `value` when it is an integer in the supported free-fly tier range,
 * otherwise the shared factory default.
 */
export function toValidDefaultSpeedTier(value: unknown): number {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < FLY_SPEEDS_MPH.length
  ) {
    return value;
  }
  return FLY_DEFAULT_SPEED_TIER;
}
