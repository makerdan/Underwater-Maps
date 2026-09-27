---
name: TS project refs need rebuild after codegen
description: After running orval codegen you must also rebuild lib .d.ts files or consuming artifacts get stale type errors.
---

# TypeScript project references require explicit rebuild after orval codegen

## The rule
After running `pnpm --filter @workspace/api-spec run codegen:generate` (orval), the generated source files in `lib/api-client-react/src/generated/` are updated — but the compiled `.d.ts` files in `lib/api-client-react/dist/` are NOT. Because `bathyscan` uses TypeScript project references (`references: [{ path: "../../lib/api-client-react" }]`) with `composite: true` / `emitDeclarationOnly: true`, tsc resolves the package via its `dist/` declarations, not source. Run `pnpm run typecheck:libs` (which calls `tsc --build`) after codegen to emit fresh `.d.ts` files.

**Why:** `api-client-react` has `composite: true` + `emitDeclarationOnly: true` + `outDir: "dist"` in its tsconfig. `api-zod` has the same stale-declaration risk after schema regeneration: generated source can export new response schemas while consumers still resolve older declarations from `dist/`. The full workspace typecheck script (`typecheck` workflow) already runs `typecheck:libs` first, so it rebuilds library declarations before checking consumers.

**How to apply:** Whenever codegen changes exported types in `lib/api-client-react` or `lib/api-zod`, run `pnpm run typecheck:libs` before running any artifact-level typecheck.
