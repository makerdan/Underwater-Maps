---
name: skill-application-router
title: Skill Application Router
description: Resolve and fully apply named skills to the current project, and plan independent verification for a durably recorded Install/Apply task, whether newly created or already existing and surfaced by Replit Agent. Use for fully apply, implement, integrate, install, set up, enforce, or adopt requests, or to verify skill installation/implementation, plan verification, or execute it and report. Preserve canonical sources, scope, safety, prerequisites, task identity/dependencies, and validation.
---

# Skill Application Router

Turn ordinary requests such as `Fully apply port-authority to this project`
into the target skill's complete workflow. Do not require exact phrasing.
Coordinate target skills without weakening, replacing, or broadening them.
This is one skill with a bundled verification-planning module, not two
separately installed skills. For Install/Apply follow-ups or an explicit
verification request, read
[the complete verification planner](references/installation-verification-plan.md)
from this router's canonical `.agents` package. An explicit verification-only
request uses that module without installing/applying the target or recursively
creating follow-ups.

## Classify the request

Before acting, classify each requested outcome:

| Operation | Meaning |
|---|---|
| **Invoke** | Follow the skill for the current task only |
| **Install** | Add an authorized definition to `.agents/skills/<skill-id>/` |
| **Apply contract** | Implement every applicable project requirement |
| **Audit** | Inspect and report without changing the project |

`Fully apply`, `implement everything`, `integrate completely`, and
`apply the complete contract` mean **Apply contract** unless context clearly
requires another operation. Never copy a definition merely to apply its
contract or claim the contract is applied because `SKILL.md` exists.

If ambiguity would change files or scope, recommend the best interpretation and
ask one focused question.
Classify verification-only planning as Invoke of the bundled planner and
authorized verification execution/reporting as Audit, not Install/Apply of
the target. Creating a host task still requires
the requested or required task-creation scope and a verified host interface.

## Resolve target skills

Use minimal authorized read-only evidence to resolve the intended Project,
then confirm identity before substantive target discovery or any writes.
Do not assume the most recently opened Project or a display name alone suffices.
For each named skill:

1. Normalize only quotes, backticks, and similar superficial formatting; do not
   guess from a partial identity.
2. For Invoke, Apply, and Audit, resolve the current canonical
   `.agents/skills/<skill-id>/SKILL.md` in the selected Project. For an authorized
   new definition Install only, an absent destination is permitted with the
   authorized original specification/package and expected canonical destination;
   pin those inputs and plan later canonical discovery. Never substitute mirrors.
3. Runtime visibility may be inspected separately but does not prove that the
   Project has the canonical source or installed implementation.
4. Never read `.local/custom_skills/`, `.local/skills/`, caches, copies, or
   runtime mirrors as skill-definition sources.
5. If multiple skills match, ask the user to choose. If neither a canonical
   target nor the Install-only authorized source resolves, stop and identify
   the missing evidence for Apply/ordinary invocation; never fabricate a contract.
   For verification-only requests, continue with a blocked discovery plan/report
   instead of inventing the missing source or its target-specific requirements.
6. Read the complete available canonical target and required references, or
   the Install-only authorized specification/package, before affected actions.
   Verification-only missing inputs remain explicit blocked discovery items.

Resolve all applicable required companion contracts through the same canonical
dependency discovery before affected actions. Missing required contracts block
their obligations; optional/irrelevant companions do not become prerequisites.
Reconcile the operation label with the target's actual mode: applying a
report-only contract remains Invoke/Audit unless a separate Install or genuine
implementation outcome and its task scope are authorized.

## Load the command catalog

Read the current complete canonical target `SKILL.md` and all required
references first when it exists. Under the new-Install exception, read the
pinned authorized specification/package instead; future source checks remain
pending. For verification-only missing-source discovery, report the gap rather
than requiring a nonexistent contract or using catalog text as its substitute.
Optionally read `references/custom-skill-commands.md` after
the target is named for wording only; never use it instead of the canonical
contract or follow a conflicting/stale command. The catalog is not a source
of skill definitions.

If the requested skill is absent from the catalog, continue when its canonical
contract is resolved and report the catalog gap.

## Authority and boundaries

Follow, in order: system and platform safety; the current user request; target
skill contracts; project documentation; then this router and its catalog.

