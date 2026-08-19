---
name: Upload finalize durable handoff
description: A chunked-upload job ID is pollable only after the complete queued state is durable.
---

# Upload finalize durable handoff

Never include a chunked-upload `jobId` in an in-flight finalize response. The conditional `uploading → queued` transition must persist the complete recovery metadata before the server publishes the ID in memory or returns it to a client.

**Why:** a concurrent finalize can otherwise hand the client an ID whose durable row is still `uploading`, or whose queued write later rolls back. The client switches to polling and becomes stranded on a job that was never safely handed off.

**How to apply:** acquire the in-memory finalize lock before any await; return a retryable response without `jobId` while it is held; make the durable queued transition the single commit point; expose `jobId` only after that commit or after reading an already non-uploading durable row.