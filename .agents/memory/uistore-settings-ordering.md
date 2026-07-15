---
name: uiStore/settingsStore write ordering
description: Rule for cross-store writes in bathyscan frontend Zustand stores
---
Rule: in bathyscan's uiStore, every setter that mirrors a field into settingsStore must commit locally first (`set(...)`) and only then call `useSettingsStore.setState(...)`. Never call another store's setState from inside a `set((state) => ...)` updater callback.

**Why:** cross-store writes mid-transition can interleave badly (settings subscribers observe a half-committed uiStore) — this was the root defect behind the "over-broad subscriptions" re-render task; the hot components already had narrow per-field selectors.

**How to apply:** when adding new mirrored toggles, use `get()` to compute next state, `set()` it, then mirror to settingsStore. Also: don't try regex/sed line-swaps on these action bodies — a mechanical swap corrupted adjacent actions and had to be repaired by hand; edit each block explicitly.
