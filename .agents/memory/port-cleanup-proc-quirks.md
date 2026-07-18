---
name: Port cleanup /proc quirks
description: Non-obvious environment facts behind scripts/kill-port-holders.mjs (stale port-holder cleanup).
---

# Port cleanup /proc quirks

- `fuser` is NOT on PATH in this environment (bathyscan's old `fuser -k ${PORT}/tcp || true` was a silent no-op for its whole life). `lsof` exists but the cleanup uses pure /proc parsing (`/proc/net/tcp{,6}` LISTEN inodes → `/proc/*/fd` socket links) for zero external deps.
- The Nix Node.js build reports `comm` as `MainThread`, not `node`. Any parent-chain walk that classifies processes by `/proc/pid/stat` comm will silently stop at node wrappers; must also check basename of argv[0] from `/proc/pid/cmdline`.
- `sh -c "single command"` execs, so pnpm's intermediate shell often vanishes from the tree — holder's direct parent can be the pnpm node process itself.

**How to apply:** use `scripts/kill-port-holders.mjs <port>` (or `--e2e`) for any new workflow/suite needing a clean port; never reintroduce `fuser`. It protects its own ancestor chain, so it is safe to call from dev scripts.
