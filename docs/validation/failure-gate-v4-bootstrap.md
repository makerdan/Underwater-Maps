# Failure Gate v4 bootstrap

## Scope and authorization
This plan covers only installation and verification of the project-local Failure Gate v4 coordinator. The project user separately approved the bootstrap with the existing `test-heavy` tier in conversation decision `inv_1kV1HQKRGCDS5xSAM5VEMPmRdj9Q0FTR3r:call_3IxSJTUIbzVa0tM2U3rIcOMC`. That response is not an ordinary-task approval or proof of a human identity. The user selected an either/or rule: admin or Dan may review ordinary plans, separate from the task agent; use committed, versioned project review records.

Keep the current checked validation route until the new local-ID route, actual review source, final-write coordination and live cutover checks are all demonstrated. A missing required adapter blocks v4 activation, never creates a fallback approval. Do not use this bootstrap plan to validate unrelated work.

## Pre-existing failures to ignore
None known at plan time. Treat every observed failure as a potential regression; do not infer pre-existing provenance from retries alone.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Direct earlier-snapshot evidence and independent corroboration are required.

## Task-local environment observations
The existing plan-file tier lock reads an editable file. The ignored `.local/tasks/` archive is not a durable local task registry or reviewer-decision source. This bootstrap plan is a tracked input to the prior checked route, not a new v4 authorization.

## Regression Guard
**Covers:** A tier string or self-authored approval masquerading as authorization; concurrent edits invalidating completion evidence; partial migration weakening the prior route.
**Test location:** `scripts/__tests__/failure-gate-v4-*.test.mjs` and the existing tier-lock tests.
**What it checks:** Denial, wrong-task substitution, pinned reviewer decisions, policy drift, complete run evidence, writer races and terminal transitions; ordinary routing stays on the previous authority until a verified cutover. Run the selected bootstrap tier under the prior checked route; focused tests cannot replace it.

## Validation
**Command:** `test-heavy`
**Why:** Authorization, validation dispatch and task lifecycle are security and concurrency boundaries; the registered heavy tier covers their existing integration surface.
**Do not escalate:** Run exactly this tier for bootstrap. Focused v4 tests are diagnostics and cannot replace the tier; obtain separate approval for policy changes.