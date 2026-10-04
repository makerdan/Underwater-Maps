# Failure Gate v4 — project-local implementation contract

Read this when installing or changing the project-local workflow. These are
interfaces and requirements to implement, not claims that commands already exist.
For installation, classification/evidence acceptance, recovery, health,
retention, or export, read the complete
[evidence and recovery contract](evidence-and-recovery.md). Implement its eight
capabilities through verified host equivalents; the optional-history and
owner-directed closure exceptions remain intact.

## Scope and migration

Inventory the host before editing. Reuse its existing build/validation tools,
project-local task lifecycle, baseline schema, and canonical instruction sources.
Do not install a second competing runner or weaken existing coverage.

## Host adaptation

The contract applies to web, mobile, desktop, CLI, libraries, embedded systems,
infrastructure, data pipelines, and documentation projects. Local tooling may
run in the developer environment; it need not run inside the deployed application
or on the target device. Do not add a backend to a static app merely to host a gate.
These are project-local task records, not Replit Agent's platform task records.

Record these mappings before choosing implementation details:

| Contract concept | Host mapping |
|---|---|
| Project identity | Verified project-local namespace; Git is optional. |
| Canonical instructions | Host instruction sources; `.agents` where supported, never generated mirrors. |
| Task/plan | Durable project-local record and plan, with semantic fields and version/digest mapping. |
| Tier | Existing check group or an explicitly approved grouping of real available checks. |
| Execution | Host-language process runner or build tool with the project's real checks. |
| Evidence | Actual source/artifact snapshot, relevant environment identity, and trustworthy result parser. |
| Storage | Durable transactional coordinator suited to the host's concurrency and availability. |
| Approval/completion | Recorded human/policy decision, ordinary local completion checker, and explicit owner-directed administrative closure route. |

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

Create a capability manifest covering allocator, plan guards, planning discovery,
activation policy, tier registry, checked runner, diagnostics, results parser,
configured approval-event/decision source, recorded approval route, local completion
checker, final-write coordination, persistence, and recovery.
Map owner-directed closure separately, including retained decision evidence,
completion mode, local reader semantics, safe terminal release, and any
genuinely available Agent-native platform operation. Missing closure support
does not fabricate an ordinary validation result or platform adapter.
State the verified interface for each. Do not claim integration with a platform
task lifecycle that cannot be demonstrated.
Publish the contract's tracked evidence index and record its path in this
manifest. Include actual backup/restore, evidence-health, lineage, retention,
export, and completion-mode reporting routes and their availability states.
The index is a locator, not a second authoritative task/allocator registry.

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
restart behavior, access permissions, and project-local scope. Never merge live
database binaries from task branches or assume a local database coordinates clones.
Prove allocator restoration through an authorized isolated host exercise,
including post-backup committed-ID reconciliation, writer fencing, namespace,
tombstones, transaction consistency, and stale-permission handling. Missing
proof blocks recovery readiness; an old backup cannot authorize ID reuse.

Install via a separately approved bootstrap operation using existing safe
validation. When replacing an active gate, use its prior verified checked
route and selected tier for this operation only; ordinary task validation
stays blocked until the new route is verified and the prior ordinary-task
route is removed in one cutover. Record approval specifically for this
installation; do not reuse an earlier task's bootstrap approval. Do not run
every tier or substitute focused diagnostics for the selected tier. Bootstrap
is limited to implementing the gate, logs its actual checks, and cannot
authorize ordinary tasks. Verify acceptance tests and a live local-ID checked
command before enabling the new route; fixture-only tests do not prove a
live cutover. Migrate existing plans explicitly;
preserve historical task records without rewriting or retroactively approving
them. Do not invent historical IDs, approval events, or task authorization.
If a required approval source, writer lock, or adapter is missing, leave activation
blocked rather than running two authorities or a fallback.

## Authority and approvals

This workflow is a cooperative project control. A user approval may be recorded
with a real conversation/task reference and exact approved change. Label its
verification accurately: locally recorded approval is not cryptographic identity.
Never fabricate an approver or use an example reference in real state.

For the Replit approval route, trust an explicit Replit plan-approval action
as the authorization event without requiring an approver identity, identity
attestation, or reviewer roster. Verify the event, its subject, and the
governing bindings instead. Approval of a command, starting work, Active/Ready
status, or merging/applying finished changes is not approval of the plan.

