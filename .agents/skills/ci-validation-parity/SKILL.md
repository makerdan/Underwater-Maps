---
name: CI Validation Parity
description: >-
  Determine whether remote CI actually participates in validation and compare
  canonical local checks with the commands remote CI executes. Use whenever a
  user asks about CI-validation, GitHub Actions coverage, workflow-parity,
  local-versus-remote validation, merge-blocking checks, or whether a check is
  active, passing, required, duplicated, or missing in CI. Inspect read-only
  evidence before making claims; do not trigger or modify remote workflows
  unless the user explicitly authorizes that operation.
---

# CI Validation Parity

## Purpose and scope

Use this skill to answer a narrow question: **what validation is canonical
locally, what validation is actually executed remotely, and what conclusions
the available evidence supports?**

This skill is app-agnostic. Use the project's own terminology for its package
manager, test runner, validation commands, CI configuration, packages, and
default branch. It covers:

- discovering and classifying remote CI configuration;
- mapping local validation commands to remote commands and coverage;
- separating merge-blocking checks from monitoring, maintenance, and local-only
  checks;
- investigating remote failures without overstating their provenance; and
- deciding where a new portable check belongs without creating duplicate
  suites or workflows.

Do not modify application code, tests, validation commands, CI configuration,
branch protection, credentials, or remote workflow state as part of a parity
analysis. Remote inspection is read-only by default. Triggering, rerunning,
dispatching, cancelling, approving, editing, or otherwise modifying a remote
workflow requires an explicit user request and is outside the default
workflow.

## Required output

Report findings with evidence, not assumptions. Use this structure:

```markdown
# CI validation parity
## Scope and evidence
## Workflow classification
## Local-to-remote coverage map
## Failures and confidence
## Coverage decisions
## Gaps, risks, and next actions
```

For each important claim, identify the inspected file, command, run, revision,
or policy evidence. Mark a conclusion **unknown** when the relevant evidence
is unavailable. Distinguish:

- **observed** — directly supported by inspected configuration or run data;
- **inferred** — a reasonable interpretation with its supporting evidence;
- **unknown** — not verifiable from the available read-only evidence.

Do not silently convert unknown into absent, passing, active, or required.

## 1. Discover CI before making claims

Start by finding the project's CI configuration and canonical local
validation definitions. Do not assume GitHub Actions, a particular provider,
or that a visible workflow is used by the project.

Inspect, as applicable:

1. CI configuration files and provider metadata in the repository.
2. Referenced reusable workflows, composite actions, scripts, containers, or
   task definitions when practical.
3. Canonical local validation commands, tier definitions, suite manifests, and
   package-specific scripts.
4. Read-only remote run/status data if it is already available through the
   authorized environment.
5. Branch or merge policy evidence only when the user asks whether a check is
   required.

Follow references far enough to identify the executable commands and relevant
conditions. If a referenced action, script, or remote run cannot be inspected,
record that limitation and lower confidence. Do not add API access, credentials,
live polling, or provider-specific tooling just to complete this analysis.

### Presence is not proof

Workflow-file existence, workflow names, comments, badges, README
documentation, job names, or configuration intent do **not** prove that a
workflow is:

- enabled or active;
- currently passing;
- executing the command a name suggests; or
- required for merging.

Establish active or passing status from revision-aware run evidence when
available. Establish required merge status from branch-protection or an
equivalent merge-policy source. Never infer required status from a check name,
a green badge, or a workflow file alone.

## 2. Classify when remote validation runs

Classify each relevant workflow, job, or command by its event scope. A single
workflow may have multiple classifications; classify the executable job
rather than only its display name.

| Classification | Meaning | Typical conclusion |
| --- | --- | --- |
| Pull request / pre-merge | Runs for proposed changes before merge, including equivalent review gates. | Candidate PR-blocking coverage; required status still needs policy evidence. |
| Default-branch push | Runs after changes land on the default branch. | Post-merge monitoring unless policy evidence says otherwise. |
| Scheduled | Runs on a timer or recurring maintenance event. | Scheduled maintenance or drift detection, not PR coverage by itself. |
| Manual | Runs only after an explicit human or system dispatch. | Manual/on-demand coverage, not active PR coverage by itself. |
| Conditional | Runs only for paths, actors, branches, labels, permissions, or other predicates. | Report the predicate and the affected cases; do not generalize to all changes. |
| Ambiguous / unknown | Trigger, condition, reusable-workflow behavior, or run evidence cannot be established. | Report unknown and state what evidence is missing. |

Also record whether a job is disabled, skipped, allowed to fail, informational,
or gated by another job. A workflow can be present while its relevant job is
inapplicable to the current revision.

## 3. Build a local-to-remote coverage map

First enumerate the canonical local validation flow: every portable static
check, unit suite, browser/E2E suite, integration check, package-specific
check, shard, and explicitly local-only check. Then map each item to the
closest remote executable command.

Use one row per canonical check:

