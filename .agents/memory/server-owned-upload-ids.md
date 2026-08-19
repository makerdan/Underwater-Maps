---
name: Server-owned uploadIds in tests
description: Chunked-upload tests must obtain uploadIds from POST /api/datasets/upload/start; client-generated UUIDs are rejected.
---

# Server-owned uploadIds

POST /api/datasets/upload/chunk with chunkIndex=0 requires a session pre-registered by POST /api/datasets/upload/start (serverIssued flag). A client-generated UUID gets `403 upload_not_started`. Chunk 0 is not considered accepted until both its canonical temp file and the durable uploading row exist; later chunks must wait while that registration is pending.

**Why:** server-owned upload IDs close the client-claimed-ID hole. Publishing a session before its durable row commits also creates a race where later chunks can succeed without a recoverable owner.

**How to apply:** in upload helpers, call `/upload/start` with the same auth headers first. When changing chunk-zero persistence, gate status/finalize/later chunks until the row commit succeeds, and remove chunk zero if that commit fails.
