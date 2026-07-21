/**
 * markerConstants — the marker symbol library.
 *
 * Four browsable sections (Freshwater, Saltwater, Natural World, Mariner)
 * plus an always-available Special section (Fish / Custom / Depth Pole) and a
 * Legacy section that keeps every previously-shipped type value valid so old
 * saved markers still resolve a label, colour, and icon.
 *
 * SVG icons live in markerIcons.tsx keyed by `value`; the `icon` glyph field
 * is retained only as a text fallback for contexts where SVG cannot render
 * yet (e.g. the 3D sprite before its icon texture finishes loading).
 */
export type MarkerCategory =
  | "freshwater"
  | "saltwater"
  | "natural"
  | "mariner"
  | "special"
  | "legacy";

export const MARKER_CATEGORY_LABELS: Record<MarkerCategory, string> = {
  freshwater: "FRESHWATER",
  saltwater:  "SALTWATER",
  natural:    "NATURAL WORLD",
  mariner:    "MARINER",
  special:    "SPECIAL",
  legacy:     "LEGACY",
};

export interface MarkerTypeDef {
  value: string;
  label: string;
  color: string;
  /** Text glyph fallback only — SVG icons in markerIcons.tsx are the primary art. */
  icon: string;
  category: MarkerCategory;
}

/** Freshwater species — shown only in freshwater exploration mode. */
export const FRESHWATER_MARKER_TYPES = [
  { value: "crappie",       label: "Crappie",        color: "#a8a29e", icon: "◐", category: "freshwater" },
  { value: "catfish",       label: "Catfish",        color: "#78716c", icon: "◆", category: "freshwater" },
  { value: "bass",          label: "Bass",           color: "#65a30d", icon: "◈", category: "freshwater" },
  { value: "sand_bass",     label: "Sand Bass",      color: "#d6b26e", icon: "◈", category: "freshwater" },
  { value: "lake_trout",    label: "Lake Trout",     color: "#38bdf8", icon: "◈", category: "freshwater" },
  { value: "pike",          label: "Pike",           color: "#15803d", icon: "◈", category: "freshwater" },
  { value: "walleye",       label: "Walleye",        color: "#facc15", icon: "◈", category: "freshwater" },
  { value: "perch",         label: "Perch",          color: "#eab308", icon: "◓", category: "freshwater" },
  { value: "rainbow_trout", label: "Rainbow Trout",  color: "#f472b6", icon: "◈", category: "freshwater" },
  { value: "salmon",        label: "Salmon",         color: "#fb923c", icon: "◈", category: "freshwater" },
] as const;

/** Saltwater species — shown only in saltwater exploration mode. */
export const SALTWATER_MARKER_TYPES = [
  { value: "silver_salmon",      label: "Silver Salmon",       color: "#cbd5e1", icon: "◈", category: "saltwater" },
  { value: "chinook_salmon",     label: "Chinook Salmon",      color: "#f97316", icon: "◈", category: "saltwater" },
  { value: "pink_salmon",        label: "Pink Salmon",         color: "#f9a8d4", icon: "◈", category: "saltwater" },
  { value: "halibut",            label: "Pacific Halibut",     color: "#38bdf8", icon: "◈", category: "saltwater" },
  { value: "turbot",             label: "Turbot",              color: "#a78bfa", icon: "◈", category: "saltwater" },
  { value: "black_rockfish",     label: "Black Rockfish",      color: "#64748b", icon: "◆", category: "saltwater" },
  { value: "yelloweye_rockfish", label: "Yellow-eyed Rockfish",color: "#fbbf24", icon: "◆", category: "saltwater" },
  { value: "cod",                label: "Cod",                 color: "#4ade80", icon: "◐", category: "saltwater" },
  { value: "dog_shark",          label: "Dog Shark",           color: "#94a3b8", icon: "◈", category: "saltwater" },
  { value: "dungeness_crab",     label: "Dungeness Crab",      color: "#dc2626", icon: "✶", category: "saltwater" },
  { value: "prawn_shrimp",       label: "Prawn / Shrimp",      color: "#f87171", icon: "✶", category: "saltwater" },
  { value: "octopus",            label: "Octopus",             color: "#a855f7", icon: "✶", category: "saltwater" },
  { value: "school_salmon",      label: "Salmon (School)",     color: "#fdba74", icon: "≋", category: "saltwater" },
  { value: "school_rockfish",    label: "Rockfish (School)",   color: "#93a6bd", icon: "≋", category: "saltwater" },
  { value: "lingcod",            label: "Lingcod",             color: "#16a34a", icon: "◈", category: "saltwater" },
  { value: "sole",               label: "Sole",                color: "#d4a373", icon: "◈", category: "saltwater" },
] as const;

