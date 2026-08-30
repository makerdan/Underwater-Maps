---
name: Port-Authority
description: Runtime hygiene playbook for any Replit app — prevention and repair of stale/zombie/orphaned processes, port conflicts and EADDRINUSE errors, blank or unreachable preview panes, hung or stuck test runs, and test suites blocking each other. Use when a port is already in use, a server won't start, the preview is blank, tests hang or deadlock, or when setting up a new project to prevent these problems. Ships dependency-free template scripts for port cleanup and crash-safe test serialization.
---

# Port-Authority — Runtime Hygiene for Replit Apps

This skill applies to **any Replit app**, in two modes:

- **Prevention** — apply it while setting up a new project so stale processes,
  port conflicts, and hung test runs never appear.
- **Repair** — apply it to an already-broken project ("port already in use",
  "EADDRINUSE", blank preview, tests stuck forever). Repair mode starts at
  Phase 0 like everything else: audit before you touch anything.

Phases are **sequential**. Each phase is marked ALWAYS or CONDITIONAL.
A CONDITIONAL phase states its gate up front — if the gate fails, **skip the
phase entirely**. Never apply conditional machinery speculatively.

> If the project has two or more heavy test suites AND multiple services,
> also read the `Port-Authority-Heavy` skill after finishing this one.

---

## Installation contract (ALWAYS)

The downloadable bundle contains exactly these resources:

- `SKILL.md` — this guidance.
- `scripts/free-ports.mjs` — a dependency-free **template** for the target
  project's port cleanup command.
- `scripts/validation-lock.mjs` — a dependency-free **template** for the
  target project's validation serialization command.
- `Port-Authority-Heavy/SKILL.md` — the optional companion extension.

The two scripts in the bundle are templates, not promises that the target
project already has those paths. Install them only after the Phase 0 audit:

1. Extract the bundle into a temporary directory and verify the four entries,
   their frontmatter, and their executable smoke checks. A missing, extra,
   renamed, or byte-different entry is an installation failure.
2. Audit the target project's existing workflows, scripts, lock files, and
   port ownership. If the project already has a cleanup or serialization
   implementation, compare behavior and adapt that implementation instead of
   overwriting it. Never replace an existing script blindly.
3. If a template is needed, copy it into the target project's `scripts/`
   directory, preserve its executable bit, and change only its documented
   adaptation points. Defaults resolve relative to the copied script:
   `.local/` for locks and no ports for cleanup (ports must be supplied).
4. Run the template's invalid-input and no-op smoke checks in an isolated
   temporary directory. Do not use a live application port or the workspace's
   real lock directory. A failed smoke check stops installation.
5. Install the project's own runtime wiring separately. The templates do not
   know the target project's package manager, workflow names, e2e port registry,
   generated files, or database layout. Do not copy BathyScan-specific paths,
   `--e2e` behavior, or hidden project assumptions into a fresh installation.
6. Do not edit `.local/custom_skills/`; it is a platform-managed mirror. The
   tracked `.agents/skills/` source and generated archive are canonical.

### Validation registration acceptance

The target project must have an executable backing command for **each** of
these four names before registration is reported successful:

| Command | Use when | Minimum acceptance |
|---|---|---|
| `test-fast` | copy, style, UI, or new-component-only changes | typecheck and lint targets exist and run |
| `test-standard` | most bug fixes and features touching existing behavior | fast targets plus unit and relevant documentation/data checks exist |
| `test-standard-plus` | static/unit coverage across multiple packages, without browser suites | the complete non-Playwright target is executable |
| `test-heavy` | new routes with e2e coverage, schema, auth/security, or broad refactors | the serialized full target, including browser/schema checks, is executable |

Verify the registration manifest, the platform registration, and the target
package scripts independently. A name without an executable backing command is
an installation failure; never register an optimistic placeholder or silently
substitute another tier. Record the selected tier, its timeout budget, and
whether its steps use `validation-lock.mjs` before accepting the installation.
Read the `validation-tiers` skill for the project-specific decision table, but
retain all four names even when a particular project omits a tier's optional
checks.

### Installation acceptance

Run these deterministic smoke checks from the target project before touching
live services:

1. `node scripts/free-ports.mjs` must reject the missing port with exit 2.
2. Ask Node to bind port `0`, record the assigned ephemeral port, close that
   probe server, then pass the now-unused port to `free-ports.mjs`; it must exit
   0 without signaling any process.
3. Set `VALIDATION_LOCK_FILE` and `VALIDATION_LOCK_WAITERS_DIR` to paths inside
   a new temporary directory. Wrap `node -e "process.exit(0)"`, then
   `node -e "process.exit(7)"`; the wrapper must return 0 and 7 respectively
   and leave no lock behind.
4. In that same temporary directory, seed a lock with a confirmed-dead PID and
   run the wrapper again. It must log a stale takeover, succeed, and clean up.
   Nest a wrapper for the same resource once; it must log reentrant execution
   and finish without waiting.
5. List platform registrations and compare the four names and command strings
   with the target project's canonical manifest. Invoke every backing package
   command in its documented dry-run/list mode, or once normally if it has no
   non-executing mode. Missing registrations, targets, or interpreters fail
   installation.

