# Support response: Replit validation-command TOML editor

**Subject:** Validation-command TOML editor rejects canonical registrations; managed runner cannot find `test-fast`

Hello Replit Support,

I am reporting a platform-side failure affecting the managed validation-command
editor and runner for the BathyScan workspace. The repository-side validation
manifest is stable and internally consistent; the failure is in the
Replit-managed registration/lookup path.

## Environment and context

- **Project:** BathyScan, a pnpm workspace using Node.js 24.
- **Observed date:** August 30, 2026 (UTC).
- **Repository state:** clean at the time of the fresh read-only probes.
- **Canonical manifest:** `scripts/register-validation-commands.mjs`.
- **Platform surfaces involved:** the managed validation-command editor,
  managed validation-command list, and managed validation runner.
- **Safety:** no credentials, tokens, or secret values were included in the
  probes or this report.

The repository also deliberately keeps the scheduled database-backed
`audit-marker-bbox` check separate from the four task validation tiers. It is
not one of the commands that should be registered as a tier.

## What is verified

### Repository-side facts

The current manifest contains exactly these four tier commands:

| Name | Exact command |
|---|---|
| `test-fast` | `node scripts/run-with-timeout.mjs tierFast -- node scripts/run-tier.mjs fast` |
| `test-standard` | `node scripts/run-with-timeout.mjs tierStandard -- node scripts/run-tier.mjs standard` |
| `test-standard-plus` | `node scripts/run-with-timeout.mjs tierStandardPlus -- node scripts/run-tier.mjs full` |
| `test-heavy` | `node scripts/run-with-timeout.mjs aggregate -- node scripts/test-heavy-serial.mjs` |

The manifest also contains this intentionally separate scheduled command:

| Name | Exact command | Why it is separate |
|---|---|---|
| `audit-marker-bbox` | `pnpm --filter @workspace/db audit:marker-bbox -- --ci` | DB-backed scheduled audit; it has no tier budget and is not part of the four-tier task validation set. |

This distinction is enforced in the repository: `scripts/run-locked-tier.mjs`
resolves only manifest entries with a non-null budget key, so
`audit-marker-bbox` is intentionally excluded from task-tier lookup.

The current `.replit` file contains only the simple `Project` run-button
workflow. It does not contain a replacement set of local validation workflows.
That is intentional: the repository uses the managed validation registry for
named validation commands and does not substitute `.replit` workflows or
background processes for it.

### Platform-side observations

The following are fresh, read-only observations from the managed validation
API in this session:

1. **Managed command list — August 30, 2026 02:35:57.281 UTC:** the response
   contained an empty command list (`commands: []`).
   Evidence: [`managed-validation-list-2026-08-30T023557Z.md`](replit-toml-editor-evidence/managed-validation-list-2026-08-30T023557Z.md).
2. **Managed runner lookup — August 30, 2026 02:36:04.033 UTC:** attempting to
   start the registered command ID `test-fast` returned:

   ```text
   Failed to start validation run: [NO_MATCHING_WORKFLOW] unknown validation command(s): test-fast
   ```

   The returned run status was `ERROR`, with no execution started.
   Evidence: [`managed-validation-run-2026-08-30T023604Z.md`](replit-toml-editor-evidence/managed-validation-run-2026-08-30T023604Z.md).

The platform editor error below is preserved from the merged validation
recovery evidence, not claimed as a fresh capture in this session:

```text
toml-editor error: parsing value field in add request
```

The merged recovery record states that this editor error occurred while
attempting the canonical registration/upsert flow, including the retry
behavior used to determine that the problem was not specific to one command
string. The fresh list and runner observations above independently show that
the managed registry is still empty/unavailable in this session.

## Chronology

1. The repository's validation recovery work established the canonical tier
   contract and runtime protections. The manifest now resolves the four tiers
   above, with `test-standard-plus` as the static-plus-unit intermediate tier.
2. A managed registration attempt was made from the canonical manifest. The
   merged incident evidence recorded the exact TOML editor response
   `toml-editor error: parsing value field in add request`.
3. A runtime reset/retry was completed. The artifact workflows and stale
   runtime cleanup were handled without changing application behavior.
4. A temporary `.replit` validation-workflow configuration was removed in the
   subsequent restoration commit. This restored the intended managed-validation
   architecture rather than replacing the platform registry with local
   workflows.
5. The current read-only probes found no managed commands and reproduced the
   managed-runner lookup failure for `test-fast` shown above.

Relevant repository history includes the runtime/validation setup merge, the
registration attempt whose outcome was platform-editor unavailability, and the
follow-up restoration that removed the temporary local validation workflow
definitions. Those commits changed no application code for this incident.

## Deterministic reproduction

The following steps reproduce the repository-side request context without
changing command strings:

1. Open the BathyScan repository at the commit containing
   `scripts/register-validation-commands.mjs`.
