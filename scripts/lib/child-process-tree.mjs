/**
 * Return the supplied process IDs and every descendant reachable through
 * parent PID links. Descendants may have detached into different process
 * groups, so PID ancestry is the reliable relationship for diagnostics.
 */
export function collectDescendantPids(rows, roots) {
  const excluded = new Set(roots.map(String));
  let changed = true;

  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!row || typeof row.pid !== "string" || typeof row.ppid !== "string") continue;
      if (excluded.has(row.pid) || !excluded.has(row.ppid)) continue;
      excluded.add(row.pid);
      changed = true;
    }
  }

  return excluded;
}