---
name: Install GitHub Actions
description: >-
  Safely install, migrate, or centralize GitHub Actions as the primary remote
  validation processor for a repository. Use this skill whenever a user asks to
  add GitHub Actions CI, move validation from another provider, make GitHub the
  main PR check system, create merge-blocking workflows, or audit an existing
  GitHub validation setup. Preserve the canonical local validation contract,
  map every portable check to executable remote coverage, and stop rather than
  guessing when security, coverage, activation, or merge-policy evidence is
  missing.
---

# Install GitHub Actions

GitHub Actions is the primary **remote** validation processor after setup, not
the only authority. Keep local and task validation reproducible, and never
claim that a workflow is active, passing, or required merely because its YAML
exists.

## 0. Inventory before proposing edits

Do this read-only inventory first. Do not create credentials, change GitHub
settings, trigger runs, or edit files until the user explicitly authorizes the
relevant mutation.

Record evidence for:

1. Package manager and lockfile(s), runtime versions, workspace/monorepo
   boundaries, and install flags.
2. Canonical local validation commands, tier ceilings, suite manifests, shards,
   generated-file/codegen steps, and the command that CI is expected to mirror.
3. Every existing CI provider and `.github/workflows/*.{yml,yaml}`, including
   reusable workflows, composite actions, matrix jobs, event filters, and
   required-looking check names.
4. Unit, integration, browser/E2E, static, build, security, and drift suites;
   services, databases, browsers, language runtimes, fixtures, and other
   prerequisites.
5. Environment variables and credentials each command reads. Separate dummy
   test values from secrets and production credentials. Identify local-only
   state such as task plans, shared locks, object-storage sidecars, or live
   development data.
6. Repository scripts that install, generate, build, test, upload artifacts, or
   silently skip work. Follow referenced scripts far enough to find the actual
   executable command.

Use read-only patterns such as these, adapting paths to the repository:

```sh
find . -maxdepth 3 -type f \( -name 'package.json' -o -name '*lock*' \
  -o -path './.github/workflows/*' \) -print
git grep -nE '^( *"?(test|lint|typecheck|build|check)[^"]*"? *:|name:|on:|uses:|run:)' \
  -- '*package*.json' '.github/workflows' 'Makefile' 'Taskfile*' 2>/dev/null
```

If a command, referenced action, remote run, or branch policy cannot be
inspected, mark it **unknown**. Unknown is not absent, passing, active, or
required.

## 1. Establish the portable workflow contract

Build a local-to-remote table before changing CI:

| Canonical local check | Exact remote command/job | Coverage | Event scope | Evidence |
|---|---|---|---|---|
| command, suite, shard | executable `run:` or verified composite | direct, indirect, sharded, package-specific, local-only, or intentional gap | PR, push, schedule, manual, queue, conditional | observed, inferred, or unknown |

Enumerate every portable static check, unit suite, shard, integration check,
browser suite, package-specific check, build, and generated-output check. For
each, choose exactly one decision:

| Decision | Use when | Required record |
|---|---|---|
| Add PR/pre-merge coverage | A normal runner can execute it safely | Workflow job and exact command |
| Intentionally local-only | CI genuinely lacks a dependency or shared local state | Dependency, reason, and local command |
| Intentional gap | Coverage is portable but deferred | Missing command, owner, and follow-up |

Do not call package-specific or partial coverage full parity. For a sharded
suite, list every selector and require a failing aggregate if any leg is
missing or fails. Prefer extending the owning suite over a one-test workflow.
Record any deliberate overlap with its exact command and why isolation is
necessary.

Hand off responsibilities rather than replacing adjacent guidance:

- **CI Validation Parity** owns read-only mapping of local checks to actual
  remote commands and event scopes.
- **Failure Gate** owns local baselines, provenance, task-plan tier ceilings,
  and failure ownership. Do not weaken it to fit CI.
- **Port Authority** owns process, port, service, and generated-file concurrency
  hygiene. Use it when a runner or test service is unreliable.
- Provider-specific security, deployment, and secret guidance remains separate.

## 2. Choose the setup path

### Greenfield

Create the smallest set of workflows that gives complete, visible coverage:

1. A PR/pre-merge workflow for portable static checks and the canonical unit or
   integration suites.
2. A PR browser smoke workflow only when its runtime and dependencies justify
   isolation; otherwise extend the first workflow.
