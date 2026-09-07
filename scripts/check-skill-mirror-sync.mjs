#!/usr/bin/env node
/**
 * Workspace skills have one direction of travel:
 * WORKSPACE_SKILLS_SOURCE -> .agents/skills (a helper-owned projection) -> a
 * platform-owned runtime mirror.  This module deliberately never writes .local.
 */
import {
  closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
export const WORKSPACE_SKILLS_SOURCE = "WORKSPACE_SKILLS_SOURCE";
export const STATUS = Object.freeze({ PASS: 0, MISMATCH: 1, UNAVAILABLE_SOURCE: 2, MISSING_MIRROR: 3 });
const MARKER = ".workspace-skill-projection.json";
const SET_MARKER = ".workspace-skills-projection-set.json";
const REVISION_FILE = ".workspace-revision";
const MIRROR_METADATA = ".workspace-skill-mirror.json";
const LOCK = ".workspace-skills-refresh.lock";
const STAGE_PREFIX = ".workspace-skills-stage-";
const BACKUP_PREFIX = ".workspace-skills-backup-";

function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function safeId(id) { return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && id !== "." && id !== ".."; }
function validToken(token) { return typeof token === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token); }
function validHost(host) { return typeof host === "string" && /^[A-Za-z0-9._-]{1,255}$/.test(host); }
function validOwner(owner) {
  return owner?.version === 1 && validToken(owner.token) && validHost(owner.host) &&
    Number.isSafeInteger(owner.pid) && owner.pid > 0;
}
function safeRelativePath(path) {
  return typeof path === "string" && path.length > 0 && !path.startsWith("/") &&
    path.split("/").every((part) => part && part !== "." && part !== "..");
}
function validRevision(value) { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value); }
function hasExactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function contained(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.includes(`..${sep}`));
}
function fail(message) { throw new Error(message); }
function syncDirectory(path) {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function syncFile(path) {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function writeDurable(path, value) {
  writeFileSync(path, value);
  syncFile(path);
  syncDirectory(dirname(path));
}
function renameDurable(from, to) {
  renameSync(from, to);
  syncDirectory(dirname(from));
  if (dirname(to) !== dirname(from)) syncDirectory(dirname(to));
}
function removeDurable(path, options) {
  rmSync(path, options);
  syncDirectory(dirname(path));
}
function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { fail(`${label} is malformed`); }
}
function lstatOrMissing(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
function regular(path, label) {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink()) fail(`${label} contains an unsafe entry`);
}

/** Build a sorted SHA-256 inventory.  Symlinks, special files, and escapes fail. */
export function buildSourceManifest(sourceDir) {
  const root = resolve(sourceDir);
  if (!existsSync(root)) fail("workspace skill source is unavailable");
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("workspace skill source is invalid");
  const revisionPath = join(root, REVISION_FILE);
  if (!existsSync(revisionPath)) fail("workspace skill source revision is unavailable");
  regular(revisionPath, "workspace skill source revision");
  const revision = readFileSync(revisionPath, "utf8").trim();
  if (!validRevision(revision)) fail("workspace skill source revision is malformed");
  const topLevelSkills = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.name !== REVISION_FILE);
  for (const entry of topLevelSkills) {
    const info = lstatSync(join(root, entry.name));
    if (!safeId(entry.name) || info.isSymbolicLink() || !info.isDirectory()) {
      fail("workspace skill source has an invalid top-level entry");
    }
  }
  const files = [];
  function visit(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.name || entry.name === "." || entry.name === "..") fail("workspace skill source has an invalid path");
      if (prefix === "" && entry.name === REVISION_FILE) continue;
      if (entry.name === MARKER) fail("workspace skill source contains a reserved helper file");
      const path = join(directory, entry.name);
      if (!contained(root, path)) fail("workspace skill source has a path escape");
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = lstatSync(path);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) fail("workspace skill source contains an unsafe entry");
      if (info.isDirectory()) visit(path, rel);
      else {
        regular(path, "workspace skill source");
        files.push({ path: rel, sha256: digest(readFileSync(path)) });
      }
    }
  }
  visit(root);
  const ids = topLevelSkills.map((entry) => entry.name).sort();
  if (!ids.length || ids.some((id) => !safeId(id))) fail("workspace skill source has no valid skill directories");
  // Every top-level entry must be a skill directory, and a skill must contain SKILL.md.
  for (const id of ids) {
    const dir = join(root, id);
    if (!lstatSync(dir).isDirectory() || !files.some((f) => f.path === `${id}/SKILL.md`)) fail("workspace skill source has an incomplete skill");
  }
  const fingerprint = digest(JSON.stringify(files));
  return { version: 1, revision, fingerprint, sourceFingerprint: fingerprint, files, skills: ids };
}

