---
name: validateQuery/Body/Params error.issues requirement
description: All three validate middleware functions crash if mock safeParse returns {success:false} without error.issues — always include it.
---

# validateQuery/Body/Params requires error.issues in mock

## The rule
Any mock `safeParse` that returns a failure result must include `error: { issues: [] }` (at minimum) or `validateQuery`/`validateBody`/`validateParams` will crash with TypeError → 500.

**Why:** All three middleware implementations in `artifacts/api-server/src/middlewares/validateBody.ts` do:
```js
const logIssues = parsed.error.issues.map((i) => ({ path: i.path, code: i.code }));
```
If `parsed.error` is `undefined` or `parsed.error.issues` is missing, this throws TypeError.

## How to apply
When writing or auditing test mocks of `@workspace/api-zod` schemas:
- BAD: `{ success: false }`
- BAD: `{ success: false, error: { message: "noop" } }` (missing `issues`)
- GOOD: `{ success: false, error: { issues: [] } }`
- GOOD: `{ success: false, error: { issues: [], message: "noop" } }`

Also applies to `uuidParse` helper patterns like:
```js
const uuidParse = (key: string) => ({
  safeParse: (p) => v ? { success: true, data: {...} } : { success: false, error: { issues: [] } }
});
```

Files fixed: `catches.test.ts`, `markers.test.ts`, `markers-delete.test.ts` — all under `artifacts/api-server/src/routes/__tests__/`.
