#!/usr/bin/env node
/**
 * Verify the latest October 3 Failure Gate v4 resource package and its
 * complete distributions. The previous versions are retained privately by
 * skill-zip-retention.mjs for seven days.
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(root, ".agents/skills/failure-gate-v4");
const packagePaths = [
  "artifacts/bathyscan/public/failure-gate-v4-skill.zip",
  "exports/failure-gate-v4.zip",
  "attached_assets/Failure_Gate_v4_(10.03.2026)_1791073121183.zip",
];
const obsoletePaths = [
  ".agents/skills/failure-gate",
  "artifacts/bathyscan/public/failure-gate-skill.zip",
  "exports/failure-gate.zip",
  "exports/failure-gate-skill.zip",
  "attached_assets/Failure_Gate_v4_(09.27.2026)_1790561592000.zip",
  "attached_assets/Failure_Gate_v4_(10.01.2026)_1790902511443.zip",
  "attached_assets/Failure_Gate_v4_(10.03.2026)_1791071265080.zip",
];
const expectedHashes = {
  "SKILL.md": "70e624776e9202062ed551d5f96042276f61f3be0e2e5987f0737c9a7358b418",
  "README.md": "b6bea4921bdc00ff194e0f0ec53c16218994183429a86eef241560179b2cc415",
  "reference/implementation.md": "ee3a928f15606e63a16b02a82b0c84e60fa3d6a31812336b8d17fe952a7d7b83",
  "reference/evidence-and-recovery.md": "b39367bfbda5f176804613e2aa5bc98d6ef72494f398a0893c9ae89fc8573e2c",
  "reference/acceptance.md": "44de7f5cededc5eaeeb1e12de09a75e20d50c99d44e020b9a54ed6b7af620e60",
  "reference/owner-directed-closure.md": "e4c22039b735919adf6502284a6920cb1ad8da2beeee7e256fe775fa39a56641",
  "reference/adapters/posix-writer-lock/README.md": "e4d30359e7436332b6f322ff116c9f3aec2f50b1667775b90dccc6fb96f766f1",
  "reference/adapters/posix-writer-lock/writer_lock.py": "3d4474496bf2019e58c35f8002b600275b06c35884f9d5407671c67e7e06f654",
  "reference/adapters/posix-writer-lock/tests/test_writer_lock.py": "777035d2a9ceae4c976734125869686b9d713f0dec008dba18692e119a8eedb8",
};
const errors = [];

function fail(message) {
  errors.push(message);
}

function collectFiles(directory, packageRoot = directory) {
  const files = [];
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Package contains a symlink: ${relative(packageRoot, path)}`);
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(relative(packageRoot, path).split("\\").join("/"));
      else throw new Error(`Package contains a special file: ${relative(packageRoot, path)}`);
    }
  }
  visit(directory);
  return files.sort();
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function zipFiles(zipPath) {
  const result = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  if (result.status !== 0) {
    const details = result.stderr?.trim();
    throw new Error(`Could not list ${relative(root, zipPath)}${details ? `: ${details}` : ""}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((entry) => !entry.endsWith("/"))
    .map((entry) => entry.replace(/^\.\//, ""))
    .sort();
}

function readZipEntry(zipPath, entry) {
  const result = spawnSync("unzip", ["-p", zipPath, entry], { maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Could not read ${entry} from ${relative(root, zipPath)}`);
  return result.stdout;
}

function checkLocalMarkdownReferences(files) {
  for (const file of files.filter((path) => path.toLowerCase().endsWith(".md"))) {
    const source = readFileSync(join(sourceRoot, file), "utf8");
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].trim().replace(/^<|>$/g, "").split(/\s+["']/)[0];
      if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const pathPart = decodeURIComponent(target.split(/[?#]/, 1)[0]);
      if (!pathPart) continue;
      if (!existsSync(resolve(sourceRoot, dirname(file), pathPart))) {
        fail(`${file} has a broken local Markdown reference: ${target}`);
      }
    }
  }
}

try {
  if (!existsSync(sourceRoot) || !lstatSync(sourceRoot).isDirectory()) {
    fail("Canonical source directory .agents/skills/failure-gate-v4 is missing.");
  } else {
    const skill = readFileSync(join(sourceRoot, "SKILL.md"), "utf8");
    if (!/^name:\s*failure-gate-v4\s*$/m.test(skill)) {
      fail("Canonical SKILL.md does not declare name: failure-gate-v4.");
    }
    if (!/^#\s+Failure Gate v4\b/m.test(skill)) {
      fail("Canonical SKILL.md is missing the Failure Gate v4 heading.");
    }

    const files = collectFiles(sourceRoot);
    const expectedFiles = Object.keys(expectedHashes).sort();
    if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
      fail("Canonical package file set differs from the latest complete v4 package.");
    }
    for (const file of files) {
      const actualHash = digest(readFileSync(join(sourceRoot, file)));
      if (actualHash !== expectedHashes[file]) {
        fail(`${file} does not match the latest Failure Gate v4 bundle (SHA-256 ${actualHash}).`);
      }
    }
    checkLocalMarkdownReferences(files);

    for (const relativePath of packagePaths) {
      const zipPath = resolve(root, relativePath);
      if (!existsSync(zipPath)) {
        fail(`Required latest v4 ZIP is missing: ${relativePath}`);
        continue;
      }
      try {
        const archivedFiles = zipFiles(zipPath);
        if (JSON.stringify(archivedFiles) !== JSON.stringify(files)) {
          fail(`${relativePath} has a different file set from the canonical v4 package.`);
          continue;
        }
        for (const file of files) {
          if (!readZipEntry(zipPath, file).equals(readFileSync(join(sourceRoot, file)))) {
            fail(`${relativePath} contains stale content for ${file}.`);
          }
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    }

    const exportDirectory = resolve(root, "exports/failure-gate-v4");
    if (!existsSync(exportDirectory) || !lstatSync(exportDirectory).isDirectory()) {
      fail("Complete unzipped package export exports/failure-gate-v4 is missing.");
    } else {
      const exportedFiles = collectFiles(exportDirectory);
      if (JSON.stringify(exportedFiles) !== JSON.stringify(files)) {
        fail("exports/failure-gate-v4 has a different file set from the canonical v4 package.");
      }
      for (const file of files) {
        const path = join(exportDirectory, file);
        if (!existsSync(path) || !readFileSync(path).equals(readFileSync(join(sourceRoot, file)))) {
          fail(`exports/failure-gate-v4 contains stale content for ${file}.`);
        }
      }
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

for (const relativePath of obsoletePaths) {
  if (existsSync(resolve(root, relativePath))) fail(`Superseded active copy remains: ${relativePath}`);
}

const agentRulesPath = resolve(root, "replit.md");
if (existsSync(agentRulesPath)) {
  const agentRules = readFileSync(agentRulesPath, "utf8");
  if (agentRules.includes(".agents/skills/failure-gate/SKILL.md")) {
    fail("Agent instructions still direct readers to the superseded Failure Gate skill.");
  }
}

if (errors.length > 0) {
  console.error("[check-failure-gate-v4-bundle] FAIL");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log("[check-failure-gate-v4-bundle] OK — latest complete v4 package and its distributions match.");