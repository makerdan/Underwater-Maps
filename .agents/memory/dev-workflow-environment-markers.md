---
name: Dev workflow environment markers
description: How to distinguish interactive Replit development from deployment when guarding destructive local utilities.
---

Replit development workflows may inherit `REPLIT_ENVIRONMENT=production`.
Treat the presence of `REPLIT_DEV_DOMAIN` as the authoritative signal that a
process is running in the interactive development workspace before applying
production-refusal guards.

**Why:** A cleanup safety guard that trusted `REPLIT_ENVIRONMENT` alone blocked
every artifact development workflow, even though the commands were running in
the workspace rather than a published deployment.

**How to apply:** For destructive development-only utilities, allow execution
when `REPLIT_DEV_DOMAIN` is present. When it is absent, refuse production
markers such as `NODE_ENV=production`, `REPLIT_DEPLOYMENT=1`, or
`REPLIT_ENVIRONMENT=production`.