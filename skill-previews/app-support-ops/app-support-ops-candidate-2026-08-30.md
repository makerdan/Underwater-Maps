# App Support Ops compression preview

## Package identity and approval boundary

- **Candidate label:** `P3 — Complete candidate`
- **Package path:** `skill-previews/app-support-ops/app-support-ops-candidate-2026-08-30.md`
- **Canonical source:** `.agents/skills/app-support-ops/SKILL.md`
- **Baseline label:** `B0 — Baseline`
- **Baseline captured before revision:** yes
- **Baseline identity:** 15,986 bytes, 267 lines; MD5 `511735297d4664332a91119e2def5898`; SHA-256 `615787784544370b682a337b8684eda97f1bd8a16f61ab87f388f84e51f58d9a`
- **Dependency evidence:** Task #4658's confirmation record is present at `.local/tasks/confirm-app-support-ops-skill.md`; the dependency is absent from the current active/proposed task state, and the canonical source it confirmed is readable, tracked, and uniquely identified.
- **Requested scope:** preview-only compression of the canonical instructional text. Frontmatter identity and trigger metadata, resources, evals, scripts, mirrors, validation infrastructure, and application code are protected and unchanged.
- **Mode:** preview; no write to the canonical source is authorized.
- **Recommendation:** `Apply` only after explicit approval of this named candidate and source-versus-baseline revalidation. The candidate passed all required reviews below.

## B0 — Baseline

**Canonical source identity:** `.agents/skills/app-support-ops/SKILL.md`

**Exact capture:** The following fenced block is the complete source snapshot, including frontmatter, instructional text, line breaks, and final newline. It is the immutable comparison reference for every candidate in this package.

````markdown
---
name: App Support Ops
description: >-
  Design, implement, audit, or harden application support operations for
  in-app help, protected administrator analytics, runtime and port safety, and
  development-only backend outage/restart controls. Use this skill whenever a
  request mentions a help center, onboarding or contextual guidance, an
  admin-only analytics surface, port collisions or process cleanup, or a
  development API outage/restart control. Discover the host project's
  capabilities first, select only the requested mode, and remain
  framework-, provider-, deployment-, and artifact-neutral.
---

# App Support Ops

Build only the support capability the user requested. This skill has three
independent modes—**Help**, **Admin Analytics**, and **Runtime Safety**—plus an
explicit **Combined** mode when the user asks for more than one. Do not bundle
the modes merely because the repository could support them.

## 1. Discover the repository and capabilities first

Before proposing or changing code, inspect the repository's structure,
instructions, routes or commands, build and deployment boundaries, and tests.
Identify evidence for each capability below; do not infer it from a familiar
framework or filename.

| Area               | Discover                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Client/UI          | browser, server-rendered, native, terminal, embedded, or no interactive client; routing, layout, responsive and accessibility conventions |
| Server/services    | API or service entry points, service ownership, environment-provided ports, health checks, restart/control hooks, production markers      |
| Identity           | authentication, authorization, roles/capabilities, server-side middleware or service policy, denial semantics                             |
| Data               | persistence, migrations, content/config storage, telemetry events, retention, privacy controls                                            |
| Support surface    | existing help/onboarding/feedback content, search, dialogs, command help, localization, contact configuration                             |
| Analytics          | event schema, consent/privacy rules, page-view instrumentation, aggregation and chart/table components                                    |
| AI                 | an existing server-side AI/provider abstraction, grounding sources, configuration, limits, and relevant installed specialist guidance     |
| Validation/runtime | test runners, test-port allocation, process cleanup, locks, workflows, artifact boundaries, and hardcoded-port checks                     |

Record a small capability matrix: **present**, **absent**, **unclear**, or
**not applicable**, with the evidence used. Resolve unclear items by reading
the relevant source; never invent a database, chart library, auth provider,
AI model, browser, service, or restart mechanism. A requested mode whose
prerequisites are absent must be reported as unavailable or not applicable,
with the safe partial outcome and any user decision needed.

Choose the mode from the request:

- **Help only:** content, guidance, Q&A, feedback, and support UX.
- **Admin Analytics only:** protected operational/product analytics and its
  instrumentation.
- **Runtime Safety only:** ports, process/test hygiene, and eligible
  development outage controls.
- **Combined:** perform each explicitly requested mode as a separate workstream,
  sharing discovery and validation but not silently adding another mode.

Use the host project's native approach and conventions. Read an installed
specialist skill only when its subject is actually in scope. In particular,
for runtime work read
`.agents/skills/Port-Authority/SKILL.md` and, only when its stated heavy-project
gate applies, `.agents/skills/Port-Authority-Heavy/SKILL.md`; for a server-side
AI help surface read `.agents/skills/poe-setup/SKILL.md` only if it is the
relevant provider guidance. Do not copy a specialist's product, provider, or
framework assumptions into this skill or the host project.

## 2. Shared boundaries

- Keep authorization, secrets, persistence, telemetry, and service control at
  the narrowest native boundary that can enforce them. A client hint is never
  an authorization decision.
- Preserve existing route, error, content, accessibility, and test contracts
  unless the request explicitly changes them. Prefer an adapter around existing
  systems to a parallel implementation.
- Treat user-authored content, telemetry values, AI output, and query
  parameters as untrusted. Validate, bound, escape, and redact as appropriate.
- Do not add invented branding, routes, contacts, roles, environment variables,
  providers, credentials, or infrastructure. Use project configuration or stop
  and ask for the missing value.
- Keep optional features optional. A repository without a UI, server, database,
  AI, multiple services, or a controllable development process can still use
  the applicable subset; say what was skipped and why.
- Tests must prove both the enabled path and the capability gate. Do not use a
  mock that hides whether the real authorization, environment, or process
  boundary is enforced.

## 3. Help mode

Design a maintainable support system for the interfaces the repository
actually has. Use structured content records or the host's equivalent rather
than scattering long help strings through components or commands. A content
record should have a stable key, title, body, feature/workflow context,
audience or availability metadata when needed, and a revision/source marker.
Keep content versionable, searchable where useful, and safe to render. Do not
claim a feature exists unless repository evidence supports it.

Cover, where applicable:

1. **First-time guidance:** orient a new user to the main task, essential
   controls, and next step without blocking repeat users. Persist dismissal or
   completion through the host's existing user/settings mechanism, with a
   reset or revisit path.
2. **Feature and workflow examples:** explain concrete tasks in the product's
   actual vocabulary, prerequisites, expected result, recovery path, and
   relevant limitations. Prefer short contextual help plus a deeper article or
   command reference.
3. **Grounded Q&A:** if a server-side AI capability exists, make answers
   app-only and grounded in approved current help/product sources and the
   user's available context. Do not expose provider credentials or let the
   model invent routes, capabilities, policy, or support contacts. Validate
   output, bound requests, handle unavailable/unsafe answers clearly, and
   preserve the provider's server-side auth, timeout, rate-limit, telemetry,
   and error policies. If no AI exists, provide search/static guidance or
   report Q&A as unavailable rather than adding a speculative provider.
