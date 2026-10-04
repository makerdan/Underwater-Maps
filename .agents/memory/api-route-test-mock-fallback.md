---
name: API route test mock fallback
description: Route tests need complete fallback mocks because app.ts mounts every router during module initialization.
---

Route tests that mock shared modules should account for every runtime export
consumed during app initialization and by transitive domain-service imports,
including constants as well as schema and table exports. Wrap stateful
`@workspace/api-zod` and `@workspace/db` overrides in a complete-export
fallback; explicit mocks for other shared modules must also retain required
exports.

**Why:** Route refactors can add transitive imports without changing a test's
local endpoint, so partial mocks may turn a valid request into a generic 500.

**How to apply:** Preserve test-specific stateful behavior, use Proxy fallbacks
where appropriate for evolving generated schema and table surfaces, and keep
static route-import drift checks in the fast validation tier.