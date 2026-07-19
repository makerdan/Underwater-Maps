---
name: GpsImportDialog raw API function vs hook mock
description: GpsImportDialog calls postMarkers/postTrollingPresets directly, not via hook mutateAsync; mock the raw fns too.
---

# GpsImportDialog raw API function vs hook mock

## The rule
`GpsImportDialog` imports `postMarkers` and `postTrollingPresets` directly from `@workspace/api-client-react` (not via `usePostMarkers`/`usePostTrollingPresets` hooks). Tests that only mock the hooks don't intercept the actual mutation calls.

**Why:** The component uses:
```ts
import { postMarkers as postMarkersRaw, postTrollingPresets as postTrollingPresetsRaw } from "@workspace/api-client-react";
```
And calls them in `doImport()` directly. The hook exports are separate symbols — mocking `usePostMarkers` doesn't intercept `postMarkers`.

## How to apply
In any test of `GpsImportDialog`, the `@workspace/api-client-react` mock must include both the hook AND the raw function:
```js
const mutateAsyncMarkers = vi.hoisted(() => vi.fn());
const mutateAsyncPresets = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  usePostMarkers: () => ({ mutateAsync: mutateAsyncMarkers, isPending: false }),
  usePostTrollingPresets: () => ({ mutateAsync: mutateAsyncPresets, isPending: false }),
  postMarkers: mutateAsyncMarkers,          // ← required
  postTrollingPresets: mutateAsyncPresets,  // ← required
  ...
}));
```

Without the raw fn mocks, `postMarkersRaw` is `undefined` → TypeError on first call → import exits immediately → `setIsImporting(false)` → close button never disables.

File: `artifacts/bathyscan/src/__tests__/GpsImportDialog.closeLock.test.tsx`
