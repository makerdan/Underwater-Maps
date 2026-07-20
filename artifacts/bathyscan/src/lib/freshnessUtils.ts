/**
 * freshnessUtils.ts — Consistent "data freshness" date/time formatting.
 *
 * formatFreshness: converts a Date, ISO string, or numeric timestamp into one of:
 *   - "Jul 18, 2026"        for bare dates (midnight UTC — no time component)
 *   - "Jul 18 · 14:32 UTC"  for date+time values
 *
 * Returns null when the input is null, undefined, or unparseable so callers
 * can conditionally render without extra null checks.
 */

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatFreshness(
  date: Date | string | number | null | undefined,
): string | null {
  if (date == null) return null;
  const d =
    date instanceof Date
      ? date
      : new Date(typeof date === "number" ? date : date);
  if (isNaN(d.getTime())) return null;

  const month = MONTH_NAMES[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();

  const hasTime =
    d.getUTCHours() !== 0 ||
    d.getUTCMinutes() !== 0 ||
    d.getUTCSeconds() !== 0;

  if (hasTime) {
    const h = d.getUTCHours().toString().padStart(2, "0");
    const m = d.getUTCMinutes().toString().padStart(2, "0");
    return `${month} ${day} · ${h}:${m} UTC`;
  }
  return `${month} ${day}, ${year}`;
}
