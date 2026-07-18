---
name: Playwright addInitScript drops closures
description: Factory-closure init scripts silently lose captured values; pass the value as the second argument instead
---
`page.addInitScript(fn)` serializes only the function SOURCE and re-evaluates it in the page — closure-captured variables arrive as `undefined`. A factory pattern like `addInitScript(makeSeed(true))` therefore runs with `value === undefined`, and because `JSON.stringify` drops `undefined` object values, a localStorage seed built that way writes nothing at all — no error, no trace.

**Why:** this failed silently for a long time in the onboarding e2e specs: seeding `false` worked by accident (undefined ≈ default false), seeding `true` only passed when server hydration happened to win a race, so the bug surfaced as load-dependent flakiness rather than a hard failure.

**How to apply:** always pass dynamic values as the second argument — `page.addInitScript(fnTakingValue, value)` — and keep the function body free of outer references. A factory with no captured variables (literals only in the body) is safe but fragile; prefer the arg form. When an init-script seed "doesn't stick", probe `localStorage` in the page before suspecting store/hydration logic.