Each target skill remains authoritative for its triggers, scope, operating
mode, prerequisites, discovery, ordering, approvals, validation ceiling,
success criteria, failure ownership, and reporting. If contracts conflict,
identify the conflict, recommend the safest interpretation, and ask one focused
question rather than silently choosing.

## Apply the contract

Process target skills in dependency order:

1. **Resolve:** Confirm each exact ID and supported source; load its complete
   instructions and required references.
2. **Classify:** State the operation and whether the target is read-only,
   report-only, mutating, or conditional.
3. **Discover:** Use the target's prescribed inspection to determine applicable
   requirements and gates. Do not assume unproven project capabilities,
   frameworks, providers, services, or deployment models.
4. **Baseline:** Run required pre-edit checks. When files will change, follow
   Failure Gate and separate evidenced pre-existing failures from task-owned
   failures.
5. **Plan:** Map every applicable requirement to an action or evidenced
   `not applicable`; include required companion skills and Regression Guard
   when applicable. Difficulty is not grounds for omission.
6. **Execute:** Follow the target's required order and mode. Obtain required
   consent before destructive, irreversible, privileged, or externally visible
   actions. Edit skill definitions only for an authorized **Install** operation.
7. **Validate:** Run all required checks supported by the environment without
   exceeding the target's ceiling. Add required regression coverage. A skipped,
   blocked, or unavailable check is not a pass.
8. **Reconcile:** Re-read each contract and mark every applicable requirement
   completed, blocked, failed, or not applicable with evidence.
9. **Report:** State changes, validation, pre-existing failures, omissions, and
   remaining user or platform actions. Include the verification follow-up status
   from the next section for every planned or completed Install/Apply target.

For multiple skills, resolve all before edits, order explicit dependencies,
deduplicate equivalent checks without weakening them, and use the strictest
compatible safety and validation rule. Ask before resolving a material
conflict. A bundle is complete only when every target independently satisfies
its completion criteria.

## Verification task from the normal router flow

Read and follow the complete
[handoff binding and recovery protocol](references/handoff-binding-and-recovery.md)
before creating or reusing any follow-up. Its immutable baselines, normalized
keys, full-payload readback, lifecycle, uncertain-write recovery, attachment
checks, and execution readiness rules are mandatory, not optional hardening.

The ordinary router phrases above trigger this handoff internally; the user
does not need to invoke a second skill or use special verification words.
This router is instruction-driven, not a filesystem listener or a platform
task-completion hook. During its invocation, it must reconcile follow-ups for
eligible primary tasks it creates, reads, or is shown by Replit Agent, including
existing tasks created earlier or through another route. It cannot catch other
installation routes or wake up after it has exited without a verified host
callback.

Use either of these equivalent primary-record barriers:

- **Newly written primary:** Finish writing the Install/Apply task first.
  Require confirmed committed success and a real task ID, then allow
  a short settling interval (about two seconds). Read back the authoritative
  record through the Project's verified interface and verify finalization.
  If the response is uncertain, reconcile the authoritative write outcome
  through the protocol; a recovered commit uses the existing-primary barrier.
- **Existing or surfaced primary:** Resolve the actual existing task record
  through that same verified interface. Confirm the selected Project, real
  primary ID, Install/Apply operation, target skill(s), scope, complete durable
  plan, version/digest, and dependency state match this routing request. Use
  authoritative committed/finalized-record evidence rather than requiring a
  new create response, a new commit, or a task write in this invocation.
  Reuse this primary; never create a duplicate primary just to trigger verification.

For either route, require a finalized published plan or equivalent verified
commit/final-write evidence. If the writer is still active, use bounded polling
(for example, up to 30 seconds) and re-read after finalization. A delay, two
identical reads, a surfaced title/card, or Draft/Active/Ready status alone is
not finalization evidence. Missing evidence, identity/scope mismatch, a plan
that changes during the barrier, or timeout blocks the handoff with owner and
next action; it does not silently exempt the primary from verification.
A surfaced Draft/Plan task with a finalized durable plan is eligible; an
uncommitted draft or chat suggestion is not. Do not approve or activate the
primary merely to establish this handoff.

After that barrier, use the bundled verification planner with one of:

- **Primary Install task durably recorded, new or surfaced:** `definition-install-planned`.
  Create a pending task to verify the definition and runtime after installation.
  Do not label the skill installed yet.