4. **Feedback:** use the project's configured support contact or feedback
   channel. Never invent an email address, webhook, or external destination;
   if none is configured, leave a clear configuration gap and provide a
   local/non-delivery fallback only when the host supports one.
5. **Interaction:** when the host has an overlay or floating help surface,
   support draggable, minimize, and close behavior without trapping content or
   losing the user's place. If the host has no such UI, use its native
   equivalent (for example command help or a dedicated page) and do not
   introduce pointer-only chrome.
6. **Device and input adaptation:** make the same guidance usable on small
   screens, touch, keyboard, assistive technology, and non-pointer inputs.
   Avoid hover-only instructions. Preserve focus, provide an intentional
   keyboard close/minimize path, use semantic headings and controls, expose
   state changes to assistive technology, and meet the host's established
   contrast, motion, zoom, and reduced-motion conventions.

Test content rendering/escaping, first-time versus returning state, search or
Q&A grounding, contact configuration, dismissal/revisit, keyboard and screen
reader semantics where a UI exists, responsive/touch behavior, and the
no-AI/no-browser fallback. Do not test a browser-only outcome in an API-only
or command-line project.

## 4. Admin Analytics mode

First establish what analytics are requested and which actor is allowed to
see them. Keep the capability check server- or service-authoritative for every
data read, export, aggregation, and mutation. A client-side
admin flag, hidden route, or exposed administrator identifier is not a
security control.

Apply these rules:

- Use the host application's existing authorization policy and role/capability
  source. Deny by default and re-check authorization at the data boundary.
- Match each interface's established semantics. If an interactive UI exists,
  use indistinguishable UI not-found behavior for an unauthorized admin-only
  page when that is the host's privacy convention; if an API exists, return
  its documented authorization response (normally 403 for an authenticated
  but unauthorized caller), without leaking whether protected records exist.
  Do not force UI not-found behavior onto an API that has a different contract,
  or vice versa.
- Never send admin IDs, role lists, secrets, raw access tokens, privileged
  query details, or unaggregated private records to a client that does not
  need them. Avoid putting them in URLs, bundles, logs, analytics payloads, or
  error messages.
- Collect only the minimum privacy-safe events needed for the stated purpose.
  Prefer coarse, purpose-limited dimensions and aggregate data. Do not record
  full URLs with secrets, free-form sensitive text, raw IP addresses, or
  unnecessary identifiers.
- If a pseudonymous visitor identifier is necessary, derive it server-side
  with a server-held keyed construction, rotate or scope it as appropriate,
  bound retention, and document access/deletion behavior. Plain or unsalted
  hashing of IP addresses is not sufficient privacy protection.
- Make page-view and supporting telemetry non-blocking: instrument after the
  user-visible operation or enqueue it through the existing bounded mechanism.
  Telemetry failure must not fail navigation, help, analytics loading, or
  authorization. Bound retries and avoid duplicate events on rerender/reload
  using the host's established lifecycle.
- Use the native persistence/query and chart/table mechanisms. Apply
  aggregation, time-range limits, pagination, export restrictions, and
  retention before rendering or returning data. Do not add charts if the host
  has no suitable presentation surface; a safe table or report may be the
  correct result.

Test authorized access, anonymous access, unauthorized access, direct API
access, stale sessions, identifier/secret non-disclosure, aggregation and
retention boundaries, export scope, duplicate page views, and telemetry
failure isolation. Verify both the UI denial semantics and API denial
semantics only when both interfaces exist.

## 5. Runtime Safety mode

Apply the runtime specialist's full audit when it is relevant, then adapt its
implementation to the host project. The minimum contract for a project with
network services is:

1. **Environment-owned ports:** every service reads its listen port from the
   environment or platform-provided service configuration. Do a repository-wide
   hardcoded-port scan covering server entry points, client dev servers, test
   URLs, scripts, workflow commands, and documentation that is executable or
   treated as configuration. Ignore examples only when the scanner explicitly
   distinguishes them.
2. **Regression fixture:** the port scan must be tested against a synthetic
   failing fixture containing a representative hardcoded bind or URL and must
   reject it; also test a valid environment-driven fixture. Do not weaken the
   production scan to make the fixture pass.
3. **Canonical test-port allocation:** use the project's one documented
   allocator/registry or an ephemeral reservation strategy for parallel tests.
   Make ownership, readiness, collision handling, cleanup, and artifact-base or
   service routing explicit. Never select a convenient fixed port in an
   individual test without proving it is the canonical allocation path.
4. **Safe cleanup:** use the native process/workflow control or a dedicated
   cleanup utility that discovers the exact holder, exempts its own process
   tree, terminates gracefully before escalation, cleans supervising wrappers,
   confirms the port is free, and logs forced takeover. Guard cleanup against
   recursion and production execution. Never rely on process names alone or
   indiscriminate process killing.
5. **Repeatable validation:** exercise the relevant validation command twice
   without manual port clearing or process killing between runs. Preserve
   lock/reentrancy, stale-holder, timeout, and failed-child cleanup behavior
   where the project has serialized tests or generated/shared resources.

For projects without network services, mark port and process checks not
applicable; still use the host's safe test lifecycle for any local workers or
commands. For single-service projects, do not invent multi-service orchestration.

### Development-only outage/restart surface

Add this only when all three gates are proven:

- an interactive client exists that benefits from the control;
- a controllable development server/process and safe restart mechanism exist;
- the project can prove the control is absent or inert in production.

Keep the control development-only at both boundaries. At build time, prove
production bundles/routes do not contain or expose it, and that production
configuration cannot enable it. At the server boundary, gate the route or
command using a trustworthy environment/build mode check before any state
change, and return the host's normal not-found/unsupported response outside
development. Do not trust a client-supplied mode flag. Require authorization
appropriate to the development environment, protect against CSRF or equivalent
cross-site invocation where relevant, rate-limit repeated restarts, and make
the action explicit and recoverable.

The outage simulation should exercise the real client-to-development-server
failure state and a safe restart/reconnect path, not merely flip a client
boolean. If there is no interactive client or no controllable development
server, report the surface as not applicable and do not add it.

Test environment gating at build and server boundaries, unauthorized/direct
invocation, restart idempotence, concurrent requests, process cleanup,
readiness/health behavior, client recovery, and production exclusion. Do not
run destructive restart tests against a production service.

## 6. Combined mode and delivery

For an explicitly combined request, keep Help, Admin Analytics, and Runtime
Safety as separate workstreams with separate capability gates and tests.
Share only genuinely shared adapters (for example auth or telemetry) and
preserve each mode's boundary. State which requested modes were implemented,
skipped, unavailable, or not applicable, and why.

Before declaring completion, report:

1. discovered capabilities and evidence;
2. selected mode(s) and any deliberately unselected modes;
3. changed surfaces and native adapters used;
4. authorization, privacy, accessibility, production, and process-safety
   decisions;
5. tests and negative-path coverage, including unavailable-capability tests;
6. configuration gaps or user decisions required; and
7. any relevant specialist handoff, including why it applied.

Never claim an operation is protected, private, accessible, or production-safe
unless the corresponding boundary was actually verified.

````

## P3 — Complete candidate

