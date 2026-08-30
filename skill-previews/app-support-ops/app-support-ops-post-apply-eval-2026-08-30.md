# App Support Ops post-apply evaluation

## Scope

- **Canonical skill:** `.agents/skills/app-support-ops/SKILL.md`
- **Evaluation set:** `.agents/skills/app-support-ops/evals/evals.json`
- **Cases run:** 9
- **Expectations graded:** 30
- **Result:** 30/30 passed

The six positive and mixed-mode prompts were run as prompt-only behavior
evaluations against the canonical skill. Capabilities stated in each prompt were
treated as user-provided evidence, while unstated prerequisites remained gated.
The three near-miss prompts were run as invocation-boundary evaluations so the
skill could reject unrelated documentation, marketing analysis, and CI work
without executing those tasks.

## Coverage and results

| Eval | Focus | Result |
|---|---|---:|
| 1 | Help-only selection, first-run/revisit, accessibility, conditional grounded Q&A | 4/4 |
| 2 | Admin-only analytics authorization, privacy, retention, non-blocking telemetry | 4/4 |
| 3 | CLI/single-service port allocation, hardcoded-port fixture, exact cleanup | 4/4 |
| 4 | Development outage/restart build and server gates, authorization, process safety | 4/4 |
| 5 | Explicit Combined mode with three independently gated workstreams | 4/4 |
| 6 | API-only Help behavior and browser-specific not-applicable outcomes | 4/4 |
| 7 | Generic user-manual near miss | 2/2 |
| 8 | Public marketing-analysis near miss | 2/2 |
| 9 | CI workflow near miss with an incidental fixed-port mention | 2/2 |

## Regression found and repaired

The CI near-miss initially selected Runtime Safety solely because the prompt
mentioned a fixed ephemeral test port. The canonical instructional body now
states that ordinary CI workflow configuration is adjacent work and that an
incidental fixed-port mention does not select Runtime Safety. The repaired case
was rerun and passed both expectations.

## Protected surfaces

- Frontmatter identity and trigger description: unchanged
- Evaluation fixture: unchanged
- Evaluation fixture SHA-256:
  `2af729eca0d64dda30879e7eeef9d9bafd907a824730ae097b74f94b8b169204`
- Published archive: `exports/app-support-ops-skill.zip`
- Published archive SHA-256:
  `6ea044938539d60c0d5f2c64b47d9a2a51c7d0c2d127642bdc20e2dfee5e49a4`
- Archived `SKILL.md` and `evals/evals.json`: verified byte-for-byte
  against the canonical files after the scope correction
- Application code and configuration: unchanged
- Runtime skill mirrors: unchanged; the canonical `.agents` source remains
  authoritative

## Delivery check

The passing responses preserved capability discovery, precise mode selection,
unavailable/not-applicable outcomes, service-authoritative authorization,
privacy-safe telemetry, build/server production gating, exact process cleanup,
negative-path tests, and the seven-part completion report.

## Repository validation

The task-locked `test-standard` run passed all static, typecheck, lint, and
skill-contract checks. Its full unit aggregation reported three failures in the
untouched `overviewMap.puzzleMultiSelect` test file under concurrent load.
Three isolated retries of that file each passed all 12 tests, so the suite
failure is recorded as intermittent and not attributed to this skill-only
change. After the canonical ZIP was rebuilt, the task-locked `test-standard`
tier was rerun: all 34 steps passed, including the complete unit suite. No
broader tier was run.