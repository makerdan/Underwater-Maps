---
title: Dependency Health Audit
---
# Dependency Health Audit

## What & Why
BathyScan's binary parsers (`h5wasm`, `laz-perf`, `geotiff`, `multer`) and other runtime dependencies are CVE-prone and can fall multiple major versions behind without obvious breakage. This audit runs a full vulnerability scan, checks version currency for high-risk packages, and confirms that the `laz-perf` WASM heap-detach workaround (documented in `.agents/memory/laz-perf-wasm-heap.md`) is still applied correctly.

## Done looks like
- `pnpm audit --audit-level moderate` exits 0 across the entire monorepo, or every remaining finding is documented with a rationale for why it is accepted (e.g. dev-only, no fix available).
- `h5wasm`, `laz-perf`, `geotiff`, and `multer` are no more than 1 major version behind their latest stable release (check npmjs.com); if they are further behind, an upgrade is attempted or a follow-up task is created with the blocker documented.
- No other production dependency is more than 2 major versions behind its latest release.
- The `laz-perf` WASM heap-detach workaround is still present: `lp.HEAPU8.buffer` is re-read on each `getPoint()` call rather than captured before the loop; confirmed by code search.
- Findings are summarised in the audit notes with severity, affected package, fix version (if any), and action taken.

## Out of scope
- Upgrading packages beyond what is needed to resolve moderate+ CVEs or close the major-version gap.
- Dev-only packages with no production exposure (flag but do not block).

## Steps
1. **Run `pnpm audit --audit-level moderate`** — Capture full output; for each finding, classify as production vs. dev-only, note the CVE ID, severity, and whether a patched version exists.

2. **Check version currency for high-risk packages** — For each of `h5wasm`, `laz-perf`, `geotiff`, `multer`, fetch the latest stable version from npmjs.com; compare with the installed version in `package.json`; flag if more than 1 major version behind.

3. **Check all production dependencies for major-version lag** — Parse `pnpm list --depth 0 --prod` output; flag any package more than 2 major versions behind.

4. **Verify `laz-perf` WASM heap-detach workaround** — Search the codebase for the LAZ decompression loop; confirm that `lp.HEAPU8` (or `.HEAPU8.buffer`) is accessed inside the loop rather than captured in a variable before it. If the workaround has been removed or refactored away, restore it and add a comment referencing the memory topic file.

5. **Upgrade or document** — For each flagged package, attempt `pnpm update <package>` and run `pnpm run typecheck && pnpm run test:unit`. If the upgrade breaks something, revert and create a follow-up task with the blocker documented. If it passes, commit the update.

6. **Summarise findings** — Write a brief audit summary (package, installed version, latest version, CVEs, action taken) as a comment in this task's completion notes.

## Relevant files
- `package.json` (root and all workspace packages)
- `pnpm-lock.yaml`
- `.agents/memory/laz-perf-wasm-heap.md` — documents the WASM heap-detach workaround
- LAZ decompression source file (search for `laz-perf` or `getPoint`)
