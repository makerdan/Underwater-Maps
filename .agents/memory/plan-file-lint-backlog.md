---
name: Plan-file lint backlog — recurs per environment
description: check:failure-gate/-regression-guard lint the gitignored .local/tasks archive; bulk-fills done in one environment never propagate, so every fresh env regenerates the ~909-file backlog.
---


# Plan-file lint backlog — RECURS in every fresh environment

**Status (2026-08-17):** NOT durably resolved. `.local/tasks/` is gitignored, so the filled files never travel through git; a different/fresh task environment sees the pre-fill archive and `check:failure-gate` fails again with ~909 non-compliant files (re-confirmed by the 2026-08 bug audit, `docs/audits/bug-audit-preexisting-2026-08.md`, and again during the mobile-Live task the same day).

**Why:** the gate's subject matter (plan archive) lives in an untracked directory, so any compliance fix is environment-local by construction. A bulk-fill can never stick project-wide.

**How to apply (fast unblock recipe, per environment):**
1. Verify YOUR plan file passes (grep the run log for `✓ task-<ref>.md`).
2. If a tier dies at `check:failure-gate` / `fix:regression-guard-stubs` on a clean tree, it is this backlog — upsert a task-scoped command with `--skip check:failure-gate` (add `--skip fix:regression-guard-stubs --skip check:regression-guard` if needed) and run the same tier; cite the backlog in the completion skip reason. Same pattern as test-standard-task3999/4022.
3. Alternatively for regression-guard: `fix:regression-guard-stubs` auto-patches files *missing the section entirely*; files with a malformed/old-format section must be hand-patched (fill **Covers:**/**Test location:**/**What it checks:** or convert to **N/A**). A few archived plans need manual fill only; other IN-PROGRESS tasks' plan files (e.g. placeholder `**Covers:**` fields) can also block this gate — do not edit another active task's plan file; skip and cite it as an other-task pre-existing failure.
4. The durable fix (gate scoping to TASK_PLAN_FILE, tracking the archive, or filled pre-mandate stubs) is proposed as project tasks; until it merges, expect this red in every environment.

**Lint false positive:** the placeholder detector treats any `<...>` in a field as an unfilled stub — literal JSX like `<color attach="background">` inside a **Covers:** line fails the check. Reword to avoid angle brackets in plan-file field text.

**Also note:** stale `.local/custom_skills` mirrors may fail `check:skill-mirror-sync` first — run the post-merge sync block (gitignored-only) if so.
## 2026-08-17 recurrence
Gate hardening re-broke the archive: fix-stub steps insert placeholder text
("**Why:** <replace...>") that the checker itself then rejects, so the backlog
cannot self-heal — ~900 files failed check:failure-gate and 3 legacy files with
existing-but-unfilled Regression Guard sections made fix:regression-guard-stubs
itself exit 1. Manual fill of the handful of existing-section files + same-tier
`--skip` of both archive lints (with TASK_PLAN_FILE set) was the sanctioned path.
Note: a real `<...>` code snippet inside a **Covers:** field trips the
placeholder detector — strip angle brackets from JSX in plan prose.
Scoping fixes: failure-gate scoped to TASK_PLAN_FILE (merged 2026-08-17);
regression-guard scoping proposed. Once both land, retire the --skip workaround.
