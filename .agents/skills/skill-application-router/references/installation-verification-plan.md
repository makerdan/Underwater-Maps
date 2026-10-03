# Skill Installation Verification Plan

This is the bundled planning module of `skill-application-router`, not a
separate skill or installation prerequisite. Load it during the Router's
normal Install/Apply flow or when explicitly asked to plan or carry out
independent verification of a skill's installation or implementation.

## Purpose

Turn a request to verify another skill's installation or implementation into a
project-specific, evidence-linked task plan. The plan must distinguish what is
available to the agent from what is actually installed in the Project and from
what Replit's platform reports as complete.

This planner is portable across Projects and technology stacks. It has no fixed
repository, framework, task manager, test command, or implementation path.
Discover those anew for each target. It creates a plan; it does not itself prove
implementation. If the user also requests execution and a report, carry out the
approved plan only after the target Project and its files are available. Never
present a proposed check as a completed check.

## Source and scope rules

1. Identify the target Project from the active Project context or project
   resources. Do not assume the most recently opened Project is the intended
   one. If multiple Projects are plausible, inspect available evidence and ask
   one focused question only when the target remains ambiguous. Do not move work
   to an unrelated or newly created Project without authorization.
2. Read the canonical skill definition and its implementation and acceptance
   references from `.agents` in the target Project. Do not treat `.local`
   runtime mirrors, copied skill packages, chat history, or generated summaries
   as canonical skill sources. A runtime-visible definition may be recorded as
   a separate runtime snapshot for parity comparison, never as proof of source
   or Project installation. For a *planned new installation* whose destination
   file is not yet written, use the authorized original specification and
   expected `.agents` destination to plan discovery; leave source-dependent
   checks pending until the installed canonical files can be read.
3. If the canonical source or a referenced contract is unavailable, make that
   a blocked plan item with the exact source and responsible next action. Do not
   fill gaps from a mirror or silently invent acceptance criteria. A pending
   verification task may be proposed for a durably written installation task;
   it may not claim source parity or pass any source-dependent check yet.
4. Discover the target Project's actual repository root, instructions,
   plan/task format, validation commands, record stores, authorization sources,
   approval routes, completion writer, and recovery controls before naming
   commands or interfaces. Reuse verified host capabilities; mark missing or
   unavailable capabilities explicitly. Never carry paths, IDs, commands,
   owners, approvals, or assumptions over from another Project.
5. Keep the verification read-only except for the requested plan/report and
   explicitly authorized, safe validation activity. Do not alter the installed
   skill or enforcement implementation while auditing it.
6. Do not run destructive, production-affecting, hardware, or costly external
   checks without the required authorization and safe environment.

## Separate the claims

Report these as independent evidence tracks:

- **Skill source and runtime parity:** canonical `.agents` source, its
  implementation/acceptance references, and the text actually visible to the
  runtime. Record differences; source availability or parity does not prove
  installation.
- **Project-local installation and implementation:** actual Project files,
  executable host wiring, tests, persisted records, approval evidence, and
  behavior through the installed entry points. Documentation alone is not
  implementation.
- **Replit platform task lifecycle:** platform task status or completion is
  separate evidence. Do not claim that project code controls, blocks, or
  completes a platform task lifecycle unless a verified platform adapter and
  evidence establish that exact behavior.

Never use a skill being loadable, a task being marked complete, a README, a
fixture, or a passing isolated unit test as a substitute for end-to-end host
evidence.

## Build the task plan

### 1. Extract the contract

Read the canonical skill and every linked implementation or acceptance
reference. Convert each applicable invariant, acceptance case, and explicit
limitation into its own checkable plan item. Preserve the source's meaning;
don't make the implementation easier to pass by weakening a requirement.
If a verification-only source/reference is unavailable, record blocked discovery
and later extraction tasks rather than inventing target-specific requirements.
Deliver the requested staged plan/report honestly; an explicitly requested
already extracted matrix remains Partial/Blocked until its source is available.

For each item, define:

- requirement and source location;
- intended verification method and relevant host path;
- expected evidence (code, test, live run, raw record, approval, or other);
- responsible role (verification owner, implementation owner, reviewer, or
  platform owner);
- dependencies, safety/authorization preconditions, and pass/fail rule;
- report status: `verified`, `failed`, `blocked`, or `not applicable`.

Use `not applicable` only with a reason. Use `blocked` when evidence, a
capability, an approval, or safe authorization is missing. Name a concrete
owner and next action for every blocked or failed item.

### 2. Discover before specifying

Plan a discovery task to inventory:

- canonical `.agents` source and linked references for the skill under review;
- runtime-visible skill text and source parity;
- Project-local implementation files and actual wired entry points;
- existing tests, run records, plan/task records, approval decisions, and
  recovery documentation;
- the actual final completion writer and any locks or isolation mechanisms;
- platform-owned task status separately from Project-local state.

Use evidence from the target Project itself. Link each claim to a path and line,
test name, run/record identifier, or approval reference. Never invent a path,
command, record, approval, owner, or test result.

### 3. Make the plan executable

