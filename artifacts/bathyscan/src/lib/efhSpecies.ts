import type {
  EfhAvailableSpecies,
  EfhFeature,
} from "@workspace/api-client-react";

export const MAX_ACTIVE_EFH_SPECIES = 2;
export const EMPTY_EFH_SPECIES: EfhAvailableSpecies[] = [];

export function availableEfhSpeciesFromFeatures(
  features: EfhFeature[] | undefined,
): EfhAvailableSpecies[] {
  if (!features?.length) return EMPTY_EFH_SPECIES;
  const seen = new Set<string>();
  const result: EfhAvailableSpecies[] = [];
  for (const feature of features ?? []) {
    const species = feature.properties.species ?? "";
    if (feature.properties.substrate) continue;
    const commonName = feature.properties.commonName ?? species;
    if (!commonName || seen.has(commonName)) continue;
    seen.add(commonName);
    result.push({
      species,
      commonName,
      color: feature.properties.color ?? "#00e5ff",
    });
  }
  return result;
}

export function filterEfhByActiveSpecies(
  features: EfhFeature[] | undefined,
  activeSpecies: ReadonlyArray<string>,
): EfhFeature[] {
  if (!features?.length || !activeSpecies.length) return [];
  const selected = new Set(activeSpecies);
  return features.filter((feature) =>
    selected.has(feature.properties.commonName ?? "") ||
    selected.has(feature.properties.species ?? ""),
  );
}