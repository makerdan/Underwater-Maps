---
name: Playwright webServer starts before globalSetup
description: Ordering contract for e2e port cleanup — never sweep ports in globalSetup.
---
Rule: never kill/sweep the E2E ports inside Playwright globalSetup.

**Why:** In the Playwright version in use (1.60), webServer processes are
launched and health-checked BEFORE globalSetup runs. A port sweep in
globalSetup kills the freshly booted api-server/vite, so the setup liveness
project fails and all specs are skipped. Comments claiming the opposite
ordering were wrong and have been corrected.

**How to apply:** Stale-port cleanup belongs inside each webServer `command`
(`node scripts/kill-port-holders.mjs <port> && …`) — guaranteed to run before
that server binds. kill-port-holders never kills its own ancestors, so this
is safe.
