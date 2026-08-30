#!/usr/bin/env node
/**
 * Validate every published Port Authority bundle against canonical sources.
 *
 * This is intentionally a package guard, not only a SKILL.md freshness check:
 * an installer must receive the skill text and both self-contained templates
 * under the names the skill documents. The optional Heavy companion remains in
 * the multi-skill export and is checked there too.
 */
import {
  existsSync, readdirSync, readFileSync, statSync,
} from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standardRoot = resolve(root, ".agents/skills/Port-Authority");
const heavySkill = resolve(root, ".agents/skills/Port-Authority-Heavy/SKILL.md");
const requiredStandard = [
  "Port-Authority/SKILL.md",
  "Port-Authority/scripts/free-ports.mjs",
  "Port-Authority/scripts/validation-lock.mjs",
];
const requiredExport = [...requiredStandard, "Port-Authority-Heavy/SKILL.md"];
const targets = [
  {
    path: resolve(root, "artifacts/bathyscan/public/port-authority-skill.zip"),
    entries: requiredStandard,
  },
  {
    path: resolve(root, "exports/port-authority-skills.zip"),
    entries: requiredExport,
  },
  {
    path: resolve(root, "port-authority-skills.zip"),
    entries: requiredExport.map((entry) => `.agents/skills/${entry}`),
  },
];

function fail(message, detail = "") {
  console.error(`[check-port-authority-zip-stale] FAIL: ${message}`);
  if (detail) console.error(`  ${detail}`);
  console.error("  Regenerate the published Port Authority zip assets from .agents/skills.");
  process.exit(1);
}

function walkFiles(directory, base = directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...walkFiles(path, base));
    else files.push(relative(base, path).split("\\").join("/"));
  }
  return files;
}

function validateMetadata(skillText) {
  if (!skillText.startsWith("---\n")) return "missing YAML frontmatter opener";
  const end = skillText.indexOf("\n---", 4);
  if (end < 0) return "unterminated YAML frontmatter";
  const frontmatter = skillText.slice(4, end);
  const name = frontmatter.match(/^name:\s*([A-Za-z][A-Za-z0-9-]*)\s*$/m);
  if (!name || name[1] !== "Port-Authority") return "frontmatter name must be Port-Authority";
  const description = frontmatter.match(/^description:\s*(.*)$/m);
  if (!description || !description[1].trim()) {
    return "frontmatter description must be a non-empty scalar";
  }
  if (frontmatter.split("\n").some((line) => /^\t/.test(line))) {
    return "frontmatter contains tab indentation";
  }
  return null;
}

function unzipEntries(zipPath) {
  const result = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`cannot list archive ${zipPath}`, result.stderr?.trim());
  }
  return result.stdout.split(/\r?\n/).filter((entry) => entry && !entry.endsWith("/")).sort();
}

function unzipEntry(zipPath, entry) {
  const result = spawnSync("unzip", ["-p", zipPath, entry], { encoding: "buffer" });
  if (result.status !== 0) {
    fail(`archive ${zipPath} is missing '${entry}'`, result.stderr?.toString("utf8").trim());
  }
  return result.stdout;
}

if (!existsSync(standardRoot)) fail("canonical Port-Authority directory is missing", standardRoot);
const sourceEntries = walkFiles(standardRoot).sort();
const expectedSourceEntries = ["SKILL.md", "scripts/free-ports.mjs", "scripts/validation-lock.mjs"];
if (sourceEntries.join("\n") !== expectedSourceEntries.join("\n")) {
  fail(
    "canonical Port-Authority directory has missing, extra, or obsolete files",
    `expected ${expectedSourceEntries.join(", ")}; found ${sourceEntries.join(", ") || "(none)"}`,
  );
}

const skillSource = readFileSync(join(standardRoot, "SKILL.md"));
const metadataError = validateMetadata(skillSource.toString("utf8"));
if (metadataError) fail("canonical SKILL.md has invalid YAML metadata", metadataError);
for (const tier of ["test-fast", "test-standard", "test-standard-plus", "test-heavy"]) {
  if (!skillSource.toString("utf8").includes(`\`${tier}\``)) {
    fail(`canonical SKILL.md omits validation command '${tier}'`);
  }
}
const lockTemplate = readFileSync(join(standardRoot, "scripts/validation-lock.mjs"), "utf8");
const freePortsTemplate = readFileSync(join(standardRoot, "scripts/free-ports.mjs"), "utf8");
if (/serial-lock\.mjs/.test(skillSource) || /serial-lock\.mjs/.test(lockTemplate)) {
  fail("obsolete serial-lock.mjs reference remains in the canonical package");
}
if (/from ['"]\.(?:\/|\\)/.test(lockTemplate) || /require\(['"]\.(?:\/|\\)/.test(lockTemplate)) {
  fail("validation-lock.mjs imports a project-local dependency", "the downloadable template must be self-contained");
}
if (!/FREE_PORTS_RUNNING|FREE_PORTS_DISABLE/.test(freePortsTemplate)) {
  fail("free-ports.mjs is missing its recursion/disable guard");
}

const existingTargets = targets.filter(({ path }) => existsSync(path));
if (existingTargets.length === 0) {
  console.log("[check-port-authority-zip-stale] SKIP — no published Port Authority zip asset exists");
  process.exit(0);
}

for (const target of existingTargets) {
  const actualEntries = unzipEntries(target.path);
  if (actualEntries.join("\n") !== [...target.entries].sort().join("\n")) {
    fail(
      `${target.path} has missing, extra, or renamed archive entries`,
      `expected ${target.entries.join(", ")}; found ${actualEntries.join(", ") || "(none)"}`,
    );
  }
  for (const entry of target.entries) {
    const sourcePath = entry.startsWith(".agents/skills/")
      ? resolve(root, entry)
      : resolve(root, ".agents/skills", entry);
    if (!existsSync(sourcePath)) fail(`canonical source for '${entry}' is missing`, sourcePath);
    if (!unzipEntry(target.path, entry).equals(readFileSync(sourcePath))) {
      fail(`${target.path} contains stale bytes for '${entry}'`);
    }
  }
  const archiveSkillEntry = target.entries.find((entry) => entry.endsWith("/SKILL.md") && !entry.includes("Heavy"));
  const archiveMetadataError = validateMetadata(unzipEntry(target.path, archiveSkillEntry).toString("utf8"));
  if (archiveMetadataError) fail(`${target.path} contains invalid skill metadata`, archiveMetadataError);
}

// Keep the companion source referenced so a deleted Heavy skill cannot silently
// turn the multi-skill export into an uncheckable package.
if (!existsSync(heavySkill)) fail("canonical Port-Authority-Heavy skill is missing", heavySkill);
console.log(`[check-port-authority-zip-stale] OK — ${existingTargets.length} complete package(s) match canonical sources`);
