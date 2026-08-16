---
name: pnpm overrides dual-source trap
description: package.json pnpm.overrides silently wins over pnpm-workspace.yaml overrides for the same key — security patches must go in package.json.
---

# pnpm overrides dual-source trap

**The rule:** Security overrides that need to take effect must be set in `package.json` under `pnpm.overrides`. Changes to `pnpm-workspace.yaml` overrides section for the same key are silently ignored when package.json has a competing entry.

**Why:** pnpm resolves `package.json` pnpm.overrides before `pnpm-workspace.yaml` overrides. If both define an entry for the same package (e.g. `js-yaml@4`), the package.json value wins. The lockfile will show the package.json value and never reflect the workspace.yaml change — even after `rm pnpm-lock.yaml && pnpm install --force`.

**How to apply:** When adding or updating a security override:
1. Check `package.json` pnpm.overrides first — if the key exists there (e.g. `js-yaml@4`), update it there.
2. If it's only in pnpm-workspace.yaml and not in package.json, the workspace.yaml change works fine.
3. After any override change, verify with `grep "<package>@" pnpm-lock.yaml` that the lockfile picked up the new version.

**Key affected overrides in package.json (as of 2026-08-16):**
- `js-yaml@4: 4.3.1` — pinned here, not in workspace.yaml
- `nanoid: 3.3.18` — pinned here
- Other brace-expansion, tar, fast-uri, body-parser, esbuild@<0.28.1, uuid@<11.1.1 entries