After wiring only the resources required by the audit, run the selected
registered tier twice back-to-back. There must be no manual port clearing,
process killing, or lock deletion between runs. Confirm that the health probe
reaches the backend, that each forced cleanup/reclaim is loud, and that a
failed child command releases its lock and propagates its exit status. If any
acceptance step fails, leave the existing implementation intact, report the
failure, and do not claim the installation is complete.

---

## Phase 0 (ALWAYS) — Audit first

Before changing anything, inventory the runtime:

1. Running processes: `ps -eo pid,ppid,comm,args | head -50` (note: under Nix,
   Node processes may report their comm as `MainThread`, not `node`).
2. Listening ports: `ss -tlnp` (or parse `/proc/net/tcp` + `/proc/net/tcp6`
   if `ss` is unavailable).
3. Configured workflows and what commands they run.
4. Test/validation commands and which ports, generated files, or databases
   they share.

Write down what you find. Repair decisions made without this inventory
routinely kill the wrong process or "fix" a port that was never the problem.

## Phase 1 (ALWAYS) — Process discipline

- **Never** start servers or long-running jobs via `nohup`, `setsid`, or
  backgrounded shells (`cmd &`). They either die silently when the calling
  shell ends, or survive as port-holding orphans that break the next run.
- Anything that runs longer than ~2 minutes belongs in a **named workflow**
  or a **registered validation command**, never an ad-hoc shell.
   Registered validation commands come in four tiers: `test-fast`
   (typecheck + lint only), `test-standard` (typecheck + lint + unit +
   doc checks), `test-standard-plus` (all static + unit checks without
   Playwright), and `test-heavy` (full suite including e2e and schema checks).
   Read the `validation-tiers` skill for the decision table.
  **Never default to `test-heavy` for every task** — it is reserved for
  high-risk changes (new API routes, schema migrations, auth/security
  changes, multi-package refactors).
- Every service must read its port from the `PORT` environment variable.
  Hunt down hard-coded ports (e.g. Vite `server: { port: N }`, Express
  `app.listen(3000)`) — they are the #1 cause of port collisions and blank
  preview panes.

## Phase 2 (ALWAYS) — One canonical port-cleanup script

Adopt a single port-cleanup script and use it everywhere. A template ships
with this skill: `scripts/free-ports.mjs`. Non-negotiable properties:

- **Do not rely on `fuser`** — it is often missing from PATH under Nix, and a
  silently no-op `fuser -k` is worse than nothing.
- **Do not rely on process names** — Node under Nix can report its command as
  `MainThread`. Discover holders via `/proc` fd scanning (or `lsof`/`ss` on
  PIDs), matching socket inodes, never names.
- **Exempt the caller's own process tree** by walking parent PIDs. A sweep
  that kills the server it is clearing the way for is a self-inflicted
  denial of service.
- **Guard with an environment variable** against recursive or production
  execution.
- Kill the whole supervising wrapper tree (pnpm/npm/node/sh), not just the
  socket holder — a bare port-kill leaves package-manager zombies that
  respawn or confuse later restarts.
- SIGTERM first with a grace period, then SIGKILL survivors, then confirm
  the port is actually free before returning success.

## Phase 3 (CONDITIONAL — only if a browser/e2e harness such as Playwright exists)

Gate: the project runs browser/e2e tests. If not, skip this phase.

- Playwright starts `webServer` processes **before** `globalSetup` runs.
  Port sweeps placed in `globalSetup` therefore run too late and can kill
  the freshly started servers of the very run they protect. Put sweeps
  inside each `webServer` command (or env-guarded at config-load time),
  never in `globalSetup`.
- Pass values into `addInitScript` as **explicit arguments**, never captured
  closures — closure captures are silently dropped in serialization and the
  script runs with `undefined`.

## Phase 4 (CONDITIONAL — only if 2+ heavy suites, or suites sharing generated files/DB state/ports)

Gate: two or more heavy suites, or suites that share generated files,
database state, or ports. If not, skip this phase.

Wrap each heavy command in a **crash-safe serialization lock** using
`scripts/validation-lock.mjs`:

```
node scripts/validation-lock.mjs [--resource <name>] [--priority <1-9>] -- <command...>
```

### Named-resource striping

Pass `--resource <name>` to acquire a per-resource lock
(`.local/validation-lock-<name>.lock`) instead of a single global lock.
Steps that don't conflict with each other use different resource names and
run in parallel; steps sharing a resource serialize. The default resource
is `global` (backward-compatible).

