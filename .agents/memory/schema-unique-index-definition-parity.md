---
name: Schema unique-index definition parity
description: The test DDL guard compares unique-index expressions, not only names.
---

Unique-index parity checks must compare ordered indexed expressions and normalized
partial-index predicates. Drizzle SQL template wrappers and camelCase table
properties need canonicalization, and chained calls must be bounded at the
declaration's top-level comma so a later index's `.where()` cannot be captured.

**Why:** A name-only check can let constraint tests exercise a different
uniqueness rule, while an unbounded parser can report false drift for indexes
that have no predicate.

**How to apply:** When extending the schema-drift parser, add end-to-end
sandbox coverage for both indexed-column and partial-predicate mismatches.