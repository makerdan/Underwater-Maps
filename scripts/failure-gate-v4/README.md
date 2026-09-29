# Failure Gate v4 coordinator foundation

This is a project-local coordinator foundation, not a live validation cutover.
The implemented subset provides:

- a Node 24 built-in `node:sqlite` durable store, per-workspace namespace check,
  transactional monotonic local ID reservations, canonical JSON plan and parameter
  digests, compare-and-swap activation, and same-transaction audit events;
- a single authoritative active tier with per-tier statuses derived from that
  assignment; and
- reviewer decisions loaded with the reviewer roster from blobs in one pinned Git
  commit, with exact task/plan/tier/policy/version binding and a reviewer restricted
  to `admin` or `Dan`, distinct from the supplied task-agent identity;
- a checked required-run preflight that verifies the local task ID, exact canonical
  plan projection, active assignment, and digests derived from the host's real
  `VALIDATION_COMMANDS`, `validation-steps.mjs`, runner, timeout, resource-lock,
  package, and policy inputs; and
- a transactional blocked-attempt record containing registry/wrapper/tier
  digests, a tracked-plus-untracked content manifest, a safe runtime/environment
  identity, explicit `NOT_STARTED` step records, and the block reason.

By default the database is stored under `~/.failure-gate-v4/`, keyed by the resolved
project root and configured namespace (not in `.local/` or the repository). The
coordinator uses SQLite WAL, a five-second busy timeout, full synchronous commits,
and owner-only file/directory permissions where the host permits. Back up the
database with the coordinator closed or use a SQLite-consistent backup mechanism.
It is local to one workspace; it does not coordinate independent clones. Live
state is not tracked or suitable for branch merging.

The default committed reviewer source paths are
`.agents/failure-gate-v4/reviewers.json` with
`{"reviewers":[{"id":"admin","active":true},{"id":"Dan","active":true}]}`-shaped
content and `.agents/failure-gate-v4/decisions/<TASK-ID>.json`. A decision must
contain `decision: "approved"`, `reviewerId`, a non-empty real `reference`, and
the exact identity/digest/version fields returned by a reserved task. These are
reviewable committed contents, not cryptographic proof of reviewer identity.
Do not add approval-shaped fixtures to a production repository; the tests create
their own temporary Git repositories.

`FailureGateCheckedRunner.requestRequiredValidation()` currently validates that
the supplied local task is active and that its exact `planReference` is a regular,
tracked, project-relative JSON projection whose canonical bytes, namespace, task
ID, version, and digest match the approved SQLite record. A second task's valid
plan is not interchangeable. It recomputes separate registry, wrapper, and tier
definition digests using the host's actual `VALIDATION_COMMANDS` and step list;
drift from what the reviewer-approved tier digest covers denies the request.

**Required-tier execution is deliberately blocked.** The existing registered
commands stream human-readable console output rather than a complete versioned
machine report containing every required step, raw result, and expected report
artifact. `test-heavy` has additional preflight and serial-suite semantics in
`test-heavy-serial.mjs` that cannot be accepted by simply treating its process
exit code as full-tier evidence. No report adapter is registered. The checked
preflight therefore launches no command and acquires no run lease. It
transactionally stores a distinct blocked-attempt record (not a run lease) with
all steps `NOT_STARTED` and null raw exit status/report references, plus its
reason codes, plan/auth versions, registry/tier/wrapper digests, manifest, and
safe environment identity. This is a blocked request, not a validation run and
not task evidence. It does not treat direct, diagnostic, ad-hoc, or
platform-managed results as required-tier evidence.

The workspace manifest hashes tracked and non-ignored untracked regular files,
including generated inputs, and records safe runtime/environment identifiers
without environment secret values. Secret-bearing files are not read into the
manifest; their presence makes the snapshot unknown. Ignored paths are listed
and classified. Snapshot hashes describe an observation, not immutable
execution: there is no integrated writer lock, so integrity is explicitly
`unknown` and the request remains blocked. No successful execution snapshot or
artifact parser is claimed.

Still unavailable: authenticated task-agent identity; a host-approved plan
authoring/projection flow; a machine-readable complete report adapter and
required-tier executor/run lease; immutable run isolation/effective writer
coordination; post-run evidence/report persistence; validation result assessment;
diagnostics, failure classification, and baseline governance; amendments and
terminal completion/release; recovery/orphan handling; capability discovery; and
bootstrap/cutover. In particular, do not use this foundation to authorize
ordinary validation or claim local completion. It does not bind or control
Replit Agent platform tasks or completion.