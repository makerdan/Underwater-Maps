# Failure Gate v4 — implementation contract

Read this when installing or changing enforcement. These are interfaces and
requirements to implement in the host, not claims that the commands already exist.

## Scope and migration

Inventory the host before editing. Reuse its existing build/validation tools,
task lifecycle, baseline schema, and canonical instruction sources.
Do not install a second competing runner or weaken existing coverage.

## Host adaptation

The contract applies to web, mobile, desktop, CLI, libraries, embedded systems,
infrastructure, data pipelines, and documentation projects. The enforcement tooling
may live in the developer environment or CI; it need not run inside the deployed
application or on the target device. Do not add a backend to a static app merely
to host a gate.

Record these mappings before choosing implementation details:

| Contract concept | Host mapping |
|---|---|
| Project identity | Verified workspace/repository namespace; Git is optional. |
| Canonical instructions | Host instruction sources; `.agents` where supported, never generated mirrors. |
| Task/plan | Existing task service or durable local record, with semantic fields and version/digest mapping. |
| Tier | Existing check group or an explicitly approved grouping of real available checks. |
| Execution | Host-language process runner, build tool, native test service, or CI adapter with equivalent checks. |
| Evidence | Actual source/artifact snapshot, relevant environment identity, and trustworthy result parser. |
| Storage | Durable transactional coordinator suited to the host's concurrency and availability. |
| Approval/completion | Available human/policy route and local or external completion adapter. |

No Node.js, Python, shell syntax, operating system, SQL engine, package manager,
specific number/order of tiers, or cloud provider is mandatory. Use portable
process and path APIs appropriate to the chosen host. Version-control commits
are optional snapshot aids, not the definition of tested content.

If tiers are absent, installation may propose a minimal registry based on actual
host checks. Register it only under approved installation policy; do not fabricate
smoke/standard/heavy commands. If no automated tests exist, identify real build,
lint, manual, or domain checks. A manual-only tier must record its approved scope,
reviewer and actual evidence and be reported as manual validation, never automated
test success. Unsupported required checks remain blocked, not silently no-op.

Optional memory, historical tasks, catalogs, and companion skills may be absent.
Do not invent their contents or make them installation prerequisites. Without a
baseline catalog there are no catalog-based ignores. Without earlier evidence,
unlisted failures cannot be proven pre-existing.

Pre-edit observations and retries use the host's approved risk policy. Device,
production, destructive migration, paid-service, and other side-effectful checks
need explicit safety constraints and authorization. Do not assume isolated tests
can safely replay an operation merely because the runner supports retries.

Create a capability manifest covering authoritative ID assignment (allocator
reservation or post-draft service assignment), plan guards, planning discovery,
activation policy, tier registry, checked runner, diagnostics, results parser,
approval route, completion checker, persistence, and recovery. State the verified
interface for each. Keep unsupported external capabilities explicit.

Illustrative source layout for a file-based host using `.agents`; none of these
paths is a universal runtime dependency. Map to existing host equivalents:

```text
.agents/skills/failure-gate-v4/
plans/<task-id>.md
docs/validation/failure-gate-policy.md
docs/validation/tier-registry.json
docs/validation/failure-baseline.json
scripts/failure-gate/                  # host-language implementation
tests/failure-gate/
```

Live registry storage is not a committed mutable JSON document. Use an appropriate
transactional store with durable persistence outside `.local/`; keep schema,
migrations, fixtures, policy, and implementation tracked. Document storage backup,
restart behavior, access permissions, and cross-workspace scope. Never merge live
database binaries from task branches or assume a local database coordinates clones.

Install via a separately approved bootstrap operation using existing validation
commands. Bootstrap is limited to implementing the gate, logs its actual checks,
and cannot authorize ordinary tasks. Verify acceptance tests before enabling
enforcement. Migrate existing plans explicitly; do not invent historical IDs or
approval events. Pause affected work or let it finish under a recorded prior
policy. Activation must not leave old and new authorities competing.

## Authority and approvals

Workflow mode is a cooperative project control. A user approval may be recorded
with a real conversation/task reference and exact approved change. Label its
verification accurately: locally recorded approval is not cryptographic identity.
Never fabricate an approver or use an example reference in real state.

Initial activation may use either explicit approved-plan evidence or a deterministic
owner-approved policy mapping task scope to tiers. Store the policy version and
decision. An agent's discretion alone is not a standing activation policy.

Tier changes, obligation removal, baseline widening, and policy changes require
an authorized approval route. When that route is unavailable, stop the mutation.
Protected mode authenticates approvals and stores governing policy/evidence beyond
task write access. Caller-supplied actor names, environment variables, and
`--approved` flags are never sufficient in that mode.

