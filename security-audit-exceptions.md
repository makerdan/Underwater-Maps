# Security Audit Exceptions

Findings that cannot be patched in-place and have been reviewed as acceptable.
Run `pnpm check:audit` (audit-level=high) to confirm no new high/critical issues.

Last reviewed: 2026-08-17

---

## High — `linkify-it` quadratic scan loop (GHSA-22p9-wv53-3rq4)

**Path affected**
- `lib/api-spec > orval > typedoc > markdown-it > linkify-it` (versions `<=5.0.0`)

**Risk assessment**: `orval` is a code-generation tool used only at build time (CI and developer
machines). `linkify-it` is invoked when `typedoc` renders Markdown in API spec comments. No user
input reaches this path at runtime. A denial-of-service via crafted Markdown is only exploitable
during a local or CI build, not against any deployed service.

**Planned fix date**: 2026-10-17 — reassess when `orval` or `typedoc` releases a version that
upgrades `markdown-it` to pull `linkify-it >=5.0.1`. Track via `pnpm update --recursive orval`.

---

## Moderate and Low findings

Documented for visibility but not blocking per task scope:

| Severity | Package | Advisory | Path | Notes |
|---|---|---|---|---|
| low | `@babel/core` | GHSA-4x5r-pxfx-6jf8 | `eslint-plugin-react-hooks` | **Overridden** via `pnpm-workspace.yaml` (`'@babel/core': '>=7.29.6'`); remove override once eslint-plugin-react-hooks bumps its own peer |
