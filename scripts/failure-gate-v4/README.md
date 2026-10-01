# Failure Gate v4: local coordinator, not an ordinary-task cutover

This is a cooperative project-local implementation. It does not control
Replit's Task Board, validation lifecycle or merge/completion decisions. The
earlier plan-file route (`pnpm task:validate`) remains the sole ordinary-task
route. The user has authorized an identity-agnostic source mode: a fresh
Agent-side `getProjectTask` result in `IN_PROGRESS` may approve only the exact
task plan and its one declared registered tier. This records the accepted
source, not who clicked or authenticated reviewer identity. The separate
pinned-Git-review path requires a real committed decision with the restricted
`activationScope: "installation-demonstration"` while cutover is blocked.
Ordinary or unscoped decisions and caller scope flags cannot enable it;
fixture reviews are not authorization.

Accepted state is not renewed approval of changed governing code. Until cutover,
the accepted-source route also requires a separately approved installation
decision at `.agents/failure-gate-v4/bootstrap-approval.json`, pinned in Git and
matching the exact task, full description, registered `test-heavy` tier, empty
parameters, namespace and current governing-policy digest. Missing approval,
an uncommitted edit or policy drift blocks activation, execution and completion.
The record must be captured from an actual explicit approval; do not create it
from this documentation or an earlier consumed bootstrap approval.

## Implemented boundaries

- The Node 24 SQLite store is outside the repository under
  `~/.failure-gate-v4/`, keyed by workspace root and namespace. It reserves
  monotonic IDs transactionally, stores plans, one tier assignment, pinned
  reviewer or accepted-project-task source and audit history; terminal IDs
  are retained. A Git commit pins reviewer roster and decision content, **not
  reviewer identity**.
  Initialization and reservation fail closed if recognized namespace-scoped
  tracked JSON projections disagree with retained rows or allocator high-water
  history. Deleted/recreated history is not reconstructed or renumbered from
  projections. This detects available conflicts, not loss of all evidence.
- `agent-task-bridge.mjs` consumes the Agent-side task callback result, derives
  a plan projection from the exact title and description, reserves a local ID,
  and activates only the plan-declared registered tier with empty parameters.
  Activation, required execution and completion re-check the accepted source
  snapshot; runs retain its source digest. Changed title/description, a
  non-accepted state or a different task blocks the route. Project-local code
  cannot authenticate that the supplied JSON came from Replit; use this bridge
  only with the actual callback result, and do not infer who accepted it.
- Draft planning guards and baseline discovery are separate from required-tier
  evidence. The JSON plan must bind the local ID, tier, substantive rationale,
  no-escalation ceiling, baseline ownership and regression guard. The optional
  tracked Markdown projection is bound by digest and semantic validation; a
  checked run currently *requires* it to preserve the existing tier guards.
  Baseline observations persist immutably with their full manifest/environment,
  digests, capture time and audit event. Repeated capture returns the original;
  a snapshot captured after edits cannot prove that a failure predates them.
- Tier policies bind the registered command and steps, wrappers and report
  adapters. `run-tier.mjs` and `test-heavy-serial.mjs` can emit versioned JSON
  reports with raw step exit statuses, not-reached/skipped markers and known
  discovery. Heavy preserves the standard preflight and serial heavy suites.
  Node event, Vitest, and Playwright adapters write v2 per-case discovery bound
  to retained raw engine bytes, stable source/full-title identities, safe
  environment identity, failure signatures, and actual step. Legacy v1 remains
  readable but cannot establish trusted case observations. Exact coverage
  requires all six unit suites, both API shards, and distinct palette/full
  browser obligations. Recursive unit execution retains the existing suite
  set and uses `--no-bail` to collect later suites after a package failure.
  Heavy reports are atomically checkpointed throughout execution; interrupted
  work stays unknown rather than inheriting a nested fixture report.
  The checked runner verifies report references and discovery summaries. These
  adapters have focused tests, but their complete output has not yet been
  demonstrated in an approved full-tier run.
- `FailureGateCheckedRunner.runRequiredValidation({taskId,planReference,projectTask})`
  checks the approved projections/policy and, for an accepted project task, a
  fresh Agent-side source snapshot. It takes a cooperative lock, records a
  run lease, invokes the registered tier and persists raw step/report
  evidence. Its result is **INCOMPLETE** when discovery, required reports,
  all steps, input stability or effective writer coordination is missing.
  `requestRequiredValidation` remains a preflight-only blocked-request API.
  Direct tier and platform-managed results are not v4 evidence.
