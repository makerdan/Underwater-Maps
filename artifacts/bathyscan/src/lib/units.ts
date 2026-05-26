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
export const MPH_TO_KPH = 1.609344;
export const MPH_TO_KNOTS = 0.868976;

export function getUnits(): UnitsSystem {
  return useSettingsStore.getState().units;
}

/**
 * Resolved temperature unit, honouring the per-temperature override in
 * settings. When `temperatureUnit === "auto"` it follows the global
 * `units` selector (metric → metric / °C, imperial → imperial / °F).
 * Returns a `UnitsSystem` so it can be passed straight through to
 * `formatTemperature(..., { units })` and the existing °C/°F branch.
 */
export function getTemperatureUnit(): UnitsSystem {
  const s = useSettingsStore.getState();
  if (s.temperatureUnit === "celsius") return "metric";
  if (s.temperatureUnit === "fahrenheit") return "imperial";
  // "nautical" doesn't have its own temperature scale — fall back to
  // metric (°C), which the user can override via `temperatureUnit`.
  return s.units === "nautical" ? "metric" : s.units;
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
  if (units !== "metric") {
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
  const imperialish = units !== "metric";
  const toUnit = (m: number): number =>
    imperialish ? Math.round(m * M_TO_FT) : Math.round(m);
  const singular = imperialish ? "foot" : "meter";
  const plural = imperialish ? "feet" : "meters";
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
  if (units !== "metric") {
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
/**
 * Speed in mph → "X mph" (imperial), "X km/h" (metric), or "X kn" (nautical).
 * The `nautical` branch is the boater-facing primary readout — knots is a
 * first-class option, not a secondary annotation.
 */
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
  if (units === "nautical") {
    const kt = mph * MPH_TO_KNOTS;
    const txt = kt % 1 === 0 ? String(kt) : kt.toFixed(decimals);
    return `${txt} kn`;
  }
  const kph = mph * MPH_TO_KPH;
  const txt = kph % 1 === 0 ? String(kph) : kph.toFixed(decimals);
  return `${txt} km/h`;
}

/**
 * Speed where the source value is already in knots (e.g. wind / tide / current
 * readings from Open-Meteo and NOAA). Converts back through mph so the
 * formatting / unit branch logic stays in one place.
 */
export function formatSpeedFromKnots(
  knots: number | null | undefined,
  opts: { units?: UnitsSystem; decimals?: number } = {},
): string {
  if (knots === null || knots === undefined || !Number.isFinite(knots)) return "—";
  return formatSpeed(knots / MPH_TO_KNOTS, opts);
}

/** Short speed suffix matching `formatSpeed` — "mph" / "km/h" / "kn". */
export function speedSuffix(units: UnitsSystem = getUnits()): string {
  if (units === "imperial") return "mph";
  if (units === "nautical") return "kn";
  return "km/h";
}

// ── Temperature ──────────────────────────────────────────────────────────
/**
 * Temperature in °C → "X °C" (metric) or "X °F" (imperial).
 *
 * Resolution order for which unit to display in:
 *   1. explicit `opts.units` (caller wins, e.g. unit tests)
 *   2. the per-temperature override (`temperatureUnit !== "auto"`)
 *   3. the global `units` selector
 */
export function formatTemperature(
  celsius: number | null | undefined,
  opts: { units?: UnitsSystem; decimals?: number } = {},
): string {
  if (celsius === null || celsius === undefined || !Number.isFinite(celsius)) return "—";
  const units = opts.units ?? getTemperatureUnit();
  const decimals = opts.decimals ?? 1;
  if (units === "imperial") {
    const f = celsius * 9 / 5 + 32;
    return `${f.toFixed(decimals)} °F`;
  }
  return `${celsius.toFixed(decimals)} °C`;
}

/** Short °C/°F suffix for axis labels and badge text. */
export function temperatureSuffix(units: UnitsSystem = getTemperatureUnit()): string {
  return units === "imperial" ? "°F" : "°C";
}

// ── Short suffix helpers ─────────────────────────────────────────────────
export function depthSuffix(units: UnitsSystem = getUnits()): string {
  return units === "metric" ? "m" : "ft";
}

export function distanceLargeSuffix(units: UnitsSystem = getUnits()): string {
  return units === "metric" ? "km" : "mi";
}
