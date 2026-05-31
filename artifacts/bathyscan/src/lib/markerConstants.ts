export type MarkerCategory =
  | "fish"
  | "crustaceans"
  | "schools"
  | "other"
  | "features"
  | "special";

export const MARKER_CATEGORY_LABELS: Record<MarkerCategory, string> = {
  fish:       "FISH",
  crustaceans:"CRUSTACEANS",
  schools:    "SCHOOLS",
  other:      "OTHER",
  features:   "FEATURES",
  special:    "SPECIAL",
};

export const SALTWATER_MARKER_TYPES = [
  // ── Fish ────────────────────────────────────────────────────────────────
  { value: "fish",          label: "Fish",            color: "#22c55e", icon: "◈",  waterType: "saltwater" as const, category: "fish"        as MarkerCategory },
  { value: "salmon",        label: "Salmon",          color: "#fb923c", icon: "🐟", waterType: "saltwater" as const, category: "fish"        as MarkerCategory },
  { value: "tuna",          label: "Tuna",            color: "#0ea5e9", icon: "🐠", waterType: "saltwater" as const, category: "fish"        as MarkerCategory },
  { value: "halibut",       label: "Halibut",         color: "#38bdf8", icon: "🐡", waterType: "saltwater" as const, category: "fish"        as MarkerCategory },
  { value: "shark",         label: "Shark",           color: "#64748b", icon: "🦈", waterType: "saltwater" as const, category: "fish"        as MarkerCategory },
  { value: "swordfish",     label: "Swordfish",       color: "#2563eb", icon: "⚔",  waterType: "saltwater" as const, category: "fish"        as MarkerCategory },
  { value: "rockfish",      label: "Rockfish",        color: "#16a34a", icon: "◆",  waterType: "saltwater" as const, category: "fish"        as MarkerCategory },
  { value: "cod",           label: "Cod",             color: "#4ade80", icon: "◐",  waterType: "saltwater" as const, category: "fish"        as MarkerCategory },
  { value: "mahi_mahi",     label: "Mahi-Mahi",       color: "#22d3ee", icon: "◑",  waterType: "saltwater" as const, category: "fish"        as MarkerCategory },
  { value: "grouper",       label: "Grouper",         color: "#15803d", icon: "⬡",  waterType: "saltwater" as const, category: "fish"        as MarkerCategory },
  { value: "snapper",       label: "Snapper",         color: "#86efac", icon: "◒",  waterType: "saltwater" as const, category: "fish"        as MarkerCategory },
  // ── Crustaceans ─────────────────────────────────────────────────────────
  { value: "crab",          label: "Crab",            color: "#dc2626", icon: "🦀", waterType: "saltwater" as const, category: "crustaceans" as MarkerCategory },
  { value: "lobster",       label: "Lobster",         color: "#ef4444", icon: "🦞", waterType: "saltwater" as const, category: "crustaceans" as MarkerCategory },
  { value: "shrimp",        label: "Shrimp",          color: "#f87171", icon: "🦐", waterType: "saltwater" as const, category: "crustaceans" as MarkerCategory },
  { value: "krill",         label: "Krill",           color: "#fca5a5", icon: "⬡",  waterType: "saltwater" as const, category: "crustaceans" as MarkerCategory },
  // ── Schools ─────────────────────────────────────────────────────────────
  { value: "school_herring",  label: "School·Herring",  color: "#94a3b8", icon: "≋",  waterType: "saltwater" as const, category: "schools"     as MarkerCategory },
  { value: "school_sardine",  label: "School·Sardine",  color: "#a8b4c0", icon: "≡",  waterType: "saltwater" as const, category: "schools"     as MarkerCategory },
  { value: "school_mackerel", label: "School·Mackerel", color: "#b8c4cc", icon: "∷",  waterType: "saltwater" as const, category: "schools"     as MarkerCategory },
  { value: "school_tuna",     label: "School·Tuna",     color: "#7f8fa6", icon: "⋯",  waterType: "saltwater" as const, category: "schools"     as MarkerCategory },
  { value: "school_anchovy",  label: "School·Anchovy",  color: "#8e9db0", icon: "⁝",  waterType: "saltwater" as const, category: "schools"     as MarkerCategory },
  // ── Other ────────────────────────────────────────────────────────────────
  { value: "coral",         label: "Coral",           color: "#f472b6", icon: "❊",  waterType: "saltwater" as const, category: "other"       as MarkerCategory },
  { value: "vent",          label: "Hydrothermal",    color: "#ef4444", icon: "♨",  waterType: "saltwater" as const, category: "other"       as MarkerCategory },
  { value: "jellyfish",     label: "Jellyfish",       color: "#c084fc", icon: "✿",  waterType: "saltwater" as const, category: "other"       as MarkerCategory },
  { value: "octopus",       label: "Octopus",         color: "#a855f7", icon: "🐙", waterType: "saltwater" as const, category: "other"       as MarkerCategory },
  { value: "squid",         label: "Squid",           color: "#7c3aed", icon: "🦑", waterType: "saltwater" as const, category: "other"       as MarkerCategory },
  { value: "sea_urchin",    label: "Sea Urchin",      color: "#9333ea", icon: "✳",  waterType: "saltwater" as const, category: "other"       as MarkerCategory },
  { value: "starfish",      label: "Starfish",        color: "#e879f9", icon: "✦",  waterType: "saltwater" as const, category: "other"       as MarkerCategory },
  { value: "sea_turtle",    label: "Sea Turtle",      color: "#059669", icon: "🐢", waterType: "saltwater" as const, category: "other"       as MarkerCategory },
  // ── Special ──────────────────────────────────────────────────────────────
  { value: "shipwreck",     label: "Shipwreck",       color: "#f97316", icon: "⚓",  waterType: "saltwater" as const, category: "special"     as MarkerCategory },
  { value: "custom",        label: "Custom",          color: "#e2e8f0", icon: "●",  waterType: "saltwater" as const, category: "special"     as MarkerCategory },
  { value: "depth_pole",    label: "Depth Pole",      color: "#00ffee", icon: "📡", waterType: "saltwater" as const, category: "special"     as MarkerCategory },
] as const;

