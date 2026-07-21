---
name: Marker library sections
description: Marker symbol library is section-based; pitfalls when adding sections or types
---
The marker library is organized as section arrays (freshwater/saltwater/natural world/mariner/special/legacy) in markerConstants, with MARKER_TYPES as the full union.

**Rules learned:**
- Edit-mode type validity in MarkerForm must check the FULL MARKER_TYPES list, not the picker's selectable subset — otherwise legacy-typed markers silently get rewritten to "custom" on save, and the dirty-check makes CANCEL misbehave.
- Tests that vi.mock markerConstants with only some arrays break with "No export is defined" when components import new section arrays; add the new exports (empty arrays ok) or use importOriginal.
- Cross-layer enum parity tests must derive frontend values from MARKER_TYPES (all sections incl. legacy), not just salt+fresh.

**Why:** legacy types must stay valid on existing markers per product spec; partial mocks are strict in vitest.
