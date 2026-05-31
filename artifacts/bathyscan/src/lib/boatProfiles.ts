/**
 * boatProfiles.ts — Vessel profiles for the Drift Planner physics model.
 *
 * Each profile supplies two coefficients that replace the previous hardcoded
 * 3% leeway value in computeDrift:
 *
 *   leewayFactor  — fraction of wind speed that becomes a drift vector
 *                   (e.g. 0.03 = 3%).  Varies by hull type/freeboard.
 *   windageFactor — scalar applied to the leeway vector AFTER scaling by
 *                   wind speed.  Reflects how much above-water surface area
 *                   catches the wind (slab-sided cabin cruiser vs flat kayak).
 *
 * The combined leeway contribution fed into computeDrift is:
 *   leewaySpeedKnots = windSpeedKnots × leewayFactor × windageFactor
 */

export interface BoatProfile {
  id: string;
  label: string;
  /** Wind leeway as a fraction of wind speed (e.g. 0.035 = 3.5 %). */
  leewayFactor: number;
  /**
   * Windage multiplier: scales up/down the leeway vector to account for
   * above-water profile.  1.0 is the baseline open-skiff reference.
   */
  windageFactor: number;
}

export const BOAT_PROFILES: readonly BoatProfile[] = [
  {
    id: "open-skiff",
    label: "Open Skiff",
    leewayFactor: 0.035,
    windageFactor: 1.0,
  },
  {
    id: "cabin-cruiser",
    label: "Cabin Cruiser",
    leewayFactor: 0.028,
    windageFactor: 1.45,
  },
  {
    id: "kayak",
    label: "Kayak / SUP",
    leewayFactor: 0.048,
    windageFactor: 0.55,
  },
  {
    id: "inflatable",
    label: "Inflatable (RIB)",
    leewayFactor: 0.055,
    windageFactor: 1.1,
  },
];

export const DEFAULT_BOAT_PROFILE_ID = "open-skiff";

export function getBoatProfile(id: string): BoatProfile {
  return BOAT_PROFILES.find((p) => p.id === id) ?? BOAT_PROFILES[0]!;
}
