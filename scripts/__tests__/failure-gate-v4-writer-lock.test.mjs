import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runWriterLocked, withWriterLock, WriterLockTimeout } from "../failure-gate-v4/writer-lock.mjs";

const moduleUrl = new URL("../failure-gate-v4/writer-lock.mjs", import.meta.url);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));

async function makeSandbox() {
  const root = await mkdtemp(path.join(testDirectory, ".failure-gate-writer-lock-"));
  return {
    root,
    lockPath: path.join(root, "writer.lock"),
    file(name) {
      return path.join(root, name);
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function waitForFile(filePath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(filePath);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await delay(10);
    }
  }
  assert.fail(`timed out waiting for ${filePath}`);
}

function childSource() {
  return `import { runWriterLocked } from ${JSON.stringify(moduleUrl.href)};
const status = await runWriterLocked(process.argv[1], [process.execPath, "-e", process.argv[2], ...process.argv.slice(3, -1)], { timeoutMs: Number(process.argv.at(-1) ?? 2000) });
process.exitCode = status;`;
}

function launchLocked(lockPath, code, args = [], timeoutMs = 2000) {
  return spawn(process.execPath, [
    "--input-type=module",
    "-e",
    childSource(),
    lockPath,
    code,
    ...args,
    String(timeoutMs),
  ], { stdio: "ignore" });
}

function waitForExit(child, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("timed out waiting for child process"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test("serializes cooperating foreground writers", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  const events = box.file("events");
  const started = box.file("started");
  const first = launchLocked(box.lockPath,
    "const fs = await import('node:fs/promises'); const [events, started] = process.argv.slice(1); await fs.appendFile(events, 'first-start\\n'); await fs.writeFile(started, 'yes'); await new Promise(r => setTimeout(r, 180)); await fs.appendFile(events, 'first-end\\n');",
    [events, started]);
  await waitForFile(started);
  const second = launchLocked(box.lockPath,
    "const fs = await import('node:fs/promises'); await fs.appendFile(process.argv[1], 'second\\n');",
    [events]);

  assert.deepEqual(await waitForExit(first), { code: 0, signal: null });
  assert.deepEqual(await waitForExit(second), { code: 0, signal: null });
  assert.equal(await readFile(events, "utf8"), "first-start\nfirst-end\nsecond\n");
});

test("timeout fails closed without running the protected operation", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  let ran = false;
  const held = withWriterLock(box.lockPath, async () => new Promise((resolve) => setTimeout(resolve, 180)));
  await delay(30);
  await assert.rejects(
    withWriterLock(box.lockPath, () => { ran = true; }, { timeoutMs: 40 }),
    WriterLockTimeout,
  );
  assert.equal(ran, false);
  await held;
});

test("failed foreground commands preserve status and release the lock", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  assert.equal(await runWriterLocked(box.lockPath, [process.execPath, "-e", "process.exit(17)"]), 17);
  assert.equal(await runWriterLocked(box.lockPath, [process.execPath, "-e", "process.exit(0)"]), 0);
});

test("rejects a symlink lock path", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  const target = box.file("target");
  await writeFile(target, "");
  await import("node:fs/promises").then(({ symlink }) => symlink(target, box.lockPath));
  await assert.rejects(withWriterLock(box.lockPath, () => {}));
});

test("final input check and terminal write exclude a waiting cooperating writer", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  const input = box.file("input");
  const terminal = box.file("terminal");
  const checked = box.file("checked");
  const writerDone = box.file("writer-done");
  await writeFile(input, "original");

  const finalCheck = launchLocked(box.lockPath,
    "const fs = await import('node:fs/promises'); const [input, terminal, checked] = process.argv.slice(1); const seen = await fs.readFile(input, 'utf8'); await fs.writeFile(checked, 'yes'); await new Promise(r => setTimeout(r, 180)); await fs.writeFile(terminal, seen);",
    [input, terminal, checked]);
  await waitForFile(checked);
  const writer = launchLocked(box.lockPath,
    "const fs = await import('node:fs/promises'); const [input, done] = process.argv.slice(1); await fs.writeFile(input, 'changed'); await fs.writeFile(done, 'yes');",
    [input, writerDone]);

  assert.deepEqual(await waitForExit(finalCheck), { code: 0, signal: null });
  assert.equal(await readFile(terminal, "utf8"), "original");
  assert.deepEqual(await waitForExit(writer), { code: 0, signal: null });
  await waitForFile(writerDone);
  assert.equal(await readFile(input, "utf8"), "changed");
});

test("a foreground child retains the lock if its wrapper is killed", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  const started = box.file("started");
  const finished = box.file("finished");
  const child = launchLocked(box.lockPath,
    "const fs = await import('node:fs/promises'); const [started, finished] = process.argv.slice(1); await fs.writeFile(started, 'yes'); await new Promise(r => setTimeout(r, 300)); await fs.writeFile(finished, 'yes');",
    [started, finished]);
  await waitForFile(started);
  child.kill("SIGKILL");
  assert.equal((await waitForExit(child)).signal, "SIGKILL");

  await assert.rejects(
    withWriterLock(box.lockPath, () => {}, { timeoutMs: 50 }),
    WriterLockTimeout,
  );
  await waitForFile(finished);
  await withWriterLock(box.lockPath, () => {}, { timeoutMs: 1000 });
});