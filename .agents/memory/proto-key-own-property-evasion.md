---
name: __proto__ evades own-key checks on plain objects
description: Why key-policy validation of client JSON must use null-prototype objects and an explicit denylist
---

Rule: when copying untrusted JSON keys into an object for policy checks (allowed-key regex, key counting), build the target with `Object.create(null)` and explicitly deny `__proto__`, `constructor`, `prototype`.

**Why:** assigning `obj["__proto__"] = v` on a plain `{}` mutates the prototype instead of creating an own property, so the key silently vanishes from `Object.keys(obj)` and evades any subsequent key-name validation. Also `constructor`/`prototype` match typical identifier regexes like `/^[A-Za-z][A-Za-z0-9_]*$/`, so a regex alone does not block them. Both were caught by regression tests during the settings extras-policy work.

**How to apply:** any route that merges unknown client keys (e.g. PUT /settings extras) — use a null-prototype accumulator + `FORBIDDEN_EXTRA_KEYS` denylist before the regex check.
