---
name: Settings sync flush races (onboarding e2e)
description: Two races in useServerSettingsSync that broke onboarding-tour e2e — unserialized PUT flushes and the one-way hasSeenOnboarding apply cancelling intentional resets.
---

# Settings sync flush races

## Rule 1 — flushes must be serialized
An immediate `flushServerSync()` (e.g. onboarding Skip) can race an already-in-flight debounced PUT carrying an OLDER snapshot. Whichever PUT the server processes LAST wins, silently reverting the newer edit. Fix: a module-level promise chain (`_flushChain`) so each flush body runs strictly after the previous settles, plus `_flushInFlight` as a counter (not boolean) so queued flushes keep the "in flight" signal alive for `waitForServerSettingsSync`.

**Why:** server-side last-writer-wins on PUT /api/settings; request start order ≠ completion order.

## Rule 2 — one-way "server seen → force local seen" must not cancel intentional resets
The hydration effect forces `hasSeenOnboarding: true` locally when the server says true (protects seen-users from pre-hydration edits of other settings). But "Replay tour" / "Take the tour" set it false *locally*; if the first GET hydration lands after that click (slow hydration, route remount), the one-way apply reverted the reset and the queued flush then PUT `true`. Fix: gate the apply on first-hydration only AND on `!_onboardingLocallyEdited` (module flag set by the store subscriber whenever hasSeenOnboarding changes outside `_hydrating`).

**How to apply:** any "one-way repair" applied during hydration must check whether the user intentionally edited that exact field this page load.
