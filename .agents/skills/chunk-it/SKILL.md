---
name: chunk-it
description: >-
  Design, implement, review, audit, or harden user- or machine-produced file
  uploads in web, mobile, desktop, CLI, embedded, batch, worker, and data
  pipeline projects. Use this skill whenever a request involves large files,
  resumable or chunked transfer, multipart upload, retries, unreliable
  connections, upload security, or file-processing pipelines, whether the
  transport is HTTP, a native SDK, a device link, a filesystem handoff, or
  another mechanism. Do not use it for download-only work or ordinary
  non-upload inputs unless they also transfer untrusted files.
---

# Chunk It

Treat an upload as a distributed, security-sensitive workflow rather than one
transfer call. First inspect the host project and its deployment, then select
the simplest safe protocol. The coordinator, transfer agent, durable storage,
processing workers, and user/operator surface may be separate components or
may run together; do not assume a browser, server, HTTP, object storage, queue,
or human operator exists.

## 1. Discover before designing

Document the following before choosing an architecture:

- **Execution environments:** web, mobile, desktop, CLI, embedded device,
  batch job, worker, data pipeline, or a combination; process lifetime,
  offline behavior, restart points, and local resource limits.
- **Transport:** HTTP, a resumable protocol, RPC, native SDK, custom link,
  removable media, filesystem handoff, or another channel; its framing,
  timeout, ordering, authentication, and retry semantics.
- **Identity and authority:** session, OAuth/OIDC, API token, service identity,
  device identity, tenant, operator approval, or anonymous flow; how ownership,
  authorization, and anti-forgery protections are established.
- **Persistence:** database, filesystem, object storage, content-addressed
  store, or other durable staging; transactions, encryption, retention,
  multipart support, and whether storage events can be authenticated.
- **Topology:** one process or many; scaling, routing, regions, restarts,
  network/proxy limits, worker handoff, and which component is authoritative.
- **Content policy:** maximum size and parts, accepted signatures/types,
  privacy, retention, transformations, previews, export/serving rules, and
  legal or regulatory constraints.
- **Threat model:** attackers, tenants, compromised clients or devices, stolen
  grants, malicious files, resource exhaustion, supply-chain risk, and the
  consequences of partial or incorrect data.

If the available infrastructure cannot durably coordinate sessions, isolate
owners, verify content, and clean up safely, say so plainly. Do not recommend
a secure production upload based on process memory, client claims, or
single-process/local staging unless its routing, failure, and retention limits
are explicit accepted constraints.

## 2. Choose the transfer architecture

Select the simplest option that meets size, reliability, policy, and topology
needs, and record why alternatives were rejected. These are patterns, not
requirements for a particular product:

1. **Coordinator-proxied chunks:** an authorized coordinator streams bounded
   chunks into durable staging. Use when policy enforcement, inspection, or
   portability matters. Never buffer an entire file.
2. **A standard resumable protocol:** use a well-understood protocol when the
   participating agents support its status and offset semantics. Preserve its
   conflict and replay rules; do not invent a superficially compatible variant.
3. **Constrained direct ingest:** a coordinator creates an upload session and
   grants narrowly scoped part operations to durable storage or an ingest
   service. Its multipart state is not a substitute for application ownership,
   the manifest, quota, or processing state.
4. **Durable file/device handoff:** when transfer is by a local path, device
   link, or batch drop, use an authenticated staging boundary, atomic claims,
   and the same manifest and verification rules. A filename or completed copy
   is not proof of ownership or integrity.

For direct or delegated ingest, keep credentials and authority in the
coordinator, not in an untrusted agent. A grant must be short-lived, bound to
one opaque upload and owner, limited to the allowed operation, key, part,
range, and size, and unusable for listing, reading, overwriting another
object, or changing metadata. Verify delegated completion independently;
reconcile reported parts, sizes, and checksums with the application manifest.

## 3. Define a durable upload contract

Issue an opaque upload ID from the authoritative coordinator. Persist an
immutable session manifest before accepting data. It should bind, at minimum:

- owner and tenant or device scope;
- intended object identity or a coordinator-generated staging key;
- declared total size, part size, part count, and content policy;
- creation, expiration, cancellation, and retention deadlines;
- protocol/version and expected whole-file digest when supplied;
- current state and timestamps; and
- durable per-part records: index, exact offset and length, checksum, received
  bytes, storage handle, and verification state.

The manifest is a contract, not a mutable reflection of agent input. Do not
allow later operations to change owner, scope, size, part geometry,
destination, content policy, or expected digest. If requirements change, make
a new session.

Use explicit states such as:

`created → receiving → ready-to-finalize → finalizing → processing →
available`, with terminal `cancelled`, `expired`, `rejected`, and `failed`.

