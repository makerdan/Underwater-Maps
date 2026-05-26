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
  setShallow: (hex: string) => void;
  setDeep: (hex: string) => void;
  setCustomStops: (stops: CustomStop[]) => void;
  addCustomStop: () => void;
  removeCustomStop: (index: number) => void;
  updateCustomStop: (index: number, patch: Partial<CustomStop>) => void;
  resetCustomStops: () => void;
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
      setShallow: (hex) => set({ shallow: hex }),
      setDeep: (hex) => set({ deep: hex }),
      setCustomStops: (stops) => set({ customStops: normalizeStops(stops) }),
      addCustomStop: () => {
        const stops = get().customStops;
        // Insert a new stop at the largest gap, coloured as the midpoint of
        // the surrounding two stops so the gradient stays smooth.
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
      reset: () =>
        set({
          shallow: DEFAULT_SHALLOW,
          deep: DEFAULT_DEEP,
          customStops: DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s })),
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
      // Guard against malformed persisted state (older app versions, manual
      // edits, partial writes). Bad customStops fall back to defaults.
      merge: (persistedState, currentState) => {
        const merged = { ...currentState, ...(persistedState as object) };
        const cleaned = sanitizeCustomStops(
          (persistedState as { customStops?: unknown } | undefined)?.customStops,
        );
        return {
          ...merged,
          customStops: cleaned ?? DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s })),
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