- **Primary Apply task durably recorded, new or surfaced:** `full-application-planned`.
  Create a pending task to verify Project implementation after the primary task
  finishes. Do not label the contract applied yet.
- **Direct Install/Apply already completed and durably recorded:** use
  `definition-installed` or `fully-applied` respectively only when a real
  primary task and dependency are available. Apply the matching primary-record
  barrier; without a task/dependency route, report blocked. Platform completion
  status alone does not establish installation/application delivery.
- **Only a chat proposal, Invoke, Audit, definitively failed/cancelled primary
  or uncommitted write, or uncommitted
  draft:** create no installation-verification task. Report remaining work
  without claiming installation.

Read the complete
[bundled planner](references/installation-verification-plan.md) from the
canonical `.agents/skills/skill-application-router/` package. No separate
`skill-install-verification-plan` installation is required. If that reference
is missing, report a blocked follow-up with the responsible next action;
never use a runtime mirror. Pass
the exact Project identity, target skill ID, canonical `.agents` source and
immutable specification/source/reference manifest (pending future source
entries allowed only for planned installation), primary task ID and committed plan digest, scope, and
requested report path. For a planned new installation, the target definition
may not exist yet: pass the authorized specification and expected canonical
destination, mark source-dependent checks pending, and require the verifier
to read the installed source later. Never invent its digest or contract.

Create the separate verification task through the selected Project's *verified*
task-creation interface only after the primary readback succeeds. Give it a
real dependency on the primary task so it cannot run before implementation is
delivered under verified release semantics or the protocol's explicit execution
readiness gate. Do not claim the link alone guarantees delivery.
If the task creator, dependency, or required readiness route is unavailable, report
`blocked`, not `created`. A Markdown plan or a guessed ID is not a created
task. Do not activate, approve, run, or complete the verifier merely because
it was created; it must independently inspect host evidence and publish its
report in the selected Project. Check the primary version immediately before
and after attachment; recheck it at execution. Read the whole persisted verifier
back and compare its payload/matrix, report path, primary dependency, duplicate
key, and lifecycle; on mismatch, report blocked and request
authorized repair rather than announcing successful linkage.

Key duplicate detection by verified stable Project identity, exact target skill
ID, primary namespace/ID, committed primary-plan digest, and canonical scope,
using the protocol's versioned unambiguous encoding. Persist this key.
Keep the source digest as separately checked evidence, not a key that changes
when a planned destination first becomes available. Resurfacing the same
primary/plan/scope before and after installation must reuse the same verifier.
Look up existing records by that binding before creation, including legacy
source-or-plan keys; verify full payload, dependency, plan binding, lifecycle,
and evidence freshness before reusing
them, and report ambiguous or inconsistent records rather than duplicating.
A genuinely changed primary-plan version or verification scope needs explicit
reconciliation and a newly bound verification plan; source drift invalidates
affected evidence, not permission to silently create a duplicate or claim a pass.
Prefer verified atomic idempotency; otherwise
search for the exact key before creating, serialize locally if possible, and
re-read the result. Report non-atomic duplicate risk and surface duplicates
for human reconciliation, not silent deletion. Creating a verifier is not an
Install or Apply event: never recursively create another verifier.

Keep the existing `skill-install-confirmation` companion workflow intact.
When creating a new primary and it requires the installation and file-only confirmation tasks
in the same creation call, do that first; wait for their committed readback
before creating the separate verification task. Confirmation of the skill file
does not replace independent source/runtime or implementation verification.
For an existing primary, reconcile its required confirmation task through the
companion's permitted route; report missing obligations explicitly. Do not
recreate the primary to simulate a same-call history or drop independent
verification because the primary was surfaced instead of newly created.

When installing or changing this handoff, use the
[task-handoff acceptance cases](references/router-task-handoff-acceptance.md).
They are host requirements, not evidence that host task APIs exist here.

Record `created` with the returned verification task ID and real dependency,
`already exists` with its verified ID, or `blocked` with the missing capability,
owner, and next action. A pending follow-up is **not** a passed verification.
If required follow-up creation is blocked, report the routing result as
**Partial** or **Blocked**, not Complete.

## Installation

Install only when explicitly requested or when a supported workflow requires it
and the user approves.

- Write user- or project-authored skills only to
  their canonical `.agents/skills/<skill-id>/` package, with one SKILL.md entry
  point and all authorized required resources/relative references.