Define which transitions are legal, durable, and retryable. Never infer
received parts from a count: status must return exact verified indexes or
ranges, including holes, manifest geometry, and a safe state. It must not
expose secrets, internal paths, or another owner's data. Advance to
`ready-to-finalize` only after a durable check confirms every expected part is
verified and byte accounting is exact. Guard transitions with current durable
state/version. Terminal states reject new writes, grants, and finalization;
repeated reads or the same idempotent command return the recorded terminal
result without repeating side effects.

### Illustrative operation contract

Adapt the names and transport to the host project; these operation names are
examples, not a requirement to expose HTTP endpoints:

- **start upload:** authenticate, authorize quota, validate intent, and create
  the manifest; return opaque ID, geometry, expiration, and required metadata.
- **get status:** re-check ownership and return exact durable status,
  retryable/terminal state, and next action.
- **write part:** accept only the manifest's index and exact byte range;
  require a checksum. This may be a coordinator call, RPC, SDK operation, or
  narrowly scoped delegated grant.
- **complete:** request atomic finalization after all parts verify; accept an
  idempotency key and no mutable manifest fields.
- **cancel:** atomically stop new writes, revoke authority where applicable,
  and schedule cleanup.

Return stable error classes, not ambiguous prose. Distinguish unauthorized
without revealing existence, invalid range, checksum mismatch, conflicting
retry, expired/cancelled, quota/rate limited, processing rejected, and
temporary storage/worker failure. Include a safe request ID and retry guidance.

## 4. Make transfer correctness explicit

- Protect networked transfer with TLS; use the equivalent authenticated and
  access-controlled channel for local, device, or embedded transfer. Enforce
  hard body, part, total-size, time, and request limits. Reject metadata that
  disagrees with the manifest.
- Validate index, offset, length, final-part rules, and total byte accounting
  in the trusted coordinator. Reject overlap, gaps disguised as completion,
  truncation, and extra bytes.
- Verify each part on arrival and persist its checksum and exact size. At
  finalization, independently verify ordered concatenation, total size, and
  whole-file digest. Client-provided hashes are evidence, not authorization.
- Make retries idempotent. Repeating an identical verified part may return its
  existing result. The same index or range with different bytes is a conflict,
  never a silent replacement.
- Bound agent and coordinator concurrency, backpressure, retry count, memory,
  sockets, worker slots, and storage. Use exponential retry with jitter.
- Treat lost responses as normal: query status, compare the exact durable part
  checksum, and retry only when status does not confirm the part.
- Make finalization an atomic compare-and-transition guarded by a unique
  session ID/version. Concurrent completion calls converge to one result;
  calls during finalization return its durable state.
- Specify restart recovery for death after data write, status write, queue/drop
  handoff, or response. Reconciliation must be safe and repeatable and must
  not assume an in-memory callback ran.

## 5. Finalize, process, and serve or export safely

Do not make raw staged bytes available merely because transfer completed.
Finalization should:

1. claim the session or perform an atomic state transition;
2. verify all expected parts, sizes, checksums, ordering, and whole-file
   integrity;
3. compose/copy into a new immutable quarantine object when needed;
4. record the durable processing job and state before returning its ID;
5. enqueue work transactionally or reconcile an outbox after restart; and
6. return only a durable processing or available result.

Process untrusted content asynchronously in least-privilege, resource-limited
quarantine. Enforce parser time, memory, CPU, recursion, dimensions, and
output limits. Treat archives as hostile: prevent path traversal, symlink
escape, duplicate-name confusion, decompression bombs, excessive nesting, and
expansion beyond quota. Scan for malware or prohibited content where required.
Validate actual signatures rather than names or MIME headers. Scanner/parser
failure must become a clear quarantine or rejection state.

Expose only approved objects through an authorization-checked read, serve, or
export operation, or through carefully scoped read grants. When a browser can
receive content, use content-disposition and content-type policies that
prevent execution where appropriate and never serve user content from an
executable origin. For any consumer, prevent cross-owner key guessing and
cache leakage. Apply encryption in transit and at rest, key separation and
rotation practices, privacy-minimized metadata, redacted structured logs,
audit events, and defined retention/deletion semantics.

## 6. Security and abuse controls

Re-check authentication and owner/tenant authorization on session creation,
status, every part, completion, cancellation, grant issuance, processing
callback, and serve/export. Use opaque IDs and constant-safe not-found or
forbidden behavior. Never trust a client-supplied owner, object key, path,
size, MIME type, or callback. This is the IDOR boundary.

When a browser is involved, add SameSite and CSRF protections appropriate to
the identity model, origin checks, and a deliberate CORS allowlist. Direct
storage CORS must be narrower than “any origin” and expose only necessary
headers. Do not place broad bearer authority in URLs, logs, referrers, or
client storage. For native, CLI, device, and service agents, apply the
equivalent credential storage, channel binding, replay, and revocation rules.

Enforce per-owner/tenant/device quotas before session creation and while bytes
are reserved. Account for abandoned and duplicate sessions. Rate-limit
creation, status polling, part attempts, completion/cancellation, grants, and
processing. Cap concurrent sessions, bytes in flight, part count, and total
retention. Make limits resilient to forged forwarded addresses and distributed
agents. Alert on abuse without leaking private content.

