---
name: terrainStore promote must preserve grids
description: setSinglePrimary/setPrimary re-promoting an already-visible dataset must keep its loaded grids, or Overview Map features silently no-op.
---

Rule: any terrain-store action that (re)promotes a dataset to primary must carry over the existing visible entry's `activeGrid`/`overviewGrid` instead of creating a fresh entry with null grids.

**Why:** `seedTerrain` (e2e helper) and other direct-seed paths set grids, then `useActiveDatasetSync`'s promote effect fires on the datasetId change and called `setSinglePrimary`, which rebuilt the entry with null grids — wiping the seed. The follow-up overview fetch 404s for synthetic datasets, so `overviewGrid` stayed null forever and `OverviewMap.handleMouseUp` silently no-oped (no bbox commit → download popover never appeared). Very hard to spot: no error anywhere.

**How to apply:** when editing `artifacts/bathyscan/src/lib/terrainStore.ts` promotion paths, look up the existing entry first and reuse its grids/source. Also note: a full-screen popover mounted by a drag-release gets the browser-synthesized `click` at the release point — backdrop dismiss handlers must require the mousedown to have started on the backdrop.
