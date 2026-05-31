/**
 * paletteStore — persisted user-customised depth colour palette.
 *
 * The Ocean theme uses a four-stop gradient (shallow → mid1 → mid2 → deep).
 * Users can customise the shallow and deep endpoints from the Settings page;
 * the two interior stops stay fixed so the gradient keeps its characteristic
 * blue-to-indigo shape.
 *
 * Users can also pick the "Custom" theme, which exposes a fully editable
 * ordered list of `{ position, hex }` stops (min 2). The 3D terrain re-tints
 * live as the stops change.
 *
 * Users can also edit per-band colours for the Ocean theme via the
 * `bandColors` array (10 entries indexed to DEPTH_BAND_BOUNDARIES_FT[0..9]).
 *
 * Persisted to localStorage under "bathyscan:palette".
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DEFAULT_SHALLOW = "#00e5ff";
export const DEFAULT_DEEP = "#283593";

/** Fixed interior gradient stops for the Ocean theme. Not user-editable. */
export const MID1_HEX = "#0d47a1";
export const MID2_HEX = "#1a237e";

/**
 * Default depth band boundaries in feet. 11 values define 10 bands spanning
 * 0 → 2000 ft. The first (0) and last (2000) are always fixed; the 9 interior
 * values are user-editable from the Settings page.
 */
export const DEFAULT_BAND_BOUNDARIES: readonly number[] = [
  0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000,
];

/** Maximum depth of the ocean colormap scale in feet (mirrors colormap.ts). */
const OCEAN_MAX_DEPTH_FT_PALETTE = 2000;

/** Minimum gap in feet that must be maintained between adjacent band boundaries. */
export const MIN_BOUNDARY_GAP_FT = 5;

/**
 * Default per-band colours for the Ocean theme, one entry per depth band.
 * Index i corresponds to the color at DEFAULT_BAND_BOUNDARIES[i] (the
 * lower boundary of band i). There are 10 bands (11 boundaries), so the
 * final boundary at 2000 ft uses `deep` from the palette store.
 *
 * Boundaries: [0, 50, 100, 150, 200, 250, 300, 350, 450, 600] ft
 */
export const DEFAULT_BAND_COLORS: readonly string[] = [
  "#00e5ff", //   0 ft — cyan (matches DEFAULT_SHALLOW)
  "#00c8de", //  50 ft — cyan-teal
  "#00a8d0", // 100 ft — sky blue
  "#0288d1", // 150 ft — ocean blue
  "#0277bd", // 200 ft — medium blue
  "#1565c0", // 250 ft — cobalt blue
  "#0d47a1", // 300 ft — royal blue
  "#1a237e", // 350 ft — indigo navy
  "#283593", // 450 ft — deep navy
  "#1e2b6e", // 600 ft — dark navy
];

/**
 * Normalised t positions for the 10 band lower boundaries (ft / 2000).
 * Kept here to avoid a circular import with colormap.ts.
 */
const BAND_T_VALUES = [0, 50, 100, 150, 200, 250, 300, 350, 450, 600].map(
  (ft) => ft / 2000,
);

/**
 * Curated preset palettes for one-click selection. Each preset defines a
 * shallow and deep endpoint; the fixed interior stops keep the gradient
 * cohesive with the rest of the app.
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

/** A single colour stop on the Custom palette. */
export interface CustomStop {
  /** Position along the depth axis, 0 (shallow) → 1 (deep). */
  position: number;
  /** CSS hex colour, "#rrggbb". */
  hex: string;
}

/**
 * Default custom stops mirror the Default Ocean preset so picking the Custom
 * theme without any further edits looks the same as Ocean.
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
 * Used when the user is in Custom mode and clicks a preset chip — we seed the
 * editable stops with the preset's shape so they can fine-tune from there.
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
 * Build a 10-entry bandColors array for a preset by linearly interpolating
 * from the preset's shallow to deep across the band lower-boundary positions.
 * Used when the user clicks a preset chip so the per-band editor looks correct.
 */
export function bandColorsFromPreset(preset: PalettePreset): string[] {
  return BAND_T_VALUES.map((t) => mixHex(preset.shallow, preset.deep, t));
}

