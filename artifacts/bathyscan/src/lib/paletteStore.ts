/**
 * paletteStore — persisted user-customised depth colour palette.
 *
 * The depth palette is a variable-length list of contiguous depth bands.
 * `bandColors` holds one hex colour per band (2–16 bands) and
 * `bandBoundaries` holds the band edges in feet (always exactly
 * bandColors.length + 1 entries). The first boundary is fixed at 0 ft;
 * every other boundary — including the last — is user-editable, so the
 * scale is no longer capped at 2000 ft.
 *
 * `blendBands` selects between smooth gradient interpolation between band
 * colours (true, the historical look) and crisp discrete bands (false).
 *
 * Persisted to localStorage under "bathyscan:palette".
 *
 * Schema history (for the localStorage merge guard below):
 *   v0 (pre-bandColors): only shallow / deep / customStops were persisted.
 *   v1: added bandColors (fixed 10 entries) + bandBoundaries (fixed 11,
 *      0 → 2000 ft).
 *   v2 (current): variable-length bands (2–16) with an editable last
 *      boundary, plus `blendBands`. Old fixed-length arrays are valid
 *      variable-length arrays, so they migrate without transformation.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Identifies the current palette schema version for documentation purposes.
 *  Increment this whenever a new field is added and a migration guard is
 *  added to the persist `merge` function below. */
export const PALETTE_SCHEMA_VERSION = 3;

export const DEFAULT_SHALLOW = "#00e5ff";
export const DEFAULT_DEEP = "#283593";

/** Fixed interior gradient stops used when seeding presets. */
export const MID1_HEX = "#0d47a1";
export const MID2_HEX = "#1a237e";

/** Minimum number of depth bands. */
export const MIN_BANDS = 2;
/** Maximum number of depth bands. */
export const MAX_BANDS = 16;
/** Maximum number of user-saved named depth themes. */
export const MAX_SAVED_THEMES = 20;

/** A user-saved named depth colour theme snapshot. */
export interface SavedDepthTheme {
  /** Unique identifier (stable across renames). */
  id: string;
  /** User-provided display name (1–64 characters). */
  name: string;
  /** Snapshot of bandColors at save time. */
  bandColors: string[];
  /** Snapshot of bandBoundaries at save time. */
  bandBoundaries: number[];
  /** Snapshot of blendBands at save time. */
  blendBands: boolean;
}

/** Generate a compact unique id (no external deps). */
function makeThemeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Validate and sanitize a raw `savedDepthThemes` value from server/storage.
 *  Returns a clean array (possibly empty) — never throws. */
function sanitizeSavedThemes(raw: unknown): SavedDepthTheme[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedDepthTheme[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== "string" || rec.id.length === 0) continue;
    if (typeof rec.name !== "string" || rec.name.length === 0) continue;
    const colors = sanitizeBandColors(rec.bandColors);
    const boundaries = sanitizeBandBoundaries(rec.bandBoundaries);
    if (!colors || !boundaries || boundaries.length !== colors.length + 1) continue;
    out.push({
      id: rec.id.slice(0, 36),
      name: rec.name.slice(0, 64),
      bandColors: colors,
      bandBoundaries: boundaries,
      blendBands: typeof rec.blendBands === "boolean" ? rec.blendBands : true,
    });
    if (out.length >= MAX_SAVED_THEMES) break;
  }
  return out;
}
/** Maximum value (feet) allowed for the deepest band boundary. */
export const MAX_BOUNDARY_FT = 36000;

/**
 * Default depth band boundaries in feet. N+1 values define N bands. The
 * first (0) is always fixed; every other value — including the last — is
 * user-editable.
 */
export const DEFAULT_BAND_BOUNDARIES: readonly number[] = [
  0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000,
];

/** Minimum gap in feet that must be maintained between adjacent band boundaries. */
export const MIN_BOUNDARY_GAP_FT = 1;

/**
 * Default per-band colours, one entry per depth band. Index i corresponds
 * to the band between DEFAULT_BAND_BOUNDARIES[i] and [i+1].
 */
