# Approved bootstrap observations

These are raw versioned step reports from the explicitly approved installation
bootstrap under the **prior plan-locked route**. They are not checked local-ID
v4 evidence, do not renew approval for changed policy, and do not prove cutover.

| Retained file | Result | SHA-256 |
| --- | --- | --- |
| `2026-10-01-preflight-failed.json` | Heavy preflight failed its run-button guard after temporary workflow registration changed Project. Heavy suites did not run. | `3673fb8bfd97183aa4afa448fe47aa59799a9d5c9ab477e71ddcba2e0ec7f077` |
| `2026-10-01-heavy-failed.json` | Preflight passed. Unit, palette and full browser suite steps each exited 1. | `2f6b598e587cd4842c94db4cd19741b5ef708fe2cfac06ebab0f9a2980027f85` |

The reports are copied byte-for-byte from the original `/tmp` outputs. Their
referenced raw TAP/case artifacts were temporary and are not all retained here.
These two JSON files alone are not complete case-level validation evidence.

## Failures and subsequent repairs

- Scripts unit discovery contains **374 tests: 364 passed, 10 failed, none
  skipped**. Nine failing cases are historical-date catalog fixtures; they have
  not been repaired or accepted as baseline ignores. The tenth is the exact
  workflow-list guard: adding a temporary bootstrap workflow consumed an
  unregistered slot. The temporary workflow was removed and `.replit` restored.
- Both browser steps rejected the enabled reporter configuration before test
  execution: `config.reporter[0] must be a tuple`. The list reporter now uses
  `["list"]`; actual `playwright test --list` config-loading diagnostics pass
  with reporting enabled and disabled. That is not browser execution proof.
- TAP parsing now excludes suite summaries while retaining leaf statuses. The
  original TAP yields 374/374 cases rather than counting 49 suites as tests.
- The registered scripts unit command includes every `failure-gate-v4-*`
  regression file. No obligation or failure was removed to obtain a pass.

## Continuity and activation

A later session opened an apparently fresh home ledger and allocated a local ID
already represented by tracked projections. It was cancelled without a v4
required run. The original ledger history is unavailable; the cause of the
change has not been established. New allocator checks reject the live database
because tracked `TASK-000002` has no matching retained row. They do not recreate
history or infer a new high-water mark from projections.

Reporting, allocator and stored-assessment changes alter governing policy.
The existing explicit approval remains a historical record for its earlier
digest; another heavy bootstrap needs renewed review of current code.

The ordinary route remains authoritative. Missing ledger continuity, trusted
failure/provenance/repair adapters, all-writer participation and a real reviewed
local-ID run/final-write proof remain blockers. Focused fixtures cannot waive them.