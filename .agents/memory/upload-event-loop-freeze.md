---
name: Sparse-track upload "freeze" was gridder O(N^4), not event loop
description: ~160-240s upload job stalls at 60% for NMEA/GPX/LAZ track uploads were caused by the IDW ring-fill in gridPoints degenerating on sparse collinear points; the server event loop was fine.
---

Uploads of sparse GPS-track data (a dozen collinear NMEA/GPX points) appeared to "freeze the app for minutes." The event loop was NOT blocked — /api/healthz stayed ~100ms throughout. The job hung inside the parse worker's `gridPoints` (terrain.ts) Step 3 IDW ring-fill: with few occupied cells at the default 256 grid resolution, the ring walk never collects K_MIN=8 neighbours early, degenerating to ~O(N^4) cell scans (billions of iterations, deterministic 240s+).

**Fix pattern:** when occupied cells ≤ 8·N, use a direct per-empty-cell scan over the occupied-cell list (K_MIN-th smallest Chebyshev radius as rStop, IDW weights within it) in O(N²·occ); keep the ring walk for dense grids. Regression test: "fills a sparse GPS-track grid at the default 256 resolution in seconds" in api-server gridder tests.

**How to apply:** if an upload job stalls mid-progress for minutes but healthz is fast, suspect algorithmic blowup in the worker (profile the worker, not the server or test code). Beware nearest-neighbour ring/spiral fills on sparse inputs — always bound the search radius by data extent or occupied-cell count.
