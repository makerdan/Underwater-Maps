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

This rule is enforced at three independent layers — all three must stay in sync:

| Layer | File | What it does |
|---|---|---|
| 0 — Session mandate | the project's session mandate (e.g. `replit.md` § "Agent rules") | Loaded at every Planner session start; contains the project's hard-gate checklist and any project-specific known-flaky patterns |
| 1 — Skill definition | `.agents/skills/failure-gate/SKILL.md` (this file) | Defines discovery checklist, templates, decision tree |
| 2 — Lint guard | the project's plan-file lint guard (e.g. `scripts/check-failure-gate.mjs`) | Scans the plan directory and fails if any plan omits a required section |

A change to the rule must be applied to all three layers in the same task.

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
~~~

Default stub when the right tier is uncertain:

~~~markdown
## Validation
**Command:** `test-standard`
**Why:** <replace with one-line justification>
~~~

---

## Part 2 — Execute-time (Build agent)

<HARD-GATE>
Read the "Pre-existing failures to ignore" section at the start of every task
before touching any code. If either required section is missing from the plan,
add the appropriate stub now — then continue. Do not skip this step.
</HARD-GATE>

When a test or validation gate fails, work through the following decision tree
in order. Do not skip steps.

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

---

## Regression hardening

Both mandatory sections in every plan are themselves the guards. If an agent
starts a task and finds a section missing, it adds the appropriate stub — the
safe-direction fallback — before any other work. This means:

- A missing section is never silently ignored
- The default (treat everything as a regression; run the mid-weight tier) is
  conservative, not permissive
- Self-classification logs give the Planner the data to improve future plans

Compliance spot-checks (verifying that merged plans contain both sections) are
handled by the task-triage skill and dedicated audit tasks.

---

## Reference

- Known-flaky patterns: `.agents/memory/MEMORY.md`
- Canonical skill (tracked): `.agents/skills/failure-gate/SKILL.md`
- Lint guard: the project's plan-file lint guard script (e.g. `scripts/check-failure-gate.mjs`)
- Session mandate: the project's session mandate (e.g. `replit.md` § "Agent rules")
