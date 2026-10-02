---
name: clerk-for-dan
title: Clerk For Dan
description: >-
  Owner-only Clerk workflow for Replit applications owned by Dan. Use when Dan
  requests Clerk installation, provisioning, migration, web or Expo/mobile
  setup, login customization, troubleshooting, regression testing, or
  post-setup verification. Do not load this workflow for a shared or
  collaborator workspace unless Replit ownership is explicitly verified.
---

# Clerk For Dan

## Scope and triggers

Use this skill for the complete Clerk lifecycle in a Replit application owned by
Dan:

- install or provision Replit-managed Clerk;
- integrate Clerk into a web, API-backed, or Expo/mobile application;
- migrate from Replit Auth;
- customize sign-in, sign-up, branding, login providers, or consent-screen
  copy;
- troubleshoot Clerk setup, login, proxy, session, or environment failures;
- run Clerk regression checks or verify a completed setup.

This is a user-owned orchestration layer. It does not replace, copy, or modify
the platform-provided `.local/skills/clerk-auth/` skill.

## Mandatory ownership and authorization preflight

Perform this preflight before provisioning, migration, configuration,
customization, troubleshooting, testing, or any other Clerk action:

1. Verify from current Replit workspace/project ownership evidence that the
   workspace owner is Dan. Use the current owner identity and role shown by
   Replit's authoritative workspace/project ownership information, or an
   authorized platform ownership check that explicitly identifies the owner.
   The repository name, a profile field, a claim in chat, a display name, an
   application user, or collaborator access is not ownership evidence.
2. Confirm that the requester is acting as the verified owner, rather than
   merely having access to a shared workspace.
3. Confirm that the Replit authorization needed for the requested operation is
   available.

If the authoritative evidence does not explicitly verify Dan as the current
owner, if the requester is only a collaborator, if ownership is ambiguous, or
if authorization evidence is unavailable, stop. State that Clerk work cannot
proceed until current workspace ownership and authorization are verified. Do
not provision anything, inspect or change Clerk configuration, run
migration/testing actions, or guess an identity.

Do not encode Dan's personal identifiers, account metadata, credentials, or
ownership evidence in this file or in application code. Do not bypass an
ownership, authorization, or platform safety check.

## Canonical source of truth

After the ownership gate passes, load the canonical skill before doing Clerk
work:

1. `.local/skills/clerk-auth/SKILL.md`
2. `.local/skills/clerk-auth/references/setup-and-customization.md` for
   installation, web/Expo setup, routing, proxy behavior, and UI
   customization.
3. `.local/skills/clerk-auth/references/web-migration.md` for web/API
   migration details.
4. `.local/skills/clerk-auth/references/expo-migration.md` for Expo/mobile
   migration details.
5. `.local/skills/clerk-auth/references/troubleshoot.md` for a reported
   failure. Reload the canonical `clerk-auth` skill first when troubleshooting,
   even if it was already loaded.

Treat those files as the current implementation contract. Prefer their exact
snippets, commands, stop conditions, and environment rules over remembered
Clerk knowledge. Never edit anything under `.local/skills/clerk-auth/`.

## Management-status gate and routing

Always call `checkClerkManagementStatus()` after the ownership preflight and
before any Clerk operation. Briefly inspect the application to understand its
current auth wiring, but do not read or print secret values.

Route strictly from the returned management status and dashboard access:

- **`unknown`**: stop all implementation. Ask exactly: “Are you using
  Replit-managed Clerk (set up automatically) or your own external Clerk
  account? Check if the Clerk publishable key stored in secrets matches your
  own personal Clerk account. If so, it is external.” Do not proceed until the
  user clarifies.
- **`external`**: do not treat the external tenant as Replit-managed. This
  workflow applies only when the user explicitly wants to migrate to
  Replit-managed Clerk. Otherwise stop and explain that external Clerk work is
  outside this workflow; do not rewrite external credentials or send the user
  through Replit-managed setup.
- **`not_configured`**: continue to installation/provisioning only after the
  ownership gate. If the request is only an informational question about a
  feature, consult Replit documentation as required by the canonical skill
  rather than provisioning an app.
