# Failure Gate v4 host capability map

This describes BathyScan's **project-local cooperative** workflow, not Replit's Task Board. An Agent-side accepted-task adapter can use a fresh `getProjectTask` result as the source for one exact local plan. The user has specified that acceptance is trusted regardless of who clicked; the local record does not identify or authenticate that person. Ordinary-task v4 cutover remains **blocked** until the required capabilities below are demonstrated. An agent with shell/write access can bypass or alter local tooling, and committed Git content does not authenticate a human reviewer.

| Contract concept | BathyScan host mapping | Bootstrap status |
|---|---|---|
| Project identity | Resolved workspace root plus a configured local namespace; no claim of shared identity across clones | Foundation present |
| Canonical instructions | `replit.md` and tracked `.agents/skills/`; runtime skill mirrors are read-only | Present |
| Project task and plan | Canonical JSON record plus exact tracked projection; bounded planning guards, tracked baseline discovery and a digest-bound Markdown adapter for legacy guards | Local planning present; accepted-task source binding implemented, live local-ID route still to be demonstrated |
| Allocator, audit and persistence | Transactional SQLite retains terminal IDs; recognized tracked namespace projections must agree with allocator/row history; no reconstruction | Original namespace-matching ledger unavailable. Plans are not audit/allocator/lease backups; no multi-clone guarantee |
| Tier registry | Registered commands, required steps, wrappers, step reports and Node TAP/Vitest/Playwright case-report adapters are bound to tier and policy digests | Local mapping present; per-case adapters are focused-tested but not yet confirmed by an approved full-tier run |
| Bootstrap validation | Existing plan-file locked `test-heavy` route using the assigned task plan; historical approval and failed raw reports retained | Current reporting, allocator and assessment changes invalidate the earlier approval; renewed approval is required, not ordinary authorization |
| Planning guards and baseline discovery | Local bounded draft guards and tracked catalog read; immutable persisted planning-only manifest/environment and audit, never full-tier evidence | Present; late capture cannot establish earlier provenance |
| Replit plan source | `agent-task-bridge.mjs` consumes an Agent-side `getProjectTask` snapshot, binds exact task reference/title/description to the reserved local ID, and rechecks it for activation, run and completion; Node cannot call Replit directly | Adapter implemented; supplied callback JSON is not cryptographically authenticated by project-local code |
| Reviewer / policy decision source | Pinned Git decisions or identity-agnostic fresh accepted-task source; installation additionally requires a committed explicit bootstrap decision matching current policy | Accepted-source policy specified by the user; renewed current bootstrap decision still required, no authenticated reviewer claim |
| Activation | One-tier assignment from exact pinned decision/source; Git decisions must pin installation-demonstration scope until cutover; caller scope flags cannot authorize | Local scoped route present; ordinary/unscoped decisions deny, live ordinary route unproven |
| Checked runner and run evidence | New checked dispatch and leases; versioned step reports for all four tiers preserve raw statuses, preflight, serial heavy suites, not-reached steps and digest-checked case discovery | Present locally; complete acceptable evidence and a live reviewed run remain unproven |
| Diagnostics and failure classification | V2 raw-bound case identities/signatures; reference-only canonical resolver, immutable classifications/repairs, exact catalog rules, three Node isolation retries, direct earlier failure plus independent record corroboration | Algorithms/interfaces present and focused-tested; no live verified history. Unknown snapshots, unsupported adapters and unproved provenance deny acceptance |
| Writer coordination | Cooperative flock and fixed audited codegen/schema/docs routes; final snapshot/environment/evidence and terminal write share one active lease | Real negative completion race tested; all editor/Agent/direct/background/dependency/application writers remain uncoordinated; no positive all-writer proof |
| Local completion | V2 structural completeness is separate from raw pass; exact case coverage and qualifying classifications required; final snapshot and safe environment checked under live lock | Implemented fail-closed; current unknown integrity and absent full-tier evidence block completion |
| Recovery and retention | v4 run leases, explicit quarantine, actual recorded process-group stopped check under writer lease, terminal failure/cancellation and audit retention | Local adapters present; no live crashed checked-run reconciliation proof; legacy unknown process identity denies recovery |

## Approval and cutover boundary

The separate pinned-Git-review source still allows **either** the admin **or** Dan as designated reviewer, not the task agent. For the accepted-task source, the user explicitly trusts the platform's acceptance action regardless of who clicked. A fresh `IN_PROGRESS` task snapshot may authorize only its exact title/description-derived plan, empty parameters, and single declared, coverage-appropriate tier; task or governing-rule changes require renewed authorization. This is an identity-agnostic approval source, not evidence of an authenticated person's identity. The bootstrap approval is a conversation decision for this installation and one `test-heavy` tier only; it does not authorize ordinary-task activation, baseline promotion, tier changes, or a standing activation policy. A supplied JSON snapshot is useful only when passed by the Agent bridge from the actual `getProjectTask` callback; local code cannot prove its origin.

