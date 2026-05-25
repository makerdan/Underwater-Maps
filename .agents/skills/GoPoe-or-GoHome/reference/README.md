# GoPoe-or-GoHome Reference Files

This directory contains detailed reference documents for the GoPoe-or-GoHome skill pillars. Each file is linked from the main `SKILL.md`.

| File | Pillar | Purpose |
|---|---|---|
| `poe-api.md` | Pillar 1 — Poe API | Complete API reference for `@workspace/poe`: model aliases, `poeRespond()`, `poeComplete()`, streaming, vision, tools, retry, caching, usage logging, error handling, and a new-route checklist. |

## Adding new reference files

When a pillar grows large enough that its SKILL.md section exceeds ~100 lines, extract the detail into a new file here and replace the section body with a single link:

```markdown
> Full reference: `.agents/skills/GoPoe-or-GoHome/reference/<topic>.md`
```

Suggested future files as the project matures:

| Suggested file | When to create |
|---|---|
| `clerk-auth.md` | After Clerk is fully wired — document the `publicMetadata` admin promotion pattern and any project-specific gotchas |
| `drizzle-schema.md` | When the schema grows beyond 5 tables — document table relationships, index decisions, and migration conventions |
| `openapi-codegen.md` | If the Orval codegen pipeline becomes complex — document the codegen config, hooks, and how to add a new endpoint end-to-end |
| `testing-patterns.md` | If the Playwright/Vitest suite grows large — document fixture setup, auth mocking, and CI integration |
| `tree-data-model.md` | When Pillar 6 (File & Folder Tree) is implemented — document the recursive node schema, soft-delete mechanics, and REST API contract |
