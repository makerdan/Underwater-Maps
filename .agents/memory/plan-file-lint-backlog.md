---
name: Plan-file lint backlog — recurs per environment
description: check:failure-gate/-regression-guard lint the gitignored .local/tasks archive; bulk-fills done in one environment never propagate, so every fresh env regenerates the ~909-file backlog.
---

# Plan-file lint backlog — RECURS in every fresh environment

**Status (2026-08-17):** NOT durably resolved. Task-4007 bulk-filled the archive and it went green — but only in that task's environment. `.local/tasks/` is gitignored, so the filled files never travel through git; a different/fresh task environment sees the pre-fill archive and `check:failure-gate` fails again with ~909 non-compliant files (re-confirmed by the 2026-08 bug audit, `docs/audits/bug-audit-preexisting-2026-08.md`, and again during the mobile-Live task the same day).

**Why:** the gate's subject matter (plan archive) lives in an untracked directory, so any compliance fix is environment-local by construction. A bulk-fill can never stick project-wide.

**How to apply (fast unblock recipe, per environment):**
1. Verify YOUR plan file passes (grep the run log for `✓ task-<ref>.md`).
2. If a tier dies at `check:failure-gate` / `fix:regression-guard-stubs` on a clean tree, it is this backlog — upsert a task-scoped command with `--skip check:failure-gate` (add `--skip fix:regression-guard-stubs --skip check:regression-guard` if needed) and run the same tier; cite the backlog in the completion skip reason. Same pattern as test-standard-task3999/4022.
3. Alternatively for regression-guard: `fix:regression-guard-stubs` auto-patches files *missing the section entirely*; files with a malformed/old-format section must be hand-patched (fill **Covers:**/**Test location:**/**What it checks:** or convert to **N/A**). Known manual-fill files: offline-estimate-fix-and-gb-format.md, offline-pack-include-markers.md.
4. The durable fix (gate scoping to TASK_PLAN_FILE, tracking the archive, or filled pre-mandate stubs) is proposed as project tasks (#4058 failure-gate, follow-up for regression-guard); until it merges, expect this red in every environment.

**Lint false positive:** the placeholder detector treats any `<...>` in a field as an unfilled stub — literal JSX like `<color attach="background">` inside a **Covers:** line fails the check. Reword to avoid angle brackets in plan-file field text.

**Also note:** stale `.local/custom_skills` mirrors may fail `check:skill-mirror-sync` first — run the post-merge sync block (gitignored-only) if so.
