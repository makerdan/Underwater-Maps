#!/usr/bin/env node
/**
 * Semantic contract check for the CI Validation Parity skill.
 *
 * The skill is operational guidance: a structurally valid Markdown file can
 * still lose the safeguards that prevent false claims about CI activity,
 * results, or merge requirements. Keep the contracts below focused on those
 * safeguards and make every failure actionable.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
export const CI_VALIDATION_PARITY_SKILL_PATH = resolve(
  root,
  ".agents",
  "skills",
  "ci-validation-parity",
  "SKILL.md",
);

/**
 * Each contract is intentionally expressed as required phrases rather than a
 * single large snapshot. This lets the skill be edited for clarity while
 * still protecting each decision boundary independently.
 */
export const REQUIRED_CI_VALIDATION_PARITY_GUIDANCE = [
  {
    id: "remote-read-only-boundary",
    description:
      "remote inspection is read-only and remote workflow changes require explicit user authorization",
    phrases: [
      "Remote inspection is read-only by default.",
      "Triggering, rerunning, dispatching, cancelling, approving, editing, or otherwise modifying a remote workflow requires an explicit user request",
    ],
  },
  {
    id: "presence-is-not-proof",
    description:
      "workflow files, names, badges, and documentation do not prove active, passing, or required CI",
    phrases: [
      "### Presence is not proof",
      "Workflow-file existence, workflow names, comments, badges, README",
      "Never infer required status from a check name, a green badge, or a workflow file alone.",
    ],
  },
  {
    id: "unknown-state-reporting",
    description:
      "unavailable evidence is reported as unknown instead of being silently converted into a status",
    phrases: [
      "Mark a conclusion **unknown** when the relevant evidence is unavailable.",
      "Do not silently convert unknown into absent, passing, active, or required.",
    ],
  },
  {
    id: "revision-aware-evidence",
    description:
      "remote results are tied to the exact revision and executable evidence",
    phrases: [
      "revision-aware run evidence",
      "exact commit, revision, or merge reference",
      "a remote pass on an older revision does not prove the current revision passes.",
    ],
  },
  {
    id: "event-classifications",
    description:
      "remote validation is classified by pull-request, push, scheduled, manual, conditional, or ambiguous scope",
    phrases: [
      "Pull request / pre-merge",
      "Default-branch push",
      "Scheduled",
      "Manual",
      "Conditional",
      "Ambiguous / unknown",
    ],
  },
  {
    id: "explicit-coverage-decisions",
    description:
      "every portable check receives an explicit remote, justified local-only, or intentional-gap decision",
    phrases: [
      "When a portable check is added to a canonical validation flow, make an explicit CI coverage decision for it:",
      "**Add remote coverage**",
      "**Document a justified local-only exclusion**",
      "**Record an intentional gap**",
      "Do not leave the decision implicit.",
    ],
  },
  {
    id: "no-duplicate-validation-runs",
    description:
      "new checks extend existing suites instead of creating duplicate workflows or discovery runs",
    phrases: [
      "Prefer extending an existing suite over creating a one-test workflow, a",
      "second discovery run, or a duplicate package command.",
      "Do not create a new workflow merely to run one additional test when an existing suite can own it.",
    ],
  },
];

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Returns one actionable problem per missing phrase in the skill contract.
 *
 * @param {string} skillText
 * @returns {string[]}
 */
export function findCiValidationParitySkillProblems(skillText) {
  if (typeof skillText !== "string") {
    return ["skill file: content could not be read as text"];
  }

  const normalizedSkillText = normalizeWhitespace(skillText);
  const problems = [];
  for (const contract of REQUIRED_CI_VALIDATION_PARITY_GUIDANCE) {
    for (const phrase of contract.phrases) {
      if (!normalizedSkillText.includes(normalizeWhitespace(phrase))) {
        problems.push(`${contract.id}: missing required guidance: ${phrase}`);
      }
    }
  }
  return problems;
}

export function main() {
  let skillText;
  try {
    skillText = readFileSync(CI_VALIDATION_PARITY_SKILL_PATH, "utf8");
  } catch (error) {
    console.error(
      `[check-ci-validation-parity-skill] FAIL — could not read ${CI_VALIDATION_PARITY_SKILL_PATH}: ${error.message}`,
    );
    process.exitCode = 1;
    return;
  }

  const problems = findCiValidationParitySkillProblems(skillText);
  if (problems.length > 0) {
    console.error(
      "[check-ci-validation-parity-skill] FAIL — CI Validation Parity guidance drifted:",
    );
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      "  Fix: restore the missing safeguard in .agents/skills/ci-validation-parity/SKILL.md.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[check-ci-validation-parity-skill] OK — ${REQUIRED_CI_VALIDATION_PARITY_GUIDANCE.length} semantic guidance contract(s) satisfied.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}