The host adapter must retrieve or capture the actual approval through a
supported, trusted platform interaction source; no event API or webhook is
assumed. Record the real event reference and stable evidence of the action
and exact approved plan/version/digest. Bind it to one verified local task ID,
the plan's single declared registered tier, tier-definition digest, permitted
parameters, policy version, and authorization version. Check guard-verified
coverage and current policy/definition versions before activation. No actor
field is required, and its absence must not block an otherwise valid event.
An approval event cannot authorize another local ID or a changed plan or tier.
Retries of the same activation obey the coordinator's idempotency/CAS rules,
not a second task assignment.

Configure how the coordinator obtains and checks event evidence, approved
contents, and the local mapping. A caller flag, guessed event ID, agent-authored
approval claim, or supplied reference without the real action evidence is not
an event. Missing/inaccessible evidence or an unverifiable mapping blocks
activation; do not install a placeholder source. Approval is a design contract
here, not a claim that Replit exposes the needed adapter in this host.

Pin event/decision contents and applicable policy to stable, versioned evidence
and retain its reference with authorization and audit atomically. A staged
file, branch name, or working-tree path alone cannot pin approval contents.
A committed revision is an optional way to preserve captured evidence, not
proof that a Replit approval occurred. It must originate from the verified
event source. A later ref move must not change the pinned record.
Other hosts may keep a designated local human-review route, separate from
the task agent. Only an identity-based route needs reviewer-authority checks
from the same pinned snapshot as its decision; do not impose that roster
on the Replit-event route.

The owner may approve a deterministic activation policy once, separately from
individual task plans and before any task uses it. Record the actual approval
reference, version, effective scope, eligible plan source/approval criteria,
fixed tier-selection rule, permitted parameters, and change/revocation route.
Installation may propose this policy but cannot presume it active; obtain its
separate approval under the prior governing route. A task agent cannot approve
or change the policy to authorize its own work.

One permitted deterministic rule is "select the single registered tier stated
in the approved plan" when plan guards verify that tier covers the change.
Missing, multiple, unknown, or uncovered tiers fail closed; the policy cannot
silently choose a substitute.

For each eligible ordinary task, read the exact approved plan from the verified
source and check its project-local ID binding, version/digest, selected tier,
tier-definition digest, parameters, policy version, and authorization version.
Record a new policy decision and its stable source-snapshot identity atomically
with activation and audit. A separate human decision is not required per task
when the already approved deterministic rule matches exactly. An approved
Replit task plan may be a policy input only if its approved contents and
mapping to the local task can be verified by a real host adapter; a Replit
task number, plan title, or unverified claim of platform approval cannot
establish that binding. Unmatched/uncertain plans need a fresh applicable
approval or block.
Changed plans, tiers, tier definitions, parameters, or governing policy need a
new bound decision; never silently carry forward the prior authorization.

Tier changes, obligation removal, baseline widening, and policy changes require
a recorded authorized approval. When that route is unavailable, stop the mutation.
A caller-written `approved: true`, actor name, or command flag alone is not an
approval record. These checks are procedural: a local record cannot authenticate
the human or resist deliberate edits by an agent with write access.
The skill does not install a human review service or catalog-maintenance route.
If no approved local route exists for either action, leave it blocked rather
than constructing a draft approval or silently widening baseline authority.

The checked runner records the actual invocation, local task ID, plan and policy
versions, tier digest, snapshot, raw results, and artifact references. The
project-local checker cross-checks this record and rejects an ad-hoc run or a
manually supplied `PASS` label as required-tier evidence. It cannot prove result
authenticity against someone able to alter the runner, results, or checker.

Resolve supplied IDs and plans against the project-local task record and
namespace; another valid local task's plan is not interchangeable. Never infer
a task from the newest plan. This does not establish which Replit Agent task is
currently active or control its platform completion.

## Identity and single-source authorization

Reserve monotonically increasing local display IDs such as `TASK-001042` in a
transaction in one project-local namespace. Only expose a reservation after
commit. Keep permanent tombstones; committed IDs are never reused after
abandonment or terminal states. Import existing IDs with uniqueness checks.
Do not claim repository-wide uniqueness or coordination across independent
workspaces. Namespace plus UUID identifiers are an alternative to local
sequential display IDs.
A supplied Replit Agent task number is not authority to allocate, activate,
validate, or complete a project-local task; resolve the local record and its
approved plan for ordinary validation, or its explicit owner closure decision
for administrative completion, through the project coordinator.

One task row is authoritative:

```json
{
  "taskId": "TASK-001042",
  "projectNamespace": "configured-local-namespace",
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
  "pendingChangeId": null,
  "completionMode": null,
  "closureDecisionReference": null,
  "validationAssessment": null
}
```

