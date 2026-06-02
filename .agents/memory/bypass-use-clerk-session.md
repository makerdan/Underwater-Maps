---
name: bypassUseClerk session needs getToken
description: The Clerk bypass mock's session object must implement getToken or ClerkAuthTokenWirer breaks all browser-side API calls.
---

## Rule
`bypassUseClerk()` in `clerkCompat.tsx` must include `getToken: async () => null` on its `session` object.

## Why
`ClerkAuthTokenWirer` in `App.tsx` does:
```js
const { session } = useClerk();
setAuthTokenGetter(session ? () => session.getToken() : null);
```
Because the mock session is truthy (has `id` and `user`), it registers a getter. `customFetch` awaits that getter before every request. Without `getToken`, this throws `TypeError: session.getToken is not a function`, silently killing every browser-side PUT and GET through the API client. The symptom is `waitForServerSettingsSync` timing out after 5 s because `markAllSaved` is never reached.

## How to apply
Any time you add new fields to the `bypassUseClerk` return value or expand the `ClerkAuthTokenWirer` to read additional session methods, ensure the mock session mirrors those methods (returning safe no-ops / null). Returning `null` from `getToken` is correct — `customFetch` only adds an Authorization header when the token is non-null, so the `x-e2e-user-id` fetch-patch continues to handle auth in the bypass path.