export function resolveWorkspaceSkillsSource({ env = process.env, root = ROOT } = {}) {
  const value = env[WORKSPACE_SKILLS_SOURCE];
  if (!value || !String(value).trim()) fail(`${WORKSPACE_SKILLS_SOURCE} is required`);
  const source = resolve(root, value);
  // Explicit relative values are rooted at the repository; source identity is never logged.
  return source;
}

function projectionMarker(path) {
  const marker = join(path, MARKER);
  const markerStat = lstatOrMissing(marker);
  if (!markerStat) return null;
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) fail("projection marker contains an unsafe entry");
  const value = readJson(marker, "projection manifest");
  if (value?.version !== 1 || !safeId(value.skill) || !validRevision(value.sourceRevision) || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint) ||
      !Array.isArray(value.files) || !value.files.every((f) => safeRelativePath(f.path) && /^[a-f0-9]{64}$/.test(f.sha256))) {
    fail("projection manifest is malformed");
  }
  return value;
}
function setMarker(root) {
  regular(join(root, SET_MARKER), "projection set manifest");
  const value = readJson(join(root, SET_MARKER), "projection set manifest");
  if (!validSetIdentity(value)) fail("projection set manifest is malformed");
  return value;
}
function validSetIdentity(value, { allowAbsent = false } = {}) {
  if (allowAbsent && value === null) return true;
  return hasExactKeys(value, ["version", "sourceRevision", "sourceFingerprint", "skills"]) &&
    value.version === 1 && validRevision(value.sourceRevision) &&
    /^[a-f0-9]{64}$/.test(value.sourceFingerprint) && Array.isArray(value.skills) &&
    value.skills.every(safeId) &&
    JSON.stringify(value.skills) === JSON.stringify([...new Set(value.skills)].sort());
}
function readCurrentSetIdentity(root) {
  const path = join(root, SET_MARKER);
  if (!existsSync(path)) return null;
  const value = readJson(path, "projection set manifest");
  if (!validSetIdentity(value)) fail("projection set manifest is malformed");
  return value;
}
function sameSetIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function isOwnedProjection(path) {
  try { return projectionMarker(path); } catch { return null; }
}
function copyTree(source, dest) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(dest, entry.name);
    const info = lstatSync(from);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) fail("workspace skill source contains an unsafe entry");
    if (info.isDirectory()) {
      mkdirSync(to);
      syncDirectory(dest);
      copyTree(from, to);
    } else {
      regular(from, "workspace skill source");
      copyFileSync(from, to);
      syncFile(to);
    }
  }
  syncDirectory(dest);
}
function skillFiles(manifest, skill) {
  return manifest.files.filter((f) => f.path.startsWith(`${skill}/`))
    .map((f) => ({ path: f.path.slice(skill.length + 1), sha256: f.sha256 }));
}
function validateProjectionSkill(dir, manifest, skill) {
  const marker = projectionMarker(dir);
  const expected = skillFiles(manifest, skill);
  if (!marker || marker.skill !== skill || marker.sourceRevision !== manifest.revision || marker.sourceFingerprint !== manifest.fingerprint ||
      JSON.stringify(marker.files) !== JSON.stringify(expected)) fail("projection is not a freshly validated snapshot");
  const actual = buildSourceManifestForOne(dir);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("projection content does not match its manifest");
  return marker;
}
function buildSourceManifestForOne(dir) {
  const result = [];
  function visit(current, prefix = "") {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === MARKER) continue;
      const path = join(current, entry.name), rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const s = lstatSync(path);
      if (s.isSymbolicLink() || (!s.isDirectory() && !s.isFile())) fail("projection contains an unsafe entry");
      if (s.isDirectory()) visit(path, rel); else result.push({ path: rel, sha256: digest(readFileSync(path)) });
    }
  }
  visit(dir); return result;
}

