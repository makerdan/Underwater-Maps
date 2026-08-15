---
name: Offline-pack modal test baseline breakage
description: OfflinePackModal.idbError.test.tsx unhandled rejections break every test-standard/heavy run as of 2026-08-15
---

# Offline-pack modal mock drift (baseline breakage, 2026-08-15)

`src/__tests__/OfflinePackModal.idbError.test.tsx` produces 4 unhandled
rejections: `No "estimatePackStorageBytes" export is defined on the
"@/lib/offlinePackStore" mock`. All its tests PASS, but vitest counts the
unhandled errors and exits 1, so the bathyscan `test:unit` step — and any
tier containing it — fails.

**Why:** the offline-size-estimate task (merged 2026-08-15) added an
`estimatePackStorageBytes` call to `OfflinePackModal.tsx`, but the idbError
test's wholesale `vi.mock("@/lib/offlinePackStore")` was not updated with the
new export. Stash-verified to fail on main with no working-tree changes.

**How to apply:** treat this failure as pre-existing in any task that did not
touch OfflinePackModal/offlinePackStore. Fix is its own task: add the export
to the mock (or convert to importOriginal partial mock). Remove this file once
fixed. General lesson is already covered by the shared-mock-factories entry:
wholesale mocks drift when the mocked module gains exports — prefer factory +
guard-test pattern.

**Update 2026-08-15 (evening):** RESOLVED — no OfflinePackModal unhandled rejections in the evening unit run. A recurrence means fresh wholesale-mock drift, not this incident.