````markdown
---
name: App Support Ops
description: >-
  Design, implement, audit, or harden application support operations for
  in-app help, protected administrator analytics, runtime and port safety, and
  development-only backend outage/restart controls. Use this skill whenever a
  request mentions a help center, onboarding or contextual guidance, an
  admin-only analytics surface, port collisions or process cleanup, or a
  development API outage/restart control. Discover the host project's
  capabilities first, select only the requested mode, and remain
  framework-, provider-, deployment-, and artifact-neutral.
---

# App Support Ops

Build only the support capability the user requested. This skill has three
independent modes—**Help**, **Admin Analytics**, and **Runtime Safety**—plus an
explicit **Combined** mode when the user asks for more than one. Do not bundle
the modes merely because the repository could support them.

## 1. Discover the repository and capabilities first

Before proposing or changing code, inspect the repository's structure,
instructions, routes or commands, build and deployment boundaries, and tests.
Identify evidence for each capability below; do not infer it from a familiar
framework or filename.

| Area | Discover |
|---|---|
| Client/UI | browser, server-rendered, native, terminal, embedded, or no interactive client; routing, layout, responsive and accessibility conventions |
| Server/services | API or service entry points, service ownership, environment-provided ports, health checks, restart/control hooks, production markers |
| Identity | authentication, authorization, roles/capabilities, server-side middleware or service policy, denial semantics |
| Data | persistence, migrations, content/config storage, telemetry events, retention, privacy controls |
| Support surface | existing help/onboarding/feedback content, search, dialogs, command help, localization, contact configuration |
| Analytics | event schema, consent/privacy rules, page-view instrumentation, aggregation and chart/table components |
| AI | existing server-side AI/provider abstraction, grounding sources, configuration, limits, and relevant installed specialist guidance |
| Validation/runtime | test runners, test-port allocation, process cleanup, locks, workflows, artifact boundaries, and hardcoded-port checks |

Record a capability matrix: **present**, **absent**, **unclear**, or **not
applicable**, with evidence. Resolve unclear items by reading the relevant
source; never invent a database, chart library, auth provider, AI model,
browser, service, or restart mechanism. If a requested mode lacks prerequisites,
report it unavailable or not applicable, with the safe partial outcome and any
user decision needed.

Choose the mode from the request:

- **Help only:** content, guidance, Q&A, feedback, and support UX.
- **Admin Analytics only:** protected operational/product analytics and its
  instrumentation.
- **Runtime Safety only:** ports, process/test hygiene, and eligible
  development outage controls.
- **Combined:** perform each explicitly requested mode as a separate workstream,
  sharing discovery and validation but not silently adding another mode.

Use the host project's native approach and conventions. Read an installed
specialist skill only when its subject is in scope: for runtime work read
`.agents/skills/Port-Authority/SKILL.md` and, only when its stated heavy-project
gate applies, `.agents/skills/Port-Authority-Heavy/SKILL.md`; for a server-side
AI help surface read `.agents/skills/poe-setup/SKILL.md` only if it is the
relevant provider guidance. Do not copy a specialist's product, provider, or
framework assumptions into this skill or the host project.

## 2. Shared boundaries

- Keep authorization, secrets, persistence, telemetry, and service control at
  the narrowest native boundary that can enforce them. A client hint is never
  an authorization decision.
- Preserve existing route, error, content, accessibility, and test contracts
  unless the request explicitly changes them. Prefer an adapter around existing
  systems to a parallel implementation.
- Treat user-authored content, telemetry values, AI output, and query parameters
  as untrusted: validate, bound, escape, and redact as appropriate.
- Do not add invented branding, routes, contacts, roles, environment variables,
  providers, credentials, or infrastructure. Use project configuration or stop
  and ask for the missing value.
- Keep optional features optional. A repository without a UI, server, database,
  AI, multiple services, or a controllable development process can still use
  the applicable subset; say what was skipped and why.
- Tests must prove both the enabled path and the capability gate. Do not use a
  mock that hides whether the real authorization, environment, or process
  boundary is enforced.

## 3. Help mode

Design a maintainable support system for the interfaces the repository actually
has. Use structured content records or the host's equivalent instead of
scattering long help strings through components or commands. A record has a
stable key, title, body, feature/workflow context, audience or availability
metadata when needed, and a revision/source marker. Keep content versionable,
searchable where useful, and safe to render; do not claim an unsupported feature.

Cover, where applicable:

1. **First-time guidance:** orient a new user to the main task, essential
   controls, and next step without blocking repeat users. Persist dismissal or
   completion through the existing user/settings mechanism, with a reset or
   revisit path.
2. **Feature and workflow examples:** explain concrete tasks in the product's
   vocabulary, prerequisites, expected result, recovery path, and limitations.
   Prefer short contextual help plus a deeper article or command reference.
3. **Grounded Q&A:** when server-side AI exists, keep answers app-only and
   grounded in approved current help/product sources and available user context.
   Do not expose provider credentials or let the model invent routes,
   capabilities, policy, or contacts. Validate and bound requests and output,
   handle unavailable/unsafe answers clearly, and preserve server-side auth,
   timeout, rate-limit, telemetry, and error policies. Without AI, use
   search/static guidance or report Q&A unavailable; do not add a speculative
   provider.
4. **Feedback:** use the configured support contact or feedback channel. Never
   invent an email, webhook, or external destination. If none is configured,
   state the configuration gap and provide a local/non-delivery fallback only
   when the host supports one.
5. **Interaction:** for an overlay or floating help surface, support draggable,
   minimize, and close behavior without trapping content or losing the user's
   place. Otherwise use the native equivalent (such as command help or a page)
   and do not introduce pointer-only chrome.
6. **Device and input adaptation:** make guidance usable on small screens,
   touch, keyboard, assistive technology, and non-pointer inputs. Avoid
   hover-only instructions; preserve focus; provide intentional keyboard
   close/minimize; use semantic headings/controls; expose state changes to
   assistive technology; and follow established contrast, motion, zoom, and
   reduced-motion conventions.

Test rendering/escaping, first-time versus returning state, search or Q&A
grounding, contact configuration, dismissal/revisit, keyboard and screen-reader
semantics where UI exists, responsive/touch behavior, and the no-AI/no-browser
fallback. Do not test a browser-only outcome in an API-only or command-line
project.

## 4. Admin Analytics mode

Establish the requested analytics and the actor allowed to see them. Keep the
capability check server- or service-authoritative for every read, export,
aggregation, and mutation. A client admin flag, hidden route, or exposed
administrator identifier is not a security control.

- Use the existing authorization policy and role/capability source. Deny by
  default and re-check authorization at the data boundary.
- Match established interface semantics. For an interactive UI, use
  indistinguishable UI not-found behavior for an unauthorized admin-only page
  when that is the host's privacy convention. For an API, return its documented
  authorization response (normally 403 for an authenticated but unauthorized
  caller) without revealing protected-record existence. Never impose UI
  not-found semantics on an API with another contract, or vice versa.
- Never send admin IDs, role lists, secrets, raw access tokens, privileged query
  details, or unaggregated private records to an unnecessary client. Keep them
  out of URLs, bundles, logs, analytics payloads, and errors.
