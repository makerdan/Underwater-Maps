---
name: Disk cache filter must strip extension before regex
description: readdir returns <hash>.json files; bare-hash regexes silently match nothing; strip .json before testing.
---

When a cache directory stores files as `<sha256>.json`, `fs.readdir()` returns strings like `"d717e6b5...json"`. A bare-hash regex such as `/^[a-f0-9]{64}$/` never matches because the `.json` suffix is still attached.

**Why:** `__clearUpscaleCaches()` used this pattern and silently skipped all disk file deletions, letting a stale cache from a success test bleed into the 503/502 circuit-breaker tests and turn them into cache-hit 200s.

**How to apply:** When filtering readdir results against a hash pattern, strip the extension first:

```ts
const files = await fs.readdir(dir);
const hashFiles = files.filter(f => /^[a-f0-9]{64}$/.test(f.replace(/\.json$/, "")));
```

Alternatively, match with an extension-aware regex: `/^[a-f0-9]{64}\.json$/`.
