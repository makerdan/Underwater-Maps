---
name: Failure Gate
description: >-
  Apply to every task plan written and every task executed. Teaches the Planner
  how to discover and document pre-existing test failures before writing a plan,
  and teaches the Build agent how to recognise, classify, and safely ignore them
  during execution — without wasting time on failures it did not cause.
---

# Failure Gate

This skill governs two moments in every task lifecycle:

- **Plan-time** — the Planner discovers known failures and documents them in the plan
- **Execute-time** — the Build agent reads that section and decides what to ignore

Both actors must follow this skill. The skill is always loaded.

> **TypeScript exclusion:** This skill does NOT govern TypeScript type errors or
> typecheck failures. Treat `tsc` / typecheck failures as task failures; they are
> handled separately via dedicated audit tasks on demand. Everything below applies
> to test suite failures only.

---

## Enforcement architecture

This rule is enforced at four independent layers — all four must stay in sync:

| Layer | File | What it does |
|---|---|---|
| 0 — Session mandate | the project's session mandate (e.g. `replit.md` § "Agent rules") | Loaded at every Planner session start; contains the project's hard-gate checklist and any project-specific known-flaky patterns |
| 1 — Skill definition | `.agents/skills/failure-gate/SKILL.md` (this file) | Defines discovery checklist, templates, decision tree |
| 2 — Lint guard | the project's plan-file lint guard (e.g. `scripts/check-failure-gate.mjs`) | Scans the plan directory and fails if any plan omits a required section or has an incomplete `## Validation` section |
| 3 — Auto-remediate runner step | the project's validation runner (e.g. `scripts/validation-steps.mjs`) | Runs the lint guard in `--fix-stub` mode unconditionally before every strict lint step; the strict step then only fires on genuinely unfixable issues. Also enforces the plan's tier ceiling via `TASK_PLAN_FILE` when set, so every `run-tier.mjs` call checks the ceiling without further agent action. |

A change to the rule must be applied to all relevant layers in the same task.

---

### Lint guard modes

The project's plan-file lint guard should support three operating modes:

- **Strict (default)** — Scans all plan files for required sections and compliant
  `## Validation` content. Reports every non-compliant file and exits 1. This is
  the formal CI gate; a non-zero exit blocks the validation run.

- **`--fix-stub`** — For any plan file missing a required section, appends the
  appropriate stub. For any `## Validation` section that is present but incomplete,
  inserts the missing required inner lines (`**Command:**`, `**Why:**`,
  `**Do not escalate:**`). Cannot fix invalid tier values or unfilled placeholder
  text — those require human intervention. Always exits 0. When all files are
  already compliant, this mode is a no-op and safe to run unconditionally.

- **`--stubs-only`** — Skips the required-headings check entirely. Only reports
  unfilled placeholder text and missing required inner lines within existing
  `## Validation` sections. Useful when grandfathering a large archive of older
  plan files that predate the required-sections mandate, without permanently
  breaking CI on every run.

The three modes above control *strictness*. There is a fourth, orthogonal axis
that controls *scope*:

- **Single-file mode** — When the `TASK_PLAN_FILE` environment variable is set,
  the guard operates on the single file it names rather than scanning the entire
  plan archive. This prevents the archive-wide scan from failing on pre-mandate
  files that live in gitignored directories and never propagate between
  environments. Two hard-error conditions apply in this mode: (a) if the path
  named by `TASK_PLAN_FILE` does not end in `.md`, exit 1 with a clear
  diagnostic; (b) if the path does not exist, exit 1 with a clear diagnostic.
  Both the failure-gate guard and the regression-guard script in a project must
  honour this variable consistently, so the agent always receives a predictable,
  uniform contract regardless of which guard script runs first.

---

## Part 1 — Plan-time (Planner)

<HARD-GATE>
You MUST complete the discovery checklist below before writing any plan. Both
"Pre-existing failures to ignore" AND "Validation" sections are MANDATORY in
every plan — even when the failures list is empty. A plan that omits either
section is defective and must be corrected before an agent picks it up.
</HARD-GATE>

