#!/usr/bin/env node
/**
 * Static contract guard for the project-authored Poe Setup skill.
 *
 * This check deliberately inspects guidance and examples only. It never reads a
 * secret, imports application Poe code, or sends a provider request.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

export const POE_SETUP_SKILL_PATH = resolve(
  root,
  ".agents",
  "skills",
  "poe-setup",
  "SKILL.md",
);

export const REQUIRED_POE_SETUP_GUIDANCE = [
  {
    id: "lazy-client",
    phrases: [
      "Construct it lazily and memoize it in a server-only module.",
      "Importing the module must not read or validate optional Poe configuration, construct a client, or throw because Poe is not configured.",
      "operation boundary when Poe is first used.",
    ],
  },
  {
    id: "preflight-boundary",
    phrases: [
      "an explicit startup preflight may call the same getter and fail startup",
      "that preflight is an application decision, not a module-import side effect.",
    ],
  },
  {
    id: "protocol-boundary",
    phrases: [
      "The OpenAI SDK in this guide is a caller for Poe's OpenAI-compatible `/v1` surface.",
      "The legacy `/bot/` paths use Poe's bot-server protocol and SSE envelopes",
      "for implementing a bot server that Poe calls, not for calling Poe models through the OpenAI SDK.",
    ],
  },
  {
    id: "zero-completion-discovery",
    phrases: [
      "Ordinary application startup, deployment startup, readiness checks, health checks, and catalogue refreshes must send zero model-completion requests.",
      "Catalogue discovery and live inference verification are separate operations.",
    ],
  },
  {
    id: "protected-verification",
    phrases: [
      "Live inference verification requires an explicit, authenticated and authorized administrator or operator action.",
      "A single-model verification must have a fixed timeout and bounded retry policy.",
    ],
  },
  {
    id: "bounded-bulk-verification",
    phrases: [
      "restrict it to models actively used by application routing",
      "model count, concurrency, attempts per model, per-request timeout, aggregate request count, and aggregate operation deadline.",
      "Return safe partial or budget-limited results when a ceiling is reached.",
      "Never scale probing directly with the size of the provider catalogue.",
    ],
  },
];

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function getSection(skillText, heading, nextHeading) {
  const start = skillText.indexOf(heading);
  if (start === -1) return "";
  const end = skillText.indexOf(nextHeading, start + heading.length);
  return skillText.slice(start, end === -1 ? undefined : end);
}

function getCodeBlocks(text) {
  return [...text.matchAll(/```(?:ts|typescript|js|javascript)\s*\n([\s\S]*?)```/g)].map(
    (match) => match[1],
  );
}

function stripStringsAndComments(line) {
  return line
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")
    .replace(/\/\/.*$/, "");
}

function findUnsafeRawSdkExamples(rawSdkSection) {
  const problems = [];
  const blocks = getCodeBlocks(rawSdkSection);

  for (const block of blocks) {
    let braceDepth = 0;
    for (const line of block.split("\n")) {
      const code = stripStringsAndComments(line);
      if (braceDepth === 0) {
        if (/\bnew\s+OpenAI\s*\(/.test(code)) {
          problems.push("raw-sdk-example: module-scope OpenAI client construction");
        }
        if (/process\.env\.POE_API_KEY2?\b/.test(code)) {
          problems.push("raw-sdk-example: module-scope Poe secret lookup");
        }
        if (/\b(?:check|verify|probe)\w*Poe\w*\s*\(/i.test(code) ||
            /\bpoe\w*Health\w*\s*\(/i.test(code)) {
          problems.push("raw-sdk-example: import-triggered Poe health check");
        }
        if (/\.models\.list\s*\(/.test(code) ||
            /fetch\s*\([^)]*\/v1\/models/.test(line)) {
          problems.push("raw-sdk-example: import-triggered catalogue request");
        }
        if (/\.chat\.completions\.(?:create|stream)\s*\(/.test(code) ||
            /\.responses\.create\s*\(/.test(code) ||
            /fetch\s*\([^)]*\/v1\/(?:chat\/completions|responses)/.test(line)) {
          problems.push("raw-sdk-example: import-triggered model-completion request");
        }
      }

      const braces = code.match(/[{}]/g) ?? [];
      for (const brace of braces) {
        braceDepth += brace === "{" ? 1 : -1;
        if (braceDepth < 0) braceDepth = 0;
      }
    }
  }

  return [...new Set(problems)];
}

/**
 * @param {string} skillText
 * @returns {string[]}
 */
export function findPoeSetupContractProblems(skillText) {
  if (typeof skillText !== "string") {
    return ["skill file: content could not be read as text"];
  }

  const problems = [];
  const normalized = normalizeWhitespace(skillText);

  if (/\bPOE_API_KEY\b/.test(skillText)) {
    problems.push("secret-name: obsolete POE_API_KEY reference");
  }
  if (!/\bPOE_API_KEY2\b/.test(skillText)) {
    problems.push("secret-name: missing POE_API_KEY2 guidance");
  }

  for (const contract of REQUIRED_POE_SETUP_GUIDANCE) {
    for (const phrase of contract.phrases) {
      if (!normalized.includes(normalizeWhitespace(phrase))) {
        problems.push(`${contract.id}: missing required guidance: ${phrase}`);
      }
    }
  }

  const rawSdkSection = getSection(
    skillText,
    "## 5. Raw SDK fallback",
    "## 6. Discover live model IDs and capabilities",
  );
  if (!rawSdkSection) {
    problems.push("raw-sdk-example: missing Raw SDK fallback section");
  } else {
    const rawCode = getCodeBlocks(rawSdkSection).join("\n");
    if (!/let\s+poeClient\s*:/.test(rawCode) ||
        !/function\s+getPoeClient\s*\(/.test(rawCode) ||
        !/if\s*\(\s*poeClient\s*\)\s*return\s+poeClient/.test(rawCode) ||
        !/poeClient\s*=\s*new\s+OpenAI\s*\(/.test(rawCode)) {
      problems.push("raw-sdk-example: missing approved lazy memoized client getter");
    }
    problems.push(...findUnsafeRawSdkExamples(rawSdkSection));
  }

  for (const block of getCodeBlocks(skillText)) {
    if (/baseURL\s*:\s*["'`]https:\/\/api\.poe\.com\/bot\/?["'`]/.test(block)) {
      problems.push("protocol-boundary: OpenAI SDK baseURL uses legacy /bot/");
      break;
    }
  }

  return [...new Set(problems)];
}

export function main() {
  let skillText;
  try {
    skillText = readFileSync(POE_SETUP_SKILL_PATH, "utf8");
  } catch (error) {
    console.error(
      `[check-poe-setup-contract] FAIL — could not read canonical skill: ${error.message}`,
    );
    process.exitCode = 1;
    return;
  }

  const problems = findPoeSetupContractProblems(skillText);
  if (problems.length > 0) {
    console.error("[check-poe-setup-contract] FAIL — Poe Setup contract drifted:");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[check-poe-setup-contract] OK — ${REQUIRED_POE_SETUP_GUIDANCE.length} guidance contracts and import-safe examples satisfied.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}