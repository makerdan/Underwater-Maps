---
name: Disk cache cleanup regex must strip file extension
description: readdir() returns filenames with .json; regexes like /^[a-f0-9]{64}$/ never match unless extension is stripped first.
---

## Rule
When filtering `readdir()` results against a hash-length regex (e.g. `/^[a-f0-9]{64}$/`), always strip the file extension before testing:

```js
files.filter(f => hexRe.test(f.replace(/\.json$/, "")))
```

**Why:** `readdir()` returns basenames including the extension (e.g. `abc123.json`). The 64-char hex regex requires EXACTLY 64 chars, so `abc123.json` (68+ chars) never matches and disk files are silently never deleted. This causes stale disk cache entries to persist across test runs, causing later tests to return cached results when they expect fresh ones.

**How to apply:** Any test-only cache cleanup function that deletes files from /tmp directories must use `.replace(/\.json$/, "")` before regex-testing the filename. See `__clearUpscaleCaches()` and `__clearZoneDiskCacheForTests()` in `artifacts/api-server/src/routes/poe.ts` as reference implementations.
