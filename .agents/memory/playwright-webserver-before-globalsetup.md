---
name: Playwright webServer starts before globalSetup
description: Ordering of Playwright plugin setup vs globalSetup, and where the e2e port sweep must live
---

# Playwright webServer starts before globalSetup

In Playwright 1.60, `createGlobalSetupTasks` runs `createPluginSetupTasks` (which starts all `webServer` processes) BEFORE the `globalSetup` file. The config comment claiming "globalSetup always runs before webServer" is wrong.

**Why:** a stale-port sweep (`kill-port-holders.mjs --e2e`) placed inside `tests/e2e/global-setup.ts` killed the run's own freshly-started webServers every run — every spec then failed with `ECONNREFUSED 127.0.0.1:3161` and an esbuild "write EPIPE" dep-scan error from the killed Vite server.

**How to apply:** any pre-flight cleanup that could touch the e2e servers must run before Playwright launches — it lives in the `test:e2e` package.json script (`kill-port-holders --e2e && … playwright test`). Solo `npx playwright test` runs should also prepend the sweep manually. Never put port kills back into global-setup.ts.

Also: the Drift Planner panel renders `embedded` inside the Plan-mode sidebar — no "DRIFT PLANNER" header text and no × close button in embedded mode; specs must assert `[data-testid='weather-panel']` and close via the toolbar "◉ DRIFT" toggle.
