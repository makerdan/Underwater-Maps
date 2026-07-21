---
name: Vite 8 (rolldown) test-suite breakage
description: Two failure modes after the vite 8 bump — JSX "React is not defined" in vitest and bundle back-door guard tripping on comments.
---

The dependency-audit pin bumped `vite` to `^8` (rolldown-based) while `vitest` stayed at 3.x (pairs with vite ≤7). Two distinct breakages resulted:

1. **"React is not defined" in ~300 unit tests.** plugin-react's automatic-JSX esbuild config is not applied under vitest with vite 8 in the tree, so any test/component file that uses JSX without `import React` falls back to the classic transform and crashes.
   **Fix:** add `esbuild: { jsx: "automatic", jsxImportSource: "react" }` at the top level of every bathyscan vitest config (vitest.config.ts and vitest.config.validation.ts). Apply the same to any new vitest config with JSX.

2. **Bundle back-door guard (`testHelpers.bundle.test.ts`) fails on comments.** Rolldown preserves JSDoc comments in unminified production builds (old esbuild transform stripped them), so a *comment* containing the literal `__bathyTest` in any bundled module trips the guard.
   **How to apply:** never write the literal back-door global name in comments of production-bundled source files; describe it as "the e2e test bridge" instead.

**Why:** both look like app regressions but are toolchain drift; check vite/vitest major versions first when mass test failures appear after an upstream merge.
