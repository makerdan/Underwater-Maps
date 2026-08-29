import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  findCiValidationParitySkillProblems,
  CI_VALIDATION_PARITY_SKILL_PATH,
  REQUIRED_CI_VALIDATION_PARITY_GUIDANCE,
} from "../check-ci-validation-parity-skill.mjs";

test("the committed CI Validation Parity skill satisfies every semantic contract", () => {
  const skillText = readFileSync(CI_VALIDATION_PARITY_SKILL_PATH, "utf8");
  assert.deepEqual(findCiValidationParitySkillProblems(skillText), []);
});

test("semantic contract failures identify the missing safeguard and wording", () => {
  const contractText = REQUIRED_CI_VALIDATION_PARITY_GUIDANCE.flatMap(
    (contract) => contract.phrases,
  ).join("\n");
  assert.deepEqual(findCiValidationParitySkillProblems(contractText), []);

  for (const contract of REQUIRED_CI_VALIDATION_PARITY_GUIDANCE) {
    for (const phrase of contract.phrases) {
      const problems = findCiValidationParitySkillProblems(
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
    findCiValidationParitySkillProblems(null),
    ["skill file: content could not be read as text"],
  );
});