### Discovery checklist

Work through every item in order. Mark each complete before moving on.

1. **Memory scan** — Open `.agents/memory/MEMORY.md` and scan for entries whose
   linked topic file names or hook lines mention suites, files, or patterns
   touched by this task. Project-specific known-flaky patterns live in the
   project's session mandate and memory, not in this skill — treat every match
   as a candidate for the plan section.

2. **Recent task scan** — Query recently merged task descriptions for the words
   "pre-existing", "known failure", "flaky", or the names of suites the current
   task touches. Any match is a candidate for the list.

3. **Spot-run** — When the task touches the project's main backend or server
   code, run the project's primary backend test suite once in its current state
   (before any changes) and record any failures — those failures are pre-existing
   by definition. Consult the project's session mandate to identify which suite
   qualifies. Skip if the task does not touch backend code; the run is expensive
   and the benefit only applies when you're changing code that suite covers.

4. **Write the pre-existing failures section** — Use one of the two templates
   below. Place it in the plan after "Steps" and before "Relevant files". Do not
   omit it.

5. **Choose a validation command** — Consult the project's registered validation
   commands or its equivalent of the `validation-tiers` skill. Name the exact
   command that matches the scope of changes: use the lightest tier whose
   coverage is sufficient. Default to the mid-weight tier when uncertain. Add a
   `## Validation` section immediately after the pre-existing failures section.

### Required Planner announcement

Before writing the first heading of any plan, emit this exact line in your response:

```
[FAILURE-GATE] Discovery checklist complete. Pre-existing failures documented: <N>. Validation command: `<command>`.
```

This creates a visible, searchable audit trail in the conversation. A plan written
without this line was not gated.

---

### Plan section templates

**Pre-existing failures — when known:**

~~~markdown
## Pre-existing failures to ignore
These failures exist on `main` before this task starts. Do not investigate or fix them.

- **[suite / test name]** — [one-line description: what fails, why it is pre-existing]
- *(add additional entries as discovered during planning)*

**Flaky-test rule:** If a test not listed above fails, retry it 3× in isolation
before concluding it is a regression you caused. Only treat a consistent 3/3
failure as your responsibility.

If the only remaining failures are those listed above (plus any self-classified
failures — see the Failure Gate skill), you are cleared to mark this task
complete. Do not attempt further validation fixes.
~~~

**Pre-existing failures — when none found:**

~~~markdown
## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** If a test fails, retry it 3× in isolation before concluding
it is a regression you caused. Only treat a consistent 3/3 failure as your
responsibility.
~~~

**Validation section (always required):**

~~~markdown
## Validation
**Command:** `<exact command to run>`
**Why:** <one-line justification — what this command covers and why it fits the scope of this task>
**Do not escalate:** Run exactly this command. Pre-existing failures are
handled above — they are never a reason to run a heavier tier.
~~~

Default stub when the right tier is uncertain:

~~~markdown
## Validation
**Command:** `test-standard`
**Why:** <replace with one-line justification>
**Do not escalate:** Run exactly this command. Pre-existing failures are
handled above — they are never a reason to run a heavier tier.
~~~

---

### Validation section completeness

A `## Validation` section is **compliant** only when all three required inner
lines are present and filled:

1. **`**Command:**`** — must be present and its value must be one of the
   project's registered valid tier names. The lint guard, not the agent, is the
   authority on valid tier names; consult the project's registered validation
   commands when in doubt.

2. **`**Why:**`** — must be present and must not contain the auto-generated
   placeholder text (e.g. `<replace with one-line justification>`).

3. **`**Do not escalate:**`** — must be present and must not contain placeholder
   text.

A `## Validation` section that is present but fails either of the following
conditions is treated as non-compliant by the strict lint check:

- `**Command:**` is missing, or its value is not one of the project's registered
  valid tier names.
- `**Why:**` or `**Do not escalate:**` is absent or still contains
  auto-generated placeholder text.

The `--fix-stub` mode inserts missing required inner lines but cannot repair an
invalid tier value or fill in placeholder text — those always require a human.

