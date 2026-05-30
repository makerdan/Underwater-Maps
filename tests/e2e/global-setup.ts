import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..");

const requiredFiles = [
  "lib/api-client-react/src/generated/api.ts",
  "lib/api-client-react/src/generated/api.schemas.ts",
  "lib/api-zod/src/generated/api.ts",
];

const missing = requiredFiles.some((p) => !existsSync(resolve(root, p)));

export default function globalSetup() {
  if (missing) {
    console.log("[global-setup] Generated API files missing — running codegen…");
    execSync("pnpm --filter @workspace/api-spec run codegen", {
      cwd: root,
      stdio: "inherit",
    });
    console.log("[global-setup] Codegen complete.");
  } else {
    console.log("[global-setup] Generated API files present — skipping codegen.");
  }
}
