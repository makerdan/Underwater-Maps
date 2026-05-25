/**
 * waterLabels.ts — environment-aware terminology switching.
 *
 * Returns label sets appropriate for the current water environment so UI
 * copy stays contextually accurate (e.g. "depth" stays "depth" but
 * "seafloor" becomes "lake bed", "maritime" → "freshwater", etc.).
 */

export interface WaterLabelSet {
  environment: string;
  floor: string;
  explorer: string;
  zone: string;
  depthLabel: string;
  markerCtaShort: string;
  aiPersona: string;
  colormapDefault: string;
}

export function waterLabels(type: "saltwater" | "freshwater"): WaterLabelSet {
  if (type === "freshwater") {
    return {
      environment: "Freshwater",
      floor: "lake bed",
      explorer: "Lake Explorer",
      zone: "lake zone",
      depthLabel: "Depth",
      markerCtaShort: "DROP MARKER",
      aiPersona: "freshwater limnologist",
      colormapDefault: "freshwater",
    };
  }
  return {
    environment: "Saltwater",
    floor: "seafloor",
    explorer: "Seafloor Explorer",
    zone: "seafloor zone",
    depthLabel: "Depth",
    markerCtaShort: "DROP MARKER",
    aiPersona: "marine geologist",
    colormapDefault: "ocean",
  };
}
