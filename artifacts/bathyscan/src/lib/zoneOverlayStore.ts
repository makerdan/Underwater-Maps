/**
 * zoneOverlayStore — per-slot zone colour and visibility state.
 *
 * Holds a hex colour string and a `visible` boolean for each of the four
 * terrain texture slots (0=sand, 1=sediment, 2=silt, 3=basalt).  Defaults
 * match the pastel tints baked into terrainShader.ts.  State is persisted to
 * localStorage so user choices survive a page refresh.
 */
import { create } from "zustand";

/** Pastel hex defaults matching terrainShader.ts ZONE_TINT_COLORS */
export const ZONE_DEFAULT_COLORS: readonly [string, string, string, string] = [
  "#f5d58a", // slot 0 — sand      (warm yellow)
  "#c49a6c", // slot 1 — sediment  (earthy amber)
  "#8ab4d0", // slot 2 — silt      (cool blue-grey)
  "#b06060", // slot 3 — basalt    (muted terracotta)
];

export interface ZoneSlot {
  color: string;
  visible: boolean;
}

const DEFAULT_SLOTS: readonly ZoneSlot[] = ZONE_DEFAULT_COLORS.map((color) => ({
  color,
  visible: true,
}));

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_KEY = "bathyscan:zoneOverlaySlots";

function loadSlots(): [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return buildDefaultSlots();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 4) return buildDefaultSlots();
    return parsed.map((item, i) => {
      const def = DEFAULT_SLOTS[i]!;
      const color =
        typeof (item as Record<string, unknown>)["color"] === "string"
          ? (item as Record<string, unknown>)["color"] as string
          : def.color;
      const visible =
        typeof (item as Record<string, unknown>)["visible"] === "boolean"
          ? (item as Record<string, unknown>)["visible"] as boolean
          : def.visible;
      return { color, visible };
    }) as [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];
  } catch {
    return buildDefaultSlots();
  }
}

function buildDefaultSlots(): [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot] {
  return DEFAULT_SLOTS.map((s) => ({ ...s })) as [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];
}

function saveSlots(slots: [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(slots));
  } catch {}
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ZoneOverlayStore {
  slots: [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];
  setSlotColor: (index: 0 | 1 | 2 | 3, color: string) => void;
  setSlotVisible: (index: 0 | 1 | 2 | 3, visible: boolean) => void;
  resetToDefaults: () => void;
  hydrateFromServer: (slots: unknown) => void;
}

export const useZoneOverlayStore = create<ZoneOverlayStore>((set) => ({
  slots: loadSlots(),

  setSlotColor: (index, color) =>
    set((state) => {
      const next = state.slots.map((s, i) =>
        i === index ? { ...s, color } : { ...s },
      ) as [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];
      saveSlots(next);
      return { slots: next };
    }),

  setSlotVisible: (index, visible) =>
    set((state) => {
      const next = state.slots.map((s, i) =>
        i === index ? { ...s, visible } : { ...s },
      ) as [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];
      saveSlots(next);
      return { slots: next };
    }),

  resetToDefaults: () => {
    const next = buildDefaultSlots();
    saveSlots(next);
    return set({ slots: next });
  },

  hydrateFromServer: (raw: unknown) => {
    if (!Array.isArray(raw) || raw.length !== 4) return;
    const current = useZoneOverlayStore.getState().slots;
    const next = raw.map((item: unknown, i: number) => {
      const def = current[i]!;
      const color =
        typeof (item as Record<string, unknown>)["color"] === "string" &&
        /^#[0-9a-fA-F]{6}$/i.test((item as Record<string, unknown>)["color"] as string)
          ? ((item as Record<string, unknown>)["color"] as string)
          : def.color;
      const visible =
        typeof (item as Record<string, unknown>)["visible"] === "boolean"
          ? ((item as Record<string, unknown>)["visible"] as boolean)
          : def.visible;
      return { color, visible };
    }) as [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];
    saveSlots(next);
    set({ slots: next });
  },
}));

// ---------------------------------------------------------------------------
// Substrate class → slot mapping (best-effort for CMECS / ShoreZone labels)
// ---------------------------------------------------------------------------

/**
 * Maps a free-form substrate class string to the nearest of the four terrain
 * texture slots (0=sand, 1=sediment, 2=silt, 3=basalt).
 */
export function substrateClassToSlot(substrate: string): 0 | 1 | 2 | 3 {
  const s = substrate.toLowerCase();
  if (
    s.includes("sand") ||
    s.includes("reef") ||
    s.includes("coral") ||
    s.includes("shell") ||
    s.includes("veg") ||
    s.includes("aquatic")
  )
    return 0;
  if (
    s.includes("grav") ||
    s.includes("coarse") ||
    s.includes("cobble") ||
    s.includes("sediment") ||
    s.includes("wood") ||
    s.includes("ramp")
  )
    return 1;
  if (
    s.includes("silt") ||
    s.includes("mud") ||
    s.includes("clay") ||
    s.includes("soft") ||
    s.includes("flat")
  )
    return 2;
  if (
    s.includes("rock") ||
    s.includes("basalt") ||
    s.includes("bedrock") ||
    s.includes("hard") ||
    s.includes("boulder") ||
    s.includes("stone") ||
    s.includes("volcanic")
  )
    return 3;
  return 0;
}
