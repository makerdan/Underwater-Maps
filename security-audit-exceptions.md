# Security Audit Exceptions

Findings that cannot be patched in-place and have been reviewed as acceptable.
Run `pnpm check:audit` (audit-level=high) to confirm no new high/critical issues.

Last reviewed: 2026-07-17

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

## High — `vite` server.fs.deny bypass on Windows (GHSA-fx2h-pf6j-xcff)

**Path affected**
- `artifacts/api-server > vitest > vite` (versions `>=7.0.0 <=7.3.4`)

**Risk assessment**: This is a Windows-specific path-traversal issue (`\\??\\` alternate path forms).
The project runs exclusively on Linux; the attack vector does not exist on the deployment target.

**Fix status**: Fix already committed — `pnpm-workspace.yaml` overrides section forces `vite: '>=7.3.5'`
for all transitive consumers. This finding will disappear automatically after the next `pnpm install`
updates the lockfile. Remove this exception from `scripts/check-audit.mjs` and this file once the
override has been applied by a successful install.

**Planned fix date**: 2026-08-01 (remove exception after lockfile regeneration confirms clear audit).

---

## High — `undici` SOCKS5/WebSocket advisories via jsdom (GHSA-vmh5-mc38-953g, GHSA-vxpw-j846-p89q, GHSA-hm92-r4w5-c3mj)

**Path affected**
- `artifacts/bathyscan > jsdom > undici` (versions `>=7.23.0 <7.28.0` or `>=7.0.0 <7.28.0`)

**Risk assessment**: All three advisories require either SOCKS5 proxy usage or WebSocket client
usage. jsdom uses undici only for HTTP fetch in test environments; neither SOCKS5 proxy nor WebSocket
is configured or used in any Vitest tests. These code paths are completely unreachable.

**Why not overridden**: Applying `undici: '>=7.28.0'` as a workspace override breaks all Vitest
tests — jsdom 29.1.1 hard-requires internal paths (e.g. `undici/lib/handler/wrap-handler.js`) that
were reorganized in undici 7.28.0, causing `MODULE_NOT_FOUND` errors across the entire test suite.

**Planned fix date**: 2026-10-17 — reassess when jsdom releases a version that ships undici >=7.28.0
natively (without internal-path breakage). Track via `pnpm update --filter @workspace/bathyscan jsdom`.

---

## Moderate and Low findings

Documented for visibility but not blocking per task scope:

| Severity | Package | Advisory | Path | Notes |
|---|---|---|---|---|
| moderate | `undici` | GHSA-g8m3-5g58-fq7m, GHSA-35p6-xmwp-9g52 | `jsdom` | Test devDep only; see High section above for full reasoning |
| low | `undici` | Multiple | `jsdom` | Test devDep only; same reasoning |
| low | `@babel/core` | GHSA-4x5r-pxfx-6jf8 | `eslint-plugin-react-hooks` | **Overridden** via `pnpm-workspace.yaml` (`'@babel/core': '>=7.29.6'`); remove override once eslint-plugin-react-hooks bumps its own peer |