The example is not live authorization. Constrain enums and fields with runtime
validation. Preserve original tier and transitions in history, not duplicate live
allow/deny lists. Absence of an active authorized tier means deny.

Project per-tier status is a derived view: for an active, unsuspended task,
only the assigned registered tier is `ALLOWED`; all other registered tiers,
including newly added tiers, are `NOT ALLOWED`. Suspended and terminal tasks
are `NOT ALLOWED` everywhere. On activation and each permitted change, append
the evaluated per-tier status and registry version to the same transactional
audit event; it is a historical snapshot, never an independent permission list.

States: `draft`, `active`, `completed`, `failed`, `cancelled`.
Only active, unsuspended tasks may start required-tier runs. A pending change
does not authorize its target. Terminal records have no current authorized tier.
Never reopen terminal IDs; create a new linked task.
For completed records, distinguish `validated` from `owner_direction`
completion or equivalent unambiguous audit binding. Owner-directed closure
retains the actual validation assessment and unresolved obligations.
Existing completed records are not passes solely because their mode is absent.
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
An approved scope/tier move updates plan, versioned authorization, one-tier
assignment, and derived audit snapshot atomically. A pending request cannot
allow the proposed tier; keep the old assignment if its coverage remains
adequate, otherwise suspend required-tier runs until review.
If the previously approved deterministic rule covers a proposed amendment,
run guards and record a fresh policy decision against its exact new plan and
tier bindings; otherwise require a fresh applicable approval. Approval of
the original plan does not approve a different version or tier definition.

Store the canonical approved plan content/digest with the transaction. A tracked
plan file is the working projection: execution must match its version and
semantic content to the approved record.
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
state. Do not record secrets; record safe versions or non-secret identifiers.
Document exclusions such as logs and report outputs
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
Demonstrate how relevant writers participate in an effective lock or equivalent
isolation. Under that coordination, check the final manifest, assess complete
evidence, and commit the terminal transition before releasing writer and
authorization protection, so an edit cannot slip between acceptance and
completion. A coordinator-only database lock that does not coordinate relevant
file writers is insufficient. If the host cannot establish this coordination,
deny local completion and do not activate the new ordinary-task route at cutover.
For a mutable shared worktree, implement and verify a file-writer coordination
adapter used by participating writers; an isolated immutable final snapshot is
an alternative only when the accepted task state is actually bound to it and
the mutable projection cannot silently diverge during the terminal decision.
An [optional POSIX writer-lock reference](adapters/posix-writer-lock/README.md)
includes code, tests, and a host checklist. Use it only where its filesystem
and process assumptions are verified; do not treat bundling or primitive tests
as host integration. Hosts may implement another suitable adapter instead.
This checked workflow cannot prevent out-of-band edits by an agent with shell
and write access.

## Tier registry and checked execution

Use one registry for scaffold, guards, runner, and completion checker. Each tier
defines argv-based commands, root/working directory, required steps, dependencies,
permitted parameters/environment, diagnostics, timeouts, reports, discovery
expectations, and coverage. Pin its canonical digest.
Preserve the host's existing registered commands, resource locks, report adapters,
and baseline catalog during migration unless separately authorized to change them.

### Independent-caller compatibility

Inventory actual independent validation callers, their unchanged command strings,
arguments/environment, safety/access requirements, and expected reports. These
may be platform final checks, CI, a local build/test tool, a scheduler, or another
host integration; none is assumed present. Distinguish their existing execution
from a request for checked task-tier validation. No fixed tier names, environment
variable, framework, provider, or command layout is required.

Enforce task authorization in the explicit checked entry point or an equivalent
verified interface boundary. Shared underlying checks must remain callable by
existing independent callers without new task metadata, plan files, or caller
changes. Preserve their command strings, checks, coverage, timeouts, resource
locks, reports, heavy-suite serialization where present, and shared workflow/
Run-button definitions unless separately authorized to change them. Independent
execution is not a newly authorized tier or a replacement task lifecycle.

Checked execution must resolve and verify the exact task/namespace, approved
plan/version/digest, authorized tier/definition, and applicable current
authorization before launching validation. Provide a verified native-argument or
local-interface plan-input route that works without an environment variable;
additional environment/file adapters such as TASK_PLAN_FILE are optional.
Define input precedence; reject conflicting supplied
bindings rather than silently picking a different plan. Never infer authorization
or mode from variable presence/absence, a caller label, direct tier selection,
or a bypass flag. An invalid checked request fails before launch; it cannot fall
back to independent execution. Task agents must still perform checked validation.