- **`managed`**: continue with the requested lifecycle path. Preserve the
  returned `dashboardAccess` rules for dashboard-only settings:
  `authorized` permits the canonical destination; `requires_personal_pro`,
  `unavailable`, and `unknown` are stop conditions with no dashboard steps or
  raw dashboard URL. Do not emit dashboard navigation for an unconfigured,
  external, or unknown tenant.

Do not infer management status from a key prefix, code imports, or the existence
of a Clerk package. Do not manually edit, rotate, rename, or reveal
Replit-managed Clerk secrets.

After status routing, classify the request before choosing an action:

- For a factual or conceptual inquiry about Clerk Auth, supported features,
  pricing, environments, login providers, OAuth credentials, consent-screen
  branding, or the Auth pane, call `searchReplitDocs` as required by the
  canonical skill before answering. For a managed dashboard-only setting,
  follow the canonical `dashboardAccess` route instead; do not use a guessed
  dashboard location or a raw Clerk dashboard URL.
- For implementation or configuration changes, read the canonical setup and
  customization reference and follow its exact provisioning, proxy, routing,
  environment, and UI instructions. Do not provision merely because the user
  asked an informational question.
- For migration, troubleshooting, or regression/post-setup verification,
  follow the dedicated sections below after the same status gate.

## Installation and application-shape selection

Identify which application shapes are present, then follow only the relevant
canonical setup path. Keep the app's existing structure and do not assume a
specific artifact name, router, server, database, or Expo SDK.

### Provisioning and shared setup

For `not_configured` setup, read the canonical setup reference and use
`setupClerkWhitelabelAuth()` through code execution. Let Replit provision and
manage the keys. Follow the reference's proxy middleware, dependency, server
middleware, and client dependency instructions exactly. The production proxy
steps still matter for a web app without a backend; do not invent a
development-only substitute or request proxy secrets.

For an API-backed app, mount the canonical proxy before body parsers, then wire
`clerkMiddleware()` with `publishableKeyFromHost` and the canonical proxy host
logic. Protect API routes with Clerk auth and preserve the app's existing local
user bridge and authorization rules. Do not add browser bearer-token handling.

### Web setup

For a React web client, follow the canonical setup reference for
`@clerk/react`, the publishable-key resolver, unconditional proxy URL, base
path handling, and `ClerkProvider`. Preserve these fragile requirements:

- use exact wouter paths `"/sign-in/*?"` and `"/sign-up/*?"`;
- give `<SignIn>` and `<SignUp>` `routing="path"` and full base-prefixed paths;
- keep `routerPush`, `routerReplace`, and `stripBase` aligned with the
  canonical example;
- keep the base path publicly accessible to signed-out users, while routing
  signed-in users to the app's portal and signed-out users away from protected
  views;
- use cookie-based browser auth; never add `getToken()`,
  `setAuthTokenGetter`, or `Authorization: Bearer` to web requests;
- if React Query is used, include the canonical cache invalidation pattern.

### Expo/mobile setup

For an Expo client, read the Expo setup section before editing code. Match the
project's Expo SDK, pin compatible `expo-*` package versions, forward the
publishable key and production proxy URL through the build configuration, and
use `ClerkProvider` with a secure `expo-secure-store` token cache. Use Clerk
tokens as bearer tokens only for authenticated mobile API calls; do not copy
that pattern into the web client. In Expo Go, use a custom sign-in flow with
Clerk hooks rather than Clerk's unsupported native `<SignIn />` component.

## Login customization and dashboard boundaries

For sign-in/sign-up UI customization, follow the canonical setup reference:
install the themes package, create a branded SVG at the canonical public path,
set an absolute logo URL with the app base path, match the app font, provide
localized copy, and supply a complete readable `appearance` configuration.
Preserve the canonical Tailwind v4 versus Tailwind 3 handling, explicit
`cardBox` surface/width, text contrast, and production optimization guidance.
Do not replace canonical routing or provider wiring with older Clerk patterns.

For login providers, consent-screen branding, and Auth-pane configuration,
follow the canonical management-status route. For settings that belong in the
Clerk dashboard (such as MFA, sessions, password breach checks, enterprise SSO,
native applications, or email sender settings), use only the canonical
`dashboardAccess` checks and sanctioned open-in-pane destinations. Never guess
a dashboard location or provide a raw `dashboard.clerk.com` URL.

## Migration workflow

When the request is migration from Replit Auth:

1. Pass the ownership and management-status gates first. If status is
   `unknown`, stop with the exact canonical question. If status is external,
   proceed only when the explicit goal is migration to Replit-managed Clerk.
2. Read `web-migration.md` for web/API projects and/or `expo-migration.md` for
   mobile projects, plus `setup-and-customization.md` before writing Clerk
   code. Audit the existing bridge column, users-table identity/app fields,
   auth routes, and every client API path; preserve app authorization and
   provisioning behavior.
3. Use the canonical isolated migration contract rather than migrating inline:
   copy `.local/skills/clerk-auth/references/task/migrate.md` to
   `.local/tasks/migrate-to-clerk.md`, then call `proposeClerkMigration` with
   the canonical title, message, and plan path. Stop after proposing it and
   let the isolated, review-gated task perform the migration.
4. If the user asks to revert a Clerk migration, load the `replit-auth` skill
   and follow its rollback procedure. Do not invent a rollback.

Never pass a legacy `sessionClaims.userId` to Clerk API methods, and do not
change bridge columns, database schemas, or authorization semantics just to
make a migration convenient.

## Troubleshooting workflow

For a reported Clerk failure, preserve both the ownership gate and management
status gate, then reload `.local/skills/clerk-auth/SKILL.md` and read the
canonical troubleshooting and setup references together. If the user is
handling Clerk-related errors surfaced in console logs while addressing a
request, treat those as **Dev (preview)**. Otherwise, if the environment is
not stated, call `AskQuestion` with exactly:

```json
{
  "question": "Where are you seeing this Clerk issue?",
  "choices": ["Dev (preview)", "Prod (published app)"]
}
```

Prefer this order:

1. Update `@clerk/*` packages to the latest versions permitted by the
   workspace's `minimumReleaseAge` policy in `pnpm-workspace.yaml`.
2. Compare the app's Clerk wiring to the current canonical snippets and make
   the smallest Clerk-specific correction.
3. Check adjacent infrastructure only when indicated, such as CSP directives
   blocking Clerk/Turnstile.
4. For Dev (preview) issues, restart both the backend and frontend workflows,
   even if no code change was needed. For Prod (published app) issues, verify
   that the preview remains healthy, then ask the user to republish and retry.
5. Re-test the original symptom and record the observed result without
   exposing secrets.

Treat canonical red herrings as expected: development `pk_test` keys and
development-key warnings, separate development/production user stores,
production-only proxy behavior, empty development proxy variables, and direct
TLS checks against Clerk hosts. Do not “fix” these by editing secrets,
changing DNS, adding web bearer auth, or replacing the canonical proxy.

## Regression and post-setup verification

After an approved setup or code change, run the project's existing appropriate
checks and verify the relevant paths without inventing a new test harness:

- the app starts cleanly in preview and its configured workflow logs show no
  Clerk setup errors;
- the base path renders useful signed-out landing content and does not
  redirect directly to sign-in;
- sign-in and sign-up load at the exact base-prefixed routes, including OAuth
  callback subpaths, and their links point to each other;
- branding, logo, localization, and text contrast are present rather than a
  default unstyled Clerk surface;
- signed-in users reach the portal, can sign out through Clerk, and return to
  the home route;
- web API requests authenticate through session cookies, while Expo requests
  use the mobile bearer-token path only;
- protected API routes reject signed-out requests, and a signed-in user who
  lacks a local row or authorization receives a terminal access-denied state,
  not an infinite sign-in redirect;
- production wiring uses the app proxy after publication, while development
  uses the expected test environment; do not expect accounts to cross
  environments.

If any ownership, management-status, dashboard-access, or authorization check
becomes unavailable during verification, stop and report the boundary rather
than continuing with a guessed recovery.

## Security rules

- Keep all Clerk secrets and environment values in Replit-managed secret or
  environment mechanisms. Never ask the user to paste them into chat, print
  them, commit them, or hand-edit managed values.
- Keep Replit-managed Clerk and an external Clerk tenant distinct. Do not
  conflate their keys, dashboard procedures, environments, or authorization.
- Do not bypass ownership, dashboard access, consent, migration approval,
  review gates, or other Replit authorization boundaries.
- Make no application-code, dependency, environment, database, or provider
  change as part of authoring this skill itself; those are actions for a
  future, authorized workflow.