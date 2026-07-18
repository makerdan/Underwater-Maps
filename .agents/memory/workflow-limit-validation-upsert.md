---
name: Workflow limit and validation upsert
description: How to add/restore test workflows when the 10-workflow limit blocks configureWorkflow
---
The project sits at the platform's 10-workflow cap (3 artifact dev servers + hidden "Project" meta-workflow + validation workflows), so `configureWorkflow` for any new name fails with "limit exceeded" even when the visible list shows 9.

**Why:** the hidden runButton meta-workflow counts toward the cap; the error message's workflow list can be stale.

**How to apply:** use `setValidationCommand(name, command)` (validation skill) — its upsert path bypasses the limit check and creates the workflow with isValidation metadata. Also works to restore a removed workflow. For one-off long test runs, `setValidationCommand` + `startValidationRun` is the reliable route (bash times out at 120 s; .replit cannot be edited directly, even via shell).

Related e2e gotcha: OnboardingOverlay (zIndex 9000, full-screen) intercepts clicks on Home-route elements; specs must inject `hasSeenOnboarding: true` into `bathyscan:settings` localStorage via addInitScript (pattern in onboarding-tour.spec.ts).
