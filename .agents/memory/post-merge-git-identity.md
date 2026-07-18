---
name: Post-merge git identity
description: Replit runner has no global git config; git commit in post-merge.sh fails without local identity set first.
---

The Replit task-merge runner (`runner@repl.(none)`) has no global `user.email` or `user.name` set. Any `git commit` inside `post-merge.sh` fails with:

```
fatal: unable to auto-detect email address (got 'runner@repl.(none)')
```

**Why:** The runner is a minimal container without a home directory git config. `git config --global` from there also fails. `--local` writes to `.git/config` which is writable and scoped to the repo.

**How to apply:** Before every `git commit` call in `scripts/post-merge.sh`, set the local identity:

```bash
git config --local user.email "post-merge@replit.local" 2>/dev/null || true
git config --local user.name  "BathyScan Post-Merge Bot"  2>/dev/null || true
git commit -m "..."
```

The `|| true` prevents the config call from aborting under `set -e` if `.git/config` is somehow unwritable. This is the pattern now in the docs-stale auto-commit section of `scripts/post-merge.sh`.
