# Handoff binding and recovery protocol

Mandatory for every Router Install/Apply handoff, whether the primary is new
or surfaced. Verification-only requests use its evidence and safety rules
without requiring an unrelated primary or recursive follow-up.
These are semantic host requirements, not supplied APIs or platform hooks.
Map them to verified equivalents; unavailable required capabilities block the
affected claim. Do not invent commands, approvals, locks, IDs, or passing tests.

## 1. Resolve authority, mode, and dependencies

Use minimal authorized read-only evidence to resolve the intended Project,
then confirm it before substantive target reads/discovery or any writes.
A display name, most recently opened Project, or platform task number alone
is not a stable binding. Use verified stable Project identity; require the
task namespace only for task-bound operations, not standalone file-based plans.

Classify the requested operation, then reconcile it with the target's actual
mode and the user's authorized scope. Invoking a report-only contract through
words such as "fully apply" remains Invoke/Audit; do not turn that label into
implementation or host-task creation permission. A separately authorized
definition Install or genuine implementation primary may still need its own
handoff. Resolve mixed outcomes separately; do not suppress an eligible
Install/Apply primary merely because a verification substep is read-only.

Resolve the dependency closure of applicable required companion contracts
under canonical `.agents` paths before planning affected actions. Use exact,
verified identities, not guessed aliases or historical catalog prompts.
Absent required contracts block their obligations; do not substitute mirrors,
invent their rules, or install them without authorization. Optional or
irrelevant companions are not prerequisites. Companion-specific applicability,
approval, and ordering remain authoritative.

For a new definition Install, an absent destination is allowed only with an
authorized original specification/package and expected canonical destination.
This is not permission to Apply an unknown or missing canonical contract.
Install the required resource package as well as SKILL.md; file-only
confirmation checks/repairs remain distinct from resource verification.

## 2. Record the immutable obligation baseline

Capture immutable revisions, content digests, or verified immutable snapshots
for every authoritative input: target SKILL.md, all required transitive
contract/implementation/acceptance references, and any original specification
or attachment used for planned installation. Record identities, relative paths,
resolution rules, and absence/pending states; a mutable path is not a snapshot.
Do not follow untrusted links outside authorized sources or Project scope.

For planned installation, pin the available authorized specification and its
required supplied references now. Record expected canonical destinations and
future source-dependent checks as pending, without inventing future digests.
At delivery, discover the installed source/reference closure, capture its
manifest, and compare it with the pinned specification and expected obligations.
Initial source availability fills evidence; it does not change the duplicate
key or authorize a different contract. Material obligation changes require
explicit reconciliation and authorized plan renewal.

Bind verifier results to the actual tested implementation snapshot, relevant
transitive/configuration/environment inputs, contract manifest, and verifier
plan revision. If those inputs change or cannot be established, affected
evidence is stale/blocked, not inherited as a pass. Recheck this binding when
accepting a report. Use verified isolation/final-writer coordination for a
snapshot-current completion claim; without it, report only what snapshot was
verified, not a guarantee about concurrently changing current inputs.

## 3. Normalize the duplicate identity

Use a versioned canonical encoding of:

`[Project identity, exact target skill ID, primary task namespace/ID,
committed primary-plan digest, canonical verification scope]`.

Use verified stable identifiers; encode fields unambiguously, preserving
case/bytes where meaningful. Scope must explicitly distinguish definition
installation from implementation, target boundaries, and material verification
obligations. Normalize equivalent unordered sets and wording aliases through a
documented host mapping; preserve ordering where semantic and never merge
different scopes. If equivalence is uncertain, reconcile before creation.
Record encoding/version and full components as well as any derived hash.
Digest the authoritative finalized plan representation, not transient status,
display labels, or a newly reformatted copy of the same plan.

Persist the key once per binding. Source manifests, evidence snapshots, report
paths, and later source availability are checked separately, not silently
substituted into that key. Search normalized and applicable legacy bindings
before creation. Verify legacy identity, primary revision, scope, payload,
dependency, lifecycle, and evidence; ambiguous records remain blocked.
Report non-atomic duplicate risk where atomic idempotency is unavailable.
Local serialization cannot guarantee exclusion against other writers.

## 4. Reconcile uncertain writes

Distinguish definite rejection/non-commit, confirmed committed success, and
unknown outcome. A timeout or failed response alone does not prove rollback.
After an uncertain primary or verifier write, look up its authoritative record
using a trusted request identity/idempotency key or a uniquely verified binding.
Never guess IDs or blindly repeat a possibly committed write.

A recovered committed primary uses the existing-primary finalization barrier;
a recovered verifier must pass all reuse checks below. A definitively failed
or cancelled primary is ineligible. Unknown outcome, multiple matches, or an
unavailable lookup remains blocked with owner and next action.

