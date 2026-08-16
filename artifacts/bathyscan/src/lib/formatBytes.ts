/**
 * Shared byte-count formatter used by offline-pack UI components.
 *
 * Thresholds:
 *   < 1 KiB  → "N B"
 *   < 1 MiB  → "N.N KB"
 *   < 1 GiB  → "N.N MB"
 *   ≥ 1 GiB  → "N GB[ M MB]"  (integer GB + remaining whole MB; MB part
 *               omitted when the remainder is 0)
 */
export function formatBytes(b: number): string {
  const GiB = 1024 * 1024 * 1024;
  const MiB = 1024 * 1024;
  if (b >= GiB) {
    const gb = Math.floor(b / GiB);
    const remainingMb = Math.floor((b % GiB) / MiB);
    if (remainingMb === 0) return `${gb} GB`;
    return `${gb} GB ${remainingMb} MB`;
  }
  if (b < 1024) return `${b} B`;
  if (b < MiB) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / MiB).toFixed(1)} MB`;
}
