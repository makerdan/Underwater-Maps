---
name: Server-owned uploadIds in tests
description: Chunked-upload tests must obtain uploadIds from POST /api/datasets/upload/start; client-generated UUIDs are rejected.
---

# Server-owned uploadIds

POST /api/datasets/upload/chunk with chunkIndex=0 requires a session pre-registered by POST /api/datasets/upload/start (serverIssued flag). A client-generated UUID gets `403 upload_not_started`.

**Why:** the "server-owned uploadIds" security change closed the client-claimed-uploadId hole; several older test files still generated uploadIds with crypto.randomUUID() and broke.

**How to apply:** in any upload test helper, call `/upload/start` with the same auth headers first and use the returned `uploadId`. The 403 case itself is covered in upload.test.ts — don't re-test it via stale helpers.
