---
name: Running commands longer than the 2-minute shell cap
description: How to run test suites or builds that exceed the bash tool's 120 s timeout in this workspace
---
Background/detached processes started from the shell (`nohup`, `setsid ... & disown`) are killed when the shell session ends — polling their log file in a later call finds it frozen or missing.

**Why:** The platform tears down the whole process group per shell invocation; tried both nohup and setsid, both died silently mid-suite.

**How to apply:** For anything longer than ~2 min (full vitest suites, Playwright runs), register a temporary validation command (`setValidationCommand` + `startValidationRun`) and clear it afterwards, or use an existing workflow (e.g. `test-unit`) and poll its log under /tmp/logs. Note `test-unit` runs api-server and bathyscan in parallel and aborts the survivor when one fails.
