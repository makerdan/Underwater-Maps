/**
 * useIntertidal — resolves the effective MHW/MHHW tidal datums (feet above
 * MLLW) used by intertidal classification.
 *
 * Resolution order per datum:
 *   1. User override from settingsStore (intertidalMhwOverrideFt /
 *      intertidalMhhwOverrideFt), when set.
 *   2. The selected tide station's NOAA datum from tidalStore, when resolved.
 *   3. null — no value available.
 *
 * Clearing an override (setting it back to null) therefore falls back to the
 * station value automatically.
 */
import { useSettingsStore } from "@/lib/settingsStore";
import { useTidalStore, type TideFetchStatus } from "@/lib/tidalStore";

export interface IntertidalDatums {
  /** Effective MHW (ft above MLLW): override ?? station value ?? null. */
  mhwFt: number | null;
  /** Effective MHHW (ft above MLLW): override ?? station value ?? null. */
  mhhwFt: number | null;
  /** Resolved station MHW value (ft above MLLW), independent of overrides. */
  stationMhwFt: number | null;
  /** Resolved station MHHW value (ft above MLLW), independent of overrides. */
  stationMhhwFt: number | null;
  /** Name of the station the datums came from, or null when none selected. */
  stationName: string | null;
  /** Fetch status of the station datums lookup. */
  datumsStatus: TideFetchStatus;
  /** True when the effective MHW comes from a user override. */
  mhwIsOverridden: boolean;
  /** True when the effective MHHW comes from a user override. */
  mhhwIsOverridden: boolean;
}

export function useIntertidal(): IntertidalDatums {
  const mhwOverride = useSettingsStore((s) => s.intertidalMhwOverrideFt);
  const mhhwOverride = useSettingsStore((s) => s.intertidalMhhwOverrideFt);
  const station = useTidalStore((s) => s.station);
  const datums = useTidalStore((s) => s.datums);
  const datumsStatus = useTidalStore((s) => s.datumsStatus);

  const stationMhwFt = datums?.mhwFt ?? null;
  const stationMhhwFt = datums?.mhhwFt ?? null;

  return {
    mhwFt: mhwOverride ?? stationMhwFt,
    mhhwFt: mhhwOverride ?? stationMhhwFt,
    stationMhwFt,
    stationMhhwFt,
    stationName: station?.name ?? null,
    datumsStatus,
    mhwIsOverridden: mhwOverride !== null,
    mhhwIsOverridden: mhhwOverride !== null,
  };
}