function projectionHelperKind(name) {
  if (name === LOCK) return "directory";
  if (name.startsWith(STAGE_PREFIX)) {
    return validToken(name.slice(STAGE_PREFIX.length)) ? "directory" : "invalid";
  }
  if (name.startsWith(BACKUP_PREFIX)) {
    const token = name.slice(BACKUP_PREFIX.length, BACKUP_PREFIX.length + 36);
    const skill = name.slice(BACKUP_PREFIX.length + 37);
    return validToken(token) && safeId(skill) && name[BACKUP_PREFIX.length + 36] === "-" ? "directory" : "invalid";
  }
  const setTempPrefix = `.${SET_MARKER}.`;
  if (name.startsWith(setTempPrefix)) {
    const token = name.slice(setTempPrefix.length, -4);
    return name.endsWith(".tmp") && validToken(token) ? "file" : "invalid";
  }
  return null;
}

function validateProjectionRootEntry(root, entry) {
  const path = join(root, entry.name);
  if (entry.name === SET_MARKER) {
    regular(path, "projection set manifest");
    return "helper";
  }
  const helperKind = projectionHelperKind(entry.name);
  if (helperKind === "invalid") fail("projection contains malformed helper state");
  if (helperKind) {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || (helperKind === "directory" && !info.isDirectory()) ||
        (helperKind === "file" && !info.isFile())) {
      fail("projection contains an unsafe helper entry");
    }
    return "helper";
  }
  if (!safeId(entry.name)) fail("projection has an unexpected top-level entry");
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory()) fail("projection has an unsafe top-level entry");
  return projectionMarker(path) ? "managed" : "authored";
}

function readValidatedSkillContent(dir, manifest, skill) {
  const expected = skillFiles(manifest, skill).find((file) => file.path === "SKILL.md");
  if (!expected) fail("projection is missing SKILL.md");
  // Capture and hash the exact bytes that will be returned. A replacement
  // between the all-skill validation pass and this read is rejected rather
  // than allowing an unvalidated copy to escape.
  const content = readFileSync(join(dir, "SKILL.md"));
  if (digest(content) !== expected.sha256) fail("projection content changed during load");
  return content.toString("utf8");
}

/** Return the final lstat without following symlinks, or null for a missing path. */
function lstatPathWithoutSymlinks(path) {
  const absolute = resolve(path);
  const parsed = parse(absolute);
  let current = parsed.root;
  const parts = absolute.slice(parsed.root.length).split(sep).filter(Boolean);
  if (!parts.length) return lstatSync(current);
  for (const part of parts) {
    current = join(current, part);
    const info = lstatOrMissing(current);
    if (!info) return null;
    if (info.isSymbolicLink()) fail("runtime mirror path contains a symlink");
    if (current !== absolute && !info.isDirectory()) fail("runtime mirror path is not contained");
    if (current === absolute) return info;
  }
  return null;
}

