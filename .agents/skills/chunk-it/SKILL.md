---
name: chunk-it
description: >-
  Design, implement, review, audit, or harden user file uploads, especially
  large-file, resumable, chunked, multipart, and direct-to-object-storage
  uploads. Use this skill whenever a request mentions upload resume, retries,
  multipart transfer, chunking, presigned or signed upload URLs, upload
  security, file-processing pipelines, or unreliable browser/network uploads.
  Do not use it for download-only features or ordinary small form inputs unless
  they also upload untrusted files.
---

# Chunk It

Treat an upload as a distributed, security-sensitive workflow rather than a
single HTTP request. This manual is application-neutral: inspect the product
and deployment before selecting a protocol, and do not smuggle in provider
assumptions.

## 1. Discover before designing

First document:

- **Stack:** client, server, framework, protocol support, queues/workers, and
  available transactional storage.
- **Authentication:** session, OAuth/OIDC, API token, service account, or
  anonymous flow; how CSRF and tenant identity are established.
- **Storage:** database, filesystem, object store, multipart support, encryption,
  lifecycle rules, and whether storage events are trustworthy.
- **Topology:** single instance or horizontally scaled; load balancing,
  autoscaling, regions, worker restarts, and network/proxy limits.
- **Content requirements:** maximum size and parts, accepted types, whether
  content must be private, retention, transformations, previews, and legal or
  privacy constraints.
- **Threat model:** attackers, tenants, compromised clients, stolen URLs,
  malicious files, resource exhaustion, and the consequences of partial or
  incorrect data.

If the infrastructure cannot durably coordinate sessions, isolate tenants,
verify content, and clean up safely, say so plainly. Do not recommend a secure
production upload based on process memory, local disk, or client claims alone.
Local staging is not horizontally safe unless single-instance routing and its
failure/retention limits are an explicit, accepted constraint.

## 2. Choose the transfer architecture

Select the simplest option that meets size, reliability, and topology needs,
and record why alternatives were rejected:

1. **Server-proxied chunks:** the server authenticates every operation and
   streams bounded chunks into durable staging. Use when policy enforcement,
   inspection, or uniform portability matters. Never buffer an entire file.
2. **A standard resumable protocol:** use a well-understood protocol when
   clients, proxies, and servers support its status and offset semantics.
   Preserve its conflict and replay rules; do not invent a superficially
   compatible variant.
3. **Provider multipart/direct-to-object storage:** the server creates a
   constrained upload session, grants narrowly scoped part operations, and
   receives completion evidence. The provider's multipart state is not a
   substitute for the application's ownership, manifest, quota, or processing
   state.

For direct storage, keep credentials and authority server-side. A signed grant
must be short-lived, bound to one opaque upload and tenant, limited to the
allowed operation/key/part/range/size, and unusable for listing, reading,
overwriting another object, or changing metadata. Prefer an application
callback or server-side verification before treating a client completion as
final; reconcile provider-reported parts, sizes, and checksums with the
application manifest rather than trusting provider completion evidence alone.

## 3. Define a durable upload contract

Create a server-issued, opaque upload ID. Persist an immutable session manifest
before accepting data. It should bind, at minimum:

- owner and tenant;
- intended object identity or a server-generated staging key;
- declared total size, part size, part count, and allowed content policy;
- creation, expiration, cancellation, and retention deadlines;
- protocol/version and expected whole-file digest when supplied;
- current state and timestamps; and
- per-part durable records: index, exact offset and length, checksum, received
  bytes, storage handle, and verification state.

The manifest is a contract, not a mutable reflection of browser input. Do not
allow later requests to change owner, tenant, size, part geometry, destination,
content policy, or expected digest. If requirements change, create a new
session.

Use explicit states such as:

`created → receiving → ready-to-finalize → finalizing → processing →
available`, with terminal `cancelled`, `expired`, `rejected`, and `failed`.

Define which transitions are legal, durable, and retryable. Never infer
received parts from a count: status must return the exact verified indexes or
ranges, including holes, plus manifest geometry and a safe state. A status
response must not expose secrets, internal paths, or another tenant's data.
Advance `receiving` to `ready-to-finalize` only after a durable check confirms
every expected part is verified and the byte accounting is exact. Guard every
transition with the current durable state/version; terminal states reject new
writes, grants, and finalization, while repeated reads or the same idempotent
command return the recorded terminal result without repeating side effects.

### Suggested API/session contract

Adapt names to the host API, but specify equivalent semantics:

- `POST /uploads`: authenticate, authorize quota, validate intent and create the
  manifest; return opaque ID, geometry, expiration, and required headers.
- `GET /uploads/{id}`: re-check ownership and return exact durable status,
  retryable/terminal state, and next action.
- `PUT/PATCH /uploads/{id}/parts/{index}` or a direct-storage part grant:
  accept only the manifest's index and exact byte range; require a checksum.
- `POST /uploads/{id}/complete`: request atomic finalization after all parts
  verify; accept an idempotency key and no mutable manifest fields.
- `POST /uploads/{id}/cancel`: atomically stop new writes and schedule cleanup.

Return stable error classes, not ambiguous prose. Distinguish unauthorized
(without revealing existence), invalid range, checksum mismatch, conflicting
retry, expired/cancelled, quota/rate limited, processing rejected, and temporary
storage/worker failure. Include a safe request ID and retry guidance; never
tell an attacker which object or owner exists.

## 4. Make transfer correctness explicit

- Require HTTPS/TLS and stream data with hard body, part, total-size, time, and
  request limits. Reject declared metadata that disagrees with the manifest.
- Validate index, offset, length, final-part rules, and total byte accounting
  server-side. Reject overlap, gaps disguised as completion, truncation, and
  extra bytes.
- Verify each part as it arrives and persist its checksum and exact size. At
  finalization, verify ordered concatenation, total size, and the whole-file
  digest independently; client-provided hashes are evidence, not authorization.
- Make retries idempotent. Repeating an identical verified part may return the
  existing result. A same-index or same-range upload with different bytes must
  return a conflict, not silently replace data.
- Use bounded client and server concurrency, backpressure, exponential retry
  with jitter, and a retry cap. Do not let a tab or tenant consume unbounded
  sockets, memory, worker slots, or storage.
- Treat lost responses as normal: query status, compare the exact part checksum,
  and retry only when durable status does not confirm the part.
- Make finalization an atomic compare-and-transition guarded by a unique
  session ID/version. Concurrent complete calls must converge to one result;
  calls during finalization return its durable state, not duplicate objects.
- Make restart recovery explicit: a process may die after data write, status
  write, queue enqueue, or response. Reconciliation must be safe and
  repeatable, with no assumption that an in-memory callback ran.

## 5. Finalize, process, and serve safely

Do not make raw staged bytes available merely because transfer completed.
Finalization should:

1. lock/claim the session or use an atomic state transition;
2. verify all expected parts, sizes, checksums, ordering, and whole-file
   integrity;
3. compose/copy into a new immutable quarantine object when needed;
4. record the durable processing job and state before returning its ID;
5. enqueue work transactionally or reconcile an outbox after restart; and
6. return only a durable processing/available result.

Process untrusted content asynchronously in a least-privilege, resource-limited
quarantine. Enforce parser time, memory, CPU, recursion, dimensions, and output
limits. Treat archives as hostile: prevent path traversal, symlink escape,
duplicate-name confusion, decompression bombs, excessive nesting, and
expansion beyond quota. Run malware/content scanning where required, validate
actual file signatures rather than trusting names or MIME headers, and make
scanner/parser failure a clear quarantine or rejection state.

Serve only approved objects through an authorization-checked download path or
carefully scoped read grants. Use content-disposition and content-type policies
that prevent browser execution where appropriate; never serve user content from
an executable origin. Prevent cross-tenant key guessing and cache leakage.
Apply encryption in transit and at rest, key separation and rotation practices,
privacy-minimized metadata, redacted structured logs, audit events, and defined
retention/deletion semantics.

## 6. Security and abuse controls

Re-check authentication and owner/tenant authorization on session creation,
status, every part, complete, cancel, grant issuance, processing callback, and
serve. Use opaque IDs, constant-safe not-found/forbidden behavior, and never
trust a client-supplied owner, object key, path, size, MIME type, or callback.
This is the IDOR boundary.

For browser requests, use SameSite and CSRF protections appropriate to the
authentication model, origin checks, and a deliberate CORS allowlist. Direct
storage CORS must be narrower than “any origin” and must expose only necessary
headers. Do not place broad bearer authority in URLs, logs, referrers, or
client storage.

Enforce per-user/tenant quotas before session creation and while bytes are
reserved. Account for abandoned and duplicate sessions. Rate-limit session
creation, status polling, part attempts, complete/cancel calls, grants, and
processing; cap concurrent sessions, bytes in flight, part count, and total
retention. Make limits resilient to forged forwarded addresses and distributed
clients. Alert on abuse without leaking private content.