/** Natural-world features — always available in both exploration modes. */
export const NATURAL_WORLD_MARKER_TYPES = [
  { value: "log",            label: "Log",            color: "#a16207", icon: "⁂", category: "natural" },
  { value: "multiple_logs",  label: "Multiple Logs",  color: "#854d0e", icon: "⁂", category: "natural" },
  { value: "multiple_fish",  label: "Multiple Fish",  color: "#22c55e", icon: "≋", category: "natural" },
  { value: "vegetation",     label: "Vegetation",     color: "#6ee7b7", icon: "❋", category: "natural" },
  { value: "submerged_rock", label: "Submerged Rock", color: "#9ca3af", icon: "◮", category: "natural" },
  { value: "land",           label: "Land",           color: "#84cc16", icon: "▲", category: "natural" },
  { value: "red_light",      label: "Red Light",      color: "#ef4444", icon: "◉", category: "natural" },
  { value: "green_light",    label: "Green Light",    color: "#22c55e", icon: "◉", category: "natural" },
  { value: "red_buoy",       label: "Red Buoy",       color: "#f87171", icon: "▲", category: "natural" },
  { value: "green_buoy",     label: "Green Buoy",     color: "#4ade80", icon: "■", category: "natural" },
  { value: "rock",           label: "Rock",           color: "#a8a29e", icon: "◮", category: "natural" },
  { value: "clam",           label: "Clam",           color: "#fda4af", icon: "◗", category: "natural" },
  { value: "clam_beach",     label: "Clam Beach",     color: "#fecdd3", icon: "◗", category: "natural" },
  { value: "cool_rocks",     label: "Cool Rocks",     color: "#c084fc", icon: "◮", category: "natural" },
  { value: "rock_beach",     label: "Rock Beach",     color: "#d6d3d1", icon: "◮", category: "natural" },
] as const;

/** Standard mariner symbols — always available in both exploration modes. */
export const MARINER_MARKER_TYPES = [
  { value: "anchorage",      label: "Anchorage",      color: "#38bdf8", icon: "⚓", category: "mariner" },
  { value: "shipwreck",      label: "Shipwreck",      color: "#f97316", icon: "⚓", category: "mariner" },
  { value: "hazard_rock",    label: "Hazard Rock",    color: "#ef4444", icon: "⚠", category: "mariner" },
  { value: "marina",         label: "Harbor / Marina",color: "#22d3ee", icon: "⛵", category: "mariner" },
  { value: "boat_ramp",      label: "Boat Ramp",      color: "#94a3b8", icon: "◢", category: "mariner" },
  { value: "fuel_dock",      label: "Fuel Dock",      color: "#fbbf24", icon: "⛽", category: "mariner" },
  { value: "diver_down",     label: "Diver Down",     color: "#f43f5e", icon: "⚑", category: "mariner" },
  { value: "no_anchor",      label: "No Anchor",      color: "#f87171", icon: "⊘", category: "mariner" },
  { value: "channel_marker", label: "Channel Marker", color: "#4ade80", icon: "◇", category: "mariner" },
  { value: "daymark",        label: "Daymark",        color: "#facc15", icon: "△", category: "mariner" },
] as const;

/** Always-available basics. */
export const SPECIAL_MARKER_TYPES = [
  { value: "fish",       label: "Fish",       color: "#22c55e", icon: "◈", category: "special" },
  { value: "custom",     label: "Custom",     color: "#e2e8f0", icon: "●", category: "special" },
  { value: "depth_pole", label: "Depth Pole", color: "#00ffee", icon: "📡", category: "special" },
] as const;

/**
 * Legacy types — no longer offered in the picker but kept fully valid so
 * existing saved markers keep their label, colour, and icon.
 */