- Never write deliverables under `.local/` or edit, promote, or reverse-copy a
  runtime mirror.
- Explain the consequence and obtain consent before overwriting a canonical
  skill.
- After a new installation, verify the installed definition against the
  authorized source or specification. File-only confirmation repairs only
  SKILL.md; independently check required resources, reporting their gaps for
  repair within the authorized package scope, not silently omitting them.

An account-level Settings skill is runtime-available across projects and need
not be installed into each project merely to be invoked.

## Catalog freshness

For the named targets, inspect their canonical `.agents` paths before routing.
The bundled `references/custom-skill-command-manifest.json` is a historical
runtime catalog and does not establish canonical source parity. Do not compare
it to `.local` mirrors to select a skill or infer current contracts.

- A target with no canonical `.agents` source is unavailable for Invoke/Apply/Audit.
  Authorized new definition Install uses the specification/package exception;
  mark its future canonical-source catalog comparison pending/incomplete.
  Verification-only requests may still deliver blocked discovery plans/reports,
  but cannot verify missing-source checks or invent the contract.
- If a catalog entry is absent or conflicts with the canonical contract, use
  the canonical contract and report `Catalog status: incomplete` or `changed`.
- Report `current` only when a verified canonical-source catalog comparison
  supports it; otherwise report `incomplete`, not guessed parity.
- Never silently edit this skill or its catalog. When the user asks to refresh
  the hardcoded list, generate a candidate from canonical `.agents` sources,
  show its diff, and obtain approval.

This is invocation-time checking, not a filesystem event listener or automatic
account Settings update.

## Never

- Treat a routing phrase as permission to bypass approvals or safety.
- Turn a read-only or report-only contract into a mutating workflow.
- Confuse runtime availability, installation, implementation, and validation.
- Claim full application while any applicable requirement is omitted or
  unverified.
- Invent instructions, prerequisites, evidence, or successful checks.
- Edit unrelated files or fix failures outside the target contract.

## Completion report

```text
# Skill Application Result

**Project:** <name or root>
**Requested skills:** <display names and exact IDs>
**Operation:** <Invoke | Install | Apply contract | Audit>
**Stage:** <Task planning | Execution>
**Result:** <Complete | Partial | Blocked | Failed>
**Catalog status:** <current | changed | incomplete | unavailable>

## Applied
- <requirement or project change>

## Validation
- <check and outcome>

## Verification follow-up
- <target skill and planned or completed installation/application scope>
- <created task ID and dependency | already-existing task ID | blocked reason,
  owner and next action | not applicable and reason>
- <primary task ID, committed plan reference, planned report path; no
  verification result claimed until independently run>

## Not applied
- <blocked, failed, unavailable, or not-applicable requirement and reason>

## Pre-existing failures
- <failure or “None observed within the validation scope”>
```

For **Install/Apply task planning**, use **Complete** only when the primary plan
was durably created or verified as an eligible existing record, and all required
follow-ups satisfy the protocol's full-payload, dependency, lifecycle, and
evidence rules with no unresolved required obligations. State actual delivery
status: a planned installation is not installed, but an already delivered
surfaced primary must not be described as undelivered.
For **Install/Apply execution**, use **Complete**
only when all applicable requirements are implemented, all required available
validation passes, and each required follow-up is viable or has a current
accepted verification result. Mere existence of a cancelled, failed, blocked,
or stale verifier is insufficient. A blocked required
check or follow-up yields **Partial** or **Blocked**, never Complete. A created
follow-up never means the implementation has been independently verified.

For **verification-only planning**, Complete means the requested evidence-linked
plan has been durably delivered, not that the skill has passed verification.
Checks may be planned as blocked with owners/next actions; preserve that status.
If the specifically requested deliverable itself needs unavailable source
contents (such as an already extracted full contract matrix), report that
deliverable Partial/Blocked rather than calling a narrower discovery plan Complete.
Do not require an unrelated primary Install/Apply task or recursive follow-up.
If actual host task creation was requested but unavailable, report that part
blocked; a delivered Markdown plan is not a created host task.
For **verification-only execution**, Complete requires evidence that every
applicable required check is verified; failed/blocked checks yield Failed,
Partial, or Blocked as appropriate. Publish the report even when checks fail.
Other Invoke/Audit requests use the target contract's completion criteria.