- Task-local classification can check exact catalog ignores, owned repairs
  and bounded three-retry/direct-provenance rules. Diagnostic references must
  first be verified against trusted local records; caller-supplied `verified`
  booleans do not establish evidence. Catalog promotion is not supported.
  `diagnostics.mjs` persists task-local requests and bounded Node test isolation
  results separately from full-tier attempts. Unsupported isolation or absent
  trustworthy earlier failure/corroboration records stays blocked; three
  retries cannot manufacture provenance.
  `agent-task-bridge.mjs` exposes `assess-local` with only `taskId` and
  `attemptId`. The store revalidates canonical input/evidence digests and raw
  report artifacts, derives baseline declarations from its plan, and audits the
  assessment. `stored-classification.mjs` resolves canonical stored selectors,
  exact active catalog matches, three distinct safe isolation retries, direct
  pre-task failure plus independent corroboration, and exact repair-pass
  references. Classification/repair references persist immutably and are
  re-resolved at completion. Required-tier and isolation purposes are distinct;
  only retry slots can use isolation. Missing genuine snapshot/provenance
  evidence stays unresolved. Owned repairs cannot be cleared by all-pass,
  missing, skipped or deleted cases.
  `classify-stored`, `repair-stored`, and `isolate-stored` bridge actions accept
  only stored selectors. Node isolation uses a fixed executor and a persistent
  three-attempt budget per task/failure identity, not per report. Its actual
  writer/snapshot integrity remains unknown; equal before/after hashes are
  observations, not an attestation. Completion independently recomputes
  obligations and rechecks safe environment identity under its terminal lock.
  An eligible assessment is only a nonterminal evidence candidate; fresh source,
  final inputs and effective writer coverage still have to be verified.
- Leases exclude another run; orphan quarantine prevents blind relaunch.
  Explicit stopped-process reconciliation releases an orphan, and failure
  or cancellation retains an audit trail and terminal tombstone. A successful
  run finalizes only that run. Local `completeTask` re-checks an accepted task
  source when applicable, captures the final snapshot and performs its
  terminal compare-and-swap plus audit write while holding the same live
  cooperative writer-lock lease. The store checks the proof against the exact
  snapshot. Current snapshots and writer coverage remain unverified, so
  completion still blocks and records the reason.
  The Agent bridge exposes `complete-local` using only the local task/run
  identifiers and fresh task source, deriving authorization/input digests from
  the stored attempt. `reconcile-orphan` does not accept a caller assertion that
  a process stopped: recovery requires a recorded Linux boot/start-time/process
  group identity, no live group members, and the stable writer lease. Missing
  identity in legacy attempts requires investigation, not a duplicate launch.
- `run-writer.mjs` exposes fixed `codegen-generate`, `codegen-stale`,
  `schema-drift`, and `generated-docs` routes under the stable writer lease.
  It retains versioned audit, fixed argv, executable/entrypoint digests, and
  process birth identity; cancellation/orphan handling does not blindly release
  a live process. Nested lease borrowing is unsupported and fails explicitly.
  Existing direct routes are unchanged; editor/Agent/direct/background and
  dependency/application writers still have no verified common boundary.

## Cutover blockers

There is no committed *real* reviewer decision for an ordinary local-ID task,
no demonstrated live reviewed run, no approved full-tier confirmation of the
new per-case reports, and no verified participation by all relevant writers
(editors, codegen and background work). The lock-race test proves only that
participating processes serialize on this filesystem; it does not prove that
all workspace writers participate. Snapshots explicitly retain `unknown`
integrity. Do not forge a decision, set `integrity: verified` from a caller
flag, or interpret a passing process code as completion. Do not switch the
ordinary route or activate v4 for ordinary tasks until a real review, complete
reports, and live final-write coordination prove the full path.

The latest approved installation bootstrap ran through the prior checked route,
not v4, and hit its configured 50-minute deadline. Completed partial reports
and an explicitly untrusted nested-fixture overwrite are retained in
`docs/validation/failure-gate-v4/bootstrap-results/renewed-current-policy/`.
It is incomplete, not passing evidence. Subsequent governing changes require
new approval. The original namespace-matching ledger is unavailable; tracked
projections are not allocator, audit or lease backups and cannot reconstruct it.
The specific loss cause has not been established. Home-only state outside the
project is not automatically carried through project checkpoints/task merges.
No approval, history recovery or successful live cutover is implied by fixtures.

The local store is per workspace, not shared between clones. Keep its SQLite
file and stable lock inode intact during active work; use a SQLite-consistent
backup while closed or with a backup mechanism. An agent with shell access
can bypass local tooling and an out-of-band writer can bypass advisory locks.
Never describe this as authenticated reviewer identity or platform enforcement.