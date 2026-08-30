---
name: Failure Gate
description: >-
  Apply to every task plan and every task execution. Establish a test baseline,
  classify failures with evidence, enforce the plan's validation ceiling, and
  report ownership without fixing failures the task did not cause.
---

# Failure Gate

Failure Gate has one purpose: make test ownership explicit before work is
declared complete. It applies at two points:

1. **Plan time:** discover and document the baseline before writing the plan.
2. **Execute time:** classify new failures without treating a convenient retry
   as evidence of provenance.

This gate covers test-suite failures. Typecheck failures remain task failures
and are handled by the project's typecheck/audit process.

## Non-negotiable contract

- Every plan has `## Pre-existing failures to ignore` and `## Validation`.
- `## Validation` has a real registered tier in `**Command:**`, a filled
  `**Why:**`, and `**Do not escalate:**`.
- `docs/validation/failure-baseline.json` is the durable baseline source.
  A plan may reference only an authoritative, unexpired `active` record.
  Unknown, `needs-review`, `intermittent`, `environment-limited`, and `resolved`
  IDs cannot authorize an ignore.
- A referenced baseline must declare exactly one plan ownership:
  `**Ignored baseline:**` for unrelated work or `**Owned baseline repair:**`
  when this task must fix it.
- Catalog membership never proves that a different suite, test, or failure
  signature is pre-existing. The observed failure must match the record.
- A retry that passes proves **intermittency only**. It does not prove that the
  failure pre-dates the task.
- A task-driven tier-lock problem fails closed. Only an explicit
  `--allow-no-plan` on an ad-hoc/non-task run may bypass a missing plan.
- `.local/tasks/` is gitignored environment-local archive state. Bulk archive
  repairs are not tracked deliverables and must not be included in a commit.
  Keep enforcement changes in tracked source, tests, session guidance, or
  published assets.

The session mandate, lint guard, tier runner, and this skill are one contract.
When changing the contract, update all relevant tracked surfaces together.
Do not edit generated `.local/custom_skills/` mirrors directly.

## Plan time — Planner checklist

<HARD-GATE>
Complete this checklist before writing the first plan heading. Emit the
announcement in the next section before that heading.
</HARD-GATE>

1. **Create safely.** Use `scripts/new-plan.mjs`; do not create a plan by hand.
   It requires a real `--why` and supplies the required section stubs.
2. **Scan memory.** Read `.agents/memory/MEMORY.md` and inspect linked entries
   about suites, files, or failure patterns touched by the task.
3. **Scan the catalog.** Read `docs/validation/failure-baseline.json` for exact
   suite/test/signature matches. Treat non-active records as context only.
4. **Scan recent tasks.** Search recent task descriptions for `pre-existing`,
   `known failure`, `flaky`, and the relevant suite names.
5. **Spot-run when applicable.** If the task changes backend/API-server code,
   run the project's primary backend suite once before editing and record its
   failures. Otherwise skip this expensive check.
6. **Record the baseline.** Use repeatable `--baseline-id` or
   `--owned-baseline-id` options with `scripts/new-plan.mjs`. Keep temporary
   environment observations under `## Task-local environment observations`;
   they are not durable provenance.
7. **Choose the ceiling.** Select the lightest registered validation tier that
   covers the task; use the middle tier when uncertain. Add `## Validation`
   immediately after the baseline section.
8. **Verify the plan.** In single-file mode, run both guards and require exit 0:

   ```sh
   TASK_PLAN_FILE=.local/tasks/<name>.md node scripts/check-failure-gate.mjs
   TASK_PLAN_FILE=.local/tasks/<name>.md node scripts/check-regression-guard.mjs
   ```

Do not call the task-creation operation until the plan passes both guards.

### Required announcement

Before the first plan heading, emit exactly:

```text
[FAILURE-GATE] Discovery checklist complete. Pre-existing failures documented: <N>. Validation command: `<command>`.
```

### Required plan sections

Use this baseline section even when no failures are known:

```markdown
## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not
pre-existing provenance. Use the execution evidence rules before assigning
ownership.
```

When an active catalog record matches, reference its ID and declare ownership:

```markdown
- **Ignored baseline:** `BASE-EXAMPLE` — suite › test; match only this signature: exact failure signature.
- **Owned baseline repair:** `BASE-EXAMPLE-REPAIR` — suite › test; this task explicitly owns repair of this signature: exact failure signature.
```

Free-text `--pre-existing` remains task-local evidence, not a durable catalog
claim. Use `--environment-observation` for temporary harness, service, or
resource limitations. Neither form weakens the execute-time evidence gate.

Every plan must also contain:

```markdown
## Validation
**Command:** `test-standard`
**Why:** <filled one-line reason this tier covers the task>
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.
```

The lint guard is authoritative for valid tier names and placeholder rules.
Use its `--fix-stub` mode only to add missing structure; invalid tiers and
unfilled explanations still require a human decision.

## Execute time — Build agent decision path

<HARD-GATE>
Read the plan's baseline section before editing. If either required section is
missing, add a safe stub and stop to repair the plan before validation.
The plan's `**Command:**` is the validation ceiling.
</HARD-GATE>

### Task validation versus completion validation

- **Task validation** is the registered command named in the plan's `## Validation`
  section under **Command:**. It is the agent's required validation ceiling: run
  exactly that command with the task plan locked, and never escalate above it.
