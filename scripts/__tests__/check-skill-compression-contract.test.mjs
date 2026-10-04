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

test("complete-candidate contract requires the canonical post-compression labels", () => {
  const completeCandidateContract =
    REQUIRED_SKILL_COMPRESSION_PREVIEW_GUIDANCE.find(
      (contract) => contract.id === "complete-candidate",
    );
  assert.ok(completeCandidateContract);
  assert.ok(
    completeCandidateContract.phrases.includes(
      "Label the inline candidate unambiguously as **Post-compression candidate**",
    ),
  );
  assert.ok(
    completeCandidateContract.phrases.includes(
      "**Retained strongest candidate — post-compression no-op**",
    ),
  );
  assert.ok(
    !completeCandidateContract.phrases.some((phrase) =>
      /P3 — Complete candidate|Retained strongest candidate — Pass 3 no-op/.test(
        phrase,
      ),
    ),
  );
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