Use the target host's verified task format. Order tasks by dependency and include:
owner, input, action, acceptance criteria, validation, evidence to retain, and
blocked-state handling for every task. If the host has no verified task
planner, provide a durable Markdown plan in the Project's established
documentation location and state that it is a plan, not activated work.

Do not assume a platform task number is a Project-local authorization ID, or
that a plan author's statement is approval. Where the reviewed skill requires
a local ID, authorization, reviewer decision, or exact execution profile, make
the plan verify the actual bound records and approval source.

## Handoff from a skill-application router

Read the complete [binding and recovery protocol](handoff-binding-and-recovery.md)
for every automatic handoff. Preserve all its baseline, payload, lifecycle,
readiness, and recovery checks; verification-only requests use its applicable
evidence rules without requiring an unrelated primary.

The router uses this bundled planner internally during its normal Install or Apply
flow, not through separate user wording. Accept the selected Project, canonical
`.agents` skill path and immutable specification/source/reference manifest
(future installed-source entries may be pending for planned installation), committed primary task
ID and plan digest (or direct-application record), outcome, and requested report
path. Recheck these inputs against the target Project; caller assertions are
not proof of installation. Never read a mirror to fill a missing canonical
source.
The primary may be newly created or an existing task surfaced by Replit Agent
during the Router invocation. Eligibility depends on the verified durable
record and matching Install/Apply scope, not who created it or whether a create
response is available in this invocation. Do not demand a replacement primary.

- `definition-install-planned`: the primary installation task and full plan
  have been durably committed, but installation has not happened. Plan the
  later source/reference/runtime checks. If the destination is not written,
  use the authorized specification only for the *expected* obligations and
  require discovery of the installed canonical source when verification runs.
- `full-application-planned`: the primary implementation task and plan have
  been durably committed, but implementation has not happened. Plan later
  independent source, implementation, acceptance, and host-wiring checks.
- `definition-installed`: plan verification of the canonical skill file,
  referenced files, and runtime visibility/parity. Do not imply the behavior
  described by the skill was implemented.
- `fully-applied`: plan the source checks plus independent Project-local
  implementation, acceptance, host-wiring, approval, and live-behavior checks
  applicable to the target skill.
- A chat proposal, uncommitted draft, definitively failed/cancelled primary
  or uncommitted write, Invoke, or Audit
  is not an eligible installation-verification trigger. If follow-up is needed,
  label it as remediation or blocked work.

Return the plan and a proposed verification-task payload; the planner cannot
claim a task exists. For a newly written primary, the Router checks the
successful write and finalized readback; for an existing/surfaced primary, it
checks authoritative committed/finalized-record evidence and matching identity,
plan/version/digest, scope, and dependencies without a new create response.
Reconcile uncertain write responses before declaring non-delivery; recovered
commits use the existing-record route, not a replacement primary.
An already finalized record does not need an artificial rewrite or wait for
a new writer. If its writer is still active, wait with bounded polling and
verify finalization; a timer, unchanged repeated reads, or platform status alone
does not prove it. Then use the verified Project task-creation
interface, link the new task as dependent on the primary task, and record its
returned ID. Check the primary revision immediately before/after linkage and at
execution; enforce observed mismatches through blocked/reconciliation handling.
Key duplicate detection by stable Project identity, exact target skill ID,
primary namespace/ID, committed primary-plan digest, and canonical scope using
the protocol's versioned unambiguous encoding. Persist the key;
record the source digest as separately checked evidence, not a substitute key
once installation delivers that source. Before creating, reconcile matching
existing verifiers including legacy source-or-plan keys against the primary,
plan, scope, full persisted payload, real dependency, lifecycle, and evidence
freshness. Repeated surfacing before/after installation
must reuse the same verifier. A changed primary-plan version/scope needs a
newly bound verification plan through the permitted route; source drift
invalidates affected evidence and must not silently create another verifier
or inherit a prior pass. A later primary task may require a new verification
even at the same source digest. Report `created`, `already
exists`, or `blocked` with the actual task ID or reason, and state any
non-atomic duplicate risk. Do not mark the task active, approved, passing, or
complete merely because it was created. Verify dependency release semantics
and require the protocol's execution readiness check/resume route when release
does not prove actual delivery. Read back the complete
verifier and validate its executable payload/coverage, report path, dependency,
duplicate key, and lifecycle before reporting
successful creation; mismatch requires an explicit blocked/repair result.
Revalidate the verifier's actual executable revision/full payload immediately
before substantive checks and at report acceptance, not only at linkage.
Changed verifier instructions require blocked/authorized reconciliation and
invalidate affected prior evidence.
Cancelled/failed or blocked required verifiers are not satisfied follow-ups;
completed verification needs current accepted snapshot/manifest-bound evidence.
Do not launch a replacement for a running verifier or silently reopen a
terminal one. Any retry/replan must use an authorized documented route.

Keep the verifier independent of the application task's own success statement.
The verifier must inspect actual host evidence and publish its report in the
selected Project. Creation of the follow-up task is not itself a skill
application event; do not recursively create another verification task.
Use the [task-handoff acceptance cases](router-task-handoff-acceptance.md)
when verifying this Router integration; surfaced-primary support does not
weaken authorization, finalization, dependency, or duplicate protections.