- Collect only minimum privacy-safe events for the stated purpose. Prefer coarse,
  purpose-limited dimensions and aggregation; do not record full URLs with
  secrets, free-form sensitive text, raw IPs, or unnecessary identifiers.
- If a pseudonymous visitor ID is necessary, derive it server-side with a
  server-held keyed construction, rotate or scope it as appropriate, bound
  retention, and document access/deletion. Plain or unsalted IP hashing is not
  sufficient privacy protection.
- Make page-view and supporting telemetry non-blocking: instrument after the
  user-visible operation or enqueue through the existing bounded mechanism.
  Telemetry failure must not fail navigation, help, analytics loading, or
  authorization. Bound retries and avoid duplicate events on rerender/reload
  using the established lifecycle.
- Use native persistence/query and chart/table mechanisms. Apply aggregation,
  time-range limits, pagination, export restrictions, and retention before
  rendering or returning data. Without a suitable chart surface, use a safe
  table or report instead of adding charts.

Test authorized, anonymous, unauthorized, direct-API, and stale-session access;
identifier/secret non-disclosure; aggregation, retention, and export limits;
duplicate page views; and telemetry-failure isolation. Verify UI and API denial
semantics when both interfaces exist.

## 5. Runtime Safety mode

Apply the runtime specialist's full audit when relevant, then adapt it to the
host project. For network services, the minimum contract is:

1. **Environment-owned ports:** every service reads its listen port from
   environment/platform service configuration. Repository-wide, scan server
   entry points, client dev servers, test URLs, scripts, workflow commands, and
   executable/configuration documentation for hardcoded ports. Ignore examples
   only when the scanner explicitly distinguishes them.
2. **Regression fixture:** test the scan with a synthetic failing fixture
   containing a representative hardcoded bind or URL and reject it; also test a
   valid environment-driven fixture. Do not weaken the production scan.
3. **Canonical test-port allocation:** use the documented allocator/registry or
   an ephemeral reservation strategy for parallel tests. Make ownership,
   readiness, collision handling, cleanup, and artifact-base/service routing
   explicit. Never choose a convenient fixed port without proving it is the
   canonical path.
4. **Safe cleanup:** use native process/workflow control or a dedicated utility
   that discovers the exact holder, exempts its own tree, terminates gracefully
   before escalation, cleans supervising wrappers, confirms the port is free,
   and logs forced takeover. Guard against recursion and production execution;
   never rely on process names alone or kill indiscriminately.
5. **Repeatable validation:** exercise relevant validation twice without manual
   port clearing or killing. Preserve lock/reentrancy, stale-holder, timeout,
   and failed-child cleanup behavior where tests or generated/shared resources
   are serialized.

Without network services, mark port/process checks not applicable but use the
host's safe lifecycle for local workers/commands. For a single-service project,
do not invent multi-service orchestration.

### Development-only outage/restart surface

Add this only when all three gates are proven: an interactive client benefits
from it; a controllable development server/process and safe restart mechanism
exist; and the control can be proven absent or inert in production.

Keep it development-only at both boundaries. At build time, prove production
bundles/routes neither contain nor expose it and production configuration cannot
enable it. At the server boundary, gate the route/command with a trustworthy
environment/build-mode check before any state change and return the host's normal
not-found/unsupported response outside development. Never trust a client mode
flag. Require appropriate development authorization, CSRF or equivalent
cross-site protection where relevant, rate-limit repeated restarts, and make the
action explicit and recoverable.

Exercise the real client-to-development-server failure state and safe
restart/reconnect path, not a client boolean. If there is no interactive client
or controllable development server, report the surface not applicable and do
not add it.

Test build and server environment gating, unauthorized/direct invocation,
restart idempotence, concurrent requests, process cleanup, readiness/health,
client recovery, and production exclusion. Never run destructive restart tests
against production.

## 6. Combined mode and delivery

For an explicitly combined request, keep Help, Admin Analytics, and Runtime
Safety as separate workstreams with separate capability gates and tests. Share
only genuinely shared adapters (such as auth or telemetry) and preserve each
mode's boundary. State which requested modes were implemented, skipped,
unavailable, or not applicable, and why.

Before completion, report:

1. discovered capabilities and evidence;
2. selected modes and deliberately unselected modes;
3. changed surfaces and native adapters;
4. authorization, privacy, accessibility, production, and process-safety
   decisions;
5. tests and negative-path coverage, including unavailable-capability tests;
6. configuration gaps or user decisions required; and
7. relevant specialist handoff and why it applied.

Never claim an operation is protected, private, accessible, or production-safe
unless the corresponding boundary was actually verified.
````

## Invariant ledger

### Requested scope and protected surfaces

The default scope is instructional text only. Frontmatter, the `App Support
Ops` identity, trigger description, referenced specialist paths, evals,
resources, scripts, mirrors, and executable application behavior are protected.
The preview changes no authoritative or runtime file.

| Ledger area | B0 invariant | P3 status |
|---|---|---|
| Triggers | Help, protected admin analytics, runtime/port safety, and development-only outage/restart requests invoke this skill; unrelated support work does not silently add modes. | Explicitly retained in unchanged frontmatter and mode-selection rules. |
| Requirements | Discover before code; use evidence; use native adapters; deliver only requested capability; report missing prerequisites and decisions. | Retained, with duplicated wording consolidated. |
| Workflow order/counts | Discovery and capability matrix precede mode selection and implementation; Combined keeps separate workstreams; delivery report has seven required categories. | Retained in order and count. |
| Safety/authorization | Server/service boundaries enforce auth; client hints never authorize; secrets and private data stay out of clients; development controls are gated at build and server boundaries. | Retained with force unchanged. |
| Inputs | Repository structure, instructions, routes/commands, build/deployment boundaries, tests, and evidence for eight discovery areas; user-requested mode. | Retained; “evidence” and “unclear” resolution remain explicit. |
| Outputs | Capability matrix, safe partial/unavailable outcome, selected workstreams, tests, negative paths, gaps, decisions, and specialist handoff. | Retained; completion report remains seven items. |
| Exceptions | Absent UI/server/database/AI/multiple services/process; no-AI/no-browser; no network service; single service; no interactive client or controllable dev server. | Retained as explicit not-applicable branches. |
| Escalation | Do not invent values or infrastructure; stop and ask for missing configuration; do not add speculative AI or outage surface. | Retained. |
| Tool/file constraints | Native project approach; conditional specialist reading; no copied specialist assumptions; no fixed ports; no indiscriminate process killing. | Retained. |
| Help semantics | Structured/versionable/safe content; first-time persistence and revisit; grounded app-only Q&A; configured feedback; interaction/input/accessibility adaptation; relevant tests. | Retained as six numbered areas and test list. |
| Analytics semantics | Authoritative deny-by-default checks; UI/API denial contracts; privacy-minimized aggregation and identifiers; non-blocking telemetry; retention/export boundaries. | Retained as seven rules and test list. |
| Runtime semantics | Environment ports; failing and valid fixtures; canonical allocation; safe cleanup; repeatable validation; production-safe dev outage gates. | Retained as five rules plus outage subsection and tests. |
| Protected metadata | Frontmatter structure/name/description and skill title are unchanged. | Confirmed unchanged. |
| Domain terms | Help, Admin Analytics, Runtime Safety, Combined, capability matrix, native boundary, grounded Q&A, server-held keyed construction, canonical allocator, development-only. | Retained; no generic replacements weaken precision. |