/**
 * Sanitise a raw bandBoundaries value. Must be an array of exactly 11
 * finite integers, strictly increasing, starting at 0 and ending at
 * OCEAN_MAX_DEPTH_FT. Returns null if the input fails any check so callers
 * can fall back to DEFAULT_BAND_BOUNDARIES.
 */
export function sanitizeBandBoundaries(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length !== 11) return null;
  const parsed = (raw as unknown[]).map((v) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v) : NaN,
  );
  if (parsed.some((v) => isNaN(v))) return null;
  if (parsed[0] !== 0 || parsed[10] !== OCEAN_MAX_DEPTH_FT_PALETTE) return null;
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i]! <= parsed[i - 1]!) return null;
  }
  return parsed as number[];
}

/**
 * Sanitise a raw bandColors value: must be an array of exactly 10 valid hex
 * strings. Invalid entries are replaced with the corresponding default colour.
 * Returns null if the input is not an array at all.
 */
export function sanitizeBandColors(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length !== 10) return null;
  return raw.map((entry, i) =>
    typeof entry === "string" && HEX_RE.test(entry)
      ? entry.toLowerCase()
      : DEFAULT_BAND_COLORS[i]!,
  );
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

interface PaletteStore {
  shallow: string;
  deep: string;
  /** Ordered custom-theme stops (min 2). Always sanitised on read. */
  customStops: CustomStop[];
  /**
   * Per-band colours for the Ocean theme. 10 entries indexed to
   * bandBoundaries[0..9] (the lower boundary of each band).
   * bandColors[0] is kept in sync with `shallow`.
   */
  bandColors: string[];
  /**
   * Depth band boundaries in feet. 11 values: first is always 0, last is
   * always OCEAN_MAX_DEPTH_FT (2000). Interior 9 values are user-editable.
   * Persisted alongside bandColors.
   */
  bandBoundaries: number[];
  setShallow: (hex: string) => void;
  setDeep: (hex: string) => void;
  setCustomStops: (stops: CustomStop[]) => void;
  addCustomStop: () => void;
  removeCustomStop: (index: number) => void;
  updateCustomStop: (index: number, patch: Partial<CustomStop>) => void;
  resetCustomStops: () => void;
  /** Set a single band colour by index (0–9). Syncs index 0 → shallow. */
  setBandColor: (index: number, hex: string) => void;
  /** Replace the full bandColors array; falls back to defaults on bad input. */
  setBandColors: (colors: string[]) => void;
  /** Restore all band colours to DEFAULT_BAND_COLORS. */
  resetBandColors: () => void;
  /**
   * Set a single interior boundary by index (1–9) in feet. Clamps the value
   * to [prev + MIN_BOUNDARY_GAP_FT, next - MIN_BOUNDARY_GAP_FT]. No-ops if
   * index is 0 or 10 (the fixed endpoints).
   */
  setBandBoundary: (index: number, ft: number) => void;
  /** Replace the full bandBoundaries array; falls back to defaults on bad input. */
  setBandBoundaries: (boundaries: number[]) => void;
  /** Restore all band boundaries to DEFAULT_BAND_BOUNDARIES. */
  resetBandBoundaries: () => void;
  reset: () => void;
  /**
   * Apply server-side palette values (shallow / deep / customStops) to the
   * store. Values that are missing or malformed are left untouched. Used by
   * the Settings page after a successful GET /api/settings hydration.
   */
  hydrateFromServer: (partial: {
    paletteShallow?: unknown;
    paletteDeep?: unknown;
    customStops?: unknown;
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

export const usePaletteStore = create<PaletteStore>()(
  persist(
    (set, get) => ({
      shallow: DEFAULT_SHALLOW,
      deep: DEFAULT_DEEP,
      customStops: DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s })),
      bandColors: [...DEFAULT_BAND_COLORS],
      bandBoundaries: [...DEFAULT_BAND_BOUNDARIES],

      setShallow: (hex) => {
        const bc = [...get().bandColors];
        bc[0] = hex;
        set({ shallow: hex, bandColors: bc });
      },
      setDeep: (hex) => set({ deep: hex }),
      setCustomStops: (stops) => set({ customStops: normalizeStops(stops) }),
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
        set({ customStops: normalizeStops(next) });
      },
      removeCustomStop: (index) => {
        const stops = get().customStops;
        if (stops.length <= 2) return;
        const next = stops.filter((_, i) => i !== index);
        set({ customStops: normalizeStops(next) });
      },
      updateCustomStop: (index, patch) => {
        const stops = get().customStops;
        if (index < 0 || index >= stops.length) return;
        const next = stops.map((s, i) => (i === index ? { ...s, ...patch } : s));
        set({ customStops: normalizeStops(next) });
      },
      resetCustomStops: () =>
        set({ customStops: DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s })) }),

      setBandColor: (index, hex) => {
        if (index < 0 || index >= 10) return;
        if (!HEX_RE.test(hex)) return;
        const bc = [...get().bandColors];
        bc[index] = hex.toLowerCase();
        const patch: Partial<PaletteStore> = { bandColors: bc };
        if (index === 0) patch.shallow = hex.toLowerCase();
        set(patch);
      },
      setBandColors: (colors) => {
        const sanitized = sanitizeBandColors(colors) ?? [...DEFAULT_BAND_COLORS];
        set({ bandColors: sanitized, shallow: sanitized[0]! });
      },
      resetBandColors: () =>
        set({ bandColors: [...DEFAULT_BAND_COLORS], shallow: DEFAULT_BAND_COLORS[0]! }),

      setBandBoundary: (index, ft) => {
        if (index < 1 || index > 9) return;
        const bb = [...get().bandBoundaries];
        const prev = bb[index - 1]!;
        const next = bb[index + 1]!;
        const clamped = Math.max(
          prev + MIN_BOUNDARY_GAP_FT,
          Math.min(next - MIN_BOUNDARY_GAP_FT, Math.round(ft)),
        );
        bb[index] = clamped;
        set({ bandBoundaries: bb });
      },
      setBandBoundaries: (boundaries) => {
        const sanitized = sanitizeBandBoundaries(boundaries) ?? [...DEFAULT_BAND_BOUNDARIES];
        set({ bandBoundaries: sanitized });
      },
      resetBandBoundaries: () =>
        set({ bandBoundaries: [...DEFAULT_BAND_BOUNDARIES] }),

      reset: () =>
        set({
          shallow: DEFAULT_SHALLOW,
          deep: DEFAULT_DEEP,
          customStops: DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s })),
          bandColors: [...DEFAULT_BAND_COLORS],
          bandBoundaries: [...DEFAULT_BAND_BOUNDARIES],
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
        if (Object.keys(patch).length > 0) set(patch);
      },
    }),
    {
      name: "bathyscan:palette",
      merge: (persistedState, currentState) => {
        const ps = persistedState as Record<string, unknown> | undefined;
        const merged = { ...currentState, ...(ps as object) };
        const cleanedStops = sanitizeCustomStops(ps?.customStops);
        let cleanedBands = sanitizeBandColors(ps?.bandColors);
        // Migration guard: old persisted state has shallow/deep but no bandColors
        // (written before this feature landed). Seed bandColors[0] from the
        // persisted shallow so the rendered top stop immediately matches the
        // value the user previously configured, rather than defaulting.
        if (!cleanedBands) {
          cleanedBands = [...DEFAULT_BAND_COLORS];
          if (typeof ps?.shallow === "string" && HEX_RE.test(ps.shallow)) {
            cleanedBands[0] = ps.shallow.toLowerCase();
          }
        }
        const cleanedBoundaries = sanitizeBandBoundaries(ps?.bandBoundaries) ?? [...DEFAULT_BAND_BOUNDARIES];
        return {
          ...merged,
          customStops: cleanedStops ?? DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s })),
          bandColors: cleanedBands,
          bandBoundaries: cleanedBoundaries,
        } as PaletteStore;
      },
    },
  ),
);

/** Mix two hex colours in RGB space and return a "#rrggbb" string. */
function mixHex(a: string, b: string, alpha: number): string {
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
