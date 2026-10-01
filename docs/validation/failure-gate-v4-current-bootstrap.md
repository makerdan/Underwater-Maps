# Failure Gate v4 completion bootstrap

## Scope and authority

The user approved `test-heavy` through the existing plan-file-locked route for
the **current installation work** in the conversation response to the question
“Do you approve this installation’s `test-heavy` validation through the existing
checked route?” (September 29, 2026). This is a separate decision from the
earlier installation bootstrap. It authorizes one selected tier for this
installation only. It is not a reviewer decision for any ordinary local-ID task,
an approval of a changed tier or policy, or authenticated reviewer identity.

The user separately approved one `test-heavy` run with the changed report and
policy inputs through the existing plan-locked route on September 30, 2026.
That one-run approval has been used. It does not authorize another run or
ordinary local-task review.

The existing route remains authoritative until a genuinely reviewed local plan,
complete machine reports and effective writer coordination can be demonstrated
on a live local-ID run and final-write race. Missing evidence blocks cutover.

## Pre-existing failures to ignore

None authorized for this bootstrap. The active dependency-audit catalog record
applies only to its exact suite and signature, not to this installation.

**Flaky-test rule:** A passing retry demonstrates intermittency, not provenance;
require direct earlier-snapshot evidence and independent corroboration.

## Task-local environment observations

There is no committed real local-ID reviewer decision for an ordinary task.
Cooperative writer locking has primitive coverage but no verified coverage of
all relevant workspace writers. Neither condition can be replaced by a fixture.

## Validation

**Command:** `test-heavy`
**Why:** This task changes local authorization, tier execution and final-write
coordination; the heavy tier covers the existing integration surface.
**Do not escalate:** Run only this tier through the prior checked route.
Focused checks are diagnostics, not substitutes for required validation.

## Regression Guard

**Covers:** Unreviewed or substituted tasks running an unauthorized tier,
incomplete reports passing as evidence and edits racing the terminal decision.
**Test location:** `scripts/__tests__/failure-gate-v4-coordinator.test.mjs`
and `scripts/__tests__/failure-gate-v4-writer-lock.test.mjs`.
**What it checks:** Pinned review bindings, full run obligations and raw results,
stale input rejection, and exclusion of participating writers during a terminal
write. A fixture result is not live cutover proof.

## Observed validation outcome

The approved tier was run through `scripts/run-locked-tier.mjs` with this
installation's assigned plan. The initial registered validation attempt stopped
in preflight on a duplicate import in the new runner; the import was corrected.
A second registered attempt stopped in preflight after temporary registration
changed the `Project` run button; the original configuration was restored using
the validated replacement operation, and the run-button guard passed again.

The subsequent plan-file-locked heavy run passed preflight and the palette
browser suite. Its unit suite failed on nine baseline-catalog assertions: the
checked-in catalog date is September 28, while the unchanged assertions pin
August 30. Both conflicting inputs are already present at the checkout's
starting revision. This is **not** an authorized ignore and the tier did not
pass. The broad browser suite was running when the workspace restarted and its
output log was lost; its final result is unknown. Do not infer a pass or a
complete tier from the partial stages. Focused local v4 tests passed before the
restart, but cannot replace the required tier.

The separately approved run with the changed inputs passed preflight, then
exited nonzero: `test:unit` failed during Vitest startup with
`TypeError: Cannot read properties of undefined (reading 'length')` in
`resolveConfig`; `e2e-palette` and `test:e2e` failed while loading
`playwright.config.ts` with `ReferenceError: exports is not defined in ES module
scope`. These were task-owned configuration regressions: the new Vitest
integration supplied an explicit `reporters: undefined` when disabled, and the
Playwright reporter path used a loader-sensitive `import.meta` URL. Both
configurations have been corrected. The run predates those fixes, remains a
failed validation result, and does not prove the fixes work. Obtain separate
approval before another heavy run.

A later separately approved run used the corrected configurations. Preflight
passed; the unit suite reached assertions and reported the same
`catalog.catalogDate 2026-09-28 cannot be after asOf 2026-08-30` mismatch
documented above. The catalog, test, and validator inputs are unchanged from
the pre-task snapshot, which corroborates unchanged inputs but does not replace
a verified earlier execution with matching environment; ownership remains
unresolved and no active catalog ignore applies. The palette browser suite exited 0 with 14
passed and 11 skipped. The full browser suite started, but the foreground shell
hit its five-minute execution limit while the tier's own 50-minute budget was
still active. No test process remained afterward; the two stale validation
locks were reclaimed by the lock cleaner. This run is incomplete, not passing
full-tier evidence, and its one-run approval is consumed.

