/**
 * zoneOverlayStore — per-slot zone colour and visibility state,
 * stored independently for saltwater and freshwater environments.
 *
 * Holds a hex colour string and a `visible` boolean for each of the four
 * terrain texture slots (0=sand, 1=sediment, 2=silt, 3=basalt).  Two
 * independent four-slot palettes are maintained — one for saltwater sessions
 * and one for freshwater sessions — so customising colours for a lake map
 * does not affect the seafloor palette, and vice versa.
 *
 * ## Active set selection
 *
 * The active water type is tracked as `activeWaterType` in the store.
 * Consumers that know the current water type (ZoneOverlay, Settings) sync
 * this via `setActiveWaterType(wt)`.  The `slots` field always mirrors the
 * active set, so components that only read `slots` require no changes.
 *
 * ## localStorage
 *
 * Each set is persisted under its own key:
 *   bathyscan:zoneOverlaySlots:saltwater
 *   bathyscan:zoneOverlaySlots:freshwater
 *
 * On first load the legacy flat key `bathyscan:zoneOverlaySlots` is migrated
 * to the saltwater key and then removed, so existing user palettes are not
 * lost.
 *
 * ## Design decision: per-water-type palettes (not per-dataset)
 *
 * Colours are scoped to water type, not to individual datasets.  A user's
 * "sandy freshwater bottom should be light green" preference applies to every
 * lake dataset, just as colour-blind accessibility palettes should not reset
 * each time they switch maps within the same environment.  Per-dataset
 * palettes would require a keyed Record<datasetId, ZoneSlot[]> schema — the
 * migration path is straightforward if that requirement ever emerges.
 */
import { create } from "zustand";
import { ZONE_DEFAULT_COLORS } from "./zoneDefaultColors";

export { ZONE_DEFAULT_COLORS };

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

const LS_KEY_SALTWATER = "bathyscan:zoneOverlaySlots:saltwater";
const LS_KEY_FRESHWATER = "bathyscan:zoneOverlaySlots:freshwater";
/** Legacy key written by earlier versions — migrated to saltwater on first load. */
const LS_KEY_LEGACY = "bathyscan:zoneOverlaySlots";

function buildDefaultSlots(): [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot] {
  return DEFAULT_SLOTS.map((s) => ({ ...s })) as [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];
}

function parseSlots(raw: string | null): [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 4) return null;
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
    return null;
  }
}

function loadSlots(key: string): [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot] {
  try {
    return parseSlots(localStorage.getItem(key)) ?? buildDefaultSlots();
  } catch {
    return buildDefaultSlots();
  }
}

function saveSlots(
  slots: [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot],
  waterType: "saltwater" | "freshwater",
): void {
  try {
    const key = waterType === "freshwater" ? LS_KEY_FRESHWATER : LS_KEY_SALTWATER;
    localStorage.setItem(key, JSON.stringify(slots));
  } catch (err) {
    console.warn("[zone-overlay] Failed to persist zone slots to localStorage — continuing", err);
  }
}

/** One-time migration: if the legacy flat key exists, copy it to saltwater and delete it. */
function migrateLegacyKey(): void {
  try {
    const legacy = localStorage.getItem(LS_KEY_LEGACY);
    if (!legacy) return;
    // Only migrate if the saltwater key does not yet exist
    if (!localStorage.getItem(LS_KEY_SALTWATER)) {
      localStorage.setItem(LS_KEY_SALTWATER, legacy);
    }
    localStorage.removeItem(LS_KEY_LEGACY);
  } catch (err) {
    console.warn("[zone-overlay] Failed to migrate legacy zone overlay key — continuing", err);
  }
}

// Run migration once at module load time
migrateLegacyKey();

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ZoneOverlayStore {
  /** Slots for saltwater sessions. */
  saltwater: [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];
  /** Slots for freshwater sessions. */
  freshwater: [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];
  /** Currently active water type — determines which set `slots` mirrors. */
  activeWaterType: "saltwater" | "freshwater";
  /**
   * Convenience mirror of the active set (`state[state.activeWaterType]`).
   * Always kept in sync; read-only by convention — mutate via the actions below.
   */
  slots: [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];

  /** Switch the active palette.  Immediately updates `slots`. */
  setActiveWaterType: (waterType: "saltwater" | "freshwater") => void;
  /** Set the colour of a slot in the active palette. */
  setSlotColor: (index: 0 | 1 | 2 | 3, color: string) => void;
  /** Toggle visibility of a slot in the active palette. */
  setSlotVisible: (index: 0 | 1 | 2 | 3, visible: boolean) => void;
  /** Reset the active palette to its defaults. */
  resetToDefaults: () => void;
  /** Hydrate from server-persisted data (accepts new or legacy format). */
  hydrateFromServer: (data: unknown) => void;
}

export const useZoneOverlayStore = create<ZoneOverlayStore>((set, get) => {
  const sw = loadSlots(LS_KEY_SALTWATER);
  const fw = loadSlots(LS_KEY_FRESHWATER);

  return {
    saltwater: sw,
    freshwater: fw,
    activeWaterType: "saltwater",
    slots: sw,

    setActiveWaterType: (waterType) =>
      set((state) => ({
        activeWaterType: waterType,
        slots: state[waterType],
      })),

    setSlotColor: (index, color) =>
      set((state) => {
        const wt = state.activeWaterType;
        const next = state[wt].map((s, i) =>
          i === index ? { ...s, color } : { ...s },
        ) as [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];
        saveSlots(next, wt);
        return { [wt]: next, slots: next };
      }),

    setSlotVisible: (index, visible) =>
      set((state) => {
        const wt = state.activeWaterType;
        const next = state[wt].map((s, i) =>
          i === index ? { ...s, visible } : { ...s },
        ) as [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];
        saveSlots(next, wt);
        return { [wt]: next, slots: next };
      }),

    resetToDefaults: () => {
      const wt = get().activeWaterType;
      const next = buildDefaultSlots();
      saveSlots(next, wt);
      set({ [wt]: next, slots: next });
    },

    hydrateFromServer: (raw: unknown) => {
      // New format: { saltwater: [...], freshwater: [...] }
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const record = raw as Record<string, unknown>;
        const state = get();

        const parseSlotsFromRaw = (
          arr: unknown,
          current: [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot],
        ): [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot] => {
          if (!Array.isArray(arr) || arr.length !== 4) return current;
          return arr.map((item: unknown, i: number) => {
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
        };

        const nextSw = parseSlotsFromRaw(record["saltwater"], state.saltwater);
        const nextFw = parseSlotsFromRaw(record["freshwater"], state.freshwater);

        saveSlots(nextSw, "saltwater");
        saveSlots(nextFw, "freshwater");

        const wt = state.activeWaterType;
        set({
          saltwater: nextSw,
          freshwater: nextFw,
          slots: wt === "freshwater" ? nextFw : nextSw,
        });
        return;
      }

      // Legacy format: flat 4-element array — treat as saltwater (backward compat)
      if (Array.isArray(raw) && raw.length === 4) {
        const current = get().saltwater;
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
        saveSlots(next, "saltwater");
        const wt = get().activeWaterType;
        set({
          saltwater: next,
          slots: wt === "saltwater" ? next : get().slots,
        });
      }
    },
  };
});

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
