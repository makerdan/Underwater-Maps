/**
 * validation-lock-process-group.test.mjs — regression coverage for forwarding
 * signals to the complete process group owned by validation-lock.mjs.
 *
 * Run: node --test scripts/__tests__/validation-lock-process-group.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const lockScript = join(process.cwd(), "scripts", "validation-lock.mjs");

function processState(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    return status.match(/^State:\s+(.+)$/m)?.[1] ?? null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function waitForFile(path, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return readFileSync(path, "utf8").trim();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForExited(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = processState(pid);
    if (state === null || state.startsWith("Z")) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`process ${pid} was still running after ${timeoutMs}ms (state: ${processState(pid)})`);
}

test("SIGTERM kills the lock-wrapped child and its background descendants", async () => {
  const dir = mkdtempSync(join(tmpdir(), "validation-lock-process-group-"));
  const childPidFile = join(dir, "child.pid");
  const grandchildPidFile = join(dir, "grandchild.pid");
  const commandScript = join(dir, "fork-child.sh");
  const lockFile = join(dir, "validation.lock");
  const waitersDir = join(dir, "waiters");
  const command = [
    "#!/bin/sh",
    `echo $$ > ${childPidFile}`,
    "sleep 30 &",
    `echo $! > ${grandchildPidFile}`,
    "wait",
  ].join("\n");
  writeFileSync(commandScript, command, { mode: 0o755 });

  const lockHolder = spawn(
    process.execPath,
    [lockScript, "--", commandScript],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VALIDATION_LOCK_FILE: lockFile,
        VALIDATION_LOCK_WAITERS_DIR: waitersDir,
        VALIDATION_LOCK_HEARTBEAT_MS: "60000",
      },
      stdio: "ignore",
    },
  );

  try {
    const childPid = Number(await waitForFile(childPidFile));
    const grandchildPid = Number(await waitForFile(grandchildPidFile));
    assert.ok(Number.isInteger(childPid) && childPid > 0);
    assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0);
    assert.notEqual(processState(childPid), null, "wrapped child should be running");
    assert.notEqual(processState(grandchildPid), null, "background descendant should be running");

    lockHolder.kill("SIGTERM");
    await Promise.all([
      waitForExited(childPid),
      waitForExited(grandchildPid),
      new Promise((resolve) => lockHolder.once("exit", resolve)),
    ]);
  } finally {
    if (lockHolder.exitCode === null && lockHolder.signalCode === null) lockHolder.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});