Separate staging and approved namespaces and credentials. A worker must not
write arbitrary keys or read another owner. Restrict service roles, listing,
lifecycle mutation, and metadata mutation. Validate callbacks, webhooks, or
storage events with authenticated, replay-resistant evidence when those
mechanisms exist; never trust an unverified “upload finished” signal.

## 7. Cancellation, expiration, and cleanup

Cancellation must atomically prevent new parts, revoke outstanding authority
where applicable, record who/what cancelled, and be safe to repeat. Expiration
uses a clear authoritative clock and grace policy. Cleanup is race-safe:
claim or version the manifest before deleting parts, and never delete data
belonging to a renewed or newer session. Make deletion idempotent and
reconcile orphaned delegated uploads, staged objects, queue jobs, and durable
rows.

Define retention for incomplete, rejected, quarantined, processed, and deleted
objects. Keep only audit data required by policy. Cleanup metrics should show
age, bytes, failures, retries, and orphan counts, with alerts and a manual
safe-reconciliation path.

## 8. Human-error and automated recovery

When humans operate the flow, show accessible byte-level progress (uploaded
bytes, total bytes, rate or an indeterminate state), announce state changes to
assistive technology, keep controls keyboard reachable, provide visible focus,
and use actionable text. A headless agent still needs machine-readable state,
retry guidance, and durable logs.

Provide retry, pause/cancel, resume, and restart choices where the environment
supports them. Label terminal versus retryable errors and explain whether the
next action is to wait, retry, reselect the same file, or contact an operator.
After reload, sleep, process restart, or reconnect, query durable status rather
than assuming local state. If a file is reselected, compare size and a safe
identity/digest before resuming; never append a different file to an old
session. Disable duplicate submit/complete actions while retaining a safe
status path, and coordinate concurrent agents with durable truth.

Exercise boundary sizes (zero, one byte, exact part, just over a part,
maximum, and maximum plus one), slow/offline links, sleep/restart, lost
responses, expired sessions, changed permissions, malformed files, quota
exhaustion, cancellation during transfer, and refresh/reconnect during
finalization. Preserve an actionable recovery record without exposing
sensitive file data.

## 9. Required response format

When designing or reviewing an upload, separate required decisions from
implementation-specific examples and respond with:

1. **Architecture choice** — selected path, rejected alternatives, and topology
   implications; identify which components are real in this project.
2. **Assumptions and constraints** — environments, transport, identity,
   persistence, limits, content policy, and threat model; mark unknowns.
3. **Upload/session contract** — manifest fields, states/transitions, ranges,
   checksums, idempotency, errors, and status/resume behavior. If HTTP is used,
   endpoint examples may illustrate the contract but are not mandatory.
4. **Validation and error policy** — metadata, byte accounting, integrity,
   retryability, and finalization rules.
5. **Security controls** — identity/ownership, browser-only CSRF/CORS where
   applicable, grants, quotas, rate limits, isolation, parser/archive defenses,
   serving/export, privacy, and logs.
6. **Recovery surface** — human progress/accessibility when applicable, plus
   agent restart, retry, cancellation, reload, sleep, substitution, and
   concurrency behavior.
7. **Cleanup and operations plan** — expiration, races, retention, workers,
   reconciliation, observability, and residual manual operations.
8. **Adversarial test matrix** — cases, expected durable state/result, and
   evidence for each control.
9. **Decision record** — residual risks, owners/mitigations, and any
   infrastructure limitation that prevents a secure production
   recommendation. State that limitation explicitly; never hide it behind a
   mock or fallback.

## 10. Minimum adversarial test matrix

Require tests for:

- another owner/tenant reading, writing, completing, cancelling, or
  serving/exporting an ID; forged IDs, keys, owners, MIME types, sizes,
  indexes, ranges, and URLs;
- missing, overlapping, reordered, duplicated, truncated, oversized, or short
  final parts; checksum mismatch, whole-file mismatch, replay, and conflicting
  idempotent retries;
- delegated-ingest grant scope, expiry, origin, method, object, part, and
  metadata misuse, plus forged callbacks/events, when those mechanisms exist;
- concurrent part retries, concurrent finalization/cancellation/expiry,
  process or device restart at each durable boundary, worker retry, and
  cleanup races;
- quotas, rate limits, concurrent-session caps, slow agents, abandoned
  sessions, storage failure, queue/drop failure, and orphan reconciliation;
- malformed signatures, deceptive MIME/name, malware result, archive traversal,
  symlinks, bombs, parser crashes/resource exhaustion, and unsafe serving/export;
  and
- accessible progress/retry/resume/cancel where applicable, reload/sleep/
  reconnect recovery, file substitution, lost responses, duplicate submission,
  boundary sizes, and multi-agent conflict.

For every case assert both the externally safe response and the durable state,
storage ownership, byte accounting, audit event, and cleanup consequence.