---

### Pre-write guard (recommended hardening)

Two complementary patterns eliminate the round-trip to CI entirely by ensuring
every new plan file is born compliant:

- **Scaffolding helper** — A helper function or script that the agent calls when
  creating a new plan file pre-fills both required sections (`## Pre-existing
  failures to ignore` and `## Validation`) with valid stubs before writing the
  file to disk. No plan file is ever created without the required structure.

  **This project ships `scripts/new-plan.mjs`.** Always use it instead of
  creating plan files by hand:

  ```sh
  node scripts/new-plan.mjs <task-ref> \
    --title "Short descriptive title" \
    --why  "One-line justification for the validation tier" \
    [--tier test-standard]          # default: test-standard
    [--pre-existing "Suite › test — reason"]  # repeat for each known failure
    [--dry-run]                     # print without writing
  ```

  The `--why` argument is **required and must contain real text** — the script
  refuses to write the file if `--why` is absent or still contains a placeholder
  string. Every file produced by this script passes `check:failure-gate` (strict
  mode) immediately, with no manual backfill step required.

  Verify after creation:
  ```sh
  node scripts/check-failure-gate.mjs
  ```

- **Post-write hook** — Immediately after writing any plan file, the agent (or
  a commit hook) runs the lint guard in `--fix-stub` mode on that file. Any
  missing sections or incomplete `## Validation` inner lines are repaired in the
  same operation before the file is committed. The validation pipeline already
  wires this automatically (`fix:failure-gate-stubs` before `check:failure-gate`
  on every tier run).

Both patterns reduce the surface for stub-less files to accumulate between
sessions. They are most valuable in projects where many plan files are created
per session. Use both for defense in depth: `scripts/new-plan.mjs` prevents
stub-less creation; the pipeline auto-remediates any that slip through.

---

## Part 2 — Execute-time (Build agent)

<HARD-GATE>
Read the "Pre-existing failures to ignore" section at the start of every task
before touching any code. If either required section is missing from the plan,
add the appropriate stub now — then continue. Do not skip this step.

The validation command named in `## Validation` is the **ceiling**. Do not run
any heavier tier for any reason — including pre-existing failures, flaky retries,
or self-classification outcomes. Escalation is never the Build agent's call.

**`TASK_PLAN_FILE` is mandatory for every task-driven run.**  Set
`TASK_PLAN_FILE=.local/tasks/<name>.md` once at task start.  Every subsequent
`run-tier.mjs` call then enforces the ceiling automatically.  If `TASK_PLAN_FILE`
is not set and `--allow-no-plan` is not passed, `run-tier.mjs` exits 1 with a
`TIER-LOCK VIOLATION` before any step runs — the warning-and-continue path is
gone.  (The `--allow-no-plan` flag exists only for non-task ad-hoc runs such as
developer spot-checks; task agents must never pass it.)

For bare-shell callers that cannot use the env var, use
`scripts/run-locked-tier.mjs` directly — pass the plan file path; the script
resolves and runs the correct tier with no agent substitution surface.
</HARD-GATE>

When a test or validation gate fails, work through the following decision tree
in order. Do not skip steps.

---

### Tier-lock script (mechanical enforcement)

`scripts/run-locked-tier.mjs` is the required enforcement path for the
validation tier ceiling. Rather than accepting a tier name from the agent
(which could be substituted), it reads the `**Command:**` value directly from
the plan file, resolves it against `VALIDATION_COMMANDS` (the single source of
truth in `scripts/register-validation-commands.mjs`), and runs exactly that
command. There is no substitution surface. For the lighter-weight automatic
mechanism, set the `TASK_PLAN_FILE` environment variable once at task start —
`scripts/run-tier.mjs` will then enforce the ceiling on every tier invocation
without further agent action.

**Invocation:**

```sh
# Run the tier named in the plan file
node scripts/run-locked-tier.mjs <plan-file>

# Dry-run: print the resolved command without running it
node scripts/run-locked-tier.mjs --dry-run <plan-file>
```

**What it does:**

