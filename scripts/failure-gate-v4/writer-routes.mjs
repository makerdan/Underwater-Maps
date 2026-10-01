/**
 * Fixed, cooperative routes for the four narrowly supported repository
 * generator/check commands. This is not an all-writer boundary: unmediated
 * editors, Agent/IDE writes, shell commands, detached/background processes,
 * package lifecycle scripts, and application/data writers remain unknown.
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  constants as fsConstants,
  promises as fs,
  readFileSync,
  readdirSync,
} from "node:fs";
import { spawn } from "node:child_process";
import os, { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalJson, digestJson } from "./canonical.mjs";
import {
  assertRecordedRunStopped,
  captureRunProcessIdentity,
} from "./recovery.mjs";
import { withWriterLock, WriterLockTimeout } from "./writer-lock.mjs";

export const WRITER_ROUTE_REGISTRY_VERSION = "failure-gate-v4-writer-routes-v1";
export const WRITER_ROUTE_AUDIT_VERSION = "failure-gate-v4-writer-route-audit-v1";

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(MODULE_DIRECTORY, "../..");
const DEFAULT_LOCK_DIRECTORY = path.join(homedir(), ".failure-gate-v4");
const DEFAULT_LOCK_PATH = path.join(DEFAULT_LOCK_DIRECTORY, "writer.lock");
const DEFAULT_AUDIT_PATH = path.join(DEFAULT_LOCK_DIRECTORY, "writer-routes-v1.jsonl");
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_ORPHAN_GRACE_MS = 500;
const MAX_ACQUIRE_TIMEOUT_MS = 60_000;
const MAX_ORPHAN_GRACE_MS = 10_000;
const PROCESS_POLL_MS = 25;
const routeDefinitions = Object.freeze([
  Object.freeze({
    id: "codegen-generate",
    executableKind: "pnpm",
    argv: Object.freeze(["--filter", "@workspace/api-spec", "run", "codegen:generate"]),
    entrypointPaths: Object.freeze([
      "lib/api-spec/package.json",
      "lib/api-spec/scripts/codegen-locked.mjs",
    ]),
    outputScope: Object.freeze([
      "lib/api-client-react/src/generated/**",
      "lib/api-zod/src/generated/**",
    ]),
    scopeVersion: "api-codegen-output-v1",
  }),
  Object.freeze({
    id: "codegen-stale",
    executableKind: "node",
    argv: Object.freeze(["scripts/check-codegen-stale.mjs"]),
    entrypointPaths: Object.freeze(["scripts/check-codegen-stale.mjs"]),
    outputScope: Object.freeze([
      "lib/api-client-react/src/generated/**",
      "lib/api-zod/src/generated/**",
      "system-temp:codegen-stale-check-*",
    ]),
    scopeVersion: "api-codegen-stale-output-v1",
  }),
  Object.freeze({
    id: "schema-drift",
    executableKind: "node",
    argv: Object.freeze(["scripts/check-schema-drift.mjs"]),
    entrypointPaths: Object.freeze(["scripts/check-schema-drift.mjs"]),
    outputScope: Object.freeze(["lib/db/drizzle/**"]),
    scopeVersion: "schema-drift-output-v1",
  }),
  Object.freeze({
    id: "generated-docs",
    executableKind: "node",
    argv: Object.freeze(["scripts/generate-api-docs.mjs"]),
    entrypointPaths: Object.freeze(["scripts/generate-api-docs.mjs"]),
    outputScope: Object.freeze(["README.md", "replit.md"]),
    scopeVersion: "generated-docs-output-v1",
  }),
]);

export const EXTERNAL_WRITER_BOUNDARY = Object.freeze({
  version: "failure-gate-v4-external-writer-boundary-v1",
  status: "unknown",
  verifiedSnapshotClaim: false,
  uncoveredWriterClasses: Object.freeze([
    "host editor, IDE, and Agent writes",
    "direct shell and scripts that do not use this CLI",
    "detached/background processes and child processes that escape the monitored session",
    "dependency and package lifecycle writers",
    "application, database, and data writers",
  ]),
  cutoverEligible: false,
});

function fail(message, options) {
  const error = new Error(message, options);
  error.name = "WriterRouteError";
  return error;
}

function validateOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("writer-route options must be an object");
  }
  const allowed = new Set([
    "projectRoot",
    "lockPath",
    "auditPath",
    "acquireTimeoutMs",
    "orphanGraceMs",
    "signal",
  ]);
  const unknown = Object.keys(options).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new TypeError(`writer-route options are not permitted: ${unknown.sort().join(", ")}`);
  }
  for (const key of ["projectRoot", "lockPath", "auditPath"]) {
    if (options[key] !== undefined &&
        (typeof options[key] !== "string" || !path.isAbsolute(options[key]))) {
      throw new TypeError(`${key} must be an absolute path`);
    }
  }
  for (const key of ["acquireTimeoutMs", "orphanGraceMs"]) {
    if (options[key] !== undefined &&
        (!Number.isFinite(options[key]) || options[key] < 0)) {
      throw new TypeError(`${key} must be finite and nonnegative`);
    }
  }
  if ((options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS) > MAX_ACQUIRE_TIMEOUT_MS) {
    throw new TypeError(`acquireTimeoutMs must not exceed ${MAX_ACQUIRE_TIMEOUT_MS}`);
  }
  if ((options.orphanGraceMs ?? DEFAULT_ORPHAN_GRACE_MS) > MAX_ORPHAN_GRACE_MS) {
    throw new TypeError(`orphanGraceMs must not exceed ${MAX_ORPHAN_GRACE_MS}`);
  }
  if (options.signal !== undefined &&
      !(options.signal instanceof AbortSignal)) {
    throw new TypeError("signal must be an AbortSignal");
  }
}

async function findExecutableOnPath(name) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  throw fail(`writer route requires executable '${name}' on PATH`);
}

async function executableIdentity(executablePath) {
  const realPath = await fs.realpath(executablePath);
  const info = await fs.stat(realPath);
  if (!info.isFile() || (info.mode & 0o111) === 0) {
    throw fail("registered writer executable is not an executable regular file");
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(realPath)) hash.update(chunk);
  return Object.freeze({
    path: realPath,
    sha256: hash.digest("hex"),
    sizeBytes: info.size,
    device: String(info.dev),
    inode: String(info.ino),
  });
}

async function entrypointIdentity(projectRoot, relativePath) {
  const realPath = await fs.realpath(path.join(projectRoot, relativePath));
  const relativeRealPath = path.relative(projectRoot, realPath);
  if (relativeRealPath === ".." || relativeRealPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeRealPath)) {
    throw fail(`registered writer entrypoint escapes the project root: ${relativePath}`);
  }
  const info = await fs.stat(realPath);
  if (!info.isFile()) throw fail(`registered writer entrypoint is not a regular file: ${relativePath}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(realPath)) hash.update(chunk);
  return Object.freeze({
    path: relativePath,
    realPath,
    sha256: hash.digest("hex"),
    sizeBytes: info.size,
    device: String(info.dev),
    inode: String(info.ino),
  });
}

async function resolveRoute(routeId, projectRoot) {
  const definition = routeDefinitions.find((candidate) => candidate.id === routeId);
  if (!definition) {
    throw fail(`unsupported writer route '${String(routeId)}'; arbitrary commands are refused`);
  }
  const executablePath = definition.executableKind === "pnpm"
    ? await findExecutableOnPath("pnpm")
    : process.execPath;
  const executable = await executableIdentity(executablePath);
  const entrypoints = await Promise.all(definition.entrypointPaths.map((relativePath) =>
    entrypointIdentity(projectRoot, relativePath)));
  const argv = definition.argv.map((part, index) =>
    index === 0 && definition.executableKind === "node"
      ? path.join(projectRoot, part)
      : part);
  const routeIdentity = {
    version: WRITER_ROUTE_REGISTRY_VERSION,
    routeId: definition.id,
    executable,
    entrypoints,
    argv,
    outputScope: definition.outputScope,
    scopeVersion: definition.scopeVersion,
  };
  return Object.freeze({
    ...routeIdentity,
    digest: digestJson(routeIdentity),
  });
}

async function assertResolvedRouteIdentity(route, projectRoot) {
  const currentExecutable = await executableIdentity(route.executable.path);
  const currentEntrypoints = await Promise.all(route.entrypoints.map((entrypoint) =>
    entrypointIdentity(projectRoot, entrypoint.path)));
  if (canonicalJson(currentExecutable) !== canonicalJson(route.executable) ||
      canonicalJson(currentEntrypoints) !== canonicalJson(route.entrypoints)) {
    throw fail("registered writer executable or entrypoint identity changed before launch");
  }
}

export function getWriterRouteIds() {
  return Object.freeze(routeDefinitions.map(({ id }) => id));
}

function readProcStat(pid) {
  const text = readFileSync(`/proc/${pid}/stat`, "utf8");
  const end = text.lastIndexOf(")");
  if (end < 0) throw new Error("malformed process identity");
  const fields = text.slice(end + 2).trim().split(/\s+/);
  if (fields.length < 20 || !/^\d+$/.test(fields[19])) {
    throw new Error("process start identity unavailable");
  }
  return {
    state: fields[0],
    processGroupId: Number(fields[2]),
    sessionId: Number(fields[3]),
    startTicks: fields[19],
  };
}

function captureWriterProcessIdentity(pid) {
  const captured = captureRunProcessIdentity(pid);
  const current = readProcStat(pid);
  if (current.startTicks !== captured.startTicks) {
    throw fail("registered writer process changed identity during capture");
  }
  return Object.freeze({ ...captured, sessionId: current.sessionId });
}

function assertWriterProcessGroupStopped(identity) {
  assertRecordedRunStopped(identity);
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const member = readProcStat(Number(entry));
      if (member.sessionId === identity.sessionId &&
          !["Z", "X"].includes(member.state)) {
        throw fail("registered writer process session still has a live member");
      }
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
    }
  }
  return true;
}

async function prepareAuditPath(auditPath) {
  const directory = path.dirname(auditPath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const realDirectory = await fs.realpath(directory);
  const stablePath = path.join(realDirectory, path.basename(auditPath));
  const flags = fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_WRONLY |
    (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await fs.open(stablePath, flags, 0o600);
  let identity;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw fail("writer route audit path is not a regular file");
    if ((info.mode & 0o077) !== 0) {
      throw fail("writer route audit file permissions must not grant group or other access");
    }
    const visible = await fs.lstat(stablePath);
    if (!visible.isFile() || visible.dev !== info.dev || visible.ino !== info.ino) {
      throw fail("writer route audit path was replaced during open");
    }
    identity = Object.freeze({ path: stablePath, device: info.dev, inode: info.ino });
  } finally {
    await handle.close();
  }
  return identity;
}

async function appendAudit(audit, event) {
  const record = {
    auditVersion: WRITER_ROUTE_AUDIT_VERSION,
    ...event,
  };
  const line = `${canonicalJson(record)}\n`;
  const handle = await fs.open(audit.path,
    fsConstants.O_APPEND | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw fail("writer route audit path is not a regular file");
    if (info.dev !== audit.device || info.ino !== audit.inode ||
        (info.mode & 0o077) !== 0) {
      throw fail("writer route audit file identity or permissions changed");
    }
    await handle.writeFile(line, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function inspectProcessGroup(identity) {
  try {
    assertWriterProcessGroupStopped(identity);
    return { stopped: true };
  } catch (error) {
    return { stopped: false, reason: error.message };
  }
}

async function waitUntilProcessGroupStopped(identity, { graceMs, onQuarantine }) {
  const deadline = Date.now() + graceMs;
  let quarantined = false;
  while (true) {
    const status = inspectProcessGroup(identity);
    if (status.stopped) return;
    if (!quarantined && Date.now() >= deadline) {
      quarantined = true;
      await onQuarantine(status.reason);
    }
    await delay(PROCESS_POLL_MS);
  }
}

function signalProcessGroup(identity, signal) {
  if (!identity) return;
  try {
    process.kill(-identity.processGroupId, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function resultCode(code, signal) {
  if (code !== null) return code;
  return 128 + (signal ? (osSignalNumber(signal) ?? 0) : 0);
}

function osSignalNumber(signal) {
  return os.constants.signals[signal];
}

function spawnForeground(route, projectRoot, descriptor, onIdentity, isCancelled) {
  return new Promise((resolve, reject) => {
    const child = spawn(route.executable.path, route.argv, {
      cwd: projectRoot,
      detached: true,
      env: process.env,
      stdio: ["inherit", "inherit", "inherit", descriptor],
    });
    let identity = null;
    let pendingSignal = null;
    let settled = false;
    let identityReady = Promise.resolve();
    const signalHandlers = new Map();

    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handler = () => {
        pendingSignal = signal;
        signalProcessGroup(identity, signal);
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    const cleanup = () => {
      for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    };

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("spawn", () => {
      try {
        identity = captureWriterProcessIdentity(child.pid);
        identityReady = Promise.resolve(onIdentity(identity));
        if (pendingSignal) signalProcessGroup(identity, pendingSignal);
      } catch (error) {
        signalProcessGroup({ processGroupId: child.pid }, "SIGKILL");
        error.writerMayBeRunning = true;
        error.unidentifiedWriterPid = child.pid;
        settled = true;
        cleanup();
        reject(error);
      }
    });
    child.once("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        await identityReady;
        resolve({
          code: resultCode(code, signal),
          signal,
          identity,
          cancelled: Boolean(pendingSignal) || isCancelled(),
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function validateRouteId(routeId) {
  if (typeof routeId !== "string" ||
      !routeDefinitions.some((definition) => definition.id === routeId)) {
    throw fail(`unsupported writer route '${String(routeId)}'; arbitrary commands are refused`);
  }
}

/**
 * Run exactly one fixed registered command under the stable v4 writer lock.
 * Path/time/signal options are for isolated diagnostic fixtures; the CLI does
 * not expose them. No option can provide a writer proof or replace argv.
 */
