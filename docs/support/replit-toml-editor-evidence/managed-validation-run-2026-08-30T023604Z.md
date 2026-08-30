# Managed validation runner observation

- **Observed at:** `2026-08-30T02:36:04.033Z`
- **Operation:** read-only lookup/start attempt for the managed command ID
  `test-fast`
- **Request context:** `startValidationRun({ commandIds: ["test-fast"] })`
- **Credentials/secrets:** none included

## Response

```json
{
  "commands": [],
  "durationMs": 0,
  "errorMessage": "Failed to start validation run: [NO_MATCHING_WORKFLOW] unknown validation command(s): test-fast",
  "runId": "",
  "runSummary": "Failed to start validation run: [NO_MATCHING_WORKFLOW] unknown validation command(s): test-fast",
  "status": "ERROR"
}
```

## Interpretation

The managed runner did not start an execution and could not resolve
`test-fast`. This is a platform registry/lookup observation; it is not a
repository test result.