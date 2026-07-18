---
name: Playwright globalSetup port sweep self-DOS
description: Why the e2e port-freeing sweep must never kill processes spawned by its own invoker tree
---
Playwright spawns its configured `webServer` processes BEFORE running `globalSetup`. Any port-freeing sweep inside globalSetup (e.g. scripts/kill-port-holders.mjs) will therefore see the freshly spawned API/web servers holding the e2e ports and SIGTERM them, causing ECONNREFUSED on every run.

**Why:** process-start ordering is fixed by Playwright; the sweep cannot distinguish "stale holder" from "our own webServer" by port alone.

**How to apply:** kill-port-holders.mjs skips any holder whose live ancestor chain reaches a PROTECTED pid (the invoker's own ancestor set). Orphans reparent to PID 1, so genuinely stale holders are still killed. If all holders are skipped, treat the port as free. A too-narrow direct-parent-pid check is insufficient — use the full ancestor chain.
