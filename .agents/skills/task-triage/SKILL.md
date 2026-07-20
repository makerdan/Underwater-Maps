---
name: task-triage
description: >-
  Audit all PROPOSED (draft) tasks, mark stale or superseded ones for deletion,
  consolidate related tasks, and add regression hardening to survivors. Use when
  the backlog has grown stale, before planning a new feature batch, or when the
  user says "clean up tasks", "audit drafts", or "prune backlog".
---

# Task Triage

A structured backlog-pruning procedure that audits all PROPOSED tasks, eliminates stale or superseded work, consolidates related tasks into actionable bundles, and hardens survivors with regression coverage requirements. Run this before starting any new feature batch to keep the backlog lean and coherent.

## When to Invoke

Trigger phrases: "clean up tasks", "audit drafts", "prune backlog", "too many open tasks", "which tasks are still relevant", post-sprint cleanup, before starting a new feature batch.

---

## Phase 0 — Re-run guard

Before doing anything else, fetch the full PROPOSED list.

**Orphan-recovery check (run first):** Scan PROPOSED tasks for any whose title starts with `CONSOLIDATION - `. For each one found, parse its description to extract the original task refs it covers (they are cited by ref in the "What & Why" section of the consolidation task). For each cited original task that still exists and does not yet have a `DELETE - ` prefix, immediately call `updateProjectTask({taskRef, title:"DELETE - <original title>"})` to prefix it. Report how many orphaned originals were repaired (may be zero). This makes partial-run recovery fully automatic on re-run.

**Skip check (run after orphan recovery):** Skip (do not process) any task whose title already starts with `DELETE - ` or `CONSOLIDATION - `. Log how many were skipped. If all remaining tasks are already prefixed, print the summary table and stop.

---

## Phase 1 — Gather inputs

Collect the following in parallel:

- All PROPOSED tasks with descriptions: `listProjectTasks({state:"PROPOSED", includeDescription:true})`
- All active tasks (PENDING + IN_PROGRESS) with descriptions: `listProjectTasks({state:"PENDING", includeDescription:true})` and `listProjectTasks({state:"IN_PROGRESS", includeDescription:true})`
- All recently MERGED tasks (titles only): `listProjectTasks({state:"MERGED"})`
- For each PROPOSED task, extract: component/subsystem keywords from title and description, any file paths mentioned in the description, any test fixture names mentioned

---

## Phase 2 — Domain clustering

Before making any DELETE/CONSOLIDATE decisions, group all PROPOSED tasks into domain clusters by subsystem (e.g., "GPS import", "nodata color", "terrain rendering", "ETA display"). Two tasks belong to the same cluster if:

- Their titles share a key noun or component name, **or**
- Their descriptions reference the same file path or test fixture name, **or**
- Both mention the same UI panel, API endpoint, or store

Tasks within a cluster are the primary consolidation candidates. List the clusters before proceeding to Phase 3.

---

## Phase 3 — Active task cross-check

For each PROPOSED task, search the titles **and descriptions** of all PENDING + IN_PROGRESS tasks for overlapping component names, file paths mentioned, or keywords. A match means the active task is already covering that ground. Record the matching active task ref for use in the reasoning column.

---

## Phase 4 — Dependency chain check

Before marking any task DELETE, call `getProjectTask({taskRef})` on its dependents (if any are known from the `dependsOn` field of other tasks). If a PROPOSED task has one or more downstream PROPOSED dependents, do not silently delete it — instead flag it as "DELETE (check dependents: #X, #Y)" and note the orphan risk in the reasoning column.

---

## Phase 5 — Decision pass (dry run only — no mutations yet)

Apply these rules to every non-skipped PROPOSED task and record the decision in a local table. **Do not call `updateProjectTask` yet.**

### DELETE — apply when any of the following is true

- A MERGED task already addressed the same bug/feature (cite the task ref)
- A PENDING or IN_PROGRESS task is already doing the same work (cite the task ref found in Phase 3)
- The task describes a one-off investigation whose finding is captured in a memory entry or comment
- The affected code no longer exists (verify by grepping for the component/file named in the description)

