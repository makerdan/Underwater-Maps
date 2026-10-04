#!/usr/bin/env node
/**
 * Retain superseded ZIPs built from .agents/skills privately for seven days.
 * The latest package stays at its normal output path; old archives are never
 * served from public/, downloads/, or exports/.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = resolve(root, ".agents/skills");
const archiveRoot = resolve(root, ".agents/skill-zip-archive");
const manifestPath = join(archiveRoot, "manifest.json");
const archiveRootRelative = ".agents/skill-zip-archive";
const scanRoots = ["attached_assets", "artifacts", "downloads", "exports"];

export function expirationFrom(supersededAt) {
  const timestamp = Date.parse(supersededAt);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid supersededAt timestamp: ${supersededAt}`);
  return new Date(timestamp + RETENTION_MS).toISOString();
}

export function isExpired(record, now = Date.now()) {
  const timestamp = Date.parse(record.expiresAt);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid expiresAt timestamp: ${record.expiresAt}`);
  return timestamp <= now;
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relativePath(path) {
  return relative(root, path).split(sep).join("/");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

function listFiles(directory) {
  const output = [];
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink not allowed in skill package: ${relativePath(path)}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output.push(relative(directory, path).split(sep).join("/"));
      else throw new Error(`Special file not allowed in skill package: ${relativePath(path)}`);
    }
  }
  visit(directory);
  return output.sort();
}

function normalizeSkillName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseSkillName(bytes, entryPath = "", zipPath = "") {
  const text = bytes.toString("utf8");
  const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const header = frontmatter?.[1] ?? text;
  const name = header.match(/^name:\s*(.*?)\s*$/m)?.[1]?.replace(/^["']|["']$/g, "");
  if (name) return normalizeSkillName(name);
  const parent = entryPath ? dirname(entryPath).split(sep).pop() : "";
  if (parent && parent !== ".") return normalizeSkillName(parent);
  if (!zipPath) return null;
  const filename = basename(zipPath)
    .replace(/\.zip$/i, "")
    .replace(/[_-]\d{4}[.-]\d{2}[.-]\d{2}(?:[_-]\d+)?$/i, "")
    .replace(/[_-]\d{10,}$/i, "")
    .replace(/-skill$/i, "");
  return normalizeSkillName(filename) || null;
}

function loadCanonicalSkills() {
  const skills = new Map();
  if (!existsSync(skillsRoot)) return skills;
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = join(skillsRoot, entry.name);
    const skillPath = join(directory, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const bytes = readFileSync(skillPath);
    const name = parseSkillName(bytes);
    if (!name) continue;
    if (skills.has(name)) throw new Error(`Duplicate canonical skill name: ${name}`);
    skills.set(name, { name, directory, directoryName: entry.name, skillPath, bytes });
  }
  return skills;
}

function listZipFiles() {
  const files = [];
  const ignoredDirectories = new Set([".git", ".local", "node_modules", "dist", "build"]);
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) && resolve(path) !== archiveRoot) visit(path);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".zip")) {
        files.push(path);
      }
    }
  }
  for (const directory of scanRoots) {
    const path = resolve(root, directory);
    if (existsSync(path)) visit(path);
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".zip")) files.push(join(root, entry.name));
  }
  return [...new Set(files)].sort();
}

function zipEntries(zipPath) {
  const result = run("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Could not list ${relativePath(zipPath)}: ${result.stderr?.toString().trim() ?? "invalid ZIP"}`);
  }
  return result.stdout
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((entry) => !entry.endsWith("/"))
    .map((entry) => entry.replace(/^\.\//, ""))
    .sort();
}

function readZipEntry(zipPath, entry) {
  const result = run("unzip", ["-p", zipPath, entry]);
  if (result.status !== 0) throw new Error(`Could not read ${entry} from ${relativePath(zipPath)}`);
  return result.stdout;
}

function inspectZip(zipPath, canonicalSkills) {
  const entries = zipEntries(zipPath);
  const skillPaths = entries.filter((entry) => /(^|\/)SKILL\.md$/i.test(entry));
  if (skillPaths.length === 0) return { isSkillZip: false, stale: false, entries };

  const names = [];
  const reasons = [];
  for (const entry of skillPaths) {
    const bytes = readZipEntry(zipPath, entry);
    const name = parseSkillName(bytes, entry, zipPath);
    if (!name) return { isSkillZip: false, stale: false, entries };
    names.push(name);
    const canonical = canonicalSkills.get(name);
    if (!canonical) reasons.push(`no canonical source for ${name}`);
    else if (!bytes.equals(canonical.bytes)) reasons.push(`${name}/SKILL.md differs from its canonical source`);
  }

  const uniqueNames = [...new Set(names)].sort();
  if (uniqueNames.includes("failure-gate-v4")) {
    const source = canonicalSkills.get("failure-gate-v4");
    if (source) {
      const prefix = entries.every((entry) => entry.startsWith("failure-gate-v4/"))
        ? "failure-gate-v4/"
        : "";
      const expected = listFiles(source.directory);
      const actual = entries.map((entry) => prefix && entry.startsWith(prefix) ? entry.slice(prefix.length) : entry);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        reasons.push("Failure Gate v4 bundle file set differs from its complete canonical package");
      } else {
        for (const entry of expected) {
          if (!readZipEntry(zipPath, `${prefix}${entry}`).equals(readFileSync(join(source.directory, entry)))) {
            reasons.push(`Failure Gate v4 bundle content differs for ${entry}`);
          }
        }
      }
    }
  }

  return {
    isSkillZip: true,
    stale: reasons.length > 0,
    names: uniqueNames,
    entries,
    reasons: [...new Set(reasons)],
  };
}

function readManifest() {
  if (!existsSync(manifestPath)) return { version: 1, entries: [] };
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) {
    throw new Error("Invalid skill ZIP retention manifest format.");
  }
  return manifest;
}

function writeManifest(manifest) {
  mkdirSync(archiveRoot, { recursive: true });
  manifest.entries.sort((a, b) =>
    a.supersededAt.localeCompare(b.supersededAt) || a.archivePath.localeCompare(b.archivePath),
  );
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function safeArchivePath(path) {
  const resolved = resolve(root, path);
  if (!path.startsWith(`${archiveRootRelative}/`) || !resolved.startsWith(`${archiveRoot}${sep}`)) {
    throw new Error(`Retention manifest contains an unsafe archive path: ${path}`);
  }
  return resolved;
}

function pruneExpired(now = Date.now()) {
  const manifest = readManifest();
  const keep = [];
  let removed = 0;
  for (const record of manifest.entries) {
    const path = safeArchivePath(record.archivePath);
    if (isExpired(record, now)) {
      rmSync(path, { force: true });
      removed++;
    } else {
      keep.push(record);
    }
  }
  manifest.entries = keep;
  if (existsSync(manifestPath) || removed > 0) writeManifest(manifest);
  return removed;
}

function archiveZip(zipPath, names, now = Date.now()) {
  const bytes = readFileSync(zipPath);
  const digest = hash(bytes);
  const manifest = readManifest();
  const existing = manifest.entries.find((entry) => entry.sha256 === digest);
  const source = relativePath(zipPath);
  if (existing) {
    const destination = safeArchivePath(existing.archivePath);
    mkdirSync(dirname(destination), { recursive: true });
    if (!existsSync(destination)) copyFileSync(zipPath, destination);
    existing.sources = [...new Set([...(existing.sources ?? []), source])].sort();
  } else {
    const labels = [...new Set(names)].sort();
    const archiveName = labels.length === 1 ? labels[0].replace(/[^a-zA-Z0-9._-]/g, "-") : "multi-skill";
    const archivePath = `${archiveRootRelative}/${archiveName}/${digest}.zip`;
    const destination = safeArchivePath(archivePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(zipPath, destination);
    const supersededAt = new Date(now).toISOString();
    manifest.entries.push({
      skills: labels,
      sha256: digest,
      archivePath,
      sources: [source],
      supersededAt,
      expiresAt: expirationFrom(supersededAt),
    });
  }
  writeManifest(manifest);
  unlinkSource(zipPath);
  console.log(`[skill-zip-retention] archived ${source} (private for up to seven days)`);
}

function unlinkSource(path) {
  rmSync(path, { force: true });
  let parent = dirname(path);
  while (parent !== root && parent.startsWith(root + sep)) {
    try {
      if (readdirSync(parent).length > 0) break;
      rmSync(parent, { recursive: false });
      parent = dirname(parent);
    } catch {
      break;
    }
  }
}

function recreateZip(outputPath, names, canonicalSkills) {
  const skills = names.map((name) => canonicalSkills.get(name));
  if (skills.some((skill) => !skill)) return false;
  const temp = join(dirname(outputPath), `.${basename(outputPath)}.${process.pid}.tmp.zip`);
  rmSync(temp, { force: true });
  mkdirSync(dirname(outputPath), { recursive: true });

  const rootless = names.length === 1 && names[0] === "failure-gate-v4";
  let result;
  if (rootless) {
    const source = skills[0];
    const files = listFiles(source.directory);
    result = run("zip", ["-q", "-r", "-D", temp, ...files], { cwd: source.directory });
  } else {
    result = run("zip", ["-q", "-r", "-D", temp, ...skills.map((skill) => skill.directoryName)], {
      cwd: skillsRoot,
    });
  }
  if (result.status !== 0) {
    rmSync(temp, { force: true });
    throw new Error(`Could not regenerate ${relativePath(outputPath)}: ${result.stderr?.toString().trim() ?? "zip failed"}`);
  }
  renameSync(temp, outputPath);
  console.log(`[skill-zip-retention] regenerated ${relativePath(outputPath)} from canonical skill sources`);
  return true;
}

function archiveIsInput(path) {
  return relativePath(path).startsWith("attached_assets/");
}

function reconcile(now = Date.now()) {
  const expired = pruneExpired(now);
  const canonical = loadCanonicalSkills();
  let archived = 0;
  let regenerated = 0;
  for (const path of listZipFiles()) {
    if (!existsSync(path)) continue;
    const status = inspectZip(path, canonical);
    if (!status.isSkillZip || !status.stale) continue;
    archiveZip(path, status.names, now);
    archived++;
    if (!archiveIsInput(path)) {
      if (recreateZip(path, status.names, canonical)) regenerated++;
    }
  }
  const status = check(now);
  if (!status.ok) throw new Error(status.errors.join("\n"));
  console.log(
    `[skill-zip-retention] OK — archived ${archived} superseded ZIP(s), regenerated ${regenerated} current output(s), pruned ${expired} expired archive(s).`,
  );
}

function check(now = Date.now()) {
  const errors = [];
  const canonical = loadCanonicalSkills();
  for (const path of listZipFiles()) {
    const status = inspectZip(path, canonical);
    if (status.isSkillZip && status.stale) {
      errors.push(`${relativePath(path)} is superseded: ${status.reasons.join("; ")}`);
    }
  }
  const manifest = readManifest();
  for (const record of manifest.entries) {
    try {
      const path = safeArchivePath(record.archivePath);
      if (isExpired(record, now)) {
        errors.push(`${record.archivePath} is past its seven-day retention window; run skill-zips:reconcile.`);
        continue;
      }
      if (!existsSync(path)) errors.push(`${record.archivePath} is missing from the retention archive.`);
      else if (hash(readFileSync(path)) !== record.sha256) errors.push(`${record.archivePath} does not match its manifest hash.`);
      if (Date.parse(record.expiresAt) !== Date.parse(expirationFrom(record.supersededAt))) {
        errors.push(`${record.archivePath} has an invalid seven-day expiry.`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { ok: errors.length === 0, errors };
}

function main(command) {
  if (command === "reconcile") {
    reconcile();
    return;
  }
  if (command === "prune") {
    const count = pruneExpired();
    console.log(`[skill-zip-retention] pruned ${count} expired archive(s).`);
    return;
  }
  if (command === "check") {
    const result = check();
    if (!result.ok) {
      console.error("[skill-zip-retention] FAIL");
      for (const error of result.errors) console.error(`  - ${error}`);
      process.exitCode = 1;
    } else {
      console.log("[skill-zip-retention] OK — current skill ZIPs match canonical sources; private archives are within retention.");
    }
    return;
  }
  console.error("Usage: node scripts/skill-zip-retention.mjs <reconcile|prune|check>");
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]);
}