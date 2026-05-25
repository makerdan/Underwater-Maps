#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");

const required = [
  "lib/api-client-react/src/generated/api.ts",
  "lib/api-client-react/src/generated/api.schemas.ts",
  "lib/api-zod/src/generated/api.ts",
];

const missing = required.filter((p) => !existsSync(resolve(root, p)));

if (missing.length > 0) {
  console.error("ERROR: Generated API client files are missing:");
  for (const p of missing) console.error(`  - ${p}`);
  console.error("");
  console.error("These files are produced from lib/api-spec/openapi.yaml and are");
  console.error("git-ignored. They should be regenerated automatically on");
  console.error("`pnpm install` (via the workspace postinstall hook).");
  console.error("");
  console.error("To regenerate them manually, run:");
  console.error("  pnpm --filter @workspace/api-spec run codegen");
  process.exit(1);
}

console.log("check:codegen — all generated API client files present.");