export const DEFAULT_BAND_COLORS: readonly string[] = [
  "#00e5ff", //    0– 50 ft — cyan (matches DEFAULT_SHALLOW)
  "#00c8de", //   50–100 ft — cyan-teal
  "#00a8d0", //  100–150 ft — sky blue
  "#0288d1", //  150–200 ft — ocean blue
  "#0277bd", //  200–250 ft — medium blue
  "#1565c0", //  250–300 ft — cobalt blue
  "#0d47a1", //  300–350 ft — royal blue
  "#1a237e", //  350–450 ft — indigo navy
  "#283593", //  450–600 ft — deep navy
  "#1e2b6e", //  600–2000 ft — dark navy
];

/**
 * Curated preset palettes for one-click selection. Each preset defines a
 * shallow and deep endpoint; band colours are interpolated between them.
 */
export interface PalettePreset {
  id: string;
  label: string;
  shallow: string;
  deep: string;
}

export const PALETTE_PRESETS: PalettePreset[] = [
  { id: "default", label: "Default Ocean", shallow: DEFAULT_SHALLOW, deep: DEFAULT_DEEP },
  { id: "high-contrast", label: "High-Contrast", shallow: "#ffeb3b", deep: "#000000" },
  { id: "warm", label: "Warm Shallows", shallow: "#ffd54f", deep: "#4a148c" },
];

/** A single colour stop on the (deprecated) Custom palette. */
export interface CustomStop {
  /** Position along the depth axis, 0 (shallow) → 1 (deep). */
  position: number;
  /** CSS hex colour, "#rrggbb". */
  hex: string;
}

/**
 * Default custom stops mirror the Default Ocean preset. Retained only for
 * localStorage hydration safety of pre-band clients.
 */
export const DEFAULT_CUSTOM_STOPS: CustomStop[] = [
  { position: 0.0, hex: DEFAULT_SHALLOW },
  { position: 0.3, hex: MID1_HEX },
  { position: 0.65, hex: MID2_HEX },
  { position: 1.0, hex: DEFAULT_DEEP },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Build a 4-stop custom palette for a preset (Default / High-Contrast / Warm).
 * @deprecated retained for localStorage hydration paths only.
 */
export function customStopsFromPreset(preset: PalettePreset): CustomStop[] {
  return [
    { position: 0.0, hex: preset.shallow },
    { position: 0.3, hex: MID1_HEX },
    { position: 0.65, hex: MID2_HEX },
    { position: 1.0, hex: preset.deep },
  ];
}

/**
 * Build a bandColors array for a preset by linearly interpolating from the
 * preset's shallow to deep across `count` bands (defaults to the current
 * default band count). Used when the user clicks a preset chip.
 */
export function bandColorsFromPreset(
  preset: PalettePreset,
  count: number = DEFAULT_BAND_COLORS.length,
): string[] {
  const n = Math.max(MIN_BANDS, Math.min(MAX_BANDS, Math.round(count)));
  return Array.from({ length: n }, (_, i) =>
    mixHex(preset.shallow, preset.deep, n === 1 ? 0 : i / (n - 1)),
  );
}

/**
 * Sanitise a raw bandBoundaries value. Must be an array of 3–17 finite
 * numbers (rounded to integers), strictly increasing, starting at 0 and
 * with the last value ≤ MAX_BOUNDARY_FT. Returns null if the input fails
 * any check so callers can fall back to DEFAULT_BAND_BOUNDARIES.
 */
export function sanitizeBandBoundaries(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < MIN_BANDS + 1 || raw.length > MAX_BANDS + 1) return null;
  const parsed = (raw as unknown[]).map((v) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v) : NaN,
  );
  if (parsed.some((v) => isNaN(v))) return null;
  if (parsed[0] !== 0) return null;
  if (parsed[parsed.length - 1]! > MAX_BOUNDARY_FT) return null;
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i]! <= parsed[i - 1]!) return null;
  }
  return parsed as number[];
}

/**
 * Sanitise a raw bandColors value: must be an array of 2–16 valid hex
 * strings. Returns null when the input is not an array, has an invalid
 * length, or contains any malformed entry.
 */
export function sanitizeBandColors(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < MIN_BANDS || raw.length > MAX_BANDS) return null;
  const out: string[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== "string" || !HEX_RE.test(entry)) return null;
    out.push(entry.toLowerCase());
  }
  return out;
}

