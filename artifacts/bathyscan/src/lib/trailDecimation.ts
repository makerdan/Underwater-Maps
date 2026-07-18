/**
 * trailDecimation — pure helper to cap the number of trail points rendered
 * in the 3D scene. Long sessions can accumulate up to MAX_TRAIL_POINTS
 * (10k) samples; rendering all of them as a line every frame is wasteful.
 *
 * Uniform index decimation: always keeps the first and last points so the
 * rendered trail starts at the session origin and ends at the boat's
 * current position.
 */

/** Maximum number of trail vertices rendered in the 3D scene. */
export const MAX_RENDERED_TRAIL_POINTS = 500;

export function decimateTrailPoints<T>(
  points: readonly T[],
  maxPoints: number = MAX_RENDERED_TRAIL_POINTS,
): T[] {
  if (maxPoints <= 0) return [];
  if (points.length <= maxPoints) return [...points];
  if (maxPoints === 1) return [points[points.length - 1]!];

  const out: T[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  let prevIdx = -1;
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    if (idx !== prevIdx) {
      out.push(points[idx]!);
      prevIdx = idx;
    }
  }
  return out;
}