Do not switch `pnpm task:validate` or any other ordinary-task route to v4 merely because foundation tests pass. Cutover requires a real reviewed project-local plan, an actual local-ID checked run with full result adapters, and a single final input/evidence/terminal operation that coordinates relevant foreground writers. Any participating writer outside the lock, asynchronous writer outliving its lease, absent reviewer decision, missing report or unsupported required external check blocks the new route. Keep the previous route as the sole ordinary-task authority until a verified one-step replacement; never treat an ad-hoc or platform-managed completion result as v4 evidence.

Task #4803 has a separately approved implementation-handoff scope: its current
v4 implementation may be merged without claiming full-tier or live cutover
proof. This does not change the project-local completion rules above or make
v4 the ordinary-task authority. The pinned scope decision and deferred proof
boundary are recorded in
[`failure-gate-v4-task-4803-scope-amendment.md`](failure-gate-v4-task-4803-scope-amendment.md).

The report adapters and final-write behavior changed after the earlier bootstrap
run. A separately approved `test-heavy` attempt on September 30, 2026 exposed
task-owned Vitest and Playwright reporter-configuration regressions; those
configurations have since been corrected. A later approved run confirmed the
Vitest configs no longer fail during startup and the Playwright config loaded:
preflight passed, the unit suite reached tests, and the palette browser suite
passed (14 passed, 11 skipped). The unit suite repeated the previously
documented catalog-date mismatch with unchanged pre-task inputs; it is not an
active catalog ignore. The full browser suite started but the shell's
five-minute execution limit interrupted the run before that suite finished.
The result is incomplete, not full-tier evidence, and its one-run approval is
consumed. A later run may use the specified deterministic policy only after the
exact approved plan is bound to a local ID by a checked source adapter and the
runner can honor the tier's longer budget. Neither bootstrap approval is an
ordinary local task review.

The assigned project-task description was previously retrieved through the
Agent-side `getProjectTask` callback and compared with the local plan file. The
source-bound adapter now derives its tracked projections directly from the
exact callback snapshot and validates the task reference, title, full
description digest, accepted state and declared `test-heavy` tier. This does
not authenticate the clicker or prove that external Task Board writes
participate in the local writer lock. A live local-ID checked run and final
writer-race proof are still required before cutover.

## Historical approved bootstrap

The next explicit approval pinned the earlier governing policy and
`test-heavy`. Its first attempt failed the run-button guard; the retry passed
preflight but all three heavy-suite steps exited 1. Nine catalog fixture
failures remain unresolved, the temporary workflow-slot regression was removed,
and the enabled Playwright reporter tuple was repaired. Raw step reports and
their limits are retained in `failure-gate-v4/bootstrap-results/README.md`.
There is no successful full-tier or local-ID cutover proof. Subsequent safeguards
changed policy and need fresh approval before another heavy bootstrap.

## Current implementation and latest run

The renewed current-policy approval launched the existing managed heavy slot
through the prior plan-file-locked route after canonical configuration was
restored. It reached the configured 3,000-second aggregate deadline during full
browser execution. Completed unit/palette/preflight reports are retained in
`failure-gate-v4/bootstrap-results/renewed-current-policy/`; no full native heavy
report exists. A nested fixture's inherited report path produced an unrelated
report, explicitly retained as untrusted, not accepted as success.

Nine catalog failures remain unresolved. Three bounded current isolation
attempts do not establish pre-task provenance: an earlier copied closure was
incomplete, original heavy environment identity was not retained, and only some
raw failure fields matched. Unchanged source hashes can corroborate inputs but
cannot replace direct verified earlier evidence. No catalog promotion or fourth
current retry was performed.

The subsequent implementation provides v2 raw engine binding, exact per-step
suite discovery (including both API shards), non-bailing existing unit coverage,
progressive heavy reports, stored classification/repair references, retry-only
isolation purposes, and fixed cooperative writer routes. Fixtures prove code
paths, not review occurrence or host isolation. A live **negative** completion
race denies an unknown final snapshot and lets the waiting participating writer
proceed afterward; it is not positive cutover proof.

Governing policy changed after that consumed approval. Fresh approval is needed
before another required-tier bootstrap. The ordinary route was not replaced.
The coherent post-run diagnostic set passed 140 v4 plus 25 runner/report tests
with no failures, cancellations or skips; logs and exact commands are retained
under `failure-gate-v4/bootstrap-results/post-run-diagnostics/`. It is not
required-tier or cutover evidence.

## Runtime limits

The local SQLite store is not shared with independent clones or branch task agents. Home files outside the project are not automatically retained by project checkpoints/task merges; that does not explain the specific disappearance. Recover only a consistent original namespace-matching ledger with audit/tombstones/leases and its evidence artifacts; do not rebuild IDs from plans or reset the namespace. Persistence across handoffs needs a separately verified mechanism. Restrict filesystem access to the workspace owner. Git pins review content, not identity. Advisory locks coordinate only participating processes; no fixture or bootstrap closes the external writer boundary.