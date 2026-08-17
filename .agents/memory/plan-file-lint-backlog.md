---
name: Plan-file lint backlog blocks check:failure-gate
description: ~900 pre-mandate .local/tasks plans have unfilled **Why:** placeholders; check:failure-gate fails every TASK_PLAN_FILE tier run until the backlog is filled.
---

# Plan-file lint backlog blocks check:failure-gate

**The rule:** When a tier run with `TASK_PLAN_FILE` set fails at `check:failure-gate`
listing hundreds of old plan files with "unfilled stub placeholder(s)", that is the
pre-mandate backlog in `.local/tasks/` (~909 files stubbed 2026-08-16 with
`**Why:** <replace with one-line justification>`), not your task. `--fix-stub`
cannot fill placeholders — only humans/agents can.

**Why:** A bulk `--fix-stub` run appended Validation stubs to the whole archive of
pre-mandate plan files; the strict check now fires on every one of them, in every
tier run that reaches the step. Verified failing on a clean tree (check input is
only `.local/tasks/*.md`).

**How to apply:**
- Run the tier via an upserted command with
  `--skip check:failure-gate`, self-classify per the Failure Gate skill
  (file untouched + fails on main), and log the `[SELF-CLASSIFIED PRE-EXISTING]` line.
- `check:regression-guard`'s `--fix-stub` auto-appends "predates-mandate N/A" stubs
  to archives missing the section; files with a *malformed existing* section must be
  hand-converted to the Covers/Test location/What it checks template (done for the
  two offline-pack archives 2026-08-17 — regression-guard is now 995/995 compliant).
- The backlog stays until someone fills the ~909 `**Why:**` placeholders (or the
  standard tier switches to `--stubs-only` semantics for archives). Until then every
  TASK_PLAN_FILE tier run needs the skip.
- Also: stale `.local/custom_skills` mirrors fail `check:skill-mirror-sync` first —
  re-run the post-merge sync block (copies + re-fingerprints, gitignored-only).
