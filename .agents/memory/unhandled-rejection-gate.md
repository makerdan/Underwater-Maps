---
name: Vitest unhandled-error gate fails green runs
description: Vitest can exit 1 with every test passing when it catches unhandled errors; usual cause is a stale wholesale mock.
---

Vitest exits non-zero when it catches **unhandled errors**, even if every test
passes (summary shows "Test Files N passed … Errors: M errors" → exit 1).

**Why:** the usual cause is mock drift, not a test regression — a component
gains a call to a module export that some other test file wholesale-mocks
without that export; the rejection surfaces asynchronously and lands in the
"Unhandled Errors" section instead of failing a specific test.

**How to apply:** when a run fails with all tests passing, read the
"Unhandled Errors" section first and look for "No '<name>' export is defined
on the '<module>' mock". Fix by adding the export to the mock via the
`importOriginal` spread, or by adopting the shared mock-factory + guard
pattern already used for other wholesale-mocked modules.
