/**
 * overviewRenderer/internal.ts — small shared helpers used across several
 * focused overviewRenderer modules.
 *
 * Kept in a dedicated leaf module (no imports from sibling renderer modules)
 * so overlays and legends can share it without creating an import cycle.
 */

/** Convert a `#rrggbb` hex colour + alpha to a CSS `rgba(...)` string. */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
