import { MarkerInputType } from "@workspace/api-client-react";

export const MARKER_TYPES = [
  { value: "fish",      label: "Fish",             color: "#22c55e", icon: "◈" },
  { value: "shipwreck", label: "Shipwreck",         color: "#f97316", icon: "⚓" },
  { value: "coral",     label: "Coral",             color: "#f472b6", icon: "❊" },
  { value: "vent",      label: "Hydrothermal Vent", color: "#ef4444", icon: "♨" },
  { value: "custom",    label: "Custom",            color: "#e2e8f0", icon: "●" },
] as const;

export type MarkerTypeValue = typeof MarkerInputType[keyof typeof MarkerInputType];

export const MARKER_COLOR: Record<string, string> = Object.fromEntries(
  MARKER_TYPES.map((t) => [t.value, t.color]),
);

export const MARKER_ICON: Record<string, string> = Object.fromEntries(
  MARKER_TYPES.map((t) => [t.value, t.icon]),
);