function recoverAbandonedLock(parent, lock, owner) {
  const journalPath = join(lock, "journal.json");
  let journal;
  try { journal = readJson(journalPath, "refresh journal"); } catch { fail("workspace skill refresh lock has no recoverable journal"); }
  const journalSkills = new Set([
    ...(journal?.previousSet?.skills ?? []),
    ...(journal?.nextSet?.skills ?? []),
  ]);
  if (!hasExactKeys(journal, ["version", "previousSet", "nextSet", "moves"]) ||
      journal.version !== 1 || !validSetIdentity(journal.previousSet, { allowAbsent: true }) ||
      !validSetIdentity(journal.nextSet) || !Array.isArray(journal.moves) ||
      !journal.moves.every((m) => hasExactKeys(m, ["skill", "backup", "hadTarget"]) &&
      safeId(m.skill) && typeof m.backup === "string" && typeof m.hadTarget === "boolean" &&
      journalSkills.has(m.skill) && basename(m.backup) === `${BACKUP_PREFIX}${owner.token}-${m.skill}` &&
      contained(parent, m.backup)) ||
      new Set(journal.moves.map((move) => move.skill)).size !== journal.moves.length) fail("refresh journal is malformed");
  const currentSet = readCurrentSetIdentity(parent);
  const stage = join(parent, `${STAGE_PREFIX}${owner.token}`);
  const setTemp = join(parent, `.${SET_MARKER}.${owner.token}.tmp`);
  if (sameSetIdentity(currentSet, journal.nextSet)) {
    for (const move of journal.moves) {
      if (existsSync(move.backup)) removeDurable(move.backup, { recursive: true, force: true });
    }
    if (existsSync(stage)) removeDurable(stage, { recursive: true, force: true });
    if (existsSync(setTemp)) removeDurable(setTemp, { force: true });
    return;
  }
  if (!sameSetIdentity(currentSet, journal.previousSet)) {
    fail("abandoned refresh state does not match its journal");
  }
  for (const move of [...journal.moves].reverse()) {
    const target = join(parent, move.skill);
    // The journal entry is written before the rename. If the backup does not
    // exist, the move never happened and the current target must be preserved.
    if (move.hadTarget) {
      if (!existsSync(move.backup)) continue;
      if (existsSync(target)) {
        if (!isOwnedProjection(target)) fail("abandoned refresh cannot replace project-authored state");
        removeDurable(target, { recursive: true, force: true });
      }
      renameDurable(move.backup, target);
    } else if (existsSync(target)) {
      const marker = isOwnedProjection(target);
      if (!marker || marker.skill !== move.skill ||
          marker.sourceRevision !== journal.nextSet.sourceRevision ||
          marker.sourceFingerprint !== journal.nextSet.sourceFingerprint) {
        fail("abandoned refresh cannot remove unproven target state");
      }
      removeDurable(target, { recursive: true, force: true });
    }
  }
  if (existsSync(stage)) removeDurable(stage, { recursive: true, force: true });
  if (existsSync(setTemp)) removeDurable(setTemp, { force: true });
}
function acquireLock(parent, options) {
  const lock = join(parent, LOCK), token = options.token ?? randomUUID();
  if (!validToken(token)) fail("workspace skill refresh token is invalid");
  try { mkdirSync(lock); }
  catch {
    const owner = (() => { try { return readJson(join(lock, "owner.json"), "refresh lock"); } catch { return null; } })();
    const sameHost = validOwner(owner) && owner.host === (options.host ?? hostname());
    const alive = sameHost &&
      (options.isProcessAlive ?? ((pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; } }))(owner.pid);
    if (!sameHost || alive) fail("workspace skill refresh is already active");
    // A same-host ESRCH pid is the only provable abandoned case.
    recoverAbandonedLock(parent, lock, owner);
    rmSync(lock, { recursive: true, force: false });
    mkdirSync(lock);
  }
  const newOwner = { version: 1, token, pid: options.pid ?? process.pid, host: options.host ?? hostname() };
  if (!validOwner(newOwner)) {
    rmSync(lock, { recursive: true, force: true });
    fail("workspace skill refresh owner is invalid");
  }
  writeDurable(join(lock, "owner.json"), JSON.stringify(newOwner));
  return { lock, token };
}

