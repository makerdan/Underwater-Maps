export const SALTWATER_MARKER_TYPES = [
  { value: "fish",       label: "Fish",             color: "#22c55e", icon: "◈", waterType: "saltwater" as const },
  { value: "shipwreck",  label: "Shipwreck",         color: "#f97316", icon: "⚓", waterType: "saltwater" as const },
  { value: "coral",      label: "Coral",             color: "#f472b6", icon: "❊", waterType: "saltwater" as const },
  { value: "vent",       label: "Hydrothermal Vent", color: "#ef4444", icon: "♨", waterType: "saltwater" as const },
  { value: "custom",     label: "Custom",            color: "#e2e8f0", icon: "●", waterType: "saltwater" as const },
  { value: "depth_pole", label: "Depth Pole",        color: "#00ffee", icon: "📡", waterType: "saltwater" as const },
] as const;

export const FRESHWATER_MARKER_TYPES = [
  { value: "fish",       label: "Fish",             color: "#4ade80", icon: "◈", waterType: "freshwater" as const },
  { value: "vegetation", label: "Vegetation",        color: "#86efac", icon: "❋", waterType: "freshwater" as const },
  { value: "log",        label: "Submerged Log",     color: "#a16207", icon: "⁂", waterType: "freshwater" as const },
  { value: "sample",     label: "Water Sample",      color: "#7dd3fc", icon: "◉", waterType: "freshwater" as const },
  { value: "shipwreck",  label: "Shipwreck",         color: "#f97316", icon: "⚓", waterType: "freshwater" as const },
  { value: "custom",     label: "Custom",            color: "#e2e8f0", icon: "●", waterType: "freshwater" as const },
  { value: "depth_pole", label: "Depth Pole",        color: "#00ffee", icon: "📡", waterType: "freshwater" as const },
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
