# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- Always spell out "EFH" as "Essential Fish Habitat" in user-facing copy (UI strings, help articles, READMEs, OpenAPI summaries/descriptions). Bare "EFH" is allowed only as a parenthetical after the full phrase on first mention, e.g. "Essential Fish Habitat (EFH)". Code identifiers, file names, route paths, dataset `source` strings, log lines, and test-only strings are unaffected.

## Gotchas

- `pnpm run test-all` (typecheck + lint + unit tests) is the green-bar gate. It runs automatically after every merge via `scripts/post-merge.sh`, so a regression in any of the three will fail the merge.
- `react-hooks/exhaustive-deps` is configured as an **error** (not a warning) in `eslint.config.mjs`. Don't silence it lazily — either include the dependency or refactor; suppressions need an inline justification.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
