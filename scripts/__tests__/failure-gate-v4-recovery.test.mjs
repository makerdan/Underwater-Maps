import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { test } from "node:test";
import {
  assertRecordedRunStopped,
  captureRunProcessIdentity,
} from "../failure-gate-v4/recovery.mjs";

const linuxOnly = { skip: process.platform !== "linux" };

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function killGroup(groupId) {
  try {
    process.kill(-groupId, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function waitForStoppedGroup(identity, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return assertRecordedRunStopped(identity);
    } catch (error) {
      if (!/checked launcher is still running|process-group member is still running/.test(error.message)) {
        throw error;
      }
      await delay(20);
    }
  }
  throw new Error("timed out waiting for checked-run process group to stop");
}

async function startDetached(code, options = {}) {
  const child = spawn(process.execPath, ["-e", code], {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
  const exited = once(child, "exit");
  await once(child, "spawn");
  return { child, exited };
}

async function waitForLine(stream, timeoutMs = 4000) {
  const reader = createInterface({ input: stream });
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      clearTimeout(timeout);
      reader.removeListener("line", onLine);
      reader.removeListener("close", onClose);
      reader.close();
      callback(value);
    };
    const onLine = (line) => finish(resolve, line);
    const onClose = () => finish(reject, new Error("child process fixture exited before reporting its descendant"));
    const timeout = setTimeout(
      () => finish(reject, new Error("timed out waiting for child process fixture")),
      timeoutMs,
    );
    reader.once("line", onLine);
    reader.once("close", onClose);
  });
}

async function cleanupChild(child, exited) {
  if (Number.isSafeInteger(child?.pid)) killGroup(child.pid);
  if (exited) await withTimeout(exited, 2000, "timed out cleaning up checked-run child fixture").catch(() => {});
}

test("a live checked-run process group blocks recovery release", linuxOnly, async (t) => {
  const { child, exited } = await startDetached("setInterval(() => {}, 1000);");
  t.after(() => cleanupChild(child, exited));

  const identity = captureRunProcessIdentity(child.pid);
  assert.equal(identity.processGroupId, child.pid);
  assert.throws(
    () => assertRecordedRunStopped(identity),
    /checked launcher is still running/,
  );
});

test("a killed leader cannot release recovery while a descendant remains in its group", linuxOnly, async (t) => {
  const code = [
    'const { spawn } = require("node:child_process");',
    `const survivor = spawn(${JSON.stringify(process.execPath)}, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });`,
    'survivor.once("spawn", () => process.stdout.write(String(survivor.pid) + "\\n"));',
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const { child, exited } = await startDetached(code);
  t.after(() => cleanupChild(child, exited));
  const survivorPid = Number(await waitForLine(child.stdout));
  assert.ok(Number.isSafeInteger(survivorPid) && survivorPid > 0);

  const identity = captureRunProcessIdentity(child.pid);
  process.kill(child.pid, "SIGTERM");
  await withTimeout(
    exited,
    4000,
    "timed out waiting for checked-run leader to exit",
  );
  assert.throws(
    () => assertRecordedRunStopped(identity),
    /process-group member is still running/,
  );

  killGroup(identity.processGroupId);
  assert.deepEqual(await waitForStoppedGroup(identity), {
    stopped: true,
    reason: "recorded process group has no live members",
  });
});

test("missing or malformed recorded process identity blocks recovery", linuxOnly, () => {
  for (const identity of [
    undefined,
    null,
    {},
    { pid: process.pid, processGroupId: process.pid + 1, startTicks: "1", bootId: "a".repeat(36) },
    { pid: process.pid, processGroupId: process.pid, startTicks: "not-a-number", bootId: "a".repeat(36) },
  ]) {
    assert.throws(
      () => assertRecordedRunStopped(identity),
      /recorded process-group identity is unavailable or malformed/,
    );
  }
});

test("an actually stopped checked-run group permits recovery release", linuxOnly, async (t) => {
  const { child, exited } = await startDetached("setInterval(() => {}, 1000);");
  t.after(() => cleanupChild(child, exited));

  const identity = captureRunProcessIdentity(child.pid);
  killGroup(identity.processGroupId);
  await withTimeout(
    exited,
    4000,
    "timed out waiting for stopped group fixture",
  );
  assert.deepEqual(await waitForStoppedGroup(identity), {
    stopped: true,
    reason: "recorded process group has no live members",
  });
});