2. Run:

   ```sh
   node scripts/register-validation-commands.mjs
   ```

   Confirm that the output lists the four tier names and exact commands in
   the table above, followed by the separate `audit-marker-bbox` entry.
3. In the Replit-managed validation-command editor, submit/upsert each of the
   following four pairs exactly as shown. Do not include `audit-marker-bbox` in
   this four-tier registration attempt:

   ```text
   name: test-fast
   command: node scripts/run-with-timeout.mjs tierFast -- node scripts/run-tier.mjs fast

   name: test-standard
   command: node scripts/run-with-timeout.mjs tierStandard -- node scripts/run-tier.mjs standard

   name: test-standard-plus
   command: node scripts/run-with-timeout.mjs tierStandardPlus -- node scripts/run-tier.mjs full

   name: test-heavy
   command: node scripts/run-with-timeout.mjs aggregate -- node scripts/test-heavy-serial.mjs
   ```
4. **Expected editor behavior:** each exact name/command pair is accepted or
   idempotently updated, and the four commands become visible in the managed
   registry without duplicates.
5. **Observed editor behavior from the merged incident record:** the
   registration attempt returned the exact error
   `toml-editor error: parsing value field in add request`. This report does
   not claim that a new editor submission was made during the fresh read-only
   probe.
6. List the managed validation commands.
7. **Expected list behavior:** the four canonical tier entries are present with
   exact names and command strings.
8. **Fresh observed list behavior:** the list was empty at
   `2026-08-30T02:35:57.281Z`; see the linked evidence file.
9. Start one managed validation run with command ID `test-fast`.
10. **Expected runner behavior:** the managed runner starts the exact
    `test-fast` shell command and returns a run ID and execution result.
11. **Fresh observed runner behavior:** no execution started; the runner
    returned `NO_MATCHING_WORKFLOW` and `unknown validation command(s): test-fast`
    at `2026-08-30T02:36:04.033Z`; see the linked evidence file.

## Expected versus actual

| Surface | Expected | Actual evidence |
|---|---|---|
| TOML editor | Accept or idempotently update each canonical name/command pair. | Merged evidence records `toml-editor error: parsing value field in add request`. |
| Managed command list | Four tier commands are listed with exact manifest values. | Fresh list response was empty at 2026-08-30T02:35:57.281Z. |
| Managed runner | `test-fast` resolves to its registered command and starts. | Fresh runner response was `ERROR` with `[NO_MATCHING_WORKFLOW] unknown validation command(s): test-fast` at 2026-08-30T02:36:04.033Z. |
| Repository manifest | Be the source of truth for names and command strings. | Passes the direct manifest inspection; no repository-side command rewrite is indicated. |
| Scheduled audit | Remain separate from task tiers. | `audit-marker-bbox` is separate and intentionally excluded from tier lookup. |

## Impact

The workspace cannot currently rely on the Replit-managed validation registry
to register or launch the canonical task validation commands. This blocks
managed `test-fast` execution and prevents the four-tier setup from being
verified through the platform. It does not demonstrate a defect in the
validation shell commands themselves, and no claim is made that the platform
registry has been fixed.

## Requested platform investigation

Please investigate:

1. Why the validation-command TOML editor rejects valid name/command values
   with `toml-editor error: parsing value field in add request`.
2. Whether the editor's add/upsert path and no-op update path are reaching the
   same TOML editor service, and whether the parser is failing before the
   command payload is validated.
3. Why the managed command list is empty after the registration attempts.
4. Why the managed runner reports
   `NO_MATCHING_WORKFLOW` / `unknown validation command(s): test-fast` instead
   of resolving the canonical command or returning a registration-state error.
5. Whether there is a platform-side repair or reindex needed for this
   workspace's managed validation registry.
6. After repair, please confirm that all four canonical tier entries can be
   upserted idempotently and that `test-fast` starts through the managed runner
   without requiring a `.replit` workflow or a changed command string.

## Evidence and screenshot note

The platform editor/list/runner UI is not exposed to the capture tool in this
workspace. Therefore no platform screenshots are attached or represented by
fabricated image files. The evidence directory contains the two fresh
read-only API observations and a capture-status record explaining this
limitation:

- [`capture-status.md`](replit-toml-editor-evidence/capture-status.md)
- [`managed-validation-list-2026-08-30T023557Z.md`](replit-toml-editor-evidence/managed-validation-list-2026-08-30T023557Z.md)
- [`managed-validation-run-2026-08-30T023604Z.md`](replit-toml-editor-evidence/managed-validation-run-2026-08-30T023604Z.md)

The editor error is reported only from the merged incident evidence and is
clearly labeled as such above. If Support needs full-page UI captures, they
will need to be taken from a Replit session where the managed validation
editor/list/runner surfaces are visible.

Thank you for investigating the managed validation-command editor and registry
for this workspace. I can provide the exact manifest commands and the
timestamped observations above again after the platform-side repair.

Best,

BathyScan project maintainer