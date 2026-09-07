import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STATUS, buildSourceManifest, getSkillMirrorStatus, loadWorkspaceSkill,
  refreshWorkspaceSkillProjection,
} from "../check-skill-mirror-sync.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "workspace-skills-"));
  const source = join(root, "source"), projection = join(root, ".agents", "skills"), runtime = join(root, ".local", "custom_skills");
  mkdirSync(join(source, "alpha", "nested"), { recursive: true });
  writeFileSync(join(source, ".workspace-revision"), "workspace-r1\n");
  writeFileSync(join(source, "alpha", "SKILL.md"), "alpha\n");
  writeFileSync(join(source, "alpha", "nested", "guide.txt"), "nested\n");
  return { root, source, projection, runtime };
}
function done(f) { rmSync(f.root, { recursive: true, force: true }); }
function addSecondSkill(f) {
  mkdirSync(join(f.source, "beta", "nested"), { recursive: true });
  writeFileSync(join(f.source, "beta", "SKILL.md"), "beta\n");
  writeFileSync(join(f.source, "beta", "nested", "guide.txt"), "beta nested\n");
}
function setIdentity(projection) {
  return JSON.parse(readFileSync(join(projection, ".workspace-skills-projection-set.json"), "utf8"));
}
function manifestSet(source) {
  const manifest = buildSourceManifest(source);
  return {
    version: 1,
    sourceRevision: manifest.revision,
    sourceFingerprint: manifest.fingerprint,
    skills: manifest.skills,
  };
}

