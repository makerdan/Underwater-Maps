# Validation failure baseline

`failure-baseline.json` is the tracked source of truth for validation failures
that were observed before a later task. It is provenance, not a test skip list:
membership never suppresses a test, changes a command, or turns a red result
green. A new failure must still match the recorded suite, test, and signature
and meet the Failure Gate evidence rules before anyone classifies it.

Run the checker from the repository root:

```sh
pnpm run check:validation-baseline
```

## Record lifecycle

- **`active`** — current, authoritative evidence supports the exact signature.
  It must have an unexpired review deadline.
- **`needs-review`** — evidence is stale, incomplete, or deliberately
  non-authoritative. It is visible context only and cannot authorize an ignore.
- **`intermittent`** — both failing and passing observations exist. A passing
  retry proves intermittency, never pre-existing provenance.
- **`environment-limited`** — the environment blocked a valid observation.
  This status cannot stand in for a failing test or a pass.
- **`resolved`** — the documented failure was verified fixed. Resolved records
  are terminal; a new recurrence requires a new record and fresh evidence.

Lifecycle transitions are recorded in `statusHistory`. The checker rejects
backward transitions from `resolved`, missing evidence, expired active records,
unknown tiers, duplicate IDs, and references to files that are not in the
repository.

`affectedTiers` uses `fast`, `standard`, `standard-plus`, or `heavy` for the
registered validation tiers. Use `standalone` only when the recorded command is
explicitly outside those tiers, such as raw `pnpm audit`.

## Adding or re-verifying a record

1. Use a stable `BASE-...` ID; do not reuse an ID for a different signature.
2. Identify the suite and exact test, then write a concrete failure signature.
3. Add at least one dated audit source and one dated command observation.
   Include repository references for every relevant test or implementation file.
4. Record the owner and why that owner can verify or resolve the issue.
5. Use `needs-review` unless current evidence is authoritative. For `active`,
   set a realistic review deadline and keep it before the next scheduled review.
6. When re-verifying, append a dated `statusHistory` transition and update
   `lastVerifiedDate`; do not rewrite history or use a successful retry alone.
7. When fixed, append `resolved` with a resolution summary and evidence. If a
   different signature returns later, create a new record.

The fast validation tier checks this file's structure and freshness only. It
does not read the catalog into the test runner and does not provide an
exception mechanism.