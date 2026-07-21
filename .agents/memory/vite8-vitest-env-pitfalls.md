---
name: Vite 8 + vitest environment pitfalls
description: Two failure modes after bathyscan moved to vite 8 — plugin-react JSX transform not applying under vitest, and NODE_ENV=test defeating mode:"production" in programmatic builds.
---

# Vite 8 + vitest environment pitfalls

Two distinct breakages appeared once bathyscan resolved to vite 8.x / @vitejs/plugin-react 5.2.x:

## 1. "React is not defined" across dozens of test files
`@vitejs/plugin-react` >=5.2 stopped applying its automatic-JSX transform under vitest. Files without an explicit `import React` then fall back to the classic transform and crash at render time with `ReferenceError: React is not defined`; files that happen to import React still pass, so the failure pattern looks random.

**Fix:** set the transform explicitly in every vitest config so it does not depend on the plugin:
```ts
esbuild: { jsx: "automatic", jsxImportSource: "react" }
```
(done in bathyscan `vitest.config.ts` and `vitest.config.validation.ts`).

## 2. Production-build guard tests produce false positives
Vite prioritizes an existing `process.env.NODE_ENV` over `mode: "production"` passed to a programmatic `build()`. Vitest sets `NODE_ENV=test`, so an in-test "production" build is NOT a production build: `import.meta.env.DEV` stays true, dev-only code (e.g. the `__bathyTest` back door) survives into the bundle, and bundle-inspection guards fail.

**Fix:** force `process.env.NODE_ENV = "production"` around the `build()` call (restore in `finally`). Done in `testHelpers.bundle.test.ts`.

**How to apply:** any future test that runs `vite build()` programmatically and asserts on production-only behavior must pin NODE_ENV=production for the build.

Also: `vi.mock("../../lib/terrain.js")` factories accumulated duplicate `BUNDLED_TERRAIN`/`NYSDEC`/`MN_DNR` keys (TS1117) across five route test files — when adding exports to these mocks, check the key isn't already present.