/** Atomically refresh helper-owned projections. Project-authored directories are never replaced. */
export function refreshWorkspaceSkillProjection(options = {}) {
  const source = options.sourceDir ?? resolveWorkspaceSkillsSource(options);
  const projectionRoot = resolve(options.projectionDir ?? join(ROOT, ".agents", "skills"));
  const before = buildSourceManifest(source);
  mkdirSync(projectionRoot, { recursive: true });
  const lock = acquireLock(projectionRoot, options);
  const stage = join(projectionRoot, `${STAGE_PREFIX}${lock.token}`);
  const setTemp = join(projectionRoot, `.${SET_MARKER}.${lock.token}.tmp`);
  const moves = [];
  let committed = false;
  try {
    mkdirSync(stage);
    for (const skill of before.skills) {
      const target = join(projectionRoot, skill);
      if (existsSync(target) && !isOwnedProjection(target)) fail(`refusing to replace project-authored skill "${skill}"`);
      const staged = join(stage, skill); mkdirSync(staged); copyTree(join(source, skill), staged);
      writeDurable(join(staged, MARKER), JSON.stringify({ version: 1, skill, sourceRevision: before.revision, sourceFingerprint: before.fingerprint, files: skillFiles(before, skill) }));
      validateProjectionSkill(staged, before, skill);
    }
    // Test/embedding hook: lets callers model a workspace changing between
    // snapshot validation and installation without exposing staging paths.
    options.beforeInstall?.();
    const after = buildSourceManifest(source);
    if (after.revision !== before.revision || after.fingerprint !== before.fingerprint) fail("workspace skill source changed during refresh");
    const previousSet = readCurrentSetIdentity(projectionRoot);
    const nextSet = { version: 1, sourceRevision: before.revision, sourceFingerprint: before.fingerprint, skills: before.skills };
    const existing = readdirSync(projectionRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
    const replace = [...new Set([...before.skills, ...existing.filter((id) => isOwnedProjection(join(projectionRoot, id)) && !before.skills.includes(id))])];
    const writeJournal = () => writeDurable(join(lock.lock, "journal.json"), JSON.stringify({
      version: 1,
      previousSet,
      nextSet,
      moves: moves.map(({ target, backup, hadTarget }) => ({ skill: basename(target), backup, hadTarget })),
    }));
    writeJournal();
    for (const skill of replace) {
      const target = join(projectionRoot, skill), backup = join(projectionRoot, `${BACKUP_PREFIX}${lock.token}-${skill}`);
      const hadTarget = existsSync(target);
      moves.push({ target, backup, hadTarget });
      writeJournal();
      if (hadTarget) {
        renameDurable(target, backup);
      }
      if (before.skills.includes(skill)) renameDurable(join(stage, skill), target);
    }
    options.beforeCommit?.();
    writeDurable(setTemp, JSON.stringify(nextSet));
    renameDurable(setTemp, join(projectionRoot, SET_MARKER));
    committed = true;
    options.afterCommit?.();
    for (const { backup, hadTarget } of moves) {
      if (hadTarget) removeDurable(backup, { recursive: true, force: true });
    }
    return { revision: before.revision, fingerprint: before.fingerprint, skills: before.skills };
  } catch (error) {
    // Restore only names this invocation moved; never clean unknown work.
    if (!committed) {
      for (const { target, backup, hadTarget } of moves.reverse()) {
        if (existsSync(target)) removeDurable(target, { recursive: true, force: true });
        if (hadTarget && existsSync(backup)) renameDurable(backup, target);
      }
    }
    throw error;
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    if (existsSync(setTemp)) rmSync(setTemp, { force: true });
    const ownerPath = join(lock.lock, "owner.json");
    try { if (readJson(ownerPath, "refresh lock").token === lock.token) rmSync(lock.lock, { recursive: true, force: true }); } catch { /* do not remove foreign lock */ }
  }
}

/** Fail-closed reader: callers only receive a skill after validating projection and source identity. */
export function loadWorkspaceSkill(skill, options = {}) {
  if (!safeId(skill)) fail("invalid skill id");
  const source = options.sourceDir ?? resolveWorkspaceSkillsSource(options);
  const manifest = buildSourceManifest(source);
  if (!manifest.skills.includes(skill)) fail("requested skill is unavailable");
  const root = resolve(options.projectionDir ?? join(ROOT, ".agents", "skills"));
  const set = setMarker(root);
  if (set.sourceRevision !== manifest.revision || set.sourceFingerprint !== manifest.fingerprint ||
      JSON.stringify(set.skills) !== JSON.stringify(manifest.skills) || !set.skills.includes(skill)) {
    fail("projection set is not a freshly validated snapshot");
  }
  const managed = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const kind = validateProjectionRootEntry(root, entry);
    if (kind === "managed") managed.push(entry.name);
  }
  managed.sort();
  if (JSON.stringify(managed) !== JSON.stringify(set.skills) ||
      JSON.stringify(managed) !== JSON.stringify(manifest.skills)) {
    fail("projection set does not match physical helper-owned projections");
  }
  for (const managedSkill of managed) {
    validateProjectionSkill(join(root, managedSkill), manifest, managedSkill);
  }
  options.beforeReturn?.();
  return readValidatedSkillContent(join(root, skill), manifest, skill);
}

