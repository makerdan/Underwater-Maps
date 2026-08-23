---
name: orval "Failed to resolve input" root cause
description: The misleading Orval error means openapi.yaml could not be parsed, commonly because of duplicate keys or invalid indentation.
---

## Rule
When orval 8.9.1 reports `🛑 project - Failed to resolve input: Please provide a valid string value or pass a loader to process the input`, the real cause is a YAML parsing failure in `openapi.yaml` — most commonly a **duplicate map key** or invalid indentation — not a missing file, wrong path, or config loading failure.

**Why:** `@scalar/json-magic`'s `readFiles()` plugin reads the YAML file with `fs.readFile`, then calls `normalize()` which calls `yaml.parse()`. A duplicate key or bad indentation makes parsing throw. That exception is caught by `readFile`'s try/catch, which silently returns `{ ok: false }`. `resolveContents` then sees no successful plugin match and throws the misleading "Failed to resolve input" error. Orval catches that and logs it per-project, making it look like an input path problem.

**How to apply:**
1. When you see this error, run: `node -e "const y=require('yaml'); y.parse(require('fs').readFileSync('lib/api-spec/openapi.yaml','utf8'))"`
2. If that throws, fix the duplicate key or indentation at the reported line.
3. After fixing openapi.yaml, run `pnpm --filter @workspace/api-spec run codegen:generate` — orval will succeed and write a fresh stamp.

## Secondary cause: InputTransformerFn type import
`InputTransformerFn` is a type-only export from orval's ESM build and is not present in `dist/index.mjs`. In orval.config.ts, always use `import type { InputTransformerFn }` (not a value import) so jiti erases it instead of trying to import it at runtime.

## Secondary cause: __dirname in jiti ESM context
jiti v2 may process TypeScript configs as ESM regardless of the package `"type"` field. The safe pattern:
```typescript
function _getDir(): string {
  try { return eval("__dirname") as string; }
  catch { return path.dirname(fileURLToPath(import.meta.url)); }
}
```