No contradiction was found in B0. The only compression risk was that combining
conditional branches could make a capability appear universal; P3 preserves
the explicit “where applicable,” unavailable/not-applicable, interface-specific,
and production-gating conditions.

## Brainstorm-and-iterate Round 1 — C1

**Comparison:** B0 versus C1, complete snapshots.

**Applied opportunities:**

- Consolidate repeated “host project's existing/native” wording while keeping
  the adapter and no-invention boundaries explicit.
- Convert repeated explanatory prose into compact rule lists where each rule
  still has an observable condition and outcome.
- Keep the discovery table, six Help areas, seven Admin Analytics rules, five
  Runtime Safety rules, three outage gates, and seven delivery-report items
  visibly countable.
- Preserve conditional language for absent capabilities and specialist skills.

**Rejected alternatives:**

- Remove the discovery table and say “inspect the repository” — rejected because
  the eight capability areas and evidence requirement would become less
  reviewable.
- Fold Help, Analytics, and Runtime into one generic “support” section — rejected
  because independent modes and capability gates would be lost.
- Replace privacy and process details with “follow best practices” — rejected
  because authorization, identifier protection, telemetry isolation, and cleanup
  would become inferential.

**C1 result:** Candidate retained for the independent challenge round. Every B0
ledger area remained represented; no source file was edited.

### C1 — Complete candidate snapshot

C1 is the first complete compressed snapshot. It is retained in full so every later no-op can reference immutable text rather than a narrative summary.

````markdown
---
name: App Support Ops
description: >-
  Design, implement, audit, or harden application support operations for
  in-app help, protected administrator analytics, runtime and port safety, and
  development-only backend outage/restart controls. Use this skill whenever a
  request mentions a help center, onboarding or contextual guidance, an
  admin-only analytics surface, port collisions or process cleanup, or a
  development API outage/restart control. Discover the host project's
  capabilities first, select only the requested mode, and remain
  framework-, provider-, deployment-, and artifact-neutral.
---

# App Support Ops

Build only the support capability the user requested. This skill has three
independent modes—**Help**, **Admin Analytics**, and **Runtime Safety**—plus an
explicit **Combined** mode when the user asks for more than one. Do not bundle
the modes merely because the repository could support them.

## 1. Discover the repository and capabilities first

Before proposing or changing code, inspect the repository's structure,
instructions, routes or commands, build and deployment boundaries, and tests.
Identify evidence for each capability below; do not infer it from a familiar
framework or filename.

| Area | Discover |
|---|---|
| Client/UI | browser, server-rendered, native, terminal, embedded, or no interactive client; routing, layout, responsive and accessibility conventions |
| Server/services | API or service entry points, service ownership, environment-provided ports, health checks, restart/control hooks, production markers |
| Identity | authentication, authorization, roles/capabilities, server-side middleware or service policy, denial semantics |
| Data | persistence, migrations, content/config storage, telemetry events, retention, privacy controls |
| Support surface | existing help/onboarding/feedback content, search, dialogs, command help, localization, contact configuration |
| Analytics | event schema, consent/privacy rules, page-view instrumentation, aggregation and chart/table components |
| AI | existing server-side AI/provider abstraction, grounding sources, configuration, limits, and relevant installed specialist guidance |
| Validation/runtime | test runners, test-port allocation, process cleanup, locks, workflows, artifact boundaries, and hardcoded-port checks |

Record a capability matrix: **present**, **absent**, **unclear**, or **not
applicable**, with evidence. Resolve unclear items by reading the relevant
source; never invent a database, chart library, auth provider, AI model,
browser, service, or restart mechanism. If a requested mode lacks prerequisites,
report it unavailable or not applicable, with the safe partial outcome and any
user decision needed.

Choose the mode from the request:

- **Help only:** content, guidance, Q&A, feedback, and support UX.
- **Admin Analytics only:** protected operational/product analytics and its
  instrumentation.
- **Runtime Safety only:** ports, process/test hygiene, and eligible
  development outage controls.
- **Combined:** perform each explicitly requested mode as a separate workstream,
  sharing discovery and validation but not silently adding another mode.

Use the host project's native approach and conventions. Read an installed
specialist skill only when its subject is in scope: for runtime work read
`.agents/skills/Port-Authority/SKILL.md` and, only when its stated heavy-project
gate applies, `.agents/skills/Port-Authority-Heavy/SKILL.md`; for a server-side
AI help surface read `.agents/skills/poe-setup/SKILL.md` only if it is the
relevant provider guidance. Do not copy a specialist's product, provider, or
framework assumptions into this skill or the host project.

## 2. Shared boundaries

- Keep authorization, secrets, persistence, telemetry, and service control at
  the narrowest native boundary that can enforce them. A client hint is never
  an authorization decision.
- Preserve existing route, error, content, accessibility, and test contracts
  unless the request explicitly changes them. Prefer an adapter around existing
  systems to a parallel implementation.
- Treat user-authored content, telemetry values, AI output, and query parameters
  as untrusted: validate, bound, escape, and redact as appropriate.
- Do not add invented branding, routes, contacts, roles, environment variables,
  providers, credentials, or infrastructure. Use project configuration or stop
  and ask for the missing value.
- Keep optional features optional. A repository without a UI, server, database,
  AI, multiple services, or a controllable development process can still use
  the applicable subset; say what was skipped and why.
- Tests must prove both the enabled path and the capability gate. Do not use a
  mock that hides whether the real authorization, environment, or process
  boundary is enforced.

## 3. Help mode

Design a maintainable support system for the interfaces the repository actually
has. Use structured content records or the host's equivalent instead of
scattering long help strings through components or commands. A record has a
stable key, title, body, feature/workflow context, audience or availability
metadata when needed, and a revision/source marker. Keep content versionable,
searchable where useful, and safe to render; do not claim an unsupported feature.

Cover, where applicable:

1. **First-time guidance:** orient a new user to the main task, essential
   controls, and next step without blocking repeat users. Persist dismissal or
   completion through the existing user/settings mechanism, with a reset or
   revisit path.
2. **Feature and workflow examples:** explain concrete tasks in the product's
   vocabulary, prerequisites, expected result, recovery path, and limitations.
   Prefer short contextual help plus a deeper article or command reference.
3. **Grounded Q&A:** when server-side AI exists, keep answers app-only and
   grounded in approved current help/product sources and available user context.
   Do not expose provider credentials or let the model invent routes,
   capabilities, policy, or contacts. Validate and bound requests and output,
   handle unavailable/unsafe answers clearly, and preserve server-side auth,
   timeout, rate-limit, telemetry, and error policies. Without AI, use
   search/static guidance or report Q&A unavailable; do not add a speculative
   provider.
4. **Feedback:** use the configured support contact or feedback channel. Never
   invent an email, webhook, or external destination. If none is configured,
   state the configuration gap and provide a local/non-delivery fallback only
   when the host supports one.