3. A default-branch workflow for slower/full discovery suites and monitoring.
4. Optional scheduled or manual workflows for drift, refresh, or expensive
   maintenance that is not merge protection.

### Existing CI

First classify every current workflow as PR/pre-merge, default-branch push,
scheduled, manual, merge-queue, conditional, informational, skipped, or
unknown. Preserve one owner per check. Migrate commands by evidence, retire
duplicates only when their replacement is active and policy-approved, and
keep the old processor until an authorized cutover is verified. Do not infer
that a workflow is required from its name, badge, or job name.

### Event and job routing

Use a stable PR event for untrusted proposed changes, default-branch push for
post-merge monitoring, `schedule` for recurring maintenance, `workflow_dispatch`
for explicit manual work, and `merge_group` when merge queue is enabled.
Reusable workflows and composite actions must expose their effective event
scope, permissions, commands, and failure result to the inventory.

Avoid path filters on required checks unless every affected path has a
documented, safe result. A skipped required job must not become an accidental
pass; use an explicit changed-path policy and a required aggregator when
different paths legitimately need different suites.

## 3. Security contract for pull requests

Default to `pull_request` for jobs that execute PR code. Give the workflow and
jobs the least privilege needed, normally:

```yaml
permissions:
  contents: read
```

Use no secrets, production credentials, write tokens, deployment environments,
or privileged service accounts in PR validation. Test values must be clearly
non-sensitive and limited to the test job. Treat every checkout, install hook,
test, generated script, Docker build, and third-party action as untrusted code
when it comes from a pull request.

`pull_request_target` runs in the base repository context and is hazardous when
it checks out or executes PR-head code. Do not use it as a shortcut. Use it only
when an approval-gated design is demonstrated to be safe: the approval job
executes no repository code, the PR-head job has read-only permissions, no
secrets or write-capable credentials are reachable, checkout is explicit, and
the user has approved the risk and GitHub environment configuration. Otherwise
stop and use `pull_request`.

Pin every third-party action to an approved immutable commit. If an
organization-approved immutable pinning policy provides an equivalent
mechanism, record that policy and the reviewed trust decision. Do not treat a
mutable tag or branch as an immutable pin. Do not run arbitrary fork code with
a maintainer token. Do not allow a validation job to push, open pull
requests, modify settings, deploy, or recurse by writing workflow files.

## 4. Make jobs fail closed

Every required job must fail when its command fails. In particular:

- Do not use unjustified `continue-on-error`, report-only jobs, `|| true`, or
  error-swallowing wrappers.
- Treat `if: always()` as a reporting mechanism only; a final required
  aggregator must inspect all needed job results and fail on failure,
  cancellation, or an unexpected skip.
- Set a finite job timeout appropriate to measured setup and test duration.
  Do not inflate it to hide hangs; diagnose services and use Port Authority
  guidance for runtime cleanup.
- Use concurrency cancellation only when it cannot cancel the required result
  for a merge-group or protected revision. Ensure a cancelled run cannot leave
  a stale required check name blocking or falsely permitting a merge.
- For matrices, make all intended legs explicit, fail the matrix on any leg,
  and aggregate the full set. Verify that `include`, `exclude`, `if`, and
  `fail-fast` do not erase a required platform, runtime, or package.
- For retries, distinguish infrastructure retry from a passing test. Preserve
  the final failure and report flakiness; retries are not permission to mask
  failures.

Branch protection or repository rulesets must require the stable aggregator
check(s), not ephemeral matrix leg names that can change. Verify separately:

1. the workflow ran for the current revision and event;
2. each intended job/leg was active and passed; and
3. GitHub branch policy actually requires the stable check.

Workflow-file presence proves none of these.

## 5. Runner reproducibility

Use the repository's lockfile with its frozen/immutable install mode and set
the declared runtime versions explicitly. Cache only dependency data keyed by
the lockfile, operating system, architecture, and relevant runtime/tool
versions. Never cache secrets, build outputs that can affect trust, or mutable
workspace state across unrelated revisions.

Install every required runtime and tool explicitly. For databases and service
containers, pin a compatible image, expose only needed ports, configure
health checks, and add an explicit readiness check before migrations or tests.
Do not confuse a container being started with its service being ready.

For generated files:

1. Identify the source-of-truth inputs and generation command.
2. Generate in a serialized step before consumers compile or test.
3. Run a freshness or diff check so uncommitted generated changes fail.
4. Do not upload generated changes, rewrite the branch, or hide a diff in CI.

