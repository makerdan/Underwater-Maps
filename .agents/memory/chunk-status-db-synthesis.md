---
name: chunk-status DB synthesis rule
description: When GET /datasets/upload/chunk/status may synthesise receivedChunks from the DB count vs must return [].
---

# chunk-status DB synthesis rule

`GET /api/datasets/upload/chunk/status/:uploadId` enumerates chunk files on disk (disk-primary). The DB `chunksReceived` count may be used to synthesise `[0..N-1]` **only when the session was just rehydrated from the DB** (in-memory session missing → server restarted). If a live in-memory session exists and the directory is accessible but has no files for this upload, return `[]`.

**Why:** two test suites encode both sides — upload-progress-recovery (restart ⇒ synthesise) and upload-security-regressions L-10a (live session + empty dir ⇒ []). Gating on `chunkDirAccessible` alone breaks the restart case; gating on nothing breaks L-10a. The natural discriminator is "dbChunksReceived is non-null only on the DB-rehydration path".

**How to apply:** keep the synthesis condition keyed off the DB-rehydration variable, not off directory accessibility.
