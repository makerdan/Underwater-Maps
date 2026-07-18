---
name: Zustand stable-function selector never re-renders
description: Selecting a store method (stable reference) means state changes never trigger re-render; select the underlying data
---
Subscribing to a Zustand store with a selector that returns a *function* defined in the store (e.g. `useStore((s) => s.isDismissed)`) returns a stable reference — it never changes identity, so the component never re-renders when the state the function reads changes. Calling that function during render reads fresh state only on renders caused by something else, producing "works after unrelated interaction" flakiness.

**How to apply:** select the underlying data (e.g. the `dismissedDatasetIds` set/array) and derive in the component, or use a selector returning the computed primitive. Suspect this pattern when a dismiss/toggle visually does nothing until some other state change.
