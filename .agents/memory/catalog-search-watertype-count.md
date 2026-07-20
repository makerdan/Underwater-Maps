---
name: catalog-search waterType filter count
description: The waterType-freshwater filter test must count freshwater entries dynamically, not with a hardcoded 1.
---

## Rule
The `filters by waterType freshwater` test in `catalog-search.test.ts` uses
`SEEDED_PLUS_FRESHWATER = [...EXTRA_CATALOG_ENTRIES, FRESHWATER_FIXTURE]`.

**Do not assert `results.length === 1`.**  
`EXTRA_CATALOG_ENTRIES` now includes fw-* freshwater entries; the count must be computed:

```ts
const freshwaterInExtra = EXTRA_CATALOG_ENTRIES.filter(e => e.waterType === "freshwater").length;
expect(results.length).toBe(freshwaterInExtra + 1); // +1 for FRESHWATER_FIXTURE
expect(results.some(r => r.id === "test-freshwater-lake")).toBe(true);
```

**Why:** An old comment stated "EXTRA_CATALOG_ENTRIES contains only saltwater entries" — this was true at the time but became stale when the fw-* freshwater lake series was added to the catalog. The hardcoded `length === 1` caused a test failure that was unrelated to the test's actual intent (verifying the filter mechanic).

**How to apply:** Whenever a new freshwater entry is added to catalogSeeder.ts, this test auto-adjusts — no manual update needed. When adding new entries, run `catalog-search.test.ts` in isolation first to catch coverage gaps before test-heavy.
