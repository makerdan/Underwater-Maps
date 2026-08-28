/**
 * Regression coverage for the canonical-first skill mirror discovery contract.
 *
 * In particular, a canonical skill rename can leave an older runtime mirror
 * directory behind until the platform refreshes .local/custom_skills/.
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

describe("skill mirror sync canonical discovery", () => {
  it("discovers the renamed canonical directory without touching the old runtime slug", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-mirror-rename-"));
    const canonicalDir = join(root, ".agents", "skills");
    const localDir = join(root, ".local", "custom_skills");
    const renamedCanonicalName = "ux-e2e";
    const oldRuntimeName = "ux-confirmation-audit";
    const canonicalSkill = join(canonicalDir, renamedCanonicalName, "SKILL.md");
    const oldRuntimeSkill = join(localDir, oldRuntimeName, "SKILL.md");

    try {
      mkdirSync(join(canonicalDir, renamedCanonicalName), { recursive: true });
      mkdirSync(join(localDir, oldRuntimeName), { recursive: true });
      writeFileSync(canonicalSkill, "canonical skill content\n", "utf8");
      writeFileSync(oldRuntimeSkill, "old runtime copy\n", "utf8");
      const oldRuntimeBefore = readFileSync(oldRuntimeSkill, "utf8");

      assert.deepEqual(discoverCanonicalSkills(canonicalDir), [renamedCanonicalName]);
      assert.equal(
        findLocalSkillDirectory(localDir, renamedCanonicalName),
        null,
        "different slugs must not be treated as a counterpart",
      );
      assert.equal(
        runSkillMirrorCheck({ canonicalDir, localDir, logger: quietLogger() }),
        0,
      );
      assert.equal(readFileSync(oldRuntimeSkill, "utf8"), oldRuntimeBefore);
      assert.equal(
        existsSync(join(localDir, renamedCanonicalName)),
        false,
        "the check must not create a new ignored runtime directory",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});