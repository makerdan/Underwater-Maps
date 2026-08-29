import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  findSkillCompressionContractProblems,
  REQUIRED_SKILL_COMPRESSION_PREVIEW_GUIDANCE,
  SKILL_COMPRESSION_PATH,
} from "../check-skill-compression-contract.mjs";

test("the committed Skill Compression skill satisfies every preview contract", () => {
  const skillText = readFileSync(SKILL_COMPRESSION_PATH, "utf8");
  assert.deepEqual(findSkillCompressionContractProblems(skillText), []);
});

test("semantic contract failures identify the missing safeguard and wording", () => {
  const contractText = REQUIRED_SKILL_COMPRESSION_PREVIEW_GUIDANCE.flatMap(
    (contract) => contract.phrases,
  ).join("\n");
  assert.deepEqual(findSkillCompressionContractProblems(contractText), []);

  for (const contract of REQUIRED_SKILL_COMPRESSION_PREVIEW_GUIDANCE) {
    for (const phrase of contract.phrases) {
      const problems = findSkillCompressionContractProblems(
        contractText.replace(phrase, ""),
      );
      assert.ok(
        problems.some(
          (problem) =>
            problem.startsWith(`${contract.id}:`) &&
            problem.includes(`missing required guidance: ${phrase}`),
        ),
        `expected removal of ${contract.id} phrase to be diagnosed`,
      );
    }
  }
});

test("non-text skill input produces an actionable diagnostic", () => {
  assert.deepEqual(
    findSkillCompressionContractProblems(null),
    ["skill file: content could not be read as text"],
  );
});