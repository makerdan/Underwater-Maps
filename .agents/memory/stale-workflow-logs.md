---
name: Stale workflow log tails
description: Why tailing /tmp/logs after a workflow restart can show the previous run
---
After `restart_workflow`, `ls -t /tmp/logs/<name>_*` can still point at the PREVIOUS run's file until `refresh_all_logs` writes a new one. Tailing it makes an old failure look current (or vice versa).

**Why:** log files are only written when logs are fetched; the newest file on disk lags the actual run.

**How to apply:** after any workflow run you care about, call `refresh_all_logs` and read the file it reports for that workflow; never trust a bare `tail` of the latest-mtime file.