| Local canonical check | Remote command/job and evidence | Coverage kind | Event scope | Confidence |
| --- | --- | --- | --- | --- |
| `<local command or suite>` | `<exact remote command/job, or unknown>` | `<kind>` | `<classification>` | `<observed/inferred/unknown>` |

Use these coverage kinds precisely:

- **Direct** — the same check or equivalent command runs remotely.
- **Indirect** — a build, aggregate script, package script, or parent suite
  invokes the check without naming it at the workflow step.
- **Sharded** — remote jobs divide the same suite; list shard selectors and
  whether all shards are represented.
- **Package-specific** — only one package or subset of the canonical scope
  runs remotely; state what is omitted.
- **Duplicate** — a separate remote command repeats coverage already supplied
  by an existing suite; recommend consolidation rather than adding another
  copy.
- **Absent** — evidence shows no remote equivalent for a portable check.
- **Local-only** — intentionally restricted to local/agent validation because
  it depends on unavailable Replit or Agent state, task-plan context,
  gitignored local data, a live development service/database, or an
  object-storage sidecar. Record the concrete dependency.
- **Unknown** — the available evidence cannot distinguish among the above.

Do not call package-specific or partial coverage full parity. For shards,
compare selectors, setup, environment, retries, and required aggregation; one
green shard does not establish suite-wide coverage.

### Keep validation ownership separate

Remote status must not redefine the local validation contract. Preserve the
canonical local command, its documented tier or ceiling, and local failure
ownership even when remote CI runs a different subset. Remote coverage is an
additional execution context, not permission to skip, weaken, or silently
replace local validation.

When a portable check is added to a canonical validation flow, make an
explicit CI coverage decision for it:

1. **Add remote coverage** to an existing appropriate PR/pre-merge suite;
2. **Document a justified local-only exclusion** with its concrete unavailable
   dependency; or
3. **Record an intentional gap** with an owner or follow-up decision.

Do not leave the decision implicit. A local-only label is not a convenience
for avoiding CI; it is justified only by a dependency CI genuinely cannot
provide.

## 4. Route new checks without duplicating coverage

Choose the check's home before changing CI:

1. Extend the existing unit or integration suite that owns the behavior.
2. Extend the existing browser/E2E suite and its discovery or smoke manifest
   when the check is user-journey coverage.
3. Add a portable static check to the canonical validation flow and route it
   to an existing suitable PR/pre-merge job.
4. Keep a check local-only only with a documented concrete dependency and an
   explicit exclusion decision.

Prefer extending an existing suite over creating a one-test workflow, a
second discovery run, or a duplicate package command. Do not create a new
workflow merely to run one additional test when an existing suite can own it.
If a necessary isolated overlap remains, document the exact command and why
the isolation is required.

## 5. Investigate failures with revision-aware evidence

Treat every remote failure as evidence to investigate, not as noise to ignore.
For each failure, capture when available:

- exact commit, revision, or merge reference;
- provider, workflow, job, and attempt identifiers;
- the executed command, matrix/shard, and relevant condition;
- failure output and whether the job was cancelled, skipped, allowed to fail,
  or retried; and
- the corresponding local command and result.

Compare remote evidence with the local baseline and the changed files. A
remote failure on another revision does not prove the current change broke
anything; a remote pass on an older revision does not prove the current
revision passes. If revision, command, or result evidence is unavailable,
report the remote state as unknown and say exactly what could not be verified.

Do not silently ignore remote-only failures, inaccessible runs, or conditional
coverage. Report them as gaps or investigation items. Do not let a remote
failure override the project's local failure classification rules, validation
ceiling, or ownership process.

## 6. Boundaries with other skills

- **Failure Gate** owns local test baselines, pre-existing-versus-regression
  classification, validation ceilings, and task validation execution. Use this
  skill to describe remote evidence and parity; do not duplicate Failure Gate
  or weaken its rules.
- **Port Authority** owns process, port, service, generated-file concurrency,
  and test-runtime hygiene. Use it for runtime failures or cleanup; do not
  turn CI parity analysis into a second process-management playbook.
- Provider-specific tools, deployment tooling, and credential management are
  separate concerns. Do not introduce them solely to inspect CI.

## Completion checklist

Before concluding, verify that the report:

- identifies the CI configuration inspected, or says why it was unavailable;
- classifies each relevant event and conditional path;
- maps every canonical local check, including shards and package-specific
  subsets, to direct, indirect, sharded, package-specific, duplicate, absent,
  local-only, or unknown coverage;
- separates PR/pre-merge blocking candidates, post-merge monitoring, scheduled
  maintenance, manual runs, and Replit/Agent-local checks;
- uses revision-aware evidence for remote results and labels unavailable
  evidence unknown;
- makes an explicit CI coverage decision for every portable canonical check;
- does not infer active, passing, or required status from names, files,
  comments, badges, or documentation; and
- recommends extending existing suites rather than adding duplicate workflows
  or duplicate discovery-based runs.

Do not trigger or modify remote workflows unless the user explicitly asked for
that operation and the task has been re-scoped accordingly.