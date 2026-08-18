---
name: New api-server route module checklist
description: Test files that must be updated whenever a new routes/<name>.ts module is added and mounted in routes/index.ts
---

# New api-server route module checklist

Adding a new route module (`artifacts/api-server/src/routes/<name>.ts` mounted in `routes/index.ts`) breaks two classes of existing tests unless updated in the same change:

1. **Wholesale `@workspace/api-zod` mocks** — any test file with `vi.mock("@workspace/api-zod", () => {...})` that does NOT use `importOriginal`/`importActual` must have the new module's zod exports added (as of Aug 2026: `markers.test.ts`, `markers-delete.test.ts`, `markers-delete-cross-tenant.test.ts`). Failure mode: suite-load error `No "<Schema>" export is defined on the "@workspace/api-zod" mock` in unrelated marker tests.
   - Find them: `grep -rl 'vi.mock("@workspace/api-zod"' src --include='*.test.ts'` then filter out files containing `importOriginal`.
2. **Router registry guard** — `src/__tests__/router-duplicate-route-guard.test.ts` asserts every router imported in `routes/index.ts` is in its `ROUTERS` list; import and add the new router.

**Why:** Both failed the heavy tier when the collections routes were added; each is a deterministic suite-level failure that hides behind shard fail-fast (fixing one reveals the next on the other shard), so fix all occurrences in one pass.

**How to apply:** Run the grep sweep and update the guard list in the same commit that mounts any new router.

- Adding a new drizzle-orm operator import (e.g. `inArray`) to an existing route file breaks every test that wholesale-mocks `drizzle-orm` for that route: the mock factory lacks the new export and the route 500s at runtime with "No "inArray" export is defined on the mock". Grep for `vi.mock("drizzle-orm"` in tests covering the touched route and add the operator to each factory.

3. **Spec-conformance coverage gate** — any schema newly passed to `validateResponse()` must get a realistic payload fixture in `src/routes/__tests__/spec-conformance.test.ts` (FIXTURES) or a rationale entry in LOCAL_SCHEMA_ALLOWLIST, or the coverage test fails the whole api-server unit suite (seen Aug 2026 with a pending-count response schema merged without a fixture).

Also applies to NEW SCHEMA EXPORTS on an existing router: any api-zod schema referenced at module init (e.g. in a validateBody() call in a route file) must be added to every explicit-list `vi.mock("@workspace/api-zod")` (markers*.test.ts trio), and any new lib/db export needs a stub in `createDbMock()` (mock-factory-guards.test.ts fails first with the exact missing name).

- Two more guards trip on new routes/schema (Aug 2026): (a) new `@workspace/db` schema exports must be stubbed in the shared `createDbMock()` factory (`src/__tests__/helpers/db-mock.ts`) — `mock-factory-guards.test.ts` enumerates real runtime exports and fails on any missing (enums included, not just tables); (b) new generated react-query hooks must classify correctly in bathyscan's `src/__tests__/apiClientMock.ts` regexes — `apiClientMockSentinel.test.ts` fails when a mutation hook (e.g. `useAdminBanUser`) matches a broad query prefix like `^useAdmin`; add the specific mutation pattern BEFORE the broad query pattern.
