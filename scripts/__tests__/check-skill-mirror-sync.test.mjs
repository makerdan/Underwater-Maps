/**
 * Regression coverage for the canonical-first skill mirror synchronization
 * contract. Every test uses an isolated temporary tree so the suite never
 * edits the repository's gitignored runtime mirrors.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  discoverCanonicalSkills,
  findLocalSkillDirectory,
  runSkillMirrorCheck,
} from "../check-skill-mirror-sync.mjs";

function quietLogger() {
  return {
    log() {},
    warn() {},
    error() {},
  };
}

function recordingLogger() {
  const messages = [];
  return {
    messages,
    log(message) {
      messages.push(String(message));
    },
    warn(message) {
      messages.push(String(message));
    },
    error(message) {
      messages.push(String(message));
    },
  };
}

function createFixture({
  canonicalName = "example-skill",
  localName = canonicalName,
  canonicalContent = "canonical skill content\n",
  localContent = canonicalContent,
  fingerprint,
  createCanonicalFile = true,
  createLocalDir = true,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "skill-mirror-"));
  const canonicalDir = join(root, ".agents", "skills");
  const localDir = join(root, ".local", "custom_skills");
  const canonicalSkillDir = join(canonicalDir, canonicalName);
  const localSkillDir = join(localDir, localName);

  mkdirSync(canonicalSkillDir, { recursive: true });
  mkdirSync(localDir, { recursive: true });
  if (createLocalDir) mkdirSync(localSkillDir, { recursive: true });
  if (createCanonicalFile) {
    writeFileSync(join(canonicalSkillDir, "SKILL.md"), canonicalContent, "utf8");
  }
  if (createLocalDir) {
    writeFileSync(join(localSkillDir, "SKILL.md"), localContent, "utf8");
    if (fingerprint !== undefined) {
      writeFileSync(join(localSkillDir, ".fingerprint"), fingerprint, "utf8");
    }
  }

  return {
    root,
    canonicalDir,
    localDir,
    canonicalSkill: join(canonicalSkillDir, "SKILL.md"),
    localSkill: join(localSkillDir, "SKILL.md"),
    fingerprintPath: join(localSkillDir, ".fingerprint"),
  };
}

function cleanupFixture(fixture) {
  rmSync(fixture.root, { recursive: true, force: true });
}

function md5(content) {
  return createHash("md5").update(content).digest("hex");
}

describe("skill mirror sync", () => {
  it("leaves a matching mirror unchanged", () => {
    const content = "matching canonical content\n";
    const fixture = createFixture({
      canonicalContent: content,
      localContent: content,
      fingerprint: `${md5(content)}\n`,
    });

    try {
      const before = {
        skill: readFileSync(fixture.localSkill, "utf8"),
        fingerprint: readFileSync(fixture.fingerprintPath, "utf8"),
      };
      assert.equal(
        runSkillMirrorCheck({ ...fixture, logger: quietLogger() }),
        0,
      );
      assert.deepEqual(
        {
          skill: readFileSync(fixture.localSkill, "utf8"),
          fingerprint: readFileSync(fixture.fingerprintPath, "utf8"),
        },
        before,
      );
    } finally {
      cleanupFixture(fixture);
    }
  });

  it("repairs a stale fingerprint and mirror content", () => {
    const canonicalContent = "new canonical content\n";
    const fixture = createFixture({
      canonicalContent,
      localContent: "stale runtime content\n",
      fingerprint: "00000000000000000000000000000000\n",
    });

    try {
      assert.equal(
        runSkillMirrorCheck({ ...fixture, logger: quietLogger() }),
        0,
      );
      assert.equal(readFileSync(fixture.localSkill, "utf8"), canonicalContent);
      assert.equal(
        readFileSync(fixture.fingerprintPath, "utf8"),
        `${md5(canonicalContent)}\n`,
      );
    } finally {
      cleanupFixture(fixture);
    }
  });

  it("repairs a mirror with a missing fingerprint", () => {
    const canonicalContent = "fingerprintless canonical content\n";
    const fixture = createFixture({
      canonicalContent,
      localContent: "stale content without fingerprint\n",
    });

    try {
      assert.equal(
        runSkillMirrorCheck({ ...fixture, logger: quietLogger() }),
        0,
      );
      assert.equal(readFileSync(fixture.localSkill, "utf8"), canonicalContent);
      assert.equal(
        readFileSync(fixture.fingerprintPath, "utf8"),
        `${md5(canonicalContent)}\n`,
      );
    } finally {
      cleanupFixture(fixture);
    }
  });

  it("repairs a missing local SKILL.md inside an existing counterpart", () => {
    const canonicalContent = "canonical replacement content\n";
    const fixture = createFixture({
      canonicalContent,
      fingerprint: `${md5(canonicalContent)}\n`,
    });
    rmSync(fixture.localSkill);

    try {
      assert.equal(
        runSkillMirrorCheck({ ...fixture, logger: quietLogger() }),
        0,
      );
      assert.equal(readFileSync(fixture.localSkill, "utf8"), canonicalContent);
      assert.equal(
        readFileSync(fixture.fingerprintPath, "utf8"),
        `${md5(canonicalContent)}\n`,
      );
    } finally {
      cleanupFixture(fixture);
    }
  });

  it("matches local counterparts case-insensitively without creating another directory", () => {
    const canonicalContent = "case-insensitive canonical content\n";
    const fixture = createFixture({
      canonicalName: "Case-Sensitive-Skill",
      localName: "case-sensitive-skill",
      canonicalContent,
      localContent: "stale casing copy\n",
      fingerprint: "stale\n",
    });

    try {
      assert.equal(
        findLocalSkillDirectory(fixture.localDir, "Case-Sensitive-Skill"),
        "case-sensitive-skill",
      );
      assert.equal(
        runSkillMirrorCheck({ ...fixture, logger: quietLogger() }),
        0,
      );
      assert.equal(readFileSync(fixture.localSkill, "utf8"), canonicalContent);
      assert.equal(
        readFileSync(fixture.fingerprintPath, "utf8"),
        `${md5(canonicalContent)}\n`,
      );
      assert.equal(
        existsSync(join(fixture.localDir, "Case-Sensitive-Skill")),
        false,
      );
    } finally {
      cleanupFixture(fixture);
    }
  });

  it("fails explicitly when a canonical skill is missing SKILL.md", () => {
    const fixture = createFixture({
      createCanonicalFile: false,
      localContent: "preserved runtime content\n",
      fingerprint: "preserved\n",
    });

    try {
      const logger = recordingLogger();
      assert.equal(
        runSkillMirrorCheck({ ...fixture, logger }),
        1,
      );
      assert.match(logger.messages.join("\n"), /missing SKILL\.md/);
      assert.equal(
        readFileSync(fixture.localSkill, "utf8"),
        "preserved runtime content\n",
      );
      assert.equal(readFileSync(fixture.fingerprintPath, "utf8"), "preserved\n");
    } finally {
      cleanupFixture(fixture);
    }
  });

  it("skips a canonical skill with no local counterpart without creating one", () => {
    const fixture = createFixture({ createLocalDir: false });

    try {
      assert.equal(
        findLocalSkillDirectory(fixture.localDir, "example-skill"),
        null,
      );
      assert.equal(
        runSkillMirrorCheck({ ...fixture, logger: quietLogger() }),
        0,
      );
      assert.equal(existsSync(join(fixture.localDir, "example-skill")), false);
    } finally {
      cleanupFixture(fixture);
    }
  });

  it("protects orphan runtime directories from canonical discovery and repair", () => {
    const fixture = createFixture({
      canonicalName: "new-skill-name",
      localName: "old-skill-name",
      localContent: "old runtime copy\n",
      fingerprint: "old\n",
    });
    const oldRuntimeSkill = fixture.localSkill;

    try {
      assert.deepEqual(discoverCanonicalSkills(fixture.canonicalDir), [
        "new-skill-name",
      ]);
      assert.equal(
        findLocalSkillDirectory(fixture.localDir, "new-skill-name"),
        null,
      );
      assert.equal(
        runSkillMirrorCheck({ ...fixture, logger: quietLogger() }),
        0,
      );
      assert.equal(readFileSync(oldRuntimeSkill, "utf8"), "old runtime copy\n");
      assert.equal(readFileSync(fixture.fingerprintPath, "utf8"), "old\n");
      assert.equal(
        existsSync(join(fixture.localDir, "new-skill-name")),
        false,
      );
    } finally {
      cleanupFixture(fixture);
    }
  });

  it("reports repair failures without creating or replacing the mirror", () => {
    const fixture = createFixture({
      canonicalContent: "canonical content\n",
      localContent: "runtime content\n",
      fingerprint: "stale\n",
    });
    rmSync(fixture.localSkill, { force: true });
    mkdirSync(fixture.localSkill);

    try {
      const logger = recordingLogger();
      assert.equal(
        runSkillMirrorCheck({ ...fixture, logger }),
        1,
      );
      assert.match(logger.messages.join("\n"), /could not repair mirror/);
      assert.match(logger.messages.join("\n"), /Check that the canonical/);
      assert.equal(existsSync(fixture.localSkill), true);
      assert.equal(readFileSync(fixture.fingerprintPath, "utf8"), "stale\n");
    } finally {
      cleanupFixture(fixture);
    }
  });

  it("skips safely when the runtime mirror root is absent", () => {
    const fixture = createFixture();
    rmSync(fixture.localDir, { recursive: true, force: true });

    try {
      assert.equal(
        runSkillMirrorCheck({ ...fixture, logger: quietLogger() }),
        0,
      );
    } finally {
      cleanupFixture(fixture);
    }
  });

  it("delegates post-merge synchronization to the canonical checker", () => {
    const postMerge = readFileSync("scripts/post-merge.sh", "utf8");
    assert.match(postMerge, /node scripts\/check-skill-mirror-sync\.mjs/);
    assert.doesNotMatch(postMerge, /for canonical_dir in \.agents\/skills/);
  });
});