export const FRESHWATER_MARKER_TYPES = [
  // ── Fish ────────────────────────────────────────────────────────────────
  { value: "fish",             label: "Fish",             color: "#4ade80", icon: "◈",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "bass",             label: "Bass",             color: "#65a30d", icon: "◈",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "trout",            label: "Trout",            color: "#22d3ee", icon: "◈",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "pike",             label: "Pike",             color: "#15803d", icon: "◈",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "walleye",          label: "Walleye",          color: "#facc15", icon: "◈",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "catfish",          label: "Catfish",          color: "#78716c", icon: "◆",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "crappie",          label: "Crappie",          color: "#a8a29e", icon: "◐",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "bluegill",         label: "Bluegill",         color: "#3b82f6", icon: "◑",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "sunfish",          label: "Sunfish",          color: "#f59e0b", icon: "☀",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "carp",             label: "Carp",             color: "#92400e", icon: "◒",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "yellow_perch",     label: "Yellow Perch",     color: "#eab308", icon: "◓",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "muskie",           label: "Muskie",           color: "#16a34a", icon: "⬡",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "largemouth_bass",  label: "Lrg. Mouth Bass",  color: "#166534", icon: "◈",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "smallmouth_bass",  label: "Sml. Mouth Bass",  color: "#14532d", icon: "◉",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  { value: "channel_catfish",  label: "Ch. Catfish",      color: "#57534e", icon: "◆",  waterType: "freshwater" as const, category: "fish"        as MarkerCategory },
  // ── Crustaceans ─────────────────────────────────────────────────────────
  { value: "crayfish",         label: "Crayfish",         color: "#dc2626", icon: "◈",  waterType: "freshwater" as const, category: "crustaceans" as MarkerCategory },
  { value: "freshwater_shrimp",label: "FW Shrimp",        color: "#f87171", icon: "🦐", waterType: "freshwater" as const, category: "crustaceans" as MarkerCategory },
  { value: "freshwater_crab",  label: "FW Crab",          color: "#b91c1c", icon: "🦀", waterType: "freshwater" as const, category: "crustaceans" as MarkerCategory },
  // ── Schools ─────────────────────────────────────────────────────────────
  { value: "school_perch",     label: "School·Perch",     color: "#94a3b8", icon: "≋",  waterType: "freshwater" as const, category: "schools"     as MarkerCategory },
  { value: "school_bluegill",  label: "School·Bluegill",  color: "#a8b4c0", icon: "≡",  waterType: "freshwater" as const, category: "schools"     as MarkerCategory },
  { value: "school_bass",      label: "School·Bass",      color: "#b8c4cc", icon: "∷",  waterType: "freshwater" as const, category: "schools"     as MarkerCategory },
  { value: "school_crappie",   label: "School·Crappie",   color: "#7f8fa6", icon: "⋯",  waterType: "freshwater" as const, category: "schools"     as MarkerCategory },
  { value: "school_carp",      label: "School·Carp",      color: "#8e9db0", icon: "⁝",  waterType: "freshwater" as const, category: "schools"     as MarkerCategory },
  // ── Other ────────────────────────────────────────────────────────────────
  { value: "snapping_turtle",  label: "Snapping Turtle",  color: "#4d7c0f", icon: "🐢", waterType: "freshwater" as const, category: "other"       as MarkerCategory },
  { value: "bullfrog",         label: "Bullfrog",         color: "#65a30d", icon: "🐸", waterType: "freshwater" as const, category: "other"       as MarkerCategory },
  { value: "beaver_dam",       label: "Beaver Dam",       color: "#92400e", icon: "⬡",  waterType: "freshwater" as const, category: "other"       as MarkerCategory },
  // ── Features ─────────────────────────────────────────────────────────────
  { value: "lily_pad",         label: "Lily Pad",         color: "#86efac", icon: "❧",  waterType: "freshwater" as const, category: "features"    as MarkerCategory },
  { value: "cattail",          label: "Cattail",          color: "#a3e635", icon: "⁋",  waterType: "freshwater" as const, category: "features"    as MarkerCategory },
  { value: "reed_bed",         label: "Reed Bed",         color: "#84cc16", icon: "⁌",  waterType: "freshwater" as const, category: "features"    as MarkerCategory },
  { value: "submerged_grass",  label: "Subm. Grass",      color: "#4ade80", icon: "❋",  waterType: "freshwater" as const, category: "features"    as MarkerCategory },
  { value: "spring",           label: "Spring",           color: "#7dd3fc", icon: "◉",  waterType: "freshwater" as const, category: "features"    as MarkerCategory },
  { value: "vegetation",       label: "Vegetation",       color: "#6ee7b7", icon: "❋",  waterType: "freshwater" as const, category: "features"    as MarkerCategory },
  { value: "log",              label: "Submerged Log",    color: "#a16207", icon: "⁂",  waterType: "freshwater" as const, category: "features"    as MarkerCategory },
  { value: "sample",           label: "Water Sample",     color: "#93c5fd", icon: "◉",  waterType: "freshwater" as const, category: "features"    as MarkerCategory },
  // ── Special ──────────────────────────────────────────────────────────────
  { value: "shipwreck",        label: "Shipwreck",        color: "#f97316", icon: "⚓",  waterType: "freshwater" as const, category: "special"     as MarkerCategory },
  { value: "custom",           label: "Custom",           color: "#e2e8f0", icon: "●",  waterType: "freshwater" as const, category: "special"     as MarkerCategory },
  { value: "depth_pole",       label: "Depth Pole",       color: "#00ffee", icon: "📡", waterType: "freshwater" as const, category: "special"     as MarkerCategory },
] as const;

export const MARKER_TYPES = [...SALTWATER_MARKER_TYPES, ...FRESHWATER_MARKER_TYPES];

export const DEPTH_POLE_DEFAULT_COLOUR = "#00ffee";

export type SaltwaterMarkerTypeValue = typeof SALTWATER_MARKER_TYPES[number]["value"];
export type FreshwaterMarkerTypeValue = typeof FRESHWATER_MARKER_TYPES[number]["value"];
export type MarkerTypeValue = SaltwaterMarkerTypeValue | FreshwaterMarkerTypeValue;

export const MARKER_COLOR: Record<string, string> = Object.fromEntries(
  MARKER_TYPES.map((t) => [t.value, t.color]),
);

export const MARKER_ICON: Record<string, string> = Object.fromEntries(
  MARKER_TYPES.map((t) => [t.value, t.icon]),
);

export const SALTWATER_CATEGORY_ORDER: MarkerCategory[] = ["fish", "crustaceans", "schools", "other", "special"];
export const FRESHWATER_CATEGORY_ORDER: MarkerCategory[] = ["fish", "crustaceans", "schools", "other", "features", "special"];