There is still no real reviewed ordinary local-ID run, no approved full-tier
confirmation of complete case reports, and no verified participation by all
relevant writers. Focused report and lock tests are diagnostic only. The
ordinary route remains authoritative; v4 activation, local completion, and
cutover remain blocked.

## Historical source-binding limitation

The user has since specified that a verified approved plan authorizes exactly
its single declared, coverage-appropriate tier without a second human review,
and that changed plans or governing rules require renewed authorization. A
Replit task source is usable only when its exact contents are verified and
bound to the local task; title or state alone is insufficient. The full
assigned task description was retrieved through the Agent-side `getProjectTask`
callback and matched the local task-plan body after removing only its metadata
heading and one trailing newline (UTF-8 length 7,667; SHA-256
`c454d6a1d6eb7ae4ebced475940f02c3c19f570dddd13989ebcd0d2c3409874c`). It
declares `test-heavy`. This does not create a local `TASK-*` record or a
source-to-ID binding: the local store has no task database yet, and project
code has no adapter to retrieve Replit task contents. The `IN_PROGRESS` state
is not treated as standalone approval. The plan therefore cannot authorize a
local v4 run or completion yet, and the consumed bootstrap-run approval has not
been extended by a fabricated local decision.

## Historical local planning exercises

A subsequent actual Agent-side task callback was passed through the checked
`reserve-plan` bridge. It reserved `TASK-000001` for the exact installation
description and its sole `test-heavy` tier, wrote tracked JSON/Markdown
projections, and retained an immutable planning-only workspace/environment
observation. The record is still a **draft** with no authorized tier. This
observation was captured after implementation edits; it is not evidence that a
failure predates this work.

The source adapter and durable store now exist, superseding the historical
missing-adapter observation above. Activation additionally requires a real,
separately renewed bootstrap approval pinned in Git and bound to the current
governing-policy digest. The previous consumed approvals have not been reused;
no new real approval record has been written. A fresh read of accepted task
state does not by itself renew governing-policy approval.

Focused checks exercise the local planning, approval, report, diagnostic and
recovery boundaries. They do not constitute the assigned `test-heavy` run, a
live accepted full-tier result, or final-write cutover proof. The current route
remains authoritative and ordinary v4 cutover remains blocked.

The subsequent checked runner parameter guard changed the governing-policy
digest, so the same source plan reserved `TASK-000002` rather than reusing the
earlier policy's ID. Its activation was actually attempted and denied because
the current pinned bootstrap decision is missing; no tier was launched.
The policy digest at that point was
`34d9ab63c4ed152fe400fc4246716bae8a1ebf003ac4795fcf3d4114cf2622b1`.
The complete focused local v4 test set passed: 76 tests, no failures or skips;
`git diff --check` also passed. These remain diagnostic checks only.

Renewed approval was requested for that exact governing-policy snapshot and
`test-heavy` bootstrap through the existing plan-file-locked implementation.
Approval is not yet recorded and does not authorize ordinary cutover, catalog
ignores, task/policy drift, or a substituted tier.

## Earlier checkpoint (superseded by the renewed run below)

The user subsequently approved the policy above and its `test-heavy` bootstrap
through the prior checked route. The real decision was committed in
`.agents/failure-gate-v4/bootstrap-approval.json`, with approval captured at
`2026-10-01T04:20:00.875Z` (September 30 in America/Chicago). It authorizes that
earlier installation policy, not ordinary activation or a changed policy.

The first attempt failed the run-button guard after temporary workflow
registration changed `Project`. The retry passed preflight; unit, palette and
full browser steps each exited 1. Scripts unit had 374 tests, 364 passed and
10 failed, with no skips. Nine catalog-date fixture failures remain unresolved;
the extra temporary workflow caused the tenth failure. Both browser steps
rejected `config.reporter[0]` before executing tests.

The temporary workflow was removed and the original `.replit` restored. The
enabled list reporter tuple is fixed, with real config-loading diagnostics in
both reporting modes. TAP discovery excludes suite summaries without dropping
leaf failures. All v4 regression files participate in scripts unit coverage.
Raw step reports, digests and retention limits are documented in
`failure-gate-v4/bootstrap-results/README.md`; they are not local v4 evidence.

