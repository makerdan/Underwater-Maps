---
name: E2E global-setup port sweep vs own webServer
description: Playwright boots webServer before globalSetup; a port sweep in globalSetup will kill the run's own servers unless own-tree holders are exempted.
---

Playwright (v1.60 here) starts `webServer` processes BEFORE running `globalSetup`. Any port-freeing sweep inside globalSetup therefore sees the run's own freshly-booted servers as "holders" and kills them, producing `ECONNREFUSED` in the liveness setup step — while looking exactly like a stale-server port conflict.

**Why:** webServer is implemented as a plugin whose setup runs before globalSetup; the sweep's self-protection only covered the script's own *ancestors*, but the webServer is a *sibling* subtree under the same Playwright process.

**How to apply:** `scripts/kill-port-holders.mjs` now skips holders whose parent chain reaches one of the script's protected ancestors (own run) and only kills orphaned holders (reparented to PID 1, i.e. genuinely stale). If e2e fails with "API server unreachable" right after a "kill-port-holders: terminating tree" log line, suspect this class of bug first.

Related: the two e2e validation steps (test-e2e, test-e2e-palette) run concurrently in validation; palette must run on dedicated ports via `E2E_WEB_PORT`/`E2E_API_PORT` env overrides (supported by tests/e2e/ports.ts) or they collide on 3150/3161.
