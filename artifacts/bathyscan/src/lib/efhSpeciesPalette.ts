/**
 * Canonical EFH species name → hex color pairs, derived from GOA_LAYER_SPECS
 * in the API server's efhFetcher.  These colors are injected into every
 * EfhFeature's `properties.color` field, so using them here keeps the 3D
 * Overlays panel in exact visual sync with the 2D map legend and 3D layer.
 *
 * Update this list whenever GOA_LAYER_SPECS gains new species.
 */
export interface EfhSpeciesEntry {
  commonName: string;
  color: string;
}

export const EFH_SPECIES_PALETTE: EfhSpeciesEntry[] = [
  { commonName: "Pacific Halibut",     color: "#f59e0b" },
  { commonName: "Pacific Cod",         color: "#6366f1" },
  { commonName: "Black Rockfish",      color: "#1f2937" },
  { commonName: "Dusky Rockfish",      color: "#7c3aed" },
  { commonName: "Pacific Ocean Perch", color: "#dc2626" },
  { commonName: "Quillback Rockfish",  color: "#facc15" },
  { commonName: "Rougheye Rockfish",   color: "#92400e" },
  { commonName: "Yelloweye Rockfish",  color: "#ef4444" },
  { commonName: "Arrowtooth Flounder", color: "#16a34a" },
  { commonName: "Sablefish",           color: "#0e7490" },
  { commonName: "Walleye Pollock",     color: "#7c3aed" },
];
