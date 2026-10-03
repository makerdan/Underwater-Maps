---
name: task-triage
title: Task Triage
description: Clean, consolidate, and prioritize all PROPOSED project tasks in one confirmed workflow. Use when the user asks to triage, prune, consolidate, sort, tier, prioritize, or decide what backlog work should happen next.
---

# Task Triage

Clean and prioritize a draft backlog in one workflow. Preserve only work that
meaningfully improves the program within the current planning horizon.

## Planning horizon

The current planning horizon is the next two weeks of task execution. Work that
could not reasonably begin within those two weeks is outside the current
planning horizon. Being outside the horizon is a low-urgency signal, not
sufficient evidence for DELETE by itself.

## Non-negotiable rules

- Make no product-code changes.
- Run no validation, typecheck, lint, build, or test commands.
- Operate only on tasks that were PROPOSED when the initial snapshot was taken.
- Recheck state immediately before every mutation. Never mutate a task that is
  no longer PROPOSED.
- Make no mutations before the user approves the complete dry-run plan.
- Treat similarity as evidence for review, never as sufficient reason to
  consolidate tasks.
- This workflow never deletes task records. `DELETE` means applying the
  `DELETE - ` title prefix so the task can be reviewed or removed later.
- Do not assume a framework, language, architecture, product domain, test
  runner, or repository layout.

## Canonical title prefixes

- `DELETE - ` — work that should not be executed
- `Tier 1: ` — critical or prerequisite work to do first
- `Tier 2: ` — important work to do soon
- `Tier 3: ` — lower-value or non-urgent work to do later
- `CONSOLIDATION - ` — work combining a coherent set of near-term outcomes

A tiered consolidation title uses:

```text
Tier N: CONSOLIDATION - <base title>
```

### Deterministic title parser

Parse every title in this exact order:

1. Strip at most one leading `DELETE - `.
2. Strip at most one leading `Tier N: `, where N is 1, 2, or 3.
3. Detect and strip at most one leading `CONSOLIDATION - `.
4. Trim surrounding whitespace.
5. Preserve the result as the immutable base title used for all planned
   renames.
6. Scan the remainder for recognized leading prefixes. If any remain, or if a
   recognized prefix appears in a malformed form, flag the task for user review
   and do not mutate it automatically.

Store parsed status, tier, kind, and base title separately. Never compound
prefixes on reruns.

## Outcomes

Every non-skipped task receives exactly one outcome:

- `DELETE`
- `CONSOLIDATE`
- `KEEP — Tier 1`
- `KEEP — Tier 2`
- `KEEP — Tier 3`

Planned consolidation tasks are virtual survivors during analysis. Assign their
final tiers before approval. Only Tier 1 and Tier 2 virtual consolidations may
be created as active tasks. Do not create, surface, or propose Tier 3
consolidations.

## Phase 1 — Freeze and normalize

1. Fetch all PROPOSED tasks with descriptions, dependencies, and refs.
2. Freeze their refs as the immutable snapshot for this run.
3. Verify each snapshot task's current state and drop anything no longer
   PROPOSED.
4. Skip tasks already marked `DELETE -`.
5. Normalize recognized prefixes in memory without mutating titles.
6. Recognize existing consolidation tasks after normalization, including when a
   tier prefix precedes `CONSOLIDATION -`.
7. For every existing consolidation task, extract every bare task ref matching
   `#` followed by digits from its description. Detect:
   - Covered originals that remain unprefixed after an interrupted run.
   - Duplicate consolidations covering the same original set.
   - Consolidations that include themselves or other invalid refs.
   - Existing consolidations being reconsidered together with their originals.

Add valid interrupted-run repairs to the dry run. Do not mutate during
recovery. Never reconsolidate an existing consolidation with an original it
already covers.

Tasks that become PROPOSED after the snapshot are out of scope.

## Phase 2 — Gather evidence once

Collect, preferably in parallel:

- Snapshot task titles, descriptions, dependencies, and metadata.
- PENDING and IN_PROGRESS tasks that may already cover proposed work.
- Recently completed tasks that may have superseded proposed work.
- Current project evidence needed to verify that named targets still exist.
- Available user goals, milestones, deadlines, and planning horizon.

For each task, identify:

- Intended outcome and affected behavior.
- User, operational, correctness, security, reliability, maintainability, or
  delivery benefit.
- Urgency and relevance to the current planning horizon.
- Cost, risk, and regression surface.
- Prerequisites and dependents.
- Overlap with active, completed, or other proposed work.

Do not infer urgency merely because a task exists.

## Phase 3 — Preliminary value and priority signals

Before deletion or consolidation, record read-only signals:

- Blocks other valuable work.
- Repairs a broken delivery or validation gate.
- Prevents material security, privacy, data-loss, corruption, or
  production-correctness risk.
- Directly enables a stated near-term milestone.
- Produces meaningful user-visible or operational value.
- Reduces a current material reliability or maintenance cost.
- Has no demonstrated present need and belongs to an indefinite future.
- Is speculative, cosmetic, duplicative, or disproportionately expensive for
  its likely benefit.

These signals inform triage. They are not final tiers or title mutations.

## Phase 4 — Structural triage

Evaluate every non-skipped snapshot task in this order.

### Delete

Choose `DELETE` only when supported by concrete evidence. Acceptable evidence
includes direct supersedence, verified target absence, an explicit mismatch
with a current goal, a documented cost-versus-benefit judgment, or the absence
of any concrete beneficiary, failure mode, milestone, or measurable
improvement. Low urgency, age, or placement outside the two-week planning
horizon is never sufficient by itself.

Apply DELETE when the evidence supports one of these findings:

- The normalized title's first whole word is `Confirm`, case-insensitive.
- Completed or active work already covers the same outcome.
- The target no longer exists.
- A one-time investigation is resolved and its useful conclusion is durably
  captured.
- The task is speculative or unsupported by any concrete current or foreseeable
  user, product, operational, correctness, security, reliability,
  maintainability, or delivery need.
- Its likely benefit is too small for its implementation, coordination, or
  regression cost, with the judgment explained.
- No concrete beneficiary, failure mode, milestone, measurable improvement, or
  foreseeable condition justifies retaining it.

Before finalizing deletion, identify surviving PROPOSED dependents. Keep the
DELETE outcome visible, but include dependent refs and orphan risk in the
reason.

Deletion removes the item from the actionable draft backlog. It does not claim
that the idea could never become valuable under future conditions.

### Keep

Choose `KEEP` when the task is independently valuable in the current planning
horizon and should not be merged into another outcome.

### Low urgency versus insufficient value

- A task has **low urgency** when it has demonstrated value but cannot
  reasonably begin within the next two weeks or is legitimately behind more
  important work. Keep it and consider Tier 3.
- A task has **insufficient value** when the stronger DELETE evidence threshold
  is met. Mark it DELETE.
- Every Tier 3 reason must name the concrete value that prevented deletion.

### Consolidation candidacy

A task becomes a consolidation candidate only after it passes the KEEP
standard. Never consolidate weak work merely because it touches the same area
as valuable work.

## Phase 5 — Outcome-based consolidation

Cluster only Phase 4 survivors. Shared files, components, interfaces, or
subsystems are discovery signals, not proof that tasks belong together.

Create a consolidation group only when every member:

1. Would make the program meaningfully better in the current planning horizon.
2. Is important enough to execute soon.
3. Contributes directly to one coherent outcome.
4. Can be implemented together without speculative scope.
5. Provides benefit proportionate to implementation and regression cost.

For every proposed group, answer:

```text
Would completing every included item in the current planning horizon produce a
more valuable, coherent result than executing the valuable items separately?
```

- If yes, create a virtual consolidation task.
- If only some members pass, consolidate the valuable subset and mark weak
  members DELETE.
- If members share an implementation location but not an outcome, keep the
  valuable members separate.