The session also exposed allocator continuity loss: an apparently fresh home
ledger allocated an ID represented by tracked projections. That record was
cancelled without a v4 required run. The new guard denies the live database
because tracked `TASK-000002` lacks matching retained history. The original
history and cause are unavailable. No recovery, high-water reconstruction or
namespace reset has been performed.

Stored assessments now verify canonical retained inputs and raw artifacts,
derive declarations from the exact plan, audit unresolved cases/steps and
preserve owned repair obligations. Completion recomputes obligations under
its terminal-write lock. All-pass, skipped, deleted or undiscovered cases
cannot manufacture trusted exact repair proof. Failure signatures and direct
earlier-failure/corroboration adapters remain unavailable, so their acceptance
paths still block.

At that checkpoint the governing-policy digest was
`0250c1e088ea4866ed1ef1f002d200251a464bb7020a28f4ac3a5d58496c50ef`.
It differs from the committed approval. **Renewed approval is required** before
another `test-heavy` bootstrap; the stale decision is not being extended.
The latest coherent focused diagnostics passed 153 tests with no failures,
cancellations or skips, including v4, exact workflow configuration and prior
checked-route guards. These are diagnostics, not the required tier.

At that checkpoint the task was **incomplete**. Original ledger continuity, accepted failure/repair
proof adapters, all-writer participation, applicable full-tier evidence and a
real reviewed local-ID run/final-write proof remain unavailable. Ordinary v4
activation and cutover stay blocked; the existing ordinary route remains
authoritative.

## Current implementation and renewed bootstrap outcome

The separately committed approval for policy
`0250c1e088ea4866ed1ef1f002d200251a464bb7020a28f4ac3a5d58496c50ef`
was used exactly once through the prior checked route. That run hit the existing
3,000-second aggregate deadline during full browser execution and is incomplete.
Completed producer artifacts and ownership observations are retained in
`failure-gate-v4/bootstrap-results/renewed-current-policy/README.md`. The native
outer report was overwritten by a nested fixture; that file is explicitly
untrusted, not full-tier evidence. Original groups stopped and scoped cleanup
finished; canonical `.replit` and the baseline catalog remain unchanged.

Subsequent implementation supplies v2 raw engine bindings and exact registered
coverage, progressive heavy reports, immutable stored classification/repair
references, diagnostic retries distinct from required-tier runs, and controlled
cooperative writer routes. Current catalog failures still lack adequate direct
earlier provenance/environment and remain unresolved. Three current isolation
attempts were consumed; no fourth was launched or catalog entry promoted.

A real participating-writer **negative** final-write check denied completion
because its actual captured snapshot integrity was unknown, retained active
state/no terminal event, and released the waiting writer after denial. Initial
run evidence was explicitly a diagnostic fixture: neither that check nor pure
positive fixtures demonstrate a genuine reviewed local-ID full-tier route.

The one-run approval is consumed and governing policy changed afterward.
Fresh approval is required for another required-tier bootstrap. Original ledger
continuity and all-writer host coverage are unavailable; no namespace reset,
ordinary activation, route replacement, platform-managed completion, or cutover
was performed. The task remains incomplete.

Final coherent focused diagnostics passed 140 v4 plus 25 runner/report tests
with no failures or skips; see
`failure-gate-v4/bootstrap-results/post-run-diagnostics/README.md`.
The tested tooling policy digest is
`17fbc4a47b24288f3ae150e29aadc50cb75a9d3a18fef847b4ae95c9e9e9454d`.
These diagnostics do not satisfy the authorized heavy tier.

## Fresh installation approval

On October 1, 2026, the user answered “Approve one test-heavy run” to
“Approve one current-policy test-heavy installation run?” The response was
captured as raw `approval: "approve"` under question reference
`inv_16z2XHHFQtz50GiVrXBh9ko9hSbJYOC5Il:call_Qzz97dAYJYO9h8YjHNHnmMuC`.
The question's context named the current policy digest
`17fbc4a47b24288f3ae150e29aadc50cb75a9d3a18fef847b4ae95c9e9e9454d`,
the prior checked route and existing 50-minute aggregate limit.

This is one real installation-run approval, not authenticated identity, a
local-ID task review, a catalog ignore/promotion, a budget/tier increase, an
ordinary activation or cutover. The matching bootstrap record is committed
before launch. No new required-tier run is authorized after this one is consumed.