Independent results retain their actual executed steps, exit statuses, failures,
missing reports, and incomplete states. Keep their origin/purpose distinguishable
from checked run records; do not create checked leases, authorization decisions,
or required-tier evidence merely because an independent command ran or passed.
The local task-evidence acceptance boundary rejects independent results relabeled,
copied, or attached as required-tier evidence. Existing independent checks with
their own obligations retain those obligations; they cannot replace the task's
required checked run. No platform-managed completion result is imported.
This is procedural evidence separation, not resistance to deliberate local forgery.

Compatibility is not a new ordinary-task route or enforcement cutover. If the
host's verified plan-file interface is the sole approved route for ordinary task
validation, leave that route, its exact plan bindings, and its change controls
intact until the separately approved cutover. Keep independent callers working
through their existing independent invocations; do not demand a task plan for
them and do not convert their outputs into task evidence. Conversely, do not
invoke other registered tiers under a plan approved for only one tier, or use
independent checks to finish a task whose required-tier validation is blocked.
This compatibility boundary does not waive separately applicable approval for
an actual wrapper, runner, checker, or authorization-policy change.

Regression verification must show existing independent invocations actually
execute their intended checks without the optional variable, supported checked
inputs work, invalid checked requests launch no checks, and evidence separation
holds on both passing and failing/incomplete outcomes. Use authorized safe host
checks and retain real reports; mocks cannot prove a platform caller works.
Unavailable safe host execution blocks the compatibility-readiness claim, not
permission to invent results or weaken authorization. Attribute an installation-
introduced caller rejection to the integration change when provenance supports
that cause, not automatically to an unrelated product baseline.

For an existing host, a scoped compatibility repair does not itself require a
new lifecycle or a fresh enforcement cutover. It still follows the existing
approval/versioning contract for changed wrappers, runner, or checker; initial
installation and actual authority replacements retain the bootstrap/cutover rules.
When an original package is being installed/confirmed separately, preserve its
pinned source and installation-fidelity evidence, then record the authorized
amendment as a distinct revision/change. Do not silently fold the amendment into
the original spec or claim original-source confirmation against a revised package.

Treat the registry, runner, checker, and command wrappers as governing policy.
Compare the actual versions executed, including indirect script entry points,
with the approved local versions. If they changed, require separate approval
before accepting a run for the same task. This detects unapproved changes when
the checked tooling is used; an agent can still bypass or edit local checks.

Abstract interface to implement in the host's native tooling, not a command to
copy into a shell:

```text
activate(taskId, planReference)
  -> authorizationVersion, selectedTier, boundDecisionReference
run(taskId, planReference, purpose = required_tier_validation)
  -> runId, rawResults, evidenceReferences
```

Adapt language and command to the host. Ordinary-task tooling must provide
checked activation and checked required-tier execution with the supplied
local ID and exact plan; subsequent reruns use the existing authorization,
not a repeated activation. A draft/review-request-only CLI is not an
ordinary-task route, and direct tier commands are not checked task evidence.
In the task-agent flow, invoke local activation as the Draft/Plan task enters
Active, then do the work and use the checked runner on the resulting inputs.
Repeat checked validation after relevant edits; an activation-time pass cannot
validate later work. No platform Active-state event subscription or task-ID
mapping is assumed: without a verified adapter, the task agent must call the
local route explicitly and report if it could not. Never infer local activation
solely from platform status.
Until both operations exist and pass live local-ID acceptance tests, keep
ordinary validation blocked. Never recommend a command before it exists and
passes checks. Resolve the tier from the task record; if a requested tier is
supplied, reject any mismatch rather than overriding the record.

Before launch:

1. Resolve local project identity and plan reference. Reject traversal and
   escaping symlinks. Reject another task's plan and mismatched plan
   content/identity.
2. Validate active state, suspension, approval, version, tier digest, parameters,
   policy, referenced ignore eligibility, and absence of unresolved recovery.
   Expired records cannot authorize ignores but do not erase owned repair obligations.
3. Acquire a run lease against the current authorization version, atomically
   recording the run and its audit event. Coordinate with transition and host
   resource/writer locks.
4. Capture the tested snapshot/environment and launch only approved argv.

Do not interpolate untrusted strings into a shell command. Validate diagnostic
selectors and neutralize coverage-reducing environment/config overrides without
blindly removing runtime variables the host needs. Validate report paths and bound
output; truncated/missing machine reports cannot substantiate acceptance.