- Split groups that are too broad to remain reviewable and executable.
- If a virtual consolidation is ultimately Tier 3, do not create it. Return its
  valuable originals to independent KEEP classification, assign their
  individual tiers, and rename each surviving original with its own final
  `Tier N: ` prefix after approval. An original that remains Tier 3 must be
  renamed `Tier 3: <preserved base title>` and remain an individual backlog
  task. Do not create, propose, or surface a replacement Tier 3 consolidation.
  Leave Tier 2 originals unsurfaced unless the user separately asks to surface
  existing Tier 2 work; surface originals that independently qualify as Tier 1.

Each consolidation may contain at most four original tasks and at most four
independently verifiable implementation steps. Split larger groups by outcome
or dependency boundary. Never omit an accepted goal merely to fit the ceiling.

Each virtual consolidation task must:

- Cite every covered original by task ref.
- Preserve accepted goals as concrete implementation steps.
- Explain the unified outcome and why it matters now.
- State relevant dependencies.
- Include at least two falsifiable regression scenarios without assuming
  project-specific commands or layouts.

### Stable consolidation description schema

Use this exact section structure:

```markdown
## Outcome
<The unified result and why it matters within the current planning horizon.>

## Covered tasks
- #123
- #456

## Implementation steps
1. <Independently verifiable step>
2. <Independently verifiable step>

## Dependencies
- <External prerequisite ref or "None">

## Regression hardening
- **Scenario or failure mode:** <specific condition>
  **Verification approach:** <how the behavior will be checked>
  **Specific behavior guarded:** <exact behavior or contract>
  **Expected result:** <observable passing result>
- **Scenario or failure mode:** <specific condition>
  **Verification approach:** <how the behavior will be checked>
  **Specific behavior guarded:** <exact behavior or contract>
  **Expected result:** <observable passing result>
```

The Covered tasks section must contain every original as a bare `#<digits>`
token. Do not replace refs with links, aliases, ranges, or prose-only mentions.
The description must contain no more than four covered refs and no more than
four implementation steps.

### Consolidation dependency plan

For every virtual consolidation:

1. Union all prerequisites external to the group and assign them to the new
   consolidation.
2. Remove dependencies whose prerequisite and dependent are both inside the
   group.
3. Plan to replace each surviving task dependency on a covered original with a
   dependency on the new consolidation.
4. Check the resulting graph for self-dependencies and cycles.
5. If dependency rewriting is unavailable, unsupported, cyclic, or fails, do
   not mark affected originals DELETE. Report the blocked consolidation.

## Phase 6 — Final prioritization

Prioritize all independent KEEP tasks and virtual consolidation tasks.

Only Tier 1 and Tier 2 virtual consolidations remain eligible for creation.
Tier 3 virtual consolidations must be dissolved back into their original
valuable tasks before the dry run. Classify every returned original
independently as Tier 1, Tier 2, Tier 3, or DELETE. After approval, apply the
resulting individual prefix to each original; do not leave a returned original
with an old or missing tier prefix.

### Tier 1 — Do first

Assign Tier 1 when any applies:

- Another surviving task depends on it.
- It restores a broken delivery or validation gate.
- It addresses material security, privacy, data-loss, corruption, or
  production-correctness risk.
- It is required for a stated near-term milestone.

### Tier 2 — Do soon

Assign Tier 2 when the task is ready to start and provides meaningful current
user, operational, correctness, reliability, maintainability, or delivery value
without meeting Tier 1.

### Tier 3 — Do later

Assign Tier 3 to worthwhile surviving work that is less urgent, has unmet
prerequisites, or provides secondary improvement.

Work that cannot reasonably begin within the next two weeks may be Tier 3 when
it has demonstrated foreseeable value. Do not use Tier 3 to retain work that
meets the stronger insufficient-value DELETE threshold. Every Tier 3 reason
must identify the concrete value that justifies retention.

### Dependency cascade

Repeatedly promote prerequisites of Tier 1 work to Tier 1 until no further
promotion is needed. Record every promotion and its dependency reason.

## Phase 7 — Dry run and approval

Present the complete plan before mutation:

