---
name: Plan-file lint backlog — recurs per environment
description: check:failure-gate/-regression-guard lint the gitignored .local/tasks archive; bulk-fills done in one environment never propagate, so every fresh env regenerates the ~909-file backlog.
---

# Plan-file lint backlog — RECURS in every fresh environment

**Status (2026-08-17):** NOT durably resolved. Task-4007 bulk-filled the archive and it went green — but only in that task's environment. `.local/tasks/` is gitignored, so the filled files never travel through git; a different/fresh task environment sees the pre-fill archive and `check:failure-gate` fails again with ~909 non-compliant files (re-confirmed by the 2026-08 bug audit, `docs/audits/bug-audit-preexisting-2026-08.md`).

**Why:** the gate's subject matter (plan archive) lives in an untracked directory, so any compliance fix is environment-local by construction. A bulk-fill can never stick project-wide.

**How to apply:**
- If a tier dies at `check:failure-gate` / `fix:regression-guard-stubs` on a clean tree, it is this backlog — triage per the sanctioned path: upsert a command with `--skip check:failure-gate --skip fix:regression-guard-stubs --skip check:regression-guard` and run the same tier; cite the backlog in the completion skip reason.
- Two files additionally fail `check:regression-guard` with partially-filled sections that `--fix-stub` cannot repair (offline-estimate-fix-and-gb-format.md, offline-pack-include-markers.md) — manual fill only.
- The durable fix (gate scoping to TASK_PLAN_FILE, tracking the archive, or filled pre-mandate stubs) is proposed as a project task; until it merges, expect this red in every environment.
- Stale `.local/custom_skills` mirrors may fail `check:skill-mirror-sync` first — run the post-merge sync block (gitignored-only) if so.
