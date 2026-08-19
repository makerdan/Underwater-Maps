---
name: Chunk status is disk-authoritative
description: GET /datasets/upload/chunk/status must return exact disk indexes and never infer indexes from an aggregate DB count.
---

# Chunk status is disk-authoritative

`GET /api/datasets/upload/chunk/status/:uploadId` enumerates exact chunk files on disk. Never synthesize `[0..N-1]` from the DB `chunksReceived` aggregate, including after restart. If files are missing or the directory is inaccessible, return `[]`.

**Why:** an aggregate count cannot prove which out-of-order chunks exist. Synthesizing indexes can make the client skip missing data and then fail or assemble corrupt input.

**How to apply:** use the DB row only for ownership and lifecycle recovery. Use disk enumeration for received indexes; an empty answer intentionally makes the client re-upload safely.
