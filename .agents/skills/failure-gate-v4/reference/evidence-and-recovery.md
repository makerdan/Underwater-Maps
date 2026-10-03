# Evidence discovery, lineage, retention, and recovery

Read this for installation, evidence classification/acceptance, backup/restore,
health inspection, retention, or evidence export. These are host contracts,
not supplied commands, databases, backup artifacts, or test results. Map them
to verified project interfaces; do not invent records or use runtime mirrors.
Apply existing authorization and privacy boundaries; this module neither adds
a reviewer service nor authorizes destructive or production operations.

## 1. Publish one evidence index

During implementation/adoption, publish a tracked, sanitized evidence index in
the host's established documentation location. If none exists, propose and
record a descriptive tracked path; no example filename is mandatory.
Link it from the capability manifest and discoverable project instructions
when present and authorized. Keep the index and manifest consistent; the
index points to authoritative stores, not a competing mutable registry.

For each evidence category record:

- verified Project/namespace and authoritative store/interface;
- actual location or safe resource identifier, read/access procedure, and
  responsible role, without credentials or fabricated people;
- schema/format version, relevant immutable record/artifact references, and
  how integrity/freshness is established;
- availability state, last verified observation, applicable retention/backup
  policy, and concrete recovery action where unavailable.

Cover allocator state/backups, namespace/ID/tombstone and consistency records,
task/plan/tier/approval history, raw runs and tested snapshots, baseline catalog
versions/history, classification/corroboration, recovery/health reports,
and validated versus owner-directed closure decisions.
Never assert that an illustrative repository path contains the live store.
Protected stores may live outside the repository; document safe access rather
than committing database binaries or exposing secrets.

## 2. Define and prove allocator recovery

Document backup ownership/role, policy-defined cadence and acceptable recovery
point, consistency/checkpoint method, protected location/access, retention,
last successful backup and restore-test references, and recovery steps.
Record overdue, unverified, or failed backups honestly. Do not claim a backup
exists merely because a schedule or procedure exists.

Before claiming the implemented recovery route ready, perform an authorized
restore exercise in an isolated safe environment using the real backup format
and host transaction semantics. Retain the backup/checkpoint identity, restored
namespace/schema, integrity results, ID/tombstone reconciliation, and actual
test report. Mocks or primitive tests do not prove host restore readiness.
Missing safe authorization/capability blocks that recovery/cutover claim, not
unrelated existing work or explicit owner-directed closure.

Restore allocator state, namespace, committed-ID ledger/tombstones, task/audit
bindings, and transaction consistency as one coherent checkpoint plus verified
recovery records. Reconcile allocations committed after the backup using a
trusted durable ledger/log or equivalent proof; an old counter alone is unsafe.
Never reuse committed IDs or prune tombstones. If missing history prevents
proving non-reuse, keep restored allocation blocked and report the loss.

Fence old writers/replicas before restored allocation resumes. A restored clone
must not silently act as a second allocator in the same namespace. New namespaces
require explicit host migration policy and preserve old bindings/history;
changing a namespace does not repair missing provenance or rewrite old tasks.
Do not revive active permissions, leases, or approved policies from stale backup
flags. Reconcile running work and current approvals/versions, then use the normal
authorized activation/recovery route. Reevaluate catalog expiry against the
current authoritative clock; restoring a backup does not renew expired ignores.
Do not restore production or run unsafe drills under a documentation request.

## 3. Record classification lineage

For each failure classification retain the current task/run/failure identity,
signature and environment, applicable plan/tier/policy/catalog revisions,
actual tested snapshot, direct earlier/comparison-run references, and each
corroborating source's original identity, immutable contents/reference,
relevance, and provenance relationship. Preserve raw results and the assessment
separately. Show why evidence supports ownership, pre-existence, or an ignore.

Independent corroboration is not a count of URLs or files. Identify duplicate
origins/derivations: copied reports, summaries of one run, and multiple views of
one observation count once. Independently verified unchanged relevant inputs
may corroborate under the core contract, but narrative memory/untouched files
alone cannot replace direct earlier-run proof. Unknown independence/applicability
leaves the dependent classification unresolved. No cryptographic or
tamper-evidence claim follows from hashes or local audit files.

## 4. Describe absence precisely