/**
 * Sanitise a colors + boundaries pair together: both must individually
 * sanitise AND boundaries must have exactly colors.length + 1 entries.
 * Returns null when the pair is inconsistent.
 */
export function sanitizeBandArrays(
  rawColors: unknown,
  rawBoundaries: unknown,
): { bandColors: string[]; bandBoundaries: number[] } | null {
  const colors = sanitizeBandColors(rawColors);
  const boundaries = sanitizeBandBoundaries(rawBoundaries);
  if (!colors || !boundaries) return null;
  if (boundaries.length !== colors.length + 1) return null;
  return { bandColors: colors, bandBoundaries: boundaries };
}

/**
 * Sanitise a raw stops array: keep only well-formed entries (valid hex, finite
 * position), clamp each position to [0, 1], and sort ascending by position.
 * Returns null when fewer than 2 valid stops remain so callers can fall back
 * to the default.
 */
export function sanitizeCustomStops(raw: unknown): CustomStop[] | null {
  if (!Array.isArray(raw)) return null;
  const cleaned: CustomStop[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const rec = s as Record<string, unknown>;
    const pos = typeof rec.position === "number" ? rec.position : NaN;
    const hex = typeof rec.hex === "string" ? rec.hex : "";
    if (!Number.isFinite(pos)) continue;
    if (!HEX_RE.test(hex)) continue;
    cleaned.push({
      position: Math.max(0, Math.min(1, pos)),
      hex: hex.toLowerCase(),
    });
  }
  if (cleaned.length < 2) return null;
  cleaned.sort((a, b) => a.position - b.position);
  return cleaned;
}

/**
 * Resample band colours when the band count changes (e.g. a suggestion
 * applies an 11-boundary array while the user currently has 3 bands).
 * Colours are sampled from the existing gradient — old colours placed at
 * their normalised lower-boundary positions — at each new band's
 * normalised lower-boundary position, so the overall look is preserved.
 */
export function resampleBandColors(
  oldColors: readonly string[],
  oldBoundaries: readonly number[],
  newBoundaries: readonly number[],
): string[] {
  const oldMax = oldBoundaries[oldBoundaries.length - 1] || 1;
  const newMax = newBoundaries[newBoundaries.length - 1] || 1;
  const oldPos = oldBoundaries.slice(0, -1).map((ft) => ft / oldMax);
  const sample = (t: number): string => {
    if (t <= oldPos[0]!) return oldColors[0]!;
    for (let i = 0; i < oldPos.length - 1; i++) {
      if (t <= oldPos[i + 1]!) {
        const span = oldPos[i + 1]! - oldPos[i]!;
        const alpha = span === 0 ? 0 : (t - oldPos[i]!) / span;
        return mixHex(oldColors[i]!, oldColors[i + 1]!, alpha);
      }
    }
    return oldColors[oldColors.length - 1]!;
  };
  return newBoundaries.slice(0, -1).map((ft) => sample(ft / newMax));
}

