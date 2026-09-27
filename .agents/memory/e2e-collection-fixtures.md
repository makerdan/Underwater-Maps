---
name: Deterministic collection E2E fixtures
description: How browser tests should create collection members when coverage depends on ready user datasets.
---

Collection and library browser tests must create their own ready datasets through the authenticated upload API and clean them up in a finally block; they must not skip based on whatever data happens to exist in the E2E account.

**Why:** The bypass account may have no ready georeferenced library rows, making environment-gated tests pass without exercising the collection activation and rendering behavior they claim to cover.

**How to apply:** Use small dense CSV fixtures at the API's supported minimum resolution, add the returned saved dataset IDs to the collection, wait for loaded-grid state in the browser, and delete both the collection and uploaded datasets afterward.

For collection-open assertions, use the collection scope's primary dataset state (or the visible collection UI) in addition to the AppContext terrain summary. Uploaded collection members are intentionally loaded into the terrain store while AppContext's single-dataset id remains null.

**Why:** The collection flow supports multiple visible members and does not represent a user-uploaded collection load as the single active dataset path.

**How to apply:** Prefer `getCollectionScope().primaryDatasetId` when asserting which member a collection opened, while retaining the terrain summary assertion for ordinary single-dataset loads.

For dev-auth account-switch tests, switching through signed-out unmounts the signed-in application tree, so dialogs hosted inside it close. Reopen the dialog after signing in as the next account before asserting its collection options.

**Why:** Keeping the old dialog mounted is not the app's account-switch contract; treating it as an in-place refresh produces a false failure and misses the actual close-and-reopen path.

**How to apply:** Assert the dialog closes on sign-out, then reopen it under the next identity and verify only that account's collection options and request identity are present.