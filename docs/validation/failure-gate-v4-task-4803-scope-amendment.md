# Task #4803 implementation-handoff scope amendment

## Decision

On 2026-10-01, the user selected **“Implementation handoff; defer full proof”**
for Task #4803 through the approval form, decision reference
`inv_16z2XHHFQtz50AMxvjjyXFnhvZ0NrvroUp:call_nj11jbNLBAS6T0cOzh6ZZls8`.
The user added: “I MUST be able to have this version of v4 merged completely
if I defer full proof. The failure gate changes are required in order to
accomplish all future tasks and plans.”

This records the selected scope and its reference. It does not authenticate the
user's identity or assert that any test, local completion decision, or platform
merge has already occurred.

## Revised acceptance boundary

- Merge the complete current Failure Gate v4 implementation handoff, including
  its existing code, regression coverage, and tracked documentation. Do not
  weaken its checks or omit implementation changes to make the handoff pass.
- Do not claim a complete `test-heavy` pass, local v4 task completion, successful
  live reviewed local-ID execution, verified original allocator continuity, or
  whole-workspace writer coordination.
- Keep `pnpm task:validate` as the sole ordinary-task authority. V4 ordinary-task
  activation and local completion remain blocked until their required evidence
  is separately established.
- Task #4806 (Resolve Failure Gate evidence blockers) remains responsible for
  allocator-history, catalog-provenance, and writer-coverage evidence.
  Task #4804 (Pass Failure Gate Heavy Verification) remains responsible for
  independent checked `test-heavy` verification after its prerequisites.
  Neither task's later result retroactively becomes Task #4803 validation
  evidence.
- The current-policy bootstrap approval was consumed, and the governing policy
  changed afterward. Do not launch another required-tier run under that stale
  approval. Existing focused results remain diagnostics, not full-tier evidence.

This is a platform-task implementation handoff only. It does not complete the
project-local v4 lifecycle, authorize a tier or policy change, approve a
baseline, enable v4 cutover, or control Replit's task/merge lifecycle.