interface PaletteStore {
  /**
   * Monotonic edit counter bumped on every *user-initiated* mutation (never
   * by `hydrateFromServer`). The server-settings sync hook watches this
   * instead of comparing value snapshots, so an edit whose normalized value
   * happens to equal the previous state (e.g. "#FF00AA" → "#ff00aa") still
   * triggers the debounced PUT /api/settings, and server hydration never
   * echoes a spurious PUT.
   */
  rev: number;
  /** Mirror of bandColors[0] (kept for legacy preset/e2e surfaces). */
  shallow: string;
  /** Mirror of the last band colour (kept for legacy preset/e2e surfaces). */
  deep: string;
  /** @deprecated Ordered custom-theme stops. Retained for hydration safety. */
  customStops: CustomStop[];
  /** Per-band colours (2–16 entries, one per depth band). */
  bandColors: string[];
  /**
   * Depth band boundaries in feet. Always bandColors.length + 1 entries.
   * The first is always 0; every other value (including the last) is
   * user-editable up to MAX_BOUNDARY_FT.
   */
  bandBoundaries: number[];
  /**
   * true  → smooth gradient interpolation between band colours (default);
   * false → crisp discrete bands (each band a single flat colour).
   */
  blendBands: boolean;
  setShallow: (hex: string) => void;
  setDeep: (hex: string) => void;
  /** @deprecated Custom theme now renders from bandColors/bandBoundaries. */
  setCustomStops: (stops: CustomStop[]) => void;
  /** @deprecated See `setCustomStops`. */
  addCustomStop: () => void;
  /** @deprecated See `setCustomStops`. */
  removeCustomStop: (index: number) => void;
  /** @deprecated See `setCustomStops`. */
  updateCustomStop: (index: number, patch: Partial<CustomStop>) => void;
  /** @deprecated See `setCustomStops`. */
  resetCustomStops: () => void;
  /** Set a single band colour by index. Syncs index 0 → shallow, last → deep. */
  setBandColor: (index: number, hex: string) => void;
  /**
   * Replace the full bandColors array. When the new length differs from the
   * current band count, boundaries are re-spread evenly across the current
   * total depth span. Falls back to defaults on bad input.
   */
  setBandColors: (colors: string[]) => void;
  /** Restore all band colours to DEFAULT_BAND_COLORS (and default count). */
  resetBandColors: () => void;
  /**
   * Set a boundary by index (1 … bandCount) in feet. Interior boundaries
   * clamp to [prev + MIN_BOUNDARY_GAP_FT, next - MIN_BOUNDARY_GAP_FT]; the
   * last boundary clamps to [prev + MIN_BOUNDARY_GAP_FT, MAX_BOUNDARY_FT].
   * No-ops for index 0 (fixed at 0 ft).
   */
  setBandBoundary: (index: number, ft: number) => void;
  /**
   * Replace the full bandBoundaries array. When the new length differs from
   * the current band count + 1, bandColors are resampled from the existing
   * gradient so the palette keeps its look. Falls back to defaults on bad
   * input.
   */
  setBandBoundaries: (boundaries: number[]) => void;
  /** Restore all band boundaries to DEFAULT_BAND_BOUNDARIES (and default count). */
  resetBandBoundaries: () => void;
  /** Insert a new band by splitting the widest existing band. */
  addBand: () => void;
  /** Remove the band at `index` (merges its span into a neighbour). */
  removeBand: (index: number) => void;
  /** Toggle smooth blending vs crisp discrete bands. */
  setBlendBands: (blend: boolean) => void;
  /** User-saved named depth colour themes. */
  savedDepthThemes: SavedDepthTheme[];
  /**
   * Save the current bandColors / bandBoundaries / blendBands as a new named
   * theme. No-op when the maximum theme count is reached.
   */
  saveCurrentTheme: (name: string) => void;
  /** Remove a saved theme by its id. No-op when id is not found. */
  deleteTheme: (id: string) => void;
  /** Rename a saved theme. No-op when id is not found or name is empty. */
  renameTheme: (id: string, name: string) => void;
  /**
   * Apply a saved theme by id: restores bandColors, bandBoundaries, and
   * blendBands from the saved snapshot. No-op when id is not found.
   */
  applyTheme: (id: string) => void;
  reset: () => void;
  /**
   * Apply server-side palette values to the store. Values that are missing
   * or malformed are left untouched. bandColors/bandBoundaries are only
   * applied when the resulting pair stays consistent
   * (boundaries.length === colors.length + 1).
   */
  hydrateFromServer: (partial: {
    paletteShallow?: unknown;
    paletteDeep?: unknown;
    customStops?: unknown;
    bandColors?: unknown;
    bandBoundaries?: unknown;
    blendDepthBands?: unknown;
    savedDepthThemes?: unknown;
  }) => void;
}

/**
 * Normalise a stops array before committing to the store. Clamps positions
 * to [0, 1], coerces hex to lowercase, sorts ascending by position, and
 * enforces a minimum of 2 stops (falling back to defaults on underflow).
 */
function normalizeStops(stops: CustomStop[]): CustomStop[] {
  const cleaned = stops
    .filter((s) => HEX_RE.test(s.hex) && Number.isFinite(s.position))
    .map((s) => ({
      position: Math.max(0, Math.min(1, s.position)),
      hex: s.hex.toLowerCase(),
    }))
    .sort((a, b) => a.position - b.position);
  if (cleaned.length < 2) return DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s }));
  return cleaned;
}