describe("workspace skill projection", () => {
  it("projects a deterministic recursive SHA-256 snapshot", () => {
    const f = fixture();
    try {
      const result = refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      assert.equal(result.revision, "workspace-r1");
      assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
      assert.equal(loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), "alpha\n");
      assert.equal(readFileSync(join(f.projection, "alpha", "nested", "guide.txt"), "utf8"), "nested\n");
    } finally { done(f); }
  });
  it("rejects symlinks and malformed source/projection manifests", () => {
    const f = fixture();
    try {
      symlinkSync(join(f.source, "alpha", "SKILL.md"), join(f.source, "alpha", "link"));
      assert.throws(() => buildSourceManifest(f.source), /unsafe/);
      rmSync(join(f.source, "alpha", "link"));
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      writeFileSync(join(f.projection, "alpha", ".workspace-skill-projection.json"), "{");
      assert.throws(() => loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), /malformed/);
    } finally { done(f); }
  });
  it("preserves authored skills and rolls back a blocked install", () => {
    const f = fixture();
    try {
      mkdirSync(join(f.projection, "alpha"), { recursive: true });
      writeFileSync(join(f.projection, "alpha", "SKILL.md"), "authored");
      assert.throws(() => refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection }), /project-authored/);
      assert.equal(readFileSync(join(f.projection, "alpha", "SKILL.md"), "utf8"), "authored");
    } finally { done(f); }
  });
  it("fails closed after source revision or projected content drift", () => {
    const f = fixture();
    try {
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      writeFileSync(join(f.source, "alpha", "SKILL.md"), "new");
      assert.throws(() => loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), /freshly validated/);
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      writeFileSync(join(f.projection, "alpha", "extra"), "x");
      assert.throws(() => loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), /content/);
      rmSync(join(f.projection, "alpha", "extra"));
      rmSync(join(f.projection, "alpha", "nested", "guide.txt"));
      assert.throws(() => loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), /content/);
    } finally { done(f); }
  });
  it("does not install a snapshot when the source changes during refresh", () => {
    const f = fixture();
    try {
      assert.throws(() => refreshWorkspaceSkillProjection({
        sourceDir: f.source, projectionDir: f.projection,
        beforeInstall: () => writeFileSync(join(f.source, "alpha", "SKILL.md"), "changed mid-refresh"),
      }), /changed during refresh/);
      assert.equal(existsSync(join(f.projection, "alpha")), false);
    } finally { done(f); }
  });
  it("only recovers a provably abandoned same-host lock", () => {
    const f = fixture();
    try {
      mkdirSync(join(f.projection, ".workspace-skills-refresh.lock"), { recursive: true });
      writeFileSync(join(f.projection, ".workspace-skills-refresh.lock", "owner.json"), JSON.stringify({ version: 1, token: "11111111-1111-4111-8111-111111111111", pid: 7, host: "test" }));
      writeFileSync(join(f.projection, ".workspace-skills-refresh.lock", "journal.json"), JSON.stringify({
        version: 1,
        previousSet: null,
        nextSet: manifestSet(f.source),
        moves: [],
      }));
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection, host: "test", isProcessAlive: () => false });
      assert.equal(loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), "alpha\n");
    } finally { done(f); }
  });
  it("blocks live, foreign-host, and malformed locks", () => {
    const f = fixture(), lock = join(f.projection, ".workspace-skills-refresh.lock");
    const token = "22222222-2222-4222-8222-222222222222";
    try {
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(lock, "owner.json"), JSON.stringify({ version: 1, token, pid: 1, host: "here" }));
      assert.throws(() => refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection, host: "here", isProcessAlive: () => true }), /active/);
      rmSync(lock, { recursive: true });
      mkdirSync(lock);
      writeFileSync(join(lock, "owner.json"), JSON.stringify({ version: 1, token, pid: 1, host: "away" }));
      assert.throws(() => refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection, host: "here", isProcessAlive: () => false }), /active/);
      rmSync(lock, { recursive: true });
      mkdirSync(lock);
      writeFileSync(join(lock, "owner.json"), "{");
      assert.throws(() => refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection, host: "here", isProcessAlive: () => false }), /active/);
      rmSync(lock, { recursive: true });
      mkdirSync(lock);
      writeFileSync(join(lock, "owner.json"), JSON.stringify({ version: 2, token, pid: 1, host: "here" }));
      assert.throws(() => refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection, host: "here", isProcessAlive: () => false }), /active/);
    } finally { done(f); }
  });
  it("recovers an interrupted helper-owned install from its journal", () => {
    const f = fixture(), token = "33333333-3333-4333-8333-333333333333";
    try {
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      const previousSet = setIdentity(f.projection);
      const target = join(f.projection, "alpha");
      const backup = join(f.projection, `.workspace-skills-backup-${token}-alpha`);
      renameSync(target, backup);
      mkdirSync(join(f.projection, ".workspace-skills-refresh.lock"));
      writeFileSync(join(f.projection, ".workspace-skills-refresh.lock", "owner.json"), JSON.stringify({ version: 1, token, pid: 9, host: "test" }));
      writeFileSync(join(f.projection, ".workspace-skills-refresh.lock", "journal.json"), JSON.stringify({
        version: 1,
        previousSet,
        nextSet: { ...previousSet, sourceRevision: "workspace-r2" },
        moves: [{ skill: "alpha", backup, hadTarget: true }],
      }));
      writeFileSync(join(f.source, ".workspace-revision"), "workspace-r2\n");
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection, host: "test", isProcessAlive: () => false });
      assert.equal(loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), "alpha\n");
      assert.equal(existsSync(backup), false);
    } finally { done(f); }
  });
  it("preserves committed targets and cleans token-owned residue after a post-commit crash", () => {
    const f = fixture(), token = "55555555-5555-4555-8555-555555555555";
    try {
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      const previousSet = setIdentity(f.projection);
      const target = join(f.projection, "alpha");
      const backup = join(f.projection, `.workspace-skills-backup-${token}-alpha`);
      renameSync(target, backup);
      writeFileSync(join(f.source, "alpha", "SKILL.md"), "committed alpha\n");
      writeFileSync(join(f.source, ".workspace-revision"), "workspace-r2\n");
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      const nextSet = setIdentity(f.projection);
      mkdirSync(join(f.projection, ".workspace-skills-refresh.lock"));
      writeFileSync(join(f.projection, ".workspace-skills-refresh.lock", "owner.json"), JSON.stringify({ version: 1, token, pid: 9, host: "test" }));
      writeFileSync(join(f.projection, ".workspace-skills-refresh.lock", "journal.json"), JSON.stringify({
        version: 1,
        previousSet,
        nextSet,
        moves: [{ skill: "alpha", backup, hadTarget: true }],
      }));
      mkdirSync(join(f.projection, `.workspace-skills-stage-${token}`));
      writeFileSync(join(f.projection, `..workspace-skills-projection-set.json.${token}.tmp`), "residue");

      assert.throws(() => refreshWorkspaceSkillProjection({
        sourceDir: f.source,
        projectionDir: f.projection,
        host: "test",
        isProcessAlive: () => false,
        beforeInstall: () => { throw new Error("stop after recovery"); },
      }), /stop after recovery/);
      assert.equal(readFileSync(join(target, "SKILL.md"), "utf8"), "committed alpha\n");
      assert.equal(existsSync(backup), false);
      assert.equal(existsSync(join(f.projection, `.workspace-skills-stage-${token}`)), false);
      assert.equal(existsSync(join(f.projection, `..workspace-skills-projection-set.json.${token}.tmp`)), false);
    } finally { done(f); }
  });
  it("blocks neither-state recovery without deleting targets or token-owned residue", () => {
    const f = fixture(), token = "66666666-6666-4666-8666-666666666666";
    try {
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      const currentSet = setIdentity(f.projection);
      const backup = join(f.projection, `.workspace-skills-backup-${token}-alpha`);
      mkdirSync(backup);
      writeFileSync(join(backup, "proof"), "keep");
      mkdirSync(join(f.projection, ".workspace-skills-refresh.lock"));
      writeFileSync(join(f.projection, ".workspace-skills-refresh.lock", "owner.json"), JSON.stringify({ version: 1, token, pid: 9, host: "test" }));
      writeFileSync(join(f.projection, ".workspace-skills-refresh.lock", "journal.json"), JSON.stringify({
        version: 1,
        previousSet: { ...currentSet, sourceRevision: "workspace-before" },
        nextSet: { ...currentSet, sourceRevision: "workspace-after" },
        moves: [{ skill: "alpha", backup, hadTarget: true }],
      }));
      assert.throws(() => refreshWorkspaceSkillProjection({
        sourceDir: f.source, projectionDir: f.projection, host: "test", isProcessAlive: () => false,
      }), /does not match/);
      assert.equal(readFileSync(join(f.projection, "alpha", "SKILL.md"), "utf8"), "alpha\n");
      assert.equal(readFileSync(join(backup, "proof"), "utf8"), "keep");
      assert.equal(existsSync(join(f.projection, ".workspace-skills-refresh.lock")), true);
    } finally { done(f); }
  });
  it("preserves the current target when a dead journal move never reached backup", () => {
    const f = fixture(), token = "44444444-4444-4444-8444-444444444444";
    try {
      mkdirSync(join(f.projection, "alpha"), { recursive: true });
      writeFileSync(join(f.projection, "alpha", "SKILL.md"), "authored current");
      mkdirSync(join(f.projection, ".workspace-skills-refresh.lock"));
      writeFileSync(join(f.projection, ".workspace-skills-refresh.lock", "owner.json"), JSON.stringify({ version: 1, token, pid: 9, host: "test" }));
      writeFileSync(join(f.projection, ".workspace-skills-refresh.lock", "journal.json"), JSON.stringify({
        version: 1,
        previousSet: null,
        nextSet: manifestSet(f.source),
        moves: [{ skill: "alpha", backup: join(f.projection, `.workspace-skills-backup-${token}-alpha`), hadTarget: true }],
      }));
      assert.throws(() => refreshWorkspaceSkillProjection({
        sourceDir: f.source, projectionDir: f.projection, host: "test", isProcessAlive: () => false,
      }), /project-authored/);
      assert.equal(readFileSync(join(f.projection, "alpha", "SKILL.md"), "utf8"), "authored current");
    } finally { done(f); }
  });
  it("rejects traversal tokens before creating helper state", () => {
    const f = fixture();
    try {
      assert.throws(() => refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection, token: "../escape" }), /token is invalid/);
      assert.equal(existsSync(join(f.projection, "escape")), false);
    } finally { done(f); }
  });
  it("fails closed for an extra physical helper-owned projection", () => {
    const f = fixture();
    try {
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      const m = buildSourceManifest(f.source);
      mkdirSync(join(f.projection, "stale"));
      writeFileSync(join(f.projection, "stale", ".workspace-skill-projection.json"), JSON.stringify({
        version: 1, skill: "stale", sourceRevision: m.revision, sourceFingerprint: m.fingerprint, files: [],
      }));
      assert.throws(() => loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), /physical helper-owned/);
    } finally { done(f); }
  });
  it("fails a healthy skill load when another generated member is corrupted, extra, or incomplete", () => {
    const f = fixture();
    try {
      addSecondSkill(f);
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });

      writeFileSync(join(f.projection, "beta", "SKILL.md"), "tampered beta\n");
      assert.throws(() => loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), /content/);

      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      writeFileSync(join(f.projection, "beta", "unexpected.txt"), "extra\n");
      assert.throws(() => loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), /content/);

      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      rmSync(join(f.projection, "beta", "nested", "guide.txt"));
      assert.throws(() => loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), /content/);
    } finally { done(f); }
  });
  it("allows unmarked project-authored skills beside a coherent generated set", () => {
    const f = fixture();
    try {
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      mkdirSync(join(f.projection, "authored"));
      writeFileSync(join(f.projection, "authored", "SKILL.md"), "authored\n");
      assert.equal(loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), "alpha\n");
    } finally { done(f); }
  });
  it("keeps the committed snapshot when post-commit cleanup fails", () => {
    const f = fixture();
    try {
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      writeFileSync(join(f.source, "alpha", "SKILL.md"), "new alpha\n");
      writeFileSync(join(f.source, ".workspace-revision"), "workspace-r2\n");
      assert.throws(() => refreshWorkspaceSkillProjection({
        sourceDir: f.source, projectionDir: f.projection, afterCommit: () => { throw new Error("cleanup boundary"); },
      }), /cleanup boundary/);
      assert.equal(loadWorkspaceSkill("alpha", { sourceDir: f.source, projectionDir: f.projection }), "new alpha\n");
    } finally { done(f); }
  });
  it("removes a newly installed target when an initial refresh is abandoned immediately before commit", () => {
    const f = fixture(), token = "77777777-7777-4777-8777-777777777777";
    try {
      refreshWorkspaceSkillProjection({ sourceDir: f.source, projectionDir: f.projection });
      const nextSet = setIdentity(f.projection);
      rmSync(join(f.projection, ".workspace-skills-projection-set.json"));
      mkdirSync(join(f.projection, ".workspace-skills-refresh.lock"));
      writeFileSync(join(f.projection, ".workspace-skills-refresh.lock", "owner.json"), JSON.stringify({ version: 1, token, pid: 9, host: "test" }));
      writeFileSync(join(f.projection, ".workspace-skills-refresh.lock", "journal.json"), JSON.stringify({
        version: 1,
        previousSet: null,
        nextSet,
        moves: [{
          skill: "alpha",
          backup: join(f.projection, `.workspace-skills-backup-${token}-alpha`),
          hadTarget: false,
        }],
      }));
      assert.throws(() => refreshWorkspaceSkillProjection({
        sourceDir: f.source,
        projectionDir: f.projection,
        host: "test",
        isProcessAlive: () => false,
        beforeInstall: () => { throw new Error("stop after recovery"); },
      }), /stop after recovery/);
      assert.equal(existsSync(join(f.projection, "alpha")), false);
      assert.equal(existsSync(join(f.projection, ".workspace-skills-projection-set.json")), false);
    } finally { done(f); }
  });
  it("rejects empty top-level source skill directories", () => {
    const f = fixture();
    try {
      mkdirSync(join(f.source, "empty"));
      assert.throws(() => buildSourceManifest(f.source), /incomplete skill/);
    } finally { done(f); }
  });
  it("rejects dot-prefixed source skill IDs reserved for helper state", () => {
    const f = fixture();
    try {
      mkdirSync(join(f.source, ".hidden-skill"));
      writeFileSync(join(f.source, ".hidden-skill", "SKILL.md"), "hidden");
      assert.throws(() => buildSourceManifest(f.source), /invalid top-level entry/);
    } finally { done(f); }
  });
  it("reports read-only mirror statuses without writing runtime state", () => {
    const f = fixture();
    try {
      assert.equal(getSkillMirrorStatus("alpha", { sourceDir: f.source, runtimeDir: f.runtime }), STATUS.MISSING_MIRROR);
      const m = buildSourceManifest(f.source);
      mkdirSync(join(f.runtime, "alpha"), { recursive: true });
      const files = m.files.filter((x) => x.path.startsWith("alpha/")).map((x) => ({ path: x.path.slice(6), sha256: x.sha256 }));
      writeFileSync(join(f.runtime, "alpha", ".workspace-skill-mirror.json"), JSON.stringify({ version: 1, skill: "alpha", sourceRevision: m.revision, sourceFingerprint: m.fingerprint, files }));
      const before = lstatSync(join(f.runtime, "alpha", ".workspace-skill-mirror.json")).mtimeMs;
      assert.equal(getSkillMirrorStatus("alpha", { sourceDir: f.source, runtimeDir: f.runtime }), STATUS.PASS);
      assert.equal(lstatSync(join(f.runtime, "alpha", ".workspace-skill-mirror.json")).mtimeMs, before);
      writeFileSync(join(f.runtime, "alpha", ".workspace-skill-mirror.json"), "{}");
      assert.equal(getSkillMirrorStatus("alpha", { sourceDir: f.source, runtimeDir: f.runtime }), STATUS.MISMATCH);
      assert.equal(getSkillMirrorStatus("alpha", { sourceDir: join(f.root, "nope"), runtimeDir: f.runtime }), STATUS.UNAVAILABLE_SOURCE);
    } finally { done(f); }
  });
  it("requires supplied revision and detects revision and fingerprint mirror drift", () => {
    const f = fixture();
    try {
      rmSync(join(f.source, ".workspace-revision"));
      assert.throws(() => buildSourceManifest(f.source), /revision is unavailable/);
      writeFileSync(join(f.source, ".workspace-revision"), "r1");
      const m = buildSourceManifest(f.source), files = m.files.filter((x) => x.path.startsWith("alpha/")).map((x) => ({ path: x.path.slice(6), sha256: x.sha256 }));
      mkdirSync(join(f.runtime, "alpha"), { recursive: true });
      const metadata = { version: 1, skill: "alpha", sourceRevision: "wrong", sourceFingerprint: m.fingerprint, files };
      writeFileSync(join(f.runtime, "alpha", ".workspace-skill-mirror.json"), JSON.stringify(metadata));
      assert.equal(getSkillMirrorStatus("alpha", { sourceDir: f.source, runtimeDir: f.runtime }), STATUS.MISMATCH);
      metadata.sourceRevision = m.revision; metadata.sourceFingerprint = "0".repeat(64);
      writeFileSync(join(f.runtime, "alpha", ".workspace-skill-mirror.json"), JSON.stringify(metadata));
      assert.equal(getSkillMirrorStatus("alpha", { sourceDir: f.source, runtimeDir: f.runtime }), STATUS.MISMATCH);
    } finally { done(f); }
  });
  it("redacts source paths and revision values from validation errors", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.source, "unexpected-private-file"), "private");
      let message = "";
      try { buildSourceManifest(f.source); } catch (error) { message = error.message; }
      assert.ok(message);
      assert.equal(message.includes(f.root), false);
      assert.equal(message.includes("workspace-r1"), false);
    } finally { done(f); }
  });
});