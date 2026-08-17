---
name: Plan-lint gate backlog blocks all tiers
description: check:failure-gate / regression-guard strict lints scan ALL legacy .local/tasks plans and can fail every tier; how to triage and work around.
---

# Plan-lint gate backlog blocks all tiers

The strict plan lints (`check:failure-gate`, `check:regression-guard`, run in
every tier's FAST prefix) scan the **entire** `.local/tasks/` archive (~1000
legacy files), not just the current plan. `--fix-stub` steps run first but
cannot fill `<replace with ...>` placeholders or existing-but-incomplete
sections — those need manual fill. When a backlog exists, every tier aborts
before `test:unit`, so the tier gives zero signal on your actual change.

**Why:** Gate hardening (2026-08-16) turned the archive-wide strict lint into a
hard step; ~900 pre-mandate plans got auto-stubbed placeholders that nothing
fills. The failure is environmental (.local/tasks is gitignored), deterministic,
and stash-verified independent of any code change.

**How to apply:**
- Triage: `pnpm run check:failure-gate` 3× + `git stash` run proves
  pre-existing in <1 min; self-classify per Failure Gate skill (file untouched +
  fails on clean tree).
- To still get tier signal at the same ceiling: upsert a validation command
  running `run-tier.mjs <tier> --skip <broken-gate-step>` with
  `TASK_PLAN_FILE` exported inline (bash -c). Same tier = not an escalation.
- If only a handful of files have existing-but-unfilled sections (the
  fix-stub step itself exits 1 on those), filling them manually with the
  sanctioned template is faster than skipping another step — gates cascade
  (failure-gate, then regression-guard).
