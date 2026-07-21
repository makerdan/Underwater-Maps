/**
 * Simulated-terrain treatment registry — TerrainMesh registers each mounted
 * grid's datasetId with whether the rainbow "SIMULATED" treatment is active
 * (i.e. the grid's data source is synthetic). Exposed to e2e tests through
 * the e2e test bridge's getSimulatedTreatment() (see testHelpers.ts) so headless
 * runs can assert the treatment activates only for synthetic grids without
 * pixel-level checks, which are unreliable in headless WebGL.
 *
 * Kept in its own tiny module (rather than testHelpers.ts) so TerrainMesh can
 * import it without pulling the dev-only test API into the production bundle.
 */
const _simulatedTreatment = new Map<string, boolean>();

export function registerSimulatedTreatment(
  datasetId: string,
  active: boolean | null,
): void {
  if (active === null) _simulatedTreatment.delete(datasetId);
  else _simulatedTreatment.set(datasetId, active);
}

export function getSimulatedTreatmentMap(): Record<string, boolean> {
  return Object.fromEntries(_simulatedTreatment);
}