A project-local completion checker can enforce records procedurally. A protected
external checker can enforce their authenticity. State which exists.

Inventory every host route that can mark a task successful (UI, API, automation,
background job, or equivalent). Require the same completion decision on all of
them. In protected mode the policy, authoritative state, and final transition
must be outside task write access; disabling a client-side button is insufficient.
In workflow mode document any unguarded routes as bypasses, not enforced controls.

Run results count as protected evidence only when produced and verified by an
independently controlled runner or attested result service. Bind an immutable
result to task ID, project namespace, plan/authorization/policy versions, tier
digest, actual invocation, snapshot, run purpose, and artifact digests. Protect
issuance and storage; revalidate at completion. A JSON file, timestamp, signature
field, `PASS` label, or self-reported actor written by the task agent is not
attestation. Workflow mode may record these files for cooperation, but must not
claim forgery resistance.

Resolve current task identity independently of caller-provided IDs, plan paths,
environment variables, or ad-hoc labels. A valid plan for a different active
task cannot be borrowed. If the host cannot attest the current task identity,
state that limitation and reject the protected claim rather than inferring it
from the latest plan. Ad-hoc runs are never completion evidence for an active
task.

## Identity and single-source authorization

For an allocator-reservation host, reserve monotonically increasing display IDs
such as `TASK-001042` in a transaction in one authoritative repository namespace.
Only expose a reservation after commit. Keep permanent tombstones; committed IDs
are never reused after abandonment or terminal states. Import existing IDs with
uniqueness checks.

For a host whose task service assigns an ID only after draft creation, create
a unique provisional draft reference scoped to the project namespace. It is
non-authorizing: guards and approved planning discovery may use it, but no active
run or completion may use it as a task ID. Accept only the task ID independently
issued by that service; do not add a competing allocator, self-assign an ID, or
infer one from a draft filename. Once the ID is available, verify the service's
draft-to-ID mapping and atomically bind the provisional reference to the actual
task ID, canonical approved plan/reference and version/digest, authorization
version, and audit event at activation. Recheck plan guards and approval or the
approved deterministic activation-policy decision for that exact plan/version.
If service identity, approval, or transactional binding is unavailable, remain
draft/blocked; never treat provisional state as active. A delayed or duplicate
callback cannot bind a different ID or plan.

If independent workspaces share the namespace, use a shared authoritative
allocator/store or the shared task service's issued IDs. Otherwise explicitly
restrict the local registry to its workspace namespace; do not claim repository-wide
atomic allocation. Namespace plus UUID identifiers are an acceptable alternative
when global sequential numbers are unnecessary.

One task row is authoritative:

```json
{
  "taskId": "TASK-001042",
  "repositoryNamespace": "configured-stable-namespace",
  "status": "active",
  "planReference": "<host-plan-path-or-record-id>",
  "planVersion": 1,
  "planDigest": "<canonical-plan-content-digest>",
  "authorizedTier": "<registered-tier>",
  "tierDefinitionDigest": "<digest>",
  "parametersDigest": "<digest>",
  "policyVersion": "4.0",
  "authorizationVersion": 1,
  "suspended": false,
  "pendingChangeId": null
}
```

The example is not live authorization. Constrain enums and fields with runtime
validation. Preserve original tier and transitions in history, not duplicate live
allow/deny lists. Absence of an active authorized tier means deny.

States: `draft`, `active`, `completed`, `failed`, `cancelled`.
Only active, unsuspended tasks may start required-tier runs. A pending change
does not authorize its target. Terminal records have no current authorized tier.
Never reopen terminal IDs; create a new linked task.
An unsuccessful validation run does not automatically terminate its task: keep
the task active for authorized investigation and repair. Terminal failure is a
separate explicit lifecycle decision.

## Transactional lifecycle

Use transactional storage with uniqueness constraints and compare-and-swap on
authorization versions. SQLite can suit a single supported local coordinator;
multi-instance access needs storage/concurrency semantics appropriate to the host.
Do not rely on a JSON read-modify-write loop or network-filesystem assumptions.

Activation, amendments, tier moves, recovery, and terminal release commit their
new state AND audit event in the same transaction. On audit-write failure, roll
back the mutation. Validate proposed plan contents before publishing their version.

Store the canonical approved plan content/digest with the transaction. A tracked
plan file or external task record is the working projection: execution must match
its version and semantic content to the approved record.
If file projection and database commit cannot be atomic, execution stays suspended
until projection verification succeeds. An interrupted projection never creates
permission to run a partially applied plan.

Compare-and-swap prevents stale or duplicate approvals from applying twice.
Use idempotency keys for retried operations. Do not silently heal corruption.
An authorized repair identifies the prior state, intended state, reason, evidence,
and actor; it cannot secretly change tiers or authorize terminal tasks.