Use distinct semantic states, mapped to host equivalents:
`present`, `never_collected`, `unavailable`, `expired`, `pruned`, `corrupt`,
and `unknown`. Add an observation/reason and responsible recovery role/action;
do not invent successful checks or historical records to fill empty entries.
Availability is separate from an artifact's validation/freshness assessment:
a present report may be stale, and an expired catalog entry may still be
available as historical corroboration but cannot authorize a current ignore.

Optional history, memory, or catalogs remain optional. Their absence does not
block unrelated validation or cause an empty catalog to gain ignore authority.
Only claims that need missing evidence are blocked. A classification lacking
its required direct/corroborating evidence remains unresolved; an owner may
still direct administrative closure without turning that classification into
a pass. No evidence index or health check becomes a new prerequisite for
owner-directed closure beyond its existing identity/run-safety requirements.

## 5. Provide read-only evidence-health inspection

Discover or implement an authorized read-only inspection route covering
broken/inaccessible artifact references, missing reports, namespace/task binding
mismatches, stale authorizations, unresolved leases/runs, expired baselines,
backup/restore policy status, lineage independence, and completion-mode ambiguity.
Use bounded reads and authorized access; no invasive scan, external charge,
production probe, or secret collection is implied.

Publish observed findings with inspected scope, severity, evidence references,
responsible role and next action, and distinguish missing optional history
from a defect. "Not inspected" is not healthy. This route does not write live
registry state, renew ignores, repair corruption, create grants, change status,
kill processes, schedule recurring jobs, or force a restore.
An explicitly requested sanitized report may be written; other repairs require
their applicable authorization and checked transition.

## 6. Retain supporting evidence, not just conclusions

Define retention/access/deletion policies per category and preserve referential
dependencies between classifications/decisions and their supporting artifacts.
Keep permanent committed-ID tombstones. Retain policy/approval/catalog revisions
and owner-closure decision history as needed to interpret records, not just
their current mutable projection.

Before pruning, identify dependent current claims and protected evidence under
the host's retention/legal/privacy policy. Do not delete evidence still needed
for accepted current claims unless a verified equivalent is preserved or the
dependent assessment is explicitly invalidated. Record authorized pruning and
resulting `pruned` state. Historical assessments retain their original outcome
but become unverifiable where supporting evidence was lost; do not rewrite
history as a newly accepted pass. Pruned evidence cannot justify a new ignore,
pre-existing classification, or current verification result.
Do not silently auto-renew expired baselines or remove unresolved repair ownership.

## 7. Export a portable, non-authorizing evidence bundle

Provide a verified export route for a requested task/scope. Include namespace
and exact task identity, plan/tier/policy versions, source/tested snapshot and
environment references, raw statuses, baseline/classification lineage,
corroboration origins, closure mode/decision, unresolved obligations, and
a versioned manifest with artifact identities/digests and any redactions.
Record absent/inaccessible evidence rather than inventing or omitting it silently.

Export only data authorized for the destination. Exclude credentials, secrets,
private unrelated context, and sensitive raw content outside scope. Use sanitized
copies or protected references and mark redacted coverage; do not label an
incomplete/redacted bundle fully self-contained or fully verifiable when it is
not. No third-party transfer is authorized by making an export.

Bundles are audit artifacts, not live database backups or portable authorization.
Import/viewing cannot activate tasks, approve tiers, widen baselines, replace the
allocator, or establish that another environment passed. Verify origin, schema,
namespace, record bindings, relevant environment and evidence on use; untrusted
or incomplete bundles remain non-authoritative. Digests check integrity, not
authenticity against an actor who can rewrite both data and hashes.

## 8. Make completion mode and unresolved work visible

In task/evidence reports and health/export views, visibly separate validated
completion from owner-directed administrative closure and retain the actual
assessment. Show unresolved checks, repairs, missing evidence, relevant owner
decision, and responsible role/next action. Do not collapse both modes into
"passed" or count owner closure toward validation-success metrics.

Owner-directed closure remains governed by
[owner-directed-closure.md](owner-directed-closure.md), without a second
confirmation or passing tests. Reports do not auto-create follow-up tasks,
merge, deploy, or silently discharge responsibility. Exporting or indexing a
decision does not broaden its one-task scope.

## Adoption and acceptance

Implement these capabilities only under authorized host installation/migration
scope, preserving the prior gate until verified cutover. Missing implemented
capabilities block their claimed readiness; listing requirements in a skill
does not install them. Use the acceptance matrix for actual host tests and
record any unavailable checks honestly. Reference cycles are traversed once
per pinned canonical revision; do not invent missing references or recurse
indefinitely.