Use separate staging and approved namespaces/credentials. A worker must not
write arbitrary keys or read another tenant. Restrict service roles, bucket
listing, lifecycle mutation, and metadata mutation. Validate webhooks or
storage events with authenticated, replay-resistant evidence; do not trust an
unverified “upload finished” event.

## 7. Cancellation, expiration, and cleanup

Cancellation must atomically prevent new parts, revoke outstanding grants,
record who cancelled, and be safe to repeat. Expiration must have a clear
server clock and grace policy. Cleanup must be race-safe: claim or version the
manifest before deleting parts, and do not delete data belonging to a renewed
or newer session. Make deletion idempotent and reconcile orphaned provider
multipart sessions, staged objects, queue jobs, and database rows.

Define retention for incomplete, rejected, quarantined, processed, and deleted
objects. Keep only the audit data required by policy. Cleanup metrics should
show age, bytes, failures, retries, and orphan counts, with alerts and a
manual safe-reconciliation path.

## 8. Human-error and recovery UX

Show accessible byte-level progress (uploaded bytes, total bytes, rate or
indeterminate state), not just a spinner. Announce state changes to assistive
technology, keep controls keyboard reachable, and provide visible focus and
actionable text.

Provide retry, pause/cancel, resume, and restart choices. Label terminal versus
retryable errors and explain whether the user should wait, retry, reselect the
same file, or contact support. After reload or sleep, query status rather than
assuming local state. If the user reselects a file, compare size and a safe
identity/digest before resuming; never append a different file to an old
session. Disable duplicate submit/finalize actions while retaining a safe
status path, and coordinate concurrent tabs with server truth.

Exercise boundary sizes (zero, one byte, exact part, just over a part, maximum,
and maximum plus one), slow/offline networks, browser sleep, lost responses,
expired sessions, changed permissions, malformed files, quota exhaustion,
cancel during transfer, and refresh during finalization. Preserve an
actionable recovery record without exposing sensitive file data.

## 9. Required response format

When designing or reviewing an upload, respond with:

1. **Architecture choice** — selected path, rejected alternatives, and topology
   implications.
2. **Assumptions and constraints** — stack, auth, storage, limits, content
   policy, and threat model; mark unknowns.
3. **API/session contract** — manifest fields, states/transitions, endpoints,
   ranges, checksums, idempotency, errors, and status/resume behavior.
4. **Validation and error policy** — metadata, byte accounting, integrity,
   retryability, and finalization rules.
5. **Security controls** — auth/tenant checks, CSRF/CORS, grants, quotas,
   rate limits, isolation, parser/archive defenses, serving, privacy, and logs.
6. **UX and recovery plan** — progress, accessibility, retries, cancellation,
   reload/sleep, same-file checks, and concurrent-tab behavior.
7. **Cleanup and operations plan** — expiration, races, retention, workers,
   reconciliation, observability, and residual manual operations.
8. **Adversarial test matrix** — cases, expected durable state/result, and
   evidence for each control.
9. **Decision record** — explicitly list residual risks, their owners/mitigations,
   and any infrastructure limitation that prevents a secure production
   recommendation. Never hide that limitation behind a mock or fallback.

## 10. Minimum adversarial test matrix

Require tests for:

- another user/tenant reading, writing, completing, cancelling, or serving an
  ID; forged IDs, keys, owners, MIME types, sizes, indexes, ranges, and URLs;
- missing, overlapping, reordered, duplicated, truncated, oversized, or
  short final parts; checksum mismatch, whole-file mismatch, replay, and
  conflicting idempotent retries;
- direct-storage grant scope, expiry, origin, method, object, part, and
  metadata misuse, plus forged callbacks/events;
- concurrent part retries, concurrent finalization/cancellation/expiry,
  process restart at each durable boundary, worker retry, and cleanup races;
- quotas, rate limits, concurrent-session caps, slow clients, abandoned
  sessions, storage failure, queue failure, and orphan reconciliation;
- malformed signatures, deceptive MIME/name, malware result, archive traversal,
  symlinks, bombs, parser crashes/resource exhaustion, and unsafe serving; and
- accessible progress/retry/resume/cancel, reload and sleep recovery, file
  substitution, lost responses, duplicate submission, boundary sizes, and
  multi-tab conflict.

For every case assert both the externally safe response and the durable state,
storage ownership, byte accounting, audit event, and cleanup consequence.