# Failure Gate v4

An operational skill and implementation contract for project-local, ID-based
validation-tier workflows across project types, including Replit projects. It is language-,
framework-, operating-system-, storage-, and provider-neutral.

## Package contents

- `SKILL.md`: core operating instructions; read this first.
- `reference/implementation.md`: registry, approvals, execution, storage, and lifecycle contract.
- `reference/acceptance.md`: host implementation test matrix and paired skill confirmation.
- `reference/owner-directed-closure.md`: explicit owner closure without
  claiming unresolved validation passed.
- `reference/evidence-and-recovery.md`: evidence index, tested restore,
  lineage, availability, read-only health, retention, export, and closure reporting.
- `reference/adapters/posix-writer-lock/`: optional tested Python/POSIX
  cooperative writer-lock reference and [host integration checklist](reference/adapters/posix-writer-lock/README.md).

The package contains instructions, specifications, and one optional executable
writer-lock adapter—not an installed gate registry, checked runner, approval-event
source, or completion checker. No existing project's enforcement has been
changed by authoring it.

## Adopt safely

For Replit and other `.agents`-compatible hosts, place this directory at
`.agents/skills/failure-gate-v4/`. On other hosts use the supported canonical skill
location and map its interfaces explicitly. Do not edit disposable mirrors or save
deliverables beneath `.local/`.

When adopting v4 in an existing project, explicitly migrate the old Failure Gate
contract and its invocation/session guidance. Do not leave old and new versions
simultaneously governing the same task. Merely adding this directory does not
disable an existing workspace skill or implement the host controls.

Begin with the core skill's capability discovery. Implement missing host tooling
only under a separately authorized installation task. Use the acceptance matrix
to verify it before claiming checked project-local task-ID locks.

Example paths, tier names, task formats, and commands are not prerequisites.
The adapter can use existing local plans and task records, any appropriate runtime
and transactional storage, and the project's real checks. No backend, package
manager, Git repository, CI provider, or named companion skill is assumed.
Dropping in the skill makes its instructions available; it does not automatically
build or activate the project-specific enforcement adapters. The bundled
POSIX example is opt-in and requires the host-integration checklist and
project-specific acceptance tests before any cutover.

The scope is a cooperative project-local workflow: one local task ID, one
authorized tier, checked execution, recorded approval events/decisions
(or a separately preapproved deterministic activation policy),
and a local completion checker. Per-tier status/audit is derived from the one
task assignment, not maintained in editable per-tier allow/deny lists.
An owner may approve a fixed deterministic policy once so matching approved
plans receive per-task bound decisions without separate human review each time.
An approved Replit task plan is only an input when its exact contents and
project-local task mapping can be verified. The Replit route trusts an explicit
plan-approval action from a verified platform source without requiring the
approver's identity or a reviewer roster. It still verifies one declared tier,
exact bindings, and policy/version drift before local activation; platform
status, command approval, and later merge/apply actions are not substitutes.
Changes to plans or tiers require a fresh decision. Hosts must
implement ordinary checked activation and execution; a draft/review-only CLI
or a Workflow command run does not supply those records or local completion.
When a task moves from Draft/Plan to Active, its agent must invoke local
activation, do the work, and validate the changed inputs through that route;
later relevant edits require another checked run. Report the local result for
the user's normal merge-or-dismiss choice, never auto-merge. No automatic
platform Active-state hook or platform merge gate is supplied by this package.
An agent with write/shell access can bypass or alter local tooling.
This package does not restrict arbitrary commands, authenticate local records
against deliberate tampering, or control Replit Agent's Task Board transitions.
It does not supply human review or baseline catalog-governance services. Missing
required local approval blocks the affected change, not ordinary unrelated work.
An installation must verify a source for real approval events/decisions (or an
applicable previously approved policy) and effective final-write coordination
before activating ordinary tasks. Missing either leaves the new route blocked;
these instructions do not configure those host capabilities. Approval contents
and governing policy need pinned versioned evidence; a staged file is not stable
approval evidence. A Git commit can preserve verified captured event contents,
but cannot establish that a Replit approval occurred. An identity-based human
route may separately require a pinned reviewer roster; the Replit route does not.
Project code and CLI must not invoke, request, depend on, or present a result
from platform-managed completion. Retire any old managed-completion operation
during an approved migration. Do not modify
platform-owned dispatch or introduce an unlocked fallback in an attempt to
claim otherwise.

## Owner-directed completion

An explicit task-scoped owner instruction may administratively close the task
without passing checks or a second approval. The Agent must retain failures,
blocked/not-run checks, and unresolved repairs, recording a distinct completion
mode and reporting **“Closed by owner direction—not validation passed.”**
This is not Agent self-approval, baseline widening, tier authorization, or a
successful validation result.

The local route requires a verified audited transition and safe run handling.
The Agent may separately use an actually available authorized native platform
task interface; project code/CLI must not call or proxy platform completion.
Missing local tooling does not veto an owner-authorized native platform closure.
Report each system's real outcome; no interface or scheduler hook is supplied
by these instructions, and closure never authorizes auto-merge or deployment.

## Independent validation compatibility

The contract requires existing independent validation callers to keep working
without new task/plan metadata or caller changes. Platform final checks, CI,
local tooling, and other integrations are discovered, not presumed. TASK_PLAN_FILE
is one optional adapter, not a universal dependency or authorization signal.

Task binding and fail-closed authorization belong at the explicit checked
entry point. Invalid checked requests cannot fall back to independent execution;
independent results cannot replace required-tier evidence. Preserve original
commands, checks, timeouts, locks, reports, heavy-suite serialization, workflows,
and Run-button definitions unless separately authorized to change them.
An existing plan-file-only ordinary-task route may remain unchanged until its
approved cutover. Keeping independent checks working does not replace that route,
authorize other tiers, or let independent results close a task.
The implementation reference and added acceptance cases cover this
project-neutral compatibility amendment; actual host execution remains unverified
here. A host's separately planned original installation/confirmation must retain
its pinned source and record this amendment as a later distinct change.

## Evidence discovery and recovery

A full host implementation must publish a tracked evidence index linked from
its capability manifest, documenting actual locations and safe access to
allocator/namespace records, backups, catalogs, runs, corroboration, and
closure decisions. No hardcoded store, filename, runtime, or cloud is required.

The bundled evidence/recovery contract requires an isolated authorized
allocator restore exercise, original-source classification lineage, explicit
absence states, read-only health inspection, dependency-aware retention,
sanitized non-authorizing exports, and visible unresolved work after owner
closure. Missing optional history remains optional; no historical reports
are fabricated. These capabilities are implementation requirements, not
artifacts or services created by installing the definition.

## Authoring verification

This package received a document-level review for the project-local scope,
frontmatter structure, version consistency, Markdown fences, reference links,
example JSON, and core length. Failed runs do not automatically terminate tasks,
expired ignores cannot erase owned repairs, and local acceptance coordinates
with edits.

No host repository, baseline catalog, validation tiers, or enforcement implementation
was available for runtime verification. Runtime installation and all executable
host acceptance tests therefore remain unperformed. The document test matrix
is not a test-results report. The optional lock adapter's six primitive tests
passed here; they are not host coordination or task-completion verification.