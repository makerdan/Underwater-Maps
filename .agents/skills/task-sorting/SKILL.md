---
name: task-sorting
description: >-
  Classify and tier all PROPOSED (draft) tasks by importance — Tier 1 (do
  first), Tier 2 (do soon), Tier 3 (do later) — then rename each task to
  include its tier label as a title prefix. Deletable tasks (including any
  whose title starts with "Confirm") are prefixed "DELETE - " instead of
  receiving a tier. Use this whenever the user wants to prioritize tasks,
  sort the backlog by importance, rank drafts, decide what to work on next,
  or says "tier the tasks", "sort tasks", "which tasks are most important",
  "prioritize the backlog", or "what should I do first". Also invoke it
  after running Task Triage to assign priority order to the survivors.
---

# Task Sorting

> **No code changes.** This skill makes no code changes. Do not run any
> validation command (test-fast, test-standard, test-heavy, typecheck, lint)
> at any point during execution.

A structured backlog-prioritization procedure. It reads all PROPOSED tasks,
classifies each as Tier 1 / Tier 2 / Tier 3 by importance, marks deletable
tasks for removal, then renames every task with the appropriate prefix after
the user confirms the plan.

Run this after Task Triage (so the backlog is already pruned), or standalone
on any PROPOSED list.

---

## Prefix conventions

| Label | Title prefix applied | Meaning |
|-------|---------------------|---------|
| Tier 1 | `Tier 1: ` | Critical — do first |
| Tier 2 | `Tier 2: ` | Important — do soon |
| Tier 3 | `Tier 3: ` | Nice-to-have — do later |
| Delete | `DELETE - ` | Should not be executed |

> **Consistency with Task Triage:** Task Triage uses `DELETE - ` (with a
> hyphen-space) for its delete prefix. This skill uses the same format so
> the two skills stay compatible and re-run-safe against each other.

---

## Phase 0 — Re-run guard and prefix normalisation

**Step 0 — Capture snapshot.** Before anything else, call `queryProjectTasks` with `states: ["PROPOSED"]` and record the complete list of returned `taskRef` values as the immutable working set for this run. Log the count (e.g. "Snapshot captured: 42 PROPOSED tasks"). This snapshot is frozen — all subsequent phases operate exclusively on refs present in this list. Any task that becomes PROPOSED after this point is out of scope for the current run.

Then fetch descriptions for all tasks in the snapshot.

**Orphan-recovery check (run before Step A):** Scan the snapshot for any task whose title starts with `CONSOLIDATION - `. For each one found, extract all task refs from its description using the pattern `#\d+` (match every token of the form `#` followed by one or more digits, anywhere in the description — do **not** restrict the search to a named section, because template drift would silently suppress matches). For each extracted ref that is present in the Phase 0 snapshot and resolves to a PROPOSED task whose title does not yet start with `DELETE - `, immediately call `updateProjectTask({taskRef, title:"DELETE - <original title>"})` to prefix it. **Only act on refs present in the Phase 0 snapshot** — do not modify any task whose ref was not captured at snapshot time, even if it appears in a CONSOLIDATION task's description and is currently PROPOSED. Report how many orphaned originals were repaired (may be zero).

**Step A — Skip already-handled tasks.** For each task whose title starts
with `DELETE - ` (case-sensitive), skip it entirely — it is already marked
for removal by a prior run of this skill or Task Triage.

**Step B — Strip stale tier prefixes.** For tasks whose title starts with
`Tier 1: `, `Tier 2: `, or `Tier 3: ` (from a prior run of *this* skill),
strip the prefix from the working copy of the title before re-classifying.
Do **not** call `updateProjectTask` yet — this is local bookkeeping only.
Record how many titles were normalised.

