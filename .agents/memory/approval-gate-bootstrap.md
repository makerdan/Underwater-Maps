---
name: Approval gate bootstrap
description: How to distinguish admin configuration from a stored pending account during approval-gate lockouts
---

An account can remain stored as `pending` even after the intended admin identity is configured. The admin allowlist bypass and the `user_access` row are separate mechanisms; when development is locked to the sole owner, verify the row state and approve that known account in development rather than weakening the gate.

**Why:** Adding or correcting the admin allowlist does not retroactively rewrite existing approval records, and development and published deployments use separate environment/database state.

**How to apply:** Check the relevant environment's `user_access` status first. Keep the production approval path and deployment-specific admin secret separate from a development-only bootstrap repair.