Upload logs, test reports, screenshots, traces, and coverage as artifacts when
they help diagnose a failed run. Use `if: always()` on artifact upload, but do
not let the upload step determine the required validation result. Set retention
and avoid including credentials or sensitive data in artifacts.

## 6. Human-facing setup and approval boundary

Before proposing workflow edits, ask or establish:

- What is the default branch and which events should block merges?
- Which local command is canonical, and which checks are intentionally local?
- Are forks, first-time contributors, merge queues, private dependencies, or
  self-hosted runners in scope?
- Which services, runtimes, generated files, fixtures, and test credentials are
  required?
- Is the user authorizing only repository-file changes, or also GitHub settings,
  rulesets, environments, secrets, branch protection, or remote runs?

Repository workflow edits are not remote settings changes. Require explicit
user authorization before any remote mutation, including creating or changing
secrets, environments, rulesets, branch protection, required checks, runner
labels, repository variables, or dispatching/rerunning workflows. Never ask the
user to paste a credential into chat.

Give the user this non-destructive checklist:

- [ ] Inventory and local-to-remote table reviewed.
- [ ] One owner exists for every check; duplicates and intentional gaps are
      recorded.
- [ ] PR jobs use least privilege and no production secrets.
- [ ] Fork and first-time contributor behavior is safe and understood.
- [ ] All matrix legs, generated-file steps, services, and readiness checks are
      visible and covered.
- [ ] Timeouts, concurrency, caching, artifacts, and retries have reasons.
- [ ] Stable required aggregator names are chosen.
- [ ] Workflow syntax and local commands have been validated locally.
- [ ] PR evidence names the exact revision and event, shows every intended job
      and matrix leg ran and passed, and separately verifies policy status (or
      marks unavailable evidence as unknown).
- [ ] User has separately approved any GitHub settings or remote run changes.

## 7. Troubleshoot without weakening the contract

When validation fails, capture the revision, event, workflow/job/attempt,
matrix leg, exact command, condition, logs, and local counterpart. Then check,
in order:

1. Was the intended workflow active for this event and revision?
2. Did a filter, permission, skipped dependency, matrix expression, or reusable
   workflow omit the check?
3. Were lockfile, runtime, generated files, service readiness, or fixtures
   different from local execution?
4. Is the failure a real command failure, infrastructure failure, cancellation,
   or an intermittent retry?

Do not solve a red check with `continue-on-error`, a wider timeout, a silent
skip, a secret, a privileged event, or a duplicate discovery run. Mark remote
status unknown when evidence is unavailable, and preserve the local failure
classification rules.

## Three-pass quality gate

Before presenting the result, review the proposed setup in three passes:

1. **Portable contract:** confirm the package manager, lockfile, canonical
   commands, event scopes, and local-to-remote row for every portable check.
2. **Adversarial safety:** test the design mentally against forks, first-time
   contributors, target events, secrets, filters, skipped jobs, matrix loss,
   generated files, service readiness, retries, cancellation, and stale
   required names. Close each false-green or privilege path.
3. **Human usability:** walk through a novice greenfield setup and an existing
   complex repository. Remove ambiguous instructions, state unavailable
   evidence, keep commands non-destructive, and preserve app-agnostic choices.

Keep any evaluation prompts, scratch reports, and generated comparisons
outside tracked deliverables. Commit only the canonical skill and explicitly
authorized workflow files.

## Completion report

Return an evidence-based report with exactly these headings:

```markdown
# GitHub Actions installation
## Scope and evidence
## Changed files
## Local-to-remote coverage
## Event scopes and security
## Exclusions, gaps, and duplicate decisions
## Validation results
## Remaining manual GitHub settings
## Rollback and follow-up actions
```

Name each changed file and exact command. State PR, push, schedule, manual, and
merge-queue scopes; permissions; secrets excluded; service/runtime setup;
matrix and generated-file handling; local-only dependencies; intentional gaps;
and any unavailable evidence. For each claimed PR result, name the exact
revision, event, workflow/job or matrix leg, command, and result; include
skipped, cancelled, retried, or allowed-to-fail cases. Report validation by
revision and command, not by workflow-file presence. State which
branch-protection or ruleset settings still require user action. Include a
rollback path that removes or disables the new workflow only after confirming
which stable checks and policy entries reference it. Never claim merge
protection until active/pass status and remote policy are verified
independently.