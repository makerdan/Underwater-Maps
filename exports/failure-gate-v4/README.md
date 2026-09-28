# Failure Gate v4

An operational skill and implementation contract for ID-based validation-tier
enforcement across project types, including Replit projects. It is language-,
framework-, operating-system-, storage-, and provider-neutral.

## Package contents

- `SKILL.md`: core operating instructions; read this first.
- `reference/implementation.md`: registry, approvals, execution, storage, and lifecycle contract.
- `reference/acceptance.md`: host implementation test matrix and paired skill confirmation.

The package contains instructions and specifications, not an executable registry
or runner. No existing project's enforcement has been changed by authoring it.
This tracked editable source bundle and its clean ZIP are for installation by
the workspace source owner; neither is evidence that the live workspace skill,
runtime mirror, or BathyScan's active gate has changed.

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
to verify it before claiming enforced task-ID locks.

Example paths, tier names, task formats, and commands are not prerequisites.
The adapter can use existing local plans or a task service, any appropriate runtime
and transactional storage, and the project's real checks. No backend, package
manager, Git repository, CI provider, or named companion skill is assumed.
Hosts may reserve task IDs before drafting or receive authoritative IDs from
their task service after drafting. The latter must bind a non-authorizing
provisional reference to the actual ID and approved plan/version at activation;
it does not require a second allocator or invented approval.
Dropping in the skill makes its instructions available; it does not automatically
build or activate the project-specific enforcement adapters.

Workflow mode is the default: one task ID, one authorized tier, checked execution,
approved transitions, and a project-local completion checker. Protected mode
requires independently protected authority; it is not implied by repository scripts.

When platform-managed completion handles an active locked task, it must pass the
exact active plan reference to the existing checked project entry point once.
Direct per-tier sweeps are not a valid substitute. If the platform owns dispatch
configuration, diagnose the required platform-side integration rather than
changing protected project workflow settings or adding an unlocked fallback.
Project launcher tests alone do not establish that platform dispatch occurred:
without verified cross-boundary evidence, managed completion is blocked, not
protected. An expired ignore must be rechecked at completion; its expiry does
not cancel an owned repair. Missing dependencies, validation locks, and
concurrent-work conflicts must name affected unexecuted checks, never turn a
partial tier into a pass or an unobserved product regression.

## Authoring verification

The acceptance matrix specifies document-level and host-implementation checks.
Packaging and document inspection are not evidence of runtime enforcement.

No host repository, baseline catalog, validation tiers, or enforcement implementation
was available for runtime verification. Runtime installation and all executable
acceptance tests therefore remain unperformed. The document test matrix is not
a test-results report.