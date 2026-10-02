#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cleanupScript = resolve(root, "scripts/kill-port-holders.mjs");
const timeoutScript = resolve(root, "scripts/run-with-timeout.mjs");

export function buildPlaywrightRunArgs(playwrightArgs = []) {
  // pnpm run appends its own separator to process.argv after the script path.
  // It is not a Playwright option; forwarding it would make Playwright treat
  // every requested file/filter after it as a positional test path.
  const forwardedArgs =
    playwrightArgs[0] === "--" ? playwrightArgs.slice(1) : playwrightArgs;
  return [
    "e2e",
    "--label",
    "playwright e2e",
    "--",
    "playwright",
    "test",
    ...forwardedArgs,
  ];
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`[run-e2e] Could not start ${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

export function runE2e(playwrightArgs = process.argv.slice(2)) {
  const cleanupStatus = run(process.execPath, [cleanupScript, "--e2e"]);
  if (cleanupStatus !== 0) return cleanupStatus;
  return run(process.execPath, [timeoutScript, ...buildPlaywrightRunArgs(playwrightArgs)]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runE2e();
}