**Step-to-resource mapping (this project's conventions):**

| Step | Resource |
|---|---|
| `typecheck` (regenerates `lib/api-zod/src/generated/api.ts`) | `codegen` |
| `test:unit` | `unit-cpu` |
| `test:e2e` steps | `e2e-port` and `unit-cpu` |
| `lint`, `check:*` | *(none — run unwrapped)* |

### Priority queue

Pass `--priority <N>` (1 = highest, 9 = lowest; default 5) to influence
acquisition order when multiple steps wait for the same resource. Each
waiting process writes a manifest entry to
`.local/validation-waiters-<name>/<pid>.json`. On each poll tick,
lower-priority waiters yield to higher-priority ones that have been queued
longer than a short grace period (default 2 s).

**Recommended tier assignments:** fast-tier steps → `1`, standard-tier →
`2`, heavy-tier → `3`.

### Per-resource reentrancy

The holder exports `VALIDATION_LOCK_HELD_PID_<RESOURCE_UPPER>` (e.g.
`VALIDATION_LOCK_HELD_PID_CODEGEN`, `VALIDATION_LOCK_HELD_PID_UNIT_CPU`)
into its child environment. A nested wrapper for the same resource detects
this env var and runs its command directly, skipping re-acquisition.
For the `global` resource, the legacy `VALIDATION_LOCK_HELD_PID` variable
is also checked and exported for backward compatibility.

### Required properties

- **Reentrancy-safe**: nested wrappers for the same resource skip
  acquisition (see above). Without this, a wrapped command that invokes
  another wrapped command for the same resource deadlocks until the
  max-hold safety valve fires.
- **Crash-safe**: the lockfile stores the holder PID; waiters check holder
  liveness so a crashed run can never block future runs forever. Layered
  staleness checks: dead PID, stale heartbeat (for PID-reuse cases), and
  max-hold safety valve for hung-but-alive holders.
- **Loud on takeover**: forcibly cleared stale locks are logged as
  incidents, never silently absorbed.
- **Budgets start after acquisition**: all time budgets/timeouts must start
  ticking AFTER the lock is acquired, or queued runs falsely appear timed
  out while merely waiting their turn.

### Anti-pattern: double-wrapping causes deadlock

Inner steps of a serial runner must use their **unwrapped** variants (e.g.
`test:e2e:run`, not `test:e2e`). Calling a lock-wrapped command from inside
another locked step holding the same resource self-deadlocks until the
max-hold safety valve fires (default 2 hours).

## Phase 5 (CONDITIONAL — only if the project has codegen/generated files)

Gate: the project regenerates files (API clients, schemas, types). If not,
skip this phase.

- Never run two regenerators of the same file concurrently — serialize them
  (Phase 4's lock is the natural home).
- When a failure smells like a half-written generated file (parse errors,
  "missing export" in a generated module), **re-run the failing step alone**
  before assuming a real bug. Concurrent regeneration races masquerade as
  code bugs.

## Phase 6 (ALWAYS, with per-item gates) — Test hygiene

- Fake-timer/clock resets live in a **file-level setup file**, never a
  global per-test `beforeEach` — per-test clock resets silently break TTL
  caches across test files.
- Known-failing tests are explicitly skipped/quarantined **with a tracking
  note**, never left running: they burn wall-clock time and mask real
  regressions.
- Every long-lived connection pool (e.g. `pg.Pool`) gets an `error` event
  listener — an unhandled pool error becomes `uncaughtException` and kills
  the process mid-run.

## Phase 7 (CONDITIONAL — only if the app uses WebSockets, live updates, or Vite HMR through the Replit preview pane)

Gate: the app has WebSocket connections (including HMR). If not, skip
entirely — do not add ping machinery speculatively.

- The Replit proxy drops WebSocket connections after roughly **30 seconds
  idle**, and only **native protocol-level ping frames (opcode 0x9)** reset
  the timer — application-level JSON heartbeats do NOT.
- Add native pings at ~20-second intervals on HMR sockets and application
  WebSockets (e.g. a small Vite plugin that pings HMR clients; `ws.ping()`
  server-side for app sockets).

## Phase 8 (ALWAYS) — Health checks and restarts

- Health probes must target a route that **genuinely reaches the backend**
  (e.g. `/api/healthz`). A root-relative probe against an SPA gets the HTML
  fallback and returns a lying 200 even when the API is down.
- After dependency or config changes, **restart the affected workflow**
  rather than trusting hot-reload.

## Phase 9 (ALWAYS) — Regression hardening

- **Acceptance gate**: the **validation tier appropriate for the work
  done** runs **twice back-to-back** with zero manual port clearing or
  process killing in between (consult the `validation-tiers` skill for
  the tier decision table). If a human (or agent) had to intervene, the
  hygiene work is not done.
- The env guards from Phases 2 and 4 stay **permanent** — they are not
  scaffolding to remove later.
- Any forced unlock or forced kill logs loudly so hidden hangs surface
  instead of being absorbed.
- When a hygiene problem recurs, **fix the rule or the script — never just
  the single instance.**

---

## Template scripts

Both templates are dependency-free Node scripts. Each has a header comment
listing its adaptation points (port list, lock path, env-guard variable
names).

- `scripts/free-ports.mjs` — canonical port cleanup (Phase 2).
- `scripts/validation-lock.mjs` — crash-safe serialization lock with named-resource striping and priority queue (Phase 4).

The scripts are intentionally self-contained. A target project may use
different runtime scripts (for example `kill-port-holders.mjs`) after the
audit, but those project-specific files are not part of this bundle and must
not be referenced as if they were installed resources.
