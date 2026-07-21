---
name: Global-coverage catalog entries break "nothing nearby" e2e paths
description: Seeded discovery catalog contains world-spanning bbox entries; any real point-radius/bbox search always finds results.
---

The seeded discovery catalog includes entries with world-spanning coverage bboxes (GEBCO 2024 global grid, NCEI DEM Global Mosaic — bbox -180/-90/180/90). Any point-radius or bbox catalog search against the live API therefore ALWAYS returns at least one result, no matter how remote the point.

**Why:** follow-handoff "pause toast when nothing is nearby" e2e failed because the catalog fallback found GEBCO everywhere and showed "Survey available nearby" instead of the plain pause toast.

**How to apply:** any test (e2e or integration) that exercises an "empty catalog result" branch must mock `POST /api/datasets/point-radius-query` (or bbox-query) to return `datasets: []`. Filtering the preset dataset list is not enough — the catalog search runs as a separate fallback.