export const LEGACY_MARKER_TYPES = [
  { value: "coral",            label: "Coral",            color: "#f472b6", icon: "❊", category: "legacy" },
  { value: "vent",             label: "Hydrothermal",     color: "#ef4444", icon: "♨", category: "legacy" },
  { value: "sample",           label: "Water Sample",     color: "#93c5fd", icon: "◉", category: "legacy" },
  { value: "trout",            label: "Trout",            color: "#22d3ee", icon: "◈", category: "legacy" },
  { value: "crayfish",         label: "Crayfish",         color: "#dc2626", icon: "◈", category: "legacy" },
  { value: "tuna",             label: "Tuna",             color: "#0ea5e9", icon: "🐠", category: "legacy" },
  { value: "shark",            label: "Shark",            color: "#64748b", icon: "🦈", category: "legacy" },
  { value: "swordfish",        label: "Swordfish",        color: "#2563eb", icon: "⚔", category: "legacy" },
  { value: "rockfish",         label: "Rockfish",         color: "#16a34a", icon: "◆", category: "legacy" },
  { value: "mahi_mahi",        label: "Mahi-Mahi",        color: "#22d3ee", icon: "◑", category: "legacy" },
  { value: "grouper",          label: "Grouper",          color: "#15803d", icon: "⬡", category: "legacy" },
  { value: "snapper",          label: "Snapper",          color: "#86efac", icon: "◒", category: "legacy" },
  { value: "crab",             label: "Crab",             color: "#dc2626", icon: "🦀", category: "legacy" },
  { value: "lobster",          label: "Lobster",          color: "#ef4444", icon: "🦞", category: "legacy" },
  { value: "shrimp",           label: "Shrimp",           color: "#f87171", icon: "🦐", category: "legacy" },
  { value: "krill",            label: "Krill",            color: "#fca5a5", icon: "⬡", category: "legacy" },
  { value: "jellyfish",        label: "Jellyfish",        color: "#c084fc", icon: "✿", category: "legacy" },
  { value: "squid",            label: "Squid",            color: "#7c3aed", icon: "🦑", category: "legacy" },
  { value: "sea_urchin",       label: "Sea Urchin",       color: "#9333ea", icon: "✳", category: "legacy" },
  { value: "starfish",         label: "Starfish",         color: "#e879f9", icon: "✦", category: "legacy" },
  { value: "sea_turtle",       label: "Sea Turtle",       color: "#059669", icon: "🐢", category: "legacy" },
  { value: "school_herring",   label: "School·Herring",   color: "#94a3b8", icon: "≋", category: "legacy" },
  { value: "school_sardine",   label: "School·Sardine",   color: "#a8b4c0", icon: "≡", category: "legacy" },
  { value: "school_mackerel",  label: "School·Mackerel",  color: "#b8c4cc", icon: "∷", category: "legacy" },
  { value: "school_tuna",      label: "School·Tuna",      color: "#7f8fa6", icon: "⋯", category: "legacy" },
  { value: "school_anchovy",   label: "School·Anchovy",   color: "#8e9db0", icon: "⁝", category: "legacy" },
  { value: "bluegill",         label: "Bluegill",         color: "#3b82f6", icon: "◑", category: "legacy" },
  { value: "sunfish",          label: "Sunfish",          color: "#f59e0b", icon: "☀", category: "legacy" },
  { value: "carp",             label: "Carp",             color: "#92400e", icon: "◒", category: "legacy" },
  { value: "yellow_perch",     label: "Yellow Perch",     color: "#eab308", icon: "◓", category: "legacy" },
  { value: "muskie",           label: "Muskie",           color: "#16a34a", icon: "⬡", category: "legacy" },
  { value: "largemouth_bass",  label: "Lrg. Mouth Bass",  color: "#166534", icon: "◈", category: "legacy" },
  { value: "smallmouth_bass",  label: "Sml. Mouth Bass",  color: "#14532d", icon: "◉", category: "legacy" },
  { value: "channel_catfish",  label: "Ch. Catfish",      color: "#57534e", icon: "◆", category: "legacy" },
  { value: "freshwater_shrimp",label: "FW Shrimp",        color: "#f87171", icon: "🦐", category: "legacy" },
  { value: "freshwater_crab",  label: "FW Crab",          color: "#b91c1c", icon: "🦀", category: "legacy" },
  { value: "snapping_turtle",  label: "Snapping Turtle",  color: "#4d7c0f", icon: "🐢", category: "legacy" },
  { value: "bullfrog",         label: "Bullfrog",         color: "#65a30d", icon: "🐸", category: "legacy" },
  { value: "beaver_dam",       label: "Beaver Dam",       color: "#92400e", icon: "⬡", category: "legacy" },
  { value: "lily_pad",         label: "Lily Pad",         color: "#86efac", icon: "❧", category: "legacy" },
  { value: "cattail",          label: "Cattail",          color: "#a3e635", icon: "⁋", category: "legacy" },
  { value: "reed_bed",         label: "Reed Bed",         color: "#84cc16", icon: "⁌", category: "legacy" },
  { value: "submerged_grass",  label: "Subm. Grass",      color: "#4ade80", icon: "❋", category: "legacy" },
  { value: "spring",           label: "Spring",           color: "#7dd3fc", icon: "◉", category: "legacy" },
  { value: "school_perch",     label: "School·Perch",     color: "#94a3b8", icon: "≋", category: "legacy" },
  { value: "school_bluegill",  label: "School·Bluegill",  color: "#a8b4c0", icon: "≡", category: "legacy" },
  { value: "school_bass",      label: "School·Bass",      color: "#b8c4cc", icon: "∷", category: "legacy" },
  { value: "school_crappie",   label: "School·Crappie",   color: "#7f8fa6", icon: "⋯", category: "legacy" },
  { value: "school_carp",      label: "School·Carp",      color: "#8e9db0", icon: "⁝", category: "legacy" },
] as const;

