---
name: Port-Authority-Heavy
description: Heavy-project extension of the Port-Authority runtime hygiene skill, for sprawling Replit projects with multiple services and several heavy test suites. Use when hitting the workflow-count limit ("too many workflows", "can't create another workflow", "at 10/10 workflows", "at limit" errors right after deleting a workflow), when test suites block each other, or when multiple services fight over ports. Extends Port-Authority — apply that skill first.
---

# Port-Authority-Heavy — Runtime Hygiene for Heavy Replit Projects

This skill **extends** the `Port-Authority` skill for heavy projects:
multiple services, several heavy test suites, many workflows. It adds only
the heavy-specific material — the standard skill's phases are NOT repeated
here and must not be skipped.

## Step 1 (prerequisite) — Apply `Port-Authority` in full

Apply the standard `Port-Authority` skill completely before anything below.
Do not proceed until its acceptance gate (full suite twice back-to-back with
zero manual intervention) passes or its repairs are underway.

## Step 2 — Workflow-count budgeting

Replit projects cap the number of workflows (around 10, and hidden system
entries can count against it). Heavy projects hit this cap. Budget
deliberately:

- **Reserve workflow slots** for things that must stay running: servers,
  watchers, long-lived services.
- **Run on-demand jobs** (test suites, lint, typecheck, audits) as
  **registered validation commands** — they don't count against the
  workflow cap and can be updated in place.

This defers to, and never overrides, the standard rule that long-running
processes belong in workflows (Port-Authority Phase 1). The budget decides
*which* long-running things get the scarce slots; it never pushes them into
ad-hoc shells.

## Step 3 — Consolidation over proliferation

Prefer **one serialized heavy command** over one workflow per suite: e.g. a
single `test-heavy` entry that runs unit + e2e + other suites in sequence
behind the serialization lock from the standard skill (Phase 4's
`serial-lock.mjs`). Benefits:

- Fewer workflow entries consumed.
- The consolidation itself **enforces the serialization** those suites need
  anyway — suites that share ports, generated files, or DB state can no
  longer race each other.

## Step 4 — Stale counter handling

After deleting a workflow, creation may still be rejected as "at limit" for
a few minutes because the platform counter goes stale. On a limit error
right after a removal:

1. **List the workflows** to see the true count.
2. If the list shows a free slot, wait briefly and retry.
3. If the list genuinely shows the cap reached, the fix is **consolidation
   (Step 3) — never a retry loop.**

## Step 5 (guard) — Never work around the cap with ad-hoc shells

Do not launch services or suites from `nohup`/backgrounded shells to dodge
the workflow cap. That reintroduces every orphan-process problem the
standard skill's Phase 1 exists to prevent. If you are out of slots, the
answer is always budgeting (Step 2) or consolidation (Step 3).

## Step 6 — Heavy regression hardening

- Give each heavy suite an **explicit time budget measured from AFTER lock
  acquisition** — a budget that includes queue-wait time falsely flags
  queued runs as timeouts.
- Budget-breach reports must state whether the run executed **under
  concurrent load**. A breach under load is a serialization bug, not a slow
  test — fix the lock coverage, don't raise the budget.
- Every forced lock clear or forced process kill raises a **loud alert** so
  hidden hangs are investigated, not absorbed.
- **Re-run any budget-breaching step solo** before tuning budgets — most
  "slow" steps are merely contended steps.
