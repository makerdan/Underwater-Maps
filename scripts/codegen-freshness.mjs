/**
 * Shared codegen freshness check used by run-tier.mjs and test-all-steps.mjs.
 *
 * Returns true when the generated api.ts is strictly newer than all codegen
 * inputs (openapi.yaml and orval.config.ts), meaning codegen can be safely
 * skipped. A same-mtime input is treated as stale (>=) because it may be a
 * same-second write.
 */
import { statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

export function isCodegenFresh() {
  const generatedFile = resolve(root, "lib/api-zod/src/generated/api.ts");
  const inputs = [
    resolve(root, "lib/api-spec/openapi.yaml"),
    resolve(root, "lib/api-spec/orval.config.ts"),
  ];
  try {
    const generatedMtime = statSync(generatedFile).mtimeMs;
    for (const input of inputs) {
      if (statSync(input).mtimeMs >= generatedMtime) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
