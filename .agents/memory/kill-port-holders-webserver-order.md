---
name: Playwright globalSetup port sweep self-DOS
description: Why the e2e port-freeing sweep must never kill processes spawned by its own invoker tree
---
Playwright spawns its configured `webServer` processes BEFORE running `globalSetup`. Any port-freeing sweep inside globalSetup (e.g. scripts/kill-port-holders.mjs) will therefore see the freshly spawned API/web servers holding the e2e ports and SIGTERM them, causing ECONNREFUSED on every run.

**Why:** process-start ordering is fixed by Playwright; the sweep cannot distinguish "stale holder" from "our own webServer" by port alone.

**How to apply:** kill-port-holders.mjs skips any holder whose live ancestor chain reaches a PROTECTED pid (the invoker's own ancestor set). Orphans reparent to PID 1, so genuinely stale holders are still killed. If all holders are skipped, treat the port as free. A too-narrow direct-parent-pid check is insufficient — use the full ancestor chain.

**Also:** Playwright probes each webServer `url` BEFORE spawning its command; with `reuseExistingServer: false` a stale port holder aborts the whole run with "port is already used" — so a sweep prepended to the webServer command never gets a chance to run. The only hook early enough is the config module itself: run the sweep at playwright.config.ts load time, guarded by an env var (set it after sweeping) so worker/report subprocesses that re-load the config inherit the flag and never sweep mid-run.

**Related:** the two e2e validation steps (test-e2e, test-e2e-palette) run concurrently in validation; palette must run on dedicated ports via `E2E_WEB_PORT`/`E2E_API_PORT` env overrides (supported by tests/e2e/ports.ts) or they collide on 3150/3161. If e2e fails with "API server unreachable" right after a "kill-port-holders: terminating tree" log line, suspect a sweep-killed-own-server bug first.
