---
name: Full e2e suite — 9 deterministic failures (July 2026)
description: Known failing specs in the full playwright run unrelated to chip/settings work; reproduce solo, likely upstream regression.
---

As of 2026-07-20 the full playwright run (e2e-repro) fails deterministically (both under load and solo, retries included) on 9 tests, with 234 passing:

- find-data-my-uploads: Find Data panel never closes after clicking Load (dataset-load pipeline signal missing)
- follow-handoff: "Follow mode paused" toast never appears on out-of-bounds
- gps-trail + live-mode (3 tests): trail recorder / live-mode UI never reaches expected state
- water-landmass-toggles (3 tests): TOPO badge / topography download never appears
- onboarding-tour overlay is flaky (passes on retry)

**Why:** these all depend on the dataset-load → terrain-ready pipeline; browser console shows repeated "State loaded from storage couldn't be migrated since no migrate function was provided" (panelCollapseStore has `version: 1` with no `migrate`) and settings PUT "Failed to fetch" bursts. Suspected upstream regression (vite 8 bump or lake-catalog/sidebar merges), not chip/settings work — confirmed unrelated by diff surface.

**How to apply:** if e2e-repro fails on exactly these specs, don't burn time re-running; investigate the dataset-load pipeline and the persisted-store migrate warning as a dedicated task. Remove this file once fixed.