export async function runControlledWriter(routeId, options = {}) {
  validateOptions(options);
  validateRouteId(routeId);
  if (process.platform !== "linux") {
    throw fail("controlled writer routes require Linux util-linux flock");
  }
  if (options.signal?.aborted) {
    throw fail("controlled writer route was cancelled before lock acquisition");
  }

  const projectRoot = await fs.realpath(options.projectRoot ?? WORKSPACE_ROOT);
  const lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;
  await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const audit = await prepareAuditPath(options.auditPath ?? DEFAULT_AUDIT_PATH);
  const acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
  const orphanGraceMs = options.orphanGraceMs ?? DEFAULT_ORPHAN_GRACE_MS;
  const route = await resolveRoute(routeId, projectRoot);
  const runId = randomUUID();
  const base = {
    runId,
    routeId,
    routeRegistryVersion: WRITER_ROUTE_REGISTRY_VERSION,
    routeDigest: route.digest,
    executable: route.executable,
    entrypoints: route.entrypoints,
    argv: route.argv,
    outputScope: route.outputScope,
    scopeVersion: route.scopeVersion,
    projectRootDigest: createHash("sha256").update(projectRoot).digest("hex"),
    externalWriterBoundary: EXTERNAL_WRITER_BOUNDARY,
  };
  let cancelHandler;

  try {
    return await withWriterLock(lockPath, async ({ fd, lockPath: stableLockPath }) => {
      const acquiredAt = new Date().toISOString();
      await appendAudit(audit, {
        ...base,
        state: "acquired",
        occurredAt: acquiredAt,
        lockPath: stableLockPath,
        processIdentity: null,
      });
      try {
        await assertResolvedRouteIdentity(route, projectRoot);
      } catch (error) {
        await appendAudit(audit, {
          ...base,
          state: "released",
          occurredAt: new Date().toISOString(),
          lockPath: stableLockPath,
          processIdentity: null,
          outcome: "launch-denied-identity-changed",
          exitCode: null,
          signal: null,
        });
        throw error;
      }
      let identity = null;
      let commandResult;
      let quarantineWritten = false;
      let cancelled = false;
      const writeQuarantine = async (reason) => {
        if (quarantineWritten) return;
        await appendAudit(audit, {
          ...base,
          state: "quarantined",
          occurredAt: new Date().toISOString(),
          lockPath: stableLockPath,
          processIdentity: identity,
          reason: reason.slice(0, 500),
        });
        quarantineWritten = true;
      };
      const signalTarget = options.signal;
      cancelHandler = () => {
        cancelled = true;
        if (identity) signalProcessGroup(identity, "SIGTERM");
      };
      signalTarget?.addEventListener("abort", cancelHandler, { once: true });
      try {
        commandResult = await spawnForeground(route, projectRoot, fd, (captured) => {
          identity = captured;
          if (cancelled) signalProcessGroup(identity, "SIGTERM");
          return appendAudit(audit, {
            ...base,
            state: "running",
            occurredAt: new Date().toISOString(),
            lockPath: stableLockPath,
            processIdentity: identity,
          });
        }, () => cancelled);
      } catch (error) {
        if (!identity && error.writerMayBeRunning) {
          try {
            await appendAudit(audit, {
              ...base,
              state: "quarantined",
              occurredAt: new Date().toISOString(),
              lockPath: stableLockPath,
              processIdentity: null,
              reason: `writer process ${error.unidentifiedWriterPid} started but its birth identity could not be captured; lease retained indefinitely`,
            });
          } catch (auditError) {
            console.error(`writer route quarantine audit failed: ${auditError.message}`);
          }
          console.error(
            `writer route quarantined: process ${error.unidentifiedWriterPid} may still be active; stable lease retained indefinitely`,
          );
          await new Promise(() => {});
        }
        if (identity) {
          await signalProcessGroup(identity, "SIGKILL");
          try {
            await waitUntilProcessGroupStopped(identity, {
              graceMs: orphanGraceMs,
              onQuarantine: writeQuarantine,
            });
          } catch (waitError) {
            console.error(`writer route quarantine could not be confirmed: ${waitError.message}; stable lease retained`);
            await new Promise(() => {});
          }
        }
        await appendAudit(audit, {
          ...base,
          state: "released",
          occurredAt: new Date().toISOString(),
          lockPath: stableLockPath,
          processIdentity: identity,
          outcome: "spawn-failed",
          exitCode: null,
          signal: null,
          error: error.message.slice(0, 500),
        });
        throw fail(`registered writer route could not launch: ${error.message}`, { cause: error });
      } finally {
        signalTarget?.removeEventListener("abort", cancelHandler);
      }

      identity = commandResult.identity;
      try {
        await waitUntilProcessGroupStopped(identity, {
          graceMs: orphanGraceMs,
          onQuarantine: writeQuarantine,
        });
      } catch (error) {
        console.error(`writer route quarantine could not be confirmed: ${error.message}; stable lease retained`);
        await new Promise(() => {});
      }
      await appendAudit(audit, {
        ...base,
        state: "released",
        occurredAt: new Date().toISOString(),
        lockPath: stableLockPath,
        processIdentity: identity,
        outcome: commandResult.cancelled ? "cancelled" : "finished",
        exitCode: commandResult.code,
        signal: commandResult.signal,
        quarantined: quarantineWritten,
      });
      return commandResult.code;
    }, { timeoutMs: acquireTimeoutMs });
  } catch (error) {
    if (error instanceof WriterLockTimeout) {
      throw fail(
        "writer route lock is held; nested-entry borrowing is unavailable and this attempt was denied after its bounded wait",
        { cause: error },
      );
    }
    throw error;
  }
}

export function writerRouteRoot() {
  return WORKSPACE_ROOT;
}

export function writerRoutePaths() {
  return Object.freeze({
    lockPath: DEFAULT_LOCK_PATH,
    auditPath: DEFAULT_AUDIT_PATH,
  });
}