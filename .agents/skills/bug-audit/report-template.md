# Bug & Error Audit Report

**Scope:** <what was audited — whole app / directory / feature>
**Mode:** <report-only | audit-and-fix>
**Date:** <date>
**Stack:** <languages/frameworks detected; note gated categories skipped and why>

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| 1 | Critical | Security | src/example.ts:42 | <short description> |

## Findings

### Finding 1 — <short title>
- **File and line:** `path/to/file.ts:42`
- **Category:** <one of the ten audit categories>
- **Severity:** Critical | High | Medium | Low
- **Risk:** <description of the risk, including the realistic failure scenario>
- **Recommended fix:** <concrete, minimal fix>

<!-- Repeat the block above for each finding, sorted by severity (Critical first). -->

## Tooling signals (Phase 0)

- Typecheck: <clean / N errors — summarized>
- Lint: <clean / N warnings — summarized>
- Tests: <pass / fail summary>
- Dependency audit: <clean / N advisories — summarized>

## Deferred / not audited

<Anything out of scope, gated categories skipped, or candidates that could not be verified.>
