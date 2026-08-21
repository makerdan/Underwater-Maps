import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { discoverExports } from "../check-api-route-schema-drift.mjs";

test("discovers direct exports, export-star barrels, and named aliases", () => {
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-zod-export-test-"));
  try {
    fs.writeFileSync(path.join(packageDir, "index.ts"), [
      "export * from './schemas';",
      "export { Foo as RenamedFoo } from './aliases';",
      "const Local = 1;",
      "export { Local as LocalAlias };",
    ].join("\n"));
    fs.writeFileSync(path.join(packageDir, "schemas.ts"), "export const FromStar = 1;\n");
    fs.writeFileSync(path.join(packageDir, "aliases.ts"), "const Foo = 1;\nexport { Foo };\n");

    const exported = discoverExports(packageDir);
    assert.equal(exported.has("FromStar"), true);
    assert.equal(exported.has("RenamedFoo"), true);
    assert.equal(exported.has("LocalAlias"), true);
    assert.equal(exported.has("Foo"), false);
  } finally {
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
});

test("reports a clear diagnostic when a source directory is missing", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "api-zod-drift-missing-"));
  try {
    const scriptDir = path.join(fixtureRoot, "scripts");
    fs.mkdirSync(scriptDir);
    fs.copyFileSync(
      fileURLToPath(new URL("../check-api-route-schema-drift.mjs", import.meta.url)),
      path.join(scriptDir, "check-api-route-schema-drift.mjs"),
    );
    const result = spawnSync(process.execPath, [path.join(scriptDir, "check-api-route-schema-drift.mjs")], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /check-api-route-schema-drift: directory not found:/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});