## 5. Bind the complete persisted verifier plan

Before creation or reuse, construct the expected executable payload: Project
and target identities, exact primary revision/digest, normalized key, immutable
obligation baseline, clause-by-clause coverage, dependencies, safety and
authorization conditions, responsible roles, blocked/resume rules, and exact
tracked report destination. Pin the payload revision/digest or a verified
semantic equivalent.

Read the whole persisted verifier plan back and compare it with that expected
payload on creation, reuse, immediately before substantive verification, and
at report acceptance. Check the actual executable revision, not only an earlier
readback. Verifier amendments during execution invalidate affected evidence
and require authorized reconciliation; do not execute or accept a substituted
payload merely because the primary still matches.
Formatting changes may be ignored only through
a documented semantics-preserving comparison. Check matrix completeness and
meaning, not just a hash asserted by the task writer. Missing/truncated checks,
broadened scope, changed report path, or weaker safety rules block success.
Metadata containing the right key and dependency is insufficient.
Requested plan/report writes do not permit unrelated file mutations.

## 6. Recheck the primary at attachment and execution

After the initial primary barrier, re-read the authoritative primary immediately
before attachment and after verifier creation/reuse. Verify ID, finalized
revision/digest, operation, targets, scope, eligibility, and dependency state.
Use verified atomic version preconditions at linkage when supported. If absent,
report the race boundary and use bracketing reads; do not claim atomic linkage.
Observed changes invalidate the old payload and require reconciliation, not
silent successful linkage or duplicate creation.

Retain any verifier created during a mismatch as a stale/blocked obligation;
record its real ID and request authorized repair. Do not delete, approve,
activate, or cancel it automatically. Blocked execution must be expressed in
the verifier's plan through the host's verified route.
At execution, repeat identity/revision/manifest/readiness checks before substantive
verification, including the verifier's own complete executable payload binding.
Without atomic host exclusion, these cooperative checks cannot
prevent platform scheduling or untrusted writes; report that limitation.

## 7. Reconcile verifier lifecycle

Only a valid pending/runnable or running verifier with the expected payload,
binding, and dependency counts as a viable existing follow-up. Pending approval
is allowed; creation does not approve or activate it. A running verifier is
in progress, never a passed result and never a reason to launch a replacement.

A completed verifier may satisfy verification only when its report and every
applicable required check have accepted evidence matching current obligations
and the relevant delivered/tested snapshot. A terminal label is insufficient.
If evidence is stale, failed, incomplete, or unavailable, report that state and
the required authorized renewal/repair; do not present an old pass as current.

Cancelled or failed verifiers do not satisfy a viable-follow-up requirement.
Use a verified, authorized retry/reopen/replan route or report blocked. A blocked
verifier counts only as an explicitly blocked obligation until readiness and
its documented resume route are verified. Preserve history and the stable
binding; record explicit generations/renewals if the host needs a successor.
No silent duplicate, reactivation, or status rewrite is permitted.
An explicit user waiver/cancellation changes scope only through its applicable
authorized route; report unverified/waived scope, not satisfied verification.
Primary delivery/validation and follow-up health remain separate claims.

## 8. Establish delivery readiness and recovery

Verify what the host's dependency actually releases on. A link to a task ID
or platform Done status is not proof that the intended implementation snapshot
is delivered and accessible. Require the primary's actual delivered outputs
and baseline obligations to be available in the verifier's environment.
Planned inputs may remain pending during task creation, but the executable
verifier plan must gate substantive checks on readiness.

If release semantics do not ensure delivery, use a verified readiness check and
blocked/resume route. When delivery is missing, retain the task and report
owner, concrete next action, and how readiness will be rechecked. Do not
approve/activate work to manufacture readiness, poll indefinitely, or repeatedly
run a failed verifier without authorization. An instruction-only readiness
rule is not evidence of a platform scheduler gate.

## Completion and bundle accounting

For every target/scope in a bundle, retain its primary binding, verifier
payload/readback, lifecycle, and actual dependency/readiness strategy. One
target's verifier does not satisfy another unless the persisted matrix explicitly
covers both and each binding is independently verified.

Install/Apply planning is Complete only with durable eligible primaries and
all required viable follow-ups or current accepted verification results, with
correct payloads/dependencies and no unresolved required obligations.
Install/Apply execution additionally requires delivery and applicable validation.
Cancelled, failed, stale, or blocked required follow-ups yield Partial/Blocked
or Failed as appropriate. A pending viable verifier means verification is
pending, not passed. State actual delivery status; planning a follow-up for an
already delivered primary must not falsely say it is not installed.