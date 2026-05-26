/**
 * units — centralised conversion + formatting helpers that honour the
 * user's "Units" preference (Metric vs Imperial) from the settings store.
 *
 * All input values are in the canonical metric form used throughout the
 * codebase:
 *   - depth / distance in metres
 *   - speed in mph (the boat / camera speed model)
 *   - temperature in degrees Celsius
 *
 * Each helper reads the live `units` value from useSettingsStore and
 * returns a fully-formatted, suffixed string. Components that need to
 * re-render when the user flips the toggle should subscribe to the
 * `units` field directly (the helpers themselves are pure).
 */
import { useSettingsStore, type UnitsSystem } from "./settingsStore";

const M_TO_FT = 3.28084;
const KM_TO_MI = 0.621371;
const MPH_TO_KPH = 1.609344;

export function getUnits(): UnitsSystem {
  return useSettingsStore.getState().units;
}

// ── Depth ────────────────────────────────────────────────────────────────
export function formatDepth(
  metres: number | null | undefined,
  opts: { units?: UnitsSystem; decimals?: number; localize?: boolean } = {},
): string {
  if (metres === null || metres === undefined || !Number.isFinite(metres)) return "—";
  const units = opts.units ?? getUnits();
  const decimals = opts.decimals ?? 0;
  const localize = opts.localize ?? true;
  if (units === "imperial") {
    const ft = metres * M_TO_FT;
    const rounded = decimals > 0 ? Number(ft.toFixed(decimals)) : Math.round(ft);
    return `${localize ? rounded.toLocaleString() : rounded} ft`;
  }
  const rounded = decimals > 0 ? Number(metres.toFixed(decimals)) : Math.round(metres);
  return `${localize ? rounded.toLocaleString() : rounded} m`;
}

/**
 * Depth range as a full-word sentence, e.g. "1 meter to 24 meters" (metric)
 * or "3 feet to 79 feet" (imperial). Honors the user's Units preference
 * and pluralises the unit noun appropriately.
 */
export function formatDepthRange(
  minMetres: number | null | undefined,
  maxMetres: number | null | undefined,
  opts: { units?: UnitsSystem } = {},
): string {
  if (
    minMetres === null || minMetres === undefined || !Number.isFinite(minMetres) ||
    maxMetres === null || maxMetres === undefined || !Number.isFinite(maxMetres)
  ) {
    return "—";
  }
  const units = opts.units ?? getUnits();
  const toUnit = (m: number): number =>
    units === "imperial" ? Math.round(m * M_TO_FT) : Math.round(m);
  const singular = units === "imperial" ? "foot" : "meter";
  const plural = units === "imperial" ? "feet" : "meters";
  const lo = toUnit(minMetres);
  const hi = toUnit(maxMetres);
  const loLabel = `${lo.toLocaleString()} ${lo === 1 ? singular : plural}`;
  const hiLabel = `${hi.toLocaleString()} ${hi === 1 ? singular : plural}`;
  return `${loLabel} to ${hiLabel}`;
}

// ── Distance ─────────────────────────────────────────────────────────────
/** Distance in metres → "X m" / "X km" (metric) or "X ft" / "X mi" (imperial). */
export function formatDistance(
  metres: number | null | undefined,
  opts: { units?: UnitsSystem } = {},
): string {
  if (metres === null || metres === undefined || !Number.isFinite(metres)) return "—";
  const units = opts.units ?? getUnits();
  if (units === "imperial") {
    const ft = metres * M_TO_FT;
    if (ft < 1000) return `${Math.round(ft)} ft`;
    const mi = (metres / 1000) * KM_TO_MI;
    return mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(2)} mi`;
  }
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(2)} km`;
}

// ── Speed ────────────────────────────────────────────────────────────────
/** Speed in mph → "X mph" (imperial) or "X km/h" (metric). */
export function formatSpeed(
  mph: number | null | undefined,
  opts: { units?: UnitsSystem; decimals?: number } = {},
): string {
  if (mph === null || mph === undefined || !Number.isFinite(mph)) return "—";
  const units = opts.units ?? getUnits();
  const decimals = opts.decimals ?? 1;
  if (units === "imperial") {
    const v = mph;
    const txt = v % 1 === 0 ? String(v) : v.toFixed(decimals);
    return `${txt} mph`;
  }
  const kph = mph * MPH_TO_KPH;
  const txt = kph % 1 === 0 ? String(kph) : kph.toFixed(decimals);
  return `${txt} km/h`;
}

// ── Temperature ──────────────────────────────────────────────────────────
/** Temperature in °C → "X °C" (metric) or "X °F" (imperial). */
export function formatTemperature(
  celsius: number | null | undefined,
  opts: { units?: UnitsSystem; decimals?: number } = {},
): string {
  if (celsius === null || celsius === undefined || !Number.isFinite(celsius)) return "—";
  const units = opts.units ?? getUnits();
  const decimals = opts.decimals ?? 1;
  if (units === "imperial") {
    const f = celsius * 9 / 5 + 32;
    return `${f.toFixed(decimals)} °F`;
  }
  return `${celsius.toFixed(decimals)} °C`;
}

// ── Short suffix helpers ─────────────────────────────────────────────────
export function depthSuffix(units: UnitsSystem = getUnits()): string {
  return units === "imperial" ? "ft" : "m";
}

export function distanceLargeSuffix(units: UnitsSystem = getUnits()): string {
  return units === "imperial" ? "mi" : "km";
}
