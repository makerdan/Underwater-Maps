/**
 * bagWorker.ts — Persistent Python subprocess for BAG file parsing.
 *
 * Keeps one `bag_worker.py` process alive across all parseBag() calls so
 * that Python + h5py + pyproj are loaded only once (~500–700 ms cold start)
 * instead of on every invocation.
 *
 * Protocol (stdin/stdout, line-oriented):
 *   Send:    <absolute path to .bag tmp file>\n
 *   Receive: \n<csv lines>__OK__\n   on success
 *            \n__ERR__\t<msg>\n      on failure (embedded \n escaped as \\n)
 *
 * Concurrent calls are serialised through an internal queue; the worker
 * processes one BAG file at a time.
 *
 * Cross-file singleton lifetime
 * ─────────────────────────────
 * The BagWorkerProcess instance is stored under a well-known global symbol
 * (WORKER_GLOBAL_KEY).  This allows the same instance — and thus the same
 * Python child process — to be reused even when vitest re-imports this module
 * for each test file (module isolation mode).  Combined with vitest's
 * `poolOptions.forks.singleFork: true`, all test files run inside the same
 * forked OS process and the global object is truly shared, giving every BAG
 * test file access to the one warm Python worker.
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Script / env resolution
// ---------------------------------------------------------------------------

function findBagWorkerScript(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(thisDir, "bag_worker.py"),       // dev: src/lib/  |  prod main: dist/
    join(thisDir, "..", "bag_worker.py"), // prod worker: dist/lib/ → dist/
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `bag_worker.py not found. Searched: ${candidates.join(", ")}. ` +
      "Rebuild the server with `pnpm build` to copy the script to dist/.",
  );
}

function findPythonUserBase(scriptPath: string): string | undefined {
  let dir = dirname(scriptPath);
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".pythonlibs");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Internal queue item
// ---------------------------------------------------------------------------

interface QueuedRequest {
  path: string;
  resolve: (csv: string) => void;
  reject: (err: Error) => void;
}

// ---------------------------------------------------------------------------
// BagWorkerProcess
// ---------------------------------------------------------------------------

/**
 * Manages a single persistent `bag_worker.py` subprocess.
 * Spawned lazily on first use; restarts automatically after an unexpected exit.
 */
class BagWorkerProcess {
  private proc: ChildProcess | null = null;
  private stdoutBuf = "";
  private active: { resolve: (csv: string) => void; reject: (err: Error) => void } | null = null;
  private queue: QueuedRequest[] = [];

