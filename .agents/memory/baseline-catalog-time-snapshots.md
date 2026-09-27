---
name: Baseline catalog time snapshots
description: Keep tests with pinned historical as-of dates independent of the live failure catalog's current date and lifecycle.
---

Tests that validate baseline references at a fixed historical `asOf` date should pass a catalog snapshot whose `catalogDate` is not later than that date, and should use a record active at that historical point. Reading the live catalog while pinning `asOf` couples old tests to future catalog updates and lifecycle transitions.

**Why:** The validator rejects catalogs dated after `asOf`, and a record resolved later cannot be used as an active reference even when the test's purpose is to exercise an unrelated ownership rule.

**How to apply:** For date-specific reference tests, clone the catalog into a test fixture, align its date with the fixture's `asOf`, and select a record valid for that point in time. Keep production validation pointed at the real current catalog.