/** Spread `count`+1 boundaries evenly from 0 to `maxFt` (integers, strictly increasing). */
function evenBoundaries(count: number, maxFt: number): number[] {
  const max = Math.max(count * MIN_BOUNDARY_GAP_FT, Math.round(maxFt));
  const bb: number[] = [0];
  for (let i = 1; i <= count; i++) {
    const raw = Math.round((i / count) * max);
    bb.push(Math.max(raw, bb[i - 1]! + MIN_BOUNDARY_GAP_FT));
  }
  return bb;
}

export const usePaletteStore = create<PaletteStore>()(
  persist(
    (set, get) => {
      /** Merge a patch and bump the user-edit revision counter atomically. */
      const setEdit = (patch: Partial<PaletteStore>) =>
        set({ ...patch, rev: get().rev + 1 });
      /** Build the shallow/deep mirror fields for a colours array. */
      const mirrors = (colors: string[]) => ({
        shallow: colors[0]!,
        deep: colors[colors.length - 1]!,
      });
      return {
      rev: 0,
      shallow: DEFAULT_SHALLOW,
      deep: DEFAULT_DEEP,
      customStops: DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s })),
      bandColors: [...DEFAULT_BAND_COLORS],
      bandBoundaries: [...DEFAULT_BAND_BOUNDARIES],
      blendBands: true,
      savedDepthThemes: [],

      setShallow: (hex) => {
        if (!HEX_RE.test(hex)) return;
        const bc = [...get().bandColors];
        bc[0] = hex.toLowerCase();
        setEdit({ shallow: hex.toLowerCase(), bandColors: bc });
      },
      setDeep: (hex) => {
        if (!HEX_RE.test(hex)) return;
        const bc = [...get().bandColors];
        bc[bc.length - 1] = hex.toLowerCase();
        setEdit({ deep: hex.toLowerCase(), bandColors: bc });
      },
      setCustomStops: (stops) => setEdit({ customStops: normalizeStops(stops) }),
      addCustomStop: () => {
        const stops = get().customStops;
        let bestIdx = 0;
        let bestGap = -1;
        for (let i = 0; i < stops.length - 1; i++) {
          const gap = stops[i + 1]!.position - stops[i]!.position;
          if (gap > bestGap) {
            bestGap = gap;
            bestIdx = i;
          }
        }
        const lo = stops[bestIdx]!;
        const hi = stops[bestIdx + 1]!;
        const pos = (lo.position + hi.position) / 2;
        const hex = mixHex(lo.hex, hi.hex, 0.5);
        const next = [...stops, { position: pos, hex }];
        setEdit({ customStops: normalizeStops(next) });
      },
      removeCustomStop: (index) => {
        const stops = get().customStops;
        if (stops.length <= 2) return;
        const next = stops.filter((_, i) => i !== index);
        setEdit({ customStops: normalizeStops(next) });
      },
      updateCustomStop: (index, patch) => {
        const stops = get().customStops;
        if (index < 0 || index >= stops.length) return;
        const next = stops.map((s, i) => (i === index ? { ...s, ...patch } : s));
        setEdit({ customStops: normalizeStops(next) });
      },
      resetCustomStops: () =>
        setEdit({ customStops: DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s })) }),

      setBandColor: (index, hex) => {
        const cur = get().bandColors;
        if (index < 0 || index >= cur.length) return;
        if (!HEX_RE.test(hex)) return;
        const bc = [...cur];
        bc[index] = hex.toLowerCase();
        setEdit({ bandColors: bc, ...mirrors(bc) });
      },
      setBandColors: (colors) => {
        const sanitized = sanitizeBandColors(colors);
        if (!sanitized) {
          const bc = [...DEFAULT_BAND_COLORS];
          setEdit({
            bandColors: bc,
            bandBoundaries: [...DEFAULT_BAND_BOUNDARIES],
            ...mirrors(bc),
          });
          return;
        }
        const bb = get().bandBoundaries;
        const patch: Partial<PaletteStore> = {
          bandColors: sanitized,
          ...mirrors(sanitized),
        };
        if (bb.length !== sanitized.length + 1) {
          patch.bandBoundaries = evenBoundaries(
            sanitized.length,
            bb[bb.length - 1] ?? DEFAULT_BAND_BOUNDARIES[DEFAULT_BAND_BOUNDARIES.length - 1]!,
          );
        }
        setEdit(patch);
      },
      resetBandColors: () => {
        const bc = [...DEFAULT_BAND_COLORS];
        const patch: Partial<PaletteStore> = { bandColors: bc, ...mirrors(bc) };
        if (get().bandBoundaries.length !== bc.length + 1) {
          patch.bandBoundaries = [...DEFAULT_BAND_BOUNDARIES];
        }
        setEdit(patch);
      },

      setBandBoundary: (index, ft) => {
        const bb = [...get().bandBoundaries];
        const last = bb.length - 1;
        if (index < 1 || index > last) return;
        if (!Number.isFinite(ft)) return;
        const prev = bb[index - 1]!;
        const upper =
          index === last
            ? MAX_BOUNDARY_FT
            : bb[index + 1]! - MIN_BOUNDARY_GAP_FT;
        const clamped = Math.max(
          prev + MIN_BOUNDARY_GAP_FT,
          Math.min(upper, Math.round(ft)),
        );
        bb[index] = clamped;
        setEdit({ bandBoundaries: bb });
      },
      setBandBoundaries: (boundaries) => {
        const sanitized = sanitizeBandBoundaries(boundaries);
        if (!sanitized) {
          const bc = [...DEFAULT_BAND_COLORS];
          setEdit({
            bandBoundaries: [...DEFAULT_BAND_BOUNDARIES],
            bandColors: bc,
            ...mirrors(bc),
          });
          return;
        }
        const { bandColors, bandBoundaries } = get();
        const patch: Partial<PaletteStore> = { bandBoundaries: sanitized };
        if (sanitized.length !== bandColors.length + 1) {
          const bc = resampleBandColors(bandColors, bandBoundaries, sanitized);
          patch.bandColors = bc;
          Object.assign(patch, mirrors(bc));
        }
        setEdit(patch);
      },
      resetBandBoundaries: () => {
        const patch: Partial<PaletteStore> = {
          bandBoundaries: [...DEFAULT_BAND_BOUNDARIES],
        };
        if (get().bandColors.length + 1 !== DEFAULT_BAND_BOUNDARIES.length) {
          const bc = [...DEFAULT_BAND_COLORS];
          patch.bandColors = bc;
          Object.assign(patch, mirrors(bc));
        }
        setEdit(patch);
      },

      addBand: () => {
        const { bandColors, bandBoundaries } = get();
        if (bandColors.length >= MAX_BANDS) return;
        // Find the widest band and split it in half.
        let bestIdx = 0;
        let bestGap = -1;
        for (let i = 0; i < bandBoundaries.length - 1; i++) {
          const gap = bandBoundaries[i + 1]! - bandBoundaries[i]!;
          if (gap > bestGap) {
            bestGap = gap;
            bestIdx = i;
          }
        }
        if (bestGap < MIN_BOUNDARY_GAP_FT * 2) return; // nothing splittable
        const mid = Math.round(
          (bandBoundaries[bestIdx]! + bandBoundaries[bestIdx + 1]!) / 2,
        );
        const bb = [...bandBoundaries];
        bb.splice(bestIdx + 1, 0, mid);
        const bc = [...bandColors];
        const nextHex = bandColors[bestIdx + 1] ?? bandColors[bestIdx]!;
        bc.splice(bestIdx + 1, 0, mixHex(bandColors[bestIdx]!, nextHex, 0.5));
        setEdit({ bandColors: bc, bandBoundaries: bb, ...mirrors(bc) });
      },
      removeBand: (index) => {
        const { bandColors, bandBoundaries } = get();
        if (bandColors.length <= MIN_BANDS) return;
        if (index < 0 || index >= bandColors.length) return;
        const bc = bandColors.filter((_, i) => i !== index);
        const bb = [...bandBoundaries];
        // Removing a band merges its span into the next band; removing the
        // last band merges it into the previous one (drop its lower edge).
        if (index === bandColors.length - 1) {
          bb.splice(index, 1);
        } else {
          bb.splice(index + 1, 1);
        }
        setEdit({ bandColors: bc, bandBoundaries: bb, ...mirrors(bc) });
      },
      setBlendBands: (blend) => setEdit({ blendBands: !!blend }),

      saveCurrentTheme: (name) => {
        const trimmed = name.trim().slice(0, 64);
        if (!trimmed) return;
        const { bandColors, bandBoundaries, blendBands, savedDepthThemes } = get();
        if (savedDepthThemes.length >= MAX_SAVED_THEMES) return;
        const theme: SavedDepthTheme = {
          id: makeThemeId(),
          name: trimmed,
          bandColors: [...bandColors],
          bandBoundaries: [...bandBoundaries],
          blendBands,
        };
        setEdit({ savedDepthThemes: [...savedDepthThemes, theme] });
      },
      deleteTheme: (id) => {
        const { savedDepthThemes } = get();
        const next = savedDepthThemes.filter((t) => t.id !== id);
        if (next.length === savedDepthThemes.length) return;
        setEdit({ savedDepthThemes: next });
      },
      renameTheme: (id, name) => {
        const trimmed = name.trim().slice(0, 64);
        if (!trimmed) return;
        const { savedDepthThemes } = get();
        const idx = savedDepthThemes.findIndex((t) => t.id === id);
        if (idx === -1) return;
        const next = savedDepthThemes.map((t) =>
          t.id === id ? { ...t, name: trimmed } : t,
        );
        setEdit({ savedDepthThemes: next });
      },
      applyTheme: (id) => {
        const { savedDepthThemes } = get();
        const theme = savedDepthThemes.find((t) => t.id === id);
        if (!theme) return;
        const bc = [...theme.bandColors];
        setEdit({
          bandColors: bc,
          bandBoundaries: [...theme.bandBoundaries],
          blendBands: theme.blendBands,
          shallow: bc[0]!,
          deep: bc[bc.length - 1]!,
        });
      },

      reset: () =>
        setEdit({
          shallow: DEFAULT_SHALLOW,
          deep: DEFAULT_DEEP,
          customStops: DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s })),
          bandColors: [...DEFAULT_BAND_COLORS],
          bandBoundaries: [...DEFAULT_BAND_BOUNDARIES],
          blendBands: true,
        }),
      hydrateFromServer: (partial) => {
        const patch: Partial<PaletteStore> = {};
        if (typeof partial.paletteShallow === "string" && HEX_RE.test(partial.paletteShallow)) {
          patch.shallow = partial.paletteShallow.toLowerCase();
        }
        if (typeof partial.paletteDeep === "string" && HEX_RE.test(partial.paletteDeep)) {
          patch.deep = partial.paletteDeep.toLowerCase();
        }
        if (partial.customStops !== undefined) {
          const cleaned = sanitizeCustomStops(partial.customStops);
          if (cleaned) patch.customStops = cleaned;
        }
        const cur = get();
        // bandColors/bandBoundaries only apply when the *resulting* pair is
        // consistent (boundaries.length === colors.length + 1). Server GETs
        // always carry both; partial payloads only apply when compatible
        // with the untouched half.
        const nextColors =
          partial.bandColors !== undefined
            ? sanitizeBandColors(partial.bandColors)
            : cur.bandColors;
        const nextBoundaries =
          partial.bandBoundaries !== undefined
            ? sanitizeBandBoundaries(partial.bandBoundaries)
            : cur.bandBoundaries;
        if (
          nextColors &&
          nextBoundaries &&
          nextBoundaries.length === nextColors.length + 1
        ) {
          if (partial.bandColors !== undefined) {
            const bc = [...nextColors];
            // paletteShallow is the authoritative source for the top-band
            // colour when both arrive together (legacy-row migrations).
            if (patch.shallow && bc.length === DEFAULT_BAND_COLORS.length) {
              bc[0] = patch.shallow;
            }
            patch.bandColors = bc;
            patch.shallow = bc[0]!;
            patch.deep = bc[bc.length - 1]!;
          }
          if (partial.bandBoundaries !== undefined) {
            patch.bandBoundaries = nextBoundaries;
          }
        }
        if (typeof partial.blendDepthBands === "boolean") {
          patch.blendBands = partial.blendDepthBands;
        }
        if (partial.savedDepthThemes !== undefined) {
          patch.savedDepthThemes = sanitizeSavedThemes(partial.savedDepthThemes);
        }
        if (Object.keys(patch).length > 0) set(patch);
      },
      };
    },
    {
      name: "bathyscan:palette",
      // `rev` is a session-local edit counter — persisting it would make a
      // freshly loaded page look "dirty" to the server-sync hook and block
      // hydration. Strip it from the persisted snapshot.
      partialize: (state) => {
        const { rev: _rev, ...rest } = state;
        return rest as PaletteStore;
      },
      merge: (persistedState, currentState) => {
        const ps = persistedState as Record<string, unknown> | undefined;
        const merged = { ...currentState, ...(ps as object) };
        const cleanedStops = sanitizeCustomStops(ps?.customStops);
        // v2 migration: the pair must be consistent; old v1 state (10 colors
        // + 11 boundaries, 0→2000) passes the variable-length sanitisers
        // unchanged. Anything inconsistent falls back to defaults.
        const pair = sanitizeBandArrays(ps?.bandColors, ps?.bandBoundaries);
        const soloBoundaries = pair ? null : sanitizeBandBoundaries(ps?.bandBoundaries);
        const soloColors = pair ? null : sanitizeBandColors(ps?.bandColors);
        let cleanedBands: string[];
        let cleanedBoundaries: number[];
        if (pair) {
          cleanedBands = pair.bandColors;
          cleanedBoundaries = pair.bandBoundaries;
        } else if (soloBoundaries) {
          // Boundaries alone are well-formed (colors missing or mismatched):
          // keep the boundaries and resample colors to fit their band count.
          cleanedBoundaries = soloBoundaries;
          cleanedBands = soloColors
            ? resampleBandColors(
                soloColors,
                Array.from({ length: soloColors.length + 1 }, (_, i) => i),
                soloBoundaries,
              )
            : resampleBandColors(DEFAULT_BAND_COLORS, DEFAULT_BAND_BOUNDARIES, soloBoundaries);
        } else if (soloColors) {
          // Colors alone are well-formed: keep them and derive evenly-spread
          // boundaries across the default depth range.
          cleanedBands = soloColors;
          const maxFt = DEFAULT_BAND_BOUNDARIES[DEFAULT_BAND_BOUNDARIES.length - 1]!;
          cleanedBoundaries = Array.from({ length: soloColors.length + 1 }, (_, i) =>
            Math.round((i / soloColors.length) * maxFt),
          );
        } else {
          cleanedBands = [...DEFAULT_BAND_COLORS];
          cleanedBoundaries = [...DEFAULT_BAND_BOUNDARIES];
          // v0 migration: persisted shallow but no band arrays — seed the
          // top band from the persisted shallow.
          if (typeof ps?.shallow === "string" && HEX_RE.test(ps.shallow)) {
            cleanedBands[0] = ps.shallow.toLowerCase();
          }
        }
        return {
          ...merged,
          customStops: cleanedStops ?? DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s })),
          bandColors: cleanedBands,
          bandBoundaries: cleanedBoundaries,
          shallow: cleanedBands[0]!,
          deep: cleanedBands[cleanedBands.length - 1]!,
          blendBands: typeof ps?.blendBands === "boolean" ? ps.blendBands : true,
        } as PaletteStore;
      },
    },
  ),
);

/** Mix two hex colours in RGB space and return a "#rrggbb" string. */
export function mixHex(a: string, b: string, alpha: number): string {
  const pa = parseInt(a.replace("#", ""), 16);
  const pb = parseInt(b.replace("#", ""), 16);
  const ar = (pa >> 16) & 0xff, ag = (pa >> 8) & 0xff, ab = pa & 0xff;
  const br = (pb >> 16) & 0xff, bg = (pb >> 8) & 0xff, bb = pb & 0xff;
  const r = Math.round(ar + (br - ar) * alpha);
  const g = Math.round(ag + (bg - ag) * alpha);
  const bl = Math.round(ab + (bb - ab) * alpha);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}