/** Read-only platform mirror comparison. Metadata must identify the same source revision and skill inventory. */
export function getSkillMirrorStatus(skill, options = {}) {
  if (!safeId(skill)) return STATUS.MISMATCH;
  let manifest;
  try { manifest = buildSourceManifest(options.sourceDir ?? resolveWorkspaceSkillsSource(options)); }
  catch { return STATUS.UNAVAILABLE_SOURCE; }
  if (!manifest.skills.includes(skill)) return STATUS.UNAVAILABLE_SOURCE;
  const runtime = resolve(options.runtimeDir ?? join(ROOT, ".local", "custom_skills"));
  const metadataPath = join(runtime, skill, MIRROR_METADATA);
  try {
    if (!contained(runtime, metadataPath)) return STATUS.MISMATCH;
    const runtimeStat = lstatPathWithoutSymlinks(runtime);
    if (!runtimeStat) return STATUS.MISSING_MIRROR;
    if (!runtimeStat.isDirectory()) return STATUS.MISMATCH;
    const skillStat = lstatPathWithoutSymlinks(join(runtime, skill));
    if (!skillStat) return STATUS.MISSING_MIRROR;
    if (!skillStat.isDirectory()) return STATUS.MISMATCH;
    const metadataStat = lstatPathWithoutSymlinks(metadataPath);
    if (!metadataStat) return STATUS.MISSING_MIRROR;
    if (!metadataStat.isFile()) return STATUS.MISMATCH;
    const metadata = readJson(metadataPath, "runtime mirror metadata");
    const expected = skillFiles(manifest, skill);
    return metadata?.version === 1 && metadata.skill === skill && metadata.sourceRevision === manifest.revision &&
      metadata.sourceFingerprint === manifest.fingerprint &&
      JSON.stringify(metadata.files) === JSON.stringify(expected) ? STATUS.PASS : STATUS.MISMATCH;
  } catch { return STATUS.MISMATCH; }
}

// Compatibility entry point is intentionally read-only now.
export function runSkillMirrorCheck(options = {}) {
  const source = options.sourceDir ?? (() => { try { return resolveWorkspaceSkillsSource(options); } catch { return null; } })();
  if (!source) return STATUS.UNAVAILABLE_SOURCE;
  const manifest = (() => { try { return buildSourceManifest(source); } catch { return null; } })();
  if (!manifest) return STATUS.UNAVAILABLE_SOURCE;
  const skill = options.skill;
  if (skill) return getSkillMirrorStatus(skill, { ...options, sourceDir: source });
  return manifest.skills.every((id) => getSkillMirrorStatus(id, { ...options, sourceDir: source }) === STATUS.PASS) ? STATUS.PASS : STATUS.MISMATCH;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? "status";
  const index = process.argv.indexOf("--skill");
  const skill = index >= 0 ? process.argv[index + 1] : null;
  if (command === "refresh") {
    try {
      const result = refreshWorkspaceSkillProjection();
      console.log(`Refreshed ${result.skills.length} workspace skill projection(s).`);
    } catch (error) {
      console.error(`Workspace skill refresh failed: ${error.message}`);
      process.exitCode = 1;
    }
  } else if (command === "status") {
    process.exitCode = runSkillMirrorCheck({ skill });
  } else {
    console.error("Usage: check-skill-mirror-sync.mjs <refresh|status> [--skill <skill-id>]");
    process.exitCode = 1;
  }
}