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

Wrap each heavy command in a small **crash-safe serialization lock**. A
template ships with this skill: `scripts/serial-lock.mjs`. Required
properties:

- **Reentrancy-safe**: the holder exports its PID in an env var; a nested
  locked command checks that PID against its own ancestors and skips
  acquisition. Without this, a wrapped command that invokes another wrapped
  command deadlocks against itself.
- **Crash-safe**: the lockfile stores the holder PID; waiters check holder
  liveness so a crashed run can never block future runs forever. Layered
  staleness checks (dead PID, stale heartbeat for PID-reuse cases, max-hold
  safety valve for hung-but-alive holders).
- **Loud on takeover**: forcibly cleared stale locks are logged as
  incidents, never silently absorbed.
- **Budgets start after acquisition**: all time budgets/timeouts must start
  ticking AFTER the lock is acquired, or queued runs falsely appear timed
  out while merely waiting their turn.

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

- **Acceptance gate**: the full test/validation suite runs **twice
  back-to-back** with zero manual port clearing or process killing in
  between. If a human (or agent) had to intervene, the hygiene work is not
  done.
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
- `scripts/serial-lock.mjs` — crash-safe serialization lock (Phase 4).
