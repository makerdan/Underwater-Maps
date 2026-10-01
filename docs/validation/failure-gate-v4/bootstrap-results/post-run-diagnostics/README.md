# Post-run focused diagnostics — not required-tier evidence

After the incomplete approved bootstrap and the coherent implementation batch:

| Command | Actual result |
| --- | --- |
| `node --test --test-concurrency=1 scripts/__tests__/failure-gate-v4-*.test.mjs` | 140 passed; 0 failed/cancelled/skipped/todo |
| `node --test --test-concurrency=1 scripts/__tests__/run-tier-check.test.mjs scripts/__tests__/step-report.test.mjs` | 25 passed; 0 failed/cancelled/skipped/todo |

Native console outputs are retained as `v4-focused.log` and `runner-focused.log`.
Their fixture error messages test deliberate failures; the actual terminal
summaries above, not isolated error lines, describe those focused runs.

The tested working-tree policy snapshot digest is
`17fbc4a47b24288f3ae150e29aadc50cb75a9d3a18fef847b4ae95c9e9e9454d`.
This binds installed tooling definitions only; it is **not** a verified whole
workspace snapshot, review decision, local task evidence, or authenticated identity.
No governing source edits followed these diagnostics. Documentation/result
copies remain dirty project changes, not a recorded checked full-tier input.

The real negative completion race used actual final native capture under the
cooperative lease. Unknown snapshot integrity denied the terminal write; no
`completed_terminal` event appeared, active state remained, and the waiting
registered writer then proceeded. Its initial evidence was explicitly a one-file
fixture, not an attested required-tier execution or positive cutover proof.

`git diff --check` passed. `.replit` and `docs/validation/failure-baseline.json`
had no diff. Only the authorized historical heavy bootstrap ran; these focused
commands are diagnostics, not additional required tiers or substitutes for
`test-heavy`. Another current-policy bootstrap needs fresh explicit approval.