**Step C — Translate Task Triage T1 labels.** For tasks whose title starts
with `T1: ` (the prefix applied by Task Triage's Phase 7), note them as
strong Tier 1 candidates in the working table. Strip `T1: ` from the working
title. Do not call `updateProjectTask` yet.

**Step D — CONSOLIDATION tasks are in scope.** Tasks whose title starts with
`CONSOLIDATION - ` are NOT skipped. They represent real, actionable work and
must be classified like any other task.

**Early exit:** If every non-skipped task was already prefixed and no new
work remains, print a short summary table and stop.

---

## Phase 1 — Gather active and merged context

Only process refs present in the Phase 0 snapshot; ignore any task ref not in that list.

Collect in parallel:

- All PROPOSED tasks (already fetched in Phase 0)
- Titles of all PENDING and IN_PROGRESS tasks — used to detect supersedence
- Titles of all recently MERGED tasks — used to detect completed work

---

## Phase 2 — DELETE pass

Only evaluate task refs present in the Phase 0 snapshot; silently ignore any ref not in the snapshot.

For each non-skipped PROPOSED task, apply the following DELETE criteria in
order. The first criterion that matches is the reason; stop checking further
criteria once one matches.

### DELETE criteria

1. **"Confirm" leading word** — The very first word of the (normalised)
   title is `confirm`, case-insensitive, as a whole word. `Reconfirm`,
   `Unconfirm`, `Confirming` do **not** qualify. Reason string: "title
   starts with 'Confirm'".

2. **Superseded by merged work** — A MERGED task title contains the same
   component name, bug description, or feature keyword as this task's title
   or description. Reason string: "covered by #XXXX (MERGED)".

3. **Already in progress** — A PENDING or IN_PROGRESS task already addresses
   the same component and goal. Reason string: "in progress as #XXXX".

4. **Refers to removed code** — The task's description names a specific
   file path or component. Run `grep -r` for it; if nothing is found,
   flag as potentially stale. Mark DELETE only if confident the target is
   gone — when uncertain, classify instead. Reason string: "target
   '<name>' not found in codebase".

5. **One-off investigation already resolved** — The task describes a
   one-time investigation and the finding is captured in a memory entry or
   inline comment in a related file. Reason string: "investigation resolved,
   finding in memory".

### Dependent-orphan guard

Before finalising any DELETE decision, check whether any other PROPOSED task
lists this task in its `dependsOn` field. If yes, do not silently delete it —
keep the DELETE decision but append `(check dependents: #X, #Y)` to the
reason string so the user can review the downstream impact.

Record all DELETE decisions in the working table. Do **not** call
`updateProjectTask` yet.

---

## Phase 3 — Dependency graph

Only include task refs present in the Phase 0 snapshot; refs not in the snapshot are excluded from both maps even if referenced in `dependsOn` fields.

Build two maps from the `dependsOn` fields of all surviving (non-DELETE)
PROPOSED tasks:

- **prereqs[task]**: the set of task refs this task depends on
- **dependents[task]**: the set of task refs that depend on this task

These maps drive tier classification and cascade promotion in Phase 4.

---

## Phase 4 — Tier classification (dry run only)

Only classify task refs present in the Phase 0 snapshot; silently ignore any ref not in the snapshot.

Classify every surviving (non-DELETE) task. Record the tier and a one-
sentence reason in the working table. Do **not** call `updateProjectTask` yet.

### Tier 1 — Critical, do first

Assign Tier 1 if **any** of the following is true:

- The task appears in `prereqs[T]` for at least one other surviving task
  (i.e., something depends on it). Reason: "prerequisite for #XXXX".
- The task's title or description references a broken test gate, failing CI
  pipeline, typecheck error, or a validation failure that blocks every run.
  Reason: "fixes broken CI gate".
- The task's title or description references a production regression, data
  corruption risk, data loss risk, or security vulnerability.
  Reason: "production correctness / security".
- The task carried a `T1:` prefix from a prior Task Triage run (noted in
  Phase 0). Reason: "previously flagged T1 by Task Triage".
- Completing this task is a stated prerequisite for a user-identified
  feature milestone (evident from the description). Reason: "stated
  milestone prerequisite".

### Tier 2 — Important, do soon

Assign Tier 2 if **all** of the following are true:

- Does not meet any Tier 1 criterion.
- Delivers a user-visible feature, meaningful UX improvement, or a
  data-correctness fix that a user would notice.
- Has no unsatisfied `dependsOn` prerequisites still in the PROPOSED state
  (i.e., it can start immediately).

### Tier 3 — Nice to have

Assign Tier 3 to everything else: polish, smoke-test additions, refactoring
with no user-visible impact, speculative improvements, and tasks that have
unsatisfied PROPOSED prerequisites.

### Dependency cascade promotion

After the initial classification pass, run a cascade loop:

```
repeat until no changes:
  for each Tier 1 task T:
    for each task P in prereqs[T]:
      if P is classified Tier 2 or Tier 3:
        reclassify P as Tier 1
        reason: "promoted — prerequisite for Tier 1 task #T"
```

This ensures you never have a Tier 1 task whose own prerequisites are buried
at Tier 2 or 3. Log each promotion as a cascade event so the user can see
the chain.

---

## Phase 5 — Dry-run summary and user confirmation

Print the full decision table **before making any mutations**:

| Task | Title (normalised, truncated to 60 chars) | Tier / Action | Reason |
|------|-------------------------------------------|---------------|--------|
| #XXXX | … | Tier 1 / Tier 2 / Tier 3 / DELETE | one sentence |

Show cascade promotions as a separate block:

```
Cascade promotions:
  #XXXX promoted Tier 3 → Tier 1 (prerequisite for Tier 1 task #YYYY)
```

After printing the table, ask the user to confirm before proceeding. If the
user rejects or modifies the plan, update the working table accordingly and
do not proceed until they approve.

---

## Phase 6 — Apply mutations (only after confirmation)

Only rename task refs present in the Phase 0 snapshot; silently ignore any ref not in the snapshot.

Apply all renames in a single batch. Order matters — follow the sequence
below exactly.

**Step 1 — Apply DELETE renames.**
For each DELETE task, call:
```
updateProjectTask({ taskRef, title: "DELETE - <normalised title>" })
```
Batch all DELETE renames together and complete them before proceeding.

**Step 2 — Apply Tier renames.**
For each surviving task (Tier 1, 2, or 3), call:
```
updateProjectTask({ taskRef, title: "Tier N: <normalised title>" })
```
where N is 1, 2, or 3. The normalised title is the working-copy title
from Phase 0 (with any old `Tier N:` or `T1:` prefix already stripped).

Batch all tier renames together and complete them before reporting.

> **Why order matters:** all `updateProjectTask` calls must complete before
> any task-surfacing or summary output. Do not interleave renames with
> summary output.

---

## Phase 7 — Output summary

Print a final summary:

```
Snapshot size at start: N tasks
Tier 1 (critical):    N tasks
Tier 2 (important):   N tasks
Tier 3 (later):       N tasks
Marked DELETE:        N tasks
Skipped (already DELETE): N tasks
Cascade promotions:   N tasks
```

Then surface the Tier 1 tasks using `surfaceProjectTasks` so they appear
prominently in the conversation feed.

---

## Safety rules

- **Never mutate before user confirmation** — Phases 0–5 are analysis only;
  Phase 6 requires explicit approval.
- **Never touch PENDING, IN_PROGRESS, IMPLEMENTED, or MERGED tasks** — scope
  is PROPOSED only.
- **Re-run safe** — tasks already prefixed `DELETE - ` are always skipped.
  Tasks with `Tier N:` or `T1:` prefixes are normalised in-memory and
  re-evaluated, not double-prefixed.
- **DELETE - prefix format** — always use `DELETE - ` (hyphen-space, matching
  Task Triage) not `DELETE: ` or `DELETE:` to keep the two skills compatible.
- **Dependent-orphan guard** — never silently delete a task that other
  PROPOSED tasks depend on; flag the dependency in the reason string.
- **Cascade transparency** — always log every cascade promotion so the user
  can trace why a task was elevated to Tier 1.
- **No validation commands** — this skill makes no code changes; never
  invoke test-fast, test-standard, test-heavy, typecheck, or lint.
- **Normalise before applying** — always strip any prior `Tier N:` or `T1:`
  prefix from the working title before applying a new one, to prevent
  compounding prefixes like `Tier 1: T1: Tier 2: ...`.
- **Snapshot scope** — the working set is frozen at the start of Phase 0;
  tasks that become PROPOSED after the snapshot is taken are not in scope for
  the current run and must never be renamed or evaluated.