5. **Interaction:** for an overlay or floating help surface, support draggable,
   minimize, and close behavior without trapping content or losing the user's
   place. Otherwise use the native equivalent (such as command help or a page)
   and do not introduce pointer-only chrome.
6. **Device and input adaptation:** make guidance usable on small screens,
   touch, keyboard, assistive technology, and non-pointer inputs. Avoid
   hover-only instructions; preserve focus; provide intentional keyboard
   close/minimize; use semantic headings/controls; expose state changes to
   assistive technology; and follow established contrast, motion, zoom, and
   reduced-motion conventions.

Test rendering/escaping, first-time versus returning state, search or Q&A
grounding, contact configuration, dismissal/revisit, keyboard and screen-reader
semantics where UI exists, responsive/touch behavior, and the no-AI/no-browser
fallback. Do not test a browser-only outcome in an API-only or command-line
project.

## 4. Admin Analytics mode

Establish the requested analytics and the actor allowed to see them. Keep the
capability check server- or service-authoritative for every read, export,
aggregation, and mutation. A client admin flag, hidden route, or exposed
administrator identifier is not a security control.

- Use the existing authorization policy and role/capability source. Deny by
  default and re-check authorization at the data boundary.
- Match established interface semantics. For an interactive UI, use
  indistinguishable UI not-found behavior for an unauthorized admin-only page
  when that is the host's privacy convention. For an API, return its documented
  authorization response (normally 403 for an authenticated but unauthorized
  caller) without revealing protected-record existence. Never impose UI
  not-found semantics on an API with another contract, or vice versa.
- Never send admin IDs, role lists, secrets, raw access tokens, privileged query
  details, or unaggregated private records to an unnecessary client. Keep them
  out of URLs, bundles, logs, analytics payloads, and errors.
- Collect only minimum privacy-safe events for the stated purpose. Prefer coarse,
  purpose-limited dimensions and aggregation; do not record full URLs with
  secrets, free-form sensitive text, raw IPs, or unnecessary identifiers.
- If a pseudonymous visitor ID is necessary, derive it server-side with a
  server-held keyed construction, rotate or scope it as appropriate, bound
  retention, and document access/deletion. Plain or unsalted IP hashing is not
  sufficient privacy protection.
- Make page-view and supporting telemetry non-blocking: instrument after the
  user-visible operation or enqueue through the existing bounded mechanism.
  Telemetry failure must not fail navigation, help, analytics loading, or
  authorization. Bound retries and avoid duplicate events on rerender/reload
  using the established lifecycle.
- Use native persistence/query and chart/table mechanisms. Apply aggregation,
  time-range limits, pagination, export restrictions, and retention before
  rendering or returning data. Without a suitable chart surface, use a safe
  table or report instead of adding charts.

Test authorized, anonymous, unauthorized, direct-API, and stale-session access;
identifier/secret non-disclosure; aggregation, retention, and export limits;
duplicate page views; and telemetry-failure isolation. Verify UI and API denial
semantics when both interfaces exist.

## 5. Runtime Safety mode

Apply the runtime specialist's full audit when relevant, then adapt it to the
host project. For network services, the minimum contract is:

1. **Environment-owned ports:** every service reads its listen port from
   environment/platform service configuration. Repository-wide, scan server
   entry points, client dev servers, test URLs, scripts, workflow commands, and
   executable/configuration documentation for hardcoded ports. Ignore examples
   only when the scanner explicitly distinguishes them.
2. **Regression fixture:** test the scan with a synthetic failing fixture
   containing a representative hardcoded bind or URL and reject it; also test a
   valid environment-driven fixture. Do not weaken the production scan.
3. **Canonical test-port allocation:** use the documented allocator/registry or
   an ephemeral reservation strategy for parallel tests. Make ownership,
   readiness, collision handling, cleanup, and artifact-base/service routing
   explicit. Never choose a convenient fixed port without proving it is the
   canonical path.
4. **Safe cleanup:** use native process/workflow control or a dedicated utility
   that discovers the exact holder, exempts its own tree, terminates gracefully
   before escalation, cleans supervising wrappers, confirms the port is free,
   and logs forced takeover. Guard against recursion and production execution;
   never rely on process names alone or kill indiscriminately.
5. **Repeatable validation:** exercise relevant validation twice without manual
   port clearing or killing. Preserve lock/reentrancy, stale-holder, timeout,
   and failed-child cleanup behavior where tests or generated/shared resources
   are serialized.

Without network services, mark port/process checks not applicable but use the
host's safe lifecycle for local workers/commands. For a single-service project,
do not invent multi-service orchestration.

### Development-only outage/restart surface

Add this only when all three gates are proven: an interactive client benefits
from it; a controllable development server/process and safe restart mechanism
exist; and the control can be proven absent or inert in production.

Keep it development-only at both boundaries. At build time, prove production
bundles/routes neither contain nor expose it and production configuration cannot
enable it. At the server boundary, gate the route/command with a trustworthy
environment/build-mode check before any state change and return the host's normal
not-found/unsupported response outside development. Never trust a client mode
flag. Require appropriate development authorization, CSRF or equivalent
cross-site protection where relevant, rate-limit repeated restarts, and make the
action explicit and recoverable.

Exercise the real client-to-development-server failure state and safe
restart/reconnect path, not a client boolean. If there is no interactive client
or controllable development server, report the surface not applicable and do
not add it.

Test build and server environment gating, unauthorized/direct invocation,
restart idempotence, concurrent requests, process cleanup, readiness/health,
client recovery, and production exclusion. Never run destructive restart tests
against production.

## 6. Combined mode and delivery

For an explicitly combined request, keep Help, Admin Analytics, and Runtime
Safety as separate workstreams with separate capability gates and tests. Share
only genuinely shared adapters (such as auth or telemetry) and preserve each
mode's boundary. State which requested modes were implemented, skipped,
unavailable, or not applicable, and why.

Before completion, report:

1. discovered capabilities and evidence;
2. selected modes and deliberately unselected modes;
3. changed surfaces and native adapters;
4. authorization, privacy, accessibility, production, and process-safety
   decisions;
5. tests and negative-path coverage, including unavailable-capability tests;
6. configuration gaps or user decisions required; and
7. relevant specialist handoff and why it applied.

Never claim an operation is protected, private, accessible, or production-safe
unless the corresponding boundary was actually verified.
````

**C1 identity:** 14,361 bytes; 247 newline-terminated lines (248 logical lines); MD5 `8dd9de15ea933800160102217104fa65`; SHA-256 `de57d054bcd39880e741975f29a9cf0f38c300912f35791511a6b471d4d73983`.

## Brainstorm-and-iterate Round 2 — C2

**Comparison:** C1 versus C2 and both against B0, independently.

**Challenge findings:**

- Make “server- or service-authoritative for every read, export, aggregation,
  and mutation” remain a single visible Analytics boundary; C1 already does.
- Keep UI not-found and API authorization semantics separate rather than using a
  universal denial response; C1 already keeps them separate.
- Keep the runtime scan's synthetic failing fixture and valid fixture distinct;
  C1 already does.
- Keep build-time and server-boundary production exclusion distinct; C1 already
  does.
