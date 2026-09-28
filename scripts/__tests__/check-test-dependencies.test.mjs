import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkTestDependencies } from "../lib/check-test-dependencies.mjs";

test("test dependency preflight checks links in every declared workspace package", () => {
  const root = mkdtempSync(join(tmpdir(), "test-deps-"));
  const packageDir = join(root, "lib/api-zod");
  const dbDir = join(root, "lib/db");
  const vitestDir = join(root, "node_modules/vitest");
  try {
    mkdirSync(join(root, "artifacts"), { recursive: true });
    mkdirSync(join(root, "lib/integrations"), { recursive: true });
    mkdirSync(join(packageDir, "node_modules"), { recursive: true });
    mkdirSync(join(dbDir, "node_modules"), { recursive: true });
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({
      name: "@workspace/api-zod",
      devDependencies: { vitest: "3.2.7" },
    }));
    writeFileSync(join(dbDir, "package.json"), JSON.stringify({
      name: "@workspace/db",
      devDependencies: { vitest: "3.2.7" },
    }));
    assert.throws(() => checkTestDependencies(root), /pnpm install --frozen-lockfile/);
    symlinkSync(vitestDir, join(packageDir, "node_modules/vitest"));
    assert.throws(() => checkTestDependencies(root), /pnpm install --frozen-lockfile/);
    mkdirSync(vitestDir, { recursive: true });
    writeFileSync(join(vitestDir, "package.json"), JSON.stringify({
      name: "vitest",
      version: "3.2.7",
      main: "index.js",
    }));
    writeFileSync(join(vitestDir, "index.js"), "module.exports = {};\n");
    assert.throws(() => checkTestDependencies(root), /@workspace\/db.*pnpm install --frozen-lockfile/);
    symlinkSync(join(root, "missing-vitest"), join(dbDir, "node_modules/vitest"));
    assert.throws(() => checkTestDependencies(root), /@workspace\/db.*pnpm install --frozen-lockfile/);
    unlinkSync(join(dbDir, "node_modules/vitest"));
    symlinkSync(vitestDir, join(dbDir, "node_modules/vitest"));
    assert.doesNotThrow(() => checkTestDependencies(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});