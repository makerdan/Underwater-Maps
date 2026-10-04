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
    id: "model-registry",
    phrases: [
      "Use only exact model IDs declared in the application's code-owned static Poe registry.",
      "Production code, startup checks, health checks, setup flows, and administrator operations must never call Poe's full `GET /v1/models` catalogue",
      "Every Poe probe, Poe primary route, Poe-model fallback, and Poe completion must fail closed before Poe transport when its exact model ID is absent from the code-owned registry or lacks the route's required capabilities.",
    ],
  },
  {
    id: "explicit-probing",
    phrases: [
      "Probing remains optional, administrator-triggered, and bounded.",
      "only enabled static-registry models relevant to an active route.",
      "A probe cannot add a model, enable a capability, alter fallback ordering, or expand approved use automatically.",
      "Bound probe model count, concurrency, request and aggregate deadlines, cancellation, retries, response size, and cost.",
      "Never probe the full registry automatically at startup, deployment, health check, or ordinary request time.",
    ],
  },
  {
    id: "credential-names",
    phrases: [
      "1. Reuse the host application's existing Poe/provider configuration name.",
      "2. Otherwise use `POE_API_KEY`.",
      "3. Treat `POE_API_KEY2` only as an explicitly documented legacy name during a controlled migration.",
      "Do not keep two active names without deterministic precedence and tests.",
      "Store the value in Replit Secrets. Never hard-code, commit, log, return, place in a URL, expose to browser code, or ask the user to paste it into chat.",
    ],
  },
  {
    id: "import-safe-client",
    phrases: [
      "Optional Poe modules must be import-safe.",
      "Read and validate configuration only when a Poe operation runs.",
      "A required service may invoke the same getter from an explicit startup preflight; module import must not create a client or fail.",
    ],
  },
  {
    id: "protocol-boundary",
    phrases: [
      "Do not set the OpenAI-compatible client's base URL to `https://api.poe.com/bot/`.",
      "The `/bot/` protocol is for implementing a bot server that Poe calls, not for calling Poe models through `/v1`.",
    ],
  },
  {
    id: "authorized-health-probes",
    phrases: [
      "Health checks may perform a bounded request against an approved registry model only when explicitly authorized; they must never list models.",
      "Live paid inference is an explicit, bounded, opt-in smoke test and must not be required by ordinary CI.",
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

  for (const contract of REQUIRED_POE_SETUP_GUIDANCE) {
    for (const phrase of contract.phrases) {
      if (!normalized.includes(normalizeWhitespace(phrase))) {
        problems.push(`${contract.id}: missing required guidance: ${phrase}`);
      }
    }
  }

  const clientExampleSection = getSection(
    skillText,
    "## 6. Keep the credential server-side",
    "## 7. Use bounded HTTP and validated responses",
  );
  if (!clientExampleSection) {
    problems.push("client-example: missing credential and client example section");
  } else {
    const exampleCode = getCodeBlocks(clientExampleSection).join("\n");
    if (!/let\s+client\s*:\s*OpenAI\s*\|\s*undefined\s*;/.test(exampleCode) ||
        !/function\s+getPoeClient\s*\(/.test(exampleCode) ||
        !/if\s*\(\s*client\s*\)\s*return\s+client/.test(exampleCode) ||
        !/client\s*=\s*new\s+OpenAI\s*\(/.test(exampleCode) ||
        !/baseURL\s*:\s*["'`]https:\/\/api\.poe\.com\/v1["'`]/.test(exampleCode) ||
        !/process\.env\.POE_API_KEY\b/.test(exampleCode)) {
      problems.push("client-example: missing approved lazy memoized v1 client getter");
    }
    problems.push(...findUnsafeRawSdkExamples(clientExampleSection));
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