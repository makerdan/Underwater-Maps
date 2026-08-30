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