## Separate authorization from run snapshots

Authorization binds approved obligations, not a frozen pre-edit code snapshot.
Each run captures a separate content manifest representing the files actually
executed. Relevant changes invalidate prior results, not permission to rerun
the same authorized tier within scope.

Include tracked files, relevant untracked/generated inputs, dependency lockfiles
and actual dependency/runtime identity, configuration, fixtures, and migration
state. Do not record secrets; record safe versions or keyed digests through an
appropriate protected mechanism. Document exclusions such as logs and report outputs
so recording a run does not invalidate itself.

Prefer an isolated immutable run snapshot. For shared-worktree execution, coordinate
all writers and verify contents before/after the run; hashes alone cannot rule out
mid-run edits that were reverted. Without isolation or effective coordination,
report snapshot integrity as unknown and reject completion evidence.

Record external service/DB fixture identity and reset policy when tests depend on
them. A code hash does not establish external-state equivalence. Unknown relevant
environment equivalence blocks provenance claims.

Completion compares the required run against the final input manifest. Default to
rerunning on changes. A narrow documented policy may ignore proven irrelevant
changes; it must not accept the agent's unsupported assertion of irrelevance.
Coordinate the final manifest check and terminal transition with the same writer
and authorization locks, so an edit cannot slip between acceptance and completion.

## Tier registry and checked execution

Use one registry for scaffold, guards, runner, and completion checker. Each tier
defines argv-based commands, root/working directory, required steps, dependencies,
permitted parameters/environment, diagnostics, timeouts, reports, discovery
expectations, and coverage. Pin its canonical digest.

Treat the registry, runner, checker, command wrappers, CI/automation adapters,
and managed completion dispatch as governing policy. Check the actual versions
executed, including indirect script entry points; a task-modified wrapper or
test command cannot silently become the authority for the same task. In protected
mode pin independently accepted versions outside task-write access. In workflow
mode report the editability limit rather than claiming tamper resistance.

Abstract interface to implement in the host's native tooling, not a command to
copy into a shell:

```text
run(taskId, planReference, purpose = required_tier_validation)
  -> runId, rawResults, evidenceReferences
```

Adapt language and command to the host. Never recommend this command before it
exists and passes checks. Resolve the tier from the task record; if a requested
tier is supplied, reject any mismatch rather than overriding the record.

Before launch:

1. Resolve project identity and plan reference. For files, reject traversal and
   escaping symlinks; for remote records validate namespace, access, and version.
   Reject another task's plan and mismatched plan content/identity.
2. Validate active state, suspension, approval, version, tier digest, parameters,
   policy, referenced ignore eligibility, and absence of unresolved recovery.
   Expired records cannot authorize ignores but do not erase owned repair obligations.
3. Acquire a run lease against the current authorization version, atomically
   recording the run and its audit event. Coordinate with transition locks.
4. Capture the tested snapshot/environment and launch only approved argv.

Do not interpolate untrusted strings into a shell command. Validate diagnostic
selectors and neutralize coverage-reducing environment/config overrides without
blindly removing runtime variables the host needs. Validate report paths and bound
output; truncated/missing machine reports cannot substantiate acceptance.

Collect each required step's real status and reports. Continue independent steps
where safe even after an ignored failure; never conceal unexecuted obligations.
Return nonzero for raw failing runs; the completion checker separately records
whether policy accepts their accounted-for failures.

All managed entry points delegate to this runner. Unmanaged execution is not
accepted evidence. Only protected mode may claim arbitrary execution prevention.

## Planning, diagnostics, maintenance, and completion

Run purposes are explicit:

| Purpose | Authorization | Can satisfy required task validation? |
|---|---|---|
| Planning guards | Bounded pre-activation policy | No |
| Baseline discovery | Registered planning policy | No |
| Required tier | Active task authorization | Yes |
| Diagnostic retry | Current tier's diagnostic capability | No |
| Provenance comparison | Registered comparison capability | No |
| Completion execution | Separate explicit completion policy | Only its own obligation |
| Maintenance/bootstrap | Explicit bounded maintenance approval | No |

Planning guards operate on a reserved-ID draft or non-authorizing provisional
draft reference before activation, resolving the bootstrap deadlock. They cannot
invoke arbitrary tests. Baseline discovery is
similarly narrow and records the pre-edit snapshot without activating work.

Diagnostic retries remain subordinate to the current tier; they are not filtered
substitutes for full validation. Comparison runs use isolated verified earlier
contents without resetting the user's working tree or touching production data.

The project completion checker is required. Platform-managed completion execution
is conditional on a discovered adapter and project policy, not assumed platform
functionality. If enabled, specify authenticated origin, allowed commands, snapshot,
result import, failure classification, cancellation, and recovery.