- Do not replace any additional qualifier because the remaining qualifiers carry
  conditions.

**Rejected alternatives:**

- Say “admin analytics are private” without naming the data boundary — rejected
  because a client flag or hidden route could be mistaken for enforcement.
- Say “development restart control” without the three gates — rejected because
  it could be added without a client, restart mechanism, or production proof.
- Collapse no-AI, no-browser, no-network-service, and no-development-server
  behavior into one fallback — rejected because their safe outcomes differ.

**C2 — Complete no-op snapshot reference:** byte-for-byte identical to the
complete C1 snapshot above: 14,361 bytes; 247 newline-terminated lines
(248 logical lines); MD5 `8dd9de15ea933800160102217104fa65`; SHA-256
`de57d054bcd39880e741975f29a9cf0f38c300912f35791511a6b471d4d73983`.

- **Diff from B0:** exactly the C1 compression recorded in Round 1.
- **Diff from prior candidate C1:** none.
- **Ledger coverage:** all entries unchanged and complete.
- **Risks:** no new risk; changing C1 would weaken one of the challenged
  boundaries.
- **Rationale:** retain C1 as a reviewed no-op rather than force a change.

## Pass 1 — P1: Remove redundancy

**Comparison:** C2 against B0 and the immediately preceding candidate.

Reviewed C2 for repeated host/native wording, duplicated explanations,
restatement, filler, and duplicate examples. C1 had already consolidated every
safe redundancy during the exploratory round; the remaining repetition
preserves conditions, precedence, countable requirements, or separate interface
contracts.

**Rejected shorter alternative:** A single paragraph for all shared boundaries
was shorter but hid which rules apply to authorization, untrusted input,
optional capabilities, and tests; retained the explicit bullets.

**P1 — Complete no-op snapshot reference:** byte-for-byte identical to C2/C1:
14,361 bytes; 247 newline-terminated lines (248 logical lines); MD5
`8dd9de15ea933800160102217104fa65`; SHA-256
`de57d054bcd39880e741975f29a9cf0f38c300912f35791511a6b471d4d73983`.

- **Diff from B0:** exactly the C1 compression.
- **Diff from prior candidate C2:** none.
- **Ledger coverage:** all entries unchanged and complete.
- **Risks:** further reduction would hide distinct shared boundaries.
- **Rationale:** retain C2 as a reviewed Pass 1 no-op.

## Pass 2 — P2: Clarify decision boundaries

**Comparison:** P1 against B0 and the immediately preceding candidate.

Reviewed every condition, permission, stop rule, input, output, exception, and
escalation point. P1 already explicitly retains “where applicable,”
unavailable/not-applicable reporting, UI versus API denial semantics,
network-service versus no-network projects, single-service scope, the three
outage/restart gates, build/server production exclusion, and the force of
“never,” “only,” and “must.”

**Rejected shorter alternative:** “Implement the safe subset” was shorter but
did not identify missing prerequisites, configuration gaps, or the user decision
needed for an unavailable requested mode.

**P2 — Complete no-op snapshot reference:** byte-for-byte identical to P1/C1:
14,361 bytes; 247 newline-terminated lines (248 logical lines); MD5
`8dd9de15ea933800160102217104fa65`; SHA-256
`de57d054bcd39880e741975f29a9cf0f38c300912f35791511a6b471d4d73983`.

- **Diff from B0:** exactly the C1 compression.
- **Diff from prior candidate P1:** none.
- **Ledger coverage:** all entries unchanged; decision boundaries are explicit.
- **Risks:** additional clarification would restate rather than clarify.
- **Rationale:** retain P1 as a reviewed Pass 2 no-op.

## Pass 3 — P3: Polish language and ordering

**Comparison:** P2 against B0 and the immediately preceding candidate.

Reviewed grammar, parallel structure, scanability, and instruction order only
after Passes 1 and 2. P2 already keeps the discovery table and numbered lists in
executable order with consistent imperative language. Additional reordering
would separate conditions from their outcomes.

**Rejected shorter alternative:** Replace named domain terms such as
“server-held keyed construction,” “canonical test-port allocation,” and
“indistinguishable UI not-found behavior” with generic “secure” or “standard”
language — rejected because the specific terms carry implementation and privacy
meaning.

**P3 snapshot:** the full `P3 — Complete candidate` block above is byte-for-byte
identical to P2/P1/C2/C1: 14,361 bytes; 247 newline-terminated lines
(248 logical lines); MD5 `8dd9de15ea933800160102217104fa65`; SHA-256
`de57d054bcd39880e741975f29a9cf0f38c300912f35791511a6b471d4d73983`.

- **Diff from B0:** exactly the C1 compression.
- **Diff from prior candidate P2:** none.
- **Ledger coverage:** complete; no changed invariant interpretation.
- **Risks:** generic polishing would erase domain precision.
- **Rationale:** retain P2 as the reviewed strongest candidate; Pass 3 is a
  no-op.

## Adversarial acceptance checks

| Check | Scenario using B0 content | Ledger entries | Result |
|---|---|---|---|
| Concise target | An agent reads only the compact candidate and must choose Help only, Admin Analytics only, Runtime Safety only, or explicit Combined; it must also produce the seven completion-report items. | Triggers, workflow, outputs | **Pass.** Modes, explicit Combined intent, capability matrix, and seven outputs remain visible. |
| Safety-sensitive target | An admin analytics request arrives with a client admin flag and private visitor data; a development restart route is also proposed. | Safety/authorization, analytics, runtime | **Pass.** Client hints do not authorize, privacy limits remain, and restart requires all three gates plus build/server production exclusion. |
| Procedural target | A network-service project has a hardcoded port, parallel tests, a supervising process, and serialized validation. | Workflow, runtime semantics, tool/file constraints | **Pass.** The failing/valid fixtures, canonical allocation, cleanup sequence, and repeatability rule remain ordered and testable. |
| Exception-heavy target | The repository has no browser, no AI, no network services, and no controllable development server, while the user asks for Combined. | Exceptions, escalation, outputs | **Pass.** Each unavailable/not-applicable outcome is preserved; no speculative capability is added. |
| Contradictory target | A UI and API expose the same protected analytics with different established denial contracts. | Analytics semantics, safety | **Pass.** P3 keeps UI not-found and API documented authorization semantics separate and does not harmonize them. |
| Domain-specific target | A runtime specialist's heavy-project gate is absent, and the host has a single service with an ephemeral test-port allocator. | Tool/file constraints, runtime semantics | **Pass.** Heavy guidance is conditional, single-service orchestration is not invented, and the canonical allocator remains required. |

No adversarial check exposed a weaker candidate. No change was rolled back.

## Final Review A — semantic fidelity

Compared P3 with the complete B0 snapshot, the invariant ledger, and all
adversarial findings. Every trigger, requirement, ordered mode gate, exception,
escalation rule, input, output, tool/file constraint, privacy rule, authorization
boundary, runtime-safety rule, and required test category remains present with
the same force and scope. Frontmatter, name, description, and title are byte
for byte unchanged. **Pass.**

## Final Review B — general language