/** Every known marker type across all sections (picker + legacy). */
export const MARKER_TYPES = [
  ...FRESHWATER_MARKER_TYPES,
  ...SALTWATER_MARKER_TYPES,
  ...NATURAL_WORLD_MARKER_TYPES,
  ...MARINER_MARKER_TYPES,
  ...SPECIAL_MARKER_TYPES,
  ...LEGACY_MARKER_TYPES,
];

export const DEPTH_POLE_DEFAULT_COLOUR = "#00ffee";

export type FreshwaterMarkerTypeValue = typeof FRESHWATER_MARKER_TYPES[number]["value"];
export type SaltwaterMarkerTypeValue = typeof SALTWATER_MARKER_TYPES[number]["value"];
export type MarkerTypeValue = (typeof MARKER_TYPES)[number]["value"];

export const MARKER_COLOR: Record<string, string> = Object.fromEntries(
  MARKER_TYPES.map((t) => [t.value, t.color]),
);

export const MARKER_ICON: Record<string, string> = Object.fromEntries(
  MARKER_TYPES.map((t) => [t.value, t.icon]),
);

export interface MarkerPickerSection {
  category: MarkerCategory;
  label: string;
  types: ReadonlyArray<MarkerTypeDef>;
}

/**
 * The picker/browse sections for a given exploration mode. Natural World,
 * Mariner, and Special are always present; the species section switches
 * with the water type.
 */
export function getMarkerPickerSections(
  waterType: "freshwater" | "saltwater",
): MarkerPickerSection[] {
  const species: MarkerPickerSection =
    waterType === "freshwater"
      ? { category: "freshwater", label: MARKER_CATEGORY_LABELS.freshwater, types: FRESHWATER_MARKER_TYPES }
      : { category: "saltwater", label: MARKER_CATEGORY_LABELS.saltwater, types: SALTWATER_MARKER_TYPES };
  return [
    species,
    { category: "natural", label: MARKER_CATEGORY_LABELS.natural, types: NATURAL_WORLD_MARKER_TYPES },
    { category: "mariner", label: MARKER_CATEGORY_LABELS.mariner, types: MARINER_MARKER_TYPES },
    { category: "special", label: MARKER_CATEGORY_LABELS.special, types: SPECIAL_MARKER_TYPES },
  ];
}

/** Flat list of all types selectable in a given mode (species + always-on sections). */
export function getSelectableMarkerTypes(
  waterType: "freshwater" | "saltwater",
): MarkerTypeDef[] {
  return getMarkerPickerSections(waterType).flatMap((s) => [...s.types]);
}
