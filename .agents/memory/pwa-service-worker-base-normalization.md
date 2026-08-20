---
name: PWA service-worker base normalization
description: Avoid malformed root or trailing-slash service-worker registration URLs in Vite PWA builds.
---

Service-worker registration and scope paths must be formed from one normalized base path, not by blindly appending `/` to a base that can already end in `/`.

**Why:** At the root base, concatenating `"/" + "/"` emits protocol-relative `//sw.js` and `//` scope. Browsers resolve that worker URL against a host named `sw.js`, reject registration as cross-origin, and `navigator.serviceWorker.ready` remains unresolved.

**How to apply:** Build both root-hosted and subpath-hosted variants and inspect the emitted registration script. Assert a same-origin worker URL and a scope equal to the normalized application base in a production-bundle test.