Removed no necessary workspace, framework, provider, deployment, or artifact
framing; those terms are protected target semantics in the trigger and
capability-neutrality rules. P3 remains portable without generalizing away
canonical specialist paths, native-boundary constraints, or domain vocabulary.
No contradiction or unresolved ambiguity was rewritten away. **Pass.**

## Unresolved risks and findings

- **Contradictions:** None found in B0 or the candidates.
- **Unresolved ambiguity:** None requiring a wording change. The host still
  determines its own established UI/API denial contract; P3 deliberately does
  not choose one.
- **Domain terminology:** Retained where it determines safe execution.
- **Stop conditions:** None triggered. The considered shorter alternatives were
  stopped where they would hide a condition, weaken a boundary, or invite
  invented infrastructure.
- **Out-of-scope status:** No frontmatter, evals, resources, scripts, mirrors,
  validation configuration, or application code was changed.

## Concise diff from B0

- **Frontmatter:** unchanged, including name and trigger description.
- **Mode framing:** unchanged in meaning; introductory and Combined-mode
  repetition reduced.
- **Discovery:** same eight areas and capability-matrix states; surrounding prose
  tightened.
- **Shared boundaries:** same six protections, with repeated wording removed.
- **Help:** same structured-content contract, six applicable areas, conditional
  AI/feedback/UI behavior, accessibility requirements, and tests; wording
  consolidated.
- **Admin Analytics:** same authoritative authorization, interface-specific
  denial, non-disclosure, privacy-safe identifiers, non-blocking telemetry, and
  aggregation/retention/export rules; repeated explanation removed.
- **Runtime Safety:** same five numbered requirements, no-network/single-service
  branches, three outage gates, build/server production exclusion, and negative
  tests; prose compressed.
- **Delivery:** same separate Combined workstreams and seven required report
  items; wording shortened.
- **Net effect:** a shorter instructional body with no metadata, scope,
  capability, safety, authorization, exception, or output loss.

## Complete change list

### Accepted changes

- Consolidated repeated native-host and no-invention language without weakening
  the boundary.
- Tightened structured-help wording while retaining all six Help areas and their
  applicable conditions.
- Consolidated Analytics and Runtime rules into scan-friendly bullets while
  preserving their distinct enforcement and testing requirements.
- Improved parallel language and ordering after, not before, decision-boundary
  clarification.

### Materially shorter rejected alternatives

- Removing the eight-area discovery table: would make capability evidence less
  observable.
- Generic “best practices,” “private,” or “safe subset” wording: would weaken
  authorization, privacy, exception, and escalation decisions.
- One universal denial or fallback rule: would conflate UI/API contracts and
  distinct unavailable-capability outcomes.
- Removing runtime fixture, allocator, cleanup, or production-gate details:
  would lose executable safety checks.
- Replacing domain terms with generic language: would obscure precise safety
  behavior.

### Retained wording

- Frontmatter identity and trigger metadata: protected and unchanged.
- “where applicable,” “not applicable,” “never,” “only,” and “must”: preserve
  conditional scope and force.
- Server/service-authoritative, server-held keyed construction, canonical
  allocation, and indistinguishable UI not-found terminology: carry security,
  privacy, contract, or runtime meaning.
- Six Help areas, seven delivery outputs, five runtime rules, and three outage
  gates: explicit counts remain reviewable.

### Unresolved wording and findings

- None requiring user resolution. The host project's established denial contract
  and available capabilities remain intentionally discovered at execution time.

### Scope and source status

- **Authoritative source used:** `.agents/skills/app-support-ops/SKILL.md`
- **Scope:** preview-only instructional-text compression.
- **Unchanged:** canonical source, frontmatter, eval fixtures, referenced
  resources, scripts, runtime mirrors, mirror fingerprint, validation
  infrastructure, and application code.
- **Approval boundary:** no canonical write may occur without explicit approval
  of `P3 — Complete candidate` and revalidation against the B0 identity.

## Proposed apply-task handoff (separate and proposed only)

Create a separate **PROPOSED** apply task only after this preview passes
read-back verification. It must name:

- **Candidate:** `P3 — Complete candidate`
- **Preview:** `skill-previews/app-support-ops/app-support-ops-candidate-2026-08-30.md`
- **Canonical source:** `.agents/skills/app-support-ops/SKILL.md`
- **Baseline identity:** 15,986 bytes; MD5 `511735297d4664332a91119e2def5898`;
  SHA-256 `615787784544370b682a337b8684eda97f1bd8a16f61ab87f388f84e51f58d9a`
- **Required gate:** obtain explicit approval naming this candidate, re-read the
  canonical source, compare it with B0, and regenerate/reject the preview if
  the source changed before writing only the approved instructional scope.

The apply task must remain proposed: never auto-accept, start, or apply it.

## Validation evidence

- **Required tier:** `test-fast`; no heavier tier was run.
- **Package-script check:** `TASK_PLAN_FILE=.local/tasks/task-4660.md pnpm
  run test-fast` did not start validation because this repository has no
  `test-fast` package script.
- **Canonical command resolution:** `scripts/register-validation-commands.mjs`
  defines `test-fast` as `node scripts/run-with-timeout.mjs tierFast -- node
  scripts/run-tier.mjs fast`.
- **Locked canonical run:** the canonical shell was run with
  `TASK_PLAN_FILE=.local/tasks/task-4660.md`; the tier-lock pre-check confirmed
  the plan requires `test-fast`, and all 30 fast-tier steps passed.
- **Managed-run check:** the environment's managed validation registry returned
  `NO_MATCHING_WORKFLOW` for `test-fast` even after an upsert attempt. The
  canonical registration was restored without a task-specific prefix.
- **Disposition:** validation is evidenced by the successful, task-locked
  canonical command. The unavailable package alias and managed workflow are
  harness/registration limitations, not substituted validation or reasons to
  escalate.

## Read-back verification record

Read-back verification completed after writing:

1. **Path safety:** pass. The package is readable under the unignored,
   tracked-output location `skill-previews/app-support-ops/`, outside `.local/`,
   temporary directories, mirrors, and the canonical source.
2. **B0 equality:** pass. The embedded B0 is 15,986 bytes and matches the
   canonical source byte for byte; MD5 and SHA-256 match the package identity.
3. **Candidate completeness:** pass. The complete candidate appears once under
   `P3 — Complete candidate`; it is 14,361 bytes, 247 newline-terminated lines
   (248 logical lines), MD5
   `8dd9de15ea933800160102217104fa65`, SHA-256
   `de57d054bcd39880e741975f29a9cf0f38c300912f35791511a6b471d4d73983`,
   and is 1,625 bytes shorter than B0.
4. **Protected metadata:** pass. Candidate frontmatter matches B0 byte for byte.
5. **Workflow package:** pass. The ledger, exactly two brainstorm rounds,
   exactly three ordered passes, six adversarial checks, both final reviews,
   all change-list categories, recommendation, and apply handoff are present.
6. **Canonical immutability:** pass. The canonical source still has SHA-256
   `615787784544370b682a337b8684eda97f1bd8a16f61ab87f388f84e51f58d9a`
   and has no task diff.

The persisted candidate text therefore matches the reviewed and reported
candidate exactly.