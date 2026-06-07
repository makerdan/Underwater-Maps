import * as THREE from "three";

/**
 * Module-level mutable ref to the marker group, consumed by useFlyControls
 * to raycast against marker meshes for right-click context menu detection.
 * Null when no markers are rendered.
 *
 * Lives in its own module so that MarkerLayer.tsx only exports React
 * components — a requirement for Vite Fast Refresh. Exporting non-component
 * values from a component module triggers the
 * "export is incompatible with Fast Refresh" warning and forces a full
 * page reload on every save.
 */
export const markerGroupRef: { current: THREE.Group | null } = { current: null };