| Task | Normalized title | Outcome | Final tier | Reason |
|------|------------------|---------|------------|--------|
| ref | title | DELETE / CONSOLIDATE / KEEP | Tier 1 / Tier 2 / Tier 3 / — | one specific sentence |

Also show:

- Proposed Tier 1 and Tier 2 consolidation tasks, covered refs, unified
  outcomes, and steps.
- Dissolved Tier 3 consolidation candidates and the final classifications of
  every original, including the exact individual title prefix to apply.
- Planned prerequisite inheritance and dependency rewrites for every
  consolidation.
- Tasks removed from candidate groups for low value or distant timing.
- Interrupted-run repairs and duplicate-consolidation findings.
- Dependency-orphan warnings.
- Tier cascade promotions.
- Snapshot, dropped, skipped, deleted, consolidated, and kept counts.

Ask for one explicit approval covering the entire mutation plan. If the user
rejects or revises it, update the dry run and ask again. Do not mutate until
approved.

## Phase 8 — Apply approved mutations

Immediately before each mutation, verify that every affected existing task is
still PROPOSED. Skip changed tasks and report them in the summary.

Apply operations in this order:

1. Recheck every member of each consolidation group. If any member is no longer
   PROPOSED, block and re-evaluate the whole group rather than creating a
   partial consolidation.
2. Create only approved Tier 1 and Tier 2 consolidation tasks, using final
   `Tier 1: CONSOLIDATION - ` or `Tier 2: CONSOLIDATION - ` titles and complete
   descriptions. Never create a Tier 3 consolidation task.
3. Record an independent result map for every group:
   `group → created consolidation ref → covered original refs`. Treat partial
   batch success per group, never as success for the entire batch.
4. Apply the approved external prerequisites to each successfully created
   consolidation and rewrite surviving dependents from covered originals to
   that consolidation.
5. Verify each dependency rewrite and recheck the resulting graph for cycles.
6. Rename approved standalone DELETE tasks with `DELETE - ` plus the preserved
   base title.
7. Rename originals only for groups whose consolidation was created and whose
   dependency migration fully succeeded. Use `DELETE - ` plus each preserved
   base title.
8. Rename independent survivors with their final `Tier N: ` prefix plus the
   preserved base title.
9. Apply approved interrupted-run repairs.
10. Surface the newly created Tier 1 and Tier 2 consolidation tasks in the
    conversation.
11. Surface all Tier 1 tasks so immediate work is visible.

Complete all creations and renames before any proposing or surfacing operation
that pauses or ends the agent loop. Because proposing may pause the agent loop,
it must occur only after all mutations, surfacing, and the Phase 9 final report
are complete.

If a consolidation task cannot be created, or any required dependency migration
fails, do not mark that group's originals DELETE. Report the failure and
preserve those originals unchanged. Successfully created groups remain
independent of failed groups.

## Phase 9 — Final report

Report:

```text
Snapshot size:
Dropped after state check:
Marked DELETE:
Consolidated originals:
Created consolidation tasks:
Kept as Tier 1:
Kept as Tier 2:
Kept as Tier 3:
Skipped because already DELETE:
Skipped because state changed:
Dependency cascade promotions:
```

List every newly created consolidation task with its tier and covered refs.
State that only Tier 1 and Tier 2 consolidation tasks were created and
surfaced, and that they are about to be proposed. Then propose only those newly
created Tier 1 and Tier 2 consolidation tasks to the user as the final
operation. Do not place any required mutation, surfacing, or report after the
proposal operation.

## Reason quality

Every decision needs a concrete, project-evidenced reason. Acceptable patterns:

- `DELETE — no demonstrated current benefit; possible future need only`
- `DELETE — active task <ref> already covers the same outcome`
- `CONSOLIDATE — all members directly support the same near-term outcome`
- `KEEP — valuable now, but combining it would make the plan unfocused`
- `Tier 1 — prerequisite for <ref>`
- `Tier 2 — meaningful current benefit and ready to start`

Avoid circular reasons such as “low priority because it is Tier 3” and vague
claims such as “seems useful.”