---
name: Settings backup schema checklist
description: Exported settings fields must remain covered by import validation schemas.
---

Every user-facing field included in settings backup exports must also have a matching entry in the import field-schema map, using the same domain validation as the settings store when the field has semantic constraints.

**Why:** A field can be valid in the live store and still be reported as skipped during backup import when export and import coverage drift apart.

**How to apply:** When adding or changing a persisted setting, check DEFAULT_SETTINGS, the export key list, import validation schemas, and round-trip tests together. Internal sync metadata must remain denylisted.