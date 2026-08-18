---
name: Dynamic import of mocked modules races under vitest
description: Concurrent await import() of a vi.mock'd module can hand the loser a partially-initialised/real namespace; prefer static imports.
---

# Dynamic import of vi-mocked modules races under concurrency

**Rule:** Never rely on `await import("mocked-module")` being called concurrently from two async paths in code under test. The first caller gets the mock; a concurrent second caller can receive a partially-initialised namespace or fall through to the REAL module (symptom: `No "<export>" export is defined on the ... mock` for an export only the real module's transitive imports touch). Warm-up calls do NOT reliably fix it.

**Why:** Middleware used call-time `await import("@workspace/db")` to avoid forcing ~130 wholesale mock factories to stub a new export. A Promise.all of two middleware invocations made the loser error with a missing-export complaint from a *different* module (`drizzle-orm` `sql`) pulled in by the real `@workspace/db` init.

**How to apply:** Use static imports instead — it is safe even in every-route import graphs because vitest's missing-export error fires on **access**, not on import. Keep all uses of the imported bindings inside function bodies (never module scope) and wholesale mocks that lack the new export stay green as long as legacy suites never execute the new code path.

Related: static imports of mocked modules in a file under test mean `vi.mock` factories are hoisted before module-level `const` spy declarations → wrap the spies in `vi.hoisted()` (see vi-hoisted-mock-vars.md); with call-time dynamic imports plain module-level consts had worked, which hides the TDZ trap until you switch.
