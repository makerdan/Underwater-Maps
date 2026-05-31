---
title: Memory & GPU Leak Audit
---
# Memory & GPU Leak Audit

## What & Why
BathyScan has four known silent accumulation paths that grow with use and eventually degrade performance or crash the tab/server: the `TerrainTextures` singleton can hold unreleased GPU memory across dataset switches; `DataTexture` objects from habitat overlays may not be disposed before the next species is loaded; `/tmp/bathyscan-chunks` chunk directories can grow unbounded if uploads are interrupted; and `parseWorker.ts` threads may leak on error paths. This audit profiles and confirms each path is clean.

## Done looks like
- `TerrainTextures` singleton: switching between two datasets and then back does not increase `renderer.info.memory.textures` (or equivalent GPU memory metric) beyond the baseline; verified with a headless Three.js renderer or a manual profiling run documented in the audit notes.
- `DataTexture` from habitat/species overlays: every `DataTexture` created during an overlay render is `.dispose()`d before the next species is loaded; confirmed by code review and a unit test that asserts `dispose()` is called.
- `/tmp/bathyscan-chunks`: chunk directories are deleted after a successful upload completion AND on server restart (an express `on('close')` or equivalent hook); confirmed by uploading a file and inspecting the filesystem after completion.
- `parseWorker.ts` on error paths: when a worker encounters a parse error, the worker thread is terminated (`.terminate()` called); confirmed by code review and a unit test that injects a malformed file and asserts no lingering worker references.
- Any new leaks found are either fixed inline or tracked as a follow-up task with reproduction steps.

## Out of scope
- CPU profiling or general React rendering performance.
- GPU profiling on non-WebGL render paths.
- Network or disk I/O performance outside the `/tmp` chunk directory.

## Steps
1. **Profile `TerrainTextures` singleton across dataset switches** — Read `TerrainTextures` source; trace every path where a texture is created and confirm a matching `.dispose()` call exists when the dataset changes. Document any path that lacks disposal and fix it.

2. **Audit `DataTexture` lifecycle for habitat overlays** — Search for `new DataTexture` or `new THREE.DataTexture` in the overlay/species rendering code; confirm each creation site has a corresponding `.dispose()` in a cleanup effect or event handler. Add a unit test (Vitest + mocked Three.js) that asserts `dispose()` is called on overlay switch.

3. **Verify `/tmp/bathyscan-chunks` cleanup** — Read the upload completion handler and the server shutdown handler; confirm that the chunk directory is removed in both cases. Test by uploading a multi-chunk file, then checking the filesystem; also confirm a failed/partial upload leaves no orphaned directory after a server restart.

4. **Verify `parseWorker.ts` thread termination on error** — Read the worker management code; confirm `.terminate()` is called on the worker when `onerror` or a structured error message is received. Write a unit test that mocks the worker, sends a parse error response, and asserts `terminate()` is called.

5. **Document findings** — Summarise any leaks found, steps taken to fix them, and metrics before/after (texture count, memory reading, directory listing).

## Relevant files
- `artifacts/bathyscan/src/` — TerrainTextures singleton (search for `TerrainTextures`)
- `artifacts/bathyscan/src/` — habitat/species overlay components (search for `DataTexture`)
- `artifacts/api-server/src/` — upload route and chunk directory management (search for `bathyscan-chunks`)
- `artifacts/api-server/src/parseWorker.ts`
