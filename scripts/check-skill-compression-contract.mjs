#!/usr/bin/env node
/**
 * Semantic contract check for the Skill Compression skill.
 *
 * The workflow's output can disappear if a preview is returned only in chat or
 * a task result. These focused phrases protect durable retention, complete
 * candidate reporting, read-back verification, and a non-applying handoff
 * without freezing the skill's entire prose as a snapshot.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
export const SKILL_COMPRESSION_PATH = resolve(
  root,
  ".agents",
  "skills",
  "skill-compression",
  "SKILL.md",
);

/**
 * Each contract is independently removable and produces an actionable
 * diagnostic. Keep these phrases short enough to survive prose refinement,
 * but specific enough to guard the decision boundary they represent.
 */
export const REQUIRED_SKILL_COMPRESSION_PREVIEW_GUIDANCE = [
  {
    id: "complete-candidate",
    description: "the response returns a complete P3 or clearly retained candidate",
    phrases: [
      "Label the inline candidate unambiguously as **P3 — Complete candidate**.",
      "Return the complete candidate under that label",
      "**Retained strongest candidate — Pass 3 no-op**",
    ],
  },
  {
    id: "durable-destination",
    description: "previews are retained at a user-visible durable path outside prohibited locations",
    phrases: [
      "save the full preview package to a user-designated or project-designated durable destination",
      "`skill-previews/<target-slug>/<unique-candidate-id>.md`",
      "not ignored, temporary, an ignored runtime mirror, or the canonical target file",
      "Ask before creating a surprising tracked file.",
    ],
  },
  {
    id: "preview-nondurability",
    description: "chat and task completion responses are explicitly not durable storage",
    phrases: [
      "Chat history and a task completion result are not durable storage.",
    ],
  },
  {
    id: "unique-output",
    description: "a new preview never overwrites an earlier preview",
    phrases: [
      "Never overwrite an earlier preview",
      "use a unique candidate ID for every new package.",
    ],
  },
  {
    id: "persisted-report",
    description: "the persisted package includes identity, diffs, findings, recommendation, and all change-list categories",
    phrases: [
      "`B0 — Baseline`, the canonical source identity, and the baseline/source",
      "meaningful diffs from `B0` and the preceding candidate",
      "risks, findings, rejected alternatives, stop conditions, and recommendation",
      "the complete **Accepted changes**, **Materially shorter rejected",
      "and **Scope and source status** change-list categories",
    ],
  },
  {
    id: "exact-path-handoff",
    description: "the response and handoff identify the exact durable preview path and candidate identity",
    phrases: [
      "report the exact saved path",
      "including the candidate label, exact path, canonical source, and baseline identity",
      "The handoff must point to the exact durable preview path",
    ],
  },
  {
    id: "read-back-verification",
    description: "saved previews are checked for allowed location, readability, completeness, and equality",
    phrases: [
      "After saving, perform a read-back verification before presenting the recommendation.",
      "that the path is outside `.local/`, temporary",
      "that the file exists and is readable",
      "that the complete candidate appears under its required label",
      "the persisted text matches the candidate and report exactly",
    ],
  },
  {
    id: "fail-closed",
    description: "persistence or verification failures remain incomplete and never fall back to chat",
    phrases: [
      "Treat any write, path-validation, read-back, truncation, or content-mismatch",
      "Preserve the authoritative target and report the failure; never silently fall back to an ephemeral response.",
    ],
  },
  {
    id: "proposed-handoff",
    description: "project-task handoff is separate, proposed, and never automatically applied",
    phrases: [
      "create a separate proposed follow-up apply task only after the preview file passes read-back verification",
      "It must remain proposed: never auto-accept, auto-start, or auto-apply it.",
      "When no project-task system exists, put this same ready-to-use apply-task specification",
    ],
  },
  {
    id: "approval-revalidation",
    description: "application requires named-candidate approval and source-baseline revalidation",
    phrases: [
      "require explicit approval of the named candidate",
      "recheck the canonical source against the preview baseline before writing",
      "block or regenerate the preview if the source changed",
      "rather than pretending a task was created.",
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
export function findSkillCompressionContractProblems(skillText) {
  if (typeof skillText !== "string") {
    return ["skill file: content could not be read as text"];
  }

  const normalizedSkillText = normalizeWhitespace(skillText);
  const problems = [];
  for (const contract of REQUIRED_SKILL_COMPRESSION_PREVIEW_GUIDANCE) {
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
    skillText = readFileSync(SKILL_COMPRESSION_PATH, "utf8");
  } catch (error) {
    console.error(
      `[check-skill-compression-contract] FAIL — could not read ${SKILL_COMPRESSION_PATH}: ${error.message}`,
    );
    process.exitCode = 1;
    return;
  }

  const problems = findSkillCompressionContractProblems(skillText);
  if (problems.length > 0) {
    console.error(
      "[check-skill-compression-contract] FAIL — Skill Compression preview contract drifted:",
    );
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      "  Fix: restore the missing safeguard in .agents/skills/skill-compression/SKILL.md.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[check-skill-compression-contract] OK — ${REQUIRED_SKILL_COMPRESSION_PREVIEW_GUIDANCE.length} semantic guidance contract(s) satisfied.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}