Collect each required step's real status and reports, including named
not-reached steps. Reject required runs if a report adapter is absent or
incomplete. Continue independent steps where safe even after an ignored
failure; never conceal unexecuted obligations.
Return nonzero for raw failing runs; the completion checker separately records
whether policy accepts their accounted-for failures.

All project-local checked entry points delegate to this runner. Unmanaged
execution is not accepted by the local checker, but cannot be prevented.
Replit Workflows or other schedulers may start checked commands but do not
establish plan approval. Preserve task/run IDs, actual tested inputs and
environment, raw per-step results, and the subsequent local completion
decision separately from the orchestration result.

## Planning, diagnostics, maintenance, and completion

Run purposes are explicit:

| Purpose | Authorization | Can satisfy required task validation? |
|---|---|---|
| Planning guards | Bounded pre-activation policy | No |
| Baseline discovery | Registered planning policy | No |
| Required tier | Active task authorization | Yes |
| Diagnostic retry | Current tier's diagnostic capability | No |
| Provenance comparison | Registered comparison capability | No |
| Additional project-local check | Separate explicit local check policy | Only its own obligation |
| Maintenance/bootstrap | Explicit bounded maintenance approval | No |

Planning guards operate on a reserved draft before activation, resolving the
bootstrap deadlock. They cannot invoke arbitrary tests. Baseline discovery is
similarly narrow and records the pre-edit snapshot without activating work.

Diagnostic retries remain subordinate to the current tier; they are not filtered
substitutes for full validation. Comparison runs use isolated verified earlier
contents without resetting the user's working tree or touching production data.

The project-local completion checker is required for ordinary validated
completion. Its result controls that local validation decision only.
Explicit task-scoped owner direction may instead use the separate
[administrative closure contract](owner-directed-closure.md); it requires an
honest owner decision and safe terminal transaction, not passing validation.
Replit Agent may perform its own checks and
move its platform task to Ready or Done without invoking this checker; do not
claim that a local test proves otherwise or modify platform-owned dispatch as
a workaround.
Return the local validation outcome and evidence for the user's normal
review/merge-or-dismiss decision. Do not auto-merge or represent a failing or
blocked local run as validation success. Project-local tooling cannot force
the platform to wait before offering that decision.
Project code and CLI must not call, request, depend on, or present a result
from platform-managed completion. Retire an existing managed-completion CLI
operation during an approved migration; do not replace it with a hidden fallback.
Existing direct tier commands remain diagnostic and cannot become local task
completion evidence.
This project-code/CLI restriction does not prohibit genuinely available
Agent-native task operations on explicit owner direction. Do not proxy those
operations through local tools. The reference governs authority, independent
local/platform outcomes, readback, and truthful partial-result reporting.

## Run evidence, baseline policy, and completion

Runs contain task/run IDs, purpose, authorization/plan/tier versions, snapshot and
environment identity, actual timestamps, per-step raw statuses, artifacts/digests,
discovery counts, and policy assessment. Preserve failures individually.
Record classification lineage and original corroboration sources with immutable
bindings. Preserve distinct missing-evidence states and dependency-aware retention;
health inspections are read-only and exports never carry activation authority.

Baseline policy defines failure matching, permitted volatile-field normalization,
environment applicability, authoritative clock, expiry boundary, reviewer authority,
and renewal/revocation. Preserve meaningful assertion, exception, endpoint, variant,
and stack distinctions. Ambiguous matches fail closed.
If no verified project-local catalog-maintenance approval route exists, do not
promote new baselines; task-local evidence cannot create catalog authority.

Check ignore eligibility at planning, activation, launch, classification, and
completion. Default: expiry/revocation before completion invalidates the ignore;
request separate review rather than self-renewing it. Repair ownership survives
expiry. Historical/non-active records may corroborate but never directly authorize
an ignore. Promotion is separate maintenance, never an automatic task side effect.

The checker evaluates complete evidence, exact applicable baseline matches,
provenance, fixed owned obligations, and any required independently verifiable
project checks. It never imports a platform-managed completion result.
It cannot trust a run's agent-supplied `PASS` label. A procedural human review may
be needed for semantic provenance; record the reviewer and mode honestly.

All unknown statuses, missing results, or unaccounted failures block validation success.
Preserve raw exit statuses even when assessment is acceptable.
Owner-directed administrative completion is not validation success; its status
and recorded mode cannot satisfy validation/delivery prerequisites without
actual evidence. Implement the reference's separate local transition and
reader semantics before claiming local owner-closure capability.

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
Apply the evidence contract's protected-artifact dependencies and invalidation
rules before authorized pruning. Index/export/health views must distinguish
validated completion from owner direction and visibly retain unresolved work.