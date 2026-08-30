import assert from "node:assert/strict";
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const archive = join(root, "exports/port-authority-skills.zip");
const packageGuard = join(root, "scripts/check-port-authority-zip-stale.mjs");
const expectedEntries = [
  "Port-Authority/SKILL.md",
  "Port-Authority/scripts/free-ports.mjs",
  "Port-Authority/scripts/validation-lock.mjs",
  "Port-Authority-Heavy/SKILL.md",
].sort();

function runNode(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout ?? 15_000,
  });
}

function extractedFile(directory, entry) {
  return join(directory, ...entry.split("/"));
}

function extractArchive(directory) {
  const result = spawnSync("unzip", ["-q", archive, "-d", directory], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

test("published archive has the exact canonical package and no obsolete lock template", () => {
  const listed = runNode(packageGuard, []);
  assert.equal(listed.status, 0, listed.stderr);

  const entries = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    .stdout.split(/\r?\n/)
    .filter((entry) => entry && !entry.endsWith("/"))
    .sort();
  assert.deepEqual(entries, expectedEntries);
});

test("archive skill and templates match tracked sources byte-for-byte", () => {
  const directory = mkdtempSync(join(tmpdir(), "pa-archive-"));
  try {
    extractArchive(directory);
    for (const entry of expectedEntries) {
      const source = entry.startsWith("Port-Authority/")
        ? join(root, ".agents/skills", entry)
        : join(root, ".agents/skills", entry);
      assert.deepEqual(
        readFileSync(extractedFile(directory, entry)),
        readFileSync(source),
        `${entry} drifted from its canonical source`,
      );
    }
    assert.equal(existsSync(extractedFile(directory, "Port-Authority/scripts/serial-lock.mjs")), false);
    const skill = readFileSync(extractedFile(directory, "Port-Authority/SKILL.md"), "utf8");
    for (const tier of ["test-fast", "test-standard", "test-standard-plus", "test-heavy"]) {
      assert.match(skill, new RegExp(`\\\`${tier}\\\``));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("extracted templates reject unsafe input and pass isolated smoke checks", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pa-template-"));
  const project = join(directory, "project");
  const scripts = join(project, "scripts");
  mkdirSync(scripts, { recursive: true });
  try {
    extractArchive(directory);
    const freePorts = extractedFile(directory, "Port-Authority/scripts/free-ports.mjs");
    const lock = extractedFile(directory, "Port-Authority/scripts/validation-lock.mjs");
    const freeInvalid = runNode(freePorts, ["0"], { cwd: project });
    assert.equal(freeInvalid.status, 2);
    const freeUnknown = runNode(freePorts, ["--unexpected", "1234"], { cwd: project });
    assert.equal(freeUnknown.status, 2);
    const freeProduction = runNode(freePorts, ["1234"], {
      cwd: project,
      env: { NODE_ENV: "production", REPLIT_DEV_DOMAIN: "" },
    });
    assert.equal(freeProduction.status, 2);
    const noHolderPort = await unusedPort();
    const noHolder = runNode(freePorts, [String(noHolderPort)], {
      cwd: project,
      env: { NODE_ENV: "test" },
    });
    assert.equal(noHolder.status, 0, noHolder.stderr);

    const lockInvalid = runNode(lock, ["--priority", "0", "--", process.execPath, "-e", ""], {
      cwd: project,
      env: { NODE_ENV: "test", VALIDATION_LOCK_FILE: join(project, ".isolated", "invalid.lock") },
    });
    assert.equal(lockInvalid.status, 2);

    const lockFile = join(project, ".isolated", "smoke.lock");
    const success = runNode(lock, ["--resource", "smoke", "--", process.execPath, "-e", ""], {
      cwd: project,
      env: { NODE_ENV: "test", VALIDATION_LOCK_FILE: lockFile },
    });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(existsSync(lockFile), false);

    const failure = runNode(
      lock,
      ["--resource", "smoke", "--", process.execPath, "-e", "process.exit(7)"],
      {
        cwd: project,
        env: { NODE_ENV: "test", VALIDATION_LOCK_FILE: lockFile },
      },
    );
    assert.equal(failure.status, 7, failure.stderr);
    assert.equal(existsSync(lockFile), false);

    writeFileSync(lockFile, "999999\n1\n");
    const stale = runNode(lock, ["--resource", "smoke", "--", process.execPath, "-e", ""], {
      cwd: project,
      env: { NODE_ENV: "test", VALIDATION_LOCK_FILE: lockFile },
    });
    assert.equal(stale.status, 0, stale.stderr);
    assert.match(stale.stderr, /forcibly reclaiming stale lock/);

    const reentrant = runNode(lock, ["--resource", "smoke", "--", process.execPath, lock, "--resource", "smoke", "--", process.execPath, "-e", ""], {
      cwd: project,
      env: {
        NODE_ENV: "test",
        VALIDATION_LOCK_FILE: lockFile,
        VALIDATION_LOCK_POLL_MS: "10",
      },
    });
    assert.equal(reentrant.status, 0, reentrant.stderr);
    assert.match(reentrant.stdout, /running reentrantly/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});