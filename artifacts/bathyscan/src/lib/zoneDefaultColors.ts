/**
 * Default zone-slot colours — single source of truth shared by
 * zoneOverlayStore.ts (runtime) and e2e test fixtures (Node.js).
 *
 * This module is intentionally side-effect-free so it can be imported by
 * Playwright test files running in Node.js without pulling in localStorage
 * access or Zustand store creation.
 */

/** Pastel hex defaults matching terrainShader.ts ZONE_TINT_COLORS */
export const ZONE_DEFAULT_COLORS: readonly [string, string, string, string] = [
  "#f5d58a", // slot 0 — sand      (warm yellow)
  "#c49a6c", // slot 1 — sediment  (earthy amber)
  "#8ab4d0", // slot 2 — silt      (cool blue-grey)
  "#b06060", // slot 3 — basalt    (muted terracotta)
];