  /**
   * Parse a BAG file at `bagPath` (absolute path to a temp file).
   * Returns the raw CSV string (lon,lat,depth rows).
   */
  parseFile(bagPath: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.active === null) {
        this.active = { resolve, reject };
        this._ensureProc().stdin!.write(bagPath + "\n");
      } else {
        this.queue.push({ path: bagPath, resolve, reject });
      }
    });
  }

  /**
   * Gracefully shut down the worker process.
   * Closing stdin signals EOF to the Python worker, which exits cleanly.
   * In tests, prefer letting the OS process exit handle cleanup (via unref)
   * so the shared worker stays alive across multiple test files.
   */
  shutdown(): void {
    const p = this.proc;
    this.proc = null;
    if (p) {
      try {
        p.stdin?.end();
      } catch {
        // ignore
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _ensureProc(): ChildProcess {
    if (this.proc) return this.proc;

    const scriptPath = findBagWorkerScript();
    const pythonUserBase = findPythonUserBase(scriptPath);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(pythonUserBase ? { PYTHONUSERBASE: pythonUserBase } : {}),
    };

    const proc = spawn("python3", [scriptPath], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Don't keep the Node process alive just because the worker is running.
    proc.unref();

    // Spawn failure (e.g. python3 not found) — reject the in-flight request
    // instead of emitting an unhandled 'error' event that would crash Node.
    proc.on("error", (spawnErr) => {
      this.proc = null;
      const cur = this.active;
      const pending = [...this.queue];
      this.active = null;
      this.queue = [];
      this.stdoutBuf = "";
      const err = new Error(`BAG parse error: failed to spawn python3 — ${spawnErr.message}`);
      if (cur) cur.reject(err);
      for (const q of pending) q.reject(err);
    });

    proc.stdout!.on("data", (chunk: Buffer) => {
      this.stdoutBuf += chunk.toString("utf8");
      this._drain();
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text && text !== "bag_worker: ready") {
        logger.warn({ source: "bag_worker.py" }, text);
      }
    });

    proc.on("exit", (code, signal) => {
      this.proc = null;
      // Reject any in-flight or queued request so callers don't hang.
      const cur = this.active;
      const pending = [...this.queue];
      this.active = null;
      this.queue = [];
      this.stdoutBuf = "";
      if (cur) {
        cur.reject(
          new Error(
            `bag_worker.py exited unexpectedly (code=${code}, signal=${signal})`,
          ),
        );
      }
      for (const q of pending) {
        q.reject(
          new Error(
            `bag_worker.py exited unexpectedly (code=${code}, signal=${signal})`,
          ),
        );
      }
    });

    this.proc = proc;
    return proc;
  }

  /** Process any complete response frames in stdoutBuf. */
  private _drain(): void {
    const OK_MARKER = "\n__OK__\n";
    const ERR_MARKER = "\n__ERR__\t";

    while (this.active) {
      const okIdx = this.stdoutBuf.indexOf(OK_MARKER);
      const errIdx = this.stdoutBuf.indexOf(ERR_MARKER);

      // Determine which (if any) marker appears first.
      let which: "ok" | "err" | null = null;
      if (okIdx !== -1 && (errIdx === -1 || okIdx <= errIdx)) which = "ok";
      else if (errIdx !== -1) which = "err";

      if (which === "ok") {
        const csv = this.stdoutBuf.slice(0, okIdx);
        this.stdoutBuf = this.stdoutBuf.slice(okIdx + OK_MARKER.length);
        const cur = this.active;
        this.active = null;
        this._next();
        cur.resolve(csv);
      } else if (which === "err") {
        const afterTag = this.stdoutBuf.slice(errIdx + ERR_MARKER.length);
        const nlIdx = afterTag.indexOf("\n");
        if (nlIdx === -1) break; // incomplete line — wait for more data
        const rawMsg = afterTag.slice(0, nlIdx);
        this.stdoutBuf = afterTag.slice(nlIdx + 1);
        const cur = this.active;
        this.active = null;
        this._next();
        // Restore escaped newlines so error messages remain readable.
        const msg = rawMsg.replace(/\\n/g, "\n");
        cur.reject(new Error(`BAG parse error: ${msg}`));
      } else {
        break; // no complete frame yet
      }
    }
  }

  /** Dispatch the next queued request, if any. */
  private _next(): void {
    if (this.queue.length === 0) return;
    const next = this.queue.shift()!;
    this.active = { resolve: next.resolve, reject: next.reject };
    this._ensureProc().stdin!.write(next.path + "\n");
  }
}

// ---------------------------------------------------------------------------
// Cross-file singleton via global symbol
// ---------------------------------------------------------------------------
//
// Storing the instance under a well-known Symbol.for key ensures that even
// when vitest re-imports this module for each test file (module isolation),
// the same BagWorkerProcess — and the same Python child process — is reused
// for the entire vitest run (all files share one OS process via singleFork).

const WORKER_GLOBAL_KEY = Symbol.for("bathyscan.bagWorkerProcess");

function getOrCreateWorker(): BagWorkerProcess {
  const g = globalThis as Record<symbol, BagWorkerProcess | undefined>;
  if (!g[WORKER_GLOBAL_KEY]) {
    g[WORKER_GLOBAL_KEY] = new BagWorkerProcess();
  }
  return g[WORKER_GLOBAL_KEY]!;
}

/** Singleton persistent worker — shared across all parseBag() calls. */
export const bagWorker = getOrCreateWorker();