### CONSOLIDATE — apply when two or more PROPOSED tasks

- Fall in the same domain cluster (Phase 2), **and**
- Share a component, file path, or test fixture in their descriptions, or would create conflicting changes if executed concurrently

**Consolidation size rule:** if a cluster has more than 5 original tasks, split into multiple consolidation tasks of ≤5 steps each rather than one large task. Each consolidation task gets a separate "CONSOLIDATION - " entry.

### LEAVE ALONE — apply when

The task stands alone, is independently valuable, and no active work supersedes it.

Every decision row **must** include a one-sentence reason (e.g., "superseded by #2702 (MERGED)", "shares GpsImportDialog fixture with #2667").

---

## Phase 6 — Dry-run summary and user confirmation

Print the full decision table **before making any mutations**:

| Task | Title (truncated) | Action | Reason |
|------|-------------------|--------|--------|
| #XXXX | ... | DELETE / CONSOLIDATE into #NEW / LEAVE | one sentence |

After printing the table, call `user_query` to ask the user to confirm before proceeding. If rejected, stop — make no mutations.

---

## Phase 7 — Apply mutations (only after confirmation)

In this order:

1. Call `bulkCreateProjectTasks` for all CONSOLIDATION tasks. Each consolidation task plan must:
   - Start the title with `CONSOLIDATION - `
   - Include all original goals as numbered steps
   - End with a **Regression hardening** section (see format below)
   - Be split across multiple tasks if total steps exceed 5
2. Rename all DELETE-marked originals by prepending `DELETE - ` via `updateProjectTask({taskRef, title:"DELETE - <original title>"})`. Batch these calls.
3. Rename the original tasks of each consolidation group the same way (prepend `DELETE - `). Batch these calls.
4. Call `proposeProjectTasks` with the new consolidation task refs so the user can accept them.

**Important:** Steps 2 and 3 (all `updateProjectTask` rename calls) must run **before** `proposeProjectTasks`. `proposeProjectTasks` pauses the agent loop; any mutation placed after it will not execute in the same run.

---

## Regression hardening format

Each consolidation task's hardening section must have one bullet per scenario. Each bullet must contain all three of:

- **Tier**: `test-fast`, `test-standard`, or `test-heavy`
- **Test**: the existing test file path to extend, or a description of the new test to add
- **Guards against**: the specific failure mode (e.g., "silent 500 when pino-http mock is missing", "counter resets to 0 on cancel mid-batch")

Minimum two bullets per consolidation task. Vague entries like "add a test for this" are not acceptable.

### Example hardening section

```markdown
## Regression hardening

- **Tier**: `test-standard` | **Test**: `artifacts/api-server/src/__tests__/markers.test.ts` | **Guards against**: POST /api/markers returning 500 when the pino-http logger mock is absent from the test setup
- **Tier**: `test-heavy` | **Test**: `artifacts/bathyscan/e2e/gps-import.spec.ts` | **Guards against**: column mapping silently reverting to stale headers after a file with a different header row is uploaded mid-session
```

---

## Phase 8 — Output summary

Print a final markdown table and a three-line summary:

```
Deleted:       N tasks
Consolidated:  N tasks into M consolidation tasks
Left alone:    N tasks
Skipped (already prefixed): N tasks
```

---

## Safety rules

- **Never mutate before user confirmation** — Phase 5 is analysis only; Phase 7 requires explicit approval from Phase 6.
- **Never touch PENDING, IN_PROGRESS, IMPLEMENTED, or MERGED tasks** — scope is PROPOSED only.
- **Re-run safe** — tasks already prefixed `DELETE - ` or `CONSOLIDATION - ` are always skipped in Phase 0.
- **Orphan check first** — never DELETE a task with downstream dependents without flagging the orphan risk.
- **Never place `updateProjectTask` rename calls after `proposeProjectTasks`** — `proposeProjectTasks` pauses the agent loop; any mutation placed after it will not execute in the same run. All renames must complete before `proposeProjectTasks` is called.
