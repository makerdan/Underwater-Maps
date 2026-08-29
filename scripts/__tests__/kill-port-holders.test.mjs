import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cleanupScript = resolve(root, "scripts/kill-port-holders.mjs");

function runCleanup(args, env = {}) {
  return spawnSync(process.execPath, [cleanupScript, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "development",
      REPLIT_DEPLOYMENT: "",
      REPLIT_ENVIRONMENT: "development",
      REPLIT_DEV_DOMAIN: "dev.example.test",
      ...env,
    },
    timeout: 15_000,
  });
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForPort(port, expectedOpen) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const open = await new Promise((resolveProbe) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolveProbe(true);
      });
      socket.once("error", () => resolveProbe(false));
    });
    if (open === expectedOpen) return;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 50));
  }
  assert.fail(`port ${port} did not become ${expectedOpen ? "open" : "closed"}`);
}

test("rejects invalid, unknown, recursive, and production invocations", () => {
  assert.equal(runCleanup(["0"]).status, 2);
  assert.equal(runCleanup(["65536"]).status, 2);
  assert.equal(runCleanup(["--unknown"]).status, 2);
  assert.equal(runCleanup(["--e2e", "1234"]).status, 2);
  assert.equal(runCleanup(["--e2e"], { E2E_WEB_PORT: "65536" }).status, 2);
  assert.equal(runCleanup(["1234"], { KILL_PORT_HOLDERS_RUNNING: "1" }).status, 0);
  assert.equal(
    runCleanup(["1234"], { NODE_ENV: "production", REPLIT_DEV_DOMAIN: "" }).status,
    2,
  );
  assert.equal(
    runCleanup(["1234"], { REPLIT_DEPLOYMENT: "1", REPLIT_DEV_DOMAIN: "" }).status,
    2,
  );
});

test("terminates an orphaned wrapper tree and confirms the port is free", async () => {
  const port = await unusedPort();
  const listenerSource = [
    "const net = require('node:net');",
    `const server = net.createServer().listen(${port}, '127.0.0.1');`,
    "setInterval(() => {}, 1000);",
  ].join("");
  const bootstrapSource = [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(listenerSource)}], { stdio: 'ignore' });`,
    "setTimeout(() => process.exit(0), 100);",
  ].join("");
  const bootstrap = spawn(process.execPath, ["-e", bootstrapSource], {
    cwd: root,
    detached: true,
    stdio: "ignore",
  });
  bootstrap.unref();

  await waitForPort(port, true);
  // Let the short-lived bootstrap exit so the listener is reparented away
  // from this test process; otherwise the cleanup guard correctly protects it.
  await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
  const result = runCleanup([String(port)]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /terminating tree/);
  await waitForPort(port, false);
});