### Platform-managed task dispatch

If managed completion is used with active task/tier locks, the platform must call
the one existing checked task-validation entry point once, providing the exact
active plan reference and task ID from authoritative task context. Supply both
as validated structured arguments when possible; reject caller-selected task
substitution. The project launcher must verify that the plan reference belongs to
the platform's independently resolved active task and
resolves to the approved plan version before it chooses the authorized tier.

Illustrative command only, to be mapped to the host's existing command:

```text
pnpm task:validate -- <platform-supplied-active-task-plan-path>
```

The platform must not invoke each registered tier command directly, run an
unlocked sweep of all tiers, or ask project code to guess which plan is active.
The launcher reads the active task's authorized tier and runs only that tier.
This is a platform-to-project dispatch contract: project-level launcher tests
cannot prove that the platform invokes it. To claim managed completion, obtain
cross-boundary evidence identifying the platform task, independently supplied
active ID/plan reference, single checked invocation, resulting run ID, and
completion decision. Verify against authoritative task context rather than a
locally written result. Local tests may prove rejection behavior only.

If the active plan reference is missing, stale, malformed, for a different task,
or cannot be securely delivered, reject managed completion before running checks.
Do not substitute the newest plan, a default plan, a second command, a looser
fallback, or direct tier invocations.

When dispatch configuration belongs to the platform or is explicitly outside
project scope, do not edit it as a workaround. Report the unmet platform-side
contract precisely: managed completion must supply the exact active plan reference
and invoke the single checked project entry point. Until this is verified, local
launcher validation may pass but platform-managed task completion remains blocked,
not protected.

An unavailable optional adapter may be explicitly disabled at installation. An
adapter required by approved project policy cannot be silently skipped mid-task.
The platform dispatch contract above is required whenever platform-managed
completion is used to complete an active locked task.

## Run evidence, baseline policy, and completion

Runs contain task/run IDs, purpose, authorization/plan/tier versions, snapshot and
environment identity, actual timestamps, per-step raw statuses, artifacts/digests,
discovery counts, and policy assessment. Preserve failures individually.

Baseline policy defines failure matching, permitted volatile-field normalization,
environment applicability, authoritative clock, expiry boundary, reviewer authority,
and renewal/revocation. Preserve meaningful assertion, exception, endpoint, variant,
and stack distinctions. Ambiguous matches fail closed.

Check ignore eligibility at planning, activation, launch, classification, and
completion. Default: expiry/revocation before completion invalidates the ignore;
request separate review rather than self-renewing it. Repair ownership survives
expiry even if the record becomes ineligible for an ignore; require actual repair
evidence rather than silently dropping the obligation. Historical/non-active
records may corroborate but never directly authorize
an ignore. Promotion is separate maintenance, never an automatic task side effect.

The checker evaluates complete evidence, exact applicable baseline matches,
provenance, fixed owned obligations, and any required external completion results.
It cannot trust a run's agent-supplied `PASS` label. A procedural human review may
be needed for semantic provenance; record the reviewer and mode honestly.

All unknown statuses, missing results, or unaccounted failures block success.
Preserve raw exit statuses even when assessment is acceptable.

Distinguish the obstruction from failure ownership when a run cannot be trusted:
an expired catalog entry invalidates only the proposed ignore; missing installed
dependencies block the affected checks until installation is verified; a validation
lock requires its documented release/recovery path; conflicting concurrent work
requires isolation or coordinated writers. Do not reclassify these as application
regressions without an observed product failure. Record the named obstruction,
raw result, affected/unexecuted steps, and whether the tier is BLOCKED or INCOMPLETE.
Executed steps may retain raw results, but a partial tier is never PASS or
ACCEPTABLE_WITH_IGNORED_FAILURES. Do not silently install dependencies, clear
another worker's lock, or substitute a different tier to manufacture success.

## Recovery and retention

Run leases include coordinator/process identity, start time, heartbeat, and version.
A timed-out poll or expired heartbeat does not prove process death. Confirm stop,
cancel safely, or quarantine unresolved runs before authorizing replacement.
Coordinate process groups carefully; never indiscriminately kill unrelated services.

Prevent authorization transitions racing with a launch or active run. Wait, safely
cancel, or suspend; do not retroactively make stale runs acceptable.
Terminal cleanup revokes active permission and retains tombstones/history.
Failure/cancellation cleanup does not require passing validation.

Audit mutations, denied launches, runs, classifications, approvals, recovery, and
completion. Sanitize agent-supplied text, bound logs, and exclude secrets.
Define retention/backups and access controls; never delete ID tombstones during
routine log pruning. Workflow-local logs are not tamper-evident evidence.