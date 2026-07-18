---
name: New settings key checklist
description: Every place a new user-settings key must be added, and which test tiers actually catch omissions.
---

# Adding a new settings key

The rule: a new key in the settings OpenAPI spec/PutSettingsBody must be added in ALL of:
1. OpenAPI spec + orval codegen (then typecheck:libs to emit .d.ts).
2. Zod PutSettingsBody schema (via codegen patch).
3. `DEFAULT_SETTINGS` in api-server `routes/settings.ts` — easy to miss.
4. Client settingsStore default.
5. Sentinel/coverage tests.

**Why:** `settings-schema-sync.test.ts` and the me.test.ts default-value test fail if the key is in the schema but missing from DEFAULT_SETTINGS (clients that omit the field would get `undefined` back instead of the documented default).

**How to apply / gotcha:** the `test-settings-validation` workflow (api-server `test:validation`, ~160 tests) does NOT include `me.test.ts` or `settings-schema-sync.test.ts` — it can be green while the full unit suite fails on a missing DEFAULT_SETTINGS entry. Only the full unit run (test-heavy `test:unit`) catches it. Verify solo with:
`cd artifacts/api-server && npx vitest run src/__tests__/me.test.ts src/__tests__/settings-schema-sync.test.ts src/__tests__/settings-coverage-sentinel.test.ts`
