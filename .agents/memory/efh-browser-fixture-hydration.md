---
name: EFH browser fixture hydration
description: Durable setup constraints for authenticated browser coverage of EFH controls.
---

Bridge-seeded EFH catalog entries are vulnerable to being replaced by the
initial settings and catalog-query hydration cycle. A browser test can have a
correct intercepted response and still not render EFH controls if it seeds
before that cycle settles.

Authenticated EFH browser fixtures also need to expand panel-collapse state;
the overview-map EFH toggle lives in the GPS folder, not the View folder. EFH
polygon queries include selected-species parameters, so cache probes must
match by dataset-key prefix rather than assume an unparameterized exact key.

**Why:** Settings and catalog hydration can replace an early seed; collapsed
controls are inert even when their DOM nodes exist; and UI polygon responses
are stored under species-specific query keys. These conditions previously
looked like unavailable EFH data and were hidden by a skip.

**How to apply:** Wait for authenticated settings and the target catalog query,
then seed the catalog and select the dataset. Expand test panels before
navigation, open the GPS folder for map controls, and inspect EFH cache entries
by dataset prefix. Keep auth/bridge readiness gates, but treat missing EFH
controls after deterministic setup as a regression rather than skipping it.