- **Completion validation** is the platform-managed final check after task work. It
  may run many registered commands and is not necessarily limited by the plan's
  task-validation ceiling. For code-changing tasks, it is required even when
  broad; do not skip it because it exceeds the task-validation ceiling.
- For an intentionally preview-only, no-file-change task, run task validation
  first. If completion review is not meaningful, then provide a specific
  validation-skip reason; a generic "no changes" statement or an omitted check
  is not success.
- If completion validation remains **RUNNING** through its polling limit,
  classify that result as a validation-harness limitation, not a product failure.
  Do not start or retry another completion validation while the original run
  remains active.

### 1. Establish the tier lock

Set the plan path for every task-driven validation run:

```sh
export TASK_PLAN_FILE=.local/tasks/<name>.md
```

Use `scripts/run-locked-tier.mjs <plan-file>` when the plan should choose the
tier, or invoke the registered command with `TASK_PLAN_FILE` set. Do not pass
`--allow-no-plan` as a task agent.

Missing, unreadable, malformed, or unparseable task-plan/tier data is a
**TIER-LOCK VIOLATION** and must stop the run before any validation step.
`--allow-no-plan` is the only bypass, and is reserved for an explicitly
ad-hoc/non-task caller. A mismatch between the requested tier and the plan
also fails closed. Never escalate above the plan ceiling.

The mechanical details live in:

- `scripts/run-locked-tier.mjs`
- `scripts/lib/tier-lock-check.mjs`
- `scripts/run-tier.mjs`
- `scripts/test-heavy-serial.mjs`

### 2. Classify each failure

Apply these rules in order:

1. **Explicit baseline, unrelated task:** first match the observed suite, test,
   and signature to the active record. If all match, skip the listed failure;
   do not investigate or fix it.
2. **Explicit baseline, validation-repair task:** match the record, then fix it when the plan says this task owns it. A baseline label never prevents explicit repair ownership.
3. **Not listed:** retry the failing test three times in isolation.
   - Any passing retry means **intermittent**, not pre-existing. Record the
     result, then continue gathering provenance; do not self-classify from the
     pass alone.
   - Three failures are consistent evidence, not ownership by themselves.
4. **Evidence gate:** self-classify an unlisted failure as pre-existing only
   with at least two of these three facts:
   - the failing test and its directly imported task-relevant files are
     untouched;
   - it also fails on the pre-task revision/main;
   - a specific memory entry or recently merged task documents the pattern.
5. **Insufficient evidence:** treat the failure as a regression, fix it, or
   obtain the missing evidence. Do not silently waive it.

Unknown, stale, resolved, intermittent, environment-limited, or mismatched
records follow steps 3–5; they are never auto-ignored.

For every self-classified failure, emit:

```text
[SELF-CLASSIFIED PRE-EXISTING] <suite or test> — evidence: <factor1>, <factor2>
```

Record intermittent outcomes separately from pre-existing provenance. A
passing retry may be reported as intermittent only; it cannot satisfy the
two-factor evidence gate.

### Durable promotion boundary

Do not edit the catalog merely because the current task self-classified a
failure. A newly observed failure remains task-local until it has the required
retry result, two-factor provenance, exact suite/test/signature, dated evidence,
an owner, and a review deadline. Promotion is a separate tracked maintenance
change; use `needs-review` unless fresh evidence is authoritative.

### 3. Complete without escalation

The task is clear to complete only when every remaining failure is either:

- explicitly listed and not owned by this task; or
- self-classified with the required evidence and log; or
- fixed because this task explicitly owns it.

Run exactly the plan's validation command. Do not run a heavier tier because
of a baseline failure, an intermittent retry, or a self-classification.

## Archive and remediation boundaries

The validation pipeline may run a scoped `--fix-stub` pass for the current
`TASK_PLAN_FILE`. Archive inspection requires the explicit maintenance command
`node scripts/check-failure-gate.mjs --archive`; it is never an ordinary managed
tier dependency. `.local/tasks/` is not tracked output. Do not instruct an agent to bulk-edit that archive as part of a commit. If durable behavior must change, edit the tracked lint, runner, tests, session mandate, and regenerate the published asset.

The pipeline's `--fix-stub` and strict-check ordering is an implementation
detail, not a substitute for a filled plan. The canonical mechanics are in
`scripts/check-failure-gate.mjs` and `scripts/validation-steps.mjs`.

## Baseline maintenance report

Run `pnpm run maintain:validation-baseline` periodically to find authoritative
active records whose review deadline is approaching or whose verification is
stale. This is an opt-in maintenance report, not an ordinary validation-tier
step: an approaching deadline must not fail unrelated task validation.

The report may surface expired active records, but it never makes them
referenceable. Normal catalog validation and plan resolution continue to fail
closed for expired records. See
`docs/validation/failure-baseline.md` for lifecycle rules, warning-window
options, finding categories, and exit codes.

## Reference

- Session mandate: `replit.md` § Agent rules
- Plan scaffold: `scripts/new-plan.mjs`
- Failure Gate lint guard: `scripts/check-failure-gate.mjs`
- Regression Guard lint guard: `scripts/check-regression-guard.mjs`
- Validation tiers: `.agents/skills/validation-tiers/SKILL.md`
- Baseline catalog: `docs/validation/failure-baseline.json`
- Catalog lifecycle guidance: `docs/validation/failure-baseline.md`
- Known project patterns: `.agents/memory/MEMORY.md`
- Published snapshot: `artifacts/bathyscan/public/failure-gate-skill.zip`