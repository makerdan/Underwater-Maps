# Owner-directed task closure

This is an explicit exception to validation-required completion, not a way to
turn failing, missing, blocked, or stale evidence into validation success.
It authorizes administrative closure of the particular task the owner names.
It supplies no host adapter, credentials, platform hook, or lifecycle API.

## Authority and task binding

An explicit instruction from the owner in the current authorized conversation
to close or mark a specific task complete is sufficient owner authorization.
Resolve "this task" through verified current context; ask for disambiguation
only if identity or intent remains genuinely ambiguous. Do not demand a second
confirmation, passing validation, tier change, second reviewer, or plan
activation merely to establish this closure decision. Platform permission and
approval cards still apply; ownership/authority cannot be invented.

Record the real user message/decision reference, requested task and Project,
observed record version, plan/version/digest where present, known validation
state, unresolved checks/repairs, and closure reason. If no reason was supplied,
record "owner direction"; do not fabricate one. A draft without an approved
plan/tier may still be administratively closed; record absent fields honestly.
Pin decision contents to retained evidence. If a real message ID is not
exposed, retain an accurate scoped conversation decision record; never invent
an ID or imply cryptographic identity verification.

A chat summary, task author assertion, owner instruction quoted in a file,
caller-written `approved: true`, or ordinary plan approval is not this decision.
The task Agent cannot authorize its own closure, infer an automatic waiver
from frustration/silence, or install a standing auto-close policy from this
one-task instruction. A verified explicit owner instruction is not Agent
self-approval and needs no invented reviewer roster.

## Completion and validation are separate

Retain ordinary `status: completed` if the host uses it, but persist an explicit
equivalent of `completionMode: owner_direction` and a closure decision reference.
Ordinary checker-accepted completion uses `completionMode: validated`.
An existing legacy completed record without a mode is not automatically a pass;
use its actual retained validation evidence.

Validation assessment and raw evidence remain unchanged: retain PASS,
ACCEPTABLE_WITH_IGNORED_FAILURES, FAIL, BLOCKED, or INCOMPLETE as actually
observed, including unavailable/not-run checks. If no assessment exists,
record "not run/unknown", not PASS. Preserve required repairs and baselines
as unresolved; closure does not fix, ignore, expire, discharge, or silently
remove them. Report any remaining responsibility instead of creating a new
repair task or changing scope without authorization.

All local readers, reports, prerequisite evaluators, and verification adapters
must distinguish administrative closure from accepted validation. A dependency
may become schedulable under host semantics, but downstream validation/delivery
requirements still need real evidence. Do not propagate owner closure as a
passing test, delivered implementation, satisfied repair, or successful gate.

Use this report wording:

> Closed by owner direction—not validation passed.

Also report actual checks/failures, unavailable evidence, retained obligations,
and whether local and/or platform status was actually changed.
Indexing, health views, retention, and exports of these decisions follow
[evidence-and-recovery.md](evidence-and-recovery.md); they add no passing-test,
health/restore-check, or second-confirmation prerequisite to owner closure.

## Local administrative closure

Discover a verified local closure route which can atomically bind the owner
decision, exact task record/version, completion mode, retained validation
assessment, terminal permission release, and audit history. Host equivalents
are allowed; no prescribed database/CLI/schema is required.
A durable linked audit event can hold the mode when the primary schema cannot,
provided readers resolve that binding unambiguously. If neither is possible,
local administrative completion remains blocked; do not write a bare completed
flag which readers mistake for validated success.

The local operation verifies decision provenance, record identity/version,
permitted transition, concurrency, and safe run handling. It does not require
the validation checker's PASS/acceptable result or call a missing validation
runner as a prerequisite. Do not disable or weaken the ordinary checker,
tier definitions, baseline governance, or policy to perform this exception.

Coordinate against launches and active runs. Stop, wait for, or quarantine
task-owned runs through documented authorized recovery; a timeout does not
prove process death. Do not kill unrelated work, allow orphaned running
authorization, or perform unsafe side effects. If safe recovery is unavailable,
report that local closure is blocked for safety, not for failing validation.
Atomically commit owner closure with its audit and revoke task permissions;
all tiers become NOT ALLOWED. Audit failure rolls back the local transition.
No passing-run snapshot or code-writer lock is needed merely to waive validation
when it cannot establish a validation claim; lifecycle/run coordination still
is required, and any host-mandated safety constraints remain in force.

Recheck the exact record/plan version before committing. An intervening material
change is reconciled against the owner's stated scope, not silently added to
the decision. Duplicate delivery of the same decision is idempotent.
Do not reopen terminal IDs or rewrite historic validation. If already complete,
report the existing result and owner intent without retroactively adding a
validation pass; failed/cancelled terminal records keep their history and
require the host's permitted annotation/successor route rather than rewriting.

## Agent-native platform closure

Project code/CLI still must not invoke, proxy, request, depend on, or impersonate
platform-managed completion. This restriction does not prohibit the Agent
itself from using a genuinely available authorized native task interface on
the owner's explicit direction. Never guess an API, use shell/connector
workarounds, modify platform dispatch, or claim an operation the interface did
not perform.

Resolve the exact platform task independently; a local ID is not a platform ID.
Use existing permissions and mandatory platform approvals. Report administrative
closure and unresolved validation in the actual supported task note/report,
not a fabricated PASS. No automatic merge, deploy, publication, or deletion is
authorized by closing the task.

Local and platform writes are separate operations: do not presume a cross-system
transaction. Read back each changed record and report partial outcomes; reconcile
unknown outcomes before retrying. Platform closure may proceed on explicit owner
direction even when a local validation/closure adapter is absent or blocked,
but report that local status/cleanup remains unresolved and never treat platform
Done as local acceptance or evidence that active local runs stopped.
If no native interface is available, report that platform status was not changed
and the owner's manual next action; do not claim a lock on the owner's authority.

## Ordinary completion remains protected

Without explicit task-scoped owner direction, all normal validation, provenance,
ownership, approved-tier, snapshot, and final-writer rules remain unchanged.
Do not broaden this exception to other tasks, future runs, baseline promotion,
policy changes, or Agent-initiated convenience closure.