1. Reads the `## Validation` section of `<plan-file>`.
2. Extracts the backtick-quoted value from the `**Command:**` line.
3. Looks up that tier name in `VALIDATION_COMMANDS` (tiered entries only —
   those with a non-null `budgetKey`).
4. In `--dry-run` mode: prints the resolved command string and exits 0.
5. Otherwise: runs the command via `spawnSync` with inherited stdio and exits
   with the child process's exit code.

**Error cases (all exit 1 with a clear diagnostic message):**

- Plan file is missing or unreadable.
- `## Validation` section is absent from the plan file.
- `**Command:**` line is missing from the `## Validation` section.
- `**Command:**` line does not contain a backtick-quoted value.
- The quoted value is not a registered tier name in `VALIDATION_COMMANDS`.

**Single source of truth:** The script imports `VALIDATION_COMMANDS` from
`scripts/register-validation-commands.mjs`. It never maintains its own tier
list. Adding or removing a tier in `register-validation-commands.mjs` is
automatically reflected — no separate update required.

---

### Automatic tier-lock wiring (`TASK_PLAN_FILE`)

`scripts/run-tier.mjs` performs a **tier-lock pre-check** automatically at the
start of every tier run (i.e., every `test-fast`, `test-standard`, or
`test-standard-plus` invocation), before any validation step executes.

**How it works:**

1. Reads the `TASK_PLAN_FILE` environment variable.
2. If the variable is set, calls `run-locked-tier.mjs --dry-run <plan-file>`
   to extract the plan's intended tier without running it.
3. Maps the plan's tier name (e.g. `test-standard`) to the corresponding
   `run-tier.mjs` argument (e.g. `standard`).
4. If the tier being run does not match the plan's tier → **exits 1** with a
   clear `TIER-LOCK VIOLATION` message before any step runs.
5. If the plan file is absent, unreadable, or unparseable → logs a warning
   and **continues** (graceful degradation, so ad-hoc non-task runs are
   unaffected).

**How to use it:**

```sh
# Let the pre-check enforce the plan's tier automatically:
TASK_PLAN_FILE=.local/tasks/task-1234.md node scripts/run-tier.mjs standard

# Or let run-locked-tier.mjs choose AND run the tier:
node scripts/run-locked-tier.mjs .local/tasks/task-1234.md
```

When running via a registered `VALIDATION_COMMAND` (e.g. `test-standard`),
set `TASK_PLAN_FILE` in the shell environment before invoking the command:

```sh
export TASK_PLAN_FILE=.local/tasks/task-1234.md
# then trigger the validation command as normal
```

**Hard error for task invocations:** If `TASK_PLAN_FILE` is not set and
`--allow-no-plan` is not passed, `run-tier.mjs` exits 1 with a
`TIER-LOCK VIOLATION` message before any step runs.  Task agents must always
set `TASK_PLAN_FILE`.

**Opt-out for non-task callers:** Pass `--allow-no-plan` (or use
`scripts/run-validation-ad-hoc.mjs`) for ad-hoc developer runs and periodic CI
audits that legitimately do not have a plan file.  With the flag present and
`TASK_PLAN_FILE` absent, `run-tier.mjs` prints a one-line warning and continues.

---

### Decision tree

**Step 1 — Check the plan section.**

- Failure is explicitly listed → **skip it**. Do not investigate. Do not fix.
  Go to Step 5.
- Section says "None known" or failure is not listed → continue to Step 2.

---

**Step 2 — 3× retry rule.**

Run the failing test in isolation three times using the project's test runner
(e.g. `npx vitest run <file>`, `npx jest <file> --testNamePattern="<name>"`).

- Passes on any retry → it is a **flaky pre-existing failure**. Log it (see Step 4)
  and go to Step 5.
- Fails all three times → continue to Step 3.

---

**Step 3 — Self-classification gate (any two of three).**

You may self-classify a consistent 3/3 failure as pre-existing only if you can
demonstrate **at least two** of the following three factors:

| Factor | How to demonstrate it |
|---|---|
| **File untouched** | The failing test file is not in your changeset. Run `git diff --name-only` and confirm neither the test file nor any file it directly imports appears in the output. |
| **Fails on main** | Stash or revert your changes (`git stash`), re-run the failing test in isolation, confirm it still fails, then restore your changes (`git stash pop`). |
| **Documented pattern** | The failure matches a named entry in `.agents/memory/MEMORY.md` or a recently merged task description — cite the specific entry. |

- Two or more factors demonstrated → self-classify as pre-existing. Log it (Step 4).
  Go to Step 5.
- Fewer than two factors → **treat as a regression you caused**. Fix it before
  marking the task complete. Do not proceed to Step 5.

---

**Step 4 — Self-classification log (mandatory when self-classifying).**

Emit the following line in your task output for each self-classified failure.
This creates a visible record so the Planner can add it to future plans.

```
[SELF-CLASSIFIED PRE-EXISTING] <test name or suite> — evidence: <factor1>, <factor2>
```

Example:
```
[SELF-CLASSIFIED PRE-EXISTING] <suite name> › <test name> — evidence: file untouched (git diff clean), fails on main (stash-verified)
```

---

**Step 5 — Completion check.**

Once all remaining failures are either:
- Listed in the plan's "Pre-existing failures to ignore" section, **or**
- Self-classified with logged evidence (Step 4),

→ You are cleared to mark this task complete.

**Do not attempt further validation fixes.**

If you are tempted to run a heavier tier "to be sure", resist. The Planner
chose the ceiling; your job is to meet it, not raise it.

---

## Regression hardening

Both mandatory sections in every plan are themselves the guards. If an agent
starts a task and finds a section missing, it adds the appropriate stub — the
safe-direction fallback — before any other work. This means:

- A missing section is never silently ignored
- The default (treat everything as a regression; run the mid-weight tier) is
  conservative, not permissive
- Self-classification logs give the Planner the data to improve future plans

### Auto-remediate pipeline wiring

Wire a `--fix-stub` step unconditionally before the strict lint step in every
validation tier of the project's validation runner. The sequence is:

1. **Auto-remediate** — run the lint guard with `--fix-stub` (always exits 0;
   appends missing stubs and inserts missing required inner lines).
2. **Strict check** — run the lint guard in default (strict) mode. This now only
   fires on genuinely unfixable issues: invalid tier values or unfilled placeholder
   text that require human intervention.

Because `--fix-stub` is a no-op when all files are already compliant, this
wiring is safe to run unconditionally on every tier without side effects.

When `TASK_PLAN_FILE` is set, scope the `--fix-stub` pass to the single file
it names rather than the full archive. This prevents the auto-remediate step
from needlessly rewriting pre-mandate files on every task run — the fix-stub
pass only touches the file the current task actually owns.

**Bulk remediation:** If a backlog of stub-less plan files is blocking CI (e.g.
after adopting the lint guard on an existing archive of plans), run `--fix-stub`
in bulk across the plan directory first, commit the result, then address any
remaining invalid-tier or unfilled-placeholder failures manually. Do not attempt
to fix hundreds of files by hand before enabling the strict check.

### Secondary mechanisms

Task-triage spot-checks (verifying that merged plans contain both sections and
that `## Validation` content is meaningful) remain a secondary mechanism for
plan quality review — useful for catching files that slipped through before the
lint guard was wired. They are not the primary guard; the auto-remediate + strict
pipeline is.

---

## Reference

- Known-flaky patterns: `.agents/memory/MEMORY.md`
- Canonical skill (tracked): `.agents/skills/failure-gate/SKILL.md`
- Lint guard: the project's plan-file lint guard script (e.g. `scripts/check-failure-gate.mjs`)
- Tier-lock script: `scripts/run-locked-tier.mjs` — mechanical tier enforcement; pass plan file path
- `TASK_PLAN_FILE` env var: set to `.local/tasks/<name>.md` at task start; `run-tier.mjs` reads it automatically and enforces the plan's tier ceiling on every invocation
- Session mandate: the project's session mandate (e.g. `replit.md` § "Agent rules")