## Failure Gate v4 verification profile

Use this section only when the target skill is Failure Gate v4. For every other
skill, derive the checks from that skill's own canonical definition and linked
implementation/acceptance references; do not impose Failure Gate-specific
controls on unrelated Projects or skills.

When applicable, add discrete checks for every core invariant and required case
in Failure Gate v4's canonical `implementation.md` and `acceptance.md`. At
minimum, explicitly plan evidence for:

- transactional, non-reused Project-local IDs and exact plan/ID namespace
  binding;
- one active authorized tier per local ID, exact tier-definition and plan
  digests, and denial of other tiers;
- a real approved local-ID plan and verifiable approval event/decision or
  previously authorized policy decision under the current canonical contract,
  not an agent-written approval flag; do not add an approver-identity
  requirement when that contract accepts an identity-free Replit approval event;
- checked runner use with that ID and approved plan, followed by a checked run
  after the relevant edits;
- complete raw evidence for every required step, including run identity,
  purpose, arguments, tested snapshot, environment/configuration, results, and
  report references;
- baseline ownership, exact catalog matching/expiry/applicability, diagnostic
  attempt limits, provenance and corroboration, and failure-safe completion;
- authorization changes, cancellation, timeout, still-running process handling,
  and documented recovery, as applicable;
- final input check, evidence assessment, and terminal write coordination
  through the actual host's final writer; and
- a live final-writer race through the installed host path when safe and
  authorized.

Fixture or mocked tests can support the evidence but do not prove live cutover.
If the live race cannot be run safely or authorized, mark that check `blocked`,
name who must authorize or provide the safe environment, and prohibit a
successful protected-enforcement claim. Do not improvise a race against
production or a real user's active work.

For Failure Gate v4, state plainly that Project-local cooperative controls and
Replit platform task completion are distinct. Never claim platform gating,
tamper-proof enforcement, or automatic task lifecycle integration without
directly verified evidence for those capabilities.

## Required plan output

Use the host's format where possible; preserve these fields:

```markdown
# Verification plan: [skill name] in [Project]

## Objective and scope
[What will be independently verified; what is explicitly out of scope.]

## Source and evidence baseline
- Canonical skill/specification baseline: [immutable revisions/digests/snapshots;
  planned future source explicitly pending]
- Implementation/acceptance references: [complete required closure and manifest]
- Runtime-visible text: [source and parity status]
- Project/task identity: [verified Project path and local IDs, if applicable]
- Verifier payload/key: [canonical encoding, exact primary revision and scope,
  complete coverage, safety conditions, report destination]
- Delivery/evidence binding: [readiness/resume strategy, tested snapshot and
  relevant environment inputs; lifecycle and freshness checks]

## Guardrails
[Read-only boundaries, required approvals, safe environment, and unavailable
capabilities.]

## Ordered tasks
| ID | Task and acceptance criteria | Owner | Depends on | Evidence to retain |
|---|---|---|---|---|
| V-01 | Discover source, references, Project format, and actual host wiring | ... | — | ... |
| V-02 | Build clause-by-clause requirement matrix from canonical references | ... | V-01 | ... |
| ... | ... | ... | ... | ... |

## Required report
[Project-relative tracked report path, evidence-link convention, and required
status vocabulary.]

## Blocked conditions and owners
[Concrete next action and responsible role for each missing prerequisite.]

## Planning delivery criteria
[Requested evidence-linked plan is durably delivered; planned blocked checks
retain owners/next actions and do not mean verification passed. If the requested
deliverable itself needs unavailable content, report its delivery Partial/Blocked.]

## Verification execution criteria
[No verification-success claim unless each applicable required check is
evidenced; all other items are failed, blocked, or justified not applicable.]
```

If the user specifies a report path, use that exact path. Otherwise follow the
target Project's established tracked validation-report location; if none exists,
propose a descriptive path and state it in the plan. For a Failure Gate v4
request specifying `docs/validation/failure-gate-v4-verification.md`, use that
exact path. The report must include the applicable clause-by-clause matrix,
evidence links, and ownership; distinguish source parity, Project-local
implementation, and platform completion; and list blocked checks with the next
responsible action. Do not mark a check verified until its evidence exists.

## Completion discipline

- A task plan is not an implementation result, approval, or test run.
- Report planning delivery separately from verification execution: Complete
  plan delivery may contain blocked future checks with owners/next actions;
  it never means those checks passed. Missing content needed for the requested
  plan itself yields Partial/Blocked delivery, not an invented complete matrix.
- If asked to execute, use the Project's verified interfaces and authorization
  routes; preserve the raw evidence and report observed outcomes only.
- Keep all durable deliverables in tracked paths of the selected Project, never
  under `.local/`.
- If an execution prerequisite cannot be established, publish the closest
  honest partial result and label unmet verification blocked, not passed.
  A durably delivered staged discovery plan may still satisfy a planning-only
  request; preserve the narrower scope and source-dependent blocked items.