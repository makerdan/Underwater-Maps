---
name: Zustand no-op set skips subscription
description: When set({field: sameValue}) is called, Zustand's subscription doesn't fire — explicit write-through required for mirrored stores.
---

**Rule:** Mirrored store setters must call `targetStore.setState({ field: value })` directly, not rely solely on the subscription-based auto-mirror. Check `_suppressMirror` flag before the explicit call.

**Why:** Zustand's `set()` performs equality checking before notifying subscribers. If the new value equals the old value (e.g. calling `setSidebarMode('explore')` when `sidebarMode` is already `'explore'`), the subscription doesn't fire and the mirror never receives the update. This caused `uiStore.sidebarMode.test.ts` to fail: the test pre-sets `useSettingsStore.setState({sidebarMode: 'analyze'})`, then calls `setSidebarMode('explore')` on a uiStore already at 'explore', expecting settingsStore to sync — but the subscription was silently skipped.

**How to apply:**
- In `setSidebarMode` (and any mirrored setter where write-through matters even on no-op): after `set({field})`, add `if (!_suppressMirror) { useSettingsStore.setState({ field }); }`
- The ordering rule still applies: `set()` first, then `useSettingsStore.setState()` — never setState another store inside a `set(state => ...)` transition
- This pattern is in `artifacts/bathyscan/src/